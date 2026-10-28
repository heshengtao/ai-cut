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

/// 一个带素材内时间的词。剪口播只认这一层，字幕仍按 [`SubtitleCue`] 走。
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// 一次「剪口播」用的转录结果。
#[derive(Debug, Clone, Serialize)]
pub struct Transcription {
    pub words: Vec<TranscriptWord>,
    /// 词时间是否来自识别模型的 token 时间戳；`false` 表示按字数估算，只能做粗剪。
    pub timed: bool,
}

/// 识别结果：字幕与词时间同源，避免跑两遍模型。
struct Transcript {
    cues: Vec<SubtitleCue>,
    words: Vec<TranscriptWord>,
    timed: bool,
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
    let result = transcribe_file(&app, &path, &model_id, language, false).await;
    match &result {
        Ok(transcript) => emit(
            &app,
            "done",
            1.0,
            Some(format!("已生成 {} 条字幕", transcript.cues.len())),
        ),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result.map(|transcript| transcript.cues)
}

/// 转写每个词的素材内时间，供「剪口播」检测口癖与停顿。
///
/// 与 [`asr_transcribe`] 共用同一把运行锁：两个功能不会同时占用识别模型。
#[tauri::command]
pub async fn asr_transcribe_words(
    app: AppHandle,
    path: String,
    model_id: String,
    language: Option<String>,
) -> Result<Transcription, String> {
    let result = transcribe_file(&app, &path, &model_id, language, true).await;
    match &result {
        Ok(transcript) => emit(
            &app,
            "done",
            1.0,
            Some(format!("已识别 {} 个词", transcript.words.len())),
        ),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result.map(|transcript| Transcription {
        words: transcript.words,
        timed: transcript.timed,
    })
}

async fn transcribe_file(
    app: &AppHandle,
    path: &str,
    model_id: &str,
    language: Option<String>,
    want_words: bool,
) -> Result<Transcript, String> {
    let entry = models::by_id(model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "asr" {
        return Err(format!("{} 不是语音识别模型", entry.name));
    }
    if models::installed_dir(app, entry).is_none() {
        return Err(format!("模型尚未安装：{}", entry.name));
    }
    let vad_entry = models::by_id("silero-vad").ok_or("清单里缺少 VAD 模型")?;
    if models::installed_dir(app, vad_entry).is_none() {
        return Err("语音检测模型尚未安装".into());
    }

    let runtime = runtime();
    if runtime.running.swap(true, Ordering::SeqCst) {
        return Err("已有字幕任务正在运行".into());
    }
    runtime.cancel.store(false, Ordering::Relaxed);

    let result = run(app, entry, vad_entry, path, language, want_words).await;
    runtime.running.store(false, Ordering::SeqCst);
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
    want_words: bool,
) -> Result<Transcript, String> {
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
            want_words,
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
    want_words: bool,
) -> Result<Transcript, String> {
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
        return Ok(Transcript {
            cues: Vec::new(),
            words: Vec::new(),
            timed: false,
        });
    }

    emit(app, "transcribing", 0.15, Some("正在识别语音".into()));
    // 只有 Whisper 需要显式打开 token 时间戳；Paraformer 的结果自带时间戳。
    // 生成字幕时不打开：那条路径保持「按标点切句」的原有形态，避免字幕回归。
    let want_timestamps = want_words && matches!(family, ModelFamily::Whisper);
    let recognizer = create_recognizer(family, model_dir, language, want_timestamps)?;
    let mut cues = Vec::new();
    let mut words: Vec<TranscriptWord> = Vec::new();
    let mut timed = false;
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
                let mut handled = false;
                if want_words {
                    let segment_words = word_times(&result, &text, start, end);
                    if segment_words.aligned {
                        timed = true;
                    }
                    if !segment_words.words.is_empty() {
                        cues.extend(cues_from_words(&segment_words.words));
                        words.extend(segment_words.words);
                        handled = true;
                    }
                }
                if !handled {
                    cues.extend(split_cues(&text, start, end));
                }
            }
        }
        let progress = 0.15 + 0.83 * ((index + 1) as f32 / total as f32);
        emit(app, "transcribing", progress, None);
    }

    Ok(Transcript { cues, words, timed })
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

/// 一个识别段里的词时间：优先用模型给的 token 时间戳，没有就按字数估算。
struct WordTimes {
    words: Vec<TranscriptWord>,
    /// 是否真的用了模型时间戳（估算的词只能做粗剪）。
    aligned: bool,
}

fn word_times(
    result: &sherpa_onnx::OfflineRecognizerResult,
    text: &str,
    segment_start: f64,
    segment_end: f64,
) -> WordTimes {
    if let Some(stamps) = result.timestamps.as_ref() {
        let words = words_from_tokens(&result.tokens, stamps, segment_start, segment_end);
        if !words.is_empty() {
            return WordTimes {
                words,
                aligned: true,
            };
        }
    }
    WordTimes {
        words: estimate_words(text, segment_start, segment_end),
        aligned: false,
    }
}

/// 模型 token（中文逐字、英文 BPE）→ 词。
///
/// 时间戳是 token 的起点（相对本段音频），词的结束时间取下一个词的起点，末词收在段尾。
fn words_from_tokens(
    tokens: &[String],
    stamps: &[f32],
    segment_start: f64,
    segment_end: f64,
) -> Vec<TranscriptWord> {
    let count = tokens.len().min(stamps.len());
    let mut starts: Vec<(String, f64)> = Vec::new();
    for index in 0..count {
        let raw = tokens[index].as_str();
        if raw.is_empty() || raw.starts_with('<') || raw.starts_with('[') {
            continue;
        }
        let when = segment_start + stamps[index] as f64;
        let piece = raw.strip_prefix('▁').unwrap_or(raw);
        if piece.trim().is_empty() {
            continue;
        }
        let begins_word = raw.starts_with('▁');
        // 中文 token 一律独立成词；拉丁 BPE 的后续片段与标点贴到前一个词。
        let cjk = piece.chars().all(is_cjk);
        match starts.last_mut() {
            Some(last) if !cjk && !begins_word => {
                last.0.push_str(piece);
            }
            _ => starts.push((piece.to_string(), when)),
        }
    }

    let mut words = Vec::with_capacity(starts.len());
    for index in 0..starts.len() {
        let (text, start) = (starts[index].0.clone(), starts[index].1);
        let end = starts
            .get(index + 1)
            .map_or(segment_end, |next| next.1)
            .max(start + 0.02);
        words.push(TranscriptWord {
            text,
            start: round(start),
            end: round(end.min(segment_end.max(start + 0.02))),
        });
    }
    words
}

/// 没有 token 时间戳时按字符数把段时长分给每个词。
fn estimate_words(text: &str, start: f64, end: f64) -> Vec<TranscriptWord> {
    let pieces = word_pieces(text);
    if pieces.is_empty() {
        return Vec::new();
    }
    let weights: Vec<f64> = pieces
        .iter()
        .map(|piece| piece.chars().count().max(1) as f64)
        .collect();
    let total: f64 = weights.iter().sum();
    let span = (end - start).max(0.2);
    let mut cursor = start;
    let mut consumed = 0.0;
    let mut words = Vec::with_capacity(pieces.len());
    for (index, (piece, weight)) in pieces.iter().zip(&weights).enumerate() {
        consumed += weight;
        let word_end = if index + 1 == weights.len() {
            end
        } else {
            (start + span * consumed / total).min(end)
        };
        words.push(TranscriptWord {
            text: piece.clone(),
            start: round(cursor),
            end: round(word_end.max(cursor + 0.02)),
        });
        cursor = word_end;
    }
    words
}

/// 把一段文本切成词：中文逐字、英文按空白与标点、标点贴前一个词。
fn word_pieces(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let flush = |current: &mut String, out: &mut Vec<String>| {
        let trimmed = current.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
        current.clear();
    };
    for ch in text.chars() {
        if is_cjk(ch) {
            flush(&mut current, &mut out);
            out.push(ch.to_string());
        } else if ch.is_whitespace() {
            flush(&mut current, &mut out);
        } else if is_punct(ch) {
            if !current.is_empty() {
                current.push(ch);
            } else if let Some(last) = out.last_mut() {
                last.push(ch);
            } else {
                current.push(ch);
            }
        } else {
            current.push(ch);
        }
    }
    flush(&mut current, &mut out);
    out
}

/// 有词时间后按停顿与长度切字幕，不再按字符比例硬分。
fn cues_from_words(words: &[TranscriptWord]) -> Vec<SubtitleCue> {
    let mut cues: Vec<SubtitleCue> = Vec::new();
    let mut start: Option<f64> = None;
    let mut text = String::new();
    let mut last_end = 0.0;
    for word in words {
        let gap = start.is_some() && (word.start - last_end) > 0.6;
        let too_long = text.chars().count() >= MAX_CUE_CHARS;
        if start.is_some() && (gap || too_long) {
            cues.push(SubtitleCue {
                start: round(start.unwrap_or(last_end)),
                end: round(last_end),
                text: text.trim().to_string(),
            });
            text.clear();
            start = None;
        }
        if start.is_none() {
            start = Some(word.start);
        }
        text.push_str(&word.text);
        last_end = word.end;
        if ends_sentence(&word.text) {
            cues.push(SubtitleCue {
                start: round(start.unwrap_or(word.start)),
                end: round(word.end),
                text: text.trim().to_string(),
            });
            text.clear();
            start = None;
        }
    }
    if let Some(begin) = start {
        if !text.trim().is_empty() {
            cues.push(SubtitleCue {
                start: round(begin),
                end: round(last_end.max(begin + 0.1)),
                text: text.trim().to_string(),
            });
        }
    }
    cues
}

fn is_punct(ch: char) -> bool {
    matches!(
        ch,
        '，' | '。'
            | '！'
            | '？'
            | '；'
            | '：'
            | '、'
            | '（'
            | '）'
            | '《'
            | '》'
            | '“'
            | '”'
            | '‘'
            | '’'
            | '…'
            | '—'
            | ','
            | '.'
            | '!'
            | '?'
            | ';'
            | ':'
            | '"'
            | '\''
            | '('
            | ')'
    )
}

fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(['”', '’', '"', '\'', '」', '』'])
        .chars()
        .last()
        .is_some_and(|ch| matches!(ch, '。' | '！' | '？' | '.' | '!' | '?' | '…' | ';' | '；'))
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
    want_token_timestamps: bool,
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
                enable_token_timestamps: want_token_timestamps,
                enable_segment_timestamps: true,
            };
        }
        ModelFamily::SenseVoice => {
            // `use_itn` 同时打开数字归一化与标点，正是字幕需要的形态。
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: Some(dir.join("model.int8.onnx").to_string_lossy().into_owned()),
                language: Some(sense_voice_language(language)),
                use_itn: true,
            };
        }
        ModelFamily::Paraformer => {
            config.model_config.paraformer = OfflineParaformerModelConfig {
                model: Some(dir.join("model.int8.onnx").to_string_lossy().into_owned()),
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
            '，' | '。'
                | '！'
                | '？'
                | '；'
                | '：'
                | '、'
                | '（'
                | '）'
                | '《'
                | '》'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '…'
                | '—'
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

    let total_chars: usize = pieces
        .iter()
        .map(|piece| piece.chars().count().max(1))
        .sum();
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
        let should_break =
            matches!(ch, '，' | ',' | '、' | ' ') && current.chars().count() >= MAX_CUE_CHARS / 2;
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

#[cfg(test)]
mod word_tests {
    use super::*;

    fn tokens(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn chinese_tokens_become_one_word_per_character() {
        let words = words_from_tokens(&tokens(&["你", "好", "世", "界"]), &[0.0, 0.2, 0.5, 0.9], 1.0, 2.0);
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "你");
        assert_eq!(words[0].start, 1.0);
        assert_eq!(words[0].end, 1.2);
        assert_eq!(words[3].end, 2.0);
    }

    #[test]
    fn latin_bpe_pieces_are_glued_into_words() {
        let words = words_from_tokens(
            &tokens(&["▁HEL", "LO", "▁WORLD"]),
            &[0.0, 0.1, 0.5],
            0.0,
            1.0,
        );
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "HELLO");
        assert_eq!(words[1].text, "WORLD");
        assert_eq!(words[1].start, 0.5);
    }

    #[test]
    fn special_tokens_are_skipped() {
        let words = words_from_tokens(&tokens(&["<blank>", "嗯", "</s>"]), &[0.0, 0.3, 0.6], 0.0, 1.0);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "嗯");
        assert_eq!(words[0].start, 0.3);
    }

    #[test]
    fn estimate_splits_by_character_count() {
        let words = estimate_words("你好世界", 0.0, 4.0);
        assert_eq!(words.len(), 4);
        assert_eq!(words[1].start, 1.0);
        assert_eq!(words[3].end, 4.0);
    }

    #[test]
    fn cues_break_on_sentence_end_and_gaps() {
        let words = estimate_words("你好。我们开始", 0.0, 3.0);
        let cues = cues_from_words(&words);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "你好。");
    }
}
