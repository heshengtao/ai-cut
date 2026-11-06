//! **视频生成**：把 stable-diffusion.cpp 的 `sd-cli` 当成外部进程来跑。
//!
//! sd.cpp 没有稳定的进程内 C ABI（每次 release 都可能改），而 `sd-cli` 的参数是它公开
//! 的稳定接口。这里只依赖命令行：拼参数 → 起子进程 → 读 stderr 的 step 进度 → 产出
//! `.webm`（H3 / LTX-2.3 连音频一起，其余只有画面）。取消就是 kill 子进程，不会污染宿主进程。
//!
//! 支持 8 个模型家族。家族的差异（帧率 / 帧数网格 / 文本编码器参数名 / 双专家 /
//! 音频 VAE / 负向提示词 / 采样器 / 参考条件）全部收在 [`VideoSpec`] 里，参数拼装与权重文件查找
//! 都由它驱动（顺序与 `models.rs` 清单一致：从轻到重）：
//!
//! | family | 帧率 | 帧数网格 | 文本编码器 | 特殊文件 / 参数 |
//! | --- | --- | --- | --- | --- |
//! | Wan2.1 T2V 1.3B | 16 fps | `4k + 1` | `--t5xxl`（UMT5-XXL） | — |
//! | Wan2.2 TI2V 5B | 24 fps | `4k + 1` | `--t5xxl`（UMT5-XXL） | `--init-img`（首帧） |
//! | Wan2.2 T2V A14B | 16 fps | `4k + 1` | `--t5xxl`（UMT5-XXL） | `--high-noise-diffusion-model` |
//! | LTX-2.3 | 24 fps | `8k + 1` | `--llm`（Gemma 3） | `--embeddings-connectors`、`--audio-vae` |
//! | HunyuanVideo 1.5 | 24 fps | `4k + 1` | `--llm` + `--t5xxl`（Qwen2.5-VL + ByT5） | — |
//! | MiniMax-H3 FL2VA | 24 fps | `17k + 5` | `--llm`（Qwen3-VL） | `--audio-vae`、`--init-img` / `--end-img` |
//! | MiniMax-H3 Ref2VA | 24 fps | `17k + 5` | `--llm`（Qwen3-VL） | `--audio-vae`、`-r` / `--ref-audio` |
//! | LTX-2.5 | 24 fps | `8k + 1` | `--llm`（Gemma 4，含投影层） | `--audio-vae`、`--init-img` / `--end-img` |
//!
//! 显存策略：默认 `--offload-to-cpu` + `--mmap` + `--vae-tiling` + `--max-vram 0`。
//! 这是 16 GB 机器能跑 480p 的前提；帧数 / 分辨率仍然受显存限制，界面会给出提示。

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{media, models, sdcpp};

pub const EVENT_VIDEO_GEN: &str = "video-gen-progress";

/// 权重文件在模型目录里怎么找：一个角色 + 若干文件名片段（小写包含匹配）。
#[derive(Debug, Clone, Copy)]
pub struct FileRole {
    /// `dit` / `dit_high` / `te` / `te_aux` / `vae` / `audio_vae` / `connectors`。
    pub role: &'static str,
    /// 按顺序尝试的文件名片段。
    pub needles: &'static [&'static str],
    /// 缺这个文件还能不能跑。
    pub required: bool,
}

/// 文本编码器接在哪个参数上。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoder {
    /// `--t5xxl`：Wan 的 UMT5-XXL。
    T5,
    /// `--llm`：Qwen3-VL（H3）/ Qwen2.5-VL（Hunyuan）/ Gemma 3（LTX-2.3）。
    Llm,
    /// `--llm` + `--t5xxl`：HunyuanVideo 1.5 的 Qwen2.5-VL + ByT5 Small GlyphXL。
    LlmAndT5,
}

/// 不同视频模型家族的帧率 / 帧数网格 / 单段帧数上限，以及 CLI 差异。
///
/// 这些家族共用 sd.cpp 的 `-M vid_gen` 入口，差异只有：文本编码器参数名、
/// 有没有音频 VAE / embeddings connectors、是不是双专家（high + low noise）、
/// 帧率与 latent 时间压缩比。其余参数（offload / mmap / VAE 分块）完全一致。
#[derive(Debug, Clone, Copy)]
pub struct VideoSpec {
    pub fps: u32,
    /// 帧数网格的步长（H3 是 17，Wan 是 4，LTX-2 是 8）。
    pub step: u32,
    /// 帧数网格的偏移（`k * step + offset`）。
    pub offset: u32,
    /// 单段生成的帧数上限。
    pub max_frames: u32,
    /// 文本编码器参数名。
    pub text_encoder: TextEncoder,
    /// VAE 时间维分块（只有 H3 / Wan2.2 TI2V 5B 值得开）。
    pub temporal_tiling: bool,
    /// 默认负向提示词（Wan / LTX 官方示例都带，对画质影响明显）。
    pub negative: Option<&'static str>,
    /// 采样器（Wan / LTX / Hunyuan 官方示例都用 euler；H3 用 sd.cpp 默认）。
    pub sampler: Option<&'static str>,
    /// 是否传 `--flow-shift`（Wan 与 H3 需要；LTX / Hunyuan 走各自的默认）。
    pub uses_flow_shift: bool,
    /// 是否支持首帧参考图（`--init-img`，I2V / I2VA）。
    pub init_image: bool,
    /// 是否支持尾帧参考图（`--end-img`，FLF2V / FLF2VA）。
    pub end_image: bool,
    /// 是否支持参考图（`-r`，MiniMax-H3 Ref2VA）。
    pub ref_image: bool,
    /// 是否支持参考音频（`--ref-audio`，MiniMax-H3 Ref2VA）。
    pub ref_audio: bool,
    /// 权重文件角色。
    pub roles: &'static [FileRole],
}

const WAN_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["t2v", "diffusion"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["umt5", "t5xxl", "encoder"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
];

const WAN22_TI2V_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["ti2v", "5b", "diffusion"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["umt5", "t5xxl", "encoder"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
];

const WAN22_A14B_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["low"],
        required: true,
    },
    FileRole {
        role: "dit_high",
        needles: &["high"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["umt5", "t5xxl", "encoder"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
];

const HUNYUAN_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["t2v", "diffusion"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen"],
        required: true,
    },
    FileRole {
        role: "te_aux",
        needles: &["byt5"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
];

const LTX_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["dev-q4", "dev-q8"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["gemma"],
        required: true,
    },
    FileRole {
        role: "connectors",
        needles: &["connector"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["video_vae"],
        required: true,
    },
    FileRole {
        role: "audio_vae",
        needles: &["audio_vae"],
        required: false,
    },
];

const LTX25_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["transformer-q4", "22b-dev-transformer"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["gemma"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["video-vae", "video_vae"],
        required: true,
    },
    FileRole {
        role: "audio_vae",
        needles: &["audio-vae", "audio_vae"],
        required: false,
    },
];

const H3_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["fl2va", "diffusion"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen3vl"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["video_vae"],
        required: true,
    },
    FileRole {
        role: "audio_vae",
        needles: &["audio_vae"],
        required: true,
    },
];

const H3_REF2VA_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["ref2va", "diffusion"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen3vl"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["video_vae"],
        required: true,
    },
    FileRole {
        role: "audio_vae",
        needles: &["audio_vae"],
        required: true,
    },
];

impl VideoSpec {
    /// 这个家族能不能用 `sd-cli` 生成视频。
    pub fn for_family(family: models::ModelFamily) -> Option<Self> {
        match family {
            models::ModelFamily::Wan21T2v => Some(Self {
                fps: 16,
                step: 4,
                offset: 1,
                max_frames: 161,
                text_encoder: TextEncoder::T5,
                temporal_tiling: false,
                negative: Some(WAN_NEGATIVE),
                sampler: Some("euler"),
                uses_flow_shift: true,
                init_image: false,
                end_image: false,
                ref_image: false,
                ref_audio: false,
                roles: WAN_FILES,
            }),
            models::ModelFamily::Wan22Ti2v => Some(Self {
                fps: 24,
                step: 4,
                offset: 1,
                max_frames: 121,
                text_encoder: TextEncoder::T5,
                temporal_tiling: true,
                negative: Some(WAN_NEGATIVE),
                sampler: Some("euler"),
                uses_flow_shift: true,
                init_image: true,
                end_image: false,
                ref_image: false,
                ref_audio: false,
                roles: WAN22_TI2V_FILES,
            }),
            models::ModelFamily::Wan22T2vA14b => Some(Self {
                fps: 16,
                step: 4,
                offset: 1,
                max_frames: 81,
                text_encoder: TextEncoder::T5,
                temporal_tiling: false,
                negative: Some(WAN_NEGATIVE),
                sampler: Some("euler"),
                uses_flow_shift: true,
                init_image: false,
                end_image: false,
                ref_image: false,
                ref_audio: false,
                roles: WAN22_A14B_FILES,
            }),
            models::ModelFamily::HunyuanVideo15 => Some(Self {
                fps: 24,
                step: 4,
                offset: 1,
                max_frames: 121,
                text_encoder: TextEncoder::LlmAndT5,
                temporal_tiling: false,
                negative: None,
                sampler: Some("euler"),
                uses_flow_shift: false,
                init_image: false,
                end_image: false,
                ref_image: false,
                ref_audio: false,
                roles: HUNYUAN_FILES,
            }),
            models::ModelFamily::Ltx23 => Some(Self {
                fps: 24,
                step: 8,
                offset: 1,
                max_frames: 121,
                text_encoder: TextEncoder::Llm,
                temporal_tiling: false,
                negative: Some(LTX_NEGATIVE),
                sampler: Some("euler"),
                uses_flow_shift: false,
                init_image: true,
                end_image: true,
                ref_image: false,
                ref_audio: false,
                roles: LTX_FILES,
            }),
            models::ModelFamily::Ltx25 => Some(Self {
                fps: 24,
                step: 8,
                offset: 1,
                max_frames: 121,
                text_encoder: TextEncoder::Llm,
                temporal_tiling: false,
                negative: Some(LTX_NEGATIVE),
                sampler: Some("euler"),
                uses_flow_shift: false,
                init_image: true,
                end_image: true,
                ref_image: false,
                ref_audio: false,
                roles: LTX25_FILES,
            }),
            models::ModelFamily::MiniMaxH3 => Some(Self {
                fps: 24,
                step: 17,
                offset: 5,
                max_frames: 360,
                text_encoder: TextEncoder::Llm,
                temporal_tiling: true,
                negative: None,
                sampler: None,
                uses_flow_shift: true,
                init_image: true,
                end_image: true,
                ref_image: false,
                ref_audio: false,
                roles: H3_FILES,
            }),
            // Ref2VA 用参考条件（`-r` / `--ref-audio`）代替首尾帧；帧率 / 网格与 FL2VA 相同。
            models::ModelFamily::MiniMaxH3Ref2va => Some(Self {
                fps: 24,
                step: 17,
                offset: 5,
                max_frames: 360,
                text_encoder: TextEncoder::Llm,
                temporal_tiling: true,
                negative: None,
                sampler: None,
                uses_flow_shift: true,
                init_image: false,
                end_image: false,
                ref_image: true,
                ref_audio: true,
                roles: H3_REF2VA_FILES,
            }),
            _ => None,
        }
    }

    /// 帧数对齐到网格（向上取整，且不小于 `offset`）。
    pub fn align(&self, frames: u32) -> u32 {
        let frames = frames.max(self.offset);
        let remainder = (frames - self.offset) % self.step;
        if remainder == 0 {
            frames
        } else {
            frames + self.step - remainder
        }
    }

    /// 秒数 → 网格帧数（H3 的 10 秒会得到 243，不是 240）。
    pub fn frames_for_seconds(&self, seconds: f64) -> u32 {
        let raw = (seconds.max(0.0) * self.fps as f64).round() as u32;
        self.align(raw).min(self.max_frames)
    }

    /// 在模型目录里按角色找权重文件。
    pub fn resolve(&self, dir: &Path) -> Result<ModelFiles, String> {
        let mut found: Vec<(&'static str, PathBuf)> = Vec::new();
        for role in self.roles {
            let hit = role
                .needles
                .iter()
                .find_map(|needle| find_model_file(dir, needle));
            match hit {
                Some(path) => found.push((role.role, path)),
                None if role.required => {
                    return Err(format!(
                        "{} 缺少 {} 权重（{}）",
                        dir.display(),
                        role.role,
                        role.needles.join(" / ")
                    ));
                }
                None => {}
            }
        }
        let take = |name: &str| {
            found
                .iter()
                .find(|(role, _)| *role == name)
                .map(|(_, path)| path.clone())
        };
        Ok(ModelFiles {
            dit: take("dit").ok_or_else(|| format!("{} 里没有 DiT 权重", dir.display()))?,
            dit_high: take("dit_high"),
            te: take("te").ok_or_else(|| format!("{} 里没有文本编码器", dir.display()))?,
            te_aux: take("te_aux"),
            vae: take("vae").ok_or_else(|| format!("{} 里没有 VAE", dir.display()))?,
            audio_vae: take("audio_vae"),
            connectors: take("connectors"),
        })
    }
}

/// 一次生成用到的权重文件（角色 → 路径）。
#[derive(Debug, Clone)]
pub struct ModelFiles {
    pub dit: PathBuf,
    /// Wan2.2 A14B 的 high noise 专家。
    pub dit_high: Option<PathBuf>,
    pub te: PathBuf,
    /// HunyuanVideo 1.5 的 ByT5。
    pub te_aux: Option<PathBuf>,
    pub vae: PathBuf,
    pub audio_vae: Option<PathBuf>,
    pub connectors: Option<PathBuf>,
}

/// Wan 官方示例里的推荐负向提示词：对画面质量影响明显，生成 Wan 时默认带上。
const WAN_NEGATIVE: &str = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

/// LTX-2 官方示例里的负向提示词（英文短句，和 Wan 的中文长串不通用）。
const LTX_NEGATIVE: &str = "worst quality, low quality, blurry, distorted, artifacts";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenRequest {
    pub model_id: String,
    pub prompt: String,
    pub width: u32,
    pub height: u32,
    /// 期望时长（秒）；`frames` 给了就以 `frames` 为准。
    pub seconds: Option<f64>,
    pub frames: Option<u32>,
    pub steps: u32,
    pub seed: i64,
    pub cfg_scale: f32,
    pub flow_shift: f32,
    /// 默认 true：权重放内存、按需进显存。
    pub offload_to_cpu: Option<bool>,
    /// 默认 true：VAE 分块，降低解码峰值。
    pub vae_tiling: Option<bool>,
    /// 首帧参考图（绝对路径）：I2V / I2VA 家族接到 `--init-img`。
    pub init_image: Option<String>,
    /// 尾帧参考图（绝对路径）：FLF2V / FL2VA 家族接到 `--end-img`，需要同时有首帧。
    pub end_image: Option<String>,
    /// 参考图（可多张）：MiniMax-H3 Ref2VA 接到 `-r`，按顺序对应提示词里的 `<Picture N>`。
    pub ref_images: Option<Vec<String>>,
    /// 参考音频（可多条）：MiniMax-H3 Ref2VA 接到 `--ref-audio`。
    pub ref_audios: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenProgress {
    /// `preparing` / `running` / `done` / `error` / `cancelled`
    pub state: String,
    pub message: Option<String>,
    /// 0..1；没有可解析的 step 时是 0。
    pub progress: f32,
    pub elapsed: f64,
    pub step: Option<u32>,
    pub total_steps: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenResult {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
}

struct Runtime {
    running: AtomicBool,
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| Runtime {
        running: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        child: Mutex::new(None),
    })
}

/// 宽高对齐到 32 的倍数（H3 的硬约束；Wan 只要求 16 的倍数，32 同样满足）。
pub fn align_dimension(value: u32) -> u32 {
    value.div_ceil(32) * 32
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

/// 参考音频统一转成 H3 能直接吃的 WAV：立体声 32 kHz、16-bit PCM。
///
/// 素材库里的 mp3 / m4a / 视频音轨都先走 ffmpeg；H3 内部还会再做一次格式归一化，
/// 这里只保证 sd-cli 不会因为容器 / 编码不认而失败。
async fn prepare_ref_audio(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    if cancelled() {
        return Err("已取消".into());
    }
    if !Path::new(source).is_file() {
        return Err(format!("参考音频不存在：{source}"));
    }
    let target = media::cache_dir(app)?.join(format!(
        "video-gen-ref-audio-{}-{}.wav",
        std::process::id(),
        stamp()
    ));
    let args = vec![
        "-y".into(),
        "-i".into(),
        source.into(),
        "-vn".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "32000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        target.to_string_lossy().into_owned(),
    ];
    let (code, _) = crate::sidecar::run_sidecar(app, "ffmpeg", &args).await?;
    if cancelled() {
        let _ = std::fs::remove_file(&target);
        return Err("已取消".into());
    }
    if code != Some(0) || !target.is_file() {
        let _ = std::fs::remove_file(&target);
        return Err(format!("无法读取参考音频：{source}"));
    }
    Ok(target)
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

/// 准备首帧 / 尾帧：任何一步失败都把已生成的临时文件清掉，避免缓存目录堆积。
async fn prepare_optional_image(
    app: &AppHandle,
    source: Option<&str>,
    temp: &mut Vec<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if cancelled() {
        cleanup_paths(temp);
        return Err("已取消".into());
    }
    let Some(source) = source else {
        return Ok(None);
    };
    match crate::image_gen::prepare_init_image(app, source).await {
        Ok(path) => {
            temp.push(path.clone());
            Ok(Some(path))
        }
        Err(error) => {
            cleanup_paths(temp);
            Err(error)
        }
    }
}

async fn prepare_image_list(
    app: &AppHandle,
    sources: &[String],
    temp: &mut Vec<PathBuf>,
) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::with_capacity(sources.len());
    for source in sources {
        if cancelled() {
            cleanup_paths(temp);
            return Err("已取消".into());
        }
        match crate::image_gen::prepare_init_image(app, source).await {
            Ok(path) => {
                temp.push(path.clone());
                out.push(path);
            }
            Err(error) => {
                cleanup_paths(temp);
                return Err(error);
            }
        }
    }
    Ok(out)
}

async fn prepare_audio_list(
    app: &AppHandle,
    sources: &[String],
    temp: &mut Vec<PathBuf>,
) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::with_capacity(sources.len());
    for source in sources {
        if cancelled() {
            cleanup_paths(temp);
            return Err("已取消".into());
        }
        match prepare_ref_audio(app, source).await {
            Ok(path) => {
                temp.push(path.clone());
                out.push(path);
            }
            Err(error) => {
                cleanup_paths(temp);
                return Err(error);
            }
        }
    }
    Ok(out)
}

fn emit(
    app: &AppHandle,
    state: &str,
    message: Option<String>,
    progress: f32,
    elapsed: f64,
    step: Option<u32>,
    total_steps: Option<u32>,
) {
    let _ = app.emit(
        EVENT_VIDEO_GEN,
        VideoGenProgress {
            state: state.to_string(),
            message,
            progress: progress.clamp(0.0, 1.0),
            elapsed,
            step,
            total_steps,
        },
    );
}

fn begin_task() -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有视频生成任务正在运行".into());
    }
    runtime().cancelled.store(false, Ordering::Relaxed);
    if let Ok(mut slot) = runtime().child.lock() {
        *slot = None;
    }
    Ok(())
}

fn end_task() {
    if let Ok(mut slot) = runtime().child.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    runtime().running.store(false, Ordering::SeqCst);
}

fn find_model_file(dir: &Path, needle: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.to_lowercase().contains(needle))
                    .unwrap_or(false)
        })
}

fn parse_step(line: &str, expected: u32) -> Option<(u32, u32)> {
    // 「2/20 images saved」这种收尾统计不是采样步，别让它把进度打回去。
    if line.contains("saved") || line.contains("images") {
        return None;
    }
    for token in line.split_whitespace() {
        let Some((left, right)) = token.split_once('/') else {
            continue;
        };
        let Ok(step) = left
            .trim_matches(|c: char| !c.is_ascii_digit())
            .parse::<u32>()
        else {
            continue;
        };
        let Ok(total) = right
            .trim_matches(|c: char| !c.is_ascii_digit())
            .parse::<u32>()
        else {
            continue;
        };
        if total == expected && total > 0 && step <= total {
            return Some((step, total));
        }
    }
    None
}

fn pump<R: std::io::Read + Send + 'static>(stream: Option<R>, tx: mpsc::Sender<String>) {
    let Some(stream) = stream else {
        return;
    };
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });
}

fn tail_text(lines: &VecDeque<String>) -> String {
    let start = lines.len().saturating_sub(8);
    lines
        .iter()
        .skip(start)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

#[allow(clippy::too_many_arguments)]
fn run(
    app: &AppHandle,
    cli: &Path,
    spec: VideoSpec,
    files: &ModelFiles,
    output: &Path,
    prompt: &str,
    width: u32,
    height: u32,
    frames: u32,
    steps: u32,
    seed: i64,
    cfg_scale: f32,
    flow_shift: f32,
    offload_to_cpu: bool,
    vae_tiling: bool,
    init_image: Option<&Path>,
    end_image: Option<&Path>,
    ref_images: &[PathBuf],
    ref_audios: &[PathBuf],
) -> Result<(), String> {
    let mut command = Command::new(cli);
    command
        .arg("-M")
        .arg("vid_gen")
        .arg("--diffusion-model")
        .arg(&files.dit)
        .arg("--vae")
        .arg(&files.vae);
    // macOS 的 CPU 是「Metal 包 + 强制 CPU」：不传这一条，包里默认走 Metal。
    if let Some(backend) = sdcpp::backend_arg(sdcpp::effective_device(app)) {
        command.arg("--backend").arg(backend);
    }
    // Wan2.2 A14B：high noise 专家先跑，low noise 收尾。
    if let Some(high) = &files.dit_high {
        command.arg("--high-noise-diffusion-model").arg(high);
    }
    // 文本编码器的参数名各家族不一样：Wan 是 UMT5（`--t5xxl`）、H3 / Hunyuan / LTX 是
    // 多模态 LLM（`--llm`），Hunyuan 还要额外挂 ByT5（`--t5xxl`）。
    match spec.text_encoder {
        TextEncoder::T5 => {
            command.arg("--t5xxl").arg(&files.te);
        }
        TextEncoder::Llm => {
            command.arg("--llm").arg(&files.te);
        }
        TextEncoder::LlmAndT5 => {
            command.arg("--llm").arg(&files.te);
            if let Some(aux) = &files.te_aux {
                command.arg("--t5xxl").arg(aux);
            }
        }
    }
    if let Some(connectors) = &files.connectors {
        command.arg("--embeddings-connectors").arg(connectors);
    }
    if let Some(audio_vae) = &files.audio_vae {
        command.arg("--audio-vae").arg(audio_vae);
    }
    if let Some(negative) = spec.negative {
        command.arg("-n").arg(negative);
    }
    if let Some(sampler) = spec.sampler {
        command.arg("--sampling-method").arg(sampler);
    }
    command
        .arg("-p")
        .arg(prompt)
        .arg("--cfg-scale")
        .arg(format!("{cfg_scale:.2}"))
        .arg("-W")
        .arg(width.to_string())
        .arg("-H")
        .arg(height.to_string())
        .arg("--fps")
        .arg(spec.fps.to_string())
        .arg("--video-frames")
        .arg(frames.to_string())
        .arg("--steps")
        .arg(steps.to_string())
        .arg("-s")
        .arg(seed.to_string());
    if spec.uses_flow_shift {
        command.arg("--flow-shift").arg(format!("{flow_shift:.2}"));
    }
    // 首帧 / 尾帧参考图：H3 FL2VA、LTX-2 I2V/FLF2V、Wan2.2 TI2V 5B 都走这两个参数。
    if let Some(init) = init_image {
        command.arg("-i").arg(init);
    }
    if let Some(end) = end_image {
        command.arg("--end-img").arg(end);
    }
    // Ref2VA：参考图可以多张，顺序对应提示词里的 `<Picture 1>` / `<Picture 2>`；
    // 参考音频也可以多条（音色 / 环境声 / 对白参考）。
    for image in ref_images {
        command.arg("-r").arg(image);
    }
    for audio in ref_audios {
        command.arg("--ref-audio").arg(audio);
    }
    // 双专家：界面只给一个步数滑块，high noise 跑前 80% 的步数（官方示例 10 / 8）。
    if files.dit_high.is_some() {
        command
            .arg("--high-noise-steps")
            .arg(((steps * 4 + 4) / 5).max(1).to_string())
            .arg("--high-noise-cfg-scale")
            .arg(format!("{cfg_scale:.2}"))
            .arg("--high-noise-sampling-method")
            .arg("euler");
    }
    command
        .arg("--rng")
        .arg("cpu")
        .arg("--max-vram")
        .arg("0")
        .arg("--flash-attn")
        .arg("off,diffusion=on")
        .arg("-o")
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if offload_to_cpu {
        command.arg("--offload-to-cpu").arg("--mmap");
    }
    if vae_tiling {
        command.arg("--vae-tiling");
        // 时间维分块只有 H3 / Wan2.2 TI2V 5B 用得上，Wan2.1 / A14B 保持逐帧解码。
        if spec.temporal_tiling {
            command.arg("--temporal-tiling");
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    eprintln!(
        "[video-gen] 启动 {}（{}×{}，{} 帧，{} 步，{}）",
        cli.display(),
        width,
        height,
        frames,
        steps,
        output.display()
    );
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 sd-cli 失败：{error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut slot) = runtime().child.lock() {
        *slot = Some(child);
    }

    let (tx, rx) = mpsc::channel::<String>();
    pump(stdout, tx.clone());
    pump(stderr, tx.clone());
    drop(tx);

    let started = Instant::now();
    let mut tail: VecDeque<String> = VecDeque::new();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut current_step = 0u32;
    let mut total_steps = steps;

    for line in rx {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        if let Some((step, total)) = parse_step(&line, steps) {
            current_step = step;
            total_steps = total;
        }
        if tail.len() >= 60 {
            tail.pop_front();
        }
        tail.push_back(line.clone());
        if last_emit.elapsed() >= Duration::from_millis(200) {
            let progress = if total_steps > 0 && current_step > 0 {
                (current_step as f32 / total_steps as f32) * 0.95
            } else {
                0.0
            };
            emit(
                app,
                "running",
                Some(line.clone()),
                progress,
                started.elapsed().as_secs_f64(),
                (current_step > 0).then_some(current_step),
                (total_steps > 0).then_some(total_steps),
            );
            last_emit = Instant::now();
        }
    }

    let child = runtime().child.lock().ok().and_then(|mut slot| slot.take());
    let status = match child {
        Some(mut child) => child.wait().ok(),
        None => None,
    };
    if runtime().cancelled.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }
    match status {
        Some(status) if status.success() => {
            let size = std::fs::metadata(output)
                .map(|meta| meta.len())
                .unwrap_or(0);
            if size == 0 {
                return Err(format!("sd-cli 没有产出视频：{}", tail_text(&tail)));
            }
            emit(
                app,
                "running",
                Some("解码 / 封装完成".into()),
                0.99,
                started.elapsed().as_secs_f64(),
                Some(total_steps),
                Some(total_steps),
            );
            Ok(())
        }
        Some(status) => Err(format!(
            "sd-cli 退出码 {}：{}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_default(),
            tail_text(&tail)
        )),
        None => Err("sd-cli 没有正常结束".into()),
    }
}

#[tauri::command]
pub async fn video_gen_start(
    app: AppHandle,
    request: VideoGenRequest,
) -> Result<VideoGenResult, String> {
    if request.prompt.trim().is_empty() {
        return Err("提示词不能为空".into());
    }
    if crate::image_gen::is_running() {
        return Err("已有图像生成任务正在运行，请先停止它".into());
    }
    let entry = models::by_id(&request.model_id)
        .ok_or_else(|| format!("未知模型：{}", request.model_id))?;
    if entry.feature != "video-gen" {
        return Err(format!("{} 不是视频生成模型", entry.name));
    }
    let model_dir = models::require_dir(&app, entry)?;
    let spec = VideoSpec::for_family(entry.family)
        .ok_or_else(|| format!("{} 不支持 sd.cpp 视频生成", entry.name))?;
    // 权重文件名各家族都不一样（DiT / 文本编码器 / VAE / 音频 VAE …），
    // 由 `VideoSpec::resolve` 按角色去模型目录里找。
    let files = spec.resolve(&model_dir)?;

    let pack = sdcpp::effective_pack(&app).ok_or_else(|| "没有可用的 sd.cpp 引擎".to_string())?;
    let cli = sdcpp::cli_path(&app, pack)
        .ok_or_else(|| format!("sd.cpp 引擎还没下载（{}）", sdcpp::effective_device(&app)))?;

    let frames = match request.frames {
        Some(frames) => spec.align(frames).min(spec.max_frames),
        None => spec.frames_for_seconds(request.seconds.unwrap_or(5.0)),
    };
    let width = align_dimension(request.width.clamp(256, 1920));
    let height = align_dimension(request.height.clamp(256, 1920));
    let steps = request.steps.clamp(1, 50);
    if frames < spec.offset {
        return Err(format!("帧数必须至少为 {}", spec.offset));
    }
    let output =
        media::cache_dir(&app)?.join(format!("video-gen-{}-{}.webm", std::process::id(), stamp()));

    // 参考输入：先校验家族能力，再统一转成 sd-cli 能直接吃的格式。
    // - 首帧 / 尾帧：PNG（EXIF 旋转 / WebP / HEIC 交给 ffmpeg）；
    // - Ref2VA 参考图：PNG（`-r`）；参考音频：立体声 32 kHz PCM WAV（`--ref-audio`）。
    if request.end_image.is_some() && request.init_image.is_none() {
        return Err("尾帧参考图需要同时提供首帧".into());
    }
    if request.init_image.is_some() && !spec.init_image {
        return Err(format!("{} 不支持首帧参考图", entry.name));
    }
    if request.end_image.is_some() && !spec.end_image {
        return Err(format!("{} 不支持尾帧参考图", entry.name));
    }
    let ref_images = request.ref_images.unwrap_or_default();
    let ref_audios = request.ref_audios.unwrap_or_default();
    if !ref_images.is_empty() && !spec.ref_image {
        return Err(format!("{} 不支持参考图", entry.name));
    }
    if !ref_audios.is_empty() && !spec.ref_audio {
        return Err(format!("{} 不支持参考音频", entry.name));
    }
    let keyframes = request.init_image.is_some() || request.end_image.is_some();
    if keyframes && (!ref_images.is_empty() || !ref_audios.is_empty()) {
        return Err("参考图 / 参考音频不能和首帧 / 尾帧同时使用".into());
    }

    // 先占住任务再准备参考图 / 音频：准备阶段也能被「停止」取消，不会出现
    // 用户点了停止、begin_task 又把 cancelled 重置掉的竞态。
    begin_task()?;
    emit(
        &app,
        "preparing",
        Some("加载模型…".into()),
        0.01,
        0.0,
        None,
        Some(steps),
    );

    let mut temp_inputs: Vec<PathBuf> = Vec::new();
    let prepared = async {
        let init_image =
            prepare_optional_image(&app, request.init_image.as_deref(), &mut temp_inputs).await?;
        let end_image =
            prepare_optional_image(&app, request.end_image.as_deref(), &mut temp_inputs).await?;
        let ref_image_paths = prepare_image_list(&app, &ref_images, &mut temp_inputs).await?;
        let ref_audio_paths = prepare_audio_list(&app, &ref_audios, &mut temp_inputs).await?;
        Ok::<_, String>((init_image, end_image, ref_image_paths, ref_audio_paths))
    }
    .await;
    let (init_image, end_image, ref_image_paths, ref_audio_paths) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            end_task();
            cleanup_paths(&temp_inputs);
            emit(&app, "error", Some(error.clone()), 0.0, 0.0, None, None);
            return Err(error);
        }
    };
    if cancelled() {
        end_task();
        cleanup_paths(&temp_inputs);
        emit(
            &app,
            "cancelled",
            Some("已取消".into()),
            0.0,
            0.0,
            None,
            None,
        );
        return Err("已取消".into());
    }

    let app_for_task = app.clone();
    let cli_for_task = cli.clone();
    let output_for_task = output.clone();
    let prompt = request.prompt.trim().to_string();
    let seed = request.seed;
    let cfg_scale = request.cfg_scale.clamp(0.0, 10.0);
    let flow_shift = request.flow_shift.clamp(0.0, 30.0);
    let offload = request.offload_to_cpu.unwrap_or(true);
    let vae_tiling = request.vae_tiling.unwrap_or(true);
    let init_for_task = init_image.clone();
    let end_for_task = end_image.clone();
    let ref_images_for_task = ref_image_paths.clone();
    let ref_audios_for_task = ref_audio_paths.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run(
            &app_for_task,
            &cli_for_task,
            spec,
            &files,
            &output_for_task,
            &prompt,
            width,
            height,
            frames,
            steps,
            seed,
            cfg_scale,
            flow_shift,
            offload,
            vae_tiling,
            init_for_task.as_deref(),
            end_for_task.as_deref(),
            &ref_images_for_task,
            &ref_audios_for_task,
        )
    })
    .await;
    end_task();
    cleanup_paths(&temp_inputs);

    match result {
        Ok(Ok(())) => {
            let path = output.to_string_lossy().into_owned();
            let duration = frames as f64 / spec.fps as f64;
            emit(&app, "done", Some("生成完成".into()), 1.0, 0.0, None, None);
            Ok(VideoGenResult {
                path,
                duration,
                width,
                height,
                frames,
            })
        }
        Ok(Err(error)) => {
            let _ = std::fs::remove_file(&output);
            if error.contains("已取消") {
                emit(
                    &app,
                    "cancelled",
                    Some("已取消".into()),
                    0.0,
                    0.0,
                    None,
                    None,
                );
                Err("已取消".into())
            } else {
                emit(&app, "error", Some(error.clone()), 0.0, 0.0, None, None);
                Err(error)
            }
        }
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            let message = format!("视频生成任务异常：{error}");
            emit(&app, "error", Some(message.clone()), 0.0, 0.0, None, None);
            Err(message)
        }
    }
}

#[tauri::command]
pub fn video_gen_cancel() {
    runtime().cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = runtime().child.lock() {
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
        }
    }
}

/// 当前是否有生成任务（界面挂载时纠正状态用）。
#[tauri::command]
pub fn video_gen_busy() -> bool {
    runtime().running.load(Ordering::SeqCst)
}

/// 是否有视频任务在跑（图像生成用它避免两边同时抢显存）。
pub fn is_running() -> bool {
    runtime().running.load(Ordering::SeqCst)
}

fn cancelled() -> bool {
    runtime().cancelled.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T2V 家族不接受参考图；TI2V 只吃首帧；H3 / LTX-2 同时支持首尾帧。
    #[test]
    fn reference_image_support_matches_family() {
        let h3 = VideoSpec::for_family(models::ModelFamily::MiniMaxH3).unwrap();
        assert!(h3.init_image && h3.end_image);
        assert!(!h3.ref_image && !h3.ref_audio);

        // Ref2VA 反过来：只吃参考图 / 参考音频，不接首尾帧。
        let ref2va = VideoSpec::for_family(models::ModelFamily::MiniMaxH3Ref2va).unwrap();
        assert!(!ref2va.init_image && !ref2va.end_image);
        assert!(ref2va.ref_image && ref2va.ref_audio);
        assert_eq!((ref2va.fps, ref2va.step, ref2va.offset), (24, 17, 5));

        let ti2v = VideoSpec::for_family(models::ModelFamily::Wan22Ti2v).unwrap();
        assert!(ti2v.init_image);
        assert!(!ti2v.end_image);

        for family in [
            models::ModelFamily::Wan21T2v,
            models::ModelFamily::Wan22T2vA14b,
            models::ModelFamily::HunyuanVideo15,
        ] {
            let spec = VideoSpec::for_family(family).unwrap();
            assert!(!spec.init_image && !spec.end_image, "{family:?}");
            assert!(!spec.ref_image && !spec.ref_audio, "{family:?}");
        }

        for family in [models::ModelFamily::Ltx23, models::ModelFamily::Ltx25] {
            let spec = VideoSpec::for_family(family).unwrap();
            assert!(spec.init_image && spec.end_image, "{family:?}");
            assert!(!spec.ref_image && !spec.ref_audio, "{family:?}");
        }
    }

    #[test]
    fn frame_grid_rounds_up() {
        let h3 = VideoSpec::for_family(models::ModelFamily::MiniMaxH3).unwrap();
        assert_eq!(h3.align(5), 5);
        assert_eq!(h3.align(120), 124);
        assert_eq!(h3.align(124), 124);
        assert_eq!(h3.align(240), 243);
        assert_eq!(h3.frames_for_seconds(10.0), 243);
        assert_eq!(h3.frames_for_seconds(5.0), 124);
        assert_eq!(h3.frames_for_seconds(0.0), 5);
    }

    #[test]
    fn wan_uses_its_own_grid_and_fps() {
        let wan = VideoSpec::for_family(models::ModelFamily::Wan21T2v).unwrap();
        assert_eq!(wan.fps, 16);
        assert_eq!(wan.align(33), 33);
        assert_eq!(wan.align(34), 37);
        assert_eq!(wan.frames_for_seconds(5.0), 81);
        assert_eq!(wan.frames_for_seconds(10.0), 161);
        // 非视频家族没有帧率 / 网格。
        assert!(VideoSpec::for_family(models::ModelFamily::Whisper).is_none());
    }

    /// Wan2.2 的 5B 是 24 fps、A14B 仍是 16 fps；LTX-2 的 VAE 是 8 帧一压。
    #[test]
    fn newer_families_have_their_own_grids() {
        let ti2v = VideoSpec::for_family(models::ModelFamily::Wan22Ti2v).unwrap();
        assert_eq!((ti2v.fps, ti2v.step, ti2v.offset), (24, 4, 1));
        assert_eq!(ti2v.frames_for_seconds(5.0), 121);
        assert!(ti2v.temporal_tiling);

        let a14b = VideoSpec::for_family(models::ModelFamily::Wan22T2vA14b).unwrap();
        assert_eq!((a14b.fps, a14b.step, a14b.offset), (16, 4, 1));
        assert!(a14b
            .roles
            .iter()
            .any(|role| role.role == "dit_high" && role.required));
        assert!(a14b.uses_flow_shift);

        let ltx = VideoSpec::for_family(models::ModelFamily::Ltx23).unwrap();
        assert_eq!((ltx.fps, ltx.step, ltx.offset), (24, 8, 1));
        assert_eq!(ltx.frames_for_seconds(5.0), 121);
        // LTX / Hunyuan 不传 flow shift，靠 sd.cpp 自己的默认值。
        assert!(!ltx.uses_flow_shift);

        let ltx25 = VideoSpec::for_family(models::ModelFamily::Ltx25).unwrap();
        assert_eq!((ltx25.fps, ltx25.step, ltx25.offset), (24, 8, 1));
        // 2.5 的投影层内置在文本编码器里，不再需要 embeddings connectors。
        assert!(!ltx25.roles.iter().any(|role| role.role == "connectors"));

        let hunyuan = VideoSpec::for_family(models::ModelFamily::HunyuanVideo15).unwrap();
        assert_eq!(hunyuan.text_encoder, TextEncoder::LlmAndT5);
        assert!(hunyuan
            .roles
            .iter()
            .any(|role| role.role == "te_aux" && role.required));
    }

    /// 每个家族的角色表都要能覆盖它需要的文件，且文件名片段互不冲突。
    #[test]
    fn file_roles_are_complete() {
        for family in [
            models::ModelFamily::Wan21T2v,
            models::ModelFamily::Wan22Ti2v,
            models::ModelFamily::Wan22T2vA14b,
            models::ModelFamily::HunyuanVideo15,
            models::ModelFamily::Ltx23,
            models::ModelFamily::Ltx25,
            models::ModelFamily::MiniMaxH3,
            models::ModelFamily::MiniMaxH3Ref2va,
        ] {
            let spec = VideoSpec::for_family(family).expect("视频家族都要有规格");
            for role in ["dit", "te", "vae"] {
                assert!(
                    spec.roles
                        .iter()
                        .any(|entry| entry.role == role && entry.required),
                    "{:?} 缺少必需的 {}",
                    family,
                    role
                );
            }
        }
    }

    /// 把清单里每个家族的文件名放进一个空目录，确认角色表挑出来的正是该挑的那几个。
    /// 这里最容易出错的是一族里同时有 `video_vae` / `audio_vae`、或者是双专家。
    #[test]
    fn file_roles_pick_the_right_weights() {
        struct Case {
            family: models::ModelFamily,
            names: &'static [&'static str],
            dit: &'static str,
            dit_high: Option<&'static str>,
            te: &'static str,
            te_aux: Option<&'static str>,
            vae: &'static str,
            audio_vae: Option<&'static str>,
            connectors: Option<&'static str>,
        }
        let cases = [
            Case {
                family: models::ModelFamily::Wan21T2v,
                names: &[
                    "wan2.1_t2v_1.3B_fp16.safetensors",
                    "wan_2.1_vae.safetensors",
                    "umt5-xxl-encoder-Q4_K_M.gguf",
                ],
                dit: "wan2.1_t2v_1.3B_fp16.safetensors",
                dit_high: None,
                te: "umt5-xxl-encoder-Q4_K_M.gguf",
                te_aux: None,
                vae: "wan_2.1_vae.safetensors",
                audio_vae: None,
                connectors: None,
            },
            Case {
                family: models::ModelFamily::Wan22Ti2v,
                names: &[
                    "Wan2.2-TI2V-5B-Q4_K_M.gguf",
                    "wan2.2_vae.safetensors",
                    "umt5-xxl-encoder-Q4_K_M.gguf",
                ],
                dit: "Wan2.2-TI2V-5B-Q4_K_M.gguf",
                dit_high: None,
                te: "umt5-xxl-encoder-Q4_K_M.gguf",
                te_aux: None,
                vae: "wan2.2_vae.safetensors",
                audio_vae: None,
                connectors: None,
            },
            Case {
                family: models::ModelFamily::Wan22T2vA14b,
                names: &[
                    "Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
                    "Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf",
                    "wan_2.1_vae.safetensors",
                    "umt5-xxl-encoder-Q4_K_M.gguf",
                ],
                dit: "Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
                dit_high: Some("Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf"),
                te: "umt5-xxl-encoder-Q4_K_M.gguf",
                te_aux: None,
                vae: "wan_2.1_vae.safetensors",
                audio_vae: None,
                connectors: None,
            },
            Case {
                family: models::ModelFamily::HunyuanVideo15,
                names: &[
                    "hunyuanvideo1.5_720p_t2v_fp16.safetensors",
                    "hunyuanvideo15_vae_fp16.safetensors",
                    "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                    "byt5_small_glyphxl_fp16.safetensors",
                ],
                dit: "hunyuanvideo1.5_720p_t2v_fp16.safetensors",
                dit_high: None,
                te: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                te_aux: Some("byt5_small_glyphxl_fp16.safetensors"),
                vae: "hunyuanvideo15_vae_fp16.safetensors",
                audio_vae: None,
                connectors: None,
            },
            Case {
                family: models::ModelFamily::Ltx23,
                names: &[
                    "ltx-2.3-22b-dev-Q4_K_M.gguf",
                    "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
                    "ltx-2.3-22b-dev_embeddings_connectors.safetensors",
                    "ltx-2.3-22b-dev_video_vae.safetensors",
                    "ltx-2.3-22b-dev_audio_vae.safetensors",
                ],
                dit: "ltx-2.3-22b-dev-Q4_K_M.gguf",
                dit_high: None,
                te: "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
                te_aux: None,
                vae: "ltx-2.3-22b-dev_video_vae.safetensors",
                audio_vae: Some("ltx-2.3-22b-dev_audio_vae.safetensors"),
                connectors: Some("ltx-2.3-22b-dev_embeddings_connectors.safetensors"),
            },
            Case {
                family: models::ModelFamily::MiniMaxH3,
                names: &[
                    "minimax_h3_fl2va_pruned-Q4_K_M.gguf",
                    "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
                    "minimax_h3_video_vae_fp16.safetensors",
                    "minimax_h3_audio_vae_fp32.safetensors",
                ],
                dit: "minimax_h3_fl2va_pruned-Q4_K_M.gguf",
                dit_high: None,
                te: "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
                te_aux: None,
                vae: "minimax_h3_video_vae_fp16.safetensors",
                audio_vae: Some("minimax_h3_audio_vae_fp32.safetensors"),
                connectors: None,
            },
            Case {
                family: models::ModelFamily::MiniMaxH3Ref2va,
                names: &[
                    "minimax_h3_ref2va_pruned-Q4_K_M.gguf",
                    "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
                    "minimax_h3_video_vae_fp16.safetensors",
                    "minimax_h3_audio_vae_fp32.safetensors",
                ],
                dit: "minimax_h3_ref2va_pruned-Q4_K_M.gguf",
                dit_high: None,
                te: "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
                te_aux: None,
                vae: "minimax_h3_video_vae_fp16.safetensors",
                audio_vae: Some("minimax_h3_audio_vae_fp32.safetensors"),
                connectors: None,
            },
            Case {
                family: models::ModelFamily::Ltx25,
                names: &[
                    "ltx-2.5-22b-dev-transformer-Q4_K_M.gguf",
                    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
                    "ltx-2.5-video-vae-conv-bf16.safetensors",
                    "ltx-2.5-audio-vae-bf16.safetensors",
                ],
                dit: "ltx-2.5-22b-dev-transformer-Q4_K_M.gguf",
                dit_high: None,
                te: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
                te_aux: None,
                vae: "ltx-2.5-video-vae-conv-bf16.safetensors",
                audio_vae: Some("ltx-2.5-audio-vae-bf16.safetensors"),
                connectors: None,
            },
        ];
        let name_of = |path: &Option<PathBuf>| {
            path.as_ref()
                .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        };
        for (index, case) in cases.iter().enumerate() {
            let dir =
                std::env::temp_dir().join(format!("aicut-roles-{}-{index}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            for name in case.names {
                std::fs::write(dir.join(name), b"").unwrap();
            }
            let spec = VideoSpec::for_family(case.family).expect("视频家族都要有规格");
            let files = spec.resolve(&dir).expect("解析权重文件");
            assert_eq!(
                name_of(&Some(files.dit.clone())).as_deref(),
                Some(case.dit),
                "{:?} 的 DiT 找错了",
                case.family
            );
            assert_eq!(name_of(&files.dit_high).as_deref(), case.dit_high);
            assert_eq!(
                name_of(&Some(files.te.clone())).as_deref(),
                Some(case.te),
                "{:?} 的文本编码器找错了",
                case.family
            );
            assert_eq!(name_of(&files.te_aux).as_deref(), case.te_aux);
            assert_eq!(
                name_of(&Some(files.vae.clone())).as_deref(),
                Some(case.vae),
                "{:?} 的 VAE 找错了",
                case.family
            );
            assert_eq!(name_of(&files.audio_vae).as_deref(), case.audio_vae);
            assert_eq!(name_of(&files.connectors).as_deref(), case.connectors);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn dimensions_are_32_aligned() {
        assert_eq!(align_dimension(864), 864);
        assert_eq!(align_dimension(865), 896);
        assert_eq!(align_dimension(480), 480);
        assert_eq!(align_dimension(481), 512);
    }

    #[test]
    fn parses_step_lines() {
        assert_eq!(parse_step("step 3/20", 20), Some((3, 20)));
        assert_eq!(parse_step("[INFO ] 12/20 - 1.2s", 20), Some((12, 20)));
        // 收尾统计不是采样步，不能把进度打回去。
        assert_eq!(parse_step("saved 2/20 images", 20), None);
        assert_eq!(parse_step("step 3/20", 8), None);
    }
}
