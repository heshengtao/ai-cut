//! 云端图像 / 视频生成。
//!
//! 与 `cloud_tts` 同一套形态：配置落 `cloud-gen.json`，每家供应商一个条目，
//! 能力（文生图 / 图生图 / 文生视频 / 图生视频）按 `kind` 给默认值、用户可覆盖。
//!
//! 供应商优先级：**官方 API**（OpenAI / Gemini / Stability / BFL / 百炼 / 方舟 /
//! 可灵 / MiniMax / Runway / Luma）→ **聚合站**（OpenRouter / SiliconFlow /
//! Replicate / fal）。所有请求都是标准 HTTP，不需要 SDK。
//!
//! 图像统一落成 PNG（非 PNG 走 ffmpeg 转一遍），视频落成 MP4 并用 ffprobe 取时长，
//! 这样时间线 / 素材库那边的导入逻辑与本地 sd.cpp 生成的产物完全一致。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::image_gen;
use crate::media;
use crate::network::NetworkRuntime;
use crate::sidecar;

pub const EVENT_CLOUD_GEN: &str = "cloud-gen-progress";

const HTTP_TIMEOUT: Duration = Duration::from_secs(180);
const IMAGE_TIMEOUT: Duration = Duration::from_secs(600);
const VIDEO_TIMEOUT: Duration = Duration::from_secs(1800);
const POLL_INTERVAL: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CloudGenKind {
    #[default]
    Openai,
    Gemini,
    Stability,
    Bfl,
    Dashscope,
    Ark,
    Kling,
    Minimax,
    Runway,
    Luma,
    Replicate,
    Fal,
    Openrouter,
    Siliconflow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum GenCapability {
    /// 文生图。
    T2i,
    /// 图生图 / 指令改图。
    I2i,
    /// 文生视频。
    T2v,
    /// 图生视频（首帧）。
    I2v,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudGenProvider {
    pub id: String,
    pub name: String,
    pub kind: CloudGenKind,
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    /// 需要 AK/SK 的服务（可灵）用；其余留空。
    pub api_secret: String,
    /// MiniMax 的 GroupId。
    pub group_id: String,
    pub image_model: String,
    pub edit_model: String,
    pub video_model: String,
    /// 覆盖能力；留空 = 用 kind 的默认值。
    pub capabilities: Vec<GenCapability>,
}

impl Default for CloudGenProvider {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: CloudGenKind::Openai,
            enabled: true,
            base_url: String::new(),
            api_key: String::new(),
            api_secret: String::new(),
            group_id: String::new(),
            image_model: String::new(),
            edit_model: String::new(),
            video_model: String::new(),
            capabilities: Vec::new(),
        }
    }
}

impl CloudGenProvider {
    fn effective_caps(&self) -> Vec<GenCapability> {
        if self.capabilities.is_empty() {
            preset(self.kind).capabilities.to_vec()
        } else {
            self.capabilities.clone()
        }
    }

    fn supports(&self, capability: GenCapability) -> bool {
        self.effective_caps().contains(&capability)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudGenConfig {
    pub providers: Vec<CloudGenProvider>,
}

pub struct CloudGenRuntime {
    inner: Mutex<CloudGenConfig>,
    path: Option<PathBuf>,
}

impl CloudGenRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        // 逐条反序列化：某一条（比如未来新增的 kind）看不懂时只丢这一条，
        // 不回退成空表——用户配好的其它服务要留着。
        let mut config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .map(|value| CloudGenConfig {
                providers: value
                    .get("providers")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                serde_json::from_value::<CloudGenProvider>(item.clone()).ok()
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .unwrap_or_default();
        for provider in &mut config.providers {
            normalize(provider);
        }
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> CloudGenConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: CloudGenConfig) -> CloudGenConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    pub fn provider(&self, id: &str) -> Option<CloudGenProvider> {
        self.get().providers.into_iter().find(|item| item.id == id)
    }

    fn save(&self, config: &CloudGenConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[cloud-gen] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[cloud-gen] 序列化配置失败：{error}"),
        }
    }
}

fn normalize(provider: &mut CloudGenProvider) {
    if provider.id.trim().is_empty() {
        provider.id = uuid::Uuid::new_v4().to_string();
    }
    if provider.name.trim().is_empty() {
        provider.name = preset(provider.kind).name.to_string();
    }
    provider.name = provider.name.trim().to_string();
    provider.base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    provider.api_key = provider.api_key.trim().to_string();
    provider.api_secret = provider.api_secret.trim().to_string();
    provider.group_id = provider.group_id.trim().to_string();
    provider.image_model = provider.image_model.trim().to_string();
    provider.edit_model = provider.edit_model.trim().to_string();
    provider.video_model = provider.video_model.trim().to_string();
    let mut caps: Vec<GenCapability> = Vec::new();
    for capability in &provider.capabilities {
        if !caps.contains(capability) {
            caps.push(*capability);
        }
    }
    provider.capabilities = caps;
}

// ---------------------------------------------------------------------------
// 供应商预设
// ---------------------------------------------------------------------------

struct Preset {
    name: &'static str,
    group: &'static str,
    base_url: &'static str,
    image_model: &'static str,
    edit_model: &'static str,
    video_model: &'static str,
    capabilities: &'static [GenCapability],
}

const CAP_IMAGE: &[GenCapability] = &[GenCapability::T2i, GenCapability::I2i];
const CAP_IMAGE_VIDEO: &[GenCapability] = &[
    GenCapability::T2i,
    GenCapability::I2i,
    GenCapability::T2v,
    GenCapability::I2v,
];
const CAP_VIDEO: &[GenCapability] = &[GenCapability::T2v, GenCapability::I2v];

fn preset(kind: CloudGenKind) -> Preset {
    match kind {
        CloudGenKind::Openai => Preset {
            name: "OpenAI",
            group: "official",
            base_url: "https://api.openai.com/v1",
            image_model: "gpt-image-1",
            edit_model: "gpt-image-1",
            video_model: "",
            capabilities: CAP_IMAGE,
        },
        CloudGenKind::Gemini => Preset {
            name: "Google Gemini",
            group: "official",
            base_url: "https://generativelanguage.googleapis.com",
            image_model: "gemini-2.5-flash-image",
            edit_model: "gemini-2.5-flash-image",
            video_model: "veo-3.1-generate-preview",
            capabilities: CAP_IMAGE_VIDEO,
        },
        CloudGenKind::Stability => Preset {
            name: "Stability AI",
            group: "official",
            base_url: "https://api.stability.ai",
            image_model: "core",
            edit_model: "sd3",
            video_model: "",
            capabilities: CAP_IMAGE,
        },
        CloudGenKind::Bfl => Preset {
            name: "Black Forest Labs",
            group: "official",
            base_url: "https://api.bfl.ai",
            image_model: "flux-pro-1.1",
            edit_model: "flux-kontext-pro",
            video_model: "",
            capabilities: CAP_IMAGE,
        },
        CloudGenKind::Dashscope => Preset {
            name: "阿里云百炼",
            group: "official",
            base_url: "https://dashscope.aliyuncs.com",
            image_model: "qwen-image",
            edit_model: "qwen-image-edit",
            video_model: "wan2.5-t2v-preview",
            capabilities: CAP_IMAGE_VIDEO,
        },
        CloudGenKind::Ark => Preset {
            name: "火山方舟",
            group: "official",
            base_url: "https://ark.cn-beijing.volces.com/api/v3",
            image_model: "doubao-seedream-4-0-250828",
            edit_model: "doubao-seedream-4-0-250828",
            video_model: "doubao-seedance-1-0-pro-250528",
            capabilities: CAP_IMAGE_VIDEO,
        },
        CloudGenKind::Kling => Preset {
            name: "可灵 Kling",
            group: "official",
            base_url: "https://api-beijing.klingai.com",
            image_model: "kling-v2",
            edit_model: "",
            video_model: "kling-v2-1",
            capabilities: &[GenCapability::T2i, GenCapability::T2v, GenCapability::I2v],
        },
        CloudGenKind::Minimax => Preset {
            name: "MiniMax 海螺",
            group: "official",
            base_url: "https://api.minimax.chat",
            image_model: "image-01",
            edit_model: "",
            video_model: "MiniMax-Hailuo-02",
            capabilities: &[GenCapability::T2i, GenCapability::T2v, GenCapability::I2v],
        },
        CloudGenKind::Runway => Preset {
            name: "Runway",
            group: "official",
            base_url: "https://api.dev.runwayml.com",
            image_model: "",
            edit_model: "",
            video_model: "gen4_turbo",
            capabilities: CAP_VIDEO,
        },
        CloudGenKind::Luma => Preset {
            name: "Luma AI",
            group: "official",
            base_url: "https://api.lumalabs.ai",
            image_model: "",
            edit_model: "",
            video_model: "ray-2",
            capabilities: CAP_VIDEO,
        },
        CloudGenKind::Replicate => Preset {
            name: "Replicate",
            group: "aggregator",
            base_url: "https://api.replicate.com/v1",
            image_model: "black-forest-labs/flux-schnell",
            edit_model: "black-forest-labs/flux-kontext-pro",
            video_model: "minimax/hailuo-02",
            capabilities: &[GenCapability::T2i, GenCapability::T2v],
        },
        CloudGenKind::Fal => Preset {
            name: "fal.ai",
            group: "aggregator",
            base_url: "https://queue.fal.run",
            image_model: "fal-ai/flux/schnell",
            edit_model: "fal-ai/flux-pro/kontext",
            video_model: "fal-ai/veo3",
            capabilities: &[GenCapability::T2i, GenCapability::T2v, GenCapability::I2v],
        },
        CloudGenKind::Openrouter => Preset {
            name: "OpenRouter",
            group: "aggregator",
            base_url: "https://openrouter.ai/api",
            image_model: "google/gemini-2.5-flash-image",
            edit_model: "google/gemini-2.5-flash-image",
            video_model: "",
            capabilities: CAP_IMAGE,
        },
        CloudGenKind::Siliconflow => Preset {
            name: "SiliconFlow",
            group: "aggregator",
            base_url: "https://api.siliconflow.cn/v1",
            image_model: "Qwen/Qwen-Image",
            edit_model: "Qwen/Qwen-Image-Edit",
            video_model: "Wan-AI/Wan2.2-T2V-A14B",
            capabilities: CAP_IMAGE_VIDEO,
        },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudGenPreset {
    pub kind: CloudGenKind,
    pub name: &'static str,
    pub group: &'static str,
    pub base_url: &'static str,
    pub image_model: &'static str,
    pub edit_model: &'static str,
    pub video_model: &'static str,
    pub capabilities: Vec<GenCapability>,
}

// ---------------------------------------------------------------------------
// 请求 / 结果
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudImageRequest {
    pub provider_id: String,
    /// `draw` = 文生图；`edit` = 图生图。
    pub mode: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub width: u32,
    pub height: u32,
    /// 原图绝对路径（图生图）。
    pub init_image: Option<String>,
    /// 白色涂抹区域 + 透明背景的 PNG data URL（只有 OpenAI 编辑接口用得上）。
    pub mask_png: Option<String>,
    pub seed: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudVideoRequest {
    pub provider_id: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub width: u32,
    pub height: u32,
    pub seconds: f32,
    /// 首帧参考图（图生视频）。
    pub init_image: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudImageResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudVideoResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudGenProgress {
    pub state: String,
    pub message: Option<String>,
    pub progress: f32,
    pub elapsed: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudGenTest {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

// ---------------------------------------------------------------------------
// 任务状态
// ---------------------------------------------------------------------------

struct Runtime {
    running: AtomicBool,
    cancelled: AtomicBool,
}

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| Runtime {
        running: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
    })
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn cancelled() -> bool {
    runtime().cancelled.load(Ordering::Relaxed)
}

fn begin_task() -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有云端生成任务正在运行".into());
    }
    runtime().cancelled.store(false, Ordering::Relaxed);
    Ok(())
}

fn end_task() {
    runtime().running.store(false, Ordering::SeqCst);
}

fn emit(app: &AppHandle, state: &str, message: Option<String>, progress: f32, elapsed: f64) {
    let _ = app.emit(
        EVENT_CLOUD_GEN,
        CloudGenProgress {
            state: state.to_string(),
            message,
            progress: progress.clamp(0.0, 1.0),
            elapsed,
        },
    );
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cloud_gen_presets() -> Vec<CloudGenPreset> {
    const KINDS: &[CloudGenKind] = &[
        CloudGenKind::Openai,
        CloudGenKind::Gemini,
        CloudGenKind::Stability,
        CloudGenKind::Bfl,
        CloudGenKind::Dashscope,
        CloudGenKind::Ark,
        CloudGenKind::Kling,
        CloudGenKind::Minimax,
        CloudGenKind::Runway,
        CloudGenKind::Luma,
        CloudGenKind::Replicate,
        CloudGenKind::Fal,
        CloudGenKind::Openrouter,
        CloudGenKind::Siliconflow,
    ];
    KINDS
        .iter()
        .map(|kind| {
            let preset = preset(*kind);
            CloudGenPreset {
                kind: *kind,
                name: preset.name,
                group: preset.group,
                base_url: preset.base_url,
                image_model: preset.image_model,
                edit_model: preset.edit_model,
                video_model: preset.video_model,
                capabilities: preset.capabilities.to_vec(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn cloud_gen_config(state: State<'_, Arc<CloudGenRuntime>>) -> CloudGenConfig {
    state.get()
}

#[tauri::command]
pub fn cloud_gen_set_config(
    state: State<'_, Arc<CloudGenRuntime>>,
    mut providers: Vec<CloudGenProvider>,
) -> CloudGenConfig {
    for provider in &mut providers {
        normalize(provider);
    }
    state.set(CloudGenConfig { providers })
}

#[tauri::command]
pub fn cloud_gen_busy() -> bool {
    runtime().running.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn cloud_gen_cancel() {
    runtime().cancelled.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn cloud_gen_image(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudGenRuntime>>,
    request: CloudImageRequest,
) -> Result<CloudImageResult, String> {
    let provider = state
        .provider(&request.provider_id)
        .ok_or_else(|| format!("未找到生成服务：{}", request.provider_id))?;
    if !provider.enabled {
        return Err(format!("{} 已停用", provider.name));
    }
    let edit = request.mode == "edit";
    let capability = if edit {
        GenCapability::I2i
    } else {
        GenCapability::T2i
    };
    if !provider.supports(capability) {
        return Err(format!(
            "{} 不支持{}",
            provider.name,
            if edit { "图生图" } else { "文生图" }
        ));
    }
    if request.prompt.trim().is_empty() {
        return Err("提示词不能为空".into());
    }
    if edit && request.init_image.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err("图生图需要先选择一张原图".into());
    }
    let model = model_for(&provider, edit)?;
    let client = network.client()?;
    let call = Call::new(&provider, &client, &app)?;

    begin_task()?;
    let started = Instant::now();
    emit(&app, "preparing", Some("准备请求…".into()), 0.02, 0.0);

    let mut init_path: Option<PathBuf> = None;
    let mut mask_bytes: Option<Vec<u8>> = None;
    let mut setup_error: Option<String> = None;
    if let Some(source) = request.init_image.as_deref().filter(|text| !text.trim().is_empty()) {
        match image_gen::prepare_init_image(&app, source).await {
            Ok(path) => init_path = Some(path),
            Err(error) => setup_error = Some(error),
        }
    }
    if setup_error.is_none() {
        if let Some(mask) = request.mask_png.as_deref() {
            match decode_mask(mask) {
                Ok(bytes) => mask_bytes = Some(bytes),
                Err(error) => setup_error = Some(error),
            }
        }
    }
    let result = if let Some(error) = setup_error {
        Err(error)
    } else {
        let input = ImageInput {
            prompt: request.prompt.trim().to_string(),
            negative: request.negative_prompt.unwrap_or_default().trim().to_string(),
            width: request.width.clamp(256, 2048),
            height: request.height.clamp(256, 2048),
            init: init_path.clone(),
            mask: mask_bytes,
            seed: request.seed.unwrap_or(-1),
            model: model.clone(),
            edit,
        };
        async {
            emit(
                &app,
                "running",
                Some(format!("正在调用 {}…", provider.name)),
                0.12,
                started.elapsed().as_secs_f64(),
            );
            let bytes = call.image(&input).await?;
            emit(
                &app,
                "running",
                Some("保存结果…".into()),
                0.92,
                started.elapsed().as_secs_f64(),
            );
            save_image(&app, &bytes).await
        }
        .await
    };
    if let Some(path) = &init_path {
        let _ = std::fs::remove_file(path);
    }
    end_task();

    match result {
        Ok((path, width, height)) => {
            emit(&app, "done", Some("生成完成".into()), 1.0, started.elapsed().as_secs_f64());
            Ok(CloudImageResult {
                path,
                width,
                height,
                provider: provider.name,
                model,
            })
        }
        Err(error) => {
            if error.contains("已取消") {
                emit(&app, "cancelled", Some("已取消".into()), 0.0, started.elapsed().as_secs_f64());
            } else {
                emit(
                    &app,
                    "error",
                    Some(error.clone()),
                    0.0,
                    started.elapsed().as_secs_f64(),
                );
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn cloud_gen_video(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudGenRuntime>>,
    request: CloudVideoRequest,
) -> Result<CloudVideoResult, String> {
    let provider = state
        .provider(&request.provider_id)
        .ok_or_else(|| format!("未找到生成服务：{}", request.provider_id))?;
    if !provider.enabled {
        return Err(format!("{} 已停用", provider.name));
    }
    if request.prompt.trim().is_empty() {
        return Err("提示词不能为空".into());
    }
    let has_frame = request
        .init_image
        .as_deref()
        .map(str::trim)
        .map(|text| !text.is_empty())
        .unwrap_or(false);
    let capability = if has_frame {
        GenCapability::I2v
    } else {
        GenCapability::T2v
    };
    if !provider.supports(capability) {
        return Err(format!(
            "{} 不支持{}",
            provider.name,
            if has_frame { "图生视频" } else { "文生视频" }
        ));
    }
    let model = video_model_for(&provider)?;
    let client = network.client()?;
    let call = Call::new(&provider, &client, &app)?;

    begin_task()?;
    let started = Instant::now();
    emit(&app, "preparing", Some("准备请求…".into()), 0.02, 0.0);

    let mut init_path: Option<PathBuf> = None;
    if let Some(source) = request.init_image.as_deref().filter(|text| !text.trim().is_empty()) {
        match image_gen::prepare_init_image(&app, source).await {
            Ok(path) => init_path = Some(path),
            Err(error) => {
                end_task();
                emit(&app, "error", Some(error.clone()), 0.0, 0.0);
                return Err(error);
            }
        }
    }
    let input = VideoInput {
        prompt: request.prompt.trim().to_string(),
        negative: request.negative_prompt.unwrap_or_default().trim().to_string(),
        width: request.width.clamp(256, 2048),
        height: request.height.clamp(256, 2048),
        seconds: request.seconds.clamp(1.0, 30.0),
        init: init_path.clone(),
        model: model.clone(),
    };
    let result = async {
        emit(
            &app,
            "running",
            Some(format!("正在调用 {}…", provider.name)),
            0.08,
            started.elapsed().as_secs_f64(),
        );
        let source = call.video(&input).await?;
        emit(
            &app,
            "running",
            Some("下载视频…".into()),
            0.9,
            started.elapsed().as_secs_f64(),
        );
        let bytes = match source {
            VideoSource::Url(url) => download(&client, &url).await?,
            VideoSource::File(path) => {
                let bytes = std::fs::read(&path)
                    .map_err(|error| format!("读取生成视频失败：{error}"))?;
                let _ = std::fs::remove_file(&path);
                bytes
            }
        };
        save_video(&app, &bytes).await
    }
    .await;
    if let Some(path) = &init_path {
        let _ = std::fs::remove_file(path);
    }
    end_task();

    match result {
        Ok((path, width, height, duration)) => {
            emit(&app, "done", Some("生成完成".into()), 1.0, started.elapsed().as_secs_f64());
            Ok(CloudVideoResult {
                path,
                width,
                height,
                duration,
                provider: provider.name,
                model,
            })
        }
        Err(error) => {
            if error.contains("已取消") {
                emit(&app, "cancelled", Some("已取消".into()), 0.0, started.elapsed().as_secs_f64());
            } else {
                emit(
                    &app,
                    "error",
                    Some(error.clone()),
                    0.0,
                    started.elapsed().as_secs_f64(),
                );
            }
            Err(error)
        }
    }
}

/// 设置页的「测试」：用当前草稿真的生成一张 512 图，确认 Key / 模型 / 网络都通。
#[tauri::command]
pub async fn cloud_gen_test(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudGenProvider,
) -> Result<CloudGenTest, String> {
    let mut provider = provider;
    normalize(&mut provider);
    if !provider.supports(GenCapability::T2i) {
        return Err(format!("{} 没有文生图能力，请在 AI 页面直接测试", provider.name));
    }
    let model = model_for(&provider, false)?;
    let client = network.client()?;
    let call = Call::new(&provider, &client, &app)?;
    let input = ImageInput {
        prompt: "A red apple on a white table, product photo".into(),
        negative: String::new(),
        width: 512,
        height: 512,
        init: None,
        mask: None,
        seed: -1,
        model,
        edit: false,
    };
    begin_task()?;
    let result = async {
        let bytes = call.image(&input).await?;
        save_image(&app, &bytes).await
    }
    .await;
    end_task();
    let (path, width, height) = result?;
    Ok(CloudGenTest {
        path,
        width,
        height,
    })
}

// ---------------------------------------------------------------------------
// 模型解析
// ---------------------------------------------------------------------------

fn model_for(provider: &CloudGenProvider, edit: bool) -> Result<String, String> {
    let configured = if edit {
        &provider.edit_model
    } else {
        &provider.image_model
    };
    let value = configured.trim();
    if !value.is_empty() {
        return Ok(value.to_string());
    }
    let fallback = preset(provider.kind);
    let value = if edit {
        fallback.edit_model
    } else {
        fallback.image_model
    };
    if value.is_empty() {
        return Err(format!(
            "{} 需要填写{}模型名",
            provider.name,
            if edit { "图生图" } else { "文生图" }
        ));
    }
    Ok(value.to_string())
}

fn video_model_for(provider: &CloudGenProvider) -> Result<String, String> {
    let value = provider.video_model.trim();
    if !value.is_empty() {
        return Ok(value.to_string());
    }
    let fallback = preset(provider.kind).video_model;
    if fallback.is_empty() {
        return Err(format!("{} 需要填写视频模型名", provider.name));
    }
    Ok(fallback.to_string())
}

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

fn truncate(text: &str, limit: usize) -> String {
    let mut out: String = text.chars().take(limit).collect();
    if text.chars().count() > limit {
        out.push('…');
    }
    out
}

fn dig<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        if part.is_empty() {
            continue;
        }
        current = match current {
            Value::Array(items) => items.get(part.parse::<usize>().ok()?)?,
            Value::Object(map) => map.get(part)?,
            _ => return None,
        };
    }
    Some(current)
}

fn dig_str<'a>(value: &'a Value, path: &str) -> Option<&'a str> {
    dig(value, path).and_then(Value::as_str)
}

fn dig_str_first<'a>(value: &'a Value, paths: &[&str]) -> Option<&'a str> {
    paths.iter().find_map(|path| dig_str(value, path))
}

fn decode_b64(text: &str) -> Option<Vec<u8>> {
    let payload = match text.strip_prefix("data:") {
        Some(rest) => rest.split_once(',').map(|(_, data)| data)?,
        None => text,
    };
    let payload = payload.trim();
    if payload.is_empty() {
        return None;
    }
    base64::engine::general_purpose::STANDARD.decode(payload).ok()
}

fn decode_mask(png: &str) -> Result<Vec<u8>, String> {
    const LIMIT: usize = 32 * 1024 * 1024;
    let bytes = decode_b64(png.trim()).ok_or_else(|| "mask 数据无效".to_string())?;
    if bytes.is_empty() {
        return Err("mask 数据为空".into());
    }
    if bytes.len() > LIMIT {
        return Err("mask 图片过大".into());
    }
    Ok(bytes)
}

fn file_b64(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("读取原图失败：{error}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn file_data_url(path: &Path) -> Result<String, String> {
    Ok(format!(
        "data:image/png;base64,{}",
        file_b64(path)?
    ))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image.png".into())
}

fn base_url(provider: &CloudGenProvider) -> String {
    let configured = provider.base_url.trim().trim_end_matches('/');
    if configured.is_empty() {
        preset(provider.kind).base_url.trim_end_matches('/').to_string()
    } else {
        configured.to_string()
    }
}

/// 把任意宽高映射到供应商支持的「常见比例」里最接近的一档。
fn nearest_ratio(width: u32, height: u32) -> &'static str {
    const RATIOS: &[(&str, f32)] = &[
        ("1:1", 1.0),
        ("4:3", 4.0 / 3.0),
        ("3:2", 3.0 / 2.0),
        ("16:9", 16.0 / 9.0),
        ("21:9", 21.0 / 9.0),
        ("3:4", 3.0 / 4.0),
        ("2:3", 2.0 / 3.0),
        ("9:16", 9.0 / 16.0),
        ("9:21", 9.0 / 21.0),
    ];
    let target = width.max(1) as f32 / height.max(1) as f32;
    RATIOS
        .iter()
        .min_by(|a, b| {
            (a.1 / target).ln().abs().partial_cmp(&(b.1 / target).ln().abs()).unwrap()
        })
        .map(|item| item.0)
        .unwrap_or("1:1")
}

fn aspect_size(width: u32, height: u32) -> String {
    format!("{}x{}", width, height)
}

/// 百炼 / SiliconFlow 的视频尺寸只接受固定的几档，按画幅挑最接近的一档。
fn fixed_video_size(width: u32, height: u32, separator: char) -> String {
    let (w, h) = if width > height * 11 / 10 {
        (1280, 720)
    } else if height > width * 11 / 10 {
        (720, 1280)
    } else {
        (960, 960)
    };
    format!("{w}{separator}{h}")
}

/// SiliconFlow 的图片尺寸同样有白名单，按比例映射到允许的档位。
fn siliconflow_image_size(width: u32, height: u32) -> String {
    const ALLOWED: &[(u32, u32)] = &[
        (1024, 1024),
        (1280, 960),
        (960, 1280),
        (1024, 768),
        (768, 1024),
    ];
    let target = width.max(1) as f64 / height.max(1) as f64;
    let best = ALLOWED
        .iter()
        .min_by(|a, b| {
            let ra = a.0 as f64 / a.1 as f64;
            let rb = b.0 as f64 / b.1 as f64;
            (ra / target).ln().abs().partial_cmp(&(rb / target).ln().abs()).unwrap()
        })
        .copied()
        .unwrap_or((1024, 1024));
    format!("{}x{}", best.0, best.1)
}

async fn send_json(req: reqwest::RequestBuilder, label: &str) -> Result<Value, String> {
    let response = req
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("{label}请求失败：{error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{label}返回 {status}：{}", truncate(&text, 500)));
    }
    serde_json::from_str(&text)
        .map_err(|error| format!("{label}响应不是 JSON：{error}；{}", truncate(&text, 300)))
}

async fn send_bytes(req: reqwest::RequestBuilder, label: &str) -> Result<Vec<u8>, String> {
    let response = req
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("{label}请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{label}读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "{label}返回 {status}：{}",
            truncate(&String::from_utf8_lossy(&bytes), 500)
        ));
    }
    Ok(bytes.to_vec())
}

async fn download(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    if url.trim().is_empty() {
        return Err("下载地址为空".into());
    }
    let response = client
        .get(url)
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("下载生成结果失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取生成结果失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "下载生成结果返回 {status}：{}",
            truncate(&String::from_utf8_lossy(&bytes), 300)
        ));
    }
    if bytes.is_empty() {
        return Err("下载到的文件是空的".into());
    }
    Ok(bytes.to_vec())
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

fn sniff_ext(bytes: &[u8]) -> &'static str {
    if is_png(bytes) {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        "bin"
    }
}

async fn save_image(app: &AppHandle, bytes: &[u8]) -> Result<(String, u32, u32), String> {
    if bytes.is_empty() {
        return Err("生成结果为空".into());
    }
    let dir = media::cache_dir(app)?;
    let name = format!("cloud-gen-image-{}-{}", std::process::id(), stamp());
    if is_png(bytes) {
        let path = dir.join(format!("{name}.png"));
        std::fs::write(&path, bytes).map_err(|error| format!("写入图片失败：{error}"))?;
        let (width, height) =
            png_dimensions(bytes).ok_or_else(|| "生成结果不是有效的 PNG".to_string())?;
        return Ok((path.to_string_lossy().into_owned(), width, height));
    }
    let temp = dir.join(format!("{name}.{}", sniff_ext(bytes)));
    std::fs::write(&temp, bytes).map_err(|error| format!("写入临时图片失败：{error}"))?;
    let output = dir.join(format!("{name}.png"));
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        temp.to_string_lossy().into_owned(),
        "-frames:v".into(),
        "1".into(),
        output.to_string_lossy().into_owned(),
    ];
    let (code, _) = sidecar::run_sidecar(app, "ffmpeg", &args).await?;
    let _ = std::fs::remove_file(&temp);
    if code != Some(0) || !output.is_file() {
        return Err("无法把生成结果转成 PNG".into());
    }
    let bytes = std::fs::read(&output).map_err(|error| format!("读取 PNG 失败：{error}"))?;
    let (width, height) =
        png_dimensions(&bytes).ok_or_else(|| "转码后的 PNG 无法解析尺寸".to_string())?;
    Ok((output.to_string_lossy().into_owned(), width, height))
}

async fn save_video(
    app: &AppHandle,
    bytes: &[u8],
) -> Result<(String, u32, u32, f64), String> {
    if bytes.is_empty() {
        return Err("生成结果为空".into());
    }
    let dir = media::cache_dir(app)?;
    let path = dir.join(format!(
        "cloud-gen-video-{}-{}.mp4",
        std::process::id(),
        stamp()
    ));
    std::fs::write(&path, bytes).map_err(|error| format!("写入视频失败：{error}"))?;
    let text = path.to_string_lossy().into_owned();
    let meta = media::probe_media(app.clone(), text.clone())
        .await
        .unwrap_or_default();
    Ok((
        text,
        meta.width.unwrap_or(0),
        meta.height.unwrap_or(0),
        meta.duration,
    ))
}

// ---------------------------------------------------------------------------
// 图像 / 视频输入
// ---------------------------------------------------------------------------

struct ImageInput {
    prompt: String,
    negative: String,
    width: u32,
    height: u32,
    init: Option<PathBuf>,
    mask: Option<Vec<u8>>,
    seed: i64,
    model: String,
    edit: bool,
}

struct VideoInput {
    prompt: String,
    negative: String,
    width: u32,
    height: u32,
    seconds: f32,
    init: Option<PathBuf>,
    model: String,
}

/// 视频结果的来源：多数供应商给 URL；Veo 需要带 Key 下载，已经落成临时文件。
enum VideoSource {
    Url(String),
    File(PathBuf),
}

/// MiniMax 的接口都在 `/v1` 下；用户把 `/v1` 一起填进来也不会拼成 `/v1/v1`。
fn minimax_base(base: &str) -> String {
    match base.trim_end_matches('/').strip_suffix("/v1") {
        Some(root) => format!("{root}/v1"),
        None => format!("{}/v1", base.trim_end_matches('/')),
    }
}

fn minimax_query(provider: &CloudGenProvider) -> String {
    let group = provider.group_id.trim();
    if group.is_empty() {
        String::new()
    } else {
        format!("GroupId={}", url_encode(group))
    }
}

// ---------------------------------------------------------------------------
// 请求封装
// ---------------------------------------------------------------------------

struct Call<'a> {
    client: &'a reqwest::Client,
    provider: &'a CloudGenProvider,
    app: &'a AppHandle,
    started: Instant,
    base: String,
    key: String,
}

impl<'a> Call<'a> {
    fn new(
        provider: &'a CloudGenProvider,
        client: &'a reqwest::Client,
        app: &'a AppHandle,
    ) -> Result<Self, String> {
        let key = provider.api_key.trim().to_string();
        if key.is_empty() {
            let label = if provider.kind == CloudGenKind::Kling {
                "Access Key（填在 API Key 一栏）"
            } else {
                "API Key"
            };
            return Err(format!("{} 需要填写 {label}", provider.name));
        }
        Ok(Self {
            client,
            provider,
            app,
            started: Instant::now(),
            base: base_url(provider),
            key,
        })
    }

    fn note(&self, message: impl Into<String>, fraction: f32) {
        emit(
            self.app,
            "running",
            Some(message.into()),
            fraction,
            self.started.elapsed().as_secs_f64(),
        );
    }

    fn tick(&self, timeout: Duration) -> Result<(), String> {
        if cancelled() {
            return Err("已取消".into());
        }
        if self.started.elapsed() > timeout {
            return Err(format!("{} 生成超时", self.provider.name));
        }
        Ok(())
    }

    async fn image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        match self.provider.kind {
            CloudGenKind::Openai => self.openai_image(input).await,
            CloudGenKind::Gemini => self.gemini_image(input).await,
            CloudGenKind::Stability => self.stability_image(input).await,
            CloudGenKind::Bfl => self.bfl_image(input).await,
            CloudGenKind::Dashscope => self.dashscope_image(input).await,
            CloudGenKind::Ark => self.ark_image(input).await,
            CloudGenKind::Kling => self.kling_image(input).await,
            CloudGenKind::Minimax => self.minimax_image(input).await,
            CloudGenKind::Openrouter => self.openrouter_image(input).await,
            CloudGenKind::Siliconflow => self.siliconflow_image(input).await,
            CloudGenKind::Replicate => self.replicate_image(input).await,
            CloudGenKind::Fal => self.fal_image(input).await,
            CloudGenKind::Runway | CloudGenKind::Luma => {
                Err(format!("{} 只支持视频生成", self.provider.name))
            }
        }
    }

    async fn video(&self, input: &VideoInput) -> Result<VideoSource, String> {
        match self.provider.kind {
            CloudGenKind::Gemini => self.gemini_video(input).await,
            _ => self.video_url_only(input).await,
        }
    }

    /// 除 Veo 外的供应商都直接返回可下载的 URL。
    async fn video_url_only(&self, input: &VideoInput) -> Result<VideoSource, String> {
        let url = match self.provider.kind {
            CloudGenKind::Dashscope => self.dashscope_video(input).await?,
            CloudGenKind::Ark => self.ark_video(input).await?,
            CloudGenKind::Kling => self.kling_video(input).await?,
            CloudGenKind::Minimax => self.minimax_video(input).await?,
            CloudGenKind::Runway => self.runway_video(input).await?,
            CloudGenKind::Luma => self.luma_video(input).await?,
            CloudGenKind::Replicate => self.replicate_video(input).await?,
            CloudGenKind::Fal => self.fal_video(input).await?,
            CloudGenKind::Siliconflow => self.siliconflow_video(input).await?,
            _ => return Err(format!("{} 不支持视频生成", self.provider.name)),
        };
        Ok(VideoSource::Url(url))
    }

    /// 统一从各家 JSON 里抠图片：base64 优先，其次 URL，最后下载。
    async fn image_from_json(&self, value: &Value, label: &str) -> Result<Vec<u8>, String> {
        const B64_PATHS: &[&str] = &[
            "data.0.b64_json",
            "b64_json",
            "data.0.image_base64",
            "data.0.image",
            "images.0.b64_json",
            "image",
            "image_base64",
        ];
        for path in B64_PATHS {
            if let Some(text) = dig_str(value, path) {
                if let Some(bytes) = decode_b64(text) {
                    return Ok(bytes);
                }
            }
        }
        if let Some(items) = dig(value, "data.image_base64").and_then(Value::as_array) {
            if let Some(text) = items.first().and_then(Value::as_str) {
                if let Some(bytes) = decode_b64(text) {
                    return Ok(bytes);
                }
            }
        }
        const URL_PATHS: &[&str] = &[
            "data.0.url",
            "images.0.url",
            "image_url",
            "data.0.image_url",
            "output.0",
            "output",
            "result.sample",
            "url",
            "data.task_result.images.0.url",
            "output.choices.0.message.content.0.image",
            "data.0.b64_json", // 已经试过 base64；这里再看一遍 data URL 形式
        ];
        for path in URL_PATHS {
            if let Some(text) = dig_str(value, path) {
                if text.starts_with("http") {
                    return download(self.client, text).await;
                }
                if text.starts_with("data:") {
                    if let Some(bytes) = decode_b64(text) {
                        return Ok(bytes);
                    }
                }
            }
        }
        Err(format!(
            "{label}没有返回图片：{}",
            truncate(&value.to_string(), 400)
        ))
    }

    // -- 官方：OpenAI -------------------------------------------------------

    async fn openai_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let model = input.model.as_str();
        let gpt_image = model.to_lowercase().contains("gpt-image");
        let size = openai_size(model, input.width, input.height);
        if input.edit {
            let init = input
                .init
                .as_deref()
                .ok_or_else(|| "OpenAI 图生图需要原图".to_string())?;
            let bytes = std::fs::read(init).map_err(|error| format!("读取原图失败：{error}"))?;
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(file_name(init))
                .mime_str("image/png")
                .map_err(|error| format!("构造上传表单失败：{error}"))?;
            let mut form = reqwest::multipart::Form::new()
                .text("model", model.to_string())
                .text("prompt", input.prompt.clone())
                .text("size", size)
                .text("n", "1")
                .part("image", part);
            if let Some(mask) = &input.mask {
                let part = reqwest::multipart::Part::bytes(mask.clone())
                    .file_name("mask.png")
                    .mime_str("image/png")
                    .map_err(|error| format!("构造 mask 失败：{error}"))?;
                form = form.part("mask", part);
            }
            if !gpt_image {
                form = form.text("response_format", "b64_json");
            }
            let value = send_json(
                self.client
                    .post(format!("{}/images/edits", self.base))
                    .bearer_auth(&self.key)
                    .multipart(form),
                "OpenAI 图像编辑",
            )
            .await?;
            return self.image_from_json(&value, "OpenAI 图像编辑").await;
        }
        let mut body = json!({
            "model": model,
            "prompt": input.prompt,
            "n": 1,
            "size": size,
        });
        if gpt_image {
            body["output_format"] = json!("png");
        } else {
            body["response_format"] = json!("b64_json");
        }
        let value = send_json(
            self.client
                .post(format!("{}/images/generations", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "OpenAI 图像生成",
        )
        .await?;
        self.image_from_json(&value, "OpenAI 图像生成").await
    }

    // -- 官方：Google Gemini / Veo -----------------------------------------

    async fn gemini_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut parts = vec![json!({ "text": input.prompt })];
        if let Some(init) = input.init.as_deref() {
            let data = file_b64(init)?;
            parts.push(json!({
                "inline_data": { "mime_type": "image/png", "data": data }
            }));
        }
        let body = json!({
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": { "aspectRatio": nearest_ratio(input.width, input.height) }
            }
        });
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            self.base,
            input.model,
            url_encode(&self.key)
        );
        let value = send_json(self.client.post(url).json(&body), "Gemini 图像生成").await?;
        for part in dig(&value, "candidates.0.content.parts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            for key in ["inlineData", "inline_data"] {
                if let Some(data) = dig_str(&part, &format!("{key}.data")) {
                    if let Some(bytes) = decode_b64(data) {
                        return Ok(bytes);
                    }
                }
            }
        }
        Err(format!(
            "Gemini 没有返回图片：{}",
            truncate(&value.to_string(), 400)
        ))
    }

    // -- 官方：Stability ----------------------------------------------------

    async fn stability_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let model = input.model.as_str();
        let url = format!("{}/v2beta/stable-image/generate/{}", self.base, model);
        let mut form = reqwest::multipart::Form::new()
            .text("prompt", input.prompt.clone())
            .text("output_format", "png");
        if !input.negative.is_empty() {
            form = form.text("negative_prompt", input.negative.clone());
        }
        if input.edit {
            let init = input
                .init
                .as_deref()
                .ok_or_else(|| "Stability 图生图需要原图".to_string())?;
            let bytes = std::fs::read(init).map_err(|error| format!("读取原图失败：{error}"))?;
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(file_name(init))
                .mime_str("image/png")
                .map_err(|error| format!("构造上传表单失败：{error}"))?;
            form = form.part("image", part).text("strength", "0.75");
        } else {
            form = form.text("aspect_ratio", nearest_ratio(input.width, input.height));
        }
        if input.seed >= 0 {
            form = form.text("seed", input.seed.to_string());
        }
        let bytes = send_bytes(
            self.client
                .post(url)
                .header("Authorization", format!("Bearer {}", self.key))
                .header("Accept", "image/*")
                .multipart(form),
            "Stability",
        )
        .await?;
        if is_png(&bytes) || sniff_ext(&bytes) != "bin" {
            Ok(bytes)
        } else {
            Err(format!(
                "Stability 返回的不是图片：{}",
                truncate(&String::from_utf8_lossy(&bytes), 300)
            ))
        }
    }

    // -- 官方：Black Forest Labs -------------------------------------------

    async fn bfl_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({
            "prompt": input.prompt,
            "width": input.width,
            "height": input.height,
            "output_format": "png",
            "prompt_upsampling": false,
            "safety_tolerance": 2,
        });
        if let Some(init) = input.init.as_deref() {
            body["input_image"] = json!(file_b64(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/v1/{}", self.base, input.model))
                .header("x-key", &self.key)
                .json(&body),
            "BFL",
        )
        .await?;
        let poll_url = dig_str(&value, "polling_url")
            .ok_or_else(|| format!("BFL 没有返回 polling_url：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        loop {
            self.tick(IMAGE_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&poll_url).header("x-key", &self.key),
                "BFL 查询",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("Ready") => {
                    let sample = dig_str(&value, "result.sample")
                        .ok_or_else(|| "BFL 结果缺少 sample".to_string())?;
                    return download(self.client, sample).await;
                }
                Some("Error") | Some("Request Moderated") | Some("Content Moderated") => {
                    return Err(format!(
                        "BFL 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("BFL 正在生成…", 0.4),
            }
        }
    }

    // -- 官方：阿里云百炼 ---------------------------------------------------

    async fn dashscope_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        if input.model.to_lowercase().contains("wanx") {
            let url = format!(
                "{}/api/v1/services/aigc/text2image/image-synthesis",
                self.base
            );
            let mut payload = json!({
                "model": input.model,
                "input": { "prompt": input.prompt },
                "parameters": {
                    "size": format!("{}*{}", input.width, input.height),
                    "n": 1,
                },
            });
            if !input.negative.is_empty() {
                payload["input"]["negative_prompt"] = json!(input.negative);
            }
            let value = send_json(
                self.client
                    .post(url)
                    .bearer_auth(&self.key)
                    .header("X-DashScope-Async", "enable")
                    .json(&payload),
                "百炼图像生成",
            )
            .await?;
            let task = dig_str(&value, "output.task_id")
                .ok_or_else(|| format!("百炼没有返回 task_id：{}", truncate(&value.to_string(), 300)))?
                .to_string();
            let task_url = format!("{}/api/v1/tasks/{}", self.base, task);
            loop {
                self.tick(IMAGE_TIMEOUT)?;
                tokio::time::sleep(POLL_INTERVAL).await;
                let value = send_json(
                    self.client.get(&task_url).bearer_auth(&self.key),
                    "百炼任务查询",
                )
                .await?;
                match dig_str(&value, "output.task_status") {
                    Some("SUCCEEDED") => {
                        let url = dig_str_first(&value, &["output.results.0.url", "output.video_url"])
                            .ok_or_else(|| "百炼任务没有结果".to_string())?;
                        return download(self.client, url).await;
                    }
                    Some("FAILED") | Some("CANCELED") => {
                        return Err(format!(
                            "百炼任务失败：{}",
                            truncate(&value.to_string(), 300)
                        ));
                    }
                    _ => self.note("百炼正在生成…", 0.4),
                }
            }
        }
        let mut content: Vec<Value> = Vec::new();
        if input.edit {
            let init = input
                .init
                .as_deref()
                .ok_or_else(|| "百炼图生图需要原图".to_string())?;
            content.push(json!({ "image": file_data_url(init)? }));
        }
        content.push(json!({ "text": input.prompt }));
        let mut payload = json!({
            "model": input.model,
            "input": { "messages": [{ "role": "user", "content": content }] },
            "parameters": {
                "size": format!("{}*{}", input.width, input.height),
                "prompt_extend": true,
                "watermark": false,
            },
        });
        if !input.negative.is_empty() {
            payload["parameters"]["negative_prompt"] = json!(input.negative);
        }
        let value = send_json(
            self.client
                .post(format!(
                    "{}/api/v1/services/aigc/multimodal-generation/generation",
                    self.base
                ))
                .bearer_auth(&self.key)
                .json(&payload),
            "百炼图像生成",
        )
        .await?;
        self.image_from_json(&value, "百炼图像生成").await
    }

    // -- 官方：火山方舟 -----------------------------------------------------

    async fn ark_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "size": aspect_size(input.width, input.height),
            "response_format": "url",
            "watermark": false,
        });
        if let Some(init) = input.init.as_deref() {
            body["image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/images/generations", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "火山方舟图像生成",
        )
        .await?;
        self.image_from_json(&value, "火山方舟图像生成").await
    }

    // -- 官方：可灵 --------------------------------------------------------

    fn kling_headers(&self) -> Result<Vec<(String, String)>, String> {
        let secret = self.provider.api_secret.trim();
        if secret.is_empty() {
            return Err("可灵需要同时填写 Access Key 与 Secret Key".into());
        }
        let token = kling_token(&self.key, secret)?;
        Ok(vec![("Authorization".into(), format!("Bearer {token}"))])
    }

    async fn kling_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({
            "model_name": input.model,
            "prompt": input.prompt,
            "n": 1,
            "aspect_ratio": nearest_ratio(input.width, input.height),
        });
        if !input.negative.is_empty() {
            body["negative_prompt"] = json!(input.negative);
        }
        let mut request = self
            .client
            .post(format!("{}/v1/images/generations", self.base));
        for (key, value) in self.kling_headers()? {
            request = request.header(key, value);
        }
        let value = send_json(request.json(&body), "可灵图像生成").await?;
        let task = dig_str(&value, "data.task_id")
            .ok_or_else(|| format!("可灵没有返回 task_id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let url = format!("{}/v1/images/generations/{}", self.base, task);
        loop {
            self.tick(IMAGE_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let mut request = self.client.get(&url);
            for (key, value) in self.kling_headers()? {
                request = request.header(key, value);
            }
            let value = send_json(request, "可灵任务查询").await?;
            match dig_str(&value, "data.task_status") {
                Some("succeed") => {
                    let url = dig_str(&value, "data.task_result.images.0.url")
                        .ok_or_else(|| "可灵任务没有结果".to_string())?;
                    return download(self.client, url).await;
                }
                Some("failed") => {
                    return Err(format!(
                        "可灵任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("可灵正在生成…", 0.4),
            }
        }
    }

    // -- 官方：MiniMax -----------------------------------------------------

    async fn minimax_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut url = format!("{}/image_generation", minimax_base(&self.base));
        let query = minimax_query(self.provider);
        if !query.is_empty() {
            url.push('?');
            url.push_str(&query);
        }
        let body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "aspect_ratio": nearest_ratio(input.width, input.height),
            "response_format": "base64",
            "n": 1,
        });
        let value = send_json(
            self.client.post(url).bearer_auth(&self.key).json(&body),
            "MiniMax 图像生成",
        )
        .await?;
        self.image_from_json(&value, "MiniMax 图像生成").await
    }

    // -- 聚合站：OpenRouter -------------------------------------------------

    async fn openrouter_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "aspect_ratio": nearest_ratio(input.width, input.height),
            "output_format": "png",
        });
        if let Some(init) = input.init.as_deref() {
            body["input_references"] =
                json!([{ "type": "image_url", "image_url": { "url": file_data_url(init)? } }]);
        }
        let value = send_json(
            self.client
                .post(format!("{}/v1/images", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "OpenRouter 图像生成",
        )
        .await?;
        self.image_from_json(&value, "OpenRouter 图像生成").await
    }

    // -- 聚合站：SiliconFlow ------------------------------------------------

    async fn siliconflow_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "image_size": siliconflow_image_size(input.width, input.height),
            "batch_size": 1,
            "num_inference_steps": 20,
            "guidance_scale": 7.5,
        });
        if !input.negative.is_empty() {
            body["negative_prompt"] = json!(input.negative);
        }
        if let Some(init) = input.init.as_deref() {
            body["image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/images/generations", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "SiliconFlow 图像生成",
        )
        .await?;
        self.image_from_json(&value, "SiliconFlow 图像生成").await
    }

    // -- 聚合站：Replicate --------------------------------------------------

    async fn replicate_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({ "input": { "prompt": input.prompt } });
        if let Some(init) = input.init.as_deref() {
            body["input"]["image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/models/{}/predictions", self.base, input.model))
                .bearer_auth(&self.key)
                .json(&body),
            "Replicate",
        )
        .await?;
        let id = dig_str(&value, "id")
            .ok_or_else(|| format!("Replicate 没有返回任务 id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/predictions/{}", self.base, id);
        loop {
            self.tick(IMAGE_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&poll).bearer_auth(&self.key),
                "Replicate 查询",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("succeeded") => {
                    return self.image_from_json(&value, "Replicate").await;
                }
                Some("failed") | Some("canceled") => {
                    return Err(format!(
                        "Replicate 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("Replicate 正在生成…", 0.4),
            }
        }
    }

    // -- 聚合站：fal.ai -----------------------------------------------------

    async fn fal_image(&self, input: &ImageInput) -> Result<Vec<u8>, String> {
        let mut body = json!({ "prompt": input.prompt });
        if let Some(init) = input.init.as_deref() {
            body["image_url"] = json!(file_data_url(init)?);
        }
        let (status_url, response_url) = self.fal_submit(&input.model, &body).await?;
        let response = self.fal_wait(&status_url, &response_url, IMAGE_TIMEOUT).await?;
        self.image_from_json(&response, "fal.ai").await
    }

    async fn fal_submit(&self, model: &str, body: &Value) -> Result<(String, String), String> {
        let value = send_json(
            self.client
                .post(format!("{}/{}", self.base, model))
                .header("Authorization", format!("Key {}", self.key))
                .json(body),
            "fal.ai 提交",
        )
        .await?;
        let status_url = dig_str(&value, "status_url")
            .ok_or_else(|| format!("fal.ai 没有返回 status_url：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let response_url = dig_str(&value, "response_url")
            .ok_or_else(|| format!("fal.ai 没有返回 response_url：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        Ok((status_url, response_url))
    }

    async fn fal_wait(
        &self,
        status_url: &str,
        response_url: &str,
        timeout: Duration,
    ) -> Result<Value, String> {
        loop {
            self.tick(timeout)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client
                    .get(status_url)
                    .header("Authorization", format!("Key {}", self.key)),
                "fal.ai 状态",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("COMPLETED") => {
                    return send_json(
                        self.client
                            .get(response_url)
                            .header("Authorization", format!("Key {}", self.key)),
                        "fal.ai 结果",
                    )
                    .await;
                }
                Some("FAILED") => {
                    return Err(format!(
                        "fal.ai 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("fal.ai 正在生成…", 0.45),
            }
        }
    }

    // -----------------------------------------------------------------------
    // 视频
    // -----------------------------------------------------------------------

    // -- 官方：Google Veo ---------------------------------------------------

    async fn gemini_video(&self, input: &VideoInput) -> Result<VideoSource, String> {
        let mut instance = json!({ "prompt": input.prompt });
        if let Some(init) = input.init.as_deref() {
            instance["image"] = json!({
                "bytesBase64Encoded": file_b64(init)?,
                "mimeType": "image/png",
            });
        }
        let body = json!({
            "instances": [instance],
            "parameters": {
                "aspectRatio": nearest_ratio(input.width, input.height),
                "durationSeconds": input.seconds.round().clamp(4.0, 8.0) as i64,
            }
        });
        let url = format!(
            "{}/v1beta/models/{}:predictLongRunning?key={}",
            self.base,
            input.model,
            url_encode(&self.key)
        );
        let value = send_json(self.client.post(url).json(&body), "Veo 视频生成").await?;
        let name = dig_str(&value, "name")
            .ok_or_else(|| format!("Veo 没有返回任务名：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!(
            "{}/v1beta/{}?key={}",
            self.base,
            name,
            url_encode(&self.key)
        );
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(self.client.get(&poll), "Veo 任务查询").await?;
            if dig(&value, "done").and_then(Value::as_bool) == Some(true) {
                if let Some(error) = dig(&value, "error") {
                    return Err(format!(
                        "Veo 任务失败：{}",
                        truncate(&error.to_string(), 300)
                    ));
                }
                let uri = dig_str_first(
                    &value,
                    &[
                        "response.generateVideoResponse.generatedSamples.0.video.uri",
                        "response.generatedVideos.0.video.uri",
                        "response.videos.0.uri",
                        "response.video.uri",
                    ],
                )
                .ok_or_else(|| {
                    format!("Veo 没有返回视频：{}", truncate(&value.to_string(), 400))
                })?;
                let response = self
                    .client
                    .get(uri)
                    .header("x-goog-api-key", &self.key)
                    .timeout(HTTP_TIMEOUT)
                    .send()
                    .await
                    .map_err(|error| format!("下载 Veo 视频失败：{error}"))?;
                if !response.status().is_success() {
                    return Err(format!("下载 Veo 视频返回 {}", response.status()));
                }
                let dir = media::cache_dir(self.app)?;
                let path = dir.join(format!(
                    "cloud-gen-video-src-{}-{}.mp4",
                    std::process::id(),
                    stamp()
                ));
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|error| format!("读取 Veo 视频失败：{error}"))?;
                std::fs::write(&path, &bytes)
                    .map_err(|error| format!("写入 Veo 视频失败：{error}"))?;
                return Ok(VideoSource::File(path));
            }
            self.note("Veo 正在生成…", 0.4);
        }
    }

    // -- 官方：阿里云百炼 ---------------------------------------------------

    async fn dashscope_video(&self, input: &VideoInput) -> Result<String, String> {
        let url = format!(
            "{}/api/v1/services/aigc/video-generation/video-synthesis",
            self.base
        );
        let mut payload = json!({
            "model": input.model,
            "input": { "prompt": input.prompt },
            "parameters": {
                "size": fixed_video_size(input.width, input.height, '*'),
                "duration": input.seconds.round().max(2.0) as i64,
            },
        });
        if let Some(init) = input.init.as_deref() {
            payload["input"]["img_url"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(url)
                .bearer_auth(&self.key)
                .header("X-DashScope-Async", "enable")
                .json(&payload),
            "百炼视频生成",
        )
        .await?;
        let task = dig_str(&value, "output.task_id")
            .ok_or_else(|| format!("百炼没有返回 task_id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let task_url = format!("{}/api/v1/tasks/{}", self.base, task);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&task_url).bearer_auth(&self.key),
                "百炼任务查询",
            )
            .await?;
            match dig_str(&value, "output.task_status") {
                Some("SUCCEEDED") => {
                    return dig_str_first(&value, &["output.video_url", "output.results.0.url"])
                        .map(str::to_string)
                        .ok_or_else(|| "百炼任务没有视频地址".to_string());
                }
                Some("FAILED") | Some("CANCELED") => {
                    return Err(format!(
                        "百炼任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("百炼正在生成视频…", 0.4),
            }
        }
    }

    // -- 官方：火山方舟 -----------------------------------------------------

    async fn ark_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut content: Vec<Value> = Vec::new();
        if let Some(init) = input.init.as_deref() {
            content.push(json!({
                "type": "image_url",
                "image_url": { "url": file_data_url(init)? }
            }));
        }
        content.push(json!({ "type": "text", "text": input.prompt }));
        let body = json!({
            "model": input.model,
            "content": content,
            "ratio": nearest_ratio(input.width, input.height),
            "duration": input.seconds.round().clamp(3.0, 12.0) as i64,
            "resolution": "720p",
            "watermark": false,
        });
        let value = send_json(
            self.client
                .post(format!("{}/contents/generations/tasks", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "方舟视频生成",
        )
        .await?;
        let id = dig_str(&value, "id")
            .ok_or_else(|| format!("方舟没有返回任务 id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/contents/generations/tasks/{}", self.base, id);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&poll).bearer_auth(&self.key),
                "方舟任务查询",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("succeeded") => {
                    return dig_str_first(&value, &["content.video_url", "content.videos.0.url"])
                        .map(str::to_string)
                        .ok_or_else(|| "方舟任务没有视频地址".to_string());
                }
                Some("failed") | Some("cancelled") => {
                    return Err(format!(
                        "方舟任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("方舟正在生成视频…", 0.4),
            }
        }
    }

    // -- 官方：可灵 --------------------------------------------------------

    async fn kling_video(&self, input: &VideoInput) -> Result<String, String> {
        let route = if input.init.is_some() {
            "image2video"
        } else {
            "text2video"
        };
        let mut body = json!({
            "model_name": input.model,
            "prompt": input.prompt,
            "cfg_scale": 0.5,
            "mode": "std",
            "duration": format!("{}", input.seconds.round().clamp(5.0, 10.0) as i64),
            "aspect_ratio": nearest_ratio(input.width, input.height),
        });
        if !input.negative.is_empty() {
            body["negative_prompt"] = json!(input.negative);
        }
        if let Some(init) = input.init.as_deref() {
            body["image"] = json!(file_b64(init)?);
        }
        let mut request = self
            .client
            .post(format!("{}/v1/videos/{}", self.base, route));
        for (key, value) in self.kling_headers()? {
            request = request.header(key, value);
        }
        let value = send_json(request.json(&body), "可灵视频生成").await?;
        let task = dig_str(&value, "data.task_id")
            .ok_or_else(|| format!("可灵没有返回 task_id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/v1/videos/{}/{}", self.base, route, task);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let mut request = self.client.get(&poll);
            for (key, value) in self.kling_headers()? {
                request = request.header(key, value);
            }
            let value = send_json(request, "可灵任务查询").await?;
            match dig_str(&value, "data.task_status") {
                Some("succeed") => {
                    return dig_str(&value, "data.task_result.videos.0.url")
                        .map(str::to_string)
                        .ok_or_else(|| "可灵任务没有视频地址".to_string());
                }
                Some("failed") => {
                    return Err(format!(
                        "可灵任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("可灵正在生成视频…", 0.4),
            }
        }
    }

    // -- 官方：MiniMax -----------------------------------------------------

    async fn minimax_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut url = format!("{}/video_generation", minimax_base(&self.base));
        let query = minimax_query(self.provider);
        if !query.is_empty() {
            url.push('?');
            url.push_str(&query);
        }
        let mut body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "duration": input.seconds.round().clamp(6.0, 10.0) as i64,
            "resolution": "1080P",
        });
        if let Some(init) = input.init.as_deref() {
            body["first_frame_image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client.post(url).bearer_auth(&self.key).json(&body),
            "MiniMax 视频生成",
        )
        .await?;
        let task = dig_str(&value, "task_id")
            .ok_or_else(|| format!("MiniMax 没有返回 task_id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let mut query_url = format!(
            "{}/query/video_generation?task_id={}",
            minimax_base(&self.base),
            url_encode(&task)
        );
        if !query.is_empty() {
            query_url.push('&');
            query_url.push_str(&query);
        }
        let file_id = loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&query_url).bearer_auth(&self.key),
                "MiniMax 任务查询",
            )
            .await?;
            match dig_str_first(&value, &["status", "task.status"]) {
                Some("Success") | Some("SUCCESS") => {
                    if let Some(url) = dig_str_first(&value, &["file.download_url", "download_url"]) {
                        return Ok(url.to_string());
                    }
                    break dig_str(&value, "file_id")
                        .ok_or_else(|| {
                            format!("MiniMax 任务没有 file_id：{}", truncate(&value.to_string(), 300))
                        })?
                        .to_string();
                }
                Some("Fail") | Some("Failed") | Some("FAIL") => {
                    return Err(format!(
                        "MiniMax 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("MiniMax 正在生成视频…", 0.4),
            }
        };
        let mut file_url = format!(
            "{}/files/retrieve?file_id={}",
            minimax_base(&self.base),
            url_encode(&file_id)
        );
        if !query.is_empty() {
            file_url.push('&');
            file_url.push_str(&query);
        }
        let value = send_json(
            self.client.get(&file_url).bearer_auth(&self.key),
            "MiniMax 文件查询",
        )
        .await?;
        dig_str(&value, "file.download_url")
            .map(str::to_string)
            .ok_or_else(|| {
                format!(
                    "MiniMax 没有返回下载地址：{}",
                    truncate(&value.to_string(), 300)
                )
            })
    }

    // -- 官方：Runway ------------------------------------------------------

    async fn runway_video(&self, input: &VideoInput) -> Result<String, String> {
        let route = if input.init.is_some() {
            "image_to_video"
        } else {
            "text_to_video"
        };
        let mut body = json!({
            "model": input.model,
            "promptText": input.prompt,
            "ratio": format!("{}:{}", input.width, input.height),
            "duration": input.seconds.round().clamp(5.0, 10.0) as i64,
        });
        if let Some(init) = input.init.as_deref() {
            body["promptImage"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/v1/{}", self.base, route))
                .bearer_auth(&self.key)
                .header("X-Runway-Version", "2024-11-06")
                .json(&body),
            "Runway 视频生成",
        )
        .await?;
        let id = dig_str(&value, "id")
            .ok_or_else(|| format!("Runway 没有返回任务 id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/v1/tasks/{}", self.base, id);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client
                    .get(&poll)
                    .bearer_auth(&self.key)
                    .header("X-Runway-Version", "2024-11-06"),
                "Runway 任务查询",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("SUCCEEDED") => {
                    return dig_str_first(&value, &["output.0", "output"])
                        .map(str::to_string)
                        .ok_or_else(|| "Runway 任务没有视频地址".to_string());
                }
                Some("FAILED") => {
                    return Err(format!(
                        "Runway 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("Runway 正在生成视频…", 0.4),
            }
        }
    }

    // -- 官方：Luma --------------------------------------------------------

    async fn luma_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut body = json!({
            "prompt": input.prompt,
            "model": input.model,
            "aspect_ratio": nearest_ratio(input.width, input.height),
            "loop": false,
        });
        if let Some(init) = input.init.as_deref() {
            body["keyframes"] =
                json!({ "frame0": { "type": "image", "url": file_data_url(init)? } });
        }
        let value = send_json(
            self.client
                .post(format!("{}/dream-machine/v1/generations", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "Luma 视频生成",
        )
        .await?;
        let id = dig_str(&value, "id")
            .ok_or_else(|| format!("Luma 没有返回任务 id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/dream-machine/v1/generations/{}", self.base, id);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&poll).bearer_auth(&self.key),
                "Luma 任务查询",
            )
            .await?;
            match dig_str(&value, "state") {
                Some("completed") => {
                    return dig_str_first(&value, &["assets.video", "video.url"])
                        .map(str::to_string)
                        .ok_or_else(|| "Luma 任务没有视频地址".to_string());
                }
                Some("failed") => {
                    return Err(format!(
                        "Luma 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("Luma 正在生成视频…", 0.4),
            }
        }
    }

    // -- 聚合站：Replicate / fal / SiliconFlow ------------------------------

    async fn replicate_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut body = json!({ "input": { "prompt": input.prompt } });
        if let Some(init) = input.init.as_deref() {
            body["input"]["image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/models/{}/predictions", self.base, input.model))
                .bearer_auth(&self.key)
                .json(&body),
            "Replicate",
        )
        .await?;
        let id = dig_str(&value, "id")
            .ok_or_else(|| format!("Replicate 没有返回任务 id：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        let poll = format!("{}/predictions/{}", self.base, id);
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client.get(&poll).bearer_auth(&self.key),
                "Replicate 查询",
            )
            .await?;
            match dig_str(&value, "status") {
                Some("succeeded") => {
                    return video_url_from_json(&value).ok_or_else(|| {
                        format!(
                            "Replicate 没有返回视频：{}",
                            truncate(&value.to_string(), 300)
                        )
                    });
                }
                Some("failed") | Some("canceled") => {
                    return Err(format!(
                        "Replicate 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("Replicate 正在生成视频…", 0.4),
            }
        }
    }

    async fn fal_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut body = json!({
            "prompt": input.prompt,
            "aspect_ratio": nearest_ratio(input.width, input.height),
            "duration": format!("{}", input.seconds.round().max(1.0) as i64),
        });
        if let Some(init) = input.init.as_deref() {
            body["image_url"] = json!(file_data_url(init)?);
        }
        let (status_url, response_url) = self.fal_submit(&input.model, &body).await?;
        let response = self.fal_wait(&status_url, &response_url, VIDEO_TIMEOUT).await?;
        video_url_from_json(&response).ok_or_else(|| {
            format!(
                "fal.ai 没有返回视频：{}",
                truncate(&response.to_string(), 300)
            )
        })
    }

    async fn siliconflow_video(&self, input: &VideoInput) -> Result<String, String> {
        let mut body = json!({
            "model": input.model,
            "prompt": input.prompt,
            "image_size": fixed_video_size(input.width, input.height, 'x'),
        });
        if !input.negative.is_empty() {
            body["negative_prompt"] = json!(input.negative);
        }
        if let Some(init) = input.init.as_deref() {
            body["image"] = json!(file_data_url(init)?);
        }
        let value = send_json(
            self.client
                .post(format!("{}/video/submit", self.base))
                .bearer_auth(&self.key)
                .json(&body),
            "SiliconFlow 视频生成",
        )
        .await?;
        let request_id = dig_str_first(&value, &["requestId", "request_id"])
            .ok_or_else(|| format!("SiliconFlow 没有返回 requestId：{}", truncate(&value.to_string(), 300)))?
            .to_string();
        loop {
            self.tick(VIDEO_TIMEOUT)?;
            tokio::time::sleep(POLL_INTERVAL).await;
            let value = send_json(
                self.client
                    .post(format!("{}/video/status", self.base))
                    .bearer_auth(&self.key)
                    .json(&json!({ "requestId": request_id })),
                "SiliconFlow 任务查询",
            )
            .await?;
            match dig_str_first(&value, &["status", "data.status"]) {
                Some("Succeed") => {
                    return video_url_from_json(&value).ok_or_else(|| {
                        format!(
                            "SiliconFlow 没有返回视频：{}",
                            truncate(&value.to_string(), 300)
                        )
                    });
                }
                Some("Failed") => {
                    return Err(format!(
                        "SiliconFlow 任务失败：{}",
                        truncate(&value.to_string(), 300)
                    ));
                }
                _ => self.note("SiliconFlow 正在生成视频…", 0.4),
            }
        }
    }
}

fn video_url_from_json(value: &Value) -> Option<String> {
    const PATHS: &[&str] = &[
        "output.0",
        "output",
        "output.video",
        "video.url",
        "videos.0.url",
        "content.video_url",
        "results.videos.0.url",
        "assets.video",
        "data.task_result.videos.0.url",
        "response.generateVideoResponse.generatedSamples.0.video.uri",
    ];
    for path in PATHS {
        if let Some(text) = dig_str(value, path) {
            if text.starts_with("http") {
                return Some(text.to_string());
            }
        }
    }
    if let Some(items) = dig(value, "output").and_then(Value::as_array) {
        if let Some(first) = items.first() {
            if let Some(text) = first.as_str() {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn openai_size(model: &str, width: u32, height: u32) -> String {
    let lower = model.to_lowercase();
    let allowed: &[(u32, u32)] = if lower.contains("dall-e-3") {
        &[(1024, 1024), (1792, 1024), (1024, 1792)]
    } else if lower.contains("gpt-image") {
        &[(1024, 1024), (1536, 1024), (1024, 1536)]
    } else {
        return format!("{width}x{height}");
    };
    let target = width.max(1) as f64 / height.max(1) as f64;
    let best = allowed
        .iter()
        .min_by(|a, b| {
            let ra = a.0 as f64 / a.1 as f64;
            let rb = b.0 as f64 / b.1 as f64;
            (ra / target).ln().abs().partial_cmp(&(rb / target).ln().abs()).unwrap()
        })
        .copied()
        .unwrap_or((1024, 1024));
    format!("{}x{}", best.0, best.1)
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        let digest = Sha256::digest(key);
        block[..32].copy_from_slice(&digest);
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    for byte in &block {
        inner.update([byte ^ 0x36]);
    }
    inner.update(data);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    for byte in &block {
        outer.update([byte ^ 0x5c]);
    }
    outer.update(inner);
    let digest = outer.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// 可灵的鉴权是 AK/SK 签的 HS256 JWT（有效期 30 分钟）。
fn kling_token(access_key: &str, secret_key: &str) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let header = json!({ "alg": "HS256", "typ": "JWT" });
    let payload = json!({
        "iss": access_key,
        "exp": now + 1800,
        "nbf": now - 5,
    });
    let signing = format!(
        "{}.{}",
        b64url(header.to_string().as_bytes()),
        b64url(payload.to_string().as_bytes())
    );
    let signature = hmac_sha256(secret_key.as_bytes(), signing.as_bytes());
    Ok(format!("{signing}.{}", b64url(&signature)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_cover_official_and_aggregator() {
        let presets = cloud_gen_presets();
        assert!(presets.iter().any(|item| item.group == "official"));
        assert!(presets.iter().any(|item| item.group == "aggregator"));
        let openai = presets
            .iter()
            .find(|item| item.kind == CloudGenKind::Openai)
            .expect("OpenAI preset");
        assert!(openai.capabilities.contains(&GenCapability::T2i));
        assert!(openai.capabilities.contains(&GenCapability::I2i));
        assert!(!openai.capabilities.contains(&GenCapability::T2v));
        let runway = presets
            .iter()
            .find(|item| item.kind == CloudGenKind::Runway)
            .expect("Runway preset");
        assert!(runway.capabilities.contains(&GenCapability::T2v));
        assert!(!runway.capabilities.contains(&GenCapability::T2i));
    }

    #[test]
    fn provider_capabilities_fall_back_to_preset() {
        let mut provider = CloudGenProvider {
            kind: CloudGenKind::Siliconflow,
            ..Default::default()
        };
        assert!(provider.supports(GenCapability::T2v));
        provider.capabilities = vec![GenCapability::T2i];
        assert!(provider.supports(GenCapability::T2i));
        assert!(!provider.supports(GenCapability::T2v));
    }

    #[test]
    fn openai_sizes_match_supported_values() {
        assert_eq!(openai_size("gpt-image-1", 1024, 1024), "1024x1024");
        assert_eq!(openai_size("gpt-image-1", 1216, 832), "1536x1024");
        assert_eq!(openai_size("gpt-image-1", 832, 1216), "1024x1536");
        assert_eq!(openai_size("dall-e-3", 1344, 768), "1792x1024");
        assert_eq!(openai_size("flux", 1280, 720), "1280x720");
    }

    #[test]
    fn ratio_maps_to_supported_values() {
        assert_eq!(nearest_ratio(1344, 768), "16:9");
        assert_eq!(nearest_ratio(768, 1344), "9:16");
        assert_eq!(nearest_ratio(1024, 1024), "1:1");
    }

    #[test]
    fn data_url_and_plain_base64_decode() {
        let png = [0x89u8, b'P', b'N', b'G', 1, 2, 3];
        let plain = base64::engine::general_purpose::STANDARD.encode(png);
        assert_eq!(decode_b64(&plain).unwrap(), png);
        let url = format!("data:image/png;base64,{plain}");
        assert_eq!(decode_b64(&url).unwrap(), png);
        assert!(decode_b64("not base64!!").is_none());
    }

    #[test]
    fn jwt_has_three_url_safe_segments() {
        let token = kling_token("ak", "sk").unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| !part.contains('+')));
        let expected = b64url(&hmac_sha256(b"sk", format!("{}.{}", parts[0], parts[1]).as_bytes()));
        assert_eq!(parts[2], expected);
    }

    #[test]
    fn fixed_sizes_map_to_provider_allowed_values() {
        assert_eq!(fixed_video_size(1280, 736, '*'), "1280*720");
        assert_eq!(fixed_video_size(736, 1280, 'x'), "720x1280");
        assert_eq!(fixed_video_size(960, 960, 'x'), "960x960");
        assert_eq!(siliconflow_image_size(1024, 1024), "1024x1024");
        assert_eq!(siliconflow_image_size(832, 1216), "960x1280");
        assert_eq!(siliconflow_image_size(1216, 832), "1280x960");
    }

    #[test]
    fn load_skips_unknown_entries_but_keeps_the_rest() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("cloud-gen.json");
        std::fs::write(
            &path,
            r#"{"providers":[
                {"id":"a","name":"A","kind":"openai"},
                {"id":"b","name":"B","kind":"future_kind"}
            ]}"#,
        )
        .expect("write config");
        let runtime = CloudGenRuntime::load(Some(path));
        let config = runtime.get();
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.providers[0].name, "A");
        assert_eq!(config.providers[0].kind, CloudGenKind::Openai);
    }

    #[test]
    fn minimax_base_does_not_strip_path_characters() {
        for (base, expected) in [
            ("https://api.minimax.chat", "https://api.minimax.chat/v1"),
            ("https://api.minimax.chat/v1", "https://api.minimax.chat/v1"),
            ("https://api.minimaxi.com/v1/", "https://api.minimaxi.com/v1"),
        ] {
            assert_eq!(minimax_base(base), expected);
        }
    }
}
