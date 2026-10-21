//! 音频 AI 与 DSP：LocalVQE 降噪、HTDemucs 音源分离、EBU R128 响度测量、
//! ffmpeg 快速降噪 / 人声美化，以及基于现有 ASR + LLM + TTS 的翻译管线。
//!
//! 推理统一走 `ort`（复用 sherpa-onnx 静态链接的 ONNX Runtime），不引入第二套运行时。
//! 所有命令都只处理「片段区间」：前端传入源文件 + 入点 + 时长，后端输出 48 kHz 立体声
//! WAV 到缓存目录，再由前端作为新素材落回时间线。

pub mod demucs;
pub mod demucs6s;
pub mod localvqe;
pub mod resample;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use ebur128::{EbuR128, Mode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::agent::openai::normalize_base;
use crate::agent::AgentState;
use crate::media::cache_dir;
use crate::models::{self, ModelFamily};
use crate::network::NetworkRuntime;
use crate::sidecar::run_sidecar;

/// 音频 AI 进度事件名。
pub const EVENT_AUDIO_AI: &str = "audio-ai-progress";

/// LocalVQE 权重文件名。
pub const LOCALVQE_FILE: &str = "localvqe-ns.onnx";
/// HTDemucs 4 分轨权重文件名。
pub const HTDEMUCS_FILE: &str = "htdemucs.ort";
/// HTDemucs 6 分轨权重文件名。
pub const HTDEMUCS_6S_FILE: &str = "htdemucs_6s.onnx";

/// 处理后统一输出的采样率与声道数（与导出链路一致）。
const OUT_SAMPLE_RATE: u32 = 48_000;
const OUT_CHANNELS: u16 = 2;

/// 进度回调：参数为 0.0..=1.0；返回 `false` 表示取消。
pub type Progress<'a> = &'a dyn Fn(f32) -> bool;

/// 一次音源分离的结果：按模型输出顺序的 `(stem 名, 交错样本)`。
#[derive(Debug, Clone, Default)]
pub struct Stems {
    pub stems: Vec<(&'static str, Vec<f32>)>,
}

/// 把模型采样率下的交错 L/R 分轨重采样回源采样率，并按 `channels` 拼装。
pub(crate) fn finish_stem(
    interleaved: &[f32],
    channels: usize,
    sample_rate: f64,
    target_frames: usize,
) -> Vec<f32> {
    let n = interleaved.len() / 2;
    let mut l = Vec::with_capacity(n);
    let mut r = Vec::with_capacity(n);
    for i in 0..n {
        l.push(interleaved[2 * i]);
        r.push(interleaved[2 * i + 1]);
    }
    let l = resample::resample(&l, 44_100.0, sample_rate);
    let r = resample::resample(&r, 44_100.0, sample_rate);
    let frames = l.len().min(r.len()).min(target_frames);
    let mut out = vec![0.0f32; target_frames * channels];
    if channels == 1 {
        for i in 0..frames {
            out[i] = 0.5 * (l[i] + r[i]);
        }
    } else {
        for i in 0..frames {
            out[i * channels] = l[i];
            if channels >= 2 {
                out[i * channels + 1] = r[i];
            }
        }
    }
    out
}

/// 交错多声道 → 按声道拆分（UVR C API 需要这种布局）。
fn deinterleave(samples: &[f32], channels: usize) -> Vec<Vec<f32>> {
    let channels = channels.max(1);
    let frames = samples.len() / channels;
    let mut out = vec![Vec::with_capacity(frames); channels];
    for frame in 0..frames {
        for (channel, data) in out.iter_mut().enumerate() {
            data.push(samples[frame * channels + channel]);
        }
    }
    out
}

/// 把 UVR 输出的按声道分轨重采样回 48 kHz，再交错成项目使用的布局。
fn interleave_resampled(
    stem: &sherpa_separation::SeparatedStem,
    from_rate: i32,
    to_rate: f64,
    channels: usize,
) -> Vec<f32> {
    let channels = channels.max(1);
    let mut resampled: Vec<Vec<f32>> = stem
        .channels
        .iter()
        .map(|channel| {
            if from_rate > 0 && (from_rate as f64 - to_rate).abs() > 1e-6 {
                resample::resample(channel, from_rate as f64, to_rate)
            } else {
                channel.clone()
            }
        })
        .collect();
    if resampled.is_empty() {
        return Vec::new();
    }
    if resampled.len() == 1 && channels > 1 {
        let mono = resampled[0].clone();
        resampled = (0..channels).map(|_| mono.clone()).collect();
    }
    let frames = resampled
        .iter()
        .map(|channel| channel.len())
        .min()
        .unwrap_or(0);
    let mut out = vec![0.0f32; frames * channels];
    for frame in 0..frames {
        for channel in 0..channels {
            out[frame * channels + channel] = resampled
                .get(channel)
                .and_then(|data| data.get(frame))
                .copied()
                .unwrap_or(0.0);
        }
    }
    out
}

/// 周期性 Hann 窗（分母用 `n`）。
pub(crate) fn hann(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / n as f32).cos())
        .collect()
}

pub(crate) fn err<E: std::fmt::Display>(what: &str, e: E) -> String {
    format!("{what}：{e}")
}

/// 建 ONNX 会话。`ort-backend` 把 sherpa-onnx 静态链接的 ORT C API 交给 `ort`。
pub(crate) fn build_session(path: &Path, label: &str) -> Result<ort::session::Session, String> {
    if !ort_backend::init() {
        return Err("ONNX Runtime 初始化失败".into());
    }
    ort::session::Session::builder()
        .map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?
        .commit_from_file(path)
        .map_err(|e| format!("加载{label}权重失败：{e}"))
}

// ---------------------------------------------------------------------------
// 任务状态与前后端协议
// ---------------------------------------------------------------------------

struct AudioAiRuntime {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn runtime() -> &'static AudioAiRuntime {
    static RUNTIME: OnceLock<AudioAiRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| AudioAiRuntime {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

fn begin_task() -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有音频 AI 任务正在运行".into());
    }
    runtime().cancel.store(false, Ordering::Relaxed);
    Ok(())
}

fn end_task() {
    runtime().running.store(false, Ordering::SeqCst);
}

fn cancelled() -> bool {
    runtime().cancel.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioAiProgress {
    /// `extracting` / `processing` / `writing` / `done` / `error`。
    pub state: String,
    pub progress: f32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioProcessed {
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioStem {
    pub name: String,
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoudnessReport {
    /// 积分响度（LUFS）；静音为 `None`。
    pub integrated_lufs: Option<f64>,
    /// 真峰值（dBTP）；静音为 `None`。
    pub true_peak_dbtp: Option<f64>,
}

fn emit(app: &AppHandle, state: &str, progress: f32, message: Option<String>) {
    let _ = app.emit(
        EVENT_AUDIO_AI,
        AudioAiProgress {
            state: state.to_string(),
            progress: progress.clamp(0.0, 1.0),
            message,
        },
    );
}

fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn cache_path(app: &AppHandle, tag: &str, ext: &str) -> Result<PathBuf, String> {
    Ok(cache_dir(app)?.join(format!("audio-ai-{tag}-{}.{ext}", stamp())))
}

// ---------------------------------------------------------------------------
// 解码 / 写盘
// ---------------------------------------------------------------------------

/// 把源文件的某个区间解成 48 kHz 立体声交错 `f32`。
async fn decode_segment(
    app: &AppHandle,
    path: &str,
    start: f64,
    duration: f64,
) -> Result<Vec<f32>, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    let tmp = cache_path(app, "decode", "f32")?;
    let args: Vec<String> = vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        format!("{:.6}", start.max(0.0)),
        "-i".into(),
        path.to_string(),
        "-t".into(),
        format!("{duration:.6}"),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-ac".into(),
        OUT_CHANNELS.to_string(),
        "-ar".into(),
        OUT_SAMPLE_RATE.to_string(),
        "-f".into(),
        "f32le".into(),
        "-acodec".into(),
        "pcm_f32le".into(),
        tmp.to_string_lossy().into_owned(),
    ];
    let (code, _) = run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) {
        let _ = fs::remove_file(&tmp);
        return Err("无法提取音频（该素材可能没有音轨）".into());
    }
    let bytes = fs::read(&tmp).map_err(|e| format!("读取解码结果失败：{e}"))?;
    let _ = fs::remove_file(&tmp);
    if bytes.len() < 4 || bytes.len() % 4 != 0 {
        return Err("解码结果不完整".into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// 写 16-bit PCM WAV（WebAudio / ffmpeg 都能直接读）。
fn write_wav(path: &Path, samples: &[f32], channels: u16, sample_rate: u32) -> Result<(), String> {
    let data_len = samples.len() * 2;
    if data_len > u32::MAX as usize {
        return Err("音频太长，无法写入 WAV".into());
    }
    let mut file = fs::File::create(path).map_err(|e| format!("创建 WAV 失败：{e}"))?;
    let write = |file: &mut fs::File, bytes: &[u8]| -> Result<(), String> {
        file.write_all(bytes)
            .map_err(|e| format!("写入 WAV 失败：{e}"))
    };
    write(&mut file, b"RIFF")?;
    write(&mut file, &((36 + data_len) as u32).to_le_bytes())?;
    write(&mut file, b"WAVEfmt ")?;
    write(&mut file, &16u32.to_le_bytes())?;
    write(&mut file, &1u16.to_le_bytes())?;
    write(&mut file, &channels.to_le_bytes())?;
    write(&mut file, &sample_rate.to_le_bytes())?;
    let byte_rate = sample_rate * channels as u32 * 2;
    write(&mut file, &byte_rate.to_le_bytes())?;
    write(&mut file, &(channels * 2).to_le_bytes())?;
    write(&mut file, &16u16.to_le_bytes())?;
    write(&mut file, b"data")?;
    write(&mut file, &(data_len as u32).to_le_bytes())?;
    let mut pcm = Vec::with_capacity(data_len);
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        pcm.extend_from_slice(&value.to_le_bytes());
    }
    write(&mut file, &pcm)?;
    file.flush().map_err(|e| format!("写入 WAV 失败：{e}"))?;
    Ok(())
}

async fn probe_duration(app: &AppHandle, path: &Path) -> Result<f64, String> {
    let args: Vec<String> = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        path.to_string_lossy().into_owned(),
    ];
    let (code, stdout) = run_sidecar(app, "ffprobe", &args).await?;
    if code != Some(0) {
        return Err("无法读取处理结果时长".into());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&stdout).map_err(|e| format!("ffprobe 输出解析失败：{e}"))?;
    Ok(json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0))
}

// ---------------------------------------------------------------------------
// 响度
// ---------------------------------------------------------------------------

fn measure_loudness(
    samples: &[f32],
    channels: usize,
    sample_rate: u32,
) -> Result<LoudnessReport, String> {
    if samples.is_empty() || channels == 0 {
        return Ok(LoudnessReport {
            integrated_lufs: None,
            true_peak_dbtp: None,
        });
    }
    // ebur128 按整帧接收；截掉解码可能多出的零头。
    let frames = samples.len() / channels;
    if frames == 0 {
        return Ok(LoudnessReport {
            integrated_lufs: None,
            true_peak_dbtp: None,
        });
    }
    let mut ebur = EbuR128::new(channels as u32, sample_rate, Mode::I | Mode::TRUE_PEAK)
        .map_err(|e| format!("初始化响度计失败：{e}"))?;
    ebur.add_frames_f32(&samples[..frames * channels])
        .map_err(|e| format!("响度分析失败：{e}"))?;

    let integrated = ebur.loudness_global().ok().filter(|v| v.is_finite());
    let mut peak = 0.0f64;
    for channel in 0..channels as u32 {
        if let Ok(value) = ebur.true_peak(channel) {
            peak = peak.max(value);
        }
    }
    let true_peak = if peak > 0.0 {
        Some(20.0 * peak.log10())
    } else {
        None
    };
    Ok(LoudnessReport {
        integrated_lufs: integrated,
        true_peak_dbtp: true_peak,
    })
}

/// 测量片段的积分响度与真峰值。前端据此把 `clip.gain` 设到目标响度。
#[tauri::command]
pub async fn audio_measure_loudness(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
) -> Result<LoudnessReport, String> {
    let samples = decode_segment(&app, &path, start, duration).await?;
    measure_loudness(&samples, OUT_CHANNELS as usize, OUT_SAMPLE_RATE)
}

// ---------------------------------------------------------------------------
// ffmpeg DSP（无模型）
// ---------------------------------------------------------------------------

fn dsp_filter(effect: &str, preset: &str) -> Result<&'static str, String> {
    match (effect, preset) {
        ("denoise", "light") => Ok("afftdn=nr=6:nf=-55"),
        ("denoise", "medium") => Ok("afftdn=nr=12:nf=-50"),
        ("denoise", "strong") => Ok("afftdn=nr=20:nf=-45"),
        ("beautify", "natural") => Ok(
            "highpass=f=80,equalizer=f=250:t=q:w=1:g=-1,equalizer=f=3000:t=q:w=1:g=2,\
             deesser=i=0.4,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120:makeup=2dB",
        ),
        ("beautify", "bright") => Ok(
            "highpass=f=90,equalizer=f=250:t=q:w=1:g=-1,equalizer=f=3000:t=q:w=1:g=2,\
             equalizer=f=7000:t=h:w=0.8:g=2,deesser=i=0.5,\
             acompressor=threshold=-18dB:ratio=2.5:attack=4:release=100:makeup=2.5dB",
        ),
        ("beautify", "warm") => Ok(
            "highpass=f=70,equalizer=f=200:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1:g=1.5,\
             equalizer=f=9000:t=h:w=0.8:g=-1.5,deesser=i=0.35,\
             acompressor=threshold=-18dB:ratio=2:attack=8:release=180:makeup=1.5dB",
        ),
        _ => Err(format!("未知的音频处理：{effect}/{preset}")),
    }
}

/// 无模型 DSP：快速降噪（`afftdn`）或人声美化（EQ + 去齿音 + 压缩）。
#[tauri::command]
pub async fn audio_dsp_process(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    effect: String,
    preset: String,
) -> Result<AudioProcessed, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    let filter = dsp_filter(&effect, &preset)?;
    let output = cache_path(&app, &format!("dsp-{effect}-{preset}"), "wav")?;
    let args: Vec<String> = vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        format!("{:.6}", start.max(0.0)),
        "-i".into(),
        path,
        "-t".into(),
        format!("{duration:.6}"),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-ac".into(),
        OUT_CHANNELS.to_string(),
        "-ar".into(),
        OUT_SAMPLE_RATE.to_string(),
        "-af".into(),
        filter.to_string(),
        "-c:a".into(),
        "pcm_s16le".into(),
        output.to_string_lossy().into_owned(),
    ];
    let (code, _) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) || !output.is_file() {
        let _ = fs::remove_file(&output);
        return Err("音频处理失败".into());
    }
    let duration = probe_duration(&app, &output).await?;
    Ok(AudioProcessed {
        path: output.to_string_lossy().into_owned(),
        duration,
    })
}

// ---------------------------------------------------------------------------
// 模型推理
// ---------------------------------------------------------------------------

/// LocalVQE 语音降噪 / 去混响。
#[tauri::command]
pub async fn audio_ai_denoise(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    model_id: String,
) -> Result<AudioProcessed, String> {
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "enhance" {
        return Err(format!("{} 不是音频降噪模型", entry.name));
    }
    let model_path = models::require_dir(&app, entry)?.join(LOCALVQE_FILE);

    begin_task()?;
    let result: Result<AudioProcessed, String> = async {
        emit(&app, "extracting", 0.02, Some("正在提取音频".into()));
        let samples = decode_segment(&app, &path, start, duration).await?;
        let output = cache_path(&app, "denoise", "wav")?;

        let thread_app = app.clone();
        let thread_path = model_path.clone();
        let processed = tauri::async_runtime::spawn_blocking(move || {
            let progress = |p: f32| {
                emit(&thread_app, "processing", 0.1 + p * 0.8, None);
                !cancelled()
            };
            localvqe::enhance(
                &samples,
                OUT_CHANNELS as usize,
                OUT_SAMPLE_RATE as f64,
                &thread_path,
                &progress,
            )
        })
        .await
        .map_err(|e| format!("降噪任务异常：{e}"))??;

        if cancelled() {
            return Err("已取消".into());
        }
        emit(&app, "writing", 0.95, Some("正在写入音频".into()));
        write_wav(&output, &processed, OUT_CHANNELS, OUT_SAMPLE_RATE)?;
        Ok(AudioProcessed {
            path: output.to_string_lossy().into_owned(),
            duration: processed.len() as f64 / OUT_CHANNELS as f64 / OUT_SAMPLE_RATE as f64,
        })
    }
    .await;

    end_task();
    match &result {
        Ok(_) => emit(&app, "done", 1.0, Some("降噪完成".into())),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

/// HTDemucs 音源分离（4 或 6 分轨）。
#[tauri::command]
pub async fn audio_ai_separate(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    model_id: String,
) -> Result<Vec<AudioStem>, String> {
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "separate" {
        return Err(format!("{} 不是音源分离模型", entry.name));
    }
    let family = entry.family;
    let filename = match family {
        ModelFamily::Htdemucs => HTDEMUCS_FILE,
        ModelFamily::Htdemucs6s => HTDEMUCS_6S_FILE,
        // UVR 的两个模型文件名不同，直接取清单里的文件名。
        ModelFamily::Uvr => entry
            .files
            .first()
            .map(|file| file.filename)
            .ok_or_else(|| "UVR 模型缺少权重文件".to_string())?,
        _ => return Err(format!("{} 不是支持的分离模型", entry.name)),
    };
    let model_path = models::require_dir(&app, entry)?.join(filename);

    begin_task()?;
    let result: Result<Vec<AudioStem>, String> = async {
        emit(&app, "extracting", 0.02, Some("正在提取音频".into()));
        let samples = decode_segment(&app, &path, start, duration).await?;

        let thread_app = app.clone();
        let thread_path = model_path.clone();
        let stems = tauri::async_runtime::spawn_blocking(move || {
            let progress = |p: f32| {
                emit(&thread_app, "processing", 0.08 + p * 0.85, None);
                !cancelled()
            };
            match family {
                ModelFamily::Htdemucs => demucs::separate(
                    &samples,
                    OUT_CHANNELS as usize,
                    OUT_SAMPLE_RATE as f64,
                    &thread_path,
                    &progress,
                ),
                ModelFamily::Htdemucs6s => demucs6s::separate(
                    &samples,
                    OUT_CHANNELS as usize,
                    OUT_SAMPLE_RATE as f64,
                    &thread_path,
                    &progress,
                ),
                // UVR 的 C API 是一次性调用，没有逐窗进度；解成按声道后交给
                // sherpa-onnx 的静态库（内部会重采样到模型采样率）。
                ModelFamily::Uvr => {
                    let _ = progress(0.0);
                    let channels = deinterleave(&samples, OUT_CHANNELS as usize);
                    let path = thread_path.to_string_lossy().into_owned();
                    let separated =
                        sherpa_separation::separate_uvr(&path, &channels, OUT_SAMPLE_RATE as i32)?;
                    let _ = progress(0.95);
                    let mut stems = Vec::with_capacity(separated.stems.len());
                    for (index, stem) in separated.stems.iter().enumerate() {
                        let name = if index == 0 {
                            "vocals"
                        } else {
                            "accompaniment"
                        };
                        stems.push((
                            name,
                            interleave_resampled(
                                stem,
                                separated.sample_rate,
                                OUT_SAMPLE_RATE as f64,
                                OUT_CHANNELS as usize,
                            ),
                        ));
                    }
                    Ok(Stems { stems })
                }
                _ => Err("不支持的分离模型".into()),
            }
        })
        .await
        .map_err(|e| format!("分离任务异常：{e}"))??;

        if cancelled() {
            return Err("已取消".into());
        }
        if stems.stems.is_empty() {
            return Err("分离没有产出分轨".into());
        }

        emit(&app, "writing", 0.95, Some("正在写入分轨".into()));
        let mut results = Vec::with_capacity(stems.stems.len());
        for (name, samples) in stems.stems {
            let output = cache_path(&app, &format!("stem-{name}"), "wav")?;
            write_wav(&output, &samples, OUT_CHANNELS, OUT_SAMPLE_RATE)?;
            results.push(AudioStem {
                name: name.to_string(),
                path: output.to_string_lossy().into_owned(),
                duration: samples.len() as f64 / OUT_CHANNELS as f64 / OUT_SAMPLE_RATE as f64,
            });
        }
        Ok(results)
    }
    .await;

    end_task();
    match &result {
        Ok(_) => emit(&app, "done", 1.0, Some("分离完成".into())),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

/// 抽取片段的一小段音频作为参考音色（ZipVoice 用，最多 10 秒）。
#[tauri::command]
pub async fn audio_extract_reference(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
) -> Result<AudioProcessed, String> {
    let seconds = duration.clamp(0.1, 10.0);
    let samples = decode_segment(&app, &path, start, seconds).await?;
    let output = cache_path(&app, "reference", "wav")?;
    write_wav(&output, &samples, OUT_CHANNELS, OUT_SAMPLE_RATE)?;
    Ok(AudioProcessed {
        path: output.to_string_lossy().into_owned(),
        duration: samples.len() as f64 / OUT_CHANNELS as f64 / OUT_SAMPLE_RATE as f64,
    })
}

/// 取消当前音频 AI 任务。
#[tauri::command]
pub fn audio_ai_cancel() {
    runtime().cancel.store(true, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// 翻译（复用现有 OpenAI 兼容端点）
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

fn strip_code_fence(text: &str) -> String {
    let trimmed = text.trim();
    let without = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    without
        .strip_suffix("```")
        .unwrap_or(without)
        .trim()
        .to_string()
}

/// 把一组字幕行翻译成目标语言，返回与输入等长、同序的数组。
#[tauri::command]
pub async fn translate_text(
    state: State<'_, Arc<AgentState>>,
    network: State<'_, Arc<NetworkRuntime>>,
    texts: Vec<String>,
    target: String,
) -> Result<Vec<String>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let config = state.config();
    if !config.is_configured() {
        return Err("尚未配置 AI 端点：请先在设置里填写 Base URL、API Key 与模型".into());
    }
    let target = target.trim();
    if target.is_empty() {
        return Err("目标语言不能为空".into());
    }

    let client = network.client()?;
    let url = format!("{}/chat/completions", normalize_base(&config.base_url));
    let mut output = Vec::with_capacity(texts.len());

    for chunk in texts.chunks(20) {
        let payload = serde_json::to_string(chunk).map_err(|e| e.to_string())?;
        let body = serde_json::json!({
            "model": config.model,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": format!(
                        "You are a professional audiovisual translator. Translate every subtitle line into {target}. \
                         Keep the meaning, tone and spoken style natural. Return ONLY a JSON array of strings with \
                         exactly the same length and order as the input. Do not add explanations or markdown."
                    )
                },
                { "role": "user", "content": payload }
            ]
        });
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .json(&body)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("翻译请求失败：{e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(format!("翻译接口返回 {status}：{detail}"));
        }
        let parsed: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("翻译接口响应解析失败：{e}"))?;
        let content = parsed
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or("翻译接口没有返回内容")?;
        let cleaned = strip_code_fence(&content);
        let translated: Vec<String> = serde_json::from_str(&cleaned)
            .map_err(|e| format!("翻译结果不是字符串数组：{e}；原始输出：{cleaned}"))?;
        if translated.len() != chunk.len() {
            return Err(format!(
                "翻译结果数量不符（期望 {}，实际 {}）",
                chunk.len(),
                translated.len()
            ));
        }
        output.extend(translated);
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frames: usize, amplitude: f32) -> Vec<f32> {
        let mut out = Vec::with_capacity(frames * 2);
        for index in 0..frames {
            let value = (std::f32::consts::TAU * 1000.0 * index as f32 / OUT_SAMPLE_RATE as f32)
                .sin()
                * amplitude;
            out.push(value);
            out.push(value);
        }
        out
    }

    #[test]
    fn silence_has_no_loudness_or_peak() {
        let report = measure_loudness(&[0.0; 4800], 2, OUT_SAMPLE_RATE).expect("测量应成功");
        assert!(report.integrated_lufs.is_none());
        assert!(report.true_peak_dbtp.is_none());
    }

    #[test]
    fn a_sine_has_finite_loudness_and_peak() {
        let samples = sine(OUT_SAMPLE_RATE as usize, 0.5);
        let report = measure_loudness(&samples, 2, OUT_SAMPLE_RATE).expect("测量应成功");
        let lufs = report.integrated_lufs.expect("应有积分响度");
        let peak = report.true_peak_dbtp.expect("应有真峰值");
        assert!(lufs.is_finite() && lufs < 0.0, "lufs={lufs}");
        assert!(peak.is_finite() && peak > -12.0, "peak={peak}");
    }

    #[test]
    fn deinterleave_and_interleave_round_trip() {
        let interleaved = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let channels = deinterleave(&interleaved, 2);
        assert_eq!(channels, vec![vec![0.1, 0.3, 0.5], vec![0.2, 0.4, 0.6]]);

        let stem = sherpa_separation::SeparatedStem { channels };
        let back = interleave_resampled(
            &stem,
            OUT_SAMPLE_RATE as i32,
            OUT_SAMPLE_RATE as f64,
            OUT_CHANNELS as usize,
        );
        assert_eq!(back, interleaved);
    }

    #[test]
    fn mono_stem_is_duplicated_to_stereo() {
        let stem = sherpa_separation::SeparatedStem {
            channels: vec![vec![0.1, 0.2]],
        };
        let out = interleave_resampled(
            &stem,
            OUT_SAMPLE_RATE as i32,
            OUT_SAMPLE_RATE as f64,
            OUT_CHANNELS as usize,
        );
        assert_eq!(out, vec![0.1, 0.1, 0.2, 0.2]);
    }

    #[test]
    fn dsp_presets_are_known() {
        for preset in ["light", "medium", "strong"] {
            assert!(dsp_filter("denoise", preset).is_ok(), "{preset}");
        }
        for preset in ["natural", "bright", "warm"] {
            assert!(dsp_filter("beautify", preset).is_ok(), "{preset}");
        }
        assert!(dsp_filter("unknown", "natural").is_err());
    }

    #[test]
    fn wav_header_is_well_formed() {
        let path = std::env::temp_dir().join(format!("ai-cut-wav-{}.wav", std::process::id()));
        let samples = sine(100, 0.5);
        write_wav(&path, &samples, OUT_CHANNELS, OUT_SAMPLE_RATE).expect("写 WAV 应成功");
        let bytes = std::fs::read(&path).expect("读回 WAV");
        let _ = std::fs::remove_file(&path);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(
            bytes.len(),
            44 + samples.len() * 2,
            "16-bit PCM 数据长度应匹配"
        );
    }
}
