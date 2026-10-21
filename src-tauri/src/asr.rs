//! 一键生成字幕：ffmpeg 抽取 16 kHz 单声道 → Silero VAD 切段 → sherpa-onnx 识别。
//!
//! 识别结果按标点切成字幕条目返回给前端；前端再把它们作为文字片段插进一条新轨道
//! （一次事务、可撤销）。后端不持有工程文档，保持与 AI Cut 其余架构一致。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use serde::Serialize;
use sherpa_onnx::{
    OfflineParaformerModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineSenseVoiceModelConfig, OfflineWhisperModelConfig, SileroVadModelConfig, VadModelConfig,
    VoiceActivityDetector, Wave,
};
use tauri::{AppHandle, Emitter};

use crate::media::cache_dir;
use crate::models::{self, ModelEntry, ModelFamily};
use crate::sidecar::run_sidecar;

/// ASR 进度事件名。
pub const EVENT_ASR: &str = "asr-progress";
/// 识别采样率。
const SAMPLE_RATE: i32 = 16_000;
/// VAD 窗口大小（16 kHz 下 Silero 推荐 512）。
const VAD_WINDOW: usize = 512;
/// 单条字幕的最大字符数（超过则再切）。
const MAX_CUE_CHARS: usize = 26;

/// 进度载荷。
#[derive(Debug, Clone, Serialize)]
pub struct AsrProgress {
    /// `extracting` / `detecting` / `transcribing` / `done` / `error`。
    pub state: String,
    /// 0..1。
    pub progress: f32,
    /// 一句话说明。
    pub message: Option<String>,
}

/// 一条字幕（素材内时间，秒）。
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

struct AsrRuntime {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn runtime() -> &'static AsrRuntime {
    static RUNTIME: OnceLock<AsrRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| AsrRuntime {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

/// 生成字幕。`path` 是音视频源文件；`model_id` 必须指向清单里的 ASR 模型。
#[tauri::command]
pub async fn asr_transcribe(
    app: AppHandle,
    path: String,
    model_id: String,
    language: Option<String>,
) -> Result<Vec<SubtitleCue>, String> {
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "asr" {
        return Err(format!("{} 不是语音识别模型", entry.name));
    }
    if models::installed_dir(&app, entry).is_none() {
        return Err(format!("模型尚未安装：{}", entry.name));
    }
    let vad_entry = models::by_id("silero-vad").ok_or("清单里缺少 VAD 模型")?;
    if models::installed_dir(&app, vad_entry).is_none() {
        return Err("语音检测模型尚未安装".into());
    }

    let runtime = runtime();
    if runtime.running.swap(true, Ordering::SeqCst) {
        return Err("已有字幕任务正在运行".into());
    }
    runtime.cancel.store(false, Ordering::Relaxed);

    let result = run(&app, entry, vad_entry, &path, language).await;

    runtime.running.store(false, Ordering::SeqCst);
    match &result {
        Ok(cues) => emit(
            &app,
            "done",
            1.0,
            Some(format!("已生成 {} 条字幕", cues.len())),
        ),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

/// 取消当前字幕任务。
#[tauri::command]
pub fn asr_cancel() {
    runtime().cancel.store(true, Ordering::Relaxed);
}

async fn run(
    app: &AppHandle,
    entry: &'static ModelEntry,
    vad_entry: &'static ModelEntry,
    source: &str,
    language: Option<String>,
) -> Result<Vec<SubtitleCue>, String> {
    emit(app, "extracting", 0.02, Some("正在提取音频".into()));

    let wav_path = temp_wav_path(app)?;
    if let Err(error) = extract_wav(app, source, &wav_path).await {
        let _ = std::fs::remove_file(&wav_path);
        return Err(error);
    }

    let model_dir = models::require_dir(app, entry)?;
    let vad_dir = models::require_dir(app, vad_entry)?;
    let family = entry.family;
    let language = language.unwrap_or_default();
    let cancel = &runtime().cancel;
    let thread_app = app.clone();
    let thread_wav = wav_path.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        transcribe(
            &thread_app,
            family,
            &model_dir,
            &vad_dir,
            &thread_wav,
            &language,
            cancel,
        )
    })
    .await
    .map_err(|error| error.to_string())?;

    let _ = std::fs::remove_file(&wav_path);
    result
}

fn temp_wav_path(app: &AppHandle) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(cache_dir(app)?.join(format!("asr-{stamp}.wav")))
}

async fn extract_wav(app: &AppHandle, source: &str, output: &PathBuf) -> Result<(), String> {
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        source.to_string(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        SAMPLE_RATE.to_string(),
        "-c:a".into(),
        "pcm_s16le".into(),
        output.to_string_lossy().into_owned(),
    ];
    let (code, _) = run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) || !output.is_file() {
        return Err("无法从该素材提取音频（可能没有音轨）".into());
    }
    Ok(())
}

fn transcribe(
    app: &AppHandle,
    family: ModelFamily,
    model_dir: &PathBuf,
    vad_dir: &PathBuf,
    wav_path: &PathBuf,
    language: &str,
    cancel: &AtomicBool,
) -> Result<Vec<SubtitleCue>, String> {
    let wav_name = wav_path
        .to_str()
        .ok_or_else(|| "音频路径不是 UTF-8".to_string())?;
    let wave = Wave::read(wav_name).ok_or_else(|| "读取音频失败（WAV 可能损坏）".to_string())?;
    let samples = wave.samples();
    if samples.is_empty() {
        return Err("音频为空".into());
    }

    emit(app, "detecting", 0.08, Some("正在检测语音段".into()));
    let vad_model = vad_dir.join("silero_vad_v5.onnx");
    let mut vad_config = VadModelConfig::default();
    vad_config.silero_vad = SileroVadModelConfig {
        model: Some(vad_model.to_string_lossy().into_owned()),
        threshold: 0.5,
        min_silence_duration: 0.35,
        min_speech_duration: 0.25,
        window_size: VAD_WINDOW as i32,
        max_speech_duration: 15.0,
    };
    vad_config.sample_rate = SAMPLE_RATE;
    vad_config.num_threads = 1;
    let vad = VoiceActivityDetector::create(&vad_config, 30.0)
        .ok_or_else(|| "无法创建语音检测器（VAD 模型可能损坏）".to_string())?;

    let mut segments: Vec<(f64, f64, Vec<f32>)> = Vec::new();
    let mut offset = 0usize;
    while offset < samples.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let end = (offset + VAD_WINDOW).min(samples.len());
        vad.accept_waveform(&samples[offset..end]);
        offset = end;
        drain_segments(&vad, &mut segments);
    }
    vad.flush();
    drain_segments(&vad, &mut segments);

    if segments.is_empty() {
        return Ok(Vec::new());
    }

    emit(app, "transcribing", 0.15, Some("正在识别语音".into()));
    let recognizer = create_recognizer(family, model_dir, language)?;
    let mut cues = Vec::new();
    let total = segments.len();

    for (index, (start, end, audio)) in segments.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let stream = recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE, &audio);
        recognizer.decode(&stream);
        if let Some(result) = stream.get_result() {
            let text = clean_text(&result.text);
            if !text.is_empty() {
                cues.extend(split_cues(&text, start, end));
            }
        }
        let progress = 0.15 + 0.83 * ((index + 1) as f32 / total as f32);
        emit(app, "transcribing", progress, None);
    }

    Ok(cues)
}

fn drain_segments(vad: &VoiceActivityDetector, out: &mut Vec<(f64, f64, Vec<f32>)>) {
    while let Some(segment) = vad.front() {
        let start = (segment.start().max(0) as f64) / SAMPLE_RATE as f64;
        let audio = segment.samples().to_vec();
        let end = start + audio.len() as f64 / SAMPLE_RATE as f64;
        out.push((start, end, audio));
        vad.pop();
    }
}

/// Whisper 只接受模型内置的语言码；`auto` / 空串表示自动检测。
///
/// 传非法语言码时 sherpa-onnx 会直接 `exit()`，整个应用会闪退，因此这里先做白名单归一化。
/// 列表对应 Whisper base/small 的 99 种多语言码（不含 large-v3 才有的 `yue`）。
const WHISPER_LANGUAGES: &[&str] = &[
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it",
    "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur",
    "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
    "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si",
    "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
    "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
    "ha", "ba", "jw", "su",
];

/// 非法 / `auto` → 空串（自动检测），合法语言码统一成小写。
fn whisper_language(raw: &str) -> String {
    let code = raw.trim().to_ascii_lowercase();
    if WHISPER_LANGUAGES.contains(&code.as_str()) {
        code
    } else {
        String::new()
    }
}

/// SenseVoice 支持的语言码：`auto` 之外只有这五个。
///
/// 相比 Whisper，它多了粤语（`yue`），所以不能复用上面那份白名单。
fn sense_voice_language(raw: &str) -> String {
    let code = raw.trim().to_ascii_lowercase();
    let code = match code.as_str() {
        "zh-cn" | "zh-hans" => "zh",
        "zh-hk" | "zh-yue" => "yue",
        other => other,
    };
    if matches!(code, "zh" | "en" | "ja" | "ko" | "yue") {
        code.to_string()
    } else {
        "auto".to_string()
    }
}

fn create_recognizer(
    family: ModelFamily,
    dir: &PathBuf,
    language: &str,
) -> Result<OfflineRecognizer, String> {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.num_threads = 2;
    config.model_config.debug = false;
    config.model_config.tokens = Some(
        dir.join(match family {
            ModelFamily::Whisper => {
                if dir.join("base-tokens.txt").is_file() {
                    "base-tokens.txt"
                } else {
                    "small-tokens.txt"
                }
            }
            _ => "tokens.txt",
        })
        .to_string_lossy()
        .into_owned(),
    );

    match family {
        ModelFamily::Whisper => {
            let decoder = if dir.join("base-decoder.int8.onnx").is_file() {
                "base-decoder.int8.onnx"
            } else {
                "small-decoder.int8.onnx"
            };
            let encoder = if dir.join("base-encoder.int8.onnx").is_file() {
                "base-encoder.int8.onnx"
            } else {
                "small-encoder.int8.onnx"
            };
            config.model_config.whisper = OfflineWhisperModelConfig {
                encoder: Some(dir.join(encoder).to_string_lossy().into_owned()),
                decoder: Some(dir.join(decoder).to_string_lossy().into_owned()),
                language: Some(whisper_language(language)),
                task: Some("transcribe".into()),
                tail_paddings: 0,
                enable_token_timestamps: false,
                enable_segment_timestamps: true,
            };
        }
        ModelFamily::SenseVoice => {
            // `use_itn` 同时打开数字归一化与标点，正是字幕需要的形态。
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: Some(
                    dir.join("model.int8.onnx")
                        .to_string_lossy()
                        .into_owned(),
                ),
                language: Some(sense_voice_language(language)),
                use_itn: true,
            };
        }
        ModelFamily::Paraformer => {
            config.model_config.paraformer = OfflineParaformerModelConfig {
                model: Some(
                    dir.join("model.int8.onnx")
                        .to_string_lossy()
                        .into_owned(),
                ),
            };
        }
        ModelFamily::Vad => return Err("VAD 模型不能用于识别".into()),
        ModelFamily::MossTtsNano | ModelFamily::MossAudioTokenizerNano => {
            return Err("朗读模型不能用于语音识别".into())
        }
        ModelFamily::ZipVoice => return Err("ZipVoice 模型不能用于语音识别".into()),
        ModelFamily::LocalVqe
        | ModelFamily::Htdemucs
        | ModelFamily::Htdemucs6s
        | ModelFamily::Uvr => return Err("音频处理模型不能用于语音识别".into()),
        ModelFamily::Rife
        | ModelFamily::RealEsrganGeneral
        | ModelFamily::RealEsrganX4plus
        | ModelFamily::YoloxNano
        | ModelFamily::Yunet => return Err("视频模型不能用于语音识别".into()),
    }

    OfflineRecognizer::create(&config).ok_or_else(|| "无法创建语音识别器".into())
}

fn clean_text(text: &str) -> String {
    let raw = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = String::with_capacity(raw.len());
    let mut previous: Option<char> = None;
    let chars: Vec<char> = raw.chars().collect();
    for (index, &ch) in chars.iter().enumerate() {
        if ch == ' ' {
            let next = chars.get(index + 1).copied();
            let left = previous.map(is_cjk_context).unwrap_or(false);
            let right = next.map(is_cjk_context).unwrap_or(false);
            if left && right {
                continue;
            }
        }
        out.push(ch);
        previous = Some(ch);
    }
    out.trim().to_string()
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0x3040..=0x30FF | 0xAC00..=0xD7AF
    )
}

fn is_cjk_context(ch: char) -> bool {
    is_cjk(ch)
        || matches!(
            ch,
            '，' | '。' | '！' | '？' | '；' | '：' | '、' | '（' | '）' | '《' | '》' | '“'
                | '”' | '‘' | '’' | '…' | '—'
        )
}

/// 把一段识别文本按标点切成字幕条目，并按字符数分配时间。
fn split_cues(text: &str, start: f64, end: f64) -> Vec<SubtitleCue> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '；' | '!' | '?' | ';' | '…') {
            let chunk = current.trim();
            if !chunk.is_empty() {
                chunks.push(chunk.to_string());
            }
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    let mut pieces: Vec<String> = Vec::new();
    for chunk in chunks {
        split_long(&chunk, &mut pieces);
    }
    if pieces.is_empty() {
        return Vec::new();
    }

    let total_chars: usize = pieces.iter().map(|piece| piece.chars().count().max(1)).sum();
    let span = (end - start).max(0.2);
    let mut cursor = start;
    let mut cues = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        let ratio = piece.chars().count() as f64 / total_chars as f64;
        let cue_end = if index + 1 == pieces.len() {
            end
        } else {
            (cursor + span * ratio).min(end)
        };
        if cue_end - cursor >= 0.12 {
            cues.push(SubtitleCue {
                start: round(cursor),
                end: round(cue_end),
                text: piece.clone(),
            });
        }
        cursor = cue_end;
    }
    cues
}

fn split_long(text: &str, out: &mut Vec<String>) {
    if text.chars().count() <= MAX_CUE_CHARS {
        out.push(text.to_string());
        return;
    }
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        let should_break = matches!(ch, '，' | ',' | '、' | ' ')
            && current.chars().count() >= MAX_CUE_CHARS / 2;
        if should_break || current.chars().count() >= MAX_CUE_CHARS {
            let piece = current.trim();
            if !piece.is_empty() {
                out.push(piece.to_string());
            }
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
}

fn round(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn emit(app: &AppHandle, state: &str, progress: f32, message: Option<String>) {
    let _ = app.emit(
        EVENT_ASR,
        AsrProgress {
            state: state.to_string(),
            progress: progress.clamp(0.0, 1.0),
            message,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_chinese_punctuation() {
        let cues = split_cues("你好。世界！再见", 0.0, 3.0);
        assert_eq!(cues.len(), 3);
        assert_eq!(cues[0].text, "你好。");
        assert_eq!(cues[1].text, "世界！");
        assert_eq!(cues[2].text, "再见");
        assert!(cues[0].start <= cues[0].end);
        assert!(cues[2].end <= 3.0);
    }

    #[test]
    fn splits_long_text_into_bounded_pieces() {
        let text = "这是一段没有任何标点但是非常非常长的字幕文本用于测试自动切分逻辑是否可靠";
        let mut pieces = Vec::new();
        split_long(text, &mut pieces);
        assert!(pieces.len() > 1);
        for piece in pieces {
            assert!(piece.chars().count() <= MAX_CUE_CHARS);
        }
    }

    #[test]
    fn empty_text_produces_no_cues() {
        assert!(split_cues("   ", 0.0, 1.0).is_empty());
    }

    #[test]
    fn removes_spaces_between_han_characters_but_keeps_latin_words() {
        assert_eq!(clean_text("你 好 ， 世 界"), "你好，世界");
        assert_eq!(clean_text("hello world 你 好"), "hello world 你好");
    }

    #[test]
    fn normalizes_sense_voice_language_codes() {
        // 未知 / 空串一律走自动检测，不能把非法码交给 sherpa-onnx。
        assert_eq!(sense_voice_language("auto"), "auto");
        assert_eq!(sense_voice_language(""), "auto");
        assert_eq!(sense_voice_language("klingon"), "auto");
        // 粤语是 SenseVoice 相对 Whisper 多出来的能力。
        assert_eq!(sense_voice_language("yue"), "yue");
        assert_eq!(sense_voice_language("zh-hk"), "yue");
        assert_eq!(sense_voice_language(" JA "), "ja");
        assert_eq!(sense_voice_language("zh-CN"), "zh");
    }

    #[test]
    fn normalizes_whisper_language_codes() {
        assert_eq!(whisper_language("auto"), "");
        assert_eq!(whisper_language(""), "");
        assert_eq!(whisper_language("ZH"), "zh");
        assert_eq!(whisper_language(" en "), "en");
        // 非法 / 带地区的码退回自动检测，避免 sherpa-onnx 直接退出进程。
        assert_eq!(whisper_language("zh-CN"), "");
        assert_eq!(whisper_language("klingon"), "");
        // base/small 的语言表里没有粤语码，不能直接传给 sherpa-onnx。
        assert_eq!(whisper_language("yue"), "");
    }
}
