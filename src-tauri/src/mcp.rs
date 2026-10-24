//! 内嵌 MCP 服务器（Streamable HTTP / JSON-RPC，本地回环）。
//!
//! - 设置在 `mcp.json`（enabled / port）；运行时把实际地址写到 `mcp-url`。
//! - 工具面由 `tools` 统一提供，和内置剪辑智能体共用。
//! - 只监听 `127.0.0.1`；不引入额外鉴权，和 ai-daw 的安全模型一致。

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;

use crate::bridge::ProjectBridge;
use crate::tools;

pub const DEFAULT_MCP_PORT: u16 = 50563;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_MCP_PORT,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    pub url: Option<String>,
}

struct Running {
    addr: SocketAddr,
    cancel: CancellationToken,
}

struct Inner {
    config: McpConfig,
    running: Option<Running>,
}

pub struct McpRuntime {
    app: AppHandle,
    bridge: Arc<ProjectBridge>,
    config_path: Option<PathBuf>,
    url_path: Option<PathBuf>,
    inner: Mutex<Inner>,
}

impl McpRuntime {
    pub fn load(
        app: AppHandle,
        bridge: Arc<ProjectBridge>,
        config_path: Option<PathBuf>,
        url_path: Option<PathBuf>,
    ) -> Self {
        let config = config_path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<McpConfig>(&text).ok())
            .unwrap_or_default();
        Self {
            app,
            bridge,
            config_path,
            url_path,
            inner: Mutex::new(Inner {
                config,
                running: None,
            }),
        }
    }

    pub fn autostart(self: &Arc<Self>) {
        let enabled = self
            .inner
            .lock()
            .map(|inner| inner.config.enabled)
            .unwrap_or(false);
        if enabled {
            if let Err(error) = self.start() {
                eprintln!("[mcp] 启动失败：{error}");
            }
        } else {
            remove_file(&self.url_path);
        }
    }

    pub fn status(&self) -> McpStatus {
        let Ok(inner) = self.inner.lock() else {
            return McpStatus {
                enabled: false,
                port: DEFAULT_MCP_PORT,
                running: false,
                url: None,
            };
        };
        McpStatus {
            enabled: inner.config.enabled,
            port: inner.config.port,
            running: inner.running.is_some(),
            url: inner
                .running
                .as_ref()
                .map(|running| format!("http://{}/mcp", running.addr)),
        }
    }

    pub fn apply(self: &Arc<Self>, config: McpConfig) -> Result<McpStatus, String> {
        self.save_config(&config);
        self.stop();
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "MCP 状态锁失败".to_string())?;
            inner.config = config.clone();
        }
        if config.enabled {
            self.start()?;
        }
        Ok(self.status())
    }

    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "MCP 状态锁失败".to_string())?;
            if inner.running.is_some() {
                return Ok(());
            }
            if !inner.config.enabled {
                return Ok(());
            }
        }

        let config = self
            .inner
            .lock()
            .map_err(|_| "MCP 状态锁失败".to_string())?
            .config
            .clone();

        let listener = match bind_loopback(config.port) {
            Ok(listener) => listener,
            Err(error) if config.port != 0 => {
                eprintln!("[mcp] 端口 {} 不可用（{error}），改用临时端口", config.port);
                bind_loopback(0).map_err(|error| format!("绑定回环端口失败：{error}"))?
            }
            Err(error) => return Err(format!("绑定回环端口失败：{error}")),
        };
        let addr = listener
            .local_addr()
            .map_err(|error| format!("读取监听地址失败：{error}"))?;

        let cancel = CancellationToken::new();
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "MCP 状态锁失败".to_string())?;
            inner.running = Some(Running {
                addr,
                cancel: cancel.clone(),
            });
        }
        if let Err(error) = write_file(&self.url_path, &format!("http://{addr}/mcp")) {
            eprintln!("[mcp] 写入发现文件失败：{error}");
        }

        let app = self.app.clone();
        let bridge = self.bridge.clone();
        let session_id = uuid::Uuid::new_v4().to_string();
        tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("[mcp] 转换监听器失败：{error}");
                    return;
                }
            };
            let state = Arc::new(McpServerState {
                app,
                bridge,
                session_id,
            });
            let router = Router::new()
                .route("/health", get(health))
                .route("/mcp", post(handle_mcp))
                .with_state(state)
                .layer(CorsLayer::permissive());
            eprintln!("[mcp] 监听 http://{addr}/mcp");
            let shutdown = async move { cancel.cancelled().await };
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown)
                .await
            {
                eprintln!("[mcp] 服务退出：{error}");
            }
        });
        Ok(())
    }

    pub fn stop(&self) {
        let running = self
            .inner
            .lock()
            .ok()
            .and_then(|mut inner| inner.running.take());
        if let Some(running) = running {
            running.cancel.cancel();
        }
        remove_file(&self.url_path);
    }

    fn save_config(&self, config: &McpConfig) {
        let Some(path) = &self.config_path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[mcp] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[mcp] 序列化配置失败：{error}"),
        }
    }
}

fn bind_loopback(port: u16) -> std::io::Result<std::net::TcpListener> {
    let mut last_error = None;
    for _ in 0..20 {
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                listener.set_nonblocking(true)?;
                return Ok(listener);
            }
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("未知绑定错误")))
}

fn write_file(path: &Option<PathBuf>, text: &str) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, text).map_err(|error| error.to_string())
}

fn remove_file(path: &Option<PathBuf>) {
    if let Some(path) = path {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, Arc<McpRuntime>>) -> McpStatus {
    state.status()
}

#[tauri::command]
pub fn set_mcp_config(
    state: tauri::State<'_, Arc<McpRuntime>>,
    enabled: bool,
    port: u16,
) -> Result<McpStatus, String> {
    state.apply(McpConfig { enabled, port })
}

struct McpServerState {
    app: AppHandle,
    bridge: Arc<ProjectBridge>,
    session_id: String,
}

async fn health() -> &'static str {
    "ok"
}

async fn handle_mcp(
    State(state): State<Arc<McpServerState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let Some(id) = body.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let method = body.get("method").and_then(Value::as_str).unwrap_or("");

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": body
                .get("params")
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "aicut", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "AI Cut 的剪辑工具面：读写时间线、字幕/标记、调色/转场/关键帧、调用本地 AI 与导出。读取是渐进的：get_project 只给概览，按关注点再用 get_context / get_track / find_clips / get_clip / get_assets / get_markers。看素材内容先调用 probe_media，一次拿元数据、运动采样/候选切点、可选目标框与语音转写，不要逐帧 render_frame 看图。工程生命周期 new_project / open_project / save_project 直接读写工程 JSON，不会弹保存/打开对话框，不要做 UI 自动化。写操作进入撤销历史；单条用 apply_command，多条用 apply_commands。合成原语用 set_clip_color / set_clip_transition / set_clip_keyframes；看画面用 render_frame / render_storyboard；整片结构用 import_film_manifest，单场重渲用 render_range（先 render_status 找脏段），版本对比用 compare_takes，20 格总览用 render_contact_sheet；审片意见用 add_review_note / list_review_notes，改完用 update_review_note 标 resolved。长任务用 job_start 再用 job_status 轮询。export_video 的 outputPath 可省略，省略时自动写到工程目录/下载目录并返回最终路径。"
        })),
        "ping" => Ok(json!({})),
        // MCP 规范要求参数 schema 放在 `inputSchema`；`ToolDef` 的内部字段名是
        // `parameters`，直接序列化会让严格客户端拿到无 schema 的工具。
        "tools/list" => Ok(json!({
            "tools": tools::definitions()
                .into_iter()
                .map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.parameters,
                }))
                .collect::<Vec<_>>()
        })),
        "tools/call" => call_tool(&state, body.get("params").cloned().unwrap_or(Value::Null)).await,
        other => Err(json!({ "code": -32601, "message": format!("未知方法：{other}") })),
    };

    let payload = match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    };

    let accept = headers
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let text = serde_json::to_string(&payload).unwrap_or_default();

    if accept.contains("text/event-stream") {
        Response::builder()
            .status(200)
            .header("content-type", "text/event-stream")
            .header("mcp-session-id", state.session_id.as_str())
            .body(Body::from(format!("event: message\ndata: {text}\n\n")))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    } else {
        Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .header("mcp-session-id", state.session_id.as_str())
            .body(Body::from(text))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }
}

async fn call_tool(state: &McpServerState, params: Value) -> Result<Value, Value> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    match tools::dispatch(&state.app, &state.bridge, "mcp", name, args).await {
        Ok(value) => Ok(json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string_pretty(&value).unwrap_or_default()
            }],
            "isError": false
        })),
        Err(error) => Ok(json!({
            "content": [{ "type": "text", "text": error }],
            "isError": true
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::McpConfig;

    #[test]
    fn mcp_config_defaults() {
        let config = McpConfig::default();
        assert!(config.enabled);
        assert_eq!(config.port, super::DEFAULT_MCP_PORT);
    }
}
