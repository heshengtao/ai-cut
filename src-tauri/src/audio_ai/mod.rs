//! 音频 AI 与 DSP 的**桌面壳薄层**：实现已搬到 `aicut_daemon::audio_ai`。
//!
//! 为什么搬：LocalVQE 降噪、HTDemucs 分离、ffmpeg DSP、字幕翻译这几件事没有任何
//! 桌面独占的依赖——会话创建在 `ai_session`，ffmpeg 走 `Host`，模型目录走
//! `models`。搬走之后，浏览器模式与容器里也能真的跑本地降噪 / 分离，而不是
//! 只给一句"需要在桌面应用中"。
//!
//! 这里保留 `AppHandle` 签名与命令名，是为了不动 `lib.rs` 的命令注册与前端的
//! `invoke("audio_ai_*")`。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::audio_ai::{
    AudioProcessed, AudioStem, LoudnessReport, TranslateEndpoint, EVENT_AUDIO_AI,
};

#[tauri::command]
pub async fn audio_measure_loudness(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
) -> Result<LoudnessReport, String> {
    let host = TauriHost::new(app);
    aicut_daemon::audio_ai::audio_measure_loudness(&host, path, start, duration).await
}

#[tauri::command]
pub async fn audio_dsp_process(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    effect: String,
    preset: String,
) -> Result<AudioProcessed, String> {
    let host: Arc<dyn aicut_daemon::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::audio_ai::audio_dsp_process(&host, path, start, duration, effect, preset).await
}

#[tauri::command]
pub async fn audio_ai_denoise(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    model_id: String,
) -> Result<AudioProcessed, String> {
    let host: Arc<dyn aicut_daemon::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::audio_ai::audio_ai_denoise(&host, path, start, duration, model_id).await
}

#[tauri::command]
pub async fn audio_ai_separate(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    model_id: String,
) -> Result<Vec<AudioStem>, String> {
    let host: Arc<dyn aicut_daemon::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::audio_ai::audio_ai_separate(&host, path, start, duration, model_id).await
}

#[tauri::command]
pub async fn audio_extract_reference(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
) -> Result<AudioProcessed, String> {
    let host = TauriHost::new(app);
    aicut_daemon::audio_ai::audio_extract_reference(&host, path, start, duration).await
}

#[tauri::command]
pub fn audio_ai_cancel() {
    aicut_daemon::audio_ai::audio_ai_cancel()
}

#[tauri::command]
pub async fn translate_text(
    agent: State<'_, Arc<crate::agent::AgentState>>,
    network: State<'_, Arc<NetworkRuntime>>,
    texts: Vec<String>,
    target: String,
) -> Result<Vec<String>, String> {
    let config = agent.config();
    let endpoint = TranslateEndpoint {
        base_url: config.base_url,
        api_key: config.api_key,
        model: config.model,
    };
    aicut_daemon::audio_ai::translate_text(network.inner().as_ref(), endpoint, texts, target).await
}
