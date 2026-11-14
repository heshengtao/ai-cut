//! 领域写操作的 Rust 包装（AI 产出物落位）+ 模型/素材定位。
//!
//! **分工**：模型推理在 Rust（`audio_ai` / `video_ai` / `asr` / `tts` / `voice_change`），
//! "把结果接回时间线"交给领域层——`AICUT.op(...)` 与桌面 `core/aiActions` 调的是
//! **同一批纯函数**（`addStemTracks` / `applyProcessedAudio` / `applyCuts` /
//! `insertCueTrack` / `placeVoiceover` / `replaceClipVideo` …）。
//!
//! 这样两个形态不会出现"桌面替换片段音频、容器另开一轨"这类静默漂移：落位规则只有
//! 一份实现，改一处两边同时生效。

use serde_json::{Value, json};

use crate::agent_bridge;
use crate::host::Host;
use crate::models::{self, ModelEntry};
use crate::DocHandle;

// ---------------------------------------------------------------------------
// 模型选择（与桌面 `core/aiActions` 的 pickInstalledModel / requireInstalled 同语义）
// ---------------------------------------------------------------------------

fn model_options(feature: &str) -> String {
    let options: Vec<String> = models::all()
        .iter()
        .filter(|entry| entry.feature == feature)
        .map(|entry| format!("{}（{}）", entry.id, entry.name))
        .collect();
    if options.is_empty() {
        "清单为空".to_string()
    } else {
        options.join("、")
    }
}

/// 按 id 或 feature 找一个**已安装**的模型；找不到就带着可选清单报错。
pub fn pick_installed(
    host: &dyn Host,
    feature: &str,
    model_id: Option<&str>,
    label: &str,
) -> Result<&'static ModelEntry, String> {
    let entry = match model_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            let entry = models::by_id(id).ok_or_else(|| format!("未知模型：{id}"))?;
            if entry.feature != feature {
                return Err(format!(
                    "{} 不是{}模型（feature={}）",
                    entry.name, label, entry.feature
                ));
            }
            entry
        }
        None => models::all()
            .iter()
            .find(|entry| entry.feature == feature && models::installed_dir(host, entry).is_some())
            .ok_or_else(|| {
                format!(
                    "没有已安装的{label}模型。先调用 download_model，或从这些 id 里选一个：{}",
                    model_options(feature)
                )
            })?,
    };
    if models::installed_dir(host, entry).is_none() {
        return Err(format!(
            "{label}模型尚未安装：{}（{}）。先调用 download_model。",
            entry.name, entry.id
        ));
    }
    Ok(entry)
}

/// 只要该 feature 下有任意已安装模型（VAD / 对齐器这类隐含依赖）。
pub fn require_installed(
    host: &dyn Host,
    feature: &str,
    label: &str,
) -> Result<&'static ModelEntry, String> {
    models::all()
        .iter()
        .find(|entry| entry.feature == feature && models::installed_dir(host, entry).is_some())
        .ok_or_else(|| format!("{label}模型尚未安装。先调用 download_model，可选：{}", model_options(feature)))
}

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif", "avif", "heic", "heif", "svg",
];
const VIDEO_EXTS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "mts", "m2ts", "ts", "mpg", "mpeg",
    "3gp", "ogv", "mxf", "asf", "rm", "rmvb", "dv",
];
const AUDIO_EXTS: &[&str] = &[
    "wav", "mp3", "mp2", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "aiff", "aif", "aifc",
    "wma", "mka", "ac3", "eac3", "dts", "amr", "caf", "ape", "wv",
];

/// 取文件名（兼容两种分隔符）。
pub fn base_name(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    match normalized.rsplit_once('/') {
        Some((_, name)) => name.to_string(),
        None => normalized,
    }
}

/// 小写扩展名（没有则空串）。
pub fn ext_of(path: &str) -> String {
    let name = base_name(path);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// 按扩展名判定素材类型（与前端 `kindFromPath` 同一套集合）。
pub fn kind_from_path(path: &str) -> Option<&'static str> {
    let ext = ext_of(path);
    if IMAGE_EXTS.contains(&ext.as_str()) {
        Some("image")
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Some("video")
    } else if AUDIO_EXTS.contains(&ext.as_str()) {
        Some("audio")
    } else {
        None
    }
}

/// 模型输出的落盘文件 → `MediaAsset`（字段与前端 `importAssetAt` 一致）。
///
/// 之前这里是手写的 `{hash, createdAt, hasVideo}`——那些字段 `MediaAsset` 里根本
/// 没有，缺的 `addedAt` 又让素材库显示 `undefined`。现在统一按真形状构造。
pub async fn asset_for(
    host: &dyn Host,
    path: &str,
    name: Option<&str>,
    kind_hint: Option<&'static str>,
) -> Result<Value, String> {
    let kind = kind_hint
        .or_else(|| kind_from_path(path))
        .ok_or_else(|| format!("不支持的素材类型：{}", base_name(path)))?;
    let meta = match crate::media::probe_media(host, path.to_string()).await {
        Ok(meta) => meta,
        // 图片（SVG / HEIC）不一定能被 ffprobe 读出来，读不出来也允许登记。
        Err(error) => {
            if kind != "image" {
                return Err(error);
            }
            crate::media::MediaMeta::default()
        }
    };
    let duration = if kind == "image" { 0.0 } else { meta.duration };
    let display_name = name
        .map(str::to_string)
        .unwrap_or_else(|| base_name(path));
    let mut asset = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "name": display_name,
        "kind": kind,
        "src": path,
        "duration": duration,
        "addedAt": chrono_like_now_ms(),
        "hasAudio": meta.has_audio,
    });
    if let Some(map) = asset.as_object_mut() {
        if let Some(width) = meta.width {
            map.insert("width".into(), json!(width));
        }
        if let Some(height) = meta.height {
            map.insert("height".into(), json!(height));
        }
        if let Some(fps) = meta.fps {
            map.insert("fps".into(), json!(fps));
        }
    }
    Ok(asset)
}

/// 毫秒时间戳（Rust 侧没有 chrono 依赖，用 SystemTime 算）。
fn chrono_like_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|span| span.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

/// 调一次领域写操作；`{ok:false}` 转成 `Err`。
pub async fn call(doc: &DocHandle, kind: &str, args: Value) -> Result<Value, String> {
    let text = doc.op(kind.to_string(), args.to_string()).await?;
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        let error = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("领域操作失败（没有返回原因）");
        return Err(error.to_string());
    }
    Ok(value)
}

/// 单个片段的领域视图（`asset.src` / `clip.start` 等就在这里）。
pub async fn clip_view(doc: &DocHandle, clip_id: &str) -> Result<Value, String> {
    agent_bridge::call(doc, "project.clip", json!({ "clipId": clip_id })).await
}

/// 按 id 找素材（直接读快照：素材列表是分页视图，按 id 查还得自己翻页）。
pub async fn asset_by_id(doc: &DocHandle, asset_id: &str) -> Result<Value, String> {
    let text = doc.snapshot().await?;
    let snapshot: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    snapshot
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset.get("id").and_then(Value::as_str) == Some(asset_id))
        })
        .cloned()
        .ok_or_else(|| format!("素材不存在：{asset_id}"))
}

/// 时间线帧率。
pub async fn fps_of(doc: &DocHandle) -> Result<f64, String> {
    let text = doc.snapshot().await?;
    let snapshot: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(snapshot.get("fps").and_then(Value::as_f64).unwrap_or(30.0))
}


// ---------------------------------------------------------------------------
// 配置（与 RPC / 桌面落在同一批配置文件上）
// ---------------------------------------------------------------------------

/// 网络配置（代理 / 模型源 / 插件注册表）：`<配置目录>/network.json`。
///
/// 工具调用时现读一次：设置页改完就落盘，读盘结果与内存实例一致，
/// 这样 `agent_tools::dispatch` 不需要把 `RpcCtx` 的半个世界透传进来。
pub fn network_of(host: &dyn Host) -> crate::network::NetworkRuntime {
    crate::network::NetworkRuntime::load(Some(host.config_dir().join("network.json")))
}

/// 云端 TTS 服务配置：`<配置目录>/tts.json`。
pub fn cloud_tts_of(host: &dyn Host) -> crate::cloud_tts::CloudTtsRuntime {
    crate::cloud_tts::CloudTtsRuntime::load(Some(host.config_dir().join("tts.json")))
}

/// `ai.json`（OpenAI 兼容端点）：翻译复用智能体那一份配置。
#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct AiConfigFile {
    base_url: String,
    api_key: String,
    model: String,
}

pub fn ai_endpoint(host: &dyn Host) -> crate::audio_ai::TranslateEndpoint {
    let config = std::fs::read_to_string(host.config_dir().join("ai.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<AiConfigFile>(&text).ok())
        .unwrap_or_default();
    crate::audio_ai::TranslateEndpoint {
        base_url: config.base_url,
        api_key: config.api_key,
        model: config.model,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_follow_extension() {
        assert_eq!(kind_from_path("/a/b.wav"), Some("audio"));
        assert_eq!(kind_from_path("/a/b.MP4"), Some("video"));
        assert_eq!(kind_from_path("c:\\a\\b.png"), Some("image"));
        assert_eq!(kind_from_path("/a/b.unknown"), None);
        assert_eq!(base_name("/a/b c.wav"), "b c.wav");
        assert_eq!(ext_of("/a/b.WAV"), "wav");
    }
}
