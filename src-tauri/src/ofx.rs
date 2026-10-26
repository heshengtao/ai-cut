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
    /// Full asset duration, used to clamp retimer source requests that run
    /// past the material's last frame.
    #[serde(default)]
    pub source_duration: f64,
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
    fps: Option<f64>,
    duration: Option<f64>,
    retimer_source_time: Option<f64>,
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
            apply_effects(
                rgba,
                &effects,
                width,
                height,
                time,
                fps,
                duration,
                retimer_source_time,
            )
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
        if name == current
            || !name.starts_with(&prefix)
            || !(name.ends_with(".mp4")
                || name.ends_with(".mov")
                || name.ends_with(".png"))
        {
            continue;
        }
        if name.contains(".tmp.") {
            continue;
        }
        // The preview may still be on screen while the replacement is being
        // baked; keep recent PNGs around and clean them on a later run.
        if name.ends_with(".png") {
            let recent = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|modified| std::time::SystemTime::now().duration_since(modified).ok())
                .map(|age| age.as_secs() < 600)
                .unwrap_or(false);
            if recent {
                continue;
            }
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
    if request.effects.iter().any(|effect| {
        effect.context.as_deref()
            == Some("OfxImageEffectContextRetimer")
    }) {
        return bake_retimer_blocking(app, request);
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
        let mut session = ofx_host::Session::open(
            &effect.bundle,
            &effect.plugin,
            effect.context.as_deref(),
            request.width,
            request.height,
        )?;
        session.set_duration(request.duration);
        session.set_frame_rate(request.fps);
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
/// Transition plugins may drop alpha.  Keep the union of both inputs' alpha so
/// a padded / transparent source stays transparent, while a fade to black
/// still produces opaque black (the remaining side is opaque there).
fn merge_input_alpha(rendered: &mut [f32], from: &[f32], to: &[f32]) {
    for (pixel, (a, b)) in rendered
        .chunks_exact_mut(4)
        .zip(from.chunks_exact(4).zip(to.chunks_exact(4)))
    {
        pixel[3] = a[3].max(b[3]);
    }
}

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
    fps: Option<f64>,
    duration: Option<f64>,
    retimer_source_time: Option<f64>,
) -> Result<Vec<f32>, String> {
    for (index, effect) in effects.iter().enumerate() {
        if index > 0
            && effect.context.as_deref()
                == Some("OfxImageEffectContextRetimer")
        {
            return Err("Retimer 必须放在效果链第一位".to_string());
        }
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
        if let Some(fps) = fps {
            session.set_frame_rate(fps);
        }
        if let Some(duration) = duration {
            session.set_duration(duration);
        }
        if let Some(source_time) = retimer_source_time {
            session.set_source_time(source_time);
        }
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


fn bake_retimer_blocking<R: Runtime>(
    app: &AppHandle<R>,
    request: &OfxBakeRequest,
) -> Result<String, String> {
    if !(request.duration > 0.0) {
        return Err("烘焙时长必须大于 0".into());
    }
    if !(request.fps > 0.0) {
        return Err("烘焙帧率必须大于 0".into());
    }
    let retimer_index = request
        .effects
        .iter()
        .position(|effect| {
            effect.context.as_deref() == Some("OfxImageEffectContextRetimer")
        })
        .ok_or_else(|| "没有找到 retimer 效果".to_string())?;
    if retimer_index != 0 {
        return Err("Retimer 必须放在效果链第一位（它决定源时间）".into());
    }
    clear_cancel(request.id.as_deref());
    if let Some(parent) = Path::new(&request.output).parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建烘焙目录失败：{error}"))?;
    }
    cleanup_stale_temps(&request.output);

    let mut sessions: Vec<(ofx_host::Session, Vec<ofx_host::ParamValue>)> = Vec::new();
    for effect in &request.effects {
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
            request.width,
            request.height,
        )?;
        session.set_duration(request.duration);
        session.set_frame_rate(request.fps);
        sessions.push((session, params));
    }

    let temp = bake_temp_path(&request.output);
    let mut guard = TempGuard {
        path: temp.clone(),
        armed: true,
    };
    let encoder_args = bake_encoder_args(
        request.preview,
        request.width,
        request.height,
        request.fps,
        &temp,
    );
    let (mut encoder_rx, mut encoder_child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("ffmpeg sidecar 不可用：{error}"))?
        .args(&encoder_args)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("启动编码器失败：{error}"))?;

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

    let frame_bytes = (request.width as usize) * (request.height as usize) * 4;
    let mut bytes: Vec<u8> = vec![0u8; frame_bytes];
    let fit = request.fit.as_deref().unwrap_or("contain");
    let mut failure: Option<String> = None;
    let mut written = 0u64;

    for index in 0..total_frames {
        if is_cancelled(request.id.as_deref()) {
            failure = Some("已取消".into());
            break;
        }
        let time = request.time_offset + index as f64 / request.fps;
        let source_time = {
            let (session, params) = &mut sessions[0];
            match session.source_time(time, params) {
                Ok(value) => value,
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        };
        let mut asset_time = request.source_in + source_time;
        if request.source_duration > 0.0 {
            asset_time = asset_time.clamp(
                0.0,
                (request.source_duration - 0.001).max(0.0),
            );
        }
        let frame = match tauri::async_runtime::block_on(decode_frame(
            app,
            &request.source,
            asset_time,
            request.width,
            request.height,
            request.is_image,
            fit,
        )) {
            Ok(value) => value,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        let mut rendered = frame;
        for (index, (session, params)) in sessions.iter_mut().enumerate() {
            if index == 0 {
                session.set_source_time(source_time);
            }
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
        written += 1;
        if written % PROGRESS_STEP_FRAMES == 0 {
            progress("rendering", written);
        }
    }

    if let Some(error) = failure {
        let _ = encoder_child.kill();
        return Err(error);
    }
    drop(encoder_child);

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
            CommandEvent::Error(error) => return Err(format!("编码器错误：{error}")),
            _ => {}
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
    if written == 0 {
        return Err("没有输出任何帧".into());
    }
    std::fs::rename(&temp, &request.output)
        .map_err(|error| format!("写入烘焙结果失败：{error}"))?;
    guard.armed = false;
    progress("done", written);
    Ok(request.output.clone())
}



#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxBakeImageRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub source: String,
    /// Effect time (clip-local seconds); images are static, so callers pass 0.
    #[serde(default)]
    pub time: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default = "default_fps")]
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fit: Option<String>,
    pub effects: Vec<OfxEffectSpec>,
    pub output: String,
}

fn default_fps() -> f64 {
    30.0
}

fn write_png_file(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[f32],
) -> Result<(), String> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(format!(
            "PNG 像素数量不匹配：期望 {expected}，实际 {}",
            rgba.len()
        ));
    }
    let file = std::fs::File::create(path)
        .map_err(|error| format!("创建 PNG 失败：{error}"))?;
    let mut encoder = png::Encoder::new(file, width, height);
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
    Ok(())
}

/// Bake a still image through an OFX chain.  Images have no timeline of their
/// own, so the effect runs once at `time` and the result is cached as a PNG
/// that the preview can keep showing during playback.
#[tauri::command]
pub async fn ofx_bake_image<R: Runtime>(
    app: AppHandle<R>,
    request: OfxBakeImageRequest,
) -> Result<String, String> {
    if request.width == 0 || request.height == 0 {
        return Err("图片烘焙尺寸必须大于 0".into());
    }
    let total = 1u64;
    let _ = app.emit(
        EVENT_OFX_BAKE,
        OfxBakeProgress {
            id: request.id.clone(),
            phase: "rendering",
            done: 0,
            total,
        },
    );
    if let Some(parent) = Path::new(&request.output).parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建图片缓存目录失败：{error}"))?;
    }
    cleanup_stale_temps(&request.output);

    let fit = request.fit.as_deref().unwrap_or("contain").to_string();
    let rgba = decode_frame(
        &app,
        &request.source,
        0.0,
        request.width,
        request.height,
        true,
        &fit,
    )
    .await?;

    let effects = request.effects.clone();
    let width = request.width;
    let height = request.height;
    let time = request.time;
    let duration = request.duration;
    let fps = request.fps;
    let rendered = tauri::async_runtime::spawn_blocking(move || {
        apply_effects(
            rgba,
            &effects,
            width,
            height,
            time,
            Some(fps),
            Some(duration),
            None,
        )
    })
    .await
    .map_err(|error| format!("OFX 图片烘焙线程失败：{error}"))??;

    let temp = bake_temp_path(&request.output);
    let mut guard = TempGuard {
        path: temp.clone(),
        armed: true,
    };
    write_png_file(&temp, request.width, request.height, &rendered)?;
    let metadata =
        std::fs::metadata(&temp).map_err(|error| format!("图片缓存不存在：{error}"))?;
    if metadata.len() == 0 {
        return Err("图片缓存为空文件".into());
    }
    std::fs::rename(&temp, &request.output)
        .map_err(|error| format!("写入图片缓存失败：{error}"))?;
    guard.armed = false;
    cleanup_previous_previews(&request.output);
    let _ = app.emit(
        EVENT_OFX_BAKE,
        OfxBakeProgress {
            id: request.id,
            phase: "done",
            done: total,
            total,
        },
    );
    Ok(request.output.clone())
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

    fn transition_source() -> OfxTransitionSource {
        OfxTransitionSource {
            source: "/tmp/a.mp4".into(),
            source_in: 2.0,
            start: 5.0,
            speed: 1.0,
            asset_duration: 10.0,
            is_image: false,
        }
    }

    #[test]
    fn transition_source_allows_preroll_before_in_and_clamps_after_end() {
        let source = transition_source();
        assert!((transition_source_time(&source, 4.5) - 1.5).abs() < 1e-6);
        assert!((transition_source_time(&source, 6.0) - 3.0).abs() < 1e-6);
        assert!((transition_source_time(&source, 30.0) - 9.999).abs() < 1e-6);

        let mut fast = transition_source();
        fast.speed = 2.0;
        assert!((transition_source_time(&fast, 6.0) - 4.0).abs() < 1e-6);
    }

    #[test]
    fn transition_images_do_not_seek() {
        let mut source = transition_source();
        source.is_image = true;
        assert_eq!(transition_source_time(&source, 99.0), 0.0);
    }

    #[test]
    fn image_bake_writes_a_real_png() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frame.png");
        write_png_file(&path, 2, 1, &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0])
            .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn transition_alpha_keeps_the_union_of_both_inputs() {
        let from = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        let to = [0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        let mut out = [0.0; 8];
        merge_input_alpha(&mut out, &from, &to);
        assert_eq!(out[3], 1.0);
        assert_eq!(out[7], 0.0);
    }

    #[test]
    fn transition_encoder_uses_prores_for_export_and_h264_for_preview() {
        let export = bake_encoder_args(false, 1920, 1080, 30.0, Path::new("/tmp/out.mov"));
        assert!(export.contains(&"prores_ks".to_string()));
        let preview = bake_encoder_args(true, 1920, 1080, 30.0, Path::new("/tmp/out.mp4"));
        assert!(preview.contains(&"libx264".to_string()));
    }

    #[test]
    fn alpha_passthrough_overrides_plugin_output() {
        let source = [0.1, 0.2, 0.3, 1.0, 0.4, 0.5, 0.6, 0.5];
        let mut rendered = [1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        keep_input_alpha(&mut rendered, &source);
        assert_eq!(rendered, [1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.5]);
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxTransitionSource {
    pub source: String,
    /// Asset in-point of the clip that provides this side.
    pub source_in: f64,
    /// Timeline start of the clip that provides this side.
    pub start: f64,
    /// Clip playback speed; source time advances speed seconds per timeline second.
    #[serde(default = "one")]
    pub speed: f64,
    /// Full asset duration; used to clamp handle frames past the clip out.
    #[serde(default)]
    pub asset_duration: f64,
    #[serde(default)]
    pub is_image: bool,
}

fn transition_source_time(source: &OfxTransitionSource, timeline_time: f64) -> f64 {
    if source.is_image {
        return 0.0;
    }
    let speed = if source.speed > 0.0 { source.speed } else { 1.0 };
    let raw = source.source_in + (timeline_time - source.start) * speed;
    // Pre-roll may legitimately go before the clip's in-point (handle media).
    let min = 0.0;
    let max = if source.asset_duration > 0.0 {
        (source.asset_duration - 0.001).max(min)
    } else {
        raw.max(min)
    };
    raw.clamp(min, max)
}

/// Ask a Retimer plugin which source time it needs for an output time.
#[tauri::command]
pub async fn ofx_source_time(
    bundle: String,
    plugin: String,
    context: Option<String>,
    time: f64,
    duration: Option<f64>,
    fps: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    params: Option<Value>,
) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let values = params
            .as_ref()
            .and_then(Value::as_object)
            .map(ofx_host::params_from_json)
            .unwrap_or_default();
        let mut session = ofx_host::Session::open(
            &bundle,
            &plugin,
            context.as_deref(),
            width.unwrap_or(16).max(1),
            height.unwrap_or(16).max(1),
        )?;
        if let Some(duration) = duration {
            session.set_duration(duration);
        }
        if let Some(fps) = fps {
            session.set_frame_rate(fps);
        }
        session.source_time(time, &values)
    })
    .await
    .map_err(|error| format!("OFX SourceTime 线程失败：{error}"))?
}

/// Render one transition frame from two decoded source frames.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ofx_render_transition<R: Runtime>(
    app: AppHandle<R>,
    bundle: String,
    plugin: String,
    context: Option<String>,
    params: Option<Value>,
    from: Option<OfxTransitionSource>,
    to: Option<OfxTransitionSource>,
    timeline_time: f64,
    progress: f64,
    duration: f64,
    width: u32,
    height: u32,
    fps: Option<f64>,
    fit: Option<String>,
) -> Result<OfxFrame, String> {
    let started = std::time::Instant::now();
    let fit = fit.as_deref().unwrap_or("contain").to_string();
    let expected = (width as usize) * (height as usize) * 4;
    let from_rgba = match &from {
        Some(source) => {
            decode_frame(
                &app,
                &source.source,
                transition_source_time(source, timeline_time),
                width,
                height,
                source.is_image,
                &fit,
            )
            .await?
        }
        None => vec![0.0; expected],
    };
    let to_rgba = match &to {
        Some(source) => {
            decode_frame(
                &app,
                &source.source,
                transition_source_time(source, timeline_time),
                width,
                height,
                source.is_image,
                &fit,
            )
            .await?
        }
        None => vec![0.0; expected],
    };

    let rendered = tauri::async_runtime::spawn_blocking(move || {
        let values = params
            .as_ref()
            .and_then(Value::as_object)
            .map(ofx_host::params_from_json)
            .unwrap_or_default();
        let mut session =
            ofx_host::Session::open(&bundle, &plugin, context.as_deref(), width, height)?;
        session.set_duration(duration.max(0.001));
        if let Some(fps) = fps {
            session.set_frame_rate(fps);
        }
        let mut rendered = session.render_multi(
            timeline_time,
            &[("SourceFrom", &from_rgba), ("SourceTo", &to_rgba)],
            Some(progress),
            &values,
        )?;
        merge_input_alpha(&mut rendered, &from_rgba, &to_rgba);
        Ok::<Vec<f32>, String>(rendered)
    })
    .await
    .map_err(|error| format!("OFX 转场渲染线程失败：{error}"))??;

    Ok(OfxFrame {
        width,
        height,
        png_base64: encode_png(width, height, &rendered)?,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfxBakeTransitionRequest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub preview: bool,
    pub bundle: String,
    pub plugin: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub params: Option<Value>,
    pub from: Option<OfxTransitionSource>,
    pub to: Option<OfxTransitionSource>,
    /// Timeline time where the transition overlay starts.
    pub start: f64,
    /// Transition duration in seconds.
    pub duration: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fit: Option<String>,
    pub output: String,
}

/// Bake a transition overlay to ProRes 4444 (export) or H.264 (preview).
/// Per-frame decoding is deliberate: a transition is short and handles may
/// start before / end after the clips' normal in and out points.
#[tauri::command]
pub async fn ofx_bake_transition<R: Runtime>(
    app: AppHandle<R>,
    request: OfxBakeTransitionRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || bake_transition_blocking(&app, &request))
        .await
        .map_err(|error| format!("OFX 转场烘焙线程失败：{error}"))?
}

fn bake_transition_blocking<R: Runtime>(
    app: &AppHandle<R>,
    request: &OfxBakeTransitionRequest,
) -> Result<String, String> {
    if request.width == 0 || request.height == 0 {
        return Err("转场尺寸必须大于 0".into());
    }
    if !(request.duration > 0.0) || !(request.fps > 0.0) {
        return Err("转场时长和帧率必须大于 0".into());
    }
    clear_cancel(request.id.as_deref());
    if let Some(parent) = Path::new(&request.output).parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建转场目录失败：{error}"))?;
    }
    cleanup_stale_temps(&request.output);

    let values = request
        .params
        .as_ref()
        .and_then(Value::as_object)
        .map(ofx_host::params_from_json)
        .unwrap_or_default();
    let mut session = ofx_host::Session::open(
        &request.bundle,
        &request.plugin,
        request.context.as_deref(),
        request.width,
        request.height,
    )?;
    session.set_duration(request.duration);
    session.set_frame_rate(request.fps);

    let temp = bake_temp_path(&request.output);
    let mut guard = TempGuard {
        path: temp.clone(),
        armed: true,
    };
    let encoder_args = bake_encoder_args(
        request.preview,
        request.width,
        request.height,
        request.fps,
        &temp,
    );
    let (mut encoder_rx, mut encoder_child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("ffmpeg sidecar 不可用：{error}"))?
        .args(&encoder_args)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("启动转场编码器失败：{error}"))?;

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

    let frame_bytes = (request.width as usize) * (request.height as usize) * 4;
    let mut bytes: Vec<u8> = vec![0u8; frame_bytes];
    let fit = request.fit.as_deref().unwrap_or("contain");
    let mut failure: Option<String> = None;
    let mut written = 0u64;

    for index in 0..total_frames {
        if is_cancelled(request.id.as_deref()) {
            failure = Some("已取消".into());
            break;
        }
        let timeline_time = request.start + index as f64 / request.fps;
        let progress_value =
            ((timeline_time - request.start) / request.duration).clamp(0.0, 1.0);
        let frame_pixels = (request.width as usize) * (request.height as usize) * 4;
        let decode = |source: &OfxTransitionSource| {
            tauri::async_runtime::block_on(decode_frame(
                app,
                &source.source,
                transition_source_time(source, timeline_time),
                request.width,
                request.height,
                source.is_image,
                fit,
            ))
        };
        let from_rgba = match &request.from {
            Some(source) => match decode(source) {
                Ok(value) => value,
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            },
            None => vec![0.0; frame_pixels],
        };
        let to_rgba = match &request.to {
            Some(source) => match decode(source) {
                Ok(value) => value,
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            },
            None => vec![0.0; frame_pixels],
        };

        let mut rendered = match session.render_multi(
            timeline_time,
            &[("SourceFrom", &from_rgba), ("SourceTo", &to_rgba)],
            Some(progress_value),
            &values,
        ) {
            Ok(value) => value,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        merge_input_alpha(&mut rendered, &from_rgba, &to_rgba);
        for (dst, value) in bytes.iter_mut().zip(rendered.iter()) {
            *dst = (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
        if let Err(error) = encoder_child.write(&bytes) {
            failure = Some(format!("写入转场编码器失败：{error}"));
            break;
        }
        written += 1;
        if written % PROGRESS_STEP_FRAMES == 0 {
            progress("rendering", written);
        }
    }

    if let Some(error) = failure {
        let _ = encoder_child.kill();
        return Err(error);
    }
    drop(encoder_child);

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
            CommandEvent::Error(error) => return Err(format!("转场编码器错误：{error}")),
            _ => {}
        }
    }
    if let Some(code) = encoder_code {
        if code != 0 {
            return Err(format!(
                "转场编码失败（退出码 {code}）：{}",
                String::from_utf8_lossy(&encoder_stderr).trim()
            ));
        }
    }
    if written == 0 {
        return Err("转场没有输出任何帧".into());
    }
    let metadata =
        std::fs::metadata(&temp).map_err(|error| format!("转场结果不存在：{error}"))?;
    if metadata.len() == 0 {
        return Err("转场结果为空文件".into());
    }
    std::fs::rename(&temp, &request.output)
        .map_err(|error| format!("写入转场结果失败：{error}"))?;
    guard.armed = false;
    cleanup_previous_previews(&request.output);
    progress("done", written);
    Ok(request.output.clone())
}

fn bake_encoder_args(
    preview: bool,
    width: u32,
    height: u32,
    fps: f64,
    output: &Path,
) -> Vec<String> {
    let output = output.to_string_lossy().into_owned();
    if preview {
        vec![
            "-v".into(),
            "error".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgba".into(),
            "-s".into(),
            format!("{width}x{height}"),
            "-r".into(),
            format!("{fps}"),
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
            output,
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
            format!("{width}x{height}"),
            "-r".into(),
            format!("{fps}"),
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
            output,
        ]
    }
}
