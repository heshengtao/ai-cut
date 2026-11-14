//! 网络设置的**桌面壳薄层**：实现已经搬到 `aicut_daemon::network`（与无头 daemon 共用）。
//!
//! 这里只做三件事：
//! 1. 把共用类型 re-export 回来，既有的 `crate::network::NetworkConfig` 等路径不变；
//! 2. 提供 `#[tauri::command]` 薄壳，签名与参数名保持历史约定；
//! 3. 保留桌面独有的部分（如果有）。
//!
//! 为什么要搬：浏览器 / 容器版本此前有 10 条网络命令是"点了没反应"或"回显但不落盘"。
//! 配置读写本来就是纯 Rust + reqwest，两边共用同一份实现后，能力表里 `network` 才能名正言顺地是 `ok`。

use std::sync::Arc;

use tauri::State;

pub use aicut_daemon::network::{
    hf_repo_of, hf_request_host, is_gated, HfTokenStatus, ModelSourceConfig, ModelSourcePreference,
    NetworkConfig, NetworkRuntime, PluginRegistryConfig, ProxyMode, ProxyProbe, ProxyStatus,
};

#[tauri::command]
pub fn network_config(state: State<'_, Arc<NetworkRuntime>>) -> NetworkConfig {
    aicut_daemon::network::network_config(state.inner())
}

#[tauri::command]
pub fn model_hf_token_status(state: State<'_, Arc<NetworkRuntime>>) -> HfTokenStatus {
    aicut_daemon::network::model_hf_token_status(state.inner())
}

#[tauri::command]
pub fn model_save_hf_token(
    state: State<'_, Arc<NetworkRuntime>>,
    token: String,
) -> Result<(), String> {
    aicut_daemon::network::model_save_hf_token(state.inner(), token)
}

#[tauri::command]
pub fn network_set_config(
    state: State<'_, Arc<NetworkRuntime>>,
    proxy_mode: ProxyMode,
    proxy_url: String,
) -> NetworkConfig {
    aicut_daemon::network::network_set_config(state.inner(), proxy_mode, proxy_url)
}

#[tauri::command]
pub fn model_source_config(state: State<'_, Arc<NetworkRuntime>>) -> ModelSourceConfig {
    aicut_daemon::network::model_source_config(state.inner())
}

#[tauri::command]
pub fn model_set_source_config(
    state: State<'_, Arc<NetworkRuntime>>,
    preference: ModelSourcePreference,
    mirrors: Vec<String>,
    download_prefix: String,
) -> ModelSourceConfig {
    aicut_daemon::network::model_set_source_config(
        state.inner(),
        preference,
        mirrors,
        download_prefix,
    )
}

#[tauri::command]
pub fn plugin_registry_config(state: State<'_, Arc<NetworkRuntime>>) -> PluginRegistryConfig {
    aicut_daemon::network::plugin_registry_config(state.inner())
}

#[tauri::command]
pub fn plugin_set_registry_config(
    state: State<'_, Arc<NetworkRuntime>>,
    url: String,
    mirrors: Vec<String>,
) -> PluginRegistryConfig {
    aicut_daemon::network::plugin_set_registry_config(state.inner(), url, mirrors)
}

#[tauri::command]
pub fn network_status(state: State<'_, Arc<NetworkRuntime>>) -> ProxyStatus {
    aicut_daemon::network::network_status(state.inner())
}

#[tauri::command]
pub async fn network_probe(
    state: State<'_, Arc<NetworkRuntime>>,
    proxy_mode: ProxyMode,
    proxy_url: String,
) -> Result<ProxyProbe, String> {
    aicut_daemon::network::network_probe(state.inner(), proxy_mode, proxy_url).await
}
