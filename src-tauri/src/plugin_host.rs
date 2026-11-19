//! 画布插件宿主的**桌面壳薄层**：实现都在 `aicut_daemon::plugin_host`。
//!
//! 与 `plugins`（OFX）分开：那是原生二进制插件，这里是可执行客户端半的画布插件。

use std::sync::Arc;

use aicut_daemon::plugin_host::linked::PluginStatus;
use tauri::{AppHandle, State};

use crate::network::NetworkRuntime;

use crate::host::TauriHost;

fn host_of(app: &AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app.clone()))
}

fn binary_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub fn plugin_host_list(app: AppHandle) -> Result<serde_json::Value, String> {
    let plugins = aicut_daemon::plugin_host::service::list(&host_of(&app), binary_version())?;
    Ok(serde_json::json!({ "plugins": plugins }))
}

#[tauri::command]
pub fn plugin_host_install_local(
    app: AppHandle,
    path: String,
) -> Result<serde_json::Value, String> {
    let plugin = aicut_daemon::plugin_host::service::install_local(
        &host_of(&app),
        std::path::Path::new(&path),
        binary_version(),
    )?;
    Ok(serde_json::json!({ "plugin": plugin }))
}

#[tauri::command]
pub fn plugin_host_set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let plugins =
        aicut_daemon::plugin_host::service::toggle(&host_of(&app), &id, enabled, binary_version())?;
    Ok(serde_json::json!({ "plugins": plugins }))
}

#[tauri::command]
pub fn plugin_host_remove(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let plugins = aicut_daemon::plugin_host::service::forget(&host_of(&app), &id, binary_version())?;
    Ok(serde_json::json!({ "plugins": plugins }))
}

/// 给前端复用的状态结构（仅类型用途，避免 tauri 宏推导不到）。
pub type PluginHostStatus = PluginStatus;

// 这三个命令都会**阻塞**（一次 run 可能轮询几分钟），必须 `async` + `spawn_blocking`：
// Tauri 的同步命令跑在 IPC 消息线程（macOS 就是主线程）上，阻塞它等于整个界面冻住，
// 连视频预览和窗口都不再响应。

#[tauri::command]
pub async fn plugin_host_start(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    id: String,
) -> Result<serde_json::Value, String> {
    let network = Arc::clone(network.inner());
    tauri::async_runtime::spawn_blocking(move || {
        aicut_daemon::plugin_host::service::start(&host_of(&app), network.as_ref(), &id)
    })
    .await
    .map_err(|error| format!("启动插件失败：{error}"))??;
    Ok(serde_json::json!({ "running": true }))
}

#[tauri::command]
pub async fn plugin_host_invoke(id: String, input: String) -> Result<serde_json::Value, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        aicut_daemon::plugin_host::service::invoke(&id, &input)
    })
    .await
    .map_err(|error| format!("插件调用失败：{error}"))??;
    Ok(serde_json::json!({ "output": output }))
}

/// 取消正在跑的那次 `run()`（宿主半继续活着）。前端「停止运行」调用它。
#[tauri::command]
pub async fn plugin_host_cancel(id: String) -> Result<serde_json::Value, String> {
    let cancelled = tauri::async_runtime::spawn_blocking(move || {
        aicut_daemon::plugin_host::service::cancel(&id)
    })
    .await
    .map_err(|error| format!("取消插件调用失败：{error}"))?;
    Ok(serde_json::json!({ "cancelled": cancelled }))
}

#[tauri::command]
pub async fn plugin_host_stop(id: String) -> Result<serde_json::Value, String> {
    let stopped = tauri::async_runtime::spawn_blocking(move || {
        aicut_daemon::plugin_host::service::stop(&id)
    })
    .await
    .map_err(|error| format!("停止插件失败：{error}"))?;
    Ok(serde_json::json!({
        "stopped": stopped,
        "running": aicut_daemon::plugin_host::service::running(),
    }))
}

#[tauri::command]
pub fn plugin_market_sources(app: AppHandle) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "url": aicut_daemon::plugin_host::service::market_source(&host_of(&app))
    }))
}

#[tauri::command]
pub fn plugin_market_set_source(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "url": aicut_daemon::plugin_host::service::market_set_source(&host_of(&app), &url)?
    }))
}

#[tauri::command]
pub async fn plugin_market_search(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    text: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    aicut_daemon::plugin_host::service::market_search(
        &host_of(&app),
        network.inner().as_ref(),
        binary_version(),
        text.unwrap_or_default().as_str(),
        offset.unwrap_or(0),
        limit.unwrap_or(20),
        force.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn plugin_market_install(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    name: String,
    version: Option<String>,
) -> Result<serde_json::Value, String> {
    let plugin = aicut_daemon::plugin_host::service::market_install(
        &host_of(&app),
        network.inner().as_ref(),
        binary_version(),
        &name,
        version.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(serde_json::json!({ "plugin": plugin }))
}
