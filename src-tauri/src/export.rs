//! 导出命令的 Tauri 壳：实现只有一份，在 `aicut_daemon::export`。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;

pub use aicut_daemon::export::{ExportJob, ExportProgress};

#[tauri::command]
pub async fn export_video(
    app: AppHandle,
    state: State<'_, Arc<aicut_daemon::export::ExportState>>,
    job: ExportJob,
) -> Result<(), String> {
    aicut_daemon::export::export_video(&TauriHost::new(app), state.as_ref(), job).await
}

#[tauri::command]
pub fn cancel_export(state: State<'_, Arc<aicut_daemon::export::ExportState>>) -> Result<(), String> {
    aicut_daemon::export::cancel(state.as_ref())
}

#[tauri::command]
pub fn write_export_text_image(
    app: AppHandle,
    name: String,
    base64: String,
) -> Result<String, String> {
    aicut_daemon::export::write_export_text_image(&TauriHost::new(app), &name, &base64)
}
