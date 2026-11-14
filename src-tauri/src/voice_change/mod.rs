//! 离线 AI 变声的**桌面壳薄层**：实现已搬到 `aicut_daemon::voice_change`。
//!
//! 变声 = 解码区间 → 16 kHz 单声道 → MeanVC2 → 48 kHz 立体声 WAV，
//! 全靠 `ort` + 音色库文件，没有桌面独占能力；搬走之后浏览器与容器也能用。

use std::sync::Arc;

use tauri::AppHandle;

use crate::host::TauriHost;

pub use aicut_daemon::voice_change::{
    clip_progress, meanvc2, refs, seed_of, voices, VcClip, VcClipResult, EVENT_VOICE,
};
pub use aicut_daemon::voice_change::voices::VoiceEntry;

fn host_of(app: AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app))
}

#[tauri::command]
pub async fn voice_change_convert(
    app: AppHandle,
    clips: Vec<VcClip>,
    voice_id: String,
    model_id: String,
) -> Result<Vec<VcClipResult>, String> {
    aicut_daemon::voice_change::voice_change_convert(&host_of(app), clips, voice_id, model_id).await
}

#[tauri::command]
pub fn voice_change_cancel() {
    aicut_daemon::voice_change::voice_change_cancel()
}

#[tauri::command]
pub fn voice_change_voice_list(app: AppHandle) -> Result<Vec<VoiceEntry>, String> {
    let host = TauriHost::new(app);
    aicut_daemon::voice_change::voice_change_voice_list(&host)
}

#[tauri::command]
pub async fn voice_change_voice_import(
    app: AppHandle,
    asset_path: String,
    name: String,
    start: Option<f64>,
    duration: Option<f64>,
) -> Result<VoiceEntry, String> {
    aicut_daemon::voice_change::voice_change_voice_import(
        &host_of(app),
        asset_path,
        name,
        start,
        duration,
    )
    .await
}

#[tauri::command]
pub fn voice_change_voice_delete(app: AppHandle, id: String) -> Result<(), String> {
    let host = TauriHost::new(app);
    aicut_daemon::voice_change::voice_change_voice_delete(&host, id)
}
