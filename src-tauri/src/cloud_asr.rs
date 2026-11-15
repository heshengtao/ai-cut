//! 云端 ASR 的**桌面壳薄层**：实现已放在 `aicut_daemon::cloud_asr`。
//!
//! 与 `cloud_tts.rs` 同构：这里只做参数透传，配置/切段/协议全在 daemon 里，
//! 浏览器与容器版本用的是同一份实现。

use std::sync::Arc;

use aicut_daemon::network::NetworkRuntime;
use tauri::State;

pub use aicut_daemon::cloud_asr::{CloudAsrConfig, CloudAsrProvider, CloudAsrRuntime, CloudAsrTest};

#[tauri::command]
pub fn cloud_asr_config(state: State<'_, Arc<CloudAsrRuntime>>) -> CloudAsrConfig {
    aicut_daemon::cloud_asr::cloud_asr_config(state.inner())
}

#[tauri::command]
pub fn cloud_asr_set_config(
    state: State<'_, Arc<CloudAsrRuntime>>,
    providers: Vec<CloudAsrProvider>,
) -> CloudAsrConfig {
    aicut_daemon::cloud_asr::cloud_asr_set_config(state.inner(), providers)
}

#[tauri::command]
pub async fn cloud_asr_test(
    app: tauri::AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudAsrProvider,
    path: String,
) -> Result<CloudAsrTest, String> {
    let host = crate::host::TauriHost::new(app);
    aicut_daemon::cloud_asr::cloud_asr_test(&host, network.inner(), &provider, &path).await
}
