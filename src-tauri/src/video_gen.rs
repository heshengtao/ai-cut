//! **MiniMax-H3 视频生成**：把 stable-diffusion.cpp 的 `sd-cli` 当成外部进程来跑。
//!
//! sd.cpp 没有稳定的进程内 C ABI（每次 release 都可能改），而 `sd-cli` 的参数是它公开
//! 的稳定接口。这里只依赖命令行：拼参数 → 起子进程 → 读 stderr 的 step 进度 → 产出
//! `.webm`（视频 + 立体声音频）。取消就是 kill 子进程，不会污染宿主进程。
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

/// MiniMax-H3 固定 24 fps。
pub const FPS: u32 = 24;
/// 单段生成上限：360 帧 = 15 秒（H3 训练范围之外不保证质量，但 sd.cpp 接受）。
pub const MAX_FRAMES: u32 = 360;

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

/// H3 的帧数网格：`17k + 5`，最小 5。向上取整。
pub fn align_frames(frames: u32) -> u32 {
    let frames = frames.max(5);
    let remainder = (frames - 5) % 17;
    if remainder == 0 {
        frames
    } else {
        frames + 17 - remainder
    }
}

/// 秒数 → 网格帧数。10 秒会得到 243（10.125s），不是 240。
pub fn frames_for_seconds(seconds: f64) -> u32 {
    let raw = (seconds.max(0.0) * FPS as f64).round() as u32;
    align_frames(raw.max(5)).min(MAX_FRAMES)
}

/// 宽高对齐到 32 的倍数（H3 的硬约束）。
pub fn align_dimension(value: u32) -> u32 {
    value.div_ceil(32) * 32
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
        let Ok(step) = left.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u32>() else {
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

fn tail_text(lines: &VecDeque<String>) -> String {    let start = lines.len().saturating_sub(8);
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
    dit: &Path,
    te: &Path,
    video_vae: &Path,
    audio_vae: &Path,
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
) -> Result<(), String> {
    let mut command = Command::new(cli);
    command
        .arg("-M")
        .arg("vid_gen")
        .arg("--diffusion-model")
        .arg(dit)
        .arg("--vae")
        .arg(video_vae)
        .arg("--audio-vae")
        .arg(audio_vae)
        .arg("--llm")
        .arg(te)
        .arg("-p")
        .arg(prompt)
        .arg("--cfg-scale")
        .arg(format!("{cfg_scale:.2}"))
        .arg("-W")
        .arg(width.to_string())
        .arg("-H")
        .arg(height.to_string())
        .arg("--fps")
        .arg(FPS.to_string())
        .arg("--video-frames")
        .arg(frames.to_string())
        .arg("--steps")
        .arg(steps.to_string())
        .arg("-s")
        .arg(seed.to_string())
        .arg("--flow-shift")
        .arg(format!("{flow_shift:.2}"))
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
        command.arg("--vae-tiling").arg("--temporal-tiling");
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
            let size = std::fs::metadata(output).map(|meta| meta.len()).unwrap_or(0);
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
            status.code().map(|code| code.to_string()).unwrap_or_default(),
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
    let entry = models::by_id(&request.model_id)
        .ok_or_else(|| format!("未知模型：{}", request.model_id))?;
    if entry.feature != "video-gen" {
        return Err(format!("{} 不是视频生成模型", entry.name));
    }
    let model_dir = models::require_dir(&app, entry)?;
    let dit = find_model_file(&model_dir, "fl2va")
        .or_else(|| find_model_file(&model_dir, "diffusion"))
        .ok_or_else(|| format!("{} 里没有 DiT 权重", entry.name))?;
    let te = find_model_file(&model_dir, "qwen3vl")
        .ok_or_else(|| format!("{} 里没有文本编码器", entry.name))?;
    let video_vae = find_model_file(&model_dir, "video_vae")
        .ok_or_else(|| format!("{} 里没有视频 VAE", entry.name))?;
    let audio_vae = find_model_file(&model_dir, "audio_vae")
        .ok_or_else(|| format!("{} 里没有音频 VAE", entry.name))?;

    let pack = sdcpp::effective_pack(&app).ok_or_else(|| "没有可用的 sd.cpp 引擎".to_string())?;
    let cli = sdcpp::cli_path(&app, pack).ok_or_else(|| {
        format!(
            "sd.cpp 引擎还没下载（{}）",
            sdcpp::effective_device(&app)
        )
    })?;

    let frames = align_frames(
        request
            .frames
            .unwrap_or_else(|| frames_for_seconds(request.seconds.unwrap_or(5.0)))
            .min(MAX_FRAMES),
    )
    .min(MAX_FRAMES);
    let width = align_dimension(request.width.clamp(256, 1920));
    let height = align_dimension(request.height.clamp(256, 1920));
    let steps = request.steps.clamp(1, 50);
    if frames < 5 {
        return Err("帧数必须至少为 5".into());
    }
    let output = media::cache_dir(&app)?.join(format!(
        "video-gen-{}-{}.webm",
        std::process::id(),
        stamp()
    ));

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
    let app_for_task = app.clone();
    let cli_for_task = cli.clone();
    let output_for_task = output.clone();
    let prompt = request.prompt.trim().to_string();
    let seed = request.seed;
    let cfg_scale = request.cfg_scale.clamp(0.0, 10.0);
    let flow_shift = request.flow_shift.clamp(0.0, 30.0);
    let offload = request.offload_to_cpu.unwrap_or(true);
    let vae_tiling = request.vae_tiling.unwrap_or(true);
    let result = tauri::async_runtime::spawn_blocking(move || {
        run(
            &app_for_task,
            &cli_for_task,
            &dit,
            &te,
            &video_vae,
            &audio_vae,
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
        )
    })
    .await;
    end_task();

    match result {
        Ok(Ok(())) => {
            let path = output.to_string_lossy().into_owned();
            let duration = frames as f64 / FPS as f64;
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
                emit(&app, "cancelled", Some("已取消".into()), 0.0, 0.0, None, None);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_grid_rounds_up() {
        assert_eq!(align_frames(5), 5);
        assert_eq!(align_frames(120), 124);
        assert_eq!(align_frames(124), 124);
        assert_eq!(align_frames(240), 243);
        assert_eq!(frames_for_seconds(10.0), 243);
        assert_eq!(frames_for_seconds(5.0), 124);
        assert_eq!(frames_for_seconds(0.0), 5);
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
