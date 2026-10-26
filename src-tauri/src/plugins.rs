//! OFX 插件注册表、下载与安装管理。
//!
//! 这个模块**不加载** OFX 插件。它只负责：
//! - 从 GitHub raw / 缓存 / 内置快照读取注册表；
//! - 下载并校验作者声明的归档；
//! - 把 `.ofx.bundle` / `.ofx` 放进托管目录；
//! - 记录 manifest，并扫描标准 OFX 目录供界面展示。
//!
//! 真正的 OFX host 在后续阶段接入。

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::network::NetworkRuntime;

/// 插件安装进度事件名。
pub const EVENT_PLUGIN: &str = "plugin-progress";
/// 官方注册表（GitHub raw；不需要 GitHub Pages）。
pub const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/heshengtao/ai-cut-ofx-registry/main/registry.json";
/// 注册表磁盘缓存有效期。
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
/// 单个下载地址最多尝试次数。
const DOWNLOAD_ATTEMPTS: u32 = 3;
/// 解压后体积上限（防 zip bomb）。
const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 归档条目数上限。
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MANIFEST_FILE: &str = "manifest.json";

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryDoc {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub plugins: Vec<RegistryPlugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryPlugin {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub vendor: Option<String>,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub license: String,
    #[serde(default)]
    pub redistributable: bool,
    #[serde(default)]
    pub plugin_types: Vec<String>,
    #[serde(default)]
    pub contexts: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub files: Vec<RegistryFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryFile {
    pub url: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub arch: Vec<String>,
    #[serde(default)]
    pub contains: Vec<String>,
    #[serde(default = "default_install")]
    pub install: String,
}

fn default_install() -> String {
    "external".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginStatus {
    pub slug: String,
    pub name: String,
    pub vendor: Option<String>,
    pub version: String,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub source: Option<String>,
    pub license: String,
    pub redistributable: bool,
    pub plugin_types: Vec<String>,
    pub contexts: Vec<String>,
    pub tags: Vec<String>,
    pub files: Vec<RegistryFile>,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub installed_path: Option<String>,
    pub managed: bool,
    pub external: bool,
    pub compatible: bool,
    pub incompatible_reason: Option<String>,
    /// `archive` / `external` / `none`
    pub install_kind: String,
    pub download_size: Option<u64>,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegistryResponse {
    /// `network` / `cache` / `stale-cache` / `bundled`
    pub source: String,
    pub fetched_at: Option<u64>,
    pub plugins: Vec<PluginStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginProgress {
    pub slug: String,
    pub phase: String,
    pub received: u64,
    pub total: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistryMeta {
    fetched_at: u64,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledRecord {
    slug: String,
    name: String,
    version: String,
    license: String,
    /// 相对托管根目录的安装目录。
    dir: String,
    /// 相对托管根目录的插件文件。
    files: Vec<String>,
    installed_at: u64,
    source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledManifest {
    #[serde(default = "manifest_version")]
    version: u32,
    #[serde(default)]
    plugins: Vec<InstalledRecord>,
}

fn manifest_version() -> u32 {
    1
}

impl Default for InstalledManifest {
    fn default() -> Self {
        Self {
            version: 1,
            plugins: Vec::new(),
        }
    }
}

struct PluginRuntime {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn runtime() -> &'static PluginRuntime {
    static RUNTIME: OnceLock<PluginRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| PluginRuntime {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

fn managed_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("拿不到应用配置目录：{error}"))?
        .join("plugins")
        .join("ofx");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("拿不到应用缓存目录：{error}"))?
        .join("plugins")
        .join("ofx");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn registry_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join("registry.json"))
}

fn registry_meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join("registry.meta.json"))
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join(MANIFEST_FILE))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn bundled_registry_text() -> &'static str {
    include_str!("../assets/ofx-registry.json")
}

fn parse_registry(text: &str) -> Result<RegistryDoc, String> {
    let doc: RegistryDoc =
        serde_json::from_str(text).map_err(|error| format!("注册表 JSON 解析失败：{error}"))?;
    if doc.schema_version != 1 {
        return Err(format!("不支持的注册表版本：{}", doc.schema_version));
    }
    if doc.plugins.is_empty() {
        return Err("注册表为空".into());
    }
    Ok(doc)
}

fn read_meta(path: &Path) -> Option<RegistryMeta> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn write_meta(path: &Path, meta: &RegistryMeta) {
    if let Ok(text) = serde_json::to_string(meta) {
        let _ = fs::write(path, text);
    }
}

fn push_registry_url(urls: &mut Vec<String>, value: &str) {
    let value = value.trim();
    if value.is_empty() || !value.starts_with("https://") {
        return;
    }
    if urls.iter().any(|existing| existing == value) {
        return;
    }
    urls.push(value.to_string());
}

async fn load_registry(
    app: &AppHandle,
    force: bool,
) -> Result<(RegistryDoc, String, Option<u64>), String> {
    let cache = registry_cache_path(app)?;
    let meta_path = registry_meta_path(app)?;
    let meta = read_meta(&meta_path);

    if !force {
        if let Some(meta) = &meta {
            if now_secs().saturating_sub(meta.fetched_at) < CACHE_TTL.as_secs() {
                if let Ok(text) = fs::read_to_string(&cache) {
                    if let Ok(doc) = parse_registry(&text) {
                        return Ok((doc, "cache".into(), Some(meta.fetched_at)));
                    }
                }
            }
        }
    }

    let network = app.state::<std::sync::Arc<NetworkRuntime>>();
    let config = network.get();
    let client = network
        .client()
        .map_err(|error| format!("创建注册表客户端失败：{error}"))?;

    let mut urls: Vec<String> = Vec::new();
    for mirror in &config.plugin_registry_mirrors {
        let expanded = if mirror.contains("{url}") {
            mirror.replace("{url}", DEFAULT_REGISTRY_URL)
        } else {
            mirror.clone()
        };
        push_registry_url(&mut urls, &expanded);
    }
    if !config.plugin_registry_url.trim().is_empty() {
        push_registry_url(&mut urls, &config.plugin_registry_url);
    }
    push_registry_url(&mut urls, DEFAULT_REGISTRY_URL);

    let mut errors = Vec::new();
    for url in urls {
        match client
            .get(&url)
            .timeout(Duration::from_secs(20))
            .send()
            .await
        {
            Ok(response) => {
                if !response.status().is_success() {
                    errors.push(format!("{url} → HTTP {}", response.status()));
                    continue;
                }
                match response.text().await {
                    Ok(text) => match parse_registry(&text) {
                        Ok(doc) => {
                            let _ = fs::write(&cache, &text);
                            let fetched_at = now_secs();
                            write_meta(
                                &meta_path,
                                &RegistryMeta {
                                    fetched_at,
                                    source: url.clone(),
                                },
                            );
                            return Ok((doc, "network".into(), Some(fetched_at)));
                        }
                        Err(error) => errors.push(format!("{url} → {error}")),
                    },
                    Err(error) => errors.push(format!("{url} → {error}")),
                }
            }
            Err(error) => errors.push(format!("{url} → {error}")),
        }
    }

    if let Ok(text) = fs::read_to_string(&cache) {
        if let Ok(doc) = parse_registry(&text) {
            return Ok((doc, "stale-cache".into(), meta.map(|meta| meta.fetched_at)));
        }
    }

    let doc = parse_registry(bundled_registry_text()).map_err(|error| {
        if errors.is_empty() {
            error
        } else {
            format!("{error}\n网络错误：{}", errors.join("\n"))
        }
    })?;
    Ok((doc, "bundled".into(), None))
}

// ---------------------------------------------------------------------------
// 平台 / 文件选择
// ---------------------------------------------------------------------------

fn current_system() -> &'static str {
    if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "win"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "x86",
        other => other,
    }
}

fn file_matches(file: &RegistryFile, system: &str, arch: &str) -> bool {
    let system_ok = file.systems.is_empty() || file.systems.iter().any(|item| item == system);
    let arch_ok = file.arch.is_empty()
        || file
            .arch
            .iter()
            .any(|item| item == "universal" || item == arch);
    system_ok && arch_ok
}

fn select_file(plugin: &RegistryPlugin) -> Option<&RegistryFile> {
    let system = current_system();
    let arch = current_arch();
    let compatible: Vec<&RegistryFile> = plugin
        .files
        .iter()
        .filter(|file| file_matches(file, system, arch))
        .collect();
    compatible
        .iter()
        .find(|file| file.install == "archive")
        .copied()
        .or_else(|| compatible.first().copied())
}

fn is_gpl(license: &str) -> bool {
    license.starts_with("GPL-") || license.starts_with("AGPL-")
}

/// 注册表自己的托管地址。GPL/AGPL 二进制不能从这里下载，否则就是我们在再分发。
fn is_registry_hosted(url: &str) -> bool {
    url.contains("github.com/heshengtao/ai-cut-ofx-registry")
        || url.contains("raw.githubusercontent.com/heshengtao/ai-cut-ofx-registry")
        || url.contains("heshengtao.github.io/ai-cut-ofx-registry")
}

/// 只重写 GitHub 地址；与模型下载共用同一份 `download_prefix` 配置。
fn apply_download_prefix(prefix: &str, url: &str) -> String {
    let prefix = prefix.trim();
    if prefix.is_empty()
        || (!url.contains("github.com/") && !url.contains("githubusercontent.com/"))
    {
        return url.to_string();
    }
    if prefix.contains("{url}") {
        prefix.replace("{url}", url)
    } else {
        format!("{prefix}{url}")
    }
}

fn can_auto_install(plugin: &RegistryPlugin, file: &RegistryFile) -> bool {
    file.install == "archive"
        && file.sha256.is_some()
        && file.size.unwrap_or(0) > 0
        // GPL/AGPL 可以一键下载，但必须来自上游；注册表自己托管的一律拒绝。
        && !(is_gpl(&plugin.license) && is_registry_hosted(&file.url))
}

fn sanitize_slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn safe_slug_dir(slug: &str) -> String {
    let mut out = String::new();
    for ch in slug.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "plugin".into()
    } else {
        out
    }
}

// ---------------------------------------------------------------------------
// Manifest / 状态
// ---------------------------------------------------------------------------

fn read_manifest(app: &AppHandle) -> InstalledManifest {
    manifest_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_manifest(app: &AppHandle, manifest: &InstalledManifest) -> Result<(), String> {
    let path = manifest_path(app)?;
    let text = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn status_for(
    plugin: &RegistryPlugin,
    installed: Option<&InstalledRecord>,
    managed_root: &Path,
) -> PluginStatus {
    let selected = select_file(plugin);
    let system = current_system();
    let arch = current_arch();
    let compatible = selected.is_some() || installed.is_some();
    let incompatible_reason = if compatible {
        None
    } else {
        Some(format!("No build for {system}/{arch}"))
    };
    let install_kind = selected
        .map(|file| file.install.clone())
        .unwrap_or_else(|| "none".into());
    let download_size = selected
        .filter(|file| file.install == "archive")
        .and_then(|file| file.size);

    PluginStatus {
        slug: plugin.slug.clone(),
        name: plugin.name.clone(),
        vendor: plugin.vendor.clone(),
        version: plugin.version.clone(),
        description: plugin.description.clone(),
        homepage: plugin.homepage.clone(),
        source: plugin.source.clone(),
        license: plugin.license.clone(),
        redistributable: plugin.redistributable,
        plugin_types: plugin.plugin_types.clone(),
        contexts: plugin.contexts.clone(),
        tags: plugin.tags.clone(),
        files: plugin.files.clone(),
        installed: installed.is_some(),
        installed_version: installed.map(|record| record.version.clone()),
        installed_path: installed.map(|record| {
            managed_root
                .join(&record.dir)
                .to_string_lossy()
                .into_owned()
        }),
        managed: installed.is_some(),
        external: false,
        compatible,
        incompatible_reason,
        install_kind,
        download_size,
        update_available: installed
            .map(|record| record.version != plugin.version)
            .unwrap_or(false),
    }
}

fn status_from_record(record: &InstalledRecord, managed_root: &Path) -> PluginStatus {
    PluginStatus {
        slug: record.slug.clone(),
        name: record.name.clone(),
        vendor: None,
        version: record.version.clone(),
        description: None,
        homepage: None,
        source: None,
        license: record.license.clone(),
        redistributable: false,
        plugin_types: Vec::new(),
        contexts: Vec::new(),
        tags: Vec::new(),
        files: Vec::new(),
        installed: true,
        installed_version: Some(record.version.clone()),
        installed_path: Some(
            managed_root
                .join(&record.dir)
                .to_string_lossy()
                .into_owned(),
        ),
        managed: true,
        external: false,
        compatible: true,
        incompatible_reason: None,
        install_kind: "external".into(),
        download_size: None,
        update_available: false,
    }
}

fn external_status(name: String, version: String, path: &Path) -> PluginStatus {
    PluginStatus {
        slug: format!("external/{}", sanitize_slug(&name)),
        name,
        vendor: None,
        version,
        description: None,
        homepage: None,
        source: None,
        license: "Unknown".into(),
        redistributable: false,
        plugin_types: Vec::new(),
        contexts: Vec::new(),
        tags: Vec::new(),
        files: Vec::new(),
        installed: true,
        installed_version: None,
        installed_path: Some(path.to_string_lossy().into_owned()),
        managed: false,
        external: true,
        compatible: true,
        incompatible_reason: None,
        install_kind: "external".into(),
        download_size: None,
        update_available: false,
    }
}

fn bundle_info(path: &Path) -> (String, String) {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Plugin");
    let mut name = file_name
        .trim_end_matches(".ofx.bundle")
        .trim_end_matches(".ofx")
        .to_string();
    if name.is_empty() {
        name = "Plugin".into();
    }
    let mut version = "0.0.0".to_string();

    if path.is_dir() {
        let plist = path.join("Contents").join("Info.plist");
        if let Ok(value) = plist::Value::from_file(&plist) {
            if let Some(dict) = value.as_dictionary() {
                if let Some(value) = dict.get("CFBundleName").and_then(|value| value.as_string()) {
                    if !value.trim().is_empty() {
                        name = value.to_string();
                    }
                }
                if let Some(value) = dict
                    .get("CFBundleShortVersionString")
                    .and_then(|value| value.as_string())
                {
                    version = value.to_string();
                } else if let Some(value) = dict
                    .get("CFBundleVersion")
                    .and_then(|value| value.as_string())
                {
                    version = value.to_string();
                }
            }
        }
    }

    (name, version)
}

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

fn standard_plugin_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = app.path().home_dir() {
            dirs.push(home.join("Library").join("OFX").join("Plugins"));
        }
        dirs.push(PathBuf::from("/Library/OFX/Plugins"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(common) = std::env::var("COMMONPROGRAMFILES") {
            dirs.push(PathBuf::from(common).join("OFX").join("Plugins"));
        }
        if let Ok(program) = std::env::var("PROGRAMFILES") {
            dirs.push(
                PathBuf::from(program)
                    .join("Common Files")
                    .join("OFX")
                    .join("Plugins"),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        dirs.push(PathBuf::from("/usr/OFX/Plugins"));
        if let Ok(home) = app.path().home_dir() {
            dirs.push(
                home.join(".local")
                    .join("share")
                    .join("OFX")
                    .join("Plugins"),
            );
        }
    }

    if let Ok(path) = std::env::var("OFX_PLUGIN_PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        for part in path.split(separator) {
            let part = part.trim();
            if !part.is_empty() {
                dirs.push(PathBuf::from(part));
            }
        }
    }

    let mut seen = HashSet::new();
    dirs.retain(|dir| seen.insert(dir.clone()));
    dirs
}

fn scan_external(app: &AppHandle) -> Vec<PluginStatus> {
    let managed = managed_root(app).ok();
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for dir in standard_plugin_dirs(app) {
        if !dir.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&dir)
            .max_depth(6)
            .follow_links(false)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| !is_archive_noise(entry.path()))
        {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy();
            let is_bundle = is_ofx_bundle_dir(&entry);
            let is_ofx =
                entry.file_type().is_file() && name.ends_with(".ofx") && !name.starts_with("._");
            if !is_bundle && !is_ofx {
                continue;
            }
            if managed
                .as_ref()
                .map(|root| path.starts_with(root))
                .unwrap_or(false)
            {
                continue;
            }
            // 跳过 bundle 内部的文件；bundle 本身已经是一个插件。
            if path.ancestors().skip(1).any(|ancestor| {
                ancestor
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| {
                        name.ends_with(".ofx.bundle")
                            || (name.ends_with(".ofx") && ancestor.join("Contents").is_dir())
                    })
                    .unwrap_or(false)
            }) {
                continue;
            }
            if !seen.insert(path.to_path_buf()) {
                continue;
            }
            let (name, version) = bundle_info(path);
            out.push(external_status(name, version, path));
        }
    }

    out
}

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

async fn download_verified<F>(
    client: &reqwest::Client,
    url: &str,
    sha256: &str,
    size: u64,
    dest: &Path,
    cancel: &AtomicBool,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64),
{
    if !url.starts_with("https://") {
        return Err("只允许 https 下载地址".into());
    }
    let part = PathBuf::from(format!("{}.part", dest.to_string_lossy()));
    let mut errors = Vec::new();

    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        match download_once(
            client,
            url,
            sha256,
            size,
            dest,
            &part,
            cancel,
            &mut on_progress,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(error) => {
                if error == "已取消" {
                    return Err(error);
                }
                let content_error = error.contains("sha256") || error.contains("大小不符");
                errors.push(format!("{url} → {error}"));
                if content_error {
                    let _ = fs::remove_file(&part);
                    break;
                }
                if attempt < DOWNLOAD_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(600 * u64::from(attempt))).await;
                }
            }
        }
    }

    Err(format!("下载失败：{}", errors.join("\n")))
}

async fn download_once<F>(
    client: &reqwest::Client,
    url: &str,
    sha256: &str,
    size: u64,
    dest: &Path,
    part: &Path,
    cancel: &AtomicBool,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(u64),
{
    let mut existing = fs::metadata(part).map(|meta| meta.len()).unwrap_or(0);
    if size > 0 && existing > size {
        let _ = fs::remove_file(part);
        existing = 0;
    }
    if size > 0 && existing == size && existing > 0 {
        if part_valid(part, sha256, size).await {
            fs::rename(part, dest).map_err(|error| error.to_string())?;
            on_progress(size);
            return Ok(());
        }
        let _ = fs::remove_file(part);
        existing = 0;
    }

    let mut request = client.get(url).timeout(Duration::from_secs(60 * 60));
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let append = status == reqwest::StatusCode::PARTIAL_CONTENT && existing > 0;

    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing > 0 {
        if part_valid(part, sha256, size).await {
            fs::rename(part, dest).map_err(|error| error.to_string())?;
            return Ok(());
        }
        let _ = fs::remove_file(part);
        return Err("断点文件无效".into());
    }
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {status}"));
    }

    let mut output = if append {
        fs::OpenOptions::new()
            .append(true)
            .open(part)
            .map_err(|error| error.to_string())?
    } else {
        fs::File::create(part).map_err(|error| error.to_string())?
    };

    let mut received = if append { existing } else { 0 };
    on_progress(received);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let bytes = chunk.map_err(|error| error.to_string())?;
        output
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
        received += bytes.len() as u64;
        on_progress(received);
    }
    drop(output);

    let actual = fs::metadata(part).map(|meta| meta.len()).unwrap_or(0);
    if size > 0 && actual != size {
        let _ = fs::remove_file(part);
        return Err(format!("大小不符（期望 {size}，实际 {actual}）"));
    }
    if !part_valid(part, sha256, size).await {
        let _ = fs::remove_file(part);
        return Err("sha256 校验失败".into());
    }
    fs::rename(part, dest).map_err(|error| error.to_string())?;
    Ok(())
}

async fn part_valid(part: &Path, sha256: &str, size: u64) -> bool {
    let actual = fs::metadata(part).map(|meta| meta.len()).unwrap_or(0);
    if size > 0 && actual != size {
        return false;
    }
    if sha256.is_empty() {
        return actual > 0;
    }
    let path = part.to_path_buf();
    match tauri::async_runtime::spawn_blocking(move || sha256_file(&path)).await {
        Ok(Ok(digest)) => digest == sha256,
        _ => false,
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// ---------------------------------------------------------------------------
// 解压 / 安装
// ---------------------------------------------------------------------------

fn extract_archive(
    archive: &Path,
    dest: &Path,
    source_url: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|error| error.to_string())?;

    let mut header = [0u8; 4];
    let mut file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let read = file.read(&mut header).map_err(|error| error.to_string())?;
    drop(file);

    if read >= 2 && header[0] == b'P' && header[1] == b'K' {
        return extract_zip(archive, dest, cancel);
    }
    if read >= 2 && header[0] == 0x1f && header[1] == 0x8b {
        return extract_tar_gz(archive, dest, cancel);
    }

    let url_path = source_url.split('?').next().unwrap_or(source_url);
    if url_path.ends_with(".ofx") {
        let name = Path::new(url_path)
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("plugin.ofx"));
        let target = dest.join(name);
        fs::copy(archive, &target).map_err(|error| error.to_string())?;
        ensure_ofx_permissions(dest);
        return Ok(());
    }

    Err("不支持的归档格式（只支持 zip / tar.gz / 裸 .ofx）".into())
}

fn extract_zip(archive: &Path, dest: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut total = 0u64;
    if zip.len() > MAX_ARCHIVE_ENTRIES {
        return Err("归档条目过多".into());
    }

    for index in 0..zip.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if is_archive_noise(&relative) {
            continue;
        }
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            continue;
        }
        let target = dest.join(&relative);
        if !target.starts_with(dest) {
            continue;
        }
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }

        let mode = entry.unix_mode();
        if mode
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            continue; // symlink
        }
        total = total.saturating_add(entry.size());
        if total > MAX_ARCHIVE_BYTES {
            return Err("归档解压后过大".into());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(&target).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let executable = mode.map(|mode| mode & 0o111 != 0).unwrap_or(false)
                || target
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.ends_with(".ofx"))
                    .unwrap_or(false)
                || relative
                    .components()
                    .any(|component| component.as_os_str() == "MacOS");
            if executable {
                let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
            }
        }
    }

    ensure_ofx_permissions(dest);
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    let entries = tar.entries().map_err(|error| error.to_string())?;
    let mut count = 0usize;
    let mut total = 0u64;

    for entry in entries {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let mut entry = entry.map_err(|error| error.to_string())?;
        count += 1;
        if count > MAX_ARCHIVE_ENTRIES {
            return Err("归档条目过多".into());
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            continue;
        }
        total = total.saturating_add(entry.header().size().unwrap_or(0));
        if total > MAX_ARCHIVE_BYTES {
            return Err("归档解压后过大".into());
        }
        let relative = entry
            .path()
            .map_err(|error| error.to_string())?
            .to_path_buf();
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir))
            || is_archive_noise(&relative)
        {
            continue;
        }
        let _ = entry.unpack_in(dest);
    }

    ensure_ofx_permissions(dest);
    Ok(())
}

fn ensure_ofx_permissions(root: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for entry in WalkDir::new(root)
            .max_depth(8)
            .follow_links(false)
            .into_iter()
            .filter_map(|entry| entry.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            let in_macos = path
                .components()
                .any(|component| component.as_os_str() == "MacOS");
            if name.ends_with(".ofx") || in_macos {
                let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = root;
    }
}

fn is_archive_noise(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name == "__MACOSX" || name.starts_with("._")
    })
}

/// A plugin bundle is either a `.ofx.bundle` directory or (on macOS/Linux)
/// an `.ofx` directory with a `Contents` payload.  Some bundles ship the
/// Mach-O executable without an `.ofx` suffix, so directory detection must
/// not depend on finding a `*.ofx` file inside.
fn is_ofx_bundle_dir(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    if name.ends_with(".ofx.bundle") {
        return true;
    }
    name.ends_with(".ofx") && entry.path().join("Contents").is_dir()
}

fn collect_plugin_paths(root: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = WalkDir::new(root)
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| !is_archive_noise(entry.path()))
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy();
            is_ofx_bundle_dir(entry)
                || (entry.file_type().is_file()
                    && name.ends_with(".ofx")
                    && !name.starts_with("._"))
        })
        .map(|entry| entry.into_path())
        .collect();
    candidates.sort_by_key(|path| path.components().count());

    let mut out: Vec<PathBuf> = Vec::new();
    for path in candidates {
        if out.iter().any(|existing| path.starts_with(existing)) {
            continue;
        }
        out.push(path);
    }
    out
}

fn copy_dir(source: &Path, dest: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("不允许符号链接".into());
    }
    fs::create_dir_all(dest).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn copy_path(source: &Path, dest: &Path) -> Result<(), String> {
    if source.is_dir() {
        copy_dir(source, dest)
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, dest)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

fn move_path(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    match fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_path(source, dest)?;
            if source.is_dir() {
                fs::remove_dir_all(source).map_err(|error| error.to_string())
            } else {
                fs::remove_file(source).map_err(|error| error.to_string())
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn install_into_managed(
    app: &AppHandle,
    slug: &str,
    name: &str,
    version: &str,
    license: &str,
    source_paths: &[PathBuf],
    move_files: bool,
    source_url: Option<String>,
) -> Result<InstalledRecord, String> {
    let root = managed_root(app)?;
    let dir_name = safe_slug_dir(slug);
    let install_dir = root.join(&dir_name);
    let backup = root.join(format!(".old-{}-{}", dir_name, now_millis()));
    let had_old = install_dir.exists();
    if had_old {
        fs::rename(&install_dir, &backup).map_err(|error| error.to_string())?;
    }

    let result = (|| -> Result<InstalledRecord, String> {
        fs::create_dir_all(&install_dir).map_err(|error| error.to_string())?;
        let mut files = Vec::new();
        for source in source_paths {
            let file_name = source
                .file_name()
                .ok_or_else(|| "插件路径没有文件名".to_string())?;
            let target = install_dir.join(file_name);
            if move_files {
                move_path(source, &target)?;
            } else {
                copy_path(source, &target)?;
            }
            files.push(format!("{}/{}", dir_name, file_name.to_string_lossy()));
        }
        if files.is_empty() {
            return Err("没有找到 .ofx 插件".into());
        }

        let record = InstalledRecord {
            slug: slug.to_string(),
            name: name.to_string(),
            version: version.to_string(),
            license: license.to_string(),
            dir: dir_name.clone(),
            files,
            installed_at: now_secs(),
            source_url,
        };
        let mut manifest = read_manifest(app);
        manifest.plugins.retain(|item| item.slug != slug);
        manifest.plugins.push(record.clone());
        write_manifest(app, &manifest)?;
        Ok(record)
    })();

    match result {
        Ok(record) => {
            if had_old {
                let _ = fs::remove_dir_all(&backup);
            }
            Ok(record)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&install_dir);
            if had_old {
                let _ = fs::rename(&backup, &install_dir);
            }
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// 进度
// ---------------------------------------------------------------------------

fn emit_progress(
    app: &AppHandle,
    slug: &str,
    phase: &str,
    received: u64,
    total: u64,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_PLUGIN,
        PluginProgress {
            slug: slug.to_string(),
            phase: phase.to_string(),
            received,
            total,
            message,
        },
    );
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_registry(app: AppHandle, force: bool) -> Result<RegistryResponse, String> {
    let (doc, source, fetched_at) = load_registry(&app, force).await?;
    let manifest = read_manifest(&app);
    let root = managed_root(&app)?;

    let mut plugins: Vec<PluginStatus> = doc
        .plugins
        .iter()
        .map(|plugin| {
            let installed = manifest
                .plugins
                .iter()
                .find(|record| record.slug == plugin.slug);
            status_for(plugin, installed, &root)
        })
        .collect();

    for record in &manifest.plugins {
        if !plugins.iter().any(|plugin| plugin.slug == record.slug) {
            plugins.push(status_from_record(record, &root));
        }
    }

    for external in scan_external(&app) {
        if !plugins.iter().any(|plugin| plugin.slug == external.slug) {
            plugins.push(external);
        }
    }

    Ok(RegistryResponse {
        source,
        fetched_at,
        plugins,
    })
}

/// 只读缓存/内置快照，不联网。供「已安装插件」面板快速展示元数据。
fn load_registry_local(app: &AppHandle) -> Result<RegistryDoc, String> {
    if let Ok(path) = registry_cache_path(app) {
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(doc) = parse_registry(&text) {
                return Ok(doc);
            }
        }
    }
    parse_registry(bundled_registry_text())
}

#[tauri::command]
pub fn plugin_installed(app: AppHandle) -> Result<Vec<PluginStatus>, String> {
    let root = managed_root(&app)?;
    let manifest = read_manifest(&app);
    let doc = load_registry_local(&app).ok();
    let mut plugins: Vec<PluginStatus> = Vec::new();

    for record in &manifest.plugins {
        if let Some(plugin) = doc
            .as_ref()
            .and_then(|doc| doc.plugins.iter().find(|plugin| plugin.slug == record.slug))
        {
            plugins.push(status_for(plugin, Some(record), &root));
        } else {
            plugins.push(status_from_record(record, &root));
        }
    }

    plugins.extend(scan_external(&app));
    Ok(plugins)
}

#[tauri::command]
pub async fn plugin_install(app: AppHandle, slug: String) -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有插件正在安装".into());
    }
    runtime().cancel.store(false, Ordering::Relaxed);

    let result = run_install(&app, &slug).await;

    runtime().running.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => emit_progress(&app, &slug, "done", 0, 0, None),
        Err(error) => emit_progress(&app, &slug, "error", 0, 0, Some(error.clone())),
    }
    result
}

/// 先读缓存；缓存里没有这个 slug 时强制刷新一次，避免 UI 展示内置快照、
/// 安装时却拿旧缓存说“没有这个插件”。
async fn find_plugin(app: &AppHandle, slug: &str) -> Result<RegistryPlugin, String> {
    let (doc, _, _) = load_registry(app, false).await?;
    if let Some(plugin) = doc.plugins.iter().find(|plugin| plugin.slug == slug) {
        return Ok(plugin.clone());
    }
    let (doc, _, _) = load_registry(app, true).await?;
    doc.plugins
        .into_iter()
        .find(|plugin| plugin.slug == slug)
        .ok_or_else(|| format!("注册表里没有这个插件：{slug}"))
}

async fn run_install(app: &AppHandle, slug: &str) -> Result<(), String> {
    let plugin = find_plugin(app, slug).await?;

    let file = select_file(&plugin)
        .ok_or_else(|| format!("没有适配 {} / {} 的构建", current_system(), current_arch()))?;
    if file.install != "archive" {
        return Err("这个条目只提供上游下载页".into());
    }
    if !can_auto_install(&plugin, file) {
        return Err("该插件不允许自动安装（缺少校验信息，或 GPL 二进制被托管在注册表仓库）".into());
    }

    let sha256 = file
        .sha256
        .clone()
        .ok_or_else(|| "归档缺少 sha256".to_string())?;
    let size = file.size.unwrap_or(0);
    let network = app.state::<std::sync::Arc<NetworkRuntime>>();
    let config = network.get();
    let client = network
        .client()
        .map_err(|error| format!("创建下载客户端失败：{error}"))?;
    let download_url = apply_download_prefix(&config.download_prefix, &file.url);

    let downloads = cache_root(app)?.join("downloads");
    fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let download = downloads.join(format!("{}-{}.download", safe_slug_dir(slug), now_millis()));

    emit_progress(app, slug, "downloading", 0, size, None);
    download_verified(
        &client,
        &download_url,
        &sha256,
        size,
        &download,
        &runtime().cancel,
        |received| emit_progress(app, slug, "downloading", received, size, None),
    )
    .await?;

    emit_progress(app, slug, "extracting", 0, 0, None);
    let staging =
        cache_root(app)?
            .join("staging")
            .join(format!("{}-{}", safe_slug_dir(slug), now_millis()));
    let staging_for_task = staging.clone();
    let download_for_task = download.clone();
    let source_url = file.url.clone();
    let cancel = &runtime().cancel;
    tauri::async_runtime::spawn_blocking(move || {
        extract_archive(&download_for_task, &staging_for_task, &source_url, cancel)
    })
    .await
    .map_err(|error| error.to_string())??;

    let paths = collect_plugin_paths(&staging);
    if paths.is_empty() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_file(&download);
        return Err("归档里没有找到 .ofx 插件".into());
    }

    emit_progress(app, slug, "installing", 0, 0, None);
    install_into_managed(
        app,
        &plugin.slug,
        &plugin.name,
        &plugin.version,
        &plugin.license,
        &paths,
        true,
        Some(file.url.clone()),
    )?;

    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&download);
    Ok(())
}

#[tauri::command]
pub fn plugin_cancel() {
    runtime().cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn plugin_remove(app: AppHandle, slug: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    let mut manifest = read_manifest(&app);
    let record = manifest
        .plugins
        .iter()
        .find(|record| record.slug == slug)
        .ok_or_else(|| "只能删除本应用安装的插件".to_string())?;

    let target = root.join(&record.dir);
    let root_canonical = root.canonicalize().map_err(|error| error.to_string())?;
    let target_canonical = target.canonicalize().unwrap_or_else(|_| target.clone());
    if !target_canonical.starts_with(&root_canonical) {
        return Err("拒绝删除托管目录之外的路径".into());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    } else if target.is_file() {
        fs::remove_file(&target).map_err(|error| error.to_string())?;
    }

    manifest.plugins.retain(|record| record.slug != slug);
    write_manifest(&app, &manifest)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_import(app: AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(path);
    if !source.exists() {
        return Err("路径不存在".into());
    }
    let cancel = &runtime().cancel;
    let mut staging: Option<PathBuf> = None;

    let (name, version, paths) = if source.is_dir()
        && source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.ends_with(".ofx.bundle")
                    || (name.ends_with(".ofx") && source.join("Contents").is_dir())
            })
            .unwrap_or(false)
    {
        let (name, version) = bundle_info(&source);
        (name, version, vec![source.clone()])
    } else if source.is_file()
        && source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(".ofx"))
            .unwrap_or(false)
    {
        let (name, version) = bundle_info(&source);
        (name, version, vec![source.clone()])
    } else if source.is_file() {
        let dir = cache_root(&app)?
            .join("staging")
            .join(format!("import-{}", now_millis()));
        extract_archive(&source, &dir, "", cancel)?;
        let paths = collect_plugin_paths(&dir);
        if paths.is_empty() {
            let _ = fs::remove_dir_all(&dir);
            return Err("归档里没有找到 .ofx 插件".into());
        }
        let stem = source
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Plugin")
            .to_string();
        staging = Some(dir);
        (stem, "0.0.0".to_string(), paths)
    } else {
        return Err("请选择 .ofx.bundle、.ofx 或插件归档".into());
    };

    let slug = format!("local/{}", sanitize_slug(&name));
    let result = install_into_managed(&app, &slug, &name, &version, "Unknown", &paths, false, None);
    if let Some(dir) = staging {
        let _ = fs::remove_dir_all(dir);
    }
    result.map(|_| ())
}

#[tauri::command]
pub fn plugin_reveal(app: AppHandle, slug: String) -> Result<(), String> {
    let root = managed_root(&app)?;
    let manifest = read_manifest(&app);
    if let Some(record) = manifest.plugins.iter().find(|record| record.slug == slug) {
        return reveal_in_file_manager(&root.join(&record.dir));
    }
    if let Some(external) = scan_external(&app)
        .into_iter()
        .find(|plugin| plugin.slug == slug)
    {
        if let Some(path) = external.installed_path {
            return reveal_in_file_manager(Path::new(&path));
        }
    }
    Err("找不到已安装的插件".into())
}

#[tauri::command]
pub async fn plugin_open(app: AppHandle, slug: String) -> Result<(), String> {
    let plugin = find_plugin(&app, &slug).await?;
    let url = plugin
        .homepage
        .clone()
        .or_else(|| plugin.source.clone())
        .or_else(|| select_file(&plugin).map(|file| file.url.clone()))
        .ok_or_else(|| "这个条目没有可打开的链接".to_string())?;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("不支持的链接：{url}"));
    }
    open::that_detached(&url).map_err(|error| error.to_string())
}

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let dir = path.parent().unwrap_or(path);
        let mut command = std::process::Command::new("xdg-open");
        command.arg(dir);
        command
    };
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin_with_files(files: Vec<RegistryFile>) -> RegistryPlugin {
        RegistryPlugin {
            slug: "acme/glow".into(),
            name: "Glow".into(),
            vendor: Some("Acme".into()),
            version: "1.2.0".into(),
            description: None,
            homepage: None,
            source: Some("https://example.com/glow".into()),
            license: "BSD-3-Clause".into(),
            redistributable: true,
            plugin_types: vec!["filter".into()],
            contexts: vec!["filter".into()],
            tags: Vec::new(),
            files,
        }
    }

    fn archive_file() -> RegistryFile {
        RegistryFile {
            url: "https://example.com/glow.zip".into(),
            sha256: Some("a".repeat(64)),
            size: Some(123),
            systems: vec!["mac".into(), "win".into(), "linux".into()],
            arch: vec!["universal".into()],
            contains: vec!["ofx".into()],
            install: "archive".into(),
        }
    }

    #[test]
    fn bundled_registry_parses() {
        let doc = parse_registry(bundled_registry_text()).expect("bundled registry must parse");
        assert_eq!(doc.schema_version, 1);
        assert!(!doc.plugins.is_empty());
    }

    #[test]
    fn selects_a_compatible_archive() {
        let plugin = plugin_with_files(vec![archive_file()]);
        let file = select_file(&plugin).unwrap();
        assert_eq!(file.install, "archive");
        assert!(can_auto_install(&plugin, file));
    }

    #[test]
    fn gpl_archive_is_allowed_only_from_upstream() {
        let mut plugin = plugin_with_files(vec![archive_file()]);
        plugin.license = "GPL-2.0-only".into();
        plugin.redistributable = false;
        let upstream = select_file(&plugin).unwrap();
        assert!(can_auto_install(&plugin, upstream));

        let hosted = RegistryFile {
            url: "https://github.com/heshengtao/ai-cut-ofx-registry/releases/download/x.zip".into(),
            ..archive_file()
        };
        assert!(!can_auto_install(&plugin, &hosted));
    }

    #[test]
    fn platform_matching_honours_universal() {
        let file = archive_file();
        assert!(file_matches(&file, "mac", "arm64"));
        assert!(file_matches(&file, "linux", "x64"));
        let mut windows_only = file;
        windows_only.systems = vec!["win".into()];
        assert!(!file_matches(&windows_only, "mac", "arm64"));
    }

    #[test]
    fn slug_directory_is_safe() {
        assert_eq!(safe_slug_dir("vendor/plugin"), "vendor_plugin");
        assert_eq!(safe_slug_dir("../../etc"), ".._.._etc");
        assert!(!safe_slug_dir("a/b").contains('/'));
    }

    #[test]
    fn collect_finds_bundles_and_skips_nested_ofx() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("A.ofx.bundle");
        fs::create_dir_all(bundle.join("Contents").join("MacOS")).unwrap();
        fs::write(bundle.join("Contents").join("MacOS").join("A.ofx"), b"x").unwrap();
        fs::write(dir.path().join("B.ofx"), b"y").unwrap();
        let found = collect_plugin_paths(dir.path());
        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|path| path.ends_with("A.ofx.bundle")));
        assert!(found.iter().any(|path| path.ends_with("B.ofx")));
    }

    #[test]
    fn zip_extraction_rejects_parent_paths() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("bad.zip");
        {
            let file = fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("../evil.txt", options).unwrap();
            zip.write_all(b"bad").unwrap();
            zip.start_file("A.ofx", options).unwrap();
            zip.write_all(b"good").unwrap();
            zip.finish().unwrap();
        }
        let dest = dir.path().join("out");
        extract_zip(&archive, &dest, &AtomicBool::new(false)).unwrap();
        assert!(dest.join("A.ofx").is_file());
        assert!(!dir.path().join("evil.txt").exists());
    }

    #[tokio::test]
    #[ignore = "network + system proxy"]
    async fn downloads_and_extracts_the_invert_sample() {
        let runtime = crate::network::NetworkRuntime::load(None);
        let client = runtime.client().expect("client");
        let url = "https://github.com/heshengtao/ai-cut-ofx-registry/releases/download/v1.5.1-invert/invert-1.5.1-macos-arm64-r3.zip";
        let sha256 = "72b25a45f32cb1f692392601c480513ec937118610901a93aab43991754ad84f";
        let size = 86_964;
        let dir = tempfile::tempdir().unwrap();
        let download = dir.path().join("invert.download");
        let cancel = AtomicBool::new(false);
        download_verified(&client, url, sha256, size, &download, &cancel, |_| {})
            .await
            .expect("download");
        let staging = dir.path().join("staging");
        extract_archive(&download, &staging, url, &cancel).expect("extract");
        let paths = collect_plugin_paths(&staging);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("invert.ofx.bundle"));
    }

    #[test]
    fn collect_finds_dot_ofx_directories_and_ignores_archive_noise() {
        let dir = tempfile::tempdir().unwrap();
        // macOS/Linux style bundle whose executable has no .ofx suffix.
        let dot_ofx = dir.path().join("C.ofx");
        fs::create_dir_all(dot_ofx.join("Contents").join("MacOS")).unwrap();
        fs::write(dot_ofx.join("Contents").join("MacOS").join("C"), b"bin").unwrap();
        // AppleDouble sidecars from a zip made on macOS must not be plugins.
        let noise = dir.path().join("__MACOSX").join("D.ofx.bundle");
        fs::create_dir_all(noise.join("Contents").join("MacOS")).unwrap();
        fs::write(noise.join("Contents").join("MacOS").join("._D.ofx"), b"x").unwrap();
        let real = dir.path().join("E.ofx.bundle");
        fs::create_dir_all(real.join("Contents").join("MacOS")).unwrap();
        fs::write(real.join("Contents").join("MacOS").join("._E.ofx"), b"x").unwrap();

        let found = collect_plugin_paths(dir.path());
        assert_eq!(found.len(), 2, "{found:?}");
        assert!(found.iter().any(|path| path.ends_with("C.ofx")));
        assert!(found.iter().any(|path| path.ends_with("E.ofx.bundle")));
    }

    #[test]
    fn zip_extraction_skips_macos_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("bundle.zip");
        {
            let file = fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("A.ofx.bundle/Contents/MacOS/A.ofx", options)
                .unwrap();
            zip.write_all(b"good").unwrap();
            zip.start_file("__MACOSX/A.ofx.bundle/Contents/MacOS/._A.ofx", options)
                .unwrap();
            zip.write_all(b"junk").unwrap();
            zip.start_file("._A.ofx", options).unwrap();
            zip.write_all(b"junk").unwrap();
            zip.finish().unwrap();
        }
        let dest = dir.path().join("out");
        extract_zip(&archive, &dest, &AtomicBool::new(false)).unwrap();
        assert!(dest
            .join("A.ofx.bundle")
            .join("Contents")
            .join("MacOS")
            .join("A.ofx")
            .is_file());
        assert!(!dest.join("__MACOSX").exists());
        assert!(!dest.join("._A.ofx").exists());
    }

    #[tokio::test]
    #[ignore = "network + system proxy"]
    async fn fetches_registry_through_the_network_runtime() {
        let runtime = crate::network::NetworkRuntime::load(None);
        let client = runtime.client().expect("client");
        let response = client
            .get(DEFAULT_REGISTRY_URL)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .expect("registry response");
        assert!(response.status().is_success());
        let text = response.text().await.expect("registry body");
        let doc = parse_registry(&text).expect("registry");
        assert!(!doc.plugins.is_empty());
    }

    #[test]
    fn download_prefix_only_rewrites_github() {
        let github = "https://github.com/acme/glow/releases/download/v1/glow.zip";
        assert_eq!(
            apply_download_prefix("https://mirror.example/", github),
            format!("https://mirror.example/{github}")
        );
        assert_eq!(
            apply_download_prefix("https://mirror.example/?u={url}", github),
            format!("https://mirror.example/?u={github}")
        );
        let non_github = "https://huggingface.co/acme/glow.zip";
        assert_eq!(
            apply_download_prefix("https://mirror.example/", non_github),
            non_github
        );
    }

    #[test]
    fn sha256_matches_known_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x");
        fs::write(&path, b"hello").unwrap();
        assert_eq!(
            sha256_file(&path).unwrap(),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
