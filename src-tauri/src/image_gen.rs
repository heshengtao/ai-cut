//! **图像生成 / 图像编辑**：把 stable-diffusion.cpp 的 `sd-cli` 当成外部进程来跑。
//!
//! 和视频生成共用同一套 sd.cpp 引擎（`sdcpp.rs`）与「拼参数 → 起子进程 → 读 stderr
//! 进度」的流程，但图像这边一条命令同时覆盖三种用法：
//!
//! - **文生图**：不传 `--init-img`；
//! - **图生图 / 局部重绘**：`--init-img` + 可选 `--mask` + `--strength`（白色 = 重绘）；
//! - **指令改图**：FLUX.1 Kontext / Qwen-Image-Edit 用 `--ref-image`；涂抹了 mask 时
//!   再叠一层 `--init-img` + `--mask`，让局部重绘也按参考图条件走。
//!
//! 家族差异全部收在 [`ImageSpec`] 里：单文件 checkpoint 还是分体权重、文本编码器
//! 用 `--llm` 还是 `--clip_l` + `--t5xxl`、要不要视觉投影层（`--llm_vision`）、
//! 默认步数 / CFG / flow shift、宽高对齐单位。
//!
//! 显存策略与视频一致：默认 `--offload-to-cpu` + `--mmap` + `--vae-tiling` +
//! `--max-vram 0`；大模型在 16 GB 机器上主要靠权重放内存。

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{media, models, sdcpp};

pub const EVENT_IMAGE_GEN: &str = "image-gen-progress";

/// 权重文件在模型目录里怎么找：一个角色 + 若干文件名片段（小写包含匹配）。
#[derive(Debug, Clone, Copy)]
pub struct FileRole {
    /// `model` / `dit` / `vae` / `te` / `te_aux` / `te_vision`。
    pub role: &'static str,
    /// 按顺序尝试的文件名片段。
    pub needles: &'static [&'static str],
    /// 缺这个文件还能不能跑。
    pub required: bool,
}

/// 权重布局：SD 1.5 / SDXL 是一个 checkpoint，其余是 DiT + VAE + 文本编码器。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightLayout {
    /// `-m xxx.safetensors`
    Single,
    /// `--diffusion-model` + `--vae` (+ 文本编码器)
    Split,
}

/// 文本编码器接在哪个参数上。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoder {
    /// 单文件 checkpoint 自带文本编码器。
    None,
    /// `--llm`：Qwen2.5-VL（Qwen-Image）/ Qwen3（Z-Image）。
    Llm,
    /// `--clip_l` + `--t5xxl`：FLUX 的 CLIP-L + T5-XXL。
    ClipLAndT5,
}

/// 一个图像模型家族的完整生成规格。
#[derive(Debug, Clone, Copy)]
pub struct ImageSpec {
    pub layout: WeightLayout,
    pub encoder: TextEncoder,
    /// Qwen-Image-Edit 2509 需要 `--llm_vision`（Qwen2.5-VL 视觉投影层）。
    pub vision: bool,
    /// 用 `--ref-image` 做整图指令编辑（Kontext / Qwen-Image-Edit）。
    pub ref_edit: bool,
    /// 能不能文生图（SD 1.5 那档是 inpainting 专用权重，只能改图）。
    pub draw: bool,
    /// 官方建议的采样步数。
    pub steps: u32,
    /// 官方建议的 CFG。
    pub cfg: f32,
    /// 官方建议的 flow shift；`None` = 不传，用 sd.cpp 默认值。
    pub flow_shift: Option<f32>,
    /// 采样器；`None` 用 sd.cpp 默认值。
    pub sampler: Option<&'static str>,
    /// 是否支持负向提示词（CFG=1 的蒸馏模型忽略它）。
    pub negative: bool,
    /// 宽高对齐单位（SD 64 / FLUX 16 / Qwen 32）。
    pub multiple: u32,
    /// 权重文件角色。
    pub roles: &'static [FileRole],
}

const SD15_FILES: &[FileRole] = &[FileRole {
    role: "model",
    needles: &["sd-v1-5-inpainting"],
    required: true,
}];

const SDXL_FILES: &[FileRole] = &[FileRole {
    role: "model",
    needles: &["sd_xl_base"],
    required: true,
}];

const ZIMAGE_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["z_image_turbo"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["ae"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen3"],
        required: true,
    },
];

const FLUX_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["flux1-schnell"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["ae"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["t5xxl"],
        required: true,
    },
    FileRole {
        role: "te_aux",
        needles: &["clip_l"],
        required: true,
    },
];

const KONTEXT_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["flux1-kontext"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["ae"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["t5xxl"],
        required: true,
    },
    FileRole {
        role: "te_aux",
        needles: &["clip_l"],
        required: true,
    },
];

const QWEN_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["qwen_image-q4", "qwen-image-q4"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen2.5-vl"],
        required: true,
    },
];

const QWEN_EDIT_FILES: &[FileRole] = &[
    FileRole {
        role: "dit",
        needles: &["qwen-image-edit"],
        required: true,
    },
    FileRole {
        role: "vae",
        needles: &["vae"],
        required: true,
    },
    // 视觉投影层先认领，避免 `qwen2.5-vl` 宽匹配把 mmproj 当成主文本编码器。
    FileRole {
        role: "te_vision",
        needles: &["mmproj"],
        required: true,
    },
    FileRole {
        role: "te",
        needles: &["qwen2.5-vl"],
        required: true,
    },
];

impl ImageSpec {
    /// 这个家族能不能用 `sd-cli` 生成 / 编辑图像。
    pub fn for_family(family: models::ModelFamily) -> Option<Self> {
        match family {
            models::ModelFamily::Sd15 => Some(Self {
                layout: WeightLayout::Single,
                encoder: TextEncoder::None,
                vision: false,
                ref_edit: false,
                draw: false,
                steps: 20,
                cfg: 7.5,
                flow_shift: None,
                sampler: Some("euler_a"),
                negative: true,
                multiple: 64,
                roles: SD15_FILES,
            }),
            models::ModelFamily::Sdxl => Some(Self {
                layout: WeightLayout::Single,
                encoder: TextEncoder::None,
                vision: false,
                ref_edit: false,
                draw: true,
                steps: 25,
                cfg: 7.0,
                flow_shift: None,
                sampler: Some("euler"),
                negative: true,
                multiple: 64,
                roles: SDXL_FILES,
            }),
            models::ModelFamily::ZImageTurbo => Some(Self {
                layout: WeightLayout::Split,
                encoder: TextEncoder::Llm,
                vision: false,
                ref_edit: false,
                draw: true,
                steps: 8,
                cfg: 1.0,
                flow_shift: None,
                sampler: Some("euler"),
                negative: false,
                multiple: 32,
                roles: ZIMAGE_FILES,
            }),
            models::ModelFamily::Flux1Schnell => Some(Self {
                layout: WeightLayout::Split,
                encoder: TextEncoder::ClipLAndT5,
                vision: false,
                ref_edit: false,
                draw: true,
                steps: 4,
                cfg: 1.0,
                flow_shift: None,
                sampler: Some("euler"),
                negative: false,
                multiple: 16,
                roles: FLUX_FILES,
            }),
            models::ModelFamily::Flux1Kontext => Some(Self {
                layout: WeightLayout::Split,
                encoder: TextEncoder::ClipLAndT5,
                vision: false,
                ref_edit: true,
                draw: false,
                steps: 20,
                cfg: 1.0,
                flow_shift: None,
                sampler: Some("euler"),
                negative: false,
                multiple: 16,
                roles: KONTEXT_FILES,
            }),
            models::ModelFamily::QwenImage => Some(Self {
                layout: WeightLayout::Split,
                encoder: TextEncoder::Llm,
                vision: false,
                ref_edit: false,
                draw: true,
                steps: 20,
                cfg: 2.5,
                flow_shift: Some(3.0),
                sampler: Some("euler"),
                negative: true,
                multiple: 32,
                roles: QWEN_FILES,
            }),
            models::ModelFamily::QwenImageEdit => Some(Self {
                layout: WeightLayout::Split,
                encoder: TextEncoder::Llm,
                vision: true,
                ref_edit: true,
                draw: false,
                steps: 20,
                cfg: 2.5,
                flow_shift: Some(3.0),
                sampler: Some("euler"),
                negative: false,
                multiple: 32,
                roles: QWEN_EDIT_FILES,
            }),
            _ => None,
        }
    }

    /// 宽高对齐到模型要求的倍数（不小于 64）。
    pub fn align(&self, value: u32) -> u32 {
        value.max(64).div_ceil(self.multiple) * self.multiple
    }

    /// 在模型目录里按角色找权重文件。
    pub fn resolve(&self, dir: &Path) -> Result<ModelFiles, String> {
        let mut found: Vec<(&'static str, PathBuf)> = Vec::new();
        let mut used: Vec<PathBuf> = Vec::new();
        for role in self.roles {
            let hit = role
                .needles
                .iter()
                .find_map(|needle| find_model_file(dir, needle, &used));
            match hit {
                Some(path) => {
                    used.push(path.clone());
                    found.push((role.role, path));
                }
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
            model: take("model"),
            dit: take("dit"),
            vae: take("vae"),
            te: take("te"),
            te_aux: take("te_aux"),
            te_vision: take("te_vision"),
        })
    }
}

/// 一次生成用到的权重文件（角色 → 路径）。
#[derive(Debug, Clone, Default)]
pub struct ModelFiles {
    /// SD 1.5 / SDXL 的单文件 checkpoint。
    pub model: Option<PathBuf>,
    pub dit: Option<PathBuf>,
    pub vae: Option<PathBuf>,
    pub te: Option<PathBuf>,
    /// FLUX 的 CLIP-L。
    pub te_aux: Option<PathBuf>,
    /// Qwen-Image-Edit 的视觉投影层。
    pub te_vision: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenRequest {
    pub model_id: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub seed: i64,
    pub cfg_scale: f32,
    pub flow_shift: Option<f32>,
    /// 原图绝对路径：图生图 / 局部重绘 / 指令改图。
    pub init_image: Option<String>,
    /// 白色涂抹区域 + 透明背景的 PNG data URL。
    pub mask_png: Option<String>,
    /// 重绘强度（0..1）；只有带原图时生效。
    pub strength: Option<f32>,
    /// 默认 true：权重放内存、按需进显存。
    pub offload_to_cpu: Option<bool>,
    /// 默认 true：VAE 分块，降低解码峰值。
    pub vae_tiling: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenProgress {
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
pub struct ImageGenResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
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

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
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
        EVENT_IMAGE_GEN,
        ImageGenProgress {
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
        return Err("已有图像生成任务正在运行".into());
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

fn find_model_file(dir: &Path, needle: &str, used: &[PathBuf]) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && !used.contains(path)
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.to_lowercase().contains(needle))
                    .unwrap_or(false)
        })
}

fn parse_step(line: &str, expected: u32) -> Option<(u32, u32)> {
    // 「saved 2/20 images」这种收尾统计不是采样步，别让进度打回去。
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

/// 拼 `sd-cli` 参数。单独抽出来，测试可以逐条核对每个家族的差异。
#[allow(clippy::too_many_arguments)]
fn command_args(
    spec: ImageSpec,
    files: &ModelFiles,
    output: &Path,
    prompt: &str,
    negative: Option<&str>,
    width: u32,
    height: u32,
    steps: u32,
    seed: i64,
    cfg_scale: f32,
    flow_shift: Option<f32>,
    strength: f32,
    init: Option<&Path>,
    mask: Option<&Path>,
    offload_to_cpu: bool,
    vae_tiling: bool,
) -> Vec<String> {
    macro_rules! arg {
        ($args:expr; $($value:expr),+ $(,)?) => {
            $( $args.push($value.to_string()); )+
        };
    }

    let mut args: Vec<String> = Vec::new();
    arg!(args; "-M", "img_gen");

    match spec.layout {
        WeightLayout::Single => {
            if let Some(model) = &files.model {
                arg!(args; "-m", model.to_string_lossy());
            }
        }
        WeightLayout::Split => {
            if let Some(dit) = &files.dit {
                arg!(args; "--diffusion-model", dit.to_string_lossy());
            }
            if let Some(vae) = &files.vae {
                arg!(args; "--vae", vae.to_string_lossy());
            }
        }
    }
    match spec.encoder {
        TextEncoder::None => {}
        TextEncoder::Llm => {
            if let Some(te) = &files.te {
                arg!(args; "--llm", te.to_string_lossy());
            }
        }
        TextEncoder::ClipLAndT5 => {
            if let Some(aux) = &files.te_aux {
                arg!(args; "--clip_l", aux.to_string_lossy());
            }
            if let Some(te) = &files.te {
                arg!(args; "--t5xxl", te.to_string_lossy());
            }
        }
    }
    if spec.vision {
        if let Some(vision) = &files.te_vision {
            arg!(args; "--llm_vision", vision.to_string_lossy());
        }
    }
    if spec.negative {
        if let Some(negative) = negative.map(str::trim).filter(|text| !text.is_empty()) {
            arg!(args; "-n", negative);
        }
    }
    if let Some(sampler) = spec.sampler {
        arg!(args; "--sampling-method", sampler);
    }
    arg!(args; "-p", prompt);
    arg!(args; "--cfg-scale", format!("{cfg_scale:.2}"));
    arg!(args; "-W", width);
    arg!(args; "-H", height);
    arg!(args; "--steps", steps);
    arg!(args; "-s", seed);
    if let Some(shift) = flow_shift {
        arg!(args; "--flow-shift", format!("{shift:.2}"));
    }

    // 指令改图：原图作为参考条件（整图编辑，不需要 mask）。
    if let Some(init) = init {
        if spec.ref_edit {
            arg!(args; "-r", init.to_string_lossy());
        }
    }
    // 图生图 / 局部重绘：带 mask 时按强度只重绘白色区域；没涂 mask 时是整图重绘。
    // 指令改图家族只有在涂了 mask 时才额外走 init，避免把整图编辑降级成普通 img2img。
    let use_init = match init {
        Some(_) if spec.ref_edit => mask.is_some(),
        Some(_) => true,
        None => false,
    };
    if use_init {
        let init = init.expect("use_init 只在有原图时为真");
        arg!(args; "--init-img", init.to_string_lossy());
        if let Some(mask) = mask {
            arg!(args; "--mask", mask.to_string_lossy());
        }
        arg!(args; "--strength", format!("{strength:.2}"));
    }

    arg!(args; "--rng", "cpu");
    arg!(args; "--max-vram", 0);
    arg!(args; "-o", output.to_string_lossy());
    if offload_to_cpu {
        arg!(args; "--offload-to-cpu", "--mmap");
    }
    if vae_tiling {
        arg!(args; "--vae-tiling");
    }
    args
}

/// Metal 上的已知 sd.cpp 缺陷规避（都在 [sd.cpp #2149] / [#1990] 里复现过）：
///
/// - `#2149`：Metal 的 `GROUP_NORM` 只写 batch 0，开启 batched CFG 后第二个分支
///   保持未初始化，SD 1.5 / SDXL 会稳定产出全白图。关掉这一条即可绕开；
///   CPU / CUDA / Vulkan 不受影响，保持默认（更快）。
/// - `#1990`：Apple M5 的 Metal tensor API 会让 Z-Image Turbo 静默输出全白 PNG
///   （退出码仍是 0）。Z-Image 在 Metal 上改用非 tensor 路径。
///
/// 注意：上游 PR #2296 已修 GROUP_NORM 的 batch 处理。等 `sdcpp.rs` 的 `REVISION`
/// 换成包含该修复的 release 后，`--batched-cfg off` 就可以删掉。
///
/// [#2149]: https://github.com/leejet/stable-diffusion.cpp/issues/2149
/// [#1990]: https://github.com/leejet/stable-diffusion.cpp/issues/1990
fn metal_guard_args(device: &str) -> &'static [&'static str] {
    if device == "metal" {
        &["--batched-cfg", "off"]
    } else {
        &[]
    }
}

/// Z-Image 在 Metal 上要关掉 tensor API（见 [`metal_guard_args`] 的 #1990）。
fn metal_env(device: &str, family: models::ModelFamily) -> Option<(&'static str, &'static str)> {
    (device == "metal" && family == models::ModelFamily::ZImageTurbo)
        .then_some(("GGML_METAL_TENSOR_DISABLE", "1"))
}

#[allow(clippy::too_many_arguments)]
fn run(
    app: &AppHandle,
    cli: &Path,
    family: models::ModelFamily,
    spec: ImageSpec,
    files: &ModelFiles,
    output: &Path,
    prompt: &str,
    negative: Option<&str>,
    width: u32,
    height: u32,
    steps: u32,
    seed: i64,
    cfg_scale: f32,
    flow_shift: Option<f32>,
    strength: f32,
    init: Option<&Path>,
    mask: Option<&Path>,
    offload_to_cpu: bool,
    vae_tiling: bool,
) -> Result<(), String> {
    let mut args = command_args(
        spec,
        files,
        output,
        prompt,
        negative,
        width,
        height,
        steps,
        seed,
        cfg_scale,
        flow_shift,
        strength,
        init,
        mask,
        offload_to_cpu,
        vae_tiling,
    );
    let device = sdcpp::effective_device(app);
    // Metal 的 batched CFG 会产出全白图（sd.cpp #2149）。
    args.extend(metal_guard_args(device).iter().map(|arg| arg.to_string()));
    // macOS 的 CPU 是「Metal 包 + 强制 CPU」：不传这一条，包里默认走 Metal。
    if let Some(backend) = sdcpp::backend_arg(device) {
        args.push("--backend".to_string());
        args.push(backend.to_string());
    }
    let mut command = Command::new(cli);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some((key, value)) = metal_env(device, family) {
        command.env(key, value);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    eprintln!(
        "[image-gen] 启动 {}（{}×{}，{} 步，{}）",
        cli.display(),
        width,
        height,
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
                return Err(format!("sd-cli 没有产出图片：{}", tail_text(&tail)));
            }
            emit(
                app,
                "running",
                Some("解码完成".into()),
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

/// 把素材库里的任意图片转成 PNG：ffmpeg 顺带处理 EXIF 旋转 / WebP / HEIC。
pub(crate) async fn prepare_init_image(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    if !Path::new(source).is_file() {
        return Err(format!("原图不存在：{source}"));
    }
    let target = media::cache_dir(app)?.join(format!(
        "image-gen-init-{}-{}.png",
        std::process::id(),
        stamp()
    ));
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        source.into(),
        "-frames:v".into(),
        "1".into(),
        // 长边超过 2048 的照片先缩下来：sd.cpp 反正会按请求尺寸重采样，
        // 提前缩小可以避免 stb_image 把整张 50MP 原图读进内存。
        "-vf".into(),
        "scale=w='min(iw\\,2048)':h='min(ih\\,2048)':force_original_aspect_ratio=decrease".into(),
        target.to_string_lossy().into_owned(),
    ];
    let (code, _) = crate::sidecar::run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) || !target.is_file() {
        return Err(format!("无法读取原图：{source}"));
    }
    Ok(target)
}

/// 把前端画布导出的 `data:image/png;base64,...` 落到缓存目录。
fn write_mask(app: &AppHandle, png: &str) -> Result<PathBuf, String> {
    const PREFIX: &str = "data:image/png;base64,";
    const LIMIT: usize = 32 * 1024 * 1024;
    let payload = png.trim().strip_prefix(PREFIX).unwrap_or(png.trim());
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|error| format!("mask 数据无效：{error}"))?;
    if bytes.is_empty() {
        return Err("mask 数据为空".into());
    }
    if bytes.len() > LIMIT {
        return Err("mask 图片过大".into());
    }
    let path = media::cache_dir(app)?.join(format!(
        "image-gen-mask-{}-{}.png",
        std::process::id(),
        stamp()
    ));
    std::fs::write(&path, bytes).map_err(|error| format!("写入 mask 失败：{error}"))?;
    Ok(path)
}

fn cleanup(paths: &[Option<PathBuf>]) {
    for path in paths.iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn image_gen_start(
    app: AppHandle,
    request: ImageGenRequest,
) -> Result<ImageGenResult, String> {
    if request.prompt.trim().is_empty() {
        return Err("提示词不能为空".into());
    }
    if crate::video_gen::is_running() {
        return Err("已有视频生成任务正在运行，请先停止它".into());
    }
    let entry = models::by_id(&request.model_id)
        .ok_or_else(|| format!("未知模型：{}", request.model_id))?;
    if entry.feature != "image-gen" {
        return Err(format!("{} 不是图像生成模型", entry.name));
    }
    let model_dir = models::require_dir(&app, entry)?;
    let spec = ImageSpec::for_family(entry.family)
        .ok_or_else(|| format!("{} 不支持 sd.cpp 图像生成", entry.name))?;
    let files = spec.resolve(&model_dir)?;

    let pack = sdcpp::effective_pack(&app).ok_or_else(|| "没有可用的 sd.cpp 引擎".to_string())?;
    let cli = sdcpp::cli_path(&app, pack)
        .ok_or_else(|| format!("sd.cpp 引擎还没下载（{}）", sdcpp::effective_device(&app)))?;

    let width = spec.align(request.width.clamp(256, 2048));
    let height = spec.align(request.height.clamp(256, 2048));
    // 0 表示「用模型家族的官方默认值」；界面正常会带上具体数字。
    let steps = if request.steps == 0 {
        spec.steps
    } else {
        request.steps.clamp(1, 60)
    };
    let cfg_scale = if request.cfg_scale <= 0.0 {
        spec.cfg
    } else {
        request.cfg_scale.clamp(0.0, 20.0)
    };
    let strength = request.strength.unwrap_or(0.75).clamp(0.05, 1.0);
    let flow_shift = request.flow_shift.or(spec.flow_shift);
    let offload = request.offload_to_cpu.unwrap_or(true);
    let vae_tiling = request.vae_tiling.unwrap_or(true);

    if request.init_image.is_none() && request.mask_png.is_some() {
        return Err("涂抹 mask 前先选择一张图片".into());
    }
    // 只改图的模型（SD 1.5 重绘 / Kontext / Qwen-Image-Edit）没有文生图能力：
    // 界面上它们只在图像编辑页出现，这里再兜一层，防止旧快捷键 / 外部调用绕过界面。
    if !spec.draw && request.init_image.is_none() {
        return Err(format!("{} 只能用于图像编辑，请先选择一张原图", entry.name));
    }
    let init = match request.init_image.as_deref() {
        Some(source) => Some(prepare_init_image(&app, source).await?),
        None => None,
    };
    let mask = match request.mask_png.as_deref() {
        Some(png) => match write_mask(&app, png) {
            Ok(path) => Some(path),
            Err(error) => {
                if let Some(init) = &init {
                    let _ = std::fs::remove_file(init);
                }
                return Err(error);
            }
        },
        None => None,
    };
    let cleanup_paths = [init.clone(), mask.clone()];

    let output =
        media::cache_dir(&app)?.join(format!("image-gen-{}-{}.png", std::process::id(), stamp()));
    let negative = request.negative_prompt.unwrap_or_default();
    let prompt = request.prompt.trim().to_string();
    let seed = request.seed;

    begin_task().map_err(|error| {
        cleanup(&cleanup_paths);
        error
    })?;
    emit(
        &app,
        "preparing",
        Some("加载模型…".into()),
        0.01,
        0.0,
        None,
        Some(steps),
    );
    let app_for_task = app.clone();
    let cli_for_task = cli.clone();
    let output_for_task = output.clone();
    let init_for_task = init.clone();
    let mask_for_task = mask.clone();
    let negative_for_task = negative.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run(
            &app_for_task,
            &cli_for_task,
            entry.family,
            spec,
            &files,
            &output_for_task,
            &prompt,
            Some(negative_for_task.as_str()),
            width,
            height,
            steps,
            seed,
            cfg_scale,
            flow_shift,
            strength,
            init_for_task.as_deref(),
            mask_for_task.as_deref(),
            offload,
            vae_tiling,
        )
    })
    .await;
    end_task();
    cleanup(&cleanup_paths);

    match result {
        Ok(Ok(())) => {
            let path = output.to_string_lossy().into_owned();
            emit(&app, "done", Some("生成完成".into()), 1.0, 0.0, None, None);
            Ok(ImageGenResult {
                path,
                width,
                height,
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
            let message = format!("图像生成任务异常：{error}");
            emit(&app, "error", Some(message.clone()), 0.0, 0.0, None, None);
            Err(message)
        }
    }
}

#[tauri::command]
pub fn image_gen_cancel() {
    runtime().cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = runtime().child.lock() {
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
        }
    }
}

/// 当前是否有图像生成任务（界面挂载时纠正状态用）。
#[tauri::command]
pub fn image_gen_busy() -> bool {
    runtime().running.load(Ordering::SeqCst)
}

/// 是否有图像任务在跑（视频生成用它避免两边同时抢显存）。
pub fn is_running() -> bool {
    runtime().running.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(model: &str) -> ModelFiles {
        ModelFiles {
            model: Some(PathBuf::from(model)),
            dit: Some(PathBuf::from("dit.gguf")),
            vae: Some(PathBuf::from("ae.safetensors")),
            te: Some(PathBuf::from("te.gguf")),
            te_aux: Some(PathBuf::from("clip_l.safetensors")),
            te_vision: Some(PathBuf::from("mmproj.gguf")),
        }
    }

    fn args_for(
        family: models::ModelFamily,
        init: Option<&Path>,
        mask: Option<&Path>,
    ) -> Vec<String> {
        let spec = ImageSpec::for_family(family).expect("图像家族都要有规格");
        command_args(
            spec,
            &files("model.safetensors"),
            Path::new("out.png"),
            "a cat",
            Some("blurry"),
            1024,
            1024,
            spec.steps,
            7,
            spec.cfg,
            spec.flow_shift,
            0.6,
            init,
            mask,
            true,
            true,
        )
    }

    fn has(args: &[String], flag: &str) -> bool {
        args.iter().any(|arg| arg == flag)
    }

    fn value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|index| args.get(index + 1))
            .map(String::as_str)
    }

    #[test]
    fn every_image_family_has_a_spec() {
        for family in [
            models::ModelFamily::Sd15,
            models::ModelFamily::Sdxl,
            models::ModelFamily::ZImageTurbo,
            models::ModelFamily::Flux1Schnell,
            models::ModelFamily::Flux1Kontext,
            models::ModelFamily::QwenImage,
            models::ModelFamily::QwenImageEdit,
        ] {
            let spec = ImageSpec::for_family(family).expect("图像家族都要有规格");
            assert!(spec.steps > 0);
            assert!(spec.multiple >= 16);
            assert!(
                spec.layout == WeightLayout::Single
                    || spec
                        .roles
                        .iter()
                        .any(|role| role.role == "dit" && role.required),
                "{family:?} 缺少 DiT"
            );
            assert!(
                spec.layout == WeightLayout::Single
                    || spec
                        .roles
                        .iter()
                        .any(|role| role.role == "vae" && role.required),
                "{family:?} 缺少 VAE"
            );
        }
        assert!(ImageSpec::for_family(models::ModelFamily::Whisper).is_none());
    }

    #[test]
    fn single_file_models_use_m_and_no_encoders() {
        let args = args_for(models::ModelFamily::Sd15, None, None);
        assert_eq!(args[0], "-M");
        assert_eq!(args[1], "img_gen");
        assert_eq!(value(&args, "-m"), Some("model.safetensors"));
        assert!(!has(&args, "--diffusion-model"));
        assert!(!has(&args, "--vae"));
        assert!(!has(&args, "--llm"));
        assert!(has(&args, "--offload-to-cpu"));
        assert!(has(&args, "--mmap"));
        assert!(has(&args, "--vae-tiling"));
    }

    #[test]
    fn split_models_pick_the_right_encoder_flags() {
        let flux = args_for(models::ModelFamily::Flux1Schnell, None, None);
        assert!(has(&flux, "--diffusion-model"));
        assert!(has(&flux, "--vae"));
        assert_eq!(value(&flux, "--clip_l"), Some("clip_l.safetensors"));
        assert_eq!(value(&flux, "--t5xxl"), Some("te.gguf"));
        assert!(!has(&flux, "--llm"));
        assert_eq!(value(&flux, "--steps"), Some("4"));
        assert_eq!(value(&flux, "--cfg-scale"), Some("1.00"));

        let qwen = args_for(models::ModelFamily::QwenImage, None, None);
        assert_eq!(value(&qwen, "--llm"), Some("te.gguf"));
        assert!(!has(&qwen, "--t5xxl"));
        assert_eq!(value(&qwen, "--flow-shift"), Some("3.00"));

        let edit = args_for(models::ModelFamily::QwenImageEdit, None, None);
        assert_eq!(value(&edit, "--llm"), Some("te.gguf"));
        assert_eq!(value(&edit, "--llm_vision"), Some("mmproj.gguf"));
    }

    #[test]
    fn image_to_image_passes_init_mask_and_strength() {
        let args = args_for(
            models::ModelFamily::Sd15,
            Some(Path::new("init.png")),
            Some(Path::new("mask.png")),
        );
        assert_eq!(value(&args, "--init-img"), Some("init.png"));
        assert_eq!(value(&args, "--mask"), Some("mask.png"));
        assert_eq!(value(&args, "--strength"), Some("0.60"));
        // 单文件模型没有参考图入口。
        assert!(!has(&args, "-r"));
    }

    #[test]
    fn whole_image_edit_has_init_without_mask() {
        let args = args_for(models::ModelFamily::Sdxl, Some(Path::new("init.png")), None);
        assert_eq!(value(&args, "--init-img"), Some("init.png"));
        assert!(!has(&args, "--mask"));
        assert!(has(&args, "--strength"));
    }

    #[test]
    fn ref_edit_models_only_add_init_when_a_mask_is_painted() {
        let plain = args_for(
            models::ModelFamily::Flux1Kontext,
            Some(Path::new("init.png")),
            None,
        );
        assert_eq!(value(&plain, "-r"), Some("init.png"));
        assert!(!has(&plain, "--init-img"));
        assert!(!has(&plain, "--mask"));

        let masked = args_for(
            models::ModelFamily::QwenImageEdit,
            Some(Path::new("init.png")),
            Some(Path::new("mask.png")),
        );
        assert_eq!(value(&masked, "-r"), Some("init.png"));
        assert_eq!(value(&masked, "--init-img"), Some("init.png"));
        assert_eq!(value(&masked, "--mask"), Some("mask.png"));
        assert!(has(&masked, "--strength"));
    }

    #[test]
    fn sd15_inpainting_is_edit_only() {
        let sd = ImageSpec::for_family(models::ModelFamily::Sd15).unwrap();
        assert!(!sd.draw, "SD 1.5 重绘没有文生图能力");
        assert!(ImageSpec::for_family(models::ModelFamily::Sdxl).unwrap().draw);
        assert!(!ImageSpec::for_family(models::ModelFamily::Flux1Kontext).unwrap().draw);
        assert!(!ImageSpec::for_family(models::ModelFamily::QwenImageEdit).unwrap().draw);
    }

    #[test]
    fn metal_turns_batched_cfg_off() {
        assert_eq!(metal_guard_args("metal"), &["--batched-cfg", "off"]);
        assert!(metal_guard_args("cuda12").is_empty());
        assert!(metal_guard_args("vulkan").is_empty());
        assert!(metal_guard_args("cpu").is_empty());
    }

    #[test]
    fn z_image_metal_disables_the_tensor_api() {
        assert_eq!(
            metal_env("metal", models::ModelFamily::ZImageTurbo),
            Some(("GGML_METAL_TENSOR_DISABLE", "1"))
        );
        assert_eq!(metal_env("metal", models::ModelFamily::Sd15), None);
        assert_eq!(metal_env("cpu", models::ModelFamily::ZImageTurbo), None);
        assert_eq!(metal_env("cuda12", models::ModelFamily::ZImageTurbo), None);
    }

    #[test]
    fn dimensions_are_aligned_per_family() {
        let sd = ImageSpec::for_family(models::ModelFamily::Sd15).unwrap();
        assert_eq!(sd.align(513), 576);
        assert_eq!(sd.align(1024), 1024);
        let flux = ImageSpec::for_family(models::ModelFamily::Flux1Schnell).unwrap();
        assert_eq!(flux.align(513), 528);
        let qwen = ImageSpec::for_family(models::ModelFamily::QwenImage).unwrap();
        assert_eq!(qwen.align(1000), 1024);
    }

    #[test]
    fn parses_step_lines() {
        assert_eq!(parse_step("step 3/20", 20), Some((3, 20)));
        assert_eq!(parse_step("[INFO ] 12/20 - 1.2s", 20), Some((12, 20)));
        assert_eq!(parse_step("saved 2/20 images", 20), None);
        assert_eq!(parse_step("step 3/20", 8), None);
    }

    #[test]
    fn roles_pick_the_right_weights_and_do_not_reuse_files() {
        struct Case {
            family: models::ModelFamily,
            names: &'static [&'static str],
            model: Option<&'static str>,
            dit: Option<&'static str>,
            vae: Option<&'static str>,
            te: Option<&'static str>,
            te_aux: Option<&'static str>,
            te_vision: Option<&'static str>,
        }
        let cases = [
            Case {
                family: models::ModelFamily::Sd15,
                names: &["sd-v1-5-inpainting.ckpt"],
                model: Some("sd-v1-5-inpainting.ckpt"),
                dit: None,
                vae: None,
                te: None,
                te_aux: None,
                te_vision: None,
            },
            Case {
                family: models::ModelFamily::Sdxl,
                names: &["sd_xl_base_1.0.safetensors"],
                model: Some("sd_xl_base_1.0.safetensors"),
                dit: None,
                vae: None,
                te: None,
                te_aux: None,
                te_vision: None,
            },
            Case {
                family: models::ModelFamily::ZImageTurbo,
                names: &[
                    "z_image_turbo-Q4_K.gguf",
                    "ae.safetensors",
                    "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
                ],
                model: None,
                dit: Some("z_image_turbo-Q4_K.gguf"),
                vae: Some("ae.safetensors"),
                te: Some("Qwen3-4B-Instruct-2507-Q4_K_M.gguf"),
                te_aux: None,
                te_vision: None,
            },
            Case {
                family: models::ModelFamily::Flux1Schnell,
                names: &[
                    "flux1-schnell-q4_k.gguf",
                    "ae.safetensors",
                    "clip_l.safetensors",
                    "t5xxl_fp8_e4m3fn.safetensors",
                ],
                model: None,
                dit: Some("flux1-schnell-q4_k.gguf"),
                vae: Some("ae.safetensors"),
                te: Some("t5xxl_fp8_e4m3fn.safetensors"),
                te_aux: Some("clip_l.safetensors"),
                te_vision: None,
            },
            Case {
                family: models::ModelFamily::QwenImageEdit,
                names: &[
                    "Qwen-Image-Edit-2509-Q4_K_M.gguf",
                    "Qwen_Image-VAE.safetensors",
                    "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                    "mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
                ],
                model: None,
                dit: Some("Qwen-Image-Edit-2509-Q4_K_M.gguf"),
                vae: Some("Qwen_Image-VAE.safetensors"),
                te: Some("Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"),
                te_aux: None,
                te_vision: Some("mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf"),
            },
        ];
        let name_of = |path: &Option<PathBuf>| {
            path.as_ref()
                .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        };
        for (index, case) in cases.iter().enumerate() {
            let dir = std::env::temp_dir()
                .join(format!("aicut-image-roles-{}-{index}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            for name in case.names {
                std::fs::write(dir.join(name), b"").unwrap();
            }
            let spec = ImageSpec::for_family(case.family).expect("图像家族都要有规格");
            let files = spec.resolve(&dir).expect("解析权重文件");
            assert_eq!(name_of(&files.model).as_deref(), case.model);
            assert_eq!(name_of(&files.dit).as_deref(), case.dit);
            assert_eq!(name_of(&files.vae).as_deref(), case.vae);
            assert_eq!(name_of(&files.te).as_deref(), case.te);
            assert_eq!(name_of(&files.te_aux).as_deref(), case.te_aux);
            assert_eq!(name_of(&files.te_vision).as_deref(), case.te_vision);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
