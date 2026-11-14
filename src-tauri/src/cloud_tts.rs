//! 云端 TTS 的**桌面壳薄层**：实现已搬到 `aicut_daemon::cloud_tts`。
//!
//! 为什么搬：云端 TTS 只依赖 HTTP 客户端、配置文件和 ffmpeg 探测，和 Tauri 无关。
//! 搬进 daemon 之后，浏览器 / 容器版本也能用同一套云端朗读——能力表里 `cloud_tts`
//! 才能名正言顺地是 `ok`。桌面壳只保留 `#[tauri::command]` 转发与类型 re-export。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::cloud_tts::{
    CloudTtsConfig, CloudTtsProvider, CloudTtsRuntime, CloudTtsTest,
};

#[tauri::command]
pub fn cloud_tts_config(state: State<'_, Arc<CloudTtsRuntime>>) -> CloudTtsConfig {
    aicut_daemon::cloud_tts::cloud_tts_config(state.inner())
}

#[tauri::command]
pub fn cloud_tts_set_config(
    state: State<'_, Arc<CloudTtsRuntime>>,
    providers: Vec<CloudTtsProvider>,
) -> CloudTtsConfig {
    aicut_daemon::cloud_tts::cloud_tts_set_config(state.inner(), providers)
}

#[tauri::command]
pub async fn cloud_tts_voices(
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudTtsProvider,
) -> Result<Vec<aicut_daemon::tts_core::TtsVoice>, String> {
    aicut_daemon::cloud_tts::cloud_tts_voices(network.inner(), provider).await
}

#[tauri::command]
pub async fn cloud_tts_test(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudTtsProvider,
    text: String,
) -> Result<CloudTtsTest, String> {
    let host = TauriHost::new(app);
    aicut_daemon::cloud_tts::cloud_tts_test(&host, network.inner(), provider, text).await
}

#[tauri::command]
pub async fn cloud_tts_synthesize(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudTtsRuntime>>,
    provider_id: String,
    items: Vec<aicut_daemon::tts_core::TtsItem>,
    voice: Option<String>,
) -> Result<Vec<aicut_daemon::tts_core::TtsAudio>, String> {
    let host = TauriHost::new(app);
    aicut_daemon::cloud_tts::cloud_tts_synthesize(
        &host,
        network.inner(),
        state.inner(),
        provider_id,
        items,
        voice,
    )
    .await
}
