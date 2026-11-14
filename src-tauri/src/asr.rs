//! 语音识别（一键字幕 / 剪口播）的**桌面壳薄层**：实现已搬到 `aicut_daemon::asr`。
//!
//! 链路是 ffmpeg 抽 16 kHz 单声道 → Silero VAD 切段 → sherpa-onnx 识别，
//! 全是纯计算 + 模型文件，没有桌面独占能力；搬走之后浏览器与容器也能生成字幕。

use std::sync::Arc;

use tauri::AppHandle;

use crate::host::TauriHost;

pub use aicut_daemon::asr::{
    AsrProgress, SubtitleCue, TranscriptWord, Transcription, EVENT_ASR,
};

fn host_of(app: AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app))
}

#[tauri::command]
pub async fn asr_transcribe(
    app: AppHandle,
    path: String,
    model_id: String,
    language: Option<String>,
) -> Result<Vec<SubtitleCue>, String> {
    aicut_daemon::asr::asr_transcribe(&host_of(app), path, model_id, language).await
}

#[tauri::command]
pub async fn asr_transcribe_words(
    app: AppHandle,
    path: String,
    model_id: String,
    language: Option<String>,
) -> Result<Transcription, String> {
    aicut_daemon::asr::asr_transcribe_words(&host_of(app), path, model_id, language).await
}

#[tauri::command]
pub fn asr_cancel() {
    aicut_daemon::asr::asr_cancel()
}
