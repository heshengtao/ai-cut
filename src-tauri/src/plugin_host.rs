//! 画布插件宿主的**桌面壳薄层**：实现都在 `aicut_daemon::plugin_host`。
//!
//! 与 `plugins`（OFX）分开：那是原生二进制插件，这里是可执行客户端半的画布插件。

use std::sync::Arc;

use aicut_daemon::plugin_host::linked::PluginStatus;
use tauri::AppHandle;

use crate::host::TauriHost;

fn host_of(app: &AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app.clone()))
}

fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub fn plugin_host_list(app: AppHandle) -> Result<serde_json::Value, String> {
    let plugins = aicut_daemon::plugin_host::service::list(&host_of(&app), version())?;
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
        version(),
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
        aicut_daemon::plugin_host::service::toggle(&host_of(&app), &id, enabled, version())?;
    Ok(serde_json::json!({ "plugins": plugins }))
}

#[tauri::command]
pub fn plugin_host_remove(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let plugins = aicut_daemon::plugin_host::service::forget(&host_of(&app), &id, version())?;
    Ok(serde_json::json!({ "plugins": plugins }))
}

/// 给前端复用的状态结构（仅类型用途，避免 tauri 宏推导不到）。
pub type PluginHostStatus = PluginStatus;
