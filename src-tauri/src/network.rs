//! 网络设置：直连 / 系统代理 / 手动代理。
//!
//! 配置落在应用配置目录的 `network.json`；剪辑智能体的 HTTP 客户端从这里取代理。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    Direct,
    System,
    Manual,
}

impl Default for ProxyMode {
    fn default() -> Self {
        Self::System
    }
}

/// 模型下载源的区域偏好：决定先试国外源（HF / GitHub）还是国内源（魔搭）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelSourcePreference {
    /// 自动探测国内外源的首字节延迟，谁更快就先用谁，失败自动回退另一区域。
    #[default]
    Auto,
    /// 优先国外源（HF / GitHub）。
    International,
    /// 优先国内源（魔搭）。
    Domestic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkConfig {
    pub proxy_mode: ProxyMode,
    pub proxy_url: String,
    /// 模型权重镜像 / 前置代理前缀（留空 = 只用清单里的官方源）。
    pub model_mirrors: Vec<String>,
    /// GitHub 下载代理前缀（只重写 GitHub 地址；留空 = 直连）。
    pub download_prefix: String,
    /// 模型下载源区域偏好。
    pub model_source_preference: ModelSourcePreference,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            proxy_mode: ProxyMode::System,
            proxy_url: String::new(),
            model_mirrors: Vec::new(),
            download_prefix: String::new(),
            model_source_preference: ModelSourcePreference::Auto,
        }
    }
}

/// 模型下载源配置（给设置页 / 下载管理器用）。
#[derive(Debug, Clone, Serialize)]
pub struct ModelSourceConfig {
    pub preference: ModelSourcePreference,
    pub mirrors: Vec<String>,
    pub download_prefix: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyStatus {
    pub mode: ProxyMode,
    pub url: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyProbe {
    pub ok: bool,
    pub detail: String,
    pub ms: u64,
}

pub struct NetworkRuntime {
    inner: Mutex<NetworkConfig>,
    path: Option<PathBuf>,
}

impl NetworkRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        let config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<NetworkConfig>(&text).ok())
            .unwrap_or_default();
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> NetworkConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: NetworkConfig) -> NetworkConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    fn save(&self, config: &NetworkConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[network] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[network] 序列化配置失败：{error}"),
        }
    }

    fn resolved_proxy(&self, mode: ProxyMode, url: &str) -> (Option<String>, String) {
        match mode {
            ProxyMode::Direct => (None, "直连（不使用代理）".into()),
            ProxyMode::Manual => {
                if url.trim().is_empty() {
                    (None, "手动代理未填写，回退直连".into())
                } else {
                    (
                        Some(url.trim().to_string()),
                        format!("手动代理 {}", url.trim()),
                    )
                }
            }
            ProxyMode::System => {
                if let Some(url) = env_proxy() {
                    return (Some(url.clone()), format!("系统代理（环境变量）{url}"));
                }
                #[cfg(target_os = "macos")]
                if let Some(url) = macos_system_proxy() {
                    return (Some(url.clone()), format!("系统代理（macOS）{url}"));
                }
                (None, "系统代理（未检测到）".into())
            }
        }
    }

    pub fn client_builder(&self) -> reqwest::ClientBuilder {
        let config = self.get();
        let (proxy, _) = self.resolved_proxy(config.proxy_mode, &config.proxy_url);
        let builder = reqwest::Client::builder()
            // 部分模型 CDN（尤其中间跳转页）会拒绝默认的 reqwest UA。
            .user_agent("AI Cut/0.1")
            .connect_timeout(std::time::Duration::from_secs(15));
        match proxy {
            Some(url) => match reqwest::Proxy::all(&url) {
                Ok(proxy) => builder.proxy(proxy),
                Err(error) => {
                    eprintln!("[network] 代理地址无效（{url}）：{error}");
                    builder.no_proxy()
                }
            },
            None => builder.no_proxy(),
        }
    }

    pub fn client(&self) -> Result<reqwest::Client, String> {
        self.client_builder()
            .build()
            .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
    }

    pub fn status(&self) -> ProxyStatus {
        let config = self.get();
        let (url, source) = self.resolved_proxy(config.proxy_mode, &config.proxy_url);
        ProxyStatus {
            mode: config.proxy_mode,
            url,
            source,
        }
    }

    /// 用给定设置实际发一次请求（不写盘）。
    pub async fn probe(&self, mode: ProxyMode, url: &str) -> ProxyProbe {
        let started = Instant::now();
        let (proxy, source) = self.resolved_proxy(mode, url);
        let builder = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(8));
        let builder = match proxy {
            Some(url) => match reqwest::Proxy::all(&url) {
                Ok(proxy) => builder.proxy(proxy),
                Err(error) => {
                    return ProxyProbe {
                        ok: false,
                        detail: format!("代理地址无效：{error}"),
                        ms: started.elapsed().as_millis() as u64,
                    }
                }
            },
            None => builder.no_proxy(),
        };
        let client = match builder.build() {
            Ok(client) => client,
            Err(error) => {
                return ProxyProbe {
                    ok: false,
                    detail: format!("创建客户端失败：{error}"),
                    ms: started.elapsed().as_millis() as u64,
                }
            }
        };
        let result = client
            .get("https://example.com")
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
        let ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(response) => ProxyProbe {
                ok: true,
                detail: format!("{}（{}）", source, response.status()),
                ms,
            },
            Err(error) => ProxyProbe {
                ok: false,
                detail: format!("{source}：{error}"),
                ms,
            },
        }
    }
}

fn env_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn macos_system_proxy() -> Option<String> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut https_enabled = false;
    let mut https_host = String::new();
    let mut https_port = String::new();
    let mut http_enabled = false;
    let mut http_host = String::new();
    let mut http_port = String::new();
    let mut socks_enabled = false;
    let mut socks_host = String::new();
    let mut socks_port = String::new();
    for line in text.lines() {
        let mut parts = line.splitn(2, ':');
        let key = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        match key {
            "HTTPSEnable" => https_enabled = value == "1",
            "HTTPSProxy" => https_host = value.to_string(),
            "HTTPSPort" => https_port = value.to_string(),
            "HTTPEnable" => http_enabled = value == "1",
            "HTTPProxy" => http_host = value.to_string(),
            "HTTPPort" => http_port = value.to_string(),
            "SOCKSEnable" => socks_enabled = value == "1",
            "SOCKSProxy" => socks_host = value.to_string(),
            "SOCKSPort" => socks_port = value.to_string(),
            _ => {}
        }
    }
    if https_enabled && !https_host.is_empty() {
        return Some(format!("http://{https_host}:{https_port}"));
    }
    if http_enabled && !http_host.is_empty() {
        return Some(format!("http://{http_host}:{http_port}"));
    }
    if socks_enabled && !socks_host.is_empty() {
        return Some(format!("socks5://{socks_host}:{socks_port}"));
    }
    None
}

#[tauri::command]
pub fn network_config(state: tauri::State<'_, Arc<NetworkRuntime>>) -> NetworkConfig {
    state.get()
}

#[tauri::command]
pub fn network_set_config(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    proxy_mode: ProxyMode,
    proxy_url: String,
) -> NetworkConfig {
    let current = state.get();
    state.set(NetworkConfig {
        proxy_mode,
        proxy_url,
        ..current
    })
}

/// 读取模型下载源配置（区域偏好 + 自定义镜像）。
#[tauri::command]
pub fn model_source_config(state: tauri::State<'_, Arc<NetworkRuntime>>) -> ModelSourceConfig {
    let config = state.get();
    ModelSourceConfig {
        preference: config.model_source_preference,
        mirrors: config.model_mirrors,
        download_prefix: config.download_prefix,
    }
}

/// 保存模型下载源配置。
#[tauri::command]
pub fn model_set_source_config(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    preference: ModelSourcePreference,
    mirrors: Vec<String>,
    download_prefix: String,
) -> ModelSourceConfig {
    let current = state.get();
    let next = NetworkConfig {
        model_source_preference: preference,
        model_mirrors: mirrors
            .into_iter()
            .map(|mirror| mirror.trim().to_string())
            .filter(|mirror| !mirror.is_empty())
            .collect(),
        download_prefix: download_prefix.trim().to_string(),
        ..current
    };
    state.set(next.clone());
    ModelSourceConfig {
        preference: next.model_source_preference,
        mirrors: next.model_mirrors,
        download_prefix: next.download_prefix,
    }
}

#[tauri::command]
pub fn network_status(state: tauri::State<'_, Arc<NetworkRuntime>>) -> ProxyStatus {
    state.status()
}

#[tauri::command]
pub async fn network_probe(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    proxy_mode: ProxyMode,
    proxy_url: String,
) -> Result<ProxyProbe, String> {
    Ok(state.probe(proxy_mode, &proxy_url).await)
}
