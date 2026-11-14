//! 无模型视频处理：防抖、降噪、去频闪、运动模糊、快速放大。
//!
//! 所有处理项合并成一条 `-vf` 滤镜链，一次 ffmpeg 调用完成，避免反复转码掉画质。
//! 输出写进缓存目录，由前端作为新素材替换原片段（预览与导出立即一致）。
//!
//! **无头可用**：ffmpeg 走 `Host::run_stream`（流式 stdout 拿 `-progress`），取消走
//! `CancellationToken`——桌面壳不再需要 `tauri_plugin_shell` 的子进程句柄。

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::host::{Host, RunOptions};
use crate::media;

/// 视频处理进度事件名。
pub const EVENT_VIDEO_DSP: &str = "video-dsp-progress";

/// 处理强度。
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Strength {
    Light,
    Medium,
    Strong,
}

/// 前端提交的处理项；未出现的字段表示关闭。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDspOptions {
    pub stabilize: Option<Strength>,
    pub denoise: Option<Strength>,
    pub deflicker: Option<Strength>,
    /// 0..1；0 表示关闭。
    pub motion_blur: Option<f32>,
    /// 1.0 表示关闭；1.5 / 2.0 为放大倍数。
    pub upscale: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoDspProgress {
    /// `processing` / `done` / `error`。
    pub state: String,
    pub progress: f32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoProcessed {
    pub path: String,
    pub duration: f64,
}

/// 同一时间只允许一个视频处理任务。
#[derive(Default)]
pub struct VideoDspState {
    running: AtomicBool,
    cancel: Mutex<Option<CancellationToken>>,
}

impl VideoDspState {
    fn begin(&self) -> Result<CancellationToken, String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("已有视频处理任务正在运行".into());
        }
        let token = CancellationToken::new();
        if let Ok(mut guard) = self.cancel.lock() {
            *guard = Some(token.clone());
        }
        Ok(token)
    }

    fn end(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.cancel.lock() {
            let _ = guard.take();
        }
    }

    /// 取消当前任务（无头端由 RPC 打进来；桌面端由按钮打进来）。
    pub fn cancel(&self) -> Result<(), String> {
        let token = self
            .cancel
            .lock()
            .map_err(|_| "视频处理状态锁失败".to_string())?
            .clone();
        match token {
            Some(token) => {
                token.cancel();
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// 是否在跑（界面用来纠正卡住的状态）。
    pub fn busy(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

fn emit(host: &dyn Host, state: &str, progress: f32, message: Option<String>) {
    let payload = VideoDspProgress {
        state: state.to_string(),
        progress: progress.clamp(0.0, 1.0),
        message,
    };
    match serde_json::to_value(payload) {
        Ok(value) => host.emit(EVENT_VIDEO_DSP, value),
        Err(error) => eprintln!("[video-dsp] 进度事件序列化失败：{error}"),
    }
}

/// 去掉浮点数尾部多余的 0，生成稳定的滤镜参数。
fn num(value: f64) -> String {
    let mut text = format!("{value:.3}");
    while text.contains('.') && text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    if text.is_empty() {
        "0".into()
    } else {
        text
    }
}

fn deshake(strength: Strength) -> &'static str {
    match strength {
        Strength::Light => "deshake=rx=16:ry=16:edge=mirror:blocksize=8:contrast=125:search=less",
        Strength::Medium => {
            "deshake=rx=32:ry=32:edge=mirror:blocksize=8:contrast=125:search=exhaustive"
        }
        Strength::Strong => {
            "deshake=rx=48:ry=48:edge=mirror:blocksize=16:contrast=110:search=exhaustive"
        }
    }
}

fn deflicker(strength: Strength) -> &'static str {
    match strength {
        Strength::Light => "deflicker=mode=pm:size=5",
        Strength::Medium => "deflicker=mode=pm:size=9",
        Strength::Strong => "deflicker=mode=pm:size=15",
    }
}

fn denoise(strength: Strength) -> &'static str {
    match strength {
        Strength::Light => "hqdn3d=2:1.5:3:2.25",
        Strength::Medium => "hqdn3d=4:3:6:4.5",
        Strength::Strong => "hqdn3d=8:6:12:9",
    }
}

/// 把处理项编译成 ffmpeg 滤镜链。
///
/// 顺序固定：防抖 → 去频闪 → 降噪 → 运动模糊 → 放大。
/// 时域处理放在放大之前，避免在更大的画面上做多帧计算。
fn build_filter_chain(options: &VideoDspOptions, fps: f64) -> Result<String, String> {
    let mut filters: Vec<String> = vec!["setpts=PTS-STARTPTS".into()];
    let mut any = false;
    let mut upscaled = false;

    if let Some(strength) = options.stabilize {
        any = true;
        filters.push(deshake(strength).into());
    }
    if let Some(strength) = options.deflicker {
        any = true;
        filters.push(deflicker(strength).into());
    }
    if let Some(strength) = options.denoise {
        any = true;
        filters.push(denoise(strength).into());
    }

    if let Some(amount) = options.motion_blur {
        let amount = amount.clamp(0.0, 1.0);
        if amount > 0.01 {
            any = true;
            let factor = if amount < 0.34 {
                2
            } else if amount < 0.67 {
                3
            } else {
                4
            };
            let source_fps = if fps.is_finite() && fps > 0.0 {
                fps.clamp(1.0, 240.0)
            } else {
                30.0
            };
            let output_fps = (source_fps * factor as f64).round();
            let weights = match factor {
                2 => "1 1",
                3 => "1 2 1",
                _ => "1 2 2 1",
            };
            filters.push(format!(
                "minterpolate=fps={}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
                num(output_fps)
            ));
            filters.push(format!("tmix=frames={factor}:weights='{weights}'"));
            filters.push(format!("fps={}", num(source_fps)));
        }
    }

    if let Some(scale) = options.upscale {
        let factor = scale.clamp(1.0, 4.0);
        if factor > 1.01 {
            any = true;
            upscaled = true;
            filters.push(format!(
                "scale=trunc(iw*{0}/2)*2:trunc(ih*{0}/2)*2:flags=lanczos",
                num(factor as f64)
            ));
            filters.push("cas=strength=0.4".into());
        }
    }

    if !any {
        return Err("至少选择一个视频处理项".into());
    }
    // H.264 + yuv420p 要求偶数宽高；奇数源在这里统一收一次边。
    if !upscaled {
        filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
    }
    filters.push("format=yuv420p".into());
    Ok(filters.join(","))
}

fn parse_progress_line(line: &str) -> Option<f64> {
    if let Some(v) = line.strip_prefix("out_time_us=") {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    // ffmpeg 的 out_time_ms 实际单位是微秒。
    if let Some(v) = line.strip_prefix("out_time_ms=") {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(v) = line.strip_prefix("out_time=") {
        let mut parts = v.trim().split(':');
        let h: f64 = parts.next()?.parse().ok()?;
        let m: f64 = parts.next()?.parse().ok()?;
        let s: f64 = parts.next()?.parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    None
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn output_path(host: &dyn Host) -> Result<PathBuf, String> {
    let dir = PathBuf::from(media::media_cache_dir(host)?);
    Ok(dir.join(format!("video-dsp-{}-{}.mp4", std::process::id(), stamp())))
}

async fn run_process(
    host: &dyn Host,
    cancel: CancellationToken,
    path: &str,
    start: f64,
    duration: f64,
    chain: &str,
) -> Result<VideoProcessed, String> {
    let output = output_path(host)?;
    let output_text = output.to_string_lossy().into_owned();

    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-y".into(),
        "-ss".into(),
        format!("{:.6}", start.max(0.0)),
        "-i".into(),
        path.to_string(),
        "-t".into(),
        format!("{duration:.6}"),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-vf".into(),
        chain.to_string(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "18".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "48000".into(),
        "-movflags".into(),
        "+faststart".into(),
        output_text.clone(),
    ];

    let total = duration.max(0.001);
    let buffer = Arc::new(Mutex::new(String::new()));
    let tail = Arc::new(Mutex::new(VecDeque::<String>::with_capacity(20)));
    let progress = {
        let buffer = Arc::clone(&buffer);
        let tail = Arc::clone(&tail);
        Box::new(move |bytes: &[u8]| {
            let mut guard = match buffer.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            guard.push_str(&String::from_utf8_lossy(bytes));
            while let Some(pos) = guard.find('\n') {
                let line = guard[..pos].trim().to_string();
                let rest = guard[pos + 1..].to_string();
                *guard = rest;
                if line == "progress=end" {
                    emit(host, "processing", 1.0, None);
                } else if let Some(seconds) = parse_progress_line(&line) {
                    emit(
                        host,
                        "processing",
                        (seconds / total).clamp(0.0, 1.0) as f32,
                        None,
                    );
                } else if line.starts_with("error=") || line.contains("Error") {
                    if let Ok(mut tail) = tail.lock() {
                        if tail.len() >= 20 {
                            tail.pop_front();
                        }
                        tail.push_back(line);
                    }
                }
            }
        }) as Box<dyn Fn(&[u8]) + Send + '_>
    };

    let outcome = host
        .run_stream(
            "ffmpeg",
            &args,
            RunOptions::default(),
            progress,
            cancel.clone(),
        )
        .await;

    if cancel.is_cancelled() {
        let _ = std::fs::remove_file(&output);
        return Err("已取消".into());
    }

    let out = match outcome {
        Ok(out) => out,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            return Err(error);
        }
    };

    if out.code != Some(0) {
        let _ = std::fs::remove_file(&output);
        let mut lines: Vec<String> = tail
            .lock()
            .map(|guard| guard.iter().cloned().collect())
            .unwrap_or_default();
        if lines.is_empty() {
            lines = out
                .stderr
                .lines()
                .rev()
                .take(20)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect();
        }
        return Err(if lines.is_empty() {
            format!(
                "ffmpeg 退出码：{}",
                out.code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "未知".into())
            )
        } else {
            lines.join("\n")
        });
    }

    if !output.is_file() {
        return Err("视频处理没有产出文件".into());
    }

    let meta = match media::probe_media(host, output_text.clone()).await {
        Ok(meta) => meta,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            return Err(error);
        }
    };
    let duration = if meta.duration > 0.0 {
        meta.duration
    } else {
        duration
    };

    Ok(VideoProcessed {
        path: output_text,
        duration,
    })
}

/// 无模型视频处理：把多项 ffmpeg 滤镜合并成一次转码。
pub async fn video_dsp_process(
    host: &dyn Host,
    state: &VideoDspState,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    options: VideoDspOptions,
) -> Result<VideoProcessed, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    let chain = build_filter_chain(&options, fps)?;
    let cancel = state.begin()?;
    emit(host, "processing", 0.0, None);
    let result = run_process(host, cancel, &path, start, duration, &chain).await;
    state.end();
    match &result {
        Ok(_) => emit(host, "done", 1.0, None),
        Err(error) => {
            if error == "已取消" {
                emit(host, "cancelled", 0.0, None);
            } else {
                emit(host, "error", 0.0, Some(error.clone()));
            }
        }
    }
    result
}

/// 取消当前视频处理任务。
pub fn video_dsp_cancel(state: &VideoDspState) -> Result<(), String> {
    state.cancel()
}

/// 是否有视频处理任务在跑。
pub fn video_dsp_busy(state: &VideoDspState) -> bool {
    state.busy()
}
