//! AI 朗读的**桌面壳薄层**：实现已搬到 `aicut_daemon::tts`。
//!
//! 两条引擎（MOSS-TTS-Nano 的 ONNX 图、ZipVoice 的 sherpa-onnx `OfflineTts`）
//! 都只依赖模型目录、缓存目录与 ffmpeg，没有一处需要 Tauri；搬走之后
//! 浏览器与容器也能朗读。

use std::sync::Arc;

use tauri::AppHandle;

use crate::host::TauriHost;

pub use aicut_daemon::tts::{TtsAudio, TtsItem, TtsVoice};
pub use aicut_daemon::tts_core::EVENT_TTS;

#[tauri::command]
pub fn tts_voices(app: AppHandle, model_id: String) -> Result<Vec<TtsVoice>, String> {
    let host = TauriHost::new(app);
    aicut_daemon::tts::tts_voices(&host, model_id)
}

#[tauri::command]
pub async fn tts_synthesize(
    app: AppHandle,
    model_id: String,
    items: Vec<TtsItem>,
    voice: Option<String>,
    reference_path: Option<String>,
    reference_text: Option<String>,
) -> Result<Vec<TtsAudio>, String> {
    let host: Arc<dyn aicut_daemon::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::tts::tts_synthesize(
        &host,
        model_id,
        items,
        voice,
        reference_path,
        reference_text,
    )
    .await
}

#[tauri::command]
pub fn tts_cancel() {
    aicut_daemon::tts::tts_cancel()
}
