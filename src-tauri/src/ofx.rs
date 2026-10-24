//! OFX host bridge.
//!
//! `ofx_probe` and `ofx_render_frame` are the low-level commands; the app uses
//! `ofx_render_preview` to decode a source frame with ffmpeg, run the effect
//! chain and return a PNG data URL component.  The actual OFX ABI lives in the
//! `ofx-host` crate so it can also be exercised by its own CLI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::sidecar::run_sidecar;

/// 烘焙进度事件名。
pub const EVENT_OFX_BAKE: &str = "ofx-bake-progress";
/// 每渲染这么多帧上报一次进度。
const PROGRESS_STEP_FRAMES: u64 = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxBakeProgress {
    /// 调用方传入的任务 id（预览用片段 id）；导出烘焙为空。
    pub id: Option<String>,
    pub phase: &'static str,
    pub done: u64,
    pub total: u64,
}

fn cancel_ids() -> &'static Mutex<HashSet<String>> {
    static IDS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IDS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_cancelled(id: Option<&str>) -> bool {
    id.map(|value| cancel_ids().lock().map(|set| set.contains(value)).unwrap_or(false))
        .unwrap_or(false)
}

fn clear_cancel(id: Option<&str>) {
    if let Some(value) = id {
        if let Ok(mut set) = cancel_ids().lock() {
            set.remove(value);
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxEffectSpec {
    pub bundle: String,
    pub plugin: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxFrame {
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxBakeRequest {
    /// 调用方任务 id（预览渲染按片段 id 上报进度 / 取消）；导出烘焙留空。
    #[serde(default)]
    pub id: Option<String>,
    /// true：编码成 H.264（预览播放用）；false：ProRes 4444（导出中间文件）。
    #[serde(default)]
    pub preview: bool,
    pub source: String,
    pub source_in: f64,
    /// Timeline duration of the clip (after speed).
    pub duration: f64,
    #[serde(default = "one")]
    pub speed: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub is_image: bool,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub fit_anchor: Option<String>,
    #[serde(default)]
    pub time_offset: f64,
    pub effects: Vec<OfxEffectSpec>,
    /// Destination cache path; the parent directory is created.
    pub output: String,
}

fn one() -> f64 {
    1.0
}

#[tauri::command]
pub async fn ofx_probe(
    bundle: String,
    plugin: Option<String>,
    context: Option<String>,
) -> Result<Vec<ofx_host::PluginInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ofx_host::probe(&bundle, plugin.as_deref(), context.as_deref())
    })
    .await
    .map_err(|error| format!("OFX 探测线程失败：{error}"))?
}

/// Render raw RGBA (base64) through one effect and return a PNG.
#[tauri::command]
pub async fn ofx_render_frame(
    bundle: String,
    plugin: String,
    context: Option<String>,
    width: u32,
    height: u32,
    time: f64,
    rgba_base64: String,
    params: Option<Value>,
) -> Result<OfxFrame, String> {
    let started = std::time::Instant::now();
    let bytes = STANDARD
        .decode(rgba_base64)
        .map_err(|error| format!("RGBA base64 解码失败：{error}"))?;
    let expected = (width as usize) * (height as usize) * 4;
    if bytes.len() != expected {
        return Err(format!(
            "RGBA 大小不匹配：期望 {expected} 字节，实际 {}",
            bytes.len()
        ));
    }
    let input: Vec<f32> = bytes.iter().map(|value| *value as f32 / 255.0).collect();
    let params = params
        .as_ref()
        .and_then(Value::as_object)
        .map(ofx_host::params_from_json)
        .unwrap_or_default();

    let rendered = tauri::async_runtime::spawn_blocking(move || {
        let mut rendered = ofx_host::render_frame(
            &bundle,
            &plugin,
            context.as_deref(),
            width,
            height,
            time,
            &input,
            &params,
        )?;
        keep_input_alpha(&mut rendered, &input);
        Ok::<Vec<f32>, String>(rendered)
    })
    .await
    .map_err(|error| format!("OFX 渲染线程失败：{error}"))??;

    Ok(OfxFrame {
        width,
        height,
        png_base64: encode_png(width, height, &rendered)?,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// Decode one source frame and run a chain of OFX effects on it.
#[tauri::command]
pub async fn ofx_render_preview<R: Runtime>(
    app: AppHandle<R>,
    source: String,
    source_time: f64,
    time: f64,
    width: u32,
    height: u32,
    is_image: bool,
    fit: Option<String>,
    effects: Vec<OfxEffectSpec>,
) -> Result<OfxFrame, String> {
    let started = std::time::Instant::now();
    let rgba = decode_frame(
        &app,
        &source,
        source_time,
        width,
        height,
        is_image,
        fit.as_deref().unwrap_or("contain"),
    )
    .await?;

    let rendered = if effects.is_empty() {
        rgba
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            apply_effects(rgba, &effects, width, height, time)
        })
        .await
        .map_err(|error| format!("OFX 渲染线程失败：{error}"))??
    };

    Ok(OfxFrame {
        width,
        height,
        png_base64: encode_png(width, height, &rendered)?,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// Decode a clip, run the effect chain on every frame, and encode a ProRes
/// 4444 intermediate that the export plan can use as a normal video source.
#[tauri::command]
pub async fn ofx_bake_clip<R: Runtime>(
    app: AppHandle<R>,
    request: OfxBakeRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = bake_clip_blocking(&app, &request);
        if result.is_ok() && request.preview {
            cleanup_previous_previews(&request.output);
        }
        result
    })
    .await
    .map_err(|error| format!("OFX 烘焙线程失败：{error}"))?
}

/// 同一条片段换参数后会生成新的缓存文件：旧的预览文件在成功后删掉。
fn cleanup_previous_previews(output: &str) {
    let path = Path::new(output);
    let Some(dir) = path.parent() else {
        return;
    };
    let Some(stem) = path.file_stem().map(|value| value.to_string_lossy().into_owned()) else {
        return;
    };
    let Some((prefix, _)) = stem.rsplit_once('-') else {
        return;
    };
    let prefix = format!("{prefix}-");
    let current = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == current || !name.starts_with(&prefix) || !name.ends_with(".mp4") {
            continue;
        }
        if name.contains(".tmp.") {
            continue;
        }
        let _ = std::fs::remove_file(entry.path());
    }
}

/// 清理上次异常退出遗留的临时文件（10 分钟内的一律保留，避免误删并发任务）。
fn cleanup_stale_temps(output: &str) {
    let path = Path::new(output);
    let Some(dir) = path.parent() else {
        return;
    };
    let Some(stem) = path.file_stem().map(|value| value.to_string_lossy().into_owned()) else {
        return;
    };
    let Some(ext) = path.extension().map(|value| value.to_string_lossy().into_owned()) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&format!("{stem}.")) || !name.ends_with(&format!(".tmp.{ext}")) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() > 600)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// 临时文件守卫：失败 / 取消时自动清理。
struct TempGuard {
    path: PathBuf,
    armed: bool,
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// 烘焙先写临时文件、成功后再改名：页面刷新或重复排队时不会让两个 ffmpeg
/// 同时写同一个输出，也不会让界面把写了一半的文件当成可用结果。
fn bake_temp_path(output: &str) -> PathBuf {
    let path = Path::new(output);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "bake".to_string());
    let ext = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    path.with_file_name(format!("{stem}.{stamp}.tmp.{ext}"))
}

fn fail_children(
    decoder: tauri_plugin_shell::process::CommandChild,
    encoder: tauri_plugin_shell::process::CommandChild,
    error: String,
) -> String {
    let _ = decoder.kill();
    let _ = encoder.kill();
    error
}

fn bake_clip_blocking<R: Runtime>(
    app: &AppHandle<R>,
    request: &OfxBakeRequest,
) -> Result<String, String> {
    if request.width == 0 || request.height == 0 {
        return Err("烘焙尺寸必须大于 0".into());
    }
    if !(request.duration > 0.0) {
        return Err("烘焙时长必须大于 0".into());
    }
    if !(request.fps > 0.0) {
        return Err("烘焙帧率必须大于 0".into());
    }
    clear_cancel(request.id.as_deref());

    if let Some(parent) = Path::new(&request.output).parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建烘焙目录失败：{error}"))?;
    }
    cleanup_stale_temps(&request.output);

    let speed = request.speed.clamp(0.1, 4.0);
    let fit = request.fit.as_deref().unwrap_or("contain");
    let anchor = request.fit_anchor.as_deref().unwrap_or("center");
    let filter = if request.is_image {
        format!(
            "{},fps={},format=rgba",
            fit_filter(request.width, request.height, fit, anchor),
            request.fps
        )
    } else {
        format!(
            "{},setsar=1,setpts=(PTS-STARTPTS)/{},fps={},format=rgba",
            fit_filter(request.width, request.height, fit, anchor),
            speed,
            request.fps
        )
    };

    let source_duration = if request.is_image {
        request.duration
    } else {
        request.duration * speed
    };

    let mut decoder_args: Vec<String> = vec!["-v".into(), "error".into()];
    if request.is_image {
        decoder_args.push("-loop".into());
        decoder_args.push("1".into());
    } else {
        decoder_args.push("-ss".into());
        decoder_args.push(format!("{:.6}", request.source_in.max(0.0)));
    }
    decoder_args.extend([
        "-i".into(),
        request.source.clone(),
        "-t".into(),
        format!("{:.6}", source_duration),
        "-an".into(),
        "-vf".into(),
        filter,
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-s".into(),
        format!("{}x{}", request.width, request.height),
        "-".into(),
    ]);

    let temp = bake_temp_path(&request.output);
    let mut temp_guard = TempGuard {
        path: temp.clone(),
        armed: true,
    };
    let temp_text = temp.to_string_lossy().into_owned();

    let encoder_args: Vec<String> = if request.preview {
        // 预览：H.264，短 GOP 方便拖动，体积远小于 ProRes。
        vec![
            "-v".into(),
            "error".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgba".into(),
            "-s".into(),
            format!("{}x{}", request.width, request.height),
            "-r".into(),
            format!("{}", request.fps),
            "-i".into(),
            "-".into(),
            "-an".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "18".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-g".into(),
            "30".into(),
            "-movflags".into(),
            "+faststart".into(),
            "-y".into(),
            temp_text.clone(),
        ]
    } else {
        vec![
            "-v".into(),
            "error".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgba".into(),
            "-s".into(),
            format!("{}x{}", request.width, request.height),
            "-r".into(),
            format!("{}", request.fps),
            "-i".into(),
            "-".into(),
            "-an".into(),
            "-c:v".into(),
            "prores_ks".into(),
            "-profile:v".into(),
            "4".into(),
            "-pix_fmt".into(),
            "yuva444p10le".into(),
            "-y".into(),
            temp_text,
        ]
    };

    let (mut decoder_rx, decoder_child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("ffmpeg sidecar 不可用：{error}"))?
        .args(&decoder_args)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("启动 ffmpeg 解码失败：{error}"))?;
    let (mut encoder_rx, mut encoder_child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("ffmpeg sidecar 不可用：{error}"))?
        .args(&encoder_args)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("启动 ffmpeg 编码失败：{error}"))?;

    let mut sessions: Vec<(ofx_host::Session, Vec<ofx_host::ParamValue>)> = Vec::new();
    for effect in &request.effects {
        let params = effect
            .params
            .as_ref()
            .and_then(Value::as_object)
            .map(ofx_host::params_from_json)
            .unwrap_or_default();
        let session = ofx_host::Session::open(
            &effect.bundle,
            &effect.plugin,
            effect.context.as_deref(),
            request.width,
            request.height,
        )?;
        sessions.push((session, params));
    }

    let frame_bytes = (request.width as usize) * (request.height as usize) * 4;
    let mut pending: Vec<u8> = Vec::with_capacity(frame_bytes);
    // 帧缓冲复用：逐帧新建 33 MB 的 f32 缓冲会让大片段烘焙慢得离谱。
    let mut frame: Vec<f32> = vec![0.0; frame_bytes];
    let mut bytes: Vec<u8> = vec![0u8; frame_bytes];
    let mut frame_index = 0u64;
    let mut decoder_code: Option<i32> = None;
    let mut decoder_stderr = Vec::new();
    let mut failure: Option<String> = None;
    let total_frames = (request.duration * request.fps).ceil().max(1.0) as u64;

    let progress = |phase: &'static str, done: u64| {
        let _ = app.emit(
            EVENT_OFX_BAKE,
            OfxBakeProgress {
                id: request.id.clone(),
                phase,
                done,
                total: total_frames,
            },
        );
    };
    progress("rendering", 0);

    loop {
        let event = decoder_rx.blocking_recv();
        match event {
            Some(CommandEvent::Stdout(chunk)) => {
                pending.extend_from_slice(&chunk);
                while pending.len() >= frame_bytes {
                    if is_cancelled(request.id.as_deref()) {
                        failure = Some("已取消".into());
                        break;
                    }
                    let raw: Vec<u8> = pending.drain(..frame_bytes).collect();
                    for (dst, src) in frame.iter_mut().zip(raw.iter()) {
                        *dst = *src as f32 / 255.0;
                    }
                    let time = request.time_offset + frame_index as f64 / request.fps;
                    let mut rendered: Vec<f32> = frame.clone();
                    for (session, params) in sessions.iter_mut() {
                        match session.render(time, &rendered, params) {
                            Ok(mut next) => {
                                keep_input_alpha(&mut next, &rendered);
                                rendered = next;
                            }
                            Err(error) => {
                                failure = Some(error);
                                break;
                            }
                        }
                    }
                    if failure.is_some() {
                        break;
                    }
                    for (dst, value) in bytes.iter_mut().zip(rendered.iter()) {
                        *dst = (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                    }
                    if let Err(error) = encoder_child.write(&bytes) {
                        failure = Some(format!("写入编码器失败：{error}"));
                        break;
                    }
                    frame_index += 1;
                    if frame_index % PROGRESS_STEP_FRAMES == 0 {
                        progress("rendering", frame_index);
                    }
                }
                if failure.is_some() {
                    break;
                }
            }
            Some(CommandEvent::Stderr(line)) => {
                if decoder_stderr.len() < 8192 {
                    decoder_stderr.extend_from_slice(&line);
                }
            }
            Some(CommandEvent::Error(error)) => {
                failure = Some(format!("解码器错误：{error}"));
                break;
            }
            Some(CommandEvent::Terminated(payload)) => {
                decoder_code = payload.code;
                break;
            }
            Some(_) => {}
            None => break,
        }
    }

    if let Some(error) = failure {
        return Err(fail_children(decoder_child, encoder_child, error));
    }
    drop(decoder_child);
    drop(encoder_child); // closing stdin lets ffmpeg flush and exit

    let mut encoder_code: Option<i32> = None;
    let mut encoder_stderr = Vec::new();
    while let Some(event) = encoder_rx.blocking_recv() {
        match event {
            CommandEvent::Stderr(line) => {
                if encoder_stderr.len() < 8192 {
                    encoder_stderr.extend_from_slice(&line);
                }
            }
            CommandEvent::Terminated(payload) => {
                encoder_code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                return Err(format!("编码器错误：{error}"));
            }
            _ => {}
        }
    }

    if let Some(code) = decoder_code {
        if code != 0 {
            return Err(format!(
                "ffmpeg 解码失败（退出码 {code}）：{}",
                String::from_utf8_lossy(&decoder_stderr).trim()
            ));
        }
    }
    if let Some(code) = encoder_code {
        if code != 0 {
            return Err(format!(
                "ffmpeg 编码失败（退出码 {code}）：{}",
                String::from_utf8_lossy(&encoder_stderr).trim()
            ));
        }
    }
    if frame_index == 0 {
        return Err("解码器没有输出任何帧".into());
    }
    let metadata =
        std::fs::metadata(&temp).map_err(|error| format!("烘焙结果不存在：{error}"))?;
    if metadata.len() == 0 {
        return Err("烘焙结果为空文件".into());
    }
    std::fs::rename(&temp, &request.output).map_err(|error| format!("写入烘焙结果失败：{error}"))?;
    temp_guard.armed = false;
    progress("done", frame_index);
    Ok(request.output.clone())
}

/// 取消指定 id 的烘焙：下一个帧边界生效，命令随后返回「已取消」。
#[tauri::command]
pub fn ofx_cancel_bake(id: Option<String>) {
    if let Some(value) = id {
        if let Ok(mut set) = cancel_ids().lock() {
            set.insert(value);
        }
    }
}

fn anchor_offsets(anchor: &str) -> (&str, &str) {
    match anchor {
        "top-left" => ("0", "0"),
        "top" => ("0.5", "0"),
        "top-right" => ("1", "0"),
        "left" => ("0", "0.5"),
        "right" => ("1", "0.5"),
        "bottom-left" => ("0", "1"),
        "bottom" => ("0.5", "1"),
        "bottom-right" => ("1", "1"),
        _ => ("0.5", "0.5"),
    }
}

fn fit_filter(width: u32, height: u32, fit: &str, anchor: &str) -> String {
    match fit {
        "cover" => {
            let (x, y) = anchor_offsets(anchor);
            format!(
                "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}:(iw-ow)*{x}:(ih-oh)*{y}"
            )
        }
        "stretch" => format!("scale={width}:{height}"),
        _ => format!(
            "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0"
        ),
    }
}

/// 时间线上的画面按不透明处理：插件连 alpha 一起反相时（OpenFX 自带的 Invert
/// 示例就会把 RGBA 四个通道全部取反，输出 alpha 恒为 0），预览和导出都会变成
/// 全透明。这里统一沿用效果输入帧的 alpha，只让插件改 RGB。
fn keep_input_alpha(rendered: &mut [f32], source: &[f32]) {
    for (dst, src) in rendered.chunks_exact_mut(4).zip(source.chunks_exact(4)) {
        dst[3] = src[3];
    }
}

fn apply_effects(
    mut frame: Vec<f32>,
    effects: &[OfxEffectSpec],
    width: u32,
    height: u32,
    time: f64,
) -> Result<Vec<f32>, String> {
    for effect in effects {
        let params = effect
            .params
            .as_ref()
            .and_then(Value::as_object)
            .map(ofx_host::params_from_json)
            .unwrap_or_default();
        let mut session = ofx_host::Session::open(
            &effect.bundle,
            &effect.plugin,
            effect.context.as_deref(),
            width,
            height,
        )?;
        let mut rendered = session.render(time, &frame, &params)?;
        keep_input_alpha(&mut rendered, &frame);
        frame = rendered;
    }
    Ok(frame)
}

async fn decode_frame<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
    source_time: f64,
    width: u32,
    height: u32,
    is_image: bool,
    fit: &str,
) -> Result<Vec<f32>, String> {
    if width == 0 || height == 0 {
        return Err("预览尺寸必须大于 0".into());
    }
    let filter = match fit {
        "cover" => format!(
            "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=rgba"
        ),
        "stretch" => format!("scale={width}:{height},format=rgba"),
        _ => format!(
            "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba"
        ),
    };

    let mut args: Vec<String> = vec!["-v".into(), "error".into()];
    if !is_image {
        args.push("-ss".into());
        args.push(format!("{:.6}", source_time.max(0.0)));
    }
    args.push("-i".into());
    args.push(source.to_string());
    args.push("-frames:v".into());
    args.push("1".into());
    args.push("-an".into());
    args.push("-vf".into());
    args.push(filter);
    args.push("-f".into());
    args.push("rawvideo".into());
    args.push("-pix_fmt".into());
    args.push("rgba".into());
    args.push("-s".into());
    args.push(format!("{width}x{height}"));
    args.push("-".into());

    let (code, stdout) = run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) {
        return Err(format!("ffmpeg 解码失败（退出码 {:?}）：{}", code, source));
    }
    let expected = (width as usize) * (height as usize) * 4;
    if stdout.len() != expected {
        return Err(format!(
            "ffmpeg 输出大小不匹配：期望 {expected} 字节，实际 {}",
            stdout.len()
        ));
    }
    Ok(stdout.iter().map(|value| *value as f32 / 255.0).collect())
}

fn encode_png(width: u32, height: u32, rgba: &[f32]) -> Result<String, String> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(format!(
            "PNG 像素数量不匹配：期望 {expected}，实际 {}",
            rgba.len()
        ));
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("PNG 头部写入失败：{error}"))?;
        let data: Vec<u8> = rgba
            .iter()
            .map(|value| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
            .collect();
        writer
            .write_image_data(&data)
            .map_err(|error| format!("PNG 写入失败：{error}"))?;
    }
    Ok(STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_encoder_keeps_rgba() {
        let png = encode_png(1, 1, &[1.0, 0.0, 0.5, 1.0]).unwrap();
        let bytes = STANDARD.decode(png).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn cover_filter_honours_anchor() {
        let filter = fit_filter(1920, 1080, "cover", "top-left");
        assert!(filter.contains("(iw-ow)*0:(ih-oh)*0"));
        let centered = fit_filter(1920, 1080, "cover", "center");
        assert!(centered.contains("(iw-ow)*0.5:(ih-oh)*0.5"));
    }

    #[test]
    fn contain_filter_pads_transparently() {
        let filter = fit_filter(1920, 1080, "contain", "center");
        assert!(filter.contains("force_original_aspect_ratio=decrease"));
        assert!(filter.contains("color=black@0"));
    }

    #[test]
    fn alpha_passthrough_overrides_plugin_output() {
        let source = [0.1, 0.2, 0.3, 1.0, 0.4, 0.5, 0.6, 0.5];
        let mut rendered = [1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        keep_input_alpha(&mut rendered, &source);
        assert_eq!(rendered, [1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.5]);
    }
}
