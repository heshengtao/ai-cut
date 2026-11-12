//! 网络设置：直连 / 系统代理 / 手动代理。
//!
//! 配置落在应用配置目录的 `network.json`；剪辑智能体的 HTTP 客户端从这里取代理。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::backend::BackendPreference;
use crate::sdcpp::SdcppBackend;

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
    /// Hugging Face 的 **read token**（`hf_…`）。留空 = 匿名下载。
    ///
    /// 只用于两件事：访问需要先「同意许可」的 gated 仓库（否则一律 403 `GatedRepo`），
    /// 以及给自己账号的限流配额。**只发给 `huggingface.co` 官方域**——用户自填的镜像 /
    /// 代理前缀拿不到它。明文存在本机配置里，不进日志、不进错误消息。
    pub hf_token: String,
    /// 本地 AI 执行后端偏好（ONNX Runtime）。
    pub backend_preference: BackendPreference,
    /// 视频生成执行后端偏好（stable-diffusion.cpp / ggml）。
    pub sdcpp_backend: SdcppBackend,
    /// OFX 注册表 URL（留空 = 用内置官方 raw 地址）。
    pub plugin_registry_url: String,
    /// OFX 注册表镜像（按顺序在官方源之前尝试）。
    pub plugin_registry_mirrors: Vec<String>,
}

/// 这个地址是不是 `huggingface.co` 官方域（决定要不要附 token）。
///
/// 用户自填的镜像 / 代理前缀一律不算：凭据只交给官方。
pub fn hf_request_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    host.eq_ignore_ascii_case("huggingface.co") || host.eq_ignore_ascii_case("www.huggingface.co")
}

/// 从 HF 的下载地址里取出 `namespace/repo`（gated 提示要打开对应仓库页）。
pub fn hf_repo_of(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let (host, path) = rest.split_once('/')?;
    if !host.eq_ignore_ascii_case("huggingface.co") && !host.eq_ignore_ascii_case("www.huggingface.co")
    {
        return None;
    }
    let path = path.strip_prefix("models/").unwrap_or(path);
    let mut parts = path.split('/');
    let ns = parts.next()?;
    let repo = parts.next()?;
    // `https://huggingface.co/<ns>/resolve/...` 这种缺少仓库名的地址要挡掉。
    if ns.is_empty() || repo.is_empty() || repo == "resolve" {
        return None;
    }
    Some(format!("{ns}/{repo}"))
}

/// `403` + `X-Error-Code: GatedRepo` 才是「要授权」；普通 403 仍然算永久失败。
pub fn is_gated(status: u16, error_code: Option<&str>) -> bool {
    // 直连 HF 回 **401**；镜像、或「带 token 但不在授权名单」回 403。两种都要认。
    // 实测：`curl https://huggingface.co/Lightricks/LTX-2.5/resolve/...` → 401 + GatedRepo。
    matches!(status, 401 | 403)
        && error_code.is_some_and(|code| code.eq_ignore_ascii_case("GatedRepo"))
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            proxy_mode: ProxyMode::System,
            proxy_url: String::new(),
            model_mirrors: Vec::new(),
            download_prefix: String::new(),
            model_source_preference: ModelSourcePreference::Auto,
            hf_token: String::new(),
            backend_preference: BackendPreference::Cpu,
            sdcpp_backend: SdcppBackend::Auto,
            plugin_registry_url: String::new(),
            plugin_registry_mirrors: Vec::new(),
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

/// OFX 注册表源配置（设置页用）。
#[derive(Debug, Clone, Serialize)]
pub struct PluginRegistryConfig {
    pub url: String,
    pub mirrors: Vec<String>,
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

    fn resolve_proxy(mode: ProxyMode, url: &str) -> ResolvedProxy {
        match mode {
            ProxyMode::Direct => ResolvedProxy {
                url: None,
                bypass: None,
                auto: false,
                source: "直连（不使用代理）".into(),
            },
            ProxyMode::Manual => match normalize_proxy_url(url) {
                Some(url) => ResolvedProxy {
                    source: format!("手动代理 {url}"),
                    url: Some(url),
                    bypass: None,
                    auto: false,
                },
                None => ResolvedProxy {
                    url: None,
                    bypass: None,
                    auto: false,
                    source: "手动代理未填写或无效，回退直连".into(),
                },
            },
            ProxyMode::System => match system_proxy_state() {
                SystemProxyState::Proxy(proxy) => ResolvedProxy {
                    url: Some(proxy.url),
                    bypass: proxy.bypass,
                    auto: false,
                    source: proxy.source,
                },
                // 只有 PAC 时没法解析成固定地址，明确直连而不是假装跟随。
                SystemProxyState::Unsupported(source) => ResolvedProxy {
                    url: None,
                    bypass: None,
                    auto: false,
                    source,
                },
                // 交给 reqwest 的平台实现再兜一次（环境变量 / 注册表 / SystemConfiguration）。
                SystemProxyState::None => ResolvedProxy {
                    url: None,
                    bypass: None,
                    auto: true,
                    source: "系统代理（未检测到代理设置）".into(),
                },
            },
        }
    }

    pub fn client_builder(&self) -> reqwest::ClientBuilder {
        let config = self.get();
        let route = Self::resolve_proxy(config.proxy_mode, &config.proxy_url);
        let builder = reqwest::Client::builder()
            // 部分模型 CDN（尤其中间跳转页）会拒绝默认的 reqwest UA。
            .user_agent("AI Cut/0.1")
            .connect_timeout(std::time::Duration::from_secs(15));
        match route.url {
            Some(url) => match reqwest::Proxy::all(&url) {
                Ok(proxy) => builder.proxy(apply_bypass(proxy, route.bypass.as_deref())),
                Err(error) => {
                    eprintln!("[network] 代理地址无效（{url}）：{error}");
                    builder.no_proxy()
                }
            },
            // 系统模式且没读到设置：不要 no_proxy，让 reqwest 自己探测。
            None if route.auto => builder,
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
        let route = Self::resolve_proxy(config.proxy_mode, &config.proxy_url);
        ProxyStatus {
            mode: config.proxy_mode,
            url: route.url,
            source: route.source,
        }
    }

    /// 用给定设置实际发一次请求（不写盘）。
    pub async fn probe(&self, mode: ProxyMode, url: &str) -> ProxyProbe {
        let started = Instant::now();
        let route = Self::resolve_proxy(mode, url);
        let builder = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(8));
        let builder = match route.url {
            Some(url) => match reqwest::Proxy::all(&url) {
                Ok(proxy) => builder.proxy(apply_bypass(proxy, route.bypass.as_deref())),
                Err(error) => {
                    return ProxyProbe {
                        ok: false,
                        detail: format!("代理地址无效：{error}"),
                        ms: started.elapsed().as_millis() as u64,
                    }
                }
            },
            None if route.auto => builder,
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
                detail: format!("{}（{}）", route.source, response.status()),
                ms,
            },
            Err(error) => ProxyProbe {
                ok: false,
                detail: format!("{}：{error}", route.source),
                ms,
            },
        }
    }
}

/// 从系统里读到的代理设置。
struct SystemProxy {
    /// 归一化后的代理地址（带 scheme）。
    url: String,
    /// 绕过代理的地址列表（逗号分隔），来自 NO_PROXY / ProxyOverride / 系统例外列表。
    bypass: Option<String>,
    /// 设置页展示的来源说明。
    source: String,
}

/// 系统代理探测结果。
enum SystemProxyState {
    /// 读到了可以直接使用的代理。
    Proxy(SystemProxy),
    /// 系统里只配了 PAC 自动配置脚本，无法解析成固定代理地址。
    Unsupported(String),
    /// 系统没有配置代理。
    None,
}

/// 一次请求实际要走的代理走向。
struct ResolvedProxy {
    /// 要显式注入的代理地址；`None` 表示不注入。
    url: Option<String>,
    /// 显式代理的绕过列表。
    bypass: Option<String>,
    /// 为真时把代理探测交给 reqwest（系统模式且我们自己没读到设置）。
    auto: bool,
    /// 设置页展示的「当前实际走」。
    source: String,
}

/// 给显式代理挂上绕过列表：NO_PROXY 环境变量与系统绕过列表同时生效。
fn apply_bypass(proxy: reqwest::Proxy, system_bypass: Option<&str>) -> reqwest::Proxy {
    match bypass_entries(system_bypass).and_then(|list| reqwest::NoProxy::from_string(&list)) {
        Some(list) => proxy.no_proxy(Some(list)),
        None => proxy,
    }
}

fn bypass_entries(system_bypass: Option<&str>) -> Option<String> {
    let mut lists: Vec<String> = Vec::new();
    if let Some(list) = env_no_proxy() {
        lists.push(list);
    }
    if let Some(list) = system_bypass.and_then(normalize_bypass) {
        lists.push(list);
    }
    if lists.is_empty() {
        None
    } else {
        Some(lists.join(","))
    }
}

/// 归一化代理地址：缺 scheme 时补 `http://`，并校验 scheme。
fn normalize_proxy_url(raw: &str) -> Option<String> {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return None;
    }
    if !text.contains("://") {
        text = format!("http://{text}");
    }
    let scheme = text
        .split("://")
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        scheme.as_str(),
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h"
    ) {
        return None;
    }
    while text.ends_with('/') {
        text.pop();
    }
    Some(text)
}

/// 归一化绕过列表：Windows 用 `;`、环境变量用 `,`，这里都接受。
/// 去掉 `<local>` 这类无法匹配的条目，把 `*.example.com` / `192.168.*` 转成 reqwest 能匹配的写法。
fn normalize_bypass(value: &str) -> Option<String> {
    let entries: Vec<String> = value
        .split([';', ','])
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && !entry.eq_ignore_ascii_case("<local>"))
        .map(normalize_bypass_entry)
        .collect();
    if entries.is_empty() {
        None
    } else {
        Some(entries.join(","))
    }
}

fn normalize_bypass_entry(entry: &str) -> String {
    if let Some(cidr) = wildcard_ipv4_to_cidr(entry) {
        return cidr;
    }
    if entry == "*" {
        return entry.to_string();
    }
    // Windows 允许 `*.example.com` / `*example.com`：都按域名后缀匹配。
    if let Some(rest) = entry.strip_prefix('*') {
        let rest = rest.trim_start_matches('.');
        if !rest.is_empty() {
            return format!(".{rest}");
        }
    }
    entry.to_string()
}

/// `192.168.*` / `10.*.*.*` 这类 Windows 通配写法 → CIDR。
fn wildcard_ipv4_to_cidr(entry: &str) -> Option<String> {
    let parts: Vec<&str> = entry.split('.').collect();
    let wildcard = parts.iter().position(|part| *part == "*")?;
    if wildcard == 0 || wildcard > 3 || parts[wildcard..].iter().any(|part| *part != "*") {
        return None;
    }
    let mut octets = [0u8; 4];
    for (index, part) in parts[..wildcard].iter().enumerate() {
        octets[index] = part.parse().ok()?;
    }
    Some(format!(
        "{}.{}.{}.{}/{}",
        octets[0],
        octets[1],
        octets[2],
        octets[3],
        wildcard * 8
    ))
}

fn system_proxy_state() -> SystemProxyState {
    env_proxy()
        .map(SystemProxyState::Proxy)
        .unwrap_or_else(os_proxy_state)
}

/// 环境变量优先（和 reqwest 的探测顺序一致）。
fn env_proxy() -> Option<SystemProxy> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        let Some(url) = normalize_proxy_url(&value) else {
            continue;
        };
        return Some(SystemProxy {
            source: format!("系统代理（环境变量 {key}）{url}"),
            // NO_PROXY 在 apply_bypass 里统一合并，这里不重复。
            bypass: None,
            url,
        });
    }
    None
}

fn env_no_proxy() -> Option<String> {
    for key in ["NO_PROXY", "no_proxy"] {
        if let Ok(value) = std::env::var(key) {
            if let Some(list) = normalize_bypass(&value) {
                return Some(list);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn os_proxy_state() -> SystemProxyState {
    const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    let Ok(settings) = windows_registry::CURRENT_USER.open(INTERNET_SETTINGS) else {
        return SystemProxyState::None;
    };
    let enabled = settings.get_u32("ProxyEnable").unwrap_or(0) == 1;
    if enabled {
        let server = settings.get_string("ProxyServer").unwrap_or_default();
        if let Some((url, per_scheme)) = parse_proxy_server(&server) {
            let source = if per_scheme {
                format!("系统代理（Windows 分协议设置）{url}")
            } else {
                format!("系统代理（Windows）{url}")
            };
            let bypass = settings
                .get_string("ProxyOverride")
                .ok()
                .and_then(|value| normalize_bypass(&value));
            return SystemProxyState::Proxy(SystemProxy {
                url,
                bypass,
                source,
            });
        }
    }
    // PAC 脚本需要执行 JS，reqwest 无法跟随；明确提示，避免误以为走了代理。
    let pac = settings.get_string("AutoConfigURL").unwrap_or_default();
    if !pac.trim().is_empty() {
        return SystemProxyState::Unsupported(format!(
            "系统代理（PAC 自动配置暂不支持，当前直连）：{}",
            pac.trim()
        ));
    }
    SystemProxyState::None
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn os_proxy_state() -> SystemProxyState {
    SystemProxyState::None
}

/// 解析 Windows `ProxyServer` 注册表值，返回 (代理地址, 是否分协议)。
///
/// 支持 `host:port`（通用于 http/https）和
/// `http=host:port;https=host:port;socks=host:port` 两种写法。
#[cfg(any(target_os = "windows", test))]
fn parse_proxy_server(value: &str) -> Option<(String, bool)> {
    let mut simple: Option<String> = None;
    let mut http: Option<String> = None;
    let mut https: Option<String> = None;
    let mut socks: Option<String> = None;
    for part in value.trim().split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        match part.split_once('=') {
            Some((scheme, address)) => {
                let address = address.trim();
                if address.is_empty() {
                    continue;
                }
                match scheme.trim().to_ascii_lowercase().as_str() {
                    "http" => http = Some(address.to_string()),
                    "https" => https = Some(address.to_string()),
                    "socks" | "socks4" | "socks5" => socks = Some(address.to_string()),
                    _ => {}
                }
            }
            None => simple = Some(part.to_string()),
        }
    }
    // 分协议写法优先 https → http → socks；简单写法按 http 代理处理。
    if let Some(address) = https {
        return normalize_proxy_url(&address).map(|url| (url, true));
    }
    if let Some(address) = http {
        return normalize_proxy_url(&address).map(|url| (url, true));
    }
    if let Some(address) = socks {
        let address = if address.contains("://") {
            address
        } else {
            format!("socks5://{address}")
        };
        return normalize_proxy_url(&address).map(|url| (url, true));
    }
    let address = simple?;
    normalize_proxy_url(&address).map(|url| (url, false))
}

#[cfg(target_os = "macos")]
fn os_proxy_state() -> SystemProxyState {
    let Ok(output) = std::process::Command::new("scutil").arg("--proxy").output() else {
        return SystemProxyState::None;
    };
    if !output.status.success() {
        return SystemProxyState::None;
    }
    macos_proxy_from_scutil(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
struct ScutilProxy {
    http_enabled: bool,
    http_host: String,
    http_port: String,
    https_enabled: bool,
    https_host: String,
    https_port: String,
    socks_enabled: bool,
    socks_host: String,
    socks_port: String,
    pac_enabled: bool,
    pac_url: String,
    exceptions: Vec<String>,
}

#[cfg(any(target_os = "macos", test))]
fn parse_scutil_proxy(text: &str) -> ScutilProxy {
    let mut parsed = ScutilProxy::default();
    let mut in_exceptions = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if in_exceptions {
            if line == "}" {
                in_exceptions = false;
                continue;
            }
            if let Some((_, value)) = line.split_once(':') {
                let value = value.trim();
                if !value.is_empty() {
                    parsed.exceptions.push(value.to_string());
                }
            }
            continue;
        }
        if line.starts_with("ExceptionsList") {
            in_exceptions = true;
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "HTTPEnable" => parsed.http_enabled = value == "1",
            "HTTPProxy" => parsed.http_host = value.to_string(),
            "HTTPPort" => parsed.http_port = value.to_string(),
            "HTTPSEnable" => parsed.https_enabled = value == "1",
            "HTTPSProxy" => parsed.https_host = value.to_string(),
            "HTTPSPort" => parsed.https_port = value.to_string(),
            "SOCKSEnable" => parsed.socks_enabled = value == "1",
            "SOCKSProxy" => parsed.socks_host = value.to_string(),
            "SOCKSPort" => parsed.socks_port = value.to_string(),
            "ProxyAutoConfigEnable" => parsed.pac_enabled = value == "1",
            "ProxyAutoConfigURLString" => parsed.pac_url = value.to_string(),
            _ => {}
        }
    }
    parsed
}

#[cfg(any(target_os = "macos", test))]
fn macos_proxy_from_scutil(text: &str) -> SystemProxyState {
    let parsed = parse_scutil_proxy(text);
    let endpoint = |host: &str, port: &str| -> Option<String> {
        let host = host.trim();
        if host.is_empty() {
            return None;
        }
        let port = port.trim();
        Some(if port.is_empty() {
            host.to_string()
        } else {
            format!("{host}:{port}")
        })
    };
    let candidate = if parsed.https_enabled {
        endpoint(&parsed.https_host, &parsed.https_port).map(|address| ("http", "HTTPS", address))
    } else if parsed.http_enabled {
        endpoint(&parsed.http_host, &parsed.http_port).map(|address| ("http", "HTTP", address))
    } else if parsed.socks_enabled {
        endpoint(&parsed.socks_host, &parsed.socks_port).map(|address| ("socks5", "SOCKS", address))
    } else {
        None
    };
    let Some((scheme, label, address)) = candidate else {
        if parsed.pac_enabled {
            let suffix = if parsed.pac_url.trim().is_empty() {
                String::new()
            } else {
                format!("：{}", parsed.pac_url.trim())
            };
            return SystemProxyState::Unsupported(format!(
                "系统代理（PAC 自动配置暂不支持，当前直连）{suffix}"
            ));
        }
        return SystemProxyState::None;
    };
    let Some(url) = normalize_proxy_url(&format!("{scheme}://{address}")) else {
        return SystemProxyState::None;
    };
    let bypass = normalize_bypass(&parsed.exceptions.join(","));
    SystemProxyState::Proxy(SystemProxy {
        source: format!("系统代理（macOS {label}）{url}"),
        url,
        bypass,
    })
}

#[tauri::command]
pub fn network_config(state: tauri::State<'_, Arc<NetworkRuntime>>) -> NetworkConfig {
    // 不把 token 回传给界面：设置页只需要知道「有没有配」，用 `model_hf_token_status`
    // 看掩码就够了。回传只会给凭据多一条外泄路径（错误提示、日志、崩溃报告都从这条
    // 数据流上走）。
    let mut config = state.get();
    config.hf_token = String::new();
    config
}

/// Hugging Face token 的配置状态（设置页 / 下载弹窗用；**不回传 token 本身**）。
#[derive(Debug, Clone, Serialize)]
pub struct HfTokenStatus {
    pub set: bool,
    /// 掩码提示，例如 `hf_…3f9a`；未配置时为空串。
    pub hint: String,
}

#[tauri::command]
pub fn model_hf_token_status(state: tauri::State<'_, Arc<NetworkRuntime>>) -> HfTokenStatus {
    let token = state.get().hf_token;
    if token.is_empty() {
        return HfTokenStatus {
            set: false,
            hint: String::new(),
        };
    }
    let tail: String = token.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    HfTokenStatus {
        set: true,
        hint: format!("hf_…{tail}"),
    }
}

/// 保存 / 清除 Hugging Face read token（传空串 = 清除）。
///
/// 单独成一个命令而不是塞进 `network_set_config`：授权弹窗要在下载流程中间立刻写入
/// 并重试，不该逼前端把整份网络配置回传一遍。
#[tauri::command]
pub fn model_save_hf_token(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    token: String,
) -> Result<(), String> {
    let token = token.trim().to_string();
    if !token.is_empty() && !token.starts_with("hf_") {
        return Err("Hugging Face token 应以 hf_ 开头".into());
    }
    let current = state.get();
    state.set(NetworkConfig {
        hf_token: token,
        ..current
    });
    Ok(())
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
pub fn plugin_registry_config(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
) -> PluginRegistryConfig {
    let config = state.get();
    PluginRegistryConfig {
        url: config.plugin_registry_url,
        mirrors: config.plugin_registry_mirrors,
    }
}

#[tauri::command]
pub fn plugin_set_registry_config(
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    url: String,
    mirrors: Vec<String>,
) -> PluginRegistryConfig {
    let current = state.get();
    let next = NetworkConfig {
        plugin_registry_url: url.trim().to_string(),
        plugin_registry_mirrors: mirrors
            .into_iter()
            .map(|mirror| mirror.trim().to_string())
            .filter(|mirror| !mirror.is_empty())
            .collect(),
        ..current
    };
    state.set(next.clone());
    PluginRegistryConfig {
        url: next.plugin_registry_url,
        mirrors: next.plugin_registry_mirrors,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 老配置文件里没有 `hf_token` 字段：必须照常加载，不能整份退回默认值
    /// （那会悄悄清空用户的代理与镜像设置）。
    #[test]
    fn old_network_json_without_hf_token_still_loads() {
        let old = r#"{
            "proxy_mode": "manual",
            "proxy_url": "socks5://127.0.0.1:7892",
            "model_mirrors": ["https://model-mirror.example/"],
            "download_prefix": "https://proxy.example/",
            "model_source_preference": "domestic",
            "backend_preference": "cpu",
            "sdcpp_backend": "metal",
            "plugin_registry_url": "",
            "plugin_registry_mirrors": []
        }"#;
        let config: NetworkConfig = serde_json::from_str(old).expect("旧配置应能反序列化");
        assert!(config.hf_token.is_empty(), "缺字段时按匿名下载");
        assert_eq!(config.proxy_url, "socks5://127.0.0.1:7892");
        assert_eq!(config.model_mirrors, vec!["https://model-mirror.example/".to_string()]);
        assert_eq!(config.download_prefix, "https://proxy.example/");
    }

    /// 只有 `huggingface.co` 官方域才算「该带 token」。
    #[test]
    fn hf_host_is_official_only() {
        assert!(hf_request_host(
            "https://huggingface.co/Lightricks/LTX-2.5/resolve/abc/vae.ckpt"
        ));
        for url in [
            "https://hf-mirror.com/x/y/resolve/abc/z",
            "https://mirror.example/https://huggingface.co/x/y/resolve/abc/z",
            "https://modelscope.cn/models/x/y/resolve/abc/z",
            "https://huggingface.co.evil.tld/x/y/resolve/abc/z",
            "http://huggingface.co/x/y",
        ] {
            assert!(!hf_request_host(url), "{url}");
        }
    }

    /// 授权提示要打开的是**仓库页**，不是文件地址。
    #[test]
    fn gated_repo_is_read_from_the_download_url() {
        assert_eq!(
            hf_repo_of("https://huggingface.co/Lightricks/LTX-2.5/resolve/49b093a3/vae/x.ckpt")
                .as_deref(),
            Some("Lightricks/LTX-2.5")
        );
        assert_eq!(
            hf_repo_of("https://huggingface.co/models/org/repo/resolve/abc/file").as_deref(),
            Some("org/repo")
        );
        assert_eq!(hf_repo_of("https://modelscope.cn/models/x/y/resolve/abc/z"), None);
        assert_eq!(hf_repo_of("https://huggingface.co/onlyone/resolve/abc/z"), None);
    }

    /// gated 只认 `403 + X-Error-Code: GatedRepo`；别的 403 仍按永久失败处理。
    #[test]
    fn only_the_gated_error_code_asks_for_auth() {
        assert!(is_gated(401, Some("GatedRepo")));
        assert!(is_gated(403, Some("GatedRepo")));
        assert!(is_gated(403, Some("gatedrepo")));
        assert!(!is_gated(403, None));
        assert!(!is_gated(401, None));
        assert!(!is_gated(403, Some("RepoNotFound")));
        assert!(!is_gated(404, Some("GatedRepo")));
    }
    use super::*;

    #[test]
    fn proxy_urls_are_normalized() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            normalize_proxy_url(" http://127.0.0.1:7890/ ").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            normalize_proxy_url("socks5://127.0.0.1:1080").as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
        assert_eq!(normalize_proxy_url("   "), None);
        assert_eq!(normalize_proxy_url("ftp://127.0.0.1:21"), None);
    }

    #[test]
    fn bypass_lists_are_normalized() {
        assert_eq!(
            normalize_bypass("localhost; 127.*;192.168.*;*.example.com;*zhihu.com;<local>")
                .as_deref(),
            Some("localhost,127.0.0.0/8,192.168.0.0/16,.example.com,.zhihu.com")
        );
        assert_eq!(
            normalize_bypass("172.16.*;172.17.*").as_deref(),
            Some("172.16.0.0/16,172.17.0.0/16")
        );
        assert_eq!(normalize_bypass("*").as_deref(), Some("*"));
        assert_eq!(normalize_bypass("<local>").as_deref(), None);
        assert_eq!(normalize_bypass("   ").as_deref(), None);
    }

    #[test]
    fn windows_proxy_server_is_parsed() {
        // 简单写法：同时用于 http / https。
        assert_eq!(
            parse_proxy_server("127.0.0.1:7890"),
            Some(("http://127.0.0.1:7890".to_string(), false))
        );
        // 分协议写法：优先 https。
        assert_eq!(
            parse_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7891"),
            Some(("http://127.0.0.1:7891".to_string(), true))
        );
        assert_eq!(
            parse_proxy_server("http=127.0.0.1:7890"),
            Some(("http://127.0.0.1:7890".to_string(), true))
        );
        // socks 写法补 socks5://。
        assert_eq!(
            parse_proxy_server("socks=127.0.0.1:1080"),
            Some(("socks5://127.0.0.1:1080".to_string(), true))
        );
        assert_eq!(parse_proxy_server(""), None);
        assert_eq!(parse_proxy_server("ftp=127.0.0.1:21"), None);
    }

    #[test]
    fn scutil_proxy_output_is_parsed() {
        let text = r#"<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 0
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : 127.0.0.1
}"#;
        match macos_proxy_from_scutil(text) {
            SystemProxyState::Proxy(proxy) => {
                assert_eq!(proxy.url, "http://127.0.0.1:7890");
                assert_eq!(proxy.bypass.as_deref(), Some(".local,169.254/16"));
            }
            _ => panic!("应解析出系统代理"),
        }
    }

    #[test]
    fn pac_only_is_reported_as_unsupported() {
        let text = "<dictionary> {\n  ProxyAutoConfigEnable : 1\n  ProxyAutoConfigURLString : http://wpad/wpad.dat\n}";
        match macos_proxy_from_scutil(text) {
            SystemProxyState::Unsupported(source) => assert!(source.contains("wpad.dat")),
            _ => panic!("只有 PAC 时应提示不支持"),
        }
    }

    #[test]
    fn direct_and_manual_modes_resolve_without_system_lookup() {
        let direct = NetworkRuntime::resolve_proxy(ProxyMode::Direct, "");
        assert!(direct.url.is_none() && !direct.auto);

        let manual = NetworkRuntime::resolve_proxy(ProxyMode::Manual, "127.0.0.1:7890");
        assert_eq!(manual.url.as_deref(), Some("http://127.0.0.1:7890"));
        assert!(!manual.auto);

        // 手动模式留空 → 直连，而不是悄悄回落到系统代理。
        let empty = NetworkRuntime::resolve_proxy(ProxyMode::Manual, "  ");
        assert!(empty.url.is_none() && !empty.auto);
    }

    #[test]
    #[ignore = "手动：依赖真实系统代理"]
    fn prints_real_system_proxy() {
        let runtime = NetworkRuntime::load(None);
        let status = runtime.status();
        println!(
            "status: mode={:?} url={:?} source={}",
            status.mode, status.url, status.source
        );
        let client = runtime.client().expect("client");
        let response = tauri::async_runtime::block_on(async move {
            client
                .get("https://example.com")
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
        });
        println!("request: {response:?}");
        assert!(response.is_ok(), "系统代理下请求应成功");
    }
}
