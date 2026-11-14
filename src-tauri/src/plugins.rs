//! OFX 插件管理的**桌面壳薄层**：实现已搬到 `aicut_daemon::plugins`。
//!
//! 注册表拉取、下载校验、归档解包、装进托管目录、扫描外部插件目录——全是文件与 HTTP，
//! 没有桌面独占能力。桌面壳只多两件事：`plugin_reveal`（在文件管理器里显示）与
//! `plugin_open`（拉起系统浏览器）。无头版对这两条**明确拒绝**，不会假装成功。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::plugins::{
    PluginProgress, PluginStatus, RegistryFile, RegistryPlugin, RegistryResponse, EVENT_PLUGIN,
};

fn host_of(app: &AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app.clone()))
}

#[tauri::command]
pub async fn plugin_registry(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    force: bool,
) -> Result<RegistryResponse, String> {
    aicut_daemon::plugins::plugin_registry(&host_of(&app), network.inner().as_ref(), force).await
}

#[tauri::command]
pub fn plugin_installed(app: AppHandle) -> Result<Vec<PluginStatus>, String> {
    aicut_daemon::plugins::plugin_installed(&host_of(&app))
}

#[tauri::command]
pub async fn plugin_install(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    slug: String,
) -> Result<(), String> {
    aicut_daemon::plugins::plugin_install(&host_of(&app), network.inner().as_ref(), slug).await
}

#[tauri::command]
pub fn plugin_cancel() {
    aicut_daemon::plugins::plugin_cancel()
}

#[tauri::command]
pub fn plugin_remove(app: AppHandle, slug: String) -> Result<(), String> {
    aicut_daemon::plugins::plugin_remove(&host_of(&app), slug)
}

#[tauri::command]
pub fn plugin_import(app: AppHandle, path: String) -> Result<(), String> {
    aicut_daemon::plugins::plugin_import(&host_of(&app), path)
}

#[tauri::command]
pub fn plugin_reveal(app: AppHandle, slug: String) -> Result<(), String> {
    aicut_daemon::plugins::plugin_reveal(&host_of(&app), slug)
}

#[tauri::command]
pub async fn plugin_open(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    slug: String,
) -> Result<(), String> {
    aicut_daemon::plugins::plugin_open(&host_of(&app), network.inner().as_ref(), slug).await
}
