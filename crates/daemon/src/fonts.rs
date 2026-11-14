//! 字体库：Fontsource 注册表缓存、字体文件下载、本地导入与已安装字体管理。
//!
//! 字体是**全局资源**，放在 `<数据目录>/fonts/<id>/`，随数据目录一起迁移；工程里只保存
//! `fontFamily` id。安装时按分片（CJK）或命名字集落盘，前端用 manifest 里的
//! `unicode-range` 生成 `@font-face`，预览与导出共用同一份文件。
//!
//! 参数只依赖**数据目录**与调用方给的 HTTP 客户端 / 进度回调：桌面壳与无头 daemon
//! 共用这一份实现，浏览器端因此也能装字体。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
/// 进度回调：桌面端接到 `app.emit`，无头进程接到 SSE 总线（`crate::events`）。
///
/// 通过参数传进来，是为了让同一份实现同时服务 webview 与浏览器，而不把 Tauri 带进来。
pub type Emit<'a> = &'a (dyn Fn(&str, serde_json::Value) + Sync);

/// 字体安装进度事件。
pub const EVENT_PROGRESS: &str = "font-progress";

/// Fontsource 注册表（全量列表，约 500 KB）。
const REGISTRY_URL: &str = "https://api.fontsource.org/v1/fonts";
/// 单个字体的详情（含 variants 与 unicodeRange）。
const FONT_URL: &str = "https://api.fontsource.org/v1/fonts/";
/// 注册表缓存有效期：7 天。
const REGISTRY_TTL: u64 = 7 * 24 * 60 * 60;
/// 同时下载的分片数。
const CONCURRENCY: usize = 4;
/// 本地导入的文件大小上限。
const MAX_IMPORT_BYTES: u64 = 80 * 1024 * 1024;

/// 同一时刻只允许一个字体安装（与模型下载一致）。
static RUNNING: AtomicBool = AtomicBool::new(false);
/// 取消标记：每个分片下载前检查一次。
static CANCEL: AtomicBool = AtomicBool::new(false);
/// 当前安装的字体 id。
static ACTIVE: Mutex<Option<String>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFace {
    /// 相对字体目录的文件名，例如 `files/119-400-normal.woff2`。
    pub file: String,
    pub weight: u16,
    pub style: String,
    #[serde(default)]
    pub subset: String,
    /// CJK 分片必需；本地字体没有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unicode_range: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontManifest {
    pub id: String,
    pub family: String,
    /// `fontsource` / `local`。
    pub source: String,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub subsets: Vec<String>,
    #[serde(default)]
    pub weights: Vec<u16>,
    #[serde(default)]
    pub styles: Vec<String>,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub installed_at: u64,
    #[serde(default)]
    pub faces: Vec<FontFace>,
    /// 绝对目录，只在返回给前端时填充；写 manifest 前会清空（数据目录迁移后不留旧路径）。
    #[serde(default)]
    pub dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontRegistryView {
    /// 缓存时间（Unix 秒）。
    pub fetched_at: u64,
    /// 是否在展示过期缓存（刷新失败）。
    pub stale: bool,
    pub error: Option<String>,
    pub fonts: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontProgress {
    pub id: String,
    /// `meta` / `download` / `write` / `done` / `error`。
    pub phase: String,
    pub files_done: u32,
    pub files_total: u32,
    pub bytes: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontProbe {
    pub family: Option<String>,
    pub weight: u16,
    pub style: String,
    pub format: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct RegistryCache {
    fetched_at: u64,
    fonts: Vec<Value>,
}

impl Default for RegistryCache {
    fn default() -> Self {
        Self {
            fetched_at: 0,
            fonts: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// 路径与 id
// ---------------------------------------------------------------------------

pub fn fonts_dir(data_dir: &Path) -> Result<PathBuf, String> {
    Ok(data_dir.join("fonts"))
}

fn registry_path(data_dir: &Path) -> Result<PathBuf, String> {
    Ok(fonts_dir(data_dir)?.join("registry.json"))
}

fn font_dir(data_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("非法字体 id：{id}"));
    }
    Ok(fonts_dir(data_dir)?.join(id))
}

/// 目录占用字节数（写进 manifest，界面显示"已用空间"）。
fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_size(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

/// 无头进程用的 HTTP 客户端（跟随环境变量里的代理设置）。
///
/// 桌面端不用它：那边把 `NetworkRuntime` 里配好代建的客户端传进来，设置页的代理
/// 才会对字体下载生效。
pub fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        // reqwest 用 `rustls-no-provider`，进程里得先装一个加密实现（ring）。
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// id 直接作为目录名，只允许小写字母、数字和 `-`。
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.len() >= 40 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "font".into()
    } else {
        trimmed
    }
}

fn fnv1a(bytes: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0101);
    }
    hash
}

// ---------------------------------------------------------------------------
// 读取 / 写入
// ---------------------------------------------------------------------------

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("创建目录失败：{error}"))?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp).map_err(|error| format!("写入失败：{error}"))?;
        file.write_all(&json)
            .map_err(|error| format!("写入失败：{error}"))?;
        file.sync_all().ok();
    }
    fs::rename(&temp, path).map_err(|error| format!("保存失败：{error}"))
}

fn read_manifest(dir: &Path) -> Option<FontManifest> {
    let text = fs::read_to_string(dir.join("manifest.json")).ok()?;
    let mut manifest: FontManifest = serde_json::from_str(&text).ok()?;
    if manifest.family.trim().is_empty() || !valid_id(&manifest.id) {
        return None;
    }
    manifest.dir = dir.to_string_lossy().into_owned();
    Some(manifest)
}

fn installed_fonts(data_dir: &Path) -> Result<Vec<FontManifest>, String> {
    let root = fonts_dir(data_dir)?;
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut fonts: Vec<FontManifest> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with(".tmp-"))
        .filter_map(|entry| read_manifest(&entry.path()))
        .collect();
    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
    Ok(fonts)
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

async fn fetch_registry(client: &reqwest::Client) -> Result<Vec<Value>, String> {
    let response = client
        .get(REGISTRY_URL)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("拉取字体注册表失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("字体注册表返回 HTTP {}", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取字体注册表失败：{error}"))?;
    let fonts: Vec<Value> =
        serde_json::from_str(&text).map_err(|error| format!("字体注册表格式异常：{error}"))?;
    if fonts.is_empty() {
        return Err("字体注册表为空".into());
    }
    Ok(fonts)
}

fn read_registry_cache(data_dir: &Path) -> Option<RegistryCache> {
    let path = registry_path(data_dir).ok()?;
    let text = fs::read_to_string(path).ok()?;
    let cache: RegistryCache = serde_json::from_str(&text).ok()?;
    if cache.fonts.is_empty() {
        None
    } else {
        Some(cache)
    }
}

/// 列出 Fontsource 注册表。缓存 7 天，`force` 强制刷新；刷新失败时退回旧缓存。
pub async fn registry(
    data_dir: &Path,
    client: &reqwest::Client,
    force: Option<bool>,
) -> Result<FontRegistryView, String> {
    let force = force.unwrap_or(false);
    let cache = read_registry_cache(data_dir);
    let fresh = cache
        .as_ref()
        .map(|cache| now_secs().saturating_sub(cache.fetched_at) < REGISTRY_TTL)
        .unwrap_or(false);
    if !force && fresh {
        let cache = cache.expect("fresh cache");
        return Ok(FontRegistryView {
            fetched_at: cache.fetched_at,
            stale: false,
            error: None,
            fonts: cache.fonts,
        });
    }

    match fetch_registry(client).await {
        Ok(fonts) => {
            let fetched_at = now_secs();
            let cache = RegistryCache { fetched_at, fonts };
            if let Ok(path) = registry_path(data_dir) {
                let _ = write_json(&path, &cache);
            }
            Ok(FontRegistryView {
                fetched_at,
                stale: false,
                error: None,
                fonts: cache.fonts,
            })
        }
        Err(error) => match cache {
            Some(cache) => Ok(FontRegistryView {
                fetched_at: cache.fetched_at,
                stale: true,
                error: Some(error),
                fonts: cache.fonts,
            }),
            None => Err(error),
        },
    }
}

async fn fetch_font_meta(client: &reqwest::Client, source_id: &str) -> Result<Value, String> {
    let url = format!("{FONT_URL}{source_id}");
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("获取字体详情失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("字体详情返回 HTTP {}", response.status()));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("字体详情格式异常：{error}"))
}

// ---------------------------------------------------------------------------
// 安装计划
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
struct FacePlan {
    file: String,
    url: String,
    weight: u16,
    style: String,
    subset: String,
    unicode_range: Option<String>,
}

#[derive(Debug, Clone)]
struct InstallPlan {
    family: String,
    version: String,
    license: String,
    category: String,
    subsets: Vec<String>,
    weights: Vec<u16>,
    styles: Vec<String>,
    faces: Vec<FacePlan>,
}

const CJK_SUBSETS: &[&str] = &[
    "chinese-simplified",
    "chinese-traditional",
    "traditional-chinese",
    "japanese",
    "korean",
];

/// 字体声明的“主语言”子集：CJK 优先，其次元数据里的 `defSubset`，再退到拉丁。
fn main_subset(subsets: &[String], def_subset: &str) -> String {
    for wanted in CJK_SUBSETS {
        if subsets.iter().any(|subset| subset == wanted) {
            return (*wanted).to_string();
        }
    }
    if !def_subset.is_empty() && subsets.iter().any(|subset| subset == def_subset) {
        return def_subset.to_string();
    }
    if subsets.iter().any(|subset| subset == "latin") {
        return "latin".into();
    }
    subsets.first().cloned().unwrap_or_else(|| "latin".into())
}

fn variant_url(style_obj: &Map<String, Value>, key: &str) -> Option<String> {
    style_obj
        .get(key)?
        .get("url")?
        .get("woff2")?
        .as_str()
        .map(str::to_string)
}

fn build_install_plan(meta: &Value, weights: &[u16]) -> Result<InstallPlan, String> {
    let family = meta
        .get("family")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if family.is_empty() {
        return Err("字体详情缺少 family".into());
    }
    let variants = meta
        .get("variants")
        .and_then(Value::as_object)
        .ok_or_else(|| "字体详情缺少 variants".to_string())?;
    let unicode_ranges = meta.get("unicodeRange").and_then(Value::as_object);
    let subsets = meta
        .get("subsets")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let def_subset = meta
        .get("defSubset")
        .and_then(Value::as_str)
        .unwrap_or("latin");

    let mut wanted: Vec<u16> = weights
        .iter()
        .copied()
        .filter(|weight| variants.contains_key(&weight.to_string()))
        .collect();
    if wanted.is_empty() {
        if let Some(first) = variants.keys().find_map(|key| key.parse::<u16>().ok()) {
            wanted.push(first);
        }
    }
    wanted.sort_unstable();
    wanted.dedup();
    if wanted.is_empty() {
        return Err("该字体没有可安装的字重".into());
    }

    let mut faces = Vec::new();
    let mut styles_out: Vec<String> = Vec::new();
    for weight in &wanted {
        let Some(weight_obj) = variants.get(&weight.to_string()).and_then(Value::as_object) else {
            continue;
        };
        let style = if weight_obj.contains_key("normal") {
            "normal".to_string()
        } else {
            match weight_obj.keys().next() {
                Some(key) => key.clone(),
                None => continue,
            }
        };
        let Some(style_obj) = weight_obj.get(&style).and_then(Value::as_object) else {
            continue;
        };
        if !styles_out.contains(&style) {
            styles_out.push(style.clone());
        }

        let mut slices: Vec<(u32, String)> = style_obj
            .keys()
            .filter_map(|key| key.parse::<u32>().ok().map(|value| (value, key.clone())))
            .collect();
        // 分片必须全部带 unicode-range，否则多个同字重 face 会互相覆盖（缺字）。
        // 元数据异常时退回单文件子集，宁可少覆盖也不能显示错误字形。
        let ranges_ok = slices.iter().all(|(_, key)| {
            unicode_ranges
                .and_then(|map| map.get(&format!("[{key}]")))
                .and_then(Value::as_str)
                .is_some()
        });
        if !slices.is_empty() && ranges_ok {
            // CJK：数字分片覆盖完整字形（ASCII 也在分片内），全部安装。
            slices.sort_unstable_by_key(|(value, _)| *value);
            let subset = main_subset(&subsets, def_subset);
            for (_, key) in slices {
                let Some(url) = variant_url(style_obj, &key) else {
                    continue;
                };
                let range_key = format!("[{key}]");
                let unicode_range = unicode_ranges
                    .and_then(|map| map.get(&range_key))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                faces.push(FacePlan {
                    file: format!("{key}-{weight}-{style}.woff2"),
                    url,
                    weight: *weight,
                    style: style.clone(),
                    subset: subset.clone(),
                    unicode_range,
                });
            }
            continue;
        }

        // 非 CJK（或分片元数据不可用）：安装**全部**命名字集，任何语言都有字形。
        // 顺序：主语言 → latin → 默认子集 → 其余（下载进度看起来有主次，不影响正确性）。
        let preferred = main_subset(&subsets, def_subset);
        let mut named: Vec<String> = style_obj
            .keys()
            .filter(|key| key.parse::<u32>().is_err())
            .cloned()
            .collect();
        named.sort_by_key(|name| {
            if *name == preferred {
                0
            } else if name == "latin" {
                1
            } else if name == def_subset {
                2
            } else {
                3
            }
        });
        for named in named {
            let Some(url) = variant_url(style_obj, &named) else {
                continue;
            };
            let unicode_range = unicode_ranges
                .and_then(|map| map.get(&named))
                .and_then(Value::as_str)
                .map(str::to_string);
            faces.push(FacePlan {
                file: format!("{named}-{weight}-{style}.woff2"),
                url,
                weight: *weight,
                style: style.clone(),
                subset: named,
                unicode_range,
            });
        }
    }

    if faces.is_empty() {
        return Err("没有找到可下载的字体文件".into());
    }

    Ok(InstallPlan {
        family,
        version: meta
            .get("npmVersion")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        license: meta
            .get("license")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        category: meta
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        subsets,
        weights: wanted,
        styles: styles_out,
        faces,
    })
}

/// 下载地址的镜像候选：官方 jsDelivr 在部分网络会重置连接，换 fastly 再试。
fn host_candidates(url: &str) -> Vec<String> {
    let mut out = vec![url.to_string()];
    if url.contains("cdn.jsdelivr.net") {
        out.push(url.replace("cdn.jsdelivr.net", "fastly.jsdelivr.net"));
    } else if url.contains("fastly.jsdelivr.net") {
        out.push(url.replace("fastly.jsdelivr.net", "cdn.jsdelivr.net"));
    }
    out
}

async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut last_error = String::new();
    for candidate in host_candidates(url) {
        for attempt in 0..2u64 {
            if CANCEL.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            match client
                .get(&candidate)
                .timeout(Duration::from_secs(45))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    return response
                        .bytes()
                        .await
                        .map(|bytes| bytes.to_vec())
                        .map_err(|error| format!("读取字体文件失败：{error}"));
                }
                Ok(response) => last_error = format!("HTTP {}", response.status()),
                Err(error) => last_error = error.to_string(),
            }
            if attempt == 0 {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
    Err(format!("下载字体文件失败：{last_error}"))
}

fn emit_progress(emit: Emit<'_>, progress: FontProgress) {
    let payload = serde_json::to_value(progress).unwrap_or_default();
    emit(EVENT_PROGRESS, payload);
}

fn progress(id: &str, phase: &str, done: u32, total: u32, bytes: u64) -> FontProgress {
    FontProgress {
        id: id.to_string(),
        phase: phase.to_string(),
        files_done: done,
        files_total: total,
        bytes,
        message: None,
    }
}

/// 清理上次异常退出留下的临时目录；只在没有安装任务时执行。
fn cleanup_temp(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".tmp-") {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

async fn run_install(
    data_dir: &Path,
    client: &reqwest::Client,
    emit: Emit<'_>,
    source_id: &str,
    weights: Vec<u16>,
) -> Result<FontManifest, String> {
    emit_progress(emit, progress(&format!("fs-{source_id}"), "meta", 0, 0, 0));
    let meta = fetch_font_meta(client, source_id).await?;
    let plan = build_install_plan(&meta, &weights)?;
    let id = format!("fs-{source_id}");
    if !valid_id(&id) {
        return Err(format!("字体 id 非法：{id}"));
    }

    let root = fonts_dir(data_dir)?;
    fs::create_dir_all(&root).map_err(|error| format!("创建字体目录失败：{error}"))?;
    let temp_dir = root.join(format!(".tmp-{id}"));
    let final_dir = root.join(&id);
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(temp_dir.join("files"))
        .map_err(|error| format!("创建临时目录失败：{error}"))?;

    let total = plan.faces.len() as u32;
    let done_files = std::sync::Arc::new(AtomicU32::new(0));
    let done_bytes = std::sync::Arc::new(AtomicU64::new(0));

    emit_progress(emit, progress(&id, "download", 0, total, 0));

    let results: Vec<Result<(FacePlan, Vec<u8>), String>> = stream::iter(
        plan.faces
            .clone()
            .into_iter()
            .map(|face| {
                let client = client.clone();
                let id = id.clone();
                let done_files = done_files.clone();
                let done_bytes = done_bytes.clone();
                let temp_dir = temp_dir.clone();
                async move {
                    let data = fetch_bytes(&client, &face.url).await?;
                    let size = data.len() as u64;
                    let path = temp_dir.join(&face.file);
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                    }
                    fs::write(&path, &data)
                        .map_err(|error| format!("写入字体文件失败：{error}"))?;
                    let files = done_files.fetch_add(1, Ordering::Relaxed) + 1;
                    let total_bytes = done_bytes.fetch_add(size, Ordering::Relaxed) + size;
                    emit_progress(emit, progress(&id, "download", files, total, total_bytes));
                    Ok((face, data))
                }
            })
            .collect::<Vec<_>>(),
    )
    .buffer_unordered(CONCURRENCY)
    .collect()
    .await;

    let mut faces = Vec::with_capacity(results.len());
    for result in results {
        match result {
            Ok((face, data)) => {
                let _ = data;
                faces.push(FontFace {
                    file: face.file,
                    weight: face.weight,
                    style: face.style,
                    subset: face.subset,
                    unicode_range: face.unicode_range,
                });
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&temp_dir);
                let mut payload = progress(&id, "error", 0, total, 0);
                payload.message = Some(error.clone());
                emit_progress(emit, payload);
                return Err(error);
            }
        }
    }

    faces.sort_by(|a, b| {
        a.weight
            .cmp(&b.weight)
            .then_with(|| a.style.cmp(&b.style))
            .then_with(|| a.file.cmp(&b.file))
    });

    let manifest = FontManifest {
        id: id.clone(),
        family: plan.family,
        source: "fontsource".into(),
        source_id: source_id.to_string(),
        version: plan.version,
        license: plan.license,
        category: plan.category,
        subsets: plan.subsets,
        weights: plan.weights,
        styles: plan.styles,
        bytes: 0,
        installed_at: now_secs(),
        faces,
        dir: String::new(),
    };
    emit_progress(
        emit,
        progress(
            &id,
            "write",
            total,
            total,
            done_bytes.load(Ordering::Relaxed),
        ),
    );
    write_json(&temp_dir.join("manifest.json"), &manifest)?;

    if final_dir.exists() {
        fs::remove_dir_all(&final_dir).map_err(|error| format!("覆盖旧字体失败：{error}"))?;
    }
    fs::rename(&temp_dir, &final_dir).map_err(|error| format!("安装字体失败：{error}"))?;

    let bytes = dir_size(&final_dir);
    let installed = FontManifest {
        bytes,
        dir: final_dir.to_string_lossy().into_owned(),
        ..manifest
    };
    let stored = FontManifest {
        dir: String::new(),
        ..installed.clone()
    };
    write_json(&final_dir.join("manifest.json"), &stored)?;
    emit_progress(emit, progress(&id, "done", total, total, bytes));
    Ok(installed)
}

/// 安装一款 Fontsource 字体。命令会一直等到下载完成（或失败 / 取消）。
pub async fn install(
    data_dir: &Path,
    client: &reqwest::Client,
    emit: Emit<'_>,
    id: String,
    weights: Vec<u16>,
) -> Result<FontManifest, String> {
    if !valid_id(&format!("fs-{id}")) {
        return Err(format!("非法字体 id：{id}"));
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("已有字体正在安装".into());
    }
    CANCEL.store(false, Ordering::Relaxed);
    if let Ok(mut active) = ACTIVE.lock() {
        *active = Some(format!("fs-{id}"));
    }

    let result = run_install(data_dir, client, emit, &id, weights).await;

    RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut active) = ACTIVE.lock() {
        *active = None;
    }
    if let Err(error) = &result {
        let mut payload = progress(&format!("fs-{id}"), "error", 0, 0, 0);
        payload.message = Some(error.clone());
        emit_progress(emit, payload);
    }
    result
}

/// 取消当前安装（下一个分片前停下）。
pub fn cancel(id: Option<String>) {
    if let Some(id) = id {
        if let Ok(active) = ACTIVE.lock() {
            if active.as_deref() != Some(id.as_str()) {
                return;
            }
        }
    }
    CANCEL.store(true, Ordering::Relaxed);
}

/// 列出已安装字体。
pub fn list(data_dir: &Path) -> Result<Vec<FontManifest>, String> {
    let root = fonts_dir(data_dir)?;
    if !RUNNING.load(Ordering::Relaxed) {
        cleanup_temp(&root);
    }
    installed_fonts(data_dir)
}

/// 删除已安装字体。引用它的工程会回退到默认字体。
pub fn remove(data_dir: &Path, id: String) -> Result<(), String> {
    if let Ok(active) = ACTIVE.lock() {
        if active.as_deref() == Some(id.as_str()) {
            return Err("字体正在安装，无法删除".into());
        }
    }
    let dir = font_dir(data_dir, &id)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| format!("删除字体失败：{error}"))?;
    }
    Ok(())
}

fn font_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn parse_font_meta(data: &[u8]) -> (Option<String>, u16, String) {
    let Ok(face) = ttf_parser::Face::parse(data, 0) else {
        return (None, 400, "normal".into());
    };
    let mut family = None;
    let mut typographic = None;
    for name in face.names() {
        if !name.is_unicode() {
            continue;
        }
        match name.name_id {
            1 if family.is_none() => family = name.to_string(),
            16 if typographic.is_none() => typographic = name.to_string(),
            _ => {}
        }
    }
    let style = if face.is_italic() {
        "italic"
    } else if face.is_oblique() {
        "oblique"
    } else {
        "normal"
    };
    (
        typographic.or(family),
        face.weight().to_number(),
        style.to_string(),
    )
}

/// 读取本地字体文件的元数据（解析失败时 family 为 null，由界面让用户手填）。
pub fn probe(path: String) -> Result<FontProbe, String> {
    let path = PathBuf::from(path);
    let bytes = fs::metadata(&path)
        .map_err(|error| format!("读取字体文件失败：{error}"))?
        .len();
    if bytes > MAX_IMPORT_BYTES {
        return Err("字体文件超过 80 MB".into());
    }
    let data = fs::read(&path).map_err(|error| format!("读取字体文件失败：{error}"))?;
    let (family, weight, style) = parse_font_meta(&data);
    Ok(FontProbe {
        family,
        weight,
        style,
        format: font_extension(&path).unwrap_or_else(|| "ttf".into()),
        bytes,
    })
}

/// 导入本地字体：复制进数据目录；同 family 的字体合并字重。
pub fn import(
    data_dir: &Path,
    path: String,
    family: Option<String>,
    weight: Option<u16>,
    style: Option<String>,
) -> Result<FontManifest, String> {
    let source = PathBuf::from(&path);
    let extension = font_extension(&source).ok_or_else(|| "无法识别字体格式".to_string())?;
    if !matches!(extension.as_str(), "ttf" | "otf" | "woff" | "woff2") {
        return Err(format!("不支持的字体格式：.{extension}"));
    }
    let meta = fs::metadata(&source).map_err(|error| format!("读取字体文件失败：{error}"))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err("字体文件超过 80 MB".into());
    }
    let data = fs::read(&source).map_err(|error| format!("读取字体文件失败：{error}"))?;
    let (parsed_family, parsed_weight, parsed_style) = parse_font_meta(&data);
    let family = family
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(parsed_family)
        .or_else(|| {
            source
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.to_string())
        })
        .ok_or_else(|| "无法确定字体名称".to_string())?;
    let weight = weight.unwrap_or(parsed_weight).clamp(1, 1000);
    let style = style
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "normal" | "italic" | "oblique"))
        .unwrap_or(parsed_style);

    let root = fonts_dir(data_dir)?;
    fs::create_dir_all(&root).map_err(|error| format!("创建字体目录失败：{error}"))?;

    // 同 family 的本字体合并到已有条目；否则新建。
    let existing = installed_fonts(data_dir)?
        .into_iter()
        .find(|font| font.source == "local" && font.family.eq_ignore_ascii_case(&family));
    let id = existing
        .as_ref()
        .map(|font| font.id.clone())
        .unwrap_or_else(|| {
            let hash = fnv1a(format!("{family}|{}", source.display()).as_bytes()) & 0x00ff_ffff;
            format!("local-{}-{hash:06x}", slugify(&family))
        });
    let dir = font_dir(data_dir, &id)?;
    fs::create_dir_all(dir.join("files")).map_err(|error| format!("创建字体目录失败：{error}"))?;

    // 文件名带上字重 / 样式：同 family 的不同字重不会互相覆盖。
    let stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .map(slugify)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "font".to_string());
    let file_name = format!("{stem}-{weight}-{style}.{extension}");
    fs::copy(&source, dir.join("files").join(&file_name))
        .map_err(|error| format!("复制字体文件失败：{error}"))?;

    let mut manifest = existing.unwrap_or(FontManifest {
        id: id.clone(),
        family,
        source: "local".into(),
        source_id: String::new(),
        version: String::new(),
        license: String::new(),
        category: String::new(),
        subsets: vec!["custom".into()],
        weights: Vec::new(),
        styles: Vec::new(),
        bytes: 0,
        installed_at: now_secs(),
        faces: Vec::new(),
        dir: String::new(),
    });
    let replaced: Vec<String> = manifest
        .faces
        .iter()
        .filter(|face| face.weight == weight && face.style.eq_ignore_ascii_case(&style))
        .map(|face| face.file.clone())
        .collect();
    for file in replaced {
        // 同一字重 / 样式换了文件：先删旧文件，别留下孤儿占空间。
        if file != format!("files/{file_name}") {
            let _ = fs::remove_file(dir.join(file));
        }
    }
    manifest
        .faces
        .retain(|face| !(face.weight == weight && face.style.eq_ignore_ascii_case(&style)));
    manifest.faces.push(FontFace {
        file: format!("files/{file_name}"),
        weight,
        style: style.clone(),
        subset: "custom".into(),
        unicode_range: None,
    });
    manifest
        .faces
        .sort_by(|a, b| a.weight.cmp(&b.weight).then_with(|| a.style.cmp(&b.style)));
    manifest.weights = {
        let mut values: Vec<u16> = manifest.faces.iter().map(|face| face.weight).collect();
        values.sort_unstable();
        values.dedup();
        values
    };
    manifest.styles = {
        let mut values: Vec<String> = manifest
            .faces
            .iter()
            .map(|face| face.style.clone())
            .collect();
        values.sort();
        values.dedup();
        values
    };
    manifest.bytes = dir_size(&dir);
    let dir_string = dir.to_string_lossy().into_owned();
    let stored = FontManifest {
        dir: String::new(),
        ..manifest.clone()
    };
    write_json(&dir.join("manifest.json"), &stored)?;
    manifest.dir = dir_string;
    Ok(manifest)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cjk_meta() -> Value {
        json!({
            "family": "Demo SC",
            "npmVersion": "5.0.0",
            "license": "OFL-1.1",
            "category": "sans-serif",
            "subsets": ["chinese-simplified", "latin"],
            "defSubset": "latin",
            "variants": {
                "400": {
                    "normal": {
                        "4": { "url": { "woff2": "https://cdn.jsdelivr.net/fontsource/fonts/demo-sc@5.0.0/4-400-normal.woff2" } },
                        "119": { "url": { "woff2": "https://cdn.jsdelivr.net/fontsource/fonts/demo-sc@5.0.0/119-400-normal.woff2" } },
                        "latin": { "url": { "woff2": "https://cdn.jsdelivr.net/fontsource/fonts/demo-sc@5.0.0/latin-400-normal.woff2" } }
                    }
                }
            },
            "unicodeRange": {
                "[4]": "U+1F300-1F5FF",
                "[119]": "U+20-7E",
                "latin": "U+0-FF"
            }
        })
    }

    #[test]
    fn cjk_font_uses_all_numbered_slices() {
        let plan = build_install_plan(&cjk_meta(), &[400]).expect("plan");
        assert_eq!(plan.family, "Demo SC");
        assert_eq!(plan.faces.len(), 2);
        assert_eq!(plan.faces[0].file, "4-400-normal.woff2");
        assert_eq!(plan.faces[1].file, "119-400-normal.woff2");
        assert_eq!(plan.faces[1].unicode_range.as_deref(), Some("U+20-7E"));
        assert_eq!(plan.faces[0].subset, "chinese-simplified");
    }

    #[test]
    fn latin_font_uses_named_subset() {
        let meta = json!({
            "family": "Demo Sans",
            "subsets": ["latin", "latin-ext"],
            "defSubset": "latin",
            "variants": {
                "400": { "normal": {
                    "latin": { "url": { "woff2": "https://cdn.jsdelivr.net/demo/latin-400-normal.woff2" } }
                }},
                "700": { "normal": {
                    "latin": { "url": { "woff2": "https://cdn.jsdelivr.net/demo/latin-700-normal.woff2" } }
                }}
            },
            "unicodeRange": { "latin": "U+0-FF" }
        });
        let plan = build_install_plan(&meta, &[400, 700]).expect("plan");
        assert_eq!(plan.faces.len(), 2);
        assert_eq!(plan.weights, vec![400, 700]);
        assert_eq!(plan.faces[0].subset, "latin");
    }

    #[test]
    fn every_named_subset_is_installed_for_multilingual_fonts() {
        let meta = json!({
            "family": "Demo Arabic",
            "subsets": ["arabic", "latin"],
            "defSubset": "arabic",
            "variants": {
                "400": { "normal": {
                    "arabic": { "url": { "woff2": "https://x/arabic-400-normal.woff2" } },
                    "latin": { "url": { "woff2": "https://x/latin-400-normal.woff2" } },
                    "latin-ext": { "url": { "woff2": "https://x/latin-ext-400-normal.woff2" } }
                }}
            },
            "unicodeRange": { "arabic": "U+600-6FF", "latin": "U+0-FF", "latin-ext": "U+100-24F" }
        });
        let plan = build_install_plan(&meta, &[400]).expect("plan");
        assert_eq!(plan.faces.len(), 3);
        // 主语言排在最前，其余子集也全都要装。
        assert_eq!(plan.faces[0].subset, "arabic");
        assert_eq!(plan.faces[1].subset, "latin");
        assert_eq!(plan.faces[2].subset, "latin-ext");
        assert_eq!(plan.faces[0].unicode_range.as_deref(), Some("U+600-6FF"));
    }

    #[test]
    fn missing_unicode_ranges_fall_back_to_named_subset() {
        let meta = json!({
            "family": "Demo SC",
            "subsets": ["chinese-simplified", "latin"],
            "defSubset": "latin",
            "variants": {
                "400": { "normal": {
                    "4": { "url": { "woff2": "https://x/4-400-normal.woff2" } },
                    "latin": { "url": { "woff2": "https://x/latin-400-normal.woff2" } },
                    "chinese-simplified": { "url": { "woff2": "https://x/chinese-simplified-400-normal.woff2" } }
                }}
            }
        });
        // 分片不可用时退回命名字集：latin 与中文各一个，覆盖不丢。
        let plan = build_install_plan(&meta, &[400]).expect("plan");
        assert_eq!(plan.faces.len(), 2);
        let files: Vec<&str> = plan.faces.iter().map(|face| face.file.as_str()).collect();
        assert!(files.contains(&"chinese-simplified-400-normal.woff2"));
        assert!(files.contains(&"latin-400-normal.woff2"));
    }

    #[test]
    fn requested_weights_are_filtered_to_available() {
        let meta = json!({
            "family": "Demo",
            "variants": { "400": { "normal": {
                "latin": { "url": { "woff2": "https://x/latin-400-normal.woff2" } }
            }}}
        });
        let plan = build_install_plan(&meta, &[300, 400, 900]).expect("plan");
        assert_eq!(plan.weights, vec![400]);
        assert_eq!(plan.faces.len(), 1);
    }

    #[test]
    fn host_fallback_swaps_jsdelivr() {
        let urls = host_candidates("https://cdn.jsdelivr.net/npm/x.woff2");
        assert_eq!(urls.len(), 2);
        assert!(urls[1].starts_with("https://fastly.jsdelivr.net/"));
        let back = host_candidates("https://fastly.jsdelivr.net/npm/x.woff2");
        assert_eq!(back[1], "https://cdn.jsdelivr.net/npm/x.woff2");
    }

    #[test]
    fn manifest_roundtrip_and_validation() {
        let dir = std::env::temp_dir().join(format!("aicut-font-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let manifest = FontManifest {
            id: "fs-demo".into(),
            family: "Demo".into(),
            source: "fontsource".into(),
            source_id: "demo".into(),
            version: "1.0.0".into(),
            license: "OFL-1.1".into(),
            category: "sans-serif".into(),
            subsets: vec!["latin".into()],
            weights: vec![400],
            styles: vec!["normal".into()],
            bytes: 10,
            installed_at: 1,
            faces: vec![FontFace {
                file: "files/latin-400-normal.woff2".into(),
                weight: 400,
                style: "normal".into(),
                subset: "latin".into(),
                unicode_range: Some("U+0-FF".into()),
            }],
            dir: String::new(),
        };
        write_json(&dir.join("manifest.json"), &manifest).unwrap();
        let loaded = read_manifest(&dir).expect("manifest");
        assert_eq!(loaded.family, "Demo");
        assert_eq!(loaded.faces.len(), 1);
        assert_eq!(loaded.dir, dir.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ids_are_safe_directory_names() {
        assert!(valid_id("fs-noto-sans-sc"));
        assert!(valid_id("local-source-han-serif-3f9a2c"));
        assert!(!valid_id("../escape"));
        assert!(!valid_id("fs/noto"));
        assert!(!valid_id(""));
        assert_eq!(slugify("Source Han Serif SC"), "source-han-serif-sc");
        assert_eq!(slugify("  思源黑体  "), "font");
    }
}
