//! 无模型视频处理：防抖、降噪、去频闪、运动模糊、快速放大。
//!
//! 所有处理项合并成一条 `-vf` 滤镜链，一次 ffmpeg 调用完成，避免反复转码掉画质。
//! 输出写进缓存目录，由前端作为新素材替换原片段（预览与导出立即一致）。

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::media::{cache_dir, probe_media};

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
    cancelled: AtomicBool,
    child: Mutex<Option<CommandChild>>,
}

impl Drop for VideoDspState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

fn emit(app: &AppHandle, state: &str, progress: f32, message: Option<String>) {
    let _ = app.emit(
        EVENT_VIDEO_DSP,
        VideoDspProgress {
            state: state.to_string(),
            progress: progress.clamp(0.0, 1.0),
            message,
        },
    );
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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn output_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_dir(app)?.join(format!("video-dsp-{}-{}.mp4", std::process::id(), stamp())))
}

async fn run_process(
    app: &AppHandle,
    state: &VideoDspState,
    path: &str,
    start: f64,
    duration: f64,
    chain: &str,
) -> Result<VideoProcessed, String> {
    let output = output_path(app)?;
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

    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg 不可用：{e}"))?;
    let (mut rx, child) = command
        .args(args)
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败：{e}"))?;

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "视频处理状态锁失败".to_string())?;
        *guard = Some(child);
    }

    let total = duration.max(0.001);
    let mut stdout_buf = String::new();
    let mut stderr_tail: VecDeque<String> = VecDeque::new();
    let mut exit_code: Option<Option<i32>> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(pos) = stdout_buf.find('\n') {
                    let line = stdout_buf[..pos].trim().to_string();
                    stdout_buf = stdout_buf[pos + 1..].to_string();
                    if line == "progress=end" {
                        emit(app, "processing", 1.0, None);
                    } else if let Some(seconds) = parse_progress_line(&line) {
                        emit(
                            app,
                            "processing",
                            (seconds / total).clamp(0.0, 1.0) as f32,
                            None,
                        );
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                for line in String::from_utf8_lossy(&bytes).lines() {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if stderr_tail.len() >= 20 {
                        stderr_tail.pop_front();
                    }
                    stderr_tail.push_back(line);
                }
            }
            CommandEvent::Error(error) => {
                if stderr_tail.len() >= 20 {
                    stderr_tail.pop_front();
                }
                stderr_tail.push_back(error);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = Some(payload.code);
                break;
            }
            _ => {}
        }
    }

    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }

    if state.cancelled.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&output);
        return Err("已取消".into());
    }

    match exit_code {
        Some(Some(0)) => {}
        Some(code) => {
            let _ = std::fs::remove_file(&output);
            let tail = stderr_tail.into_iter().collect::<Vec<_>>().join("\n");
            return Err(if tail.is_empty() {
                format!(
                    "ffmpeg 退出码：{}",
                    code.map(|c| c.to_string()).unwrap_or_else(|| "未知".into())
                )
            } else {
                tail
            });
        }
        None => {
            let _ = std::fs::remove_file(&output);
            return Err("ffmpeg 未正常结束".into());
        }
    }

    if !output.is_file() {
        return Err("视频处理没有产出文件".into());
    }

    let meta = match probe_media(app.clone(), output_text.clone()).await {
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
#[tauri::command]
pub async fn video_dsp_process(
    app: AppHandle,
    state: State<'_, VideoDspState>,
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

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("已有视频处理任务正在运行".into());
    }
    state.cancelled.store(false, Ordering::Relaxed);
    emit(&app, "processing", 0.0, Some("正在处理视频".into()));

    let result = run_process(&app, state.inner(), &path, start, duration, &chain).await;

    state.running.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }

    match &result {
        Ok(_) => emit(&app, "done", 1.0, Some("视频处理完成".into())),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

/// 取消当前视频处理任务。
#[tauri::command]
pub fn video_dsp_cancel(state: State<'_, VideoDspState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::SeqCst);
    let child = {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "视频处理状态锁失败".to_string())?;
        guard.take()
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> VideoDspOptions {
        VideoDspOptions::default()
    }

    #[test]
    fn rejects_empty_options() {
        assert!(build_filter_chain(&options(), 30.0).is_err());
    }

    #[test]
    fn stabilization_uses_deshake() {
        let mut opts = options();
        opts.stabilize = Some(Strength::Medium);
        let chain = build_filter_chain(&opts, 30.0).expect("应生成滤镜链");
        assert!(chain.contains("deshake="), "{chain}");
        assert!(chain.ends_with("format=yuv420p"), "{chain}");
    }

    #[test]
    fn denoise_and_deflicker_are_included() {
        let mut opts = options();
        opts.denoise = Some(Strength::Strong);
        opts.deflicker = Some(Strength::Light);
        let chain = build_filter_chain(&opts, 30.0).expect("应生成滤镜链");
        assert!(chain.contains("hqdn3d=8:6:12:9"), "{chain}");
        assert!(chain.contains("deflicker=mode=pm:size=5"), "{chain}");
        assert!(
            chain.contains("scale=trunc(iw/2)*2:trunc(ih/2)*2"),
            "{chain}"
        );
    }

    #[test]
    fn motion_blur_interpolates_and_blends() {
        let mut opts = options();
        opts.motion_blur = Some(0.7);
        let chain = build_filter_chain(&opts, 30.0).expect("应生成滤镜链");
        assert!(chain.contains("minterpolate=fps=120"), "{chain}");
        assert!(chain.contains("tmix=frames=4"), "{chain}");
        assert!(chain.contains("fps=30"), "{chain}");
    }

    #[test]
    fn invalid_fps_falls_back_to_30() {
        let mut opts = options();
        opts.motion_blur = Some(0.2);
        let chain = build_filter_chain(&opts, f64::NAN).expect("应生成滤镜链");
        assert!(chain.contains("minterpolate=fps=60"), "{chain}");
        assert!(chain.contains("fps=30"), "{chain}");
    }

    #[test]
    fn upscale_scales_and_sharpens() {
        let mut opts = options();
        opts.upscale = Some(2.0);
        let chain = build_filter_chain(&opts, 30.0).expect("应生成滤镜链");
        assert!(chain.contains("scale=trunc(iw*2/2)*2"), "{chain}");
        assert!(chain.contains("cas=strength=0.4"), "{chain}");
    }

    #[test]
    fn filters_follow_fixed_order() {
        let mut opts = options();
        opts.stabilize = Some(Strength::Light);
        opts.deflicker = Some(Strength::Light);
        opts.denoise = Some(Strength::Light);
        opts.motion_blur = Some(0.2);
        opts.upscale = Some(1.5);
        let chain = build_filter_chain(&opts, 24.0).expect("应生成滤镜链");
        let positions = ["deshake", "deflicker", "hqdn3d", "minterpolate", "scale="];
        let mut last = 0;
        for needle in positions {
            let at = chain.find(needle).expect(needle);
            assert!(at >= last, "{needle} 的顺序不对：{chain}");
            last = at;
        }
    }

    #[test]
    fn parses_progress_lines() {
        assert_eq!(parse_progress_line("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_line("out_time_ms=2500000"), Some(2.5));
        assert_eq!(parse_progress_line("out_time=00:00:01.500000"), Some(1.5));
        assert_eq!(parse_progress_line("frame=10"), None);
    }

    #[test]
    fn numbers_are_compact() {
        assert_eq!(num(2.0), "2");
        assert_eq!(num(1.5), "1.5");
        assert_eq!(num(1.25), "1.25");
    }
}
