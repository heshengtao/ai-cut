//! 媒体命令的 Tauri 壳。
//!
//! 实现全部在 `aicut_daemon::media`（无头/浏览器共用同一份），这里只负责把
//! `AppHandle` 包成 `Host`，并保持前端看到的名字与返回结构不变。

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

use crate::host::TauriHost;

pub use aicut_daemon::media::{CopiedMedia, FileStamp, MediaMeta};

/// 应用缓存目录（桌面端与 daemon 的 `Host::cache_dir` 同源）。
pub(crate) fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = crate::paths::cache_dir(app).map_err(|e| format!("取应用缓存目录失败：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn file_stamp(path: String) -> FileStamp {
    aicut_daemon::media::file_stamp(path)
}

#[tauri::command]
pub async fn probe_media(app: AppHandle, path: String) -> Result<MediaMeta, String> {
    aicut_daemon::media::probe_media(&TauriHost::new(app), path).await
}

#[tauri::command]
pub async fn make_thumbnail(
    app: AppHandle,
    path: String,
    asset_id: String,
    at_sec: f64,
) -> Result<String, String> {
    aicut_daemon::media::make_thumbnail(&TauriHost::new(app), path, asset_id, at_sec).await
}

#[tauri::command]
pub async fn make_waveform(
    app: AppHandle,
    path: String,
    asset_id: String,
) -> Result<Vec<u8>, String> {
    aicut_daemon::media::make_waveform(&TauriHost::new(app), path, asset_id).await
}

#[tauri::command]
pub async fn extract_audio_preview(
    app: AppHandle,
    path: String,
    asset_id: String,
) -> Result<String, String> {
    aicut_daemon::media::extract_audio_preview(&TauriHost::new(app), path, asset_id).await
}

#[tauri::command]
pub async fn make_video_preview(
    app: AppHandle,
    path: String,
    asset_id: String,
) -> Result<String, String> {
    aicut_daemon::media::make_video_preview(&TauriHost::new(app), path, asset_id).await
}

#[tauri::command]
pub fn media_cache_dir(app: AppHandle) -> Result<String, String> {
    Ok(cache_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_media_files(dir: String, files: Vec<String>) -> Result<Vec<CopiedMedia>, String> {
    aicut_daemon::media::copy_media_files(dir, files)
}
