//! Web 访问设置：端口、是否允许局域网。
//!
//! 服务本身由 `start_local_daemon` 启动；这里只负责配置、状态与「在浏览器打开」。
//! 改绑定地址需要重启（和 CUDA 运行时切换同一个约定）。

use std::net::{IpAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::paths;

/// 默认端口：vite dev（28430 / 28431）与 MCP（50563）都不冲突。
pub const DEFAULT_PORT: u16 = 28440;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WebConfig {
    /// 是否绑定 `0.0.0.0`（默认只绑回环）。
    pub lan: bool,
    pub port: u16,
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            lan: false,
            port: DEFAULT_PORT,
        }
    }
}

/// 设置页展示的访问信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebInfo {
    pub lan: bool,
    pub port: u16,
    pub loopback_url: String,
    pub lan_url: Option<String>,
    pub running: bool,
    /// 配置与当前运行的绑定不一致：重启后生效。
    pub restart_required: bool,
}

/// 进程内运行状态（`start_local_daemon` 写入）。
#[derive(Default)]
pub struct WebState {
    pub running: Mutex<Option<WebInfo>>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::config_dir(app)?.join("web.json"))
}

pub fn load_config(app: &AppHandle) -> WebConfig {
    let Ok(path) = config_path(app) else {
        return WebConfig::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &WebConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败：{e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写入配置失败：{e}"))
}

fn url(host: &str, port: u16) -> String {
    format!("http://{host}:{port}/")
}

/// 本机在局域网里的 IPv4；拿不到（离线 / 只有回环）返回 None。
pub fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    // UDP connect 不会真的发包，只让内核选一条出口路由。
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip)
    }
}

/// 按配置算出访问信息（不关心服务是否在跑）。
pub fn info_for(config: &WebConfig) -> WebInfo {
    WebInfo {
        lan: config.lan,
        port: config.port,
        loopback_url: url("127.0.0.1", config.port),
        lan_url: lan_ip().map(|ip| url(&ip.to_string(), config.port)),
        running: false,
        restart_required: false,
    }
}

/// 配置（期望值）+ 运行状态（实际值）合并出设置页要显示的信息。
fn merged_info(app: &AppHandle, state: &WebState) -> Result<WebInfo, String> {
    let config = load_config(app);
    let mut info = info_for(&config);
    if let Some(running) = state.running.lock().ok().and_then(|guard| guard.clone()) {
        info.running = running.running;
        // 绑定地址 / 端口变了才算「需要重启」。
        info.restart_required = running.lan != config.lan || running.port != config.port;
    }
    Ok(info)
}

#[tauri::command]
pub fn web_access_info(app: AppHandle, state: State<'_, WebState>) -> Result<WebInfo, String> {
    merged_info(&app, &state)
}

/// 切换局域网访问；绑定地址要重启才生效。
#[tauri::command]
pub fn web_access_set_lan(
    app: AppHandle,
    state: State<'_, WebState>,
    lan: bool,
) -> Result<WebInfo, String> {
    let mut config = load_config(&app);
    config.lan = lan;
    save_config(&app, &config)?;
    merged_info(&app, &state)
}

/// 在系统浏览器里打开本机地址。
#[tauri::command]
pub fn web_access_open(app: AppHandle, state: State<'_, WebState>) -> Result<(), String> {
    let info = web_access_info(app, state)?;
    open::that(&info.loopback_url).map_err(|e| format!("打开浏览器失败：{e}"))
}

/// 供 `start_local_daemon` 记录实际运行状态。
pub fn mark_running(app: &AppHandle, info: WebInfo) {
    if let Some(state) = app.try_state::<WebState>() {
        if let Ok(mut guard) = state.running.lock() {
            *guard = Some(info);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{info_for, WebConfig};

    #[test]
    fn builds_tokenised_urls() {
        let config = WebConfig {
            lan: false,
            port: 28440,
        };
        let info = info_for(&config, "abc");
        assert_eq!(info.loopback_url, "http://127.0.0.1:28440/");
        assert_eq!(info.port, 28440);
        assert!(!info.lan);
        assert!(!info.running);
    }
}
