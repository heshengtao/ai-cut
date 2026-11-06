//! 内嵌 MCP 服务器（Streamable HTTP / JSON-RPC，本地回环）。
//!
//! - 设置在 `mcp.json`（enabled / port）；运行时把实际地址写到 `mcp-url`。
//! - 工具面由 `tools` 统一提供，和内置剪辑智能体共用。
//! - 只监听 `127.0.0.1`；不引入额外鉴权，和 ai-daw 的安全模型一致。

use std::io::ErrorKind;
use std::net::{SocketAddr, TcpListener};
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

/// 停服时等 axum 退出（监听 socket 关闭）的上限；正常是毫秒级。
const STOP_WAIT: Duration = Duration::from_secs(2);

/// 固定端口绑不上时的重试窗口：留给**自己上一轮**的监听收尾，不是等别的进程让出端口。
const BUSY_RETRIES: u32 = 30;
const BUSY_INTERVAL: Duration = Duration::from_millis(50);

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

/// 配置端口没绑上、退回系统临时端口的原因。
///
/// 前端据此给出一句人话（而不是只把端口悄悄换掉，让人拿着旧地址去配客户端）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortConflict {
    /// 端口被别的进程占着（也可能是同一台机器上的另一个 AI Cut 实例）。
    Busy,
    /// 端口被系统保留 / 当前用户无权限（Windows 排除端口区、1024 以下的特权端口）。
    Denied,
}

impl PortConflict {
    fn reason(self) -> &'static str {
        match self {
            PortConflict::Busy => "已被其他程序占用",
            PortConflict::Denied => "被系统保留或没有权限",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct McpStatus {
    /// 配置里写的端口（用户填的；下次启动还会先试它）。
    pub port: u16,
    pub enabled: bool,
    pub running: bool,
    /// 实际接入地址，形如 `http://127.0.0.1:50563/mcp`；未运行时为 `None`。
    pub url: Option<String>,
    /// 实际监听的端口；未运行时为 `None`。配置端口被占用时它会和 `port` 不同。
    #[serde(rename = "boundPort")]
    pub bound_port: Option<u16>,
    /// 实际端口 ≠ 配置端口，说明本次运行退回了系统临时端口。
    pub fallback: bool,
    /// 退回临时端口的原因；没退回时为 `None`。
    #[serde(rename = "portConflict")]
    pub port_conflict: Option<PortConflict>,
}

impl McpStatus {
    fn stopped(config: &McpConfig) -> Self {
        Self {
            enabled: config.enabled,
            port: config.port,
            running: false,
            url: None,
            bound_port: None,
            fallback: false,
            port_conflict: None,
        }
    }
}

struct Running {
    addr: SocketAddr,
    /// 本次监听是否退回了临时端口；`None` 表示用的是配置端口。
    conflict: Option<PortConflict>,
    cancel: CancellationToken,
    /// serve 任务真正退出（监听 socket 已关闭）后收到 `()`；`stop` 用它避免重启抢跑。
    done: Option<std::sync::mpsc::Receiver<()>>,
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
            // 锁中毒（某次 panic 发生在持锁期间）：按「没开」报，别把界面显示成「已启用但没监听」。
            return McpStatus::stopped(&McpConfig {
                enabled: false,
                port: DEFAULT_MCP_PORT,
            });
        };
        let running = inner.running.as_ref();
        McpStatus {
            enabled: inner.config.enabled,
            port: inner.config.port,
            running: running.is_some(),
            url: running.map(|running| format!("http://{}/mcp", running.addr)),
            bound_port: running.map(|running| running.addr.port()),
            fallback: running.is_some_and(|running| running.conflict.is_some()),
            port_conflict: running.and_then(|running| running.conflict),
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

        let port = self
            .inner
            .lock()
            .map_err(|_| "MCP 状态锁失败".to_string())?
            .config
            .port;

        // 上一轮可能留下一个指向已死地址的发现文件；绑定成功后再写新的。
        // 否则启动失败时，外部 harness 会拿着旧地址一直重连。
        remove_file(&self.url_path);

        // 首选配置端口；被占用 / 被系统保留时退回系统临时端口，并记下原因给界面。
        let (listener, conflict) = bind_preferred(port).map_err(|error| error.message())?;
        let addr = listener
            .local_addr()
            .map_err(|error| format!("读取监听地址失败：{error}"))?;

        let cancel = CancellationToken::new();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "MCP 状态锁失败".to_string())?;
            inner.running = Some(Running {
                addr,
                conflict,
                cancel: cancel.clone(),
                done: Some(done_rx),
            });
        }
        if let Err(error) = write_file(&self.url_path, &format!("http://{addr}/mcp")) {
            eprintln!("[mcp] 写入发现文件失败：{error}");
        }
        if let Some(conflict) = conflict {
            eprintln!(
                "[mcp] 端口 {port} {}，本次运行改用临时端口 {addr}（外部客户端请读 mcp-url）",
                conflict.reason()
            );
        }

        let app = self.app.clone();
        let bridge = self.bridge.clone();
        let session_id = uuid::Uuid::new_v4().to_string();
        tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("[mcp] 转换监听器失败：{error}");
                    // 提前返回也要通知 stop()，否则它会把 2 秒的等待窗口用完。
                    let _ = done_tx.send(());
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
            // 走到这里监听 socket 已经关闭；停服 / 换端口重启可以安全地重绑同一端口了。
            let _ = done_tx.send(());
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
            // 等 axum 真正退出：只 cancel 就返回的话，紧跟着的「关 → 开」会撞上自己上一轮的
            // 监听，被误判成「端口被占用」而白白退回临时端口。
            if let Some(done) = running.done {
                let _ = done.recv_timeout(STOP_WAIT);
            }
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

/// 绑定回环地址失败的原因。区分它俩是为了：占用值得等一小会儿（可能是自己上一轮还没退干净），
/// 系统保留 / 权限不足则一次都不用重试。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BindFailure {
    Busy,
    Denied,
    Failed,
}

impl BindFailure {
    fn conflict(self) -> Option<PortConflict> {
        match self {
            BindFailure::Busy => Some(PortConflict::Busy),
            BindFailure::Denied => Some(PortConflict::Denied),
            BindFailure::Failed => None,
        }
    }

    fn hint(self) -> &'static str {
        match self {
            BindFailure::Busy => "端口已被占用（可能是另一个 AI Cut 实例或别的程序）；关掉它，或换一个端口",
            BindFailure::Denied => {
                "该端口被系统保留或当前用户没有权限（Windows 的 Hyper-V/WSL 排除端口区、1024 以下的特权端口）；换到 20000–49151 之间"
            }
            BindFailure::Failed => "无法绑定回环地址",
        }
    }
}

#[derive(Debug)]
struct BindError {
    failure: BindFailure,
    port: u16,
    detail: String,
}

impl BindError {
    fn message(&self) -> String {
        format!(
            "监听 127.0.0.1:{} 失败：{}（{}）",
            self.port,
            self.detail,
            self.failure.hint()
        )
    }
}

/// 先试配置端口；被占用 / 被系统保留时退回系统临时端口，并把原因带回给界面。
///
/// 退回只是**本次运行**的行为：`mcp.json` 里仍保留用户填的端口，下次启动会再试一次。
fn bind_preferred(port: u16) -> Result<(TcpListener, Option<PortConflict>), BindError> {
    bind_preferred_with(port, BUSY_RETRIES, BUSY_INTERVAL)
}

fn bind_preferred_with(
    port: u16,
    attempts: u32,
    interval: Duration,
) -> Result<(TcpListener, Option<PortConflict>), BindError> {
    match bind_loopback_with(port, attempts, interval) {
        Ok(listener) => Ok((listener, None)),
        Err(error) if port != 0 && error.failure != BindFailure::Failed => {
            let listener = bind_loopback_with(0, 1, interval).map_err(|fallback| BindError {
                failure: fallback.failure,
                port: 0,
                detail: format!(
                    "配置端口 {port} 不可用（{}），临时端口也绑不上：{}",
                    error.detail, fallback.detail
                ),
            })?;
            Ok((listener, error.failure.conflict()))
        }
        Err(error) => Err(error),
    }
}

fn bind_loopback_with(
    port: u16,
    attempts: u32,
    interval: Duration,
) -> Result<TcpListener, BindError> {
    let attempts = attempts.max(1);
    let mut last: Option<std::io::Error> = None;
    for attempt in 0..attempts {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                listener.set_nonblocking(true).map_err(|error| BindError {
                    failure: BindFailure::Failed,
                    port,
                    detail: error.to_string(),
                })?;
                return Ok(listener);
            }
            Err(error) => {
                let failure = classify_bind_error(&error);
                // 只有「占用」值得等：系统保留端口不会自己让出来。
                if failure != BindFailure::Busy {
                    return Err(BindError {
                        failure,
                        port,
                        detail: error.to_string(),
                    });
                }
                last = Some(error);
                if attempt + 1 < attempts {
                    std::thread::sleep(interval);
                }
            }
        }
    }
    Err(BindError {
        failure: BindFailure::Busy,
        port,
        detail: last
            .map(|error| error.to_string())
            .unwrap_or_else(|| "端口一直处于占用状态".to_string()),
    })
}

fn classify_bind_error(error: &std::io::Error) -> BindFailure {
    match error.kind() {
        ErrorKind::AddrInUse => BindFailure::Busy,
        ErrorKind::PermissionDenied | ErrorKind::AddrNotAvailable => BindFailure::Denied,
        // Windows 上个别 Win32 错误会落到 Uncategorized：10048 = WSAEADDRINUSE，
        // 10013 = WSAEACCES（绑定排除端口区就是这个）。
        _ => match error.raw_os_error() {
            Some(10048) => BindFailure::Busy,
            Some(10013) => BindFailure::Denied,
            _ => BindFailure::Failed,
        },
    }
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
    use super::*;

    #[test]
    fn mcp_config_defaults() {
        let config = McpConfig::default();
        assert!(config.enabled);
        assert_eq!(config.port, DEFAULT_MCP_PORT);
    }

    /// 端口被别的 socket 占着：分类成`占用`，且不会把整个重试窗口耗光。
    #[test]
    fn busy_port_is_reported_as_busy() {
        let held = TcpListener::bind(("127.0.0.1", 0)).expect("先占一个回环端口");
        let port = held.local_addr().unwrap().port();

        let started = std::time::Instant::now();
        let error = bind_loopback_with(port, 3, Duration::from_millis(5)).unwrap_err();

        assert_eq!(error.failure, BindFailure::Busy);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(error.message().contains("占用"), "{}", error.message());
    }

    /// 配置端口被占用时仍然起得来：退回临时端口，并把原因标出来。
    #[test]
    fn falls_back_to_ephemeral_port() {
        let held = TcpListener::bind(("127.0.0.1", 0)).expect("先占一个回环端口");
        let port = held.local_addr().unwrap().port();

        let (listener, conflict) =
            bind_preferred_with(port, 2, Duration::from_millis(5)).expect("占用时应该退回临时端口");

        assert_eq!(conflict, Some(PortConflict::Busy));
        let bound = listener.local_addr().unwrap().port();
        assert_ne!(bound, 0);
        assert_ne!(bound, port);
    }

    /// 端口填 0（自动分配）时不算冲突：前端不该弹「端口被占用」。
    #[test]
    fn ephemeral_config_is_not_a_conflict() {
        let (listener, conflict) = bind_preferred_with(0, 1, Duration::from_millis(1)).unwrap();
        assert_eq!(conflict, None);
        assert_ne!(listener.local_addr().unwrap().port(), 0);
    }

    /// 权限 / 系统保留类错误不重试：立刻返回，不能让人干等 1.5 秒。
    #[test]
    fn classifies_bind_errors() {
        let denied = std::io::Error::from(ErrorKind::PermissionDenied);
        let busy = std::io::Error::from(ErrorKind::AddrInUse);
        assert_eq!(classify_bind_error(&denied), BindFailure::Denied);
        assert_eq!(classify_bind_error(&busy), BindFailure::Busy);
        assert_eq!(BindFailure::Denied.conflict(), Some(PortConflict::Denied));
        assert_eq!(BindFailure::Failed.conflict(), None);
    }

    /// 状态字段是前端契约：实际端口 / 退回标记 / 原因都得露出来。
    #[test]
    fn status_exposes_bound_port_and_conflict() {
        let status = McpStatus {
            enabled: true,
            port: 50563,
            running: true,
            url: Some("http://127.0.0.1:60001/mcp".into()),
            bound_port: Some(60001),
            fallback: true,
            port_conflict: Some(PortConflict::Busy),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["boundPort"], 60001);
        assert_eq!(json["fallback"], true);
        assert_eq!(json["portConflict"], "busy");
        assert_eq!(json["port"], 50563);
    }

    /// 停着的状态没有实际端口，前端看到的是「未监听」而不是 0。
    #[test]
    fn stopped_status_has_no_bound_port() {
        let status = McpStatus::stopped(&McpConfig::default());
        assert!(!status.running);
        assert_eq!(status.bound_port, None);
        assert!(!status.fallback);
        assert_eq!(status.port_conflict, None);
    }
}
