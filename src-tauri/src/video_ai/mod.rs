//! 视频 AI：Real-ESRGAN 超分、RIFE 补帧、YOLOX/YuNet 智能裁剪与镜头追踪。
//!
//! 处理链路是「ffmpeg 解码 → 逐帧 ONNX 推理 → ffmpeg 编码」，音轨直接从源文件
//! 复用到输出，避免一整段视频先进内存。输出落到缓存目录，由前端作为新素材替换片段。

pub mod detect;
pub mod esrgan;
pub mod frames;
pub mod rife;

use std::collections::VecDeque;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::backend;
use crate::media::{cache_dir, probe_media};
use crate::models;
use detect::Detection;
use frames::Frame;

pub const EVENT_VIDEO_AI: &str = "video-ai-progress";
const MAX_OUTPUT_SIDE: u32 = 8192;
const MAX_FPS: f64 = 240.0;

#[derive(Debug, Clone, Serialize)]
pub struct VideoAiProgress {
    pub state: String,
    pub progress: f32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoProcessed {
    pub path: String,
    pub duration: f64,
}

type Slot = Arc<Mutex<Option<Child>>>;

#[derive(Default)]
struct Runtime {
    running: AtomicBool,
    cancelled: AtomicBool,
    children: Mutex<Vec<Slot>>,
}

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(Runtime::default)
}

fn begin_task() -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有视频 AI 任务正在运行".into());
    }
    runtime().cancelled.store(false, Ordering::Relaxed);
    if let Ok(mut children) = runtime().children.lock() {
        children.clear();
    }
    Ok(())
}

fn end_task() {
    if let Ok(mut children) = runtime().children.lock() {
        for slot in children.drain(..) {
            if let Ok(mut guard) = slot.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
    runtime().running.store(false, Ordering::SeqCst);
}

fn cancelled() -> bool {
    runtime().cancelled.load(Ordering::Relaxed)
}

fn register(slot: Slot) {
    if let Ok(mut children) = runtime().children.lock() {
        children.push(slot);
    }
}

fn emit(app: &AppHandle, state: &str, progress: f32, message: Option<String>) {
    let _ = app.emit(
        EVENT_VIDEO_AI,
        VideoAiProgress {
            state: state.to_string(),
            progress: progress.clamp(0.0, 1.0),
            message,
        },
    );
}

pub(crate) fn build_session(path: &Path, label: &str) -> Result<ort::session::Session, String> {
    let builder =
        ort::session::Session::builder().map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?;
    backend::commit(
        backend::apply(builder),
        || ort::session::Session::builder().map_err(|e| format!("初始化 ONNX Runtime 失败：{e}")),
        path,
        label,
    )
}

fn sidecar_path(name: &str) -> PathBuf {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().unwrap_or_else(|| Path::new("."));
        if dir.ends_with("deps") {
            dir = dir.parent().unwrap_or(dir);
        }
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(file)
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn output_path(app: &AppHandle, tag: &str) -> Result<PathBuf, String> {
    Ok(cache_dir(app)?.join(format!(
        "video-ai-{tag}-{}-{}.mp4",
        std::process::id(),
        stamp()
    )))
}

fn compact_number(value: f64) -> String {
    let mut text = format!("{value:.6}");
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

fn fps_text(fps: f64) -> String {
    // 采样分析会用到 < 1 fps（例如每 2 秒一帧），不能在这里抬到 1。
    compact_number(fps.clamp(0.01, MAX_FPS))
}

fn estimated_frames(duration: f64, fps: f64) -> usize {
    ((duration.max(0.0) * fps.max(1.0)).ceil() as usize).max(1)
}

fn drain_stderr(stderr: Option<ChildStderr>) -> Arc<Mutex<VecDeque<String>>> {
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = stderr {
        let target = tail.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
            {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                if let Ok(mut guard) = target.lock() {
                    if guard.len() >= 20 {
                        guard.pop_front();
                    }
                    guard.push_back(line);
                }
            }
        });
    }
    tail
}

fn stderr_text(
    tail: &Arc<Mutex<VecDeque<String>>>,
    status: Option<std::process::ExitStatus>,
) -> String {
    let lines = tail
        .lock()
        .map(|guard| guard.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if lines.is_empty() {
        match status {
            Some(status) => format!(
                "退出码 {}",
                status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "未知".into())
            ),
            None => "进程没有正常结束".into(),
        }
    } else {
        lines.join("\n")
    }
}

struct SourceInfo {
    width: usize,
    height: usize,
    fps: f64,
    has_audio: bool,
    duration: f64,
}

async fn source_info(app: &AppHandle, path: &str) -> Result<SourceInfo, String> {
    let meta = probe_media(app.clone(), path.to_string()).await?;
    let width = meta.width.ok_or("无法读取视频宽度")?;
    let height = meta.height.ok_or("无法读取视频高度")?;
    let rotation = meta.rotation.unwrap_or(0).rem_euclid(360);
    let (width, height) = if rotation == 90 || rotation == 270 {
        (height, width)
    } else {
        (width, height)
    };
    Ok(SourceInfo {
        width: width as usize,
        height: height as usize,
        fps: meta
            .fps
            .filter(|fps| fps.is_finite() && *fps > 0.0)
            .unwrap_or(30.0),
        has_audio: meta.has_audio,
        duration: meta.duration,
    })
}

struct Decoder {
    slot: Slot,
    stdout: ChildStdout,
    stderr: Arc<Mutex<VecDeque<String>>>,
    width: usize,
    height: usize,
    buffer: Vec<u8>,
    finished: bool,
}

impl Decoder {
    fn spawn(
        path: &str,
        start: f64,
        duration: f64,
        fps: f64,
        width: usize,
        height: usize,
        scale: Option<(usize, usize)>,
    ) -> Result<Self, String> {
        let filter = match scale {
            Some((width, height)) => format!("fps={},scale={width}:{height}", fps_text(fps)),
            None => format!("fps={}", fps_text(fps)),
        };
        let args = vec![
            "-v".into(),
            "error".into(),
            "-nostdin".into(),
            "-ss".into(),
            compact_number(start.max(0.0)),
            "-i".into(),
            path.to_string(),
            "-t".into(),
            compact_number(duration),
            "-map".into(),
            "0:v:0".into(),
            "-an".into(),
            "-sn".into(),
            "-dn".into(),
            "-vf".into(),
            filter,
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgb24".into(),
            "-".into(),
        ];
        let mut command = Command::new(sidecar_path("ffmpeg"));
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| format!("启动视频解码失败：{e}"))?;
        let stdout = child.stdout.take().ok_or("无法读取视频解码输出")?;
        let stderr = drain_stderr(child.stderr.take());
        let slot: Slot = Arc::new(Mutex::new(Some(child)));
        register(slot.clone());
        Ok(Self {
            slot,
            stdout,
            stderr,
            width,
            height,
            buffer: vec![0; width * height * 3],
            finished: false,
        })
    }

    fn next(&mut self) -> Result<Option<Frame>, String> {
        if self.finished {
            return Ok(None);
        }
        match self.stdout.read_exact(&mut self.buffer) {
            Ok(()) => Ok(Some(Frame {
                width: self.width,
                height: self.height,
                rgb: self.buffer.clone(),
            })),
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                self.finished = true;
                Ok(None)
            }
            Err(error) => {
                self.finished = true;
                if cancelled() {
                    Err("已取消".into())
                } else {
                    Err(format!("读取视频帧失败：{error}"))
                }
            }
        }
    }

    fn finish(mut self) -> Result<(), String> {
        self.finished = true;
        drop(self.stdout);
        let child = self.slot.lock().ok().and_then(|mut guard| guard.take());
        let status = match child {
            Some(mut child) => child.wait().ok(),
            None => None,
        };
        if cancelled() {
            return Err("已取消".into());
        }
        match status {
            Some(status) if status.success() => Ok(()),
            status => Err(format!(
                "视频解码失败：{}",
                stderr_text(&self.stderr, status)
            )),
        }
    }
}

struct Encoder {
    slot: Slot,
    stdin: Option<ChildStdin>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    output: PathBuf,
}

impl Encoder {
    #[allow(clippy::too_many_arguments)]
    fn spawn(
        output: &Path,
        source: &str,
        start: f64,
        duration: f64,
        width: usize,
        height: usize,
        fps: f64,
        has_audio: bool,
    ) -> Result<Self, String> {
        let mut args = vec![
            "-v".into(),
            "error".into(),
            "-y".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgb24".into(),
            "-s".into(),
            format!("{width}x{height}"),
            "-r".into(),
            fps_text(fps),
            "-i".into(),
            "-".into(),
            "-ss".into(),
            compact_number(start.max(0.0)),
            "-t".into(),
            compact_number(duration),
            "-i".into(),
            source.to_string(),
            "-map".into(),
            "0:v:0".into(),
        ];
        if has_audio {
            args.push("-map".into());
            args.push("1:a:0?".into());
        }
        args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-shortest",
                "-movflags",
                "+faststart",
            ]
            .iter()
            .map(|value| value.to_string()),
        );
        args.push(output.to_string_lossy().into_owned());

        let mut command = Command::new(sidecar_path("ffmpeg"));
        command
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| format!("启动视频编码失败：{e}"))?;
        let stdin = child.stdin.take().ok_or("无法写入视频编码器")?;
        let stderr = drain_stderr(child.stderr.take());
        let slot: Slot = Arc::new(Mutex::new(Some(child)));
        register(slot.clone());
        Ok(Self {
            slot,
            stdin: Some(stdin),
            stderr,
            output: output.to_path_buf(),
        })
    }

    fn write(&mut self, frame: &Frame) -> Result<(), String> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err("视频编码器已关闭".into());
        };
        if let Err(error) = stdin.write_all(&frame.rgb) {
            if cancelled() {
                return Err("已取消".into());
            }
            return Err(format!(
                "写入视频编码器失败：{error}\n{}",
                stderr_text(&self.stderr, None)
            ));
        }
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        drop(self.stdin.take());
        let child = self.slot.lock().ok().and_then(|mut guard| guard.take());
        let status = match child {
            Some(mut child) => child.wait().ok(),
            None => None,
        };
        if cancelled() {
            let _ = std::fs::remove_file(&self.output);
            return Err("已取消".into());
        }
        match status {
            Some(status) if status.success() => Ok(()),
            status => {
                let _ = std::fs::remove_file(&self.output);
                Err(format!(
                    "视频编码失败：{}",
                    stderr_text(&self.stderr, status)
                ))
            }
        }
    }
}

fn resolve_model(app: &AppHandle, model_id: &str, feature: &str) -> Result<PathBuf, String> {
    let entry = models::by_id(model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != feature {
        return Err(format!("{} 不是{feature}模型", entry.name));
    }
    let filename = entry
        .files
        .first()
        .map(|file| file.filename)
        .ok_or_else(|| format!("{} 缺少权重文件", entry.name))?;
    Ok(models::require_dir(app, entry)?.join(filename))
}

fn optional_model(
    app: &AppHandle,
    model_id: Option<&str>,
    feature: &str,
) -> Result<Option<PathBuf>, String> {
    match model_id {
        Some(id) if !id.is_empty() => resolve_model(app, id, feature).map(Some),
        _ => Ok(None),
    }
}

fn validate_duration(duration: f64, source_duration: f64) -> Result<f64, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    let duration = if source_duration > 0.0 {
        duration.min(source_duration)
    } else {
        duration
    };
    if duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    Ok(duration)
}

#[tauri::command]
pub async fn video_ai_upscale(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    model_id: String,
    scale: u32,
) -> Result<VideoProcessed, String> {
    if scale != 2 && scale != 4 {
        return Err("超分倍数只支持 2 或 4".into());
    }
    let model_path = resolve_model(&app, &model_id, "superres")?;
    let info = source_info(&app, &path).await?;
    let duration = validate_duration(duration, info.duration)?;
    let source_fps = if fps.is_finite() && fps > 0.0 {
        fps.clamp(1.0, MAX_FPS)
    } else {
        info.fps
    };
    let out_width = frames::even((info.width as u32).saturating_mul(scale));
    let out_height = frames::even((info.height as u32).saturating_mul(scale));
    if out_width > MAX_OUTPUT_SIDE || out_height > MAX_OUTPUT_SIDE {
        return Err(format!("输出分辨率过大：{out_width}×{out_height}"));
    }

    let output = output_path(&app, "upscale")?;
    begin_task()?;
    let output_for_task = output.clone();
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut decoder = Decoder::spawn(
            &path,
            start,
            duration,
            source_fps,
            info.width,
            info.height,
            None,
        )?;
        let mut encoder = Encoder::spawn(
            &output_for_task,
            &path,
            start,
            duration,
            out_width as usize,
            out_height as usize,
            source_fps,
            info.has_audio,
        )?;
        let mut session = esrgan::load(&model_path)?;
        let total = estimated_frames(duration, source_fps);
        let mut index = 0usize;
        while let Some(frame) = decoder.next()? {
            if cancelled() {
                break;
            }
            let processed = esrgan::upscale_frame(&mut session, &frame, scale)?;
            encoder.write(&processed)?;
            index += 1;
            emit(
                &app_for_task,
                "processing",
                (index as f32 / total as f32).min(0.99),
                None,
            );
        }
        if index == 0 {
            return Err("源视频没有可用画面".into());
        }
        if cancelled() {
            return Err("已取消".into());
        }
        decoder.finish()?;
        encoder.finish()?;
        Ok(())
    })
    .await;

    end_task();
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            let message = format!("超分任务异常：{error}");
            emit(&app, "error", 0.0, Some(message.clone()));
            return Err(message);
        }
    };
    match result {
        Ok(()) => {
            let output_text = output.to_string_lossy().into_owned();
            let meta = probe_media(app.clone(), output_text.clone())
                .await
                .unwrap_or_default();
            emit(&app, "done", 1.0, Some("超分完成".into()));
            Ok(VideoProcessed {
                path: output_text,
                duration: if meta.duration > 0.0 {
                    meta.duration
                } else {
                    duration
                },
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            emit(&app, "error", 0.0, Some(error.clone()));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn video_ai_interpolate(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    model_id: String,
    factor: u32,
) -> Result<VideoProcessed, String> {
    if !(2..=4).contains(&factor) {
        return Err("补帧倍数只支持 2、3 或 4".into());
    }
    let model_path = resolve_model(&app, &model_id, "interpolate")?;
    let info = source_info(&app, &path).await?;
    let duration = validate_duration(duration, info.duration)?;
    let source_fps = if fps.is_finite() && fps > 0.0 {
        fps.clamp(1.0, MAX_FPS)
    } else {
        info.fps
    };
    let output_fps = source_fps * factor as f64;
    if output_fps > MAX_FPS {
        return Err(format!("补帧后帧率 {output_fps:.3} 超过 {MAX_FPS}"));
    }

    let output = output_path(&app, "interpolate")?;
    begin_task()?;
    let output_for_task = output.clone();
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut decoder = Decoder::spawn(
            &path,
            start,
            duration,
            source_fps,
            info.width,
            info.height,
            None,
        )?;
        let mut encoder = Encoder::spawn(
            &output_for_task,
            &path,
            start,
            duration,
            info.width,
            info.height,
            output_fps,
            info.has_audio,
        )?;
        let mut session = rife::load(&model_path)?;
        let total = estimated_frames(duration, source_fps);
        let mut index = 0usize;

        let Some(first) = decoder.next()? else {
            return Err("源视频没有可用画面".into());
        };
        encoder.write(&first)?;
        let mut previous_padded = frames::pad_to_multiple(&first, 32);
        let mut last = first;
        let steps = rife::timesteps(factor);

        while let Some(current) = decoder.next()? {
            if cancelled() {
                break;
            }
            let current_padded = frames::pad_to_multiple(&current, 32);
            for step in &steps {
                let interpolated =
                    rife::infer(&mut session, &previous_padded, &current_padded, *step)?;
                let cropped = frames::crop(&interpolated, 0, 0, current.width, current.height);
                encoder.write(&cropped)?;
            }
            encoder.write(&current)?;
            previous_padded = current_padded;
            last = current;
            index += 1;
            emit(
                &app_for_task,
                "processing",
                (index as f32 / total as f32).min(0.99),
                None,
            );
        }

        for _ in 1..factor {
            encoder.write(&last)?;
        }

        if cancelled() {
            return Err("已取消".into());
        }
        decoder.finish()?;
        encoder.finish()?;
        Ok(())
    })
    .await;

    end_task();
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            let message = format!("补帧任务异常：{error}");
            emit(&app, "error", 0.0, Some(message.clone()));
            return Err(message);
        }
    };
    match result {
        Ok(()) => {
            let output_text = output.to_string_lossy().into_owned();
            let meta = probe_media(app.clone(), output_text.clone())
                .await
                .unwrap_or_default();
            emit(&app, "done", 1.0, Some("补帧完成".into()));
            Ok(VideoProcessed {
                path: output_text,
                duration: if meta.duration > 0.0 {
                    meta.duration
                } else {
                    duration
                },
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            emit(&app, "error", 0.0, Some(error.clone()));
            Err(error)
        }
    }
}

fn aspect_ratio(
    aspect: &str,
    source_width: usize,
    source_height: usize,
) -> Result<(f32, f32), String> {
    match aspect {
        "9:16" => Ok((9.0, 16.0)),
        "1:1" => Ok((1.0, 1.0)),
        "16:9" => Ok((16.0, 9.0)),
        "source" => Ok((source_width as f32, source_height as f32)),
        _ => Err(format!("未知的裁剪比例：{aspect}")),
    }
}

fn crop_size(
    source_width: usize,
    source_height: usize,
    target_width: usize,
    target_height: usize,
) -> (f32, f32) {
    let target_aspect = target_width as f32 / target_height as f32;
    let source_aspect = source_width as f32 / source_height as f32;
    if source_aspect > target_aspect {
        (
            (source_height as f32 * target_aspect).min(source_width as f32),
            source_height as f32,
        )
    } else {
        (
            source_width as f32,
            (source_width as f32 / target_aspect).min(source_height as f32),
        )
    }
}

fn detect_target(
    frame: &Frame,
    subject: &str,
    yunet: &mut Option<detect::Yunet>,
    yolo: &mut Option<detect::Yolo>,
) -> Result<Option<(f32, f32)>, String> {
    let mut chosen: Option<Detection> = None;
    if subject == "face" || subject == "auto" {
        if let Some(detector) = yunet.as_mut() {
            chosen = detect::largest(&detector.detect_faces(frame)?);
        }
    }
    if chosen.is_none() && (subject == "person" || subject == "auto") {
        if let Some(detector) = yolo.as_mut() {
            chosen = detect::largest(&detector.detect_people(frame)?);
        }
    }
    Ok(chosen.map(|detection| detection.center()))
}

fn reframe_frame(
    frame: &Frame,
    tracker: &mut detect::CropTracker,
    target: Option<(f32, f32)>,
    crop_width: f32,
    crop_height: f32,
    out_width: usize,
    out_height: usize,
) -> Frame {
    let (center_x, center_y) =
        tracker.update(target, frame.width, frame.height, crop_width, crop_height);
    let max_x = (frame.width as f32 - crop_width).max(0.0);
    let max_y = (frame.height as f32 - crop_height).max(0.0);
    let x = (center_x - crop_width / 2.0).round().clamp(0.0, max_x) as usize;
    let y = (center_y - crop_height / 2.0).round().clamp(0.0, max_y) as usize;
    let cropped = frames::crop(
        frame,
        x,
        y,
        crop_width.round() as usize,
        crop_height.round() as usize,
    );
    frames::resize_bilinear(&cropped, out_width, out_height)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn video_ai_reframe(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    yolo_model_id: Option<String>,
    yunet_model_id: Option<String>,
    subject: String,
    aspect: String,
    height: u32,
    smooth: f32,
) -> Result<VideoProcessed, String> {
    let subject_key = subject.as_str();
    let yolo_path = if subject_key == "person" || subject_key == "auto" {
        optional_model(&app, yolo_model_id.as_deref(), "track")?
    } else {
        None
    };
    let yunet_path = if subject_key == "face" || subject_key == "auto" {
        optional_model(&app, yunet_model_id.as_deref(), "reframe")?
    } else {
        None
    };
    match subject_key {
        "face" if yunet_path.is_none() => return Err("请先安装 YuNet 人脸检测模型".into()),
        "person" if yolo_path.is_none() => return Err("请先安装 YOLOX 人物检测模型".into()),
        "auto" if yolo_path.is_none() && yunet_path.is_none() => {
            return Err("请先安装 YOLOX 或 YuNet 模型".into())
        }
        "face" | "person" | "auto" | "center" => {}
        other => return Err(format!("未知的追踪对象：{other}")),
    }

    let info = source_info(&app, &path).await?;
    let duration = validate_duration(duration, info.duration)?;
    let source_fps = if fps.is_finite() && fps > 0.0 {
        fps.clamp(1.0, MAX_FPS)
    } else {
        info.fps
    };
    let (aspect_width, aspect_height) = aspect_ratio(&aspect, info.width, info.height)?;
    let out_height = frames::even(height.clamp(240, 2160));
    let out_width = frames::even(
        (out_height as f32 * aspect_width / aspect_height)
            .round()
            .max(2.0) as u32,
    );
    if out_width > MAX_OUTPUT_SIDE || out_height > MAX_OUTPUT_SIDE {
        return Err(format!("输出分辨率过大：{out_width}×{out_height}"));
    }
    let (crop_width, crop_height) = crop_size(
        info.width,
        info.height,
        out_width as usize,
        out_height as usize,
    );

    let output = output_path(&app, "reframe")?;
    begin_task()?;
    let output_for_task = output.clone();
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut decoder = Decoder::spawn(
            &path,
            start,
            duration,
            source_fps,
            info.width,
            info.height,
            None,
        )?;
        let mut encoder = Encoder::spawn(
            &output_for_task,
            &path,
            start,
            duration,
            out_width as usize,
            out_height as usize,
            source_fps,
            info.has_audio,
        )?;

        let mut yolo = yolo_path.as_deref().map(detect::Yolo::load).transpose()?;
        let mut yunet = yunet_path.as_deref().map(detect::Yunet::load).transpose()?;
        let mut tracker = detect::CropTracker::new(smooth);
        let detect_every = if subject == "person" { 3 } else { 2 };
        let total = estimated_frames(duration, source_fps);
        let mut index = 0usize;

        while let Some(frame) = decoder.next()? {
            if cancelled() {
                break;
            }
            let target = if subject == "center" {
                Some((frame.width as f32 / 2.0, frame.height as f32 / 2.0))
            } else if index % detect_every == 0 {
                detect_target(&frame, &subject, &mut yunet, &mut yolo)?
            } else {
                None
            };
            let resized = reframe_frame(
                &frame,
                &mut tracker,
                target,
                crop_width,
                crop_height,
                out_width as usize,
                out_height as usize,
            );
            encoder.write(&resized)?;
            index += 1;
            emit(
                &app_for_task,
                "processing",
                (index as f32 / total as f32).min(0.99),
                None,
            );
        }

        if index == 0 {
            return Err("源视频没有可用画面".into());
        }
        if cancelled() {
            return Err("已取消".into());
        }
        decoder.finish()?;
        encoder.finish()?;
        Ok(())
    })
    .await;

    end_task();
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            let message = format!("智能裁剪任务异常：{error}");
            emit(&app, "error", 0.0, Some(message.clone()));
            return Err(message);
        }
    };
    match result {
        Ok(()) => {
            let output_text = output.to_string_lossy().into_owned();
            let meta = probe_media(app.clone(), output_text.clone())
                .await
                .unwrap_or_default();
            emit(&app, "done", 1.0, Some("智能裁剪完成".into()));
            Ok(VideoProcessed {
                path: output_text,
                duration: if meta.duration > 0.0 {
                    meta.duration
                } else {
                    duration
                },
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            emit(&app, "error", 0.0, Some(error.clone()));
            Err(error)
        }
    }
}

/// 采样分析得到的一个目标框，坐标按画面归一化到 0..1。
#[derive(Debug, Clone, Serialize)]
pub struct AnalysisObject {
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub score: f32,
}

/// 采样分析的一帧：时间、相对上一帧的运动量、目标框。
#[derive(Debug, Clone, Serialize)]
pub struct AnalysisSample {
    pub time: f64,
    pub motion: f32,
    pub objects: Vec<AnalysisObject>,
}

/// 找某个 feature 下第一个已安装的模型权重。
fn first_installed_model(app: &AppHandle, feature: &str) -> Option<PathBuf> {
    models::all()
        .iter()
        .filter(|entry| entry.feature == feature)
        .find_map(|entry| {
            let dir = models::installed_dir(app, entry)?;
            let file = entry.files.first()?;
            Some(dir.join(file.filename))
        })
}

fn motion_score(previous: &Frame, current: &Frame) -> f32 {
    let previous = frames::resize_bilinear(previous, 32, 18);
    let current = frames::resize_bilinear(current, 32, 18);
    let total = previous.rgb.len().min(current.rgb.len());
    if total == 0 {
        return 0.0;
    }
    let sum: f64 = previous.rgb[..total]
        .iter()
        .zip(current.rgb[..total].iter())
        .map(|(a, b)| f64::from((i16::from(*a) - i16::from(*b)).unsigned_abs()))
        .sum();
    (sum / (total as f64 * 255.0)).clamp(0.0, 1.0) as f32
}

fn normalized_object(
    detection: Detection,
    kind: &str,
    width: usize,
    height: usize,
) -> AnalysisObject {
    let width = width.max(1) as f32;
    let height = height.max(1) as f32;
    AnalysisObject {
        kind: kind.to_string(),
        x: (detection.x / width).clamp(0.0, 1.0),
        y: (detection.y / height).clamp(0.0, 1.0),
        width: (detection.width / width).clamp(0.0, 1.0),
        height: (detection.height / height).clamp(0.0, 1.0),
        score: detection.score,
    }
}

/// 低分辨率采样分析：逐样本给出运动量，按需返回人脸 / 人物框。
///
/// 智能体只要一个 `probe_media` 调用就能了解素材内容，不必逐帧渲染再看图。
pub async fn video_ai_samples(
    app: AppHandle,
    path: String,
    interval: f64,
    max_samples: usize,
    subject: String,
) -> Result<Vec<AnalysisSample>, String> {
    let info = source_info(&app, &path).await?;
    let interval = if interval.is_finite() && interval > 0.0 {
        interval.clamp(0.25, 600.0)
    } else {
        2.0
    };
    let max_samples = max_samples.clamp(1, 300);
    let sampled_duration = interval * max_samples as f64;
    let duration = if info.duration > 0.0 {
        info.duration.min(sampled_duration)
    } else {
        sampled_duration
    };
    if duration <= 0.0 {
        return Err("素材没有可分析的画面".into());
    }

    let subject = subject.to_ascii_lowercase();
    let subject = match subject.as_str() {
        "" | "none" | "off" => "none",
        "face" | "person" | "auto" => subject.as_str(),
        other => return Err(format!("未知的检测对象：{other}")),
    };

    let mut yunet = if subject == "face" || subject == "auto" {
        first_installed_model(&app, "reframe")
            .map(|path| detect::Yunet::load(&path))
            .transpose()?
    } else {
        None
    };
    let mut yolo = if subject == "person" || subject == "auto" {
        first_installed_model(&app, "track")
            .map(|path| detect::Yolo::load(&path))
            .transpose()?
    } else {
        None
    };
    match subject {
        "face" if yunet.is_none() => return Err("请先安装 YuNet 人脸检测模型".into()),
        "person" if yolo.is_none() => return Err("请先安装 YOLOX 人物检测模型".into()),
        "auto" if yunet.is_none() && yolo.is_none() => {
            return Err("请先安装 YuNet 或 YOLOX 模型".into())
        }
        _ => {}
    }

    let scale = (info.width as f64 / 640.0).max(1.0);
    let width = ((info.width as f64 / scale).round() as usize).max(2);
    let height = ((info.height as f64 / scale).round() as usize).max(2);
    let fps = 1.0 / interval;

    begin_task()?;
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<Vec<AnalysisSample>, String> {
            let mut decoder = Decoder::spawn(
                &path,
                0.0,
                duration,
                fps,
                width,
                height,
                Some((width, height)),
            )?;
            let mut samples = Vec::new();
            let mut previous: Option<Frame> = None;
            let mut index = 0usize;

            while let Some(frame) = decoder.next()? {
                let motion = previous
                    .as_ref()
                    .map(|previous| motion_score(previous, &frame))
                    .unwrap_or(0.0);
                let mut objects = Vec::new();
                if let Some(detector) = yunet.as_mut() {
                    for detection in detector.detect_faces(&frame)? {
                        objects.push(normalized_object(
                            detection,
                            "face",
                            frame.width,
                            frame.height,
                        ));
                    }
                }
                if let Some(detector) = yolo.as_mut() {
                    for detection in detector.detect_people(&frame)? {
                        objects.push(normalized_object(
                            detection,
                            "person",
                            frame.width,
                            frame.height,
                        ));
                    }
                }
                objects.sort_by(|a, b| b.score.total_cmp(&a.score));
                objects.truncate(20);
                samples.push(AnalysisSample {
                    time: index as f64 * interval,
                    motion,
                    objects,
                });
                previous = Some(frame);
                index += 1;
            }

            decoder.finish()?;
            samples.truncate(max_samples);
            Ok(samples)
        })
        .await;
    end_task();

    match result {
        Ok(samples) => samples,
        Err(error) => Err(format!("视频采样任务异常：{error}")),
    }
}

#[tauri::command]
pub fn video_ai_cancel() {
    runtime().cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut children) = runtime().children.lock() {
        for slot in children.drain(..) {
            if let Ok(mut guard) = slot.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_keeps_the_target_aspect() {
        let (width, height) = crop_size(1920, 1080, 1080, 1920);
        assert!((width / height - 1080.0 / 1920.0).abs() < 1e-4);
        assert!(width <= 1920.0);
        assert!(height <= 1080.0);
    }

    #[test]
    fn source_aspect_uses_the_whole_frame() {
        let (width, height) = crop_size(1920, 1080, 1920, 1080);
        assert_eq!((width, height), (1920.0, 1080.0));
    }

    #[test]
    fn unknown_aspect_is_rejected() {
        assert!(aspect_ratio("4:3", 1920, 1080).is_err());
    }

    #[test]
    fn reframe_crops_and_resizes() {
        let frame = Frame {
            width: 1920,
            height: 1080,
            rgb: vec![80; 1920 * 1080 * 3],
        };
        let mut tracker = detect::CropTracker::new(0.0);
        let out = reframe_frame(
            &frame,
            &mut tracker,
            Some((960.0, 540.0)),
            608.0,
            1080.0,
            304,
            540,
        );
        assert_eq!((out.width, out.height), (304, 540));
    }

    #[test]
    fn fps_text_is_compact() {
        assert_eq!(fps_text(60.0), "60");
        assert_eq!(fps_text(23.976), "23.976");
        assert_eq!(fps_text(0.5), "0.5");
    }

    fn staged(relative: &str) -> Option<PathBuf> {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        let path = PathBuf::from(home)
            .join("ai-cut-models-staging")
            .join(relative);
        path.is_file().then_some(path)
    }

    #[test]
    fn real_rife_interpolates() {
        let Some(path) = staged("rife/rife47_ensemble_True_scale_1_sim.onnx") else {
            return;
        };
        let mut session = rife::load(&path).expect("加载 RIFE");
        let first = Frame {
            width: 64,
            height: 64,
            rgb: vec![0; 64 * 64 * 3],
        };
        let second = Frame {
            width: 64,
            height: 64,
            rgb: vec![255; 64 * 64 * 3],
        };
        let out = rife::infer(&mut session, &first, &second, 0.5).expect("RIFE 推理");
        assert_eq!((out.width, out.height), (64, 64));
        assert!(out.rgb.iter().any(|value| *value > 0));
    }

    #[test]
    fn real_esrgan_upscales() {
        let Some(path) = staged("real-esrgan-general-x4v3/realesr-general-x4v3.onnx") else {
            return;
        };
        let mut session = esrgan::load(&path).expect("加载 Real-ESRGAN");
        let frame = Frame {
            width: 32,
            height: 32,
            rgb: vec![128; 32 * 32 * 3],
        };
        let out = esrgan::upscale_frame(&mut session, &frame, 4).expect("超分推理");
        assert_eq!((out.width, out.height), (128, 128));
    }

    #[test]
    fn real_esrgan_handles_tiles() {
        let Some(path) = staged("real-esrgan-general-x4v3/realesr-general-x4v3.onnx") else {
            return;
        };
        let mut session = esrgan::load(&path).expect("加载 Real-ESRGAN");
        let frame = Frame {
            width: 260,
            height: 260,
            rgb: vec![100; 260 * 260 * 3],
        };
        let out = esrgan::upscale_frame(&mut session, &frame, 4).expect("分块超分");
        assert_eq!((out.width, out.height), (1040, 1040));
    }

    #[test]
    fn real_yolox_runs() {
        let Some(path) = staged("yolox-nano/yolox_nano.onnx") else {
            return;
        };
        let mut detector = detect::Yolo::load(&path).expect("加载 YOLOX");
        let frame = Frame {
            width: 320,
            height: 240,
            rgb: vec![128; 320 * 240 * 3],
        };
        let detections = detector.detect_people(&frame).expect("YOLOX 推理");
        assert!(detections.len() < 16);
    }

    #[test]
    fn real_yunet_runs() {
        let Some(path) = staged("yunet/face_detection_yunet_2023mar.onnx") else {
            return;
        };
        let mut detector = detect::Yunet::load(&path).expect("加载 YuNet");
        let frame = Frame {
            width: 320,
            height: 240,
            rgb: vec![128; 320 * 240 * 3],
        };
        let detections = detector.detect_faces(&frame).expect("YuNet 推理");
        assert!(detections.len() < 16);
    }

    fn make_video(path: &Path, size: &str, duration: f64) -> bool {
        let status = Command::new(sidecar_path("ffmpeg"))
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc=size={size}:rate=30:duration={duration}"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=440:duration={duration}"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                path.to_string_lossy().as_ref(),
            ])
            .status();
        status.map(|status| status.success()).unwrap_or(false)
    }

    fn test_paths(tag: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "aicut-video-ai-{tag}-{}-{}",
            std::process::id(),
            stamp()
        ));
        (
            base.with_extension("in.mp4"),
            base.with_extension("out.mp4"),
        )
    }

    fn probe_streams(path: &Path) -> String {
        let output = Command::new(sidecar_path("ffprobe"))
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,width,height",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1",
                path.to_string_lossy().as_ref(),
            ])
            .output();
        output
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default()
    }

    #[test]
    fn pipeline_interpolates_a_short_video() {
        let Some(model) = staged("rife/rife47_ensemble_True_scale_1_sim.onnx") else {
            return;
        };
        let (input, output) = test_paths("rife");
        if !make_video(&input, "64x64", 0.4) {
            return;
        }
        let input_text = input.to_string_lossy().into_owned();

        let mut decoder =
            Decoder::spawn(&input_text, 0.0, 0.4, 30.0, 64, 64, None).expect("解码器");
        let mut encoder =
            Encoder::spawn(&output, &input_text, 0.0, 0.4, 64, 64, 60.0, true).expect("编码器");
        let mut session = rife::load(&model).expect("加载 RIFE");

        let first = decoder.next().expect("读首帧").expect("缺少首帧");
        encoder.write(&first).expect("写首帧");
        let mut previous = frames::pad_to_multiple(&first, 32);
        let mut last = first;
        while let Some(current) = decoder.next().expect("读帧") {
            let padded = frames::pad_to_multiple(&current, 32);
            for step in rife::timesteps(2) {
                let interpolated =
                    rife::infer(&mut session, &previous, &padded, step).expect("RIFE");
                let cropped = frames::crop(&interpolated, 0, 0, current.width, current.height);
                encoder.write(&cropped).expect("写插帧");
            }
            encoder.write(&current).expect("写当前帧");
            previous = padded;
            last = current;
        }
        encoder.write(&last).expect("写尾帧");
        decoder.finish().expect("解码结束");
        encoder.finish().expect("编码结束");

        let size = std::fs::metadata(&output)
            .map(|meta| meta.len())
            .unwrap_or(0);
        assert!(size > 1000, "输出文件过小：{size}");
        let streams = probe_streams(&output);
        assert!(streams.contains("codec_type=video"), "{streams}");
        assert!(streams.contains("codec_type=audio"), "{streams}");
        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }

    #[test]
    fn pipeline_upscales_a_short_video() {
        let Some(model) = staged("real-esrgan-general-x4v3/realesr-general-x4v3.onnx") else {
            return;
        };
        let (input, output) = test_paths("esrgan");
        if !make_video(&input, "32x32", 0.2) {
            return;
        }
        let input_text = input.to_string_lossy().into_owned();

        let mut decoder =
            Decoder::spawn(&input_text, 0.0, 0.2, 30.0, 32, 32, None).expect("解码器");
        let mut encoder =
            Encoder::spawn(&output, &input_text, 0.0, 0.2, 128, 128, 30.0, true).expect("编码器");
        let mut session = esrgan::load(&model).expect("加载 Real-ESRGAN");
        while let Some(frame) = decoder.next().expect("读帧") {
            let upscaled = esrgan::upscale_frame(&mut session, &frame, 4).expect("超分");
            encoder.write(&upscaled).expect("写超分帧");
        }
        decoder.finish().expect("解码结束");
        encoder.finish().expect("编码结束");

        let size = std::fs::metadata(&output)
            .map(|meta| meta.len())
            .unwrap_or(0);
        assert!(size > 1000, "输出文件过小：{size}");
        let streams = probe_streams(&output);
        assert!(streams.contains("codec_type=video"), "{streams}");
        assert!(streams.contains("codec_type=audio"), "{streams}");
        assert!(streams.contains("width=128"), "{streams}");
        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }
}
