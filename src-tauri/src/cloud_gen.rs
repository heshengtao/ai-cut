//! 云端出图 / 出视频的**桌面壳薄层**：实现已搬到 `aicut_daemon::cloud_gen`。
//!
//! 云端生成只依赖 HTTP + ffmpeg 探测 + 缓存目录，与 Tauri 无关；下沉之后浏览器 /
//! 容器版本也能用同一套供应商配置与生成流程（能力表 `cloud_gen` = `ok`）。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::cloud_gen::{
    CloudGenConfig, CloudGenPreset, CloudGenProvider, CloudGenRuntime, CloudGenTest,
    CloudImageRequest, CloudImageResult, CloudVideoRequest, CloudVideoResult, EVENT_CLOUD_GEN,
};

#[tauri::command]
pub fn cloud_gen_presets() -> Vec<CloudGenPreset> {
    aicut_daemon::cloud_gen::cloud_gen_presets()
}

#[tauri::command]
pub fn cloud_gen_config(state: State<'_, Arc<CloudGenRuntime>>) -> CloudGenConfig {
    aicut_daemon::cloud_gen::cloud_gen_config(state.inner())
}

#[tauri::command]
pub fn cloud_gen_set_config(
    state: State<'_, Arc<CloudGenRuntime>>,
    providers: Vec<CloudGenProvider>,
) -> CloudGenConfig {
    aicut_daemon::cloud_gen::cloud_gen_set_config(state.inner(), providers)
}

#[tauri::command]
pub fn cloud_gen_busy() -> bool {
    aicut_daemon::cloud_gen::cloud_gen_busy()
}

#[tauri::command]
pub fn cloud_gen_cancel() {
    aicut_daemon::cloud_gen::cloud_gen_cancel()
}

#[tauri::command]
pub async fn cloud_gen_image(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudGenRuntime>>,
    request: CloudImageRequest,
) -> Result<CloudImageResult, String> {
    let host = TauriHost::new(app);
    aicut_daemon::cloud_gen::cloud_gen_image(&host, network.inner(), state.inner(), request).await
}

#[tauri::command]
pub async fn cloud_gen_video(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudGenRuntime>>,
    request: CloudVideoRequest,
) -> Result<CloudVideoResult, String> {
    let host = TauriHost::new(app);
    aicut_daemon::cloud_gen::cloud_gen_video(&host, network.inner(), state.inner(), request).await
}

#[tauri::command]
pub async fn cloud_gen_test(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudGenProvider,
) -> Result<CloudGenTest, String> {
    let host = TauriHost::new(app);
    aicut_daemon::cloud_gen::cloud_gen_test(&host, network.inner(), provider).await
}
