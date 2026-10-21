//! AI 朗读：MOSS-TTS-Nano ONNX 本地合成。
//!
//! 模型由两部分组成：MOSS-TTS-Nano（Audio Tokenizer + LLM 的 ONNX 图）和
//! MOSS-Audio-Tokenizer-Nano（48 kHz 立体声编解码）。流程：
//!
//! 文本 → SentencePiece → 预填（prefill）/ 逐帧解码（decode + local）→
//! RVQ 音频码 → 音频码解码（codec decode）→ WAV。
//!
//! 参考音色可以来自模型内置音色（manifest 里已经带好音频码），也可以来自
//! 媒体库里的任意音频 / 视频：先用 ffmpeg 解成 48 kHz 立体声 float32，
//! 再走 codec encoder 得到 prompt audio codes。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use ort::session::{builder::GraphOptimizationLevel, Session, SessionInputValue};
use ort::value::{DynValue, Tensor};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::media;
use crate::models;
use crate::sidecar;
use crate::zipvoice;

/// 朗读进度事件名。
pub const EVENT_TTS: &str = "tts-progress";

/// 音频 Tokenizer 条目 id。
const CODEC_ID: &str = "moss-audio-tokenizer-nano";
/// 单段文本最多送进模型的 token 数（官方 voice clone 切块上限）。
const MAX_CHUNK_TOKENS: usize = 75;
/// 参考音频最多取前 30 秒，避免长视频把编码时间拉满。
const REFERENCE_SECONDS: u32 = 30;
/// 兜底的最大生成帧数（1 帧 ≈ 80 ms）。
const MAX_FRAMES_CAP: usize = 1500;

// ---------------------------------------------------------------------------
// 前后端协议
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct TtsProgress {
    pub state: String,
    pub progress: f32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TtsItem {
    /// 前端文字片段 id，原样回传，用来把音频放回正确的时间点。
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsAudio {
    pub id: String,
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
    pub group: String,
}

// ---------------------------------------------------------------------------
// 任务状态
// ---------------------------------------------------------------------------

struct TtsRuntime {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn runtime() -> &'static TtsRuntime {
    static RUNTIME: OnceLock<TtsRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| TtsRuntime {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

/// 本地与云端 TTS 共用同一个任务锁，避免两种合成同时写缓存。
pub(crate) fn begin_task() -> Result<(), String> {
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有朗读任务正在运行".into());
    }
    runtime().cancel.store(false, Ordering::Relaxed);
    Ok(())
}

pub(crate) fn end_task() {
    runtime().running.store(false, Ordering::SeqCst);
}

pub(crate) fn cancelled() -> bool {
    runtime().cancel.load(Ordering::Relaxed)
}

pub(crate) fn emit(app: &AppHandle, state: &str, progress: f32, message: Option<String>) {
    let _ = app.emit(
        EVENT_TTS,
        TtsProgress {
            state: state.to_string(),
            progress: progress.clamp(0.0, 1.0),
            message,
        },
    );
}

// ---------------------------------------------------------------------------
// 模型元数据
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Manifest {
    model_files: HashMap<String, String>,
    tts_config: TtsConfig,
    prompt_templates: PromptTemplates,
    generation_defaults: GenerationDefaults,
    builtin_voices: Vec<BuiltinVoice>,
}

#[derive(Debug, Deserialize)]
struct TtsConfig {
    n_vq: usize,
    audio_pad_token_id: i32,
    audio_start_token_id: i32,
    audio_end_token_id: i32,
    audio_user_slot_token_id: i32,
    audio_assistant_slot_token_id: i32,
}

#[derive(Debug, Deserialize)]
struct PromptTemplates {
    user_prompt_prefix_token_ids: Vec<i32>,
    user_prompt_after_reference_token_ids: Vec<i32>,
    assistant_prompt_prefix_token_ids: Vec<i32>,
}

#[derive(Debug, Deserialize)]
struct GenerationDefaults {
    max_new_frames: usize,
}

#[derive(Debug, Deserialize)]
struct BuiltinVoice {
    voice: String,
    #[serde(default)]
    group: String,
    prompt_audio_codes: Vec<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
struct TtsMeta {
    files: HashMap<String, String>,
    model_config: ModelConfig,
    onnx: OnnxNames,
}

#[derive(Debug, Deserialize)]
struct ModelConfig {
    audio_codebook_sizes: Vec<usize>,
}

#[derive(Debug, Deserialize)]
struct OnnxNames {
    prefill_output_names: Vec<String>,
    decode_input_names: Vec<String>,
    decode_output_names: Vec<String>,
    #[serde(default)]
    local_fixed_sampled_frame_output_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CodecMeta {
    files: HashMap<String, String>,
    codec_config: CodecConfig,
}

#[derive(Debug, Deserialize)]
struct CodecConfig {
    sample_rate: u32,
    channels: usize,
    num_quantizers: usize,
}

// ---------------------------------------------------------------------------
// 已加载的运行时（模型常驻，切换模型时才重建）
// ---------------------------------------------------------------------------

struct Loaded {
    model_id: String,
    manifest: Manifest,
    tts_meta: TtsMeta,
    codec: CodecMeta,
    tokenizer: SpTokenizer,
    prefill: Session,
    decode: Session,
    local_frame: Session,
    codec_encode: Session,
    codec_decode: Session,
}

fn cache() -> &'static Mutex<Option<Loaded>> {
    static CACHE: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn with_loaded<R>(
    app: &AppHandle,
    model_id: &str,
    f: impl FnOnce(&mut Loaded) -> Result<R, String>,
) -> Result<R, String> {
    let mut guard = cache()
        .lock()
        .map_err(|_| "朗读模型状态损坏".to_string())?;
    let reload = guard
        .as_ref()
        .map(|loaded| loaded.model_id != model_id)
        .unwrap_or(true);
    if reload {
        emit(app, "loading", 0.03, Some("正在加载朗读模型".into()));
        *guard = Some(Loaded::load(app, model_id)?);
    }
    let loaded = guard.as_mut().ok_or_else(|| "朗读模型未加载".to_string())?;
    f(loaded)
}

fn new_session(path: &Path) -> Result<Session, String> {
    let threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(1, 4);
    Session::builder()
        .map_err(|error| format!("创建 ONNX 会话失败：{error}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|error| format!("配置 ONNX 优化失败：{error}"))?
        .with_intra_threads(threads)
        .map_err(|error| format!("配置 ONNX 线程失败：{error}"))?
        .commit_from_file(path)
        .map_err(|error| format!("加载 {} 失败：{error}", path.display()))
}

fn meta_path(map: &HashMap<String, String>, key: &str, base: &Path) -> Result<PathBuf, String> {
    let name = map
        .get(key)
        .ok_or_else(|| format!("模型元数据缺少 {key}"))?;
    Ok(base.join(name))
}

impl Loaded {
    fn load(app: &AppHandle, model_id: &str) -> Result<Self, String> {
        if !ort_backend::init() {
            return Err("ONNX Runtime 初始化失败（未找到可用的运行时）".into());
        }
        let entry =
            models::by_id(model_id).ok_or_else(|| format!("未知朗读模型：{model_id}"))?;
        if entry.family != models::ModelFamily::MossTtsNano {
            return Err(format!("{} 不是 MOSS TTS 模型", entry.name));
        }
        let dir = models::require_dir(app, entry)?;

        let codec_entry =
            models::by_id(CODEC_ID).ok_or_else(|| "缺少音频 Tokenizer 模型定义".to_string())?;
        let codec_dir = models::require_dir(app, codec_entry)?;

        let manifest: Manifest = read_json(&dir.join("browser_poc_manifest.json"), "模型清单")?;
        let tts_meta: TtsMeta = read_json(&dir.join("tts_browser_onnx_meta.json"), "TTS 元数据")?;
        let codec: CodecMeta =
            read_json(&codec_dir.join("codec_browser_onnx_meta.json"), "音频 Tokenizer 元数据")?;

        if !tts_meta.files.contains_key("local_fixed_sampled_frame") {
            return Err("当前 ONNX 模型不包含逐帧采样图，暂不支持".into());
        }

        let tokenizer_name = manifest
            .model_files
            .get("tokenizer_model")
            .map(String::as_str)
            .unwrap_or("tokenizer.model");
        let tokenizer = SpTokenizer::load(&dir.join(tokenizer_name))?;

        let prefill = new_session(&meta_path(&tts_meta.files, "prefill", &dir)?)?;
        let decode = new_session(&meta_path(&tts_meta.files, "decode_step", &dir)?)?;
        let local_frame =
            new_session(&meta_path(&tts_meta.files, "local_fixed_sampled_frame", &dir)?)?;
        let codec_encode = new_session(&meta_path(&codec.files, "encode", &codec_dir)?)?;
        let codec_decode = new_session(&meta_path(&codec.files, "decode_full", &codec_dir)?)?;

        Ok(Self {
            model_id: model_id.to_string(),
            manifest,
            tts_meta,
            codec,
            tokenizer,
            prefill,
            decode,
            local_frame,
            codec_encode,
            codec_decode,
        })
    }

    fn resolve_voice(&self, voice: Option<&str>) -> Result<Vec<Vec<i32>>, String> {
        let list = &self.manifest.builtin_voices;
        let picked = match voice {
            Some(id) if !id.trim().is_empty() => list.iter().find(|item| item.voice == id),
            _ => list.first(),
        };
        let picked = picked.ok_or_else(|| "朗读模型没有内置音色".to_string())?;
        if picked.prompt_audio_codes.is_empty() {
            return Err(format!("音色「{}」缺少参考音频", picked.voice));
        }
        Ok(picked.prompt_audio_codes.clone())
    }

    fn encode_reference(
        &mut self,
        samples: &[f32],
        cancel: &AtomicBool,
    ) -> Result<Vec<Vec<i32>>, String> {
        let channels = self.codec.codec_config.channels;
        if channels == 0 || samples.len() < channels {
            return Err("参考音频太短".into());
        }
        let total = samples.len() / channels;
        let data = samples[..total * channels].to_vec();

        let outputs = self
            .codec_encode
            .run(vec![
                (
                    "waveform".to_string(),
                    tensor_f32(vec![1, channels as i64, total as i64], data)?,
                ),
                (
                    "input_lengths".to_string(),
                    tensor_i32(vec![1], vec![total as i32])?,
                ),
            ])
            .map_err(|error| format!("参考音频编码失败：{error}"))?;

        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }

        let (shape, codes) = outputs["audio_codes"]
            .try_extract_tensor::<i32>()
            .map_err(|error| format!("读取参考音频编码失败：{error}"))?;
        let codes = codes.to_vec();
        let dims: Vec<usize> = shape.iter().map(|value| *value as usize).collect();
        let frames = first_i32(&outputs["audio_code_lengths"])?.max(0) as usize;
        let quantizers = dims.get(2).copied().unwrap_or(0);
        let n_vq = self
            .manifest
            .tts_config
            .n_vq
            .min(self.codec.codec_config.num_quantizers)
            .min(quantizers);
        let frame_count = frames.min(dims.get(1).copied().unwrap_or(0));
        drop(outputs);

        if n_vq == 0 || frame_count == 0 {
            return Err("参考音频编码为空".into());
        }

        let mut result = Vec::with_capacity(frame_count);
        for frame in 0..frame_count {
            let base = frame * quantizers;
            let mut row = Vec::with_capacity(n_vq);
            for channel in 0..n_vq {
                row.push(*codes.get(base + channel).unwrap_or(&0));
            }
            result.push(row);
        }
        Ok(result)
    }

    fn synthesize_item(
        &mut self,
        text: &str,
        prompt: &[Vec<i32>],
        cancel: &AtomicBool,
    ) -> Result<(Vec<i16>, u32, u16), String> {
        let normalized = normalize_text(text);
        let chunks = split_chunks(&self.tokenizer, &normalized, MAX_CHUNK_TOKENS);
        if chunks.is_empty() {
            return Err("文字为空".into());
        }

        let sample_rate = self.codec.codec_config.sample_rate;
        let mut channels = self.codec.codec_config.channels.max(1);
        let mut rng = Rng::new();
        let mut pcm: Vec<i16> = Vec::new();

        for (index, chunk) in chunks.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            let frames = self.generate_frames(chunk, prompt, &mut rng, cancel)?;
            if frames.is_empty() {
                continue;
            }
            let (chunk_pcm, chunk_channels) = self.decode_frames(&frames)?;
            channels = chunk_channels.max(1);
            pcm.extend(chunk_pcm);
            if index + 1 < chunks.len() {
                let pause = (sample_rate as f32 * 0.25) as usize;
                pcm.resize(pcm.len() + pause * channels, 0);
            }
        }

        if pcm.is_empty() {
            return Err("没有生成音频".into());
        }
        Ok((pcm, sample_rate, channels as u16))
    }

    fn generate_frames(
        &mut self,
        text: &str,
        prompt: &[Vec<i32>],
        rng: &mut Rng,
        cancel: &AtomicBool,
    ) -> Result<Vec<Vec<i32>>, String> {
        let config = &self.manifest.tts_config;
        let row_width = config.n_vq + 1;
        let text_tokens = self.tokenizer.encode(text);
        if text_tokens.is_empty() {
            return Ok(Vec::new());
        }

        let mut rows: Vec<Vec<i32>> = Vec::new();
        for token in self
            .manifest
            .prompt_templates
            .user_prompt_prefix_token_ids
            .iter()
            .copied()
            .chain(std::iter::once(config.audio_start_token_id))
        {
            rows.push(text_row(token, config));
        }
        for codes in prompt {
            rows.push(audio_row(codes, config));
        }
        let mut suffix = Vec::new();
        suffix.push(config.audio_end_token_id);
        suffix.extend_from_slice(
            &self
                .manifest
                .prompt_templates
                .user_prompt_after_reference_token_ids,
        );
        suffix.extend_from_slice(&text_tokens);
        suffix.extend_from_slice(
            &self
                .manifest
                .prompt_templates
                .assistant_prompt_prefix_token_ids,
        );
        suffix.push(config.audio_start_token_id);
        for token in suffix {
            rows.push(text_row(token, config));
        }

        let total_rows = rows.len();
        let mut flat = Vec::with_capacity(total_rows * row_width);
        for row in &rows {
            flat.extend_from_slice(row);
        }
        let mask = vec![1i32; total_rows];

        let prefill_output_names = self.tts_meta.onnx.prefill_output_names.clone();
        let decode_input_names = self.tts_meta.onnx.decode_input_names.clone();
        let decode_output_names = self.tts_meta.onnx.decode_output_names.clone();
        let local_output_names = self
            .tts_meta
            .onnx
            .local_fixed_sampled_frame_output_names
            .clone();

        let mut outputs = self
            .prefill
            .run(vec![
                (
                    "input_ids".to_string(),
                    tensor_i32(
                        vec![1, total_rows as i64, row_width as i64],
                        flat,
                    )?,
                ),
                (
                    "attention_mask".to_string(),
                    tensor_i32(vec![1, total_rows as i64], mask)?,
                ),
            ])
            .map_err(|error| format!("预填失败：{error}"))?;

        let (mut global_hidden, mut global_shape) = extract_last_hidden(&outputs["global_hidden"])?;
        let mut past: HashMap<String, Tensor<f32>> = HashMap::new();
        for name in prefill_output_names.iter().skip(1) {
            let input_name = name.replacen("present_", "past_", 1);
            let value = outputs
                .remove(name)
                .ok_or_else(|| format!("缺少输出：{name}"))?;
            let tensor: Tensor<f32> = value
                .downcast()
                .map_err(|error| format!("读取缓存失败：{error}"))?;
            past.insert(input_name, tensor);
        }
        drop(outputs);

        let mut seen: Vec<HashSet<i32>> = vec![HashSet::new(); config.n_vq];
        let codebook = self
            .tts_meta
            .model_config
            .audio_codebook_sizes
            .first()
            .copied()
            .unwrap_or(1024);
        let frame_limit = self
            .manifest
            .generation_defaults
            .max_new_frames
            .min(MAX_FRAMES_CAP);

        let continue_name = local_output_names
            .first()
            .cloned()
            .unwrap_or_else(|| "should_continue".to_string());
        let frame_name = local_output_names
            .get(1)
            .cloned()
            .unwrap_or_else(|| "frame_token_ids".to_string());

        let mut frames: Vec<Vec<i32>> = Vec::new();
        for valid_length in (total_rows as i32..).take(frame_limit) {
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }

            let mut repetition = vec![0i32; config.n_vq * codebook];
            for (channel, tokens) in seen.iter().enumerate() {
                for token in tokens {
                    if *token >= 0 && (*token as usize) < codebook {
                        repetition[channel * codebook + *token as usize] = 1;
                    }
                }
            }
            let audio_u: Vec<f32> = (0..config.n_vq).map(|_| rng.next_f32()).collect();
            let assistant_u = rng.next_f32();

            let outputs = self
                .local_frame
                .run(vec![
                    (
                        "global_hidden".to_string(),
                        tensor_f32(global_shape.clone(), global_hidden.clone())?,
                    ),
                    (
                        "repetition_seen_mask".to_string(),
                        tensor_i32(
                            vec![1, config.n_vq as i64, codebook as i64],
                            repetition,
                        )?,
                    ),
                    (
                        "assistant_random_u".to_string(),
                        tensor_f32(vec![1], vec![assistant_u])?,
                    ),
                    (
                        "audio_random_u".to_string(),
                        tensor_f32(vec![1, config.n_vq as i64], audio_u)?,
                    ),
                ])
                .map_err(|error| format!("逐帧采样失败：{error}"))?;

            let should_continue = outputs
                .get(continue_name.as_str())
                .ok_or_else(|| format!("缺少输出：{continue_name}"))
                .and_then(first_i32)?;
            let frame = outputs
                .get(frame_name.as_str())
                .ok_or_else(|| format!("缺少输出：{frame_name}"))
                .and_then(int_vector)?;
            drop(outputs);

            if should_continue == 0 {
                break;
            }
            if frame.len() < config.n_vq {
                break;
            }
            let frame: Vec<i32> = frame.into_iter().take(config.n_vq).collect();
            for (channel, token) in frame.iter().enumerate() {
                seen[channel].insert(*token);
            }
            frames.push(frame.clone());

            let mut next_row = vec![config.audio_pad_token_id; row_width];
            next_row[0] = config.audio_assistant_slot_token_id;
            next_row[1..].copy_from_slice(&frame);

            let mut feeds: Vec<(String, SessionInputValue)> = vec![
                (
                    "input_ids".to_string(),
                    tensor_i32(vec![1, 1, row_width as i64], next_row)?,
                ),
                (
                    "past_valid_lengths".to_string(),
                    tensor_i32(vec![1], vec![valid_length])?,
                ),
            ];
            for name in decode_input_names.iter().skip(2) {
                let tensor = past
                    .get(name)
                    .ok_or_else(|| format!("缺少缓存：{name}"))?;
                feeds.push((name.clone(), tensor.into()));
            }

            let mut outputs = self
                .decode
                .run(feeds)
                .map_err(|error| format!("逐帧解码失败：{error}"))?;
            let (hidden, shape) = extract_last_hidden(&outputs["global_hidden"])?;
            global_hidden = hidden;
            global_shape = shape;

            let mut next_past: HashMap<String, Tensor<f32>> = HashMap::new();
            for name in decode_output_names.iter().skip(1) {
                let input_name = name.replacen("present_", "past_", 1);
                let value = outputs
                    .remove(name)
                    .ok_or_else(|| format!("缺少输出：{name}"))?;
                let tensor: Tensor<f32> = value
                    .downcast()
                    .map_err(|error| format!("读取缓存失败：{error}"))?;
                next_past.insert(input_name, tensor);
            }
            drop(outputs);

            past = next_past;
        }

        Ok(frames)
    }

    fn decode_frames(&mut self, frames: &[Vec<i32>]) -> Result<(Vec<i16>, usize), String> {
        let n_vq = self.manifest.tts_config.n_vq;
        let mut codes = Vec::with_capacity(frames.len() * n_vq);
        for frame in frames {
            for index in 0..n_vq {
                codes.push(*frame.get(index).unwrap_or(&0));
            }
        }

        let outputs = self
            .codec_decode
            .run(vec![
                (
                    "audio_codes".to_string(),
                    tensor_i32(
                        vec![1, frames.len() as i64, n_vq as i64],
                        codes,
                    )?,
                ),
                (
                    "audio_code_lengths".to_string(),
                    tensor_i32(vec![1], vec![frames.len() as i32])?,
                ),
            ])
            .map_err(|error| format!("音频解码失败：{error}"))?;

        let (shape, audio) = outputs["audio"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取音频失败：{error}"))?;
        let audio = audio.to_vec();
        let dims: Vec<usize> = shape.iter().map(|value| *value as usize).collect();
        let total = first_i32(&outputs["audio_lengths"])?.max(0) as usize;
        drop(outputs);

        if dims.len() != 3 || dims[0] != 1 {
            return Err(format!("音频输出形状异常：{dims:?}"));
        }
        let channels = dims[1].max(1);
        let stride = dims[2];
        let samples = total.min(stride);
        let mut pcm = Vec::with_capacity(samples * channels);
        for sample in 0..samples {
            for channel in 0..channels {
                let value = *audio.get(channel * stride + sample).unwrap_or(&0.0);
                pcm.push(to_pcm16(value));
            }
        }
        Ok((pcm, channels))
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取{label}失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("解析{label}失败：{error}"))
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

/// 列出模型自带音色。模型未安装时返回空列表（界面仍可正常展示）。
#[tauri::command]
pub fn tts_voices(app: AppHandle, model_id: String) -> Result<Vec<TtsVoice>, String> {
    let entry = match models::by_id(&model_id) {
        Some(entry) if entry.feature == "tts" => entry,
        _ => return Ok(Vec::new()),
    };
    if entry.family == models::ModelFamily::ZipVoice {
        return Ok(vec![TtsVoice {
            id: "leijun".into(),
            name: "leijun".into(),
            group: "Chinese Male".into(),
        }]);
    }
    let Ok(dir) = models::require_dir(&app, entry) else {
        return Ok(Vec::new());
    };
    let Ok(bytes) = fs::read(dir.join("browser_poc_manifest.json")) else {
        return Ok(Vec::new());
    };
    let Ok(manifest) = serde_json::from_slice::<Manifest>(&bytes) else {
        return Ok(Vec::new());
    };
    Ok(manifest
        .builtin_voices
        .into_iter()
        .map(|voice| TtsVoice {
            id: voice.voice.clone(),
            // display_name 是参考音频的示例文案，不作为音色名返回。
            name: voice.voice,
            group: voice.group,
        })
        .collect())
}

/// 合成选中的文字。返回顺序与 `items` 一致，`id` 原样回传。
#[tauri::command]
pub async fn tts_synthesize(
    app: AppHandle,
    model_id: String,
    items: Vec<TtsItem>,
    voice: Option<String>,
    reference_path: Option<String>,
    reference_text: Option<String>,
) -> Result<Vec<TtsAudio>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知朗读模型：{model_id}"))?;
    let family = entry.family;
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有朗读任务正在运行".into());
    }
    runtime().cancel.store(false, Ordering::Relaxed);

    let result = async {
        match family {
            models::ModelFamily::ZipVoice => {
                let reference = match reference_path.as_deref() {
                    Some(path) if !path.trim().is_empty() => {
                        Some(zipvoice::load_reference(&app, path).await?)
                    }
                    _ => None,
                };
                let task_app = app.clone();
                let task_model = model_id.clone();
                let task_text = reference_text.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    zipvoice::synthesize(
                        &task_app,
                        &task_model,
                        &items,
                        reference.as_deref(),
                        24_000,
                        task_text.as_deref(),
                        &runtime().cancel,
                    )
                })
                .await
                .map_err(|error| format!("朗读任务异常：{error}"))?
            }
            _ => {
                let reference = match reference_path.as_deref() {
                    Some(path) if !path.trim().is_empty() => {
                        Some(load_reference(&app, path).await?)
                    }
                    _ => None,
                };
                let task_app = app.clone();
                let task_model = model_id.clone();
                let task_voice = voice.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    run_synthesis(
                        &task_app,
                        &task_model,
                        &items,
                        task_voice.as_deref(),
                        reference.as_deref(),
                        &runtime().cancel,
                    )
                })
                .await
                .map_err(|error| format!("朗读任务异常：{error}"))?
            }
        }
    }
    .await;

    runtime().running.store(false, Ordering::SeqCst);
    match &result {
        Ok(_) => emit(&app, "done", 1.0, None),
        Err(error) => emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

/// 取消当前朗读任务（合作式取消，当前帧结束后返回）。
#[tauri::command]
pub fn tts_cancel() {
    runtime().cancel.store(true, Ordering::SeqCst);
}

fn run_synthesis(
    app: &AppHandle,
    model_id: &str,
    items: &[TtsItem],
    voice: Option<&str>,
    reference: Option<&[f32]>,
    cancel: &AtomicBool,
) -> Result<Vec<TtsAudio>, String> {
    with_loaded(app, model_id, |loaded| {
        emit(app, "synthesizing", 0.06, Some("正在准备音色".into()));
        let prompt = match reference {
            Some(samples) => loaded.encode_reference(samples, cancel)?,
            None => loaded.resolve_voice(voice)?,
        };

        let dir = media::cache_dir(app)?;
        let total = items.len().max(1);
        let mut results = Vec::with_capacity(items.len());

        for (index, item) in items.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            let text = item.text.trim();
            if text.is_empty() {
                continue;
            }
            emit(
                app,
                "synthesizing",
                0.1 + 0.85 * (index as f32 / total as f32),
                Some(format!("正在朗读 {}/{}", index + 1, items.len())),
            );

            let (pcm, sample_rate, channels) =
                loaded.synthesize_item(text, &prompt, cancel)?;
            let path = dir.join(format!(
                "tts-{}-{}-{}.wav",
                now_millis(),
                index,
                uuid::Uuid::new_v4().simple()
            ));
            write_wav(&path, &pcm, channels, sample_rate)?;
            let duration = pcm.len() as f64 / (channels as f64 * sample_rate as f64);
            results.push(TtsAudio {
                id: item.id.clone(),
                path: path.to_string_lossy().into_owned(),
                duration,
            });
        }

        Ok(results)
    })
}

async fn load_reference(app: &AppHandle, path: &str) -> Result<Vec<f32>, String> {
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-t".into(),
        REFERENCE_SECONDS.to_string(),
        "-i".into(),
        path.to_string(),
        "-vn".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "48000".into(),
        "-f".into(),
        "f32le".into(),
        "-".into(),
    ];
    let (code, stdout) = sidecar::run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) {
        return Err(format!("无法读取参考音频：{path}"));
    }
    if stdout.len() < 1600 {
        return Err("参考音频太短".into());
    }

    let mut samples = Vec::with_capacity(stdout.len() / 4);
    for chunk in stdout.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    if samples.len() % 2 != 0 {
        samples.pop();
    }
    if samples.is_empty() {
        return Err("参考音频为空".into());
    }
    Ok(samples)
}

// ---------------------------------------------------------------------------
// 张量辅助
// ---------------------------------------------------------------------------

fn tensor_i32(shape: Vec<i64>, data: Vec<i32>) -> Result<SessionInputValue<'static>, String> {
    Ok(Tensor::from_array((shape, data))
        .map_err(|error| format!("构造张量失败：{error}"))?
        .into())
}

fn tensor_f32(shape: Vec<i64>, data: Vec<f32>) -> Result<SessionInputValue<'static>, String> {
    Ok(Tensor::from_array((shape, data))
        .map_err(|error| format!("构造张量失败：{error}"))?
        .into())
}

fn extract_last_hidden(value: &DynValue) -> Result<(Vec<f32>, Vec<i64>), String> {
    let (shape, data) = value
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("读取隐藏状态失败：{error}"))?;
    let dims: Vec<i64> = shape.iter().copied().collect();
    match dims.as_slice() {
        [_, hidden] => Ok((data.to_vec(), vec![1, *hidden])),
        [_, sequence, hidden] => {
            let sequence = *sequence as usize;
            let hidden = *hidden as usize;
            if sequence == 0 || data.len() < sequence * hidden {
                return Err("隐藏状态形状异常".into());
            }
            let start = (sequence - 1) * hidden;
            Ok((
                data[start..start + hidden].to_vec(),
                vec![1, hidden as i64],
            ))
        }
        _ => Err(format!("不支持的隐藏状态形状：{dims:?}")),
    }
}

fn first_i32(value: &DynValue) -> Result<i32, String> {
    int_vector(value).map(|values| values.first().copied().unwrap_or(0))
}

fn int_vector(value: &DynValue) -> Result<Vec<i32>, String> {
    if let Ok((_, data)) = value.try_extract_tensor::<i32>() {
        return Ok(data.to_vec());
    }
    if let Ok((_, data)) = value.try_extract_tensor::<i64>() {
        return Ok(data.iter().map(|item| *item as i32).collect());
    }
    if let Ok((_, data)) = value.try_extract_tensor::<u8>() {
        return Ok(data.iter().map(|item| *item as i32).collect());
    }
    Err("模型输出不是整数张量".into())
}

fn text_row(token: i32, config: &TtsConfig) -> Vec<i32> {
    let mut row = vec![config.audio_pad_token_id; config.n_vq + 1];
    row[0] = token;
    row
}

fn audio_row(codes: &[i32], config: &TtsConfig) -> Vec<i32> {
    let mut row = vec![config.audio_pad_token_id; config.n_vq + 1];
    row[0] = config.audio_user_slot_token_id;
    for (index, code) in codes.iter().take(config.n_vq).enumerate() {
        row[index + 1] = *code;
    }
    row
}

// ---------------------------------------------------------------------------
// 文本处理
// ---------------------------------------------------------------------------

fn normalize_text(text: &str) -> String {
    let mut out = String::new();
    let mut last_space = false;
    for character in text.chars() {
        let character = match character {
            '\n' | '\r' | '\t' => ' ',
            other => other,
        };
        if character == ' ' {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
        } else {
            out.push(character);
            last_space = false;
        }
    }
    let mut out = out.trim().to_string();
    if out.is_empty() {
        return out;
    }
    let cjk = out.chars().any(|character| {
        ('\u{4e00}'..='\u{9fff}').contains(&character)
            || ('\u{3040}'..='\u{30ff}').contains(&character)
            || ('\u{ac00}'..='\u{d7af}').contains(&character)
    });
    let last = out.chars().last().unwrap_or(' ');
    if cjk {
        if !matches!(
            last,
            '。' | '！' | '？' | '；' | '，' | '.' | '!' | '?' | ';' | ','
        ) {
            out.push('。');
        }
    } else if last.is_alphanumeric() {
        out.push('.');
    }
    out
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        current.push(character);
        if matches!(
            character,
            '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';'
        ) {
            while let Some(&next) = chars.peek() {
                if matches!(
                    next,
                    '"' | '\'' | '”' | '’' | ')' | ']' | '}' | '）' | '】' | '》' | '」' | '』'
                ) {
                    current.push(chars.next().unwrap_or(next));
                } else {
                    break;
                }
            }
            let sentence = current.trim();
            if !sentence.is_empty() {
                out.push(sentence.to_string());
            }
            current.clear();
        }
    }
    let tail = current.trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

fn split_chunks(tokenizer: &SpTokenizer, text: &str, max_tokens: usize) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for sentence in split_sentences(text) {
        let sentence = sentence.trim();
        if sentence.is_empty() {
            continue;
        }
        if tokenizer.count(sentence) > max_tokens {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            chunks.extend(split_long(tokenizer, sentence, max_tokens));
            continue;
        }
        if current.is_empty() {
            current.push_str(sentence);
        } else {
            let separator = if needs_space(&current, sentence) { " " } else { "" };
            let merged = format!("{current}{separator}{sentence}");
            if tokenizer.count(&merged) <= max_tokens {
                current = merged;
            } else {
                chunks.push(std::mem::take(&mut current));
                current.push_str(sentence);
            }
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn needs_space(left: &str, right: &str) -> bool {
    let left = left.chars().rev().find(|character| !character.is_whitespace());
    let right = right.chars().find(|character| !character.is_whitespace());
    matches!(
        (left, right),
        (Some(a), Some(b)) if a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric()
    )
}

fn split_long(tokenizer: &SpTokenizer, text: &str, max_tokens: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut remaining = text.trim().to_string();

    while !remaining.is_empty() && out.len() < 512 {
        if tokenizer.count(&remaining) <= max_tokens {
            out.push(remaining);
            break;
        }
        let chars: Vec<char> = remaining.chars().collect();
        let mut low = 1usize;
        let mut high = chars.len();
        let mut best = 1usize;
        while low <= high {
            let middle = (low + high) / 2;
            let candidate: String = chars[..middle].iter().collect();
            if tokenizer.count(&candidate) <= max_tokens {
                best = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        let mut cut = best;
        let start = best.saturating_sub(20);
        for index in (start..best).rev() {
            if matches!(
                chars[index],
                '，' | ',' | '、' | '；' | ';' | '：' | ':' | ' '
            ) {
                cut = index + 1;
                break;
            }
        }
        let piece: String = chars[..cut].iter().collect();
        let piece = piece.trim();
        if piece.is_empty() {
            break;
        }
        out.push(piece.to_string());
        remaining = chars[cut..].iter().collect::<String>().trim().to_string();
    }

    out
}

// ---------------------------------------------------------------------------
// SentencePiece（BPE）最小实现
// ---------------------------------------------------------------------------

struct SpTokenizer {
    scores: Vec<f32>,
    kinds: Vec<i32>,
    lookup: HashMap<String, i32>,
    byte_ids: [i32; 256],
    unk_id: i32,
}

struct SymbolNode {
    text: String,
    id: i32,
    prev: Option<usize>,
    next: Option<usize>,
    alive: bool,
    version: u32,
}

#[derive(PartialEq)]
struct MergePair {
    score: f32,
    left: usize,
    right: usize,
    left_version: u32,
    right_version: u32,
    id: i32,
}

impl Eq for MergePair {}

impl Ord for MergePair {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.score
            .partial_cmp(&other.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            // 同分时优先合并更靠左的一对，与 SentencePiece 的稳定顺序一致。
            .then_with(|| other.left.cmp(&self.left))
    }
}

impl PartialOrd for MergePair {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl SpTokenizer {
    fn load(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|error| format!("读取分词模型失败：{error}"))?;
        let mut pieces: Vec<String> = Vec::new();
        let mut scores: Vec<f32> = Vec::new();
        let mut kinds: Vec<i32> = Vec::new();
        let mut at = 0usize;

        while at < bytes.len() {
            let tag = read_varint(&bytes, &mut at)?;
            let field = tag >> 3;
            let wire = tag & 0x7;
            if field != 1 || wire != 2 {
                skip_field(&bytes, &mut at, wire)?;
                continue;
            }
            let length = read_varint(&bytes, &mut at)? as usize;
            let end = at
                .checked_add(length)
                .filter(|end| *end <= bytes.len())
                .ok_or_else(|| "分词模型数据截断".to_string())?;

            let mut piece = String::new();
            let mut score = 0f32;
            let mut kind = 1i32;
            while at < end {
                let tag = read_varint(&bytes, &mut at)?;
                let field = tag >> 3;
                let wire = tag & 0x7;
                match (field, wire) {
                    (1, 2) => {
                        let length = read_varint(&bytes, &mut at)? as usize;
                        let text_end = at
                            .checked_add(length)
                            .filter(|value| *value <= end)
                            .ok_or_else(|| "分词条目截断".to_string())?;
                        piece = String::from_utf8_lossy(&bytes[at..text_end]).into_owned();
                        at = text_end;
                    }
                    (2, 5) => {
                        let value_end = at
                            .checked_add(4)
                            .filter(|value| *value <= end)
                            .ok_or_else(|| "分词分数截断".to_string())?;
                        score = f32::from_le_bytes([
                            bytes[at],
                            bytes[at + 1],
                            bytes[at + 2],
                            bytes[at + 3],
                        ]);
                        at = value_end;
                    }
                    (3, 0) => {
                        kind = read_varint(&bytes, &mut at)? as i32;
                    }
                    _ => skip_field(&bytes, &mut at, wire)?,
                }
            }
            at = end;
            pieces.push(piece);
            scores.push(score);
            kinds.push(kind);
        }

        if scores.is_empty() {
            return Err("分词模型为空".into());
        }

        let mut lookup = HashMap::new();
        let mut byte_ids = [-1i32; 256];
        let mut unk_id = 0i32;
        for (index, piece) in pieces.iter().enumerate() {
            if piece == "<unk>" {
                unk_id = index as i32;
            }
            if let Some(hex) = piece
                .strip_prefix("<0x")
                .and_then(|rest| rest.strip_suffix('>'))
            {
                if hex.len() == 2 {
                    if let Ok(byte) = u8::from_str_radix(hex, 16) {
                        byte_ids[byte as usize] = index as i32;
                    }
                }
            }
            if !piece.is_empty() {
                lookup.insert(piece.clone(), index as i32);
            }
        }

        Ok(Self {
            scores,
            kinds,
            lookup,
            byte_ids,
            unk_id,
        })
    }

    fn count(&self, text: &str) -> usize {
        self.encode(text).len()
    }

    fn encode(&self, text: &str) -> Vec<i32> {
        if text.trim().is_empty() {
            return Vec::new();
        }

        let normalized = normalize_for_tokenizer(text);
        let chars: Vec<char> = normalized.chars().collect();
        let mut nodes = self.initial_symbols(&chars);
        if nodes.is_empty() {
            return Vec::new();
        }

        let mut heap = std::collections::BinaryHeap::new();
        for index in 0..nodes.len().saturating_sub(1) {
            self.push_pair(&nodes, index, index + 1, &mut heap);
        }

        while let Some(pair) = heap.pop() {
            let left = pair.left;
            let right = pair.right;
            if !nodes[left].alive || !nodes[right].alive {
                continue;
            }
            if nodes[left].next != Some(right) {
                continue;
            }
            if nodes[left].version != pair.left_version
                || nodes[right].version != pair.right_version
            {
                continue;
            }

            let right_text = std::mem::take(&mut nodes[right].text);
            nodes[left].text.push_str(&right_text);
            nodes[left].id = pair.id;
            nodes[left].version = nodes[left].version.wrapping_add(1);
            nodes[right].alive = false;

            let next = nodes[right].next;
            nodes[left].next = next;
            if let Some(next) = next {
                nodes[next].prev = Some(left);
            }

            if let Some(prev) = nodes[left].prev {
                self.push_pair(&nodes, prev, left, &mut heap);
            }
            if let Some(next) = next {
                self.push_pair(&nodes, left, next, &mut heap);
            }
        }

        nodes
            .into_iter()
            .filter(|node| node.alive)
            .map(|node| node.id)
            .collect()
    }

    fn initial_symbols(&self, chars: &[char]) -> Vec<SymbolNode> {
        let mut nodes: Vec<SymbolNode> = Vec::with_capacity(chars.len());
        for character in chars {
            let text: String = character.to_string();
            let direct = self
                .lookup
                .get(&text)
                .copied()
                .filter(|id| self.kinds[*id as usize] != 3);
            if let Some(id) = direct {
                let prev = nodes.len().checked_sub(1);
                nodes.push(SymbolNode {
                    text,
                    id,
                    prev,
                    next: None,
                    alive: true,
                    version: 0,
                });
                continue;
            }

            // byte fallback：SentencePiece 把未知字符拆成 <0xXX> 字节片段。
            let mut buffer = [0u8; 4];
            for byte in character.encode_utf8(&mut buffer).as_bytes() {
                let id = self.byte_ids[*byte as usize];
                let id = if id >= 0 { id } else { self.unk_id };
                let prev = nodes.len().checked_sub(1);
                nodes.push(SymbolNode {
                    text: format!("<0x{byte:02X}>"),
                    id,
                    prev,
                    next: None,
                    alive: true,
                    version: 0,
                });
            }
        }

        for index in 0..nodes.len() {
            nodes[index].next = (index + 1 < nodes.len()).then_some(index + 1);
        }
        nodes
    }

    fn push_pair(
        &self,
        nodes: &[SymbolNode],
        left: usize,
        right: usize,
        heap: &mut std::collections::BinaryHeap<MergePair>,
    ) {
        if !nodes[left].alive || !nodes[right].alive || nodes[left].next != Some(right) {
            return;
        }
        let mut merged = String::with_capacity(nodes[left].text.len() + nodes[right].text.len());
        merged.push_str(&nodes[left].text);
        merged.push_str(&nodes[right].text);
        let Some(&id) = self.lookup.get(&merged) else {
            return;
        };
        if self.kinds[id as usize] == 3 {
            return;
        }
        heap.push(MergePair {
            score: self.scores[id as usize],
            left,
            right,
            left_version: nodes[left].version,
            right_version: nodes[right].version,
            id,
        });
    }
}

fn normalize_for_tokenizer(text: &str) -> String {
    let mut cleaned = String::new();
    let mut last_space = false;
    for mut character in text.chars() {
        // SentencePiece 的 NFKC 规范化：全角 ASCII → 半角。
        if ('\u{FF01}'..='\u{FF5E}').contains(&character) && character != '\u{FF5E}' {
            character = char::from_u32(character as u32 - 0xFEE0).unwrap_or(character);
        }
        if character == '\u{3000}' {
            character = ' ';
        }
        if character == '\u{2026}' {
            cleaned.push_str("...");
            last_space = false;
            continue;
        }
        if character.is_whitespace() {
            if !last_space {
                cleaned.push(' ');
                last_space = true;
            }
        } else {
            cleaned.push(character);
            last_space = false;
        }
    }

    let mut normalized = String::with_capacity(cleaned.len() + 1);
    normalized.push('▁');
    for character in cleaned.trim().chars() {
        if character == ' ' {
            normalized.push('▁');
        } else {
            normalized.push(character);
        }
    }
    normalized
}

fn read_varint(data: &[u8], at: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    let mut shift = 0u32;
    loop {
        if *at >= data.len() {
            return Err("分词模型数据截断".into());
        }
        let byte = data[*at];
        *at += 1;
        value |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 64 {
            return Err("分词模型 varint 过长".into());
        }
    }
    Ok(value)
}

fn skip_field(data: &[u8], at: &mut usize, wire: u64) -> Result<(), String> {
    match wire {
        0 => {
            read_varint(data, at)?;
        }
        1 => *at += 8,
        2 => {
            let length = read_varint(data, at)? as usize;
            *at += length;
        }
        5 => *at += 4,
        _ => return Err(format!("不支持的分词模型字段类型：{wire}")),
    }
    if *at > data.len() {
        return Err("分词模型数据截断".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WAV / 随机数
// ---------------------------------------------------------------------------

pub(crate) fn write_wav(
    path: &Path,
    samples: &[i16],
    channels: u16,
    sample_rate: u32,
) -> Result<(), String> {
    let data_bytes = samples
        .len()
        .checked_mul(2)
        .filter(|value| *value <= u32::MAX as usize)
        .ok_or_else(|| "音频过长".to_string())? as u32;
    let channels = channels.max(1);
    let byte_rate = sample_rate
        .checked_mul(channels as u32)
        .and_then(|value| value.checked_mul(2))
        .ok_or_else(|| "音频参数溢出".to_string())?;

    let mut file =
        BufWriter::new(fs::File::create(path).map_err(|error| format!("创建音频失败：{error}"))?);

    file.write_all(b"RIFF").map_err(|error| error.to_string())?;
    file.write_all(&(36 + data_bytes).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(b"WAVEfmt ").map_err(|error| error.to_string())?;
    file.write_all(&16u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&channels.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&byte_rate.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&(channels * 2).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&16u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(b"data").map_err(|error| error.to_string())?;
    file.write_all(&data_bytes.to_le_bytes())
        .map_err(|error| error.to_string())?;

    for sample in samples {
        file.write_all(&sample.to_le_bytes())
            .map_err(|error| error.to_string())?;
    }
    file.flush().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn to_pcm16(value: f32) -> i16 {
    (value.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

struct Rng(u64);

impl Rng {
    fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        Self(seed | 1)
    }

    fn next_u64(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }

    fn next_f32(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32) / ((1u32 << 24) as f32)
    }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_tokenizer() -> SpTokenizer {
        let pieces = ["▁", "a", "b", "ab", "▁a", "▁ab", "<unk>"];
        let mut lookup = HashMap::new();
        for (index, piece) in pieces.iter().enumerate() {
            lookup.insert(piece.to_string(), index as i32);
        }
        SpTokenizer {
            scores: vec![0.0, 0.0, 0.0, 1.0, 0.5, 0.6, -100.0],
            kinds: vec![1, 1, 1, 1, 1, 1, 2],
            lookup,
            byte_ids: [-1; 256],
            unk_id: 6,
        }
    }

    #[test]
    fn bpe_merges_to_the_longest_piece() {
        let tokenizer = tiny_tokenizer();
        assert_eq!(tokenizer.encode("ab"), vec![5]);
    }

    #[test]
    fn chunking_never_exceeds_the_token_budget() {
        let tokenizer = tiny_tokenizer();
        let chunks = split_chunks(&tokenizer, "ab ab ab", 1);
        assert_eq!(chunks, vec!["ab", "ab", "ab"]);
        for chunk in &chunks {
            assert!(tokenizer.count(chunk) <= 1);
        }
    }

    #[test]
    fn normalization_adds_terminal_punctuation() {
        assert_eq!(normalize_text("你好"), "你好。");
        assert_eq!(normalize_text("hello"), "hello.");
        assert_eq!(normalize_text("你好。"), "你好。");
    }

    #[test]
    fn split_sentences_keeps_closing_quotes() {
        let sentences = split_sentences("他说：“好。”然后走了。");
        assert_eq!(sentences, vec!["他说：“好。”", "然后走了。"]);
    }

    #[test]
    fn wav_header_is_well_formed() {
        let dir = std::env::temp_dir().join("ai-cut-tts-test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("probe.wav");
        write_wav(&path, &[0, 1, -1, 2], 2, 48_000).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(bytes.len(), 44 + 8);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn protobuf_varint_roundtrip() {
        let data = [0xac, 0x02];
        let mut at = 0usize;
        assert_eq!(read_varint(&data, &mut at).unwrap(), 300);
    }

    /// 用真实 tokenizer.model 对照 Python sentencepiece 的结果；
    /// 没有设置 MOSS_TOKENIZER 时跳过，避免把 470 KB 词表提交进仓库。
    #[test]
    fn real_sentencepiece_matches_reference() {
        let Ok(path) = std::env::var("MOSS_TOKENIZER") else {
            return;
        };
        let tokenizer = SpTokenizer::load(Path::new(&path)).expect("load tokenizer");
        assert_eq!(
            tokenizer.encode("你好，世界。Hello world."),
            vec![3985, 10445, 10364, 1260, 10382, 9245, 4005, 1177, 10380]
        );
    }

    /// 真实权重端到端冒烟测试：需要先下载完整的 MOSS-TTS-Nano 与音频 Tokenizer。
    /// 通过 MOSS_TTS_DIR / MOSS_CODEC_DIR 指向两个模型目录；未设置时跳过。
    #[test]
    fn real_model_smoke() {
        let (Ok(tts_dir), Ok(codec_dir)) =
            (std::env::var("MOSS_TTS_DIR"), std::env::var("MOSS_CODEC_DIR"))
        else {
            return;
        };
        let tts_dir = PathBuf::from(tts_dir);
        let codec_dir = PathBuf::from(codec_dir);
        assert!(ort_backend::init(), "ONNX Runtime 初始化失败");

        let manifest: Manifest =
            read_json(&tts_dir.join("browser_poc_manifest.json"), "模型清单").unwrap();
        let tts_meta: TtsMeta =
            read_json(&tts_dir.join("tts_browser_onnx_meta.json"), "TTS 元数据").unwrap();
        let codec: CodecMeta =
            read_json(&codec_dir.join("codec_browser_onnx_meta.json"), "编解码元数据").unwrap();
        let tokenizer = SpTokenizer::load(&tts_dir.join("tokenizer.model")).unwrap();

        let mut loaded = Loaded {
            model_id: "smoke".into(),
            prefill: new_session(&meta_path(&tts_meta.files, "prefill", &tts_dir).unwrap()).unwrap(),
            decode: new_session(&meta_path(&tts_meta.files, "decode_step", &tts_dir).unwrap())
                .unwrap(),
            local_frame: new_session(
                &meta_path(&tts_meta.files, "local_fixed_sampled_frame", &tts_dir).unwrap(),
            )
            .unwrap(),
            codec_encode: new_session(&meta_path(&codec.files, "encode", &codec_dir).unwrap())
                .unwrap(),
            codec_decode: new_session(&meta_path(&codec.files, "decode_full", &codec_dir).unwrap())
                .unwrap(),
            manifest,
            tts_meta,
            codec,
            tokenizer,
        };

        let cancel = AtomicBool::new(false);
        let prompt = loaded.resolve_voice(None).unwrap();
        let (pcm, rate, channels) = loaded
            .synthesize_item("你好，世界。", &prompt, &cancel)
            .expect("synthesize");
        assert!(
            pcm.len() > (rate as usize / 2) * channels as usize,
            "生成的音频太短：{} samples",
            pcm.len()
        );

        let path = std::env::temp_dir().join("ai-cut-tts-smoke.wav");
        write_wav(&path, &pcm, channels, rate).unwrap();
        eprintln!(
            "wrote {} ({} samples, {} Hz, {} ch)",
            path.display(),
            pcm.len(),
            rate,
            channels
        );

        let energy: f64 =
            pcm.iter().map(|sample| (*sample as f64) * (*sample as f64)).sum::<f64>()
                / pcm.len() as f64;
        assert!(energy > 1.0, "生成的音频几乎是静音：{energy}");

        // 参考音频路径：把刚生成的音频当作音色参考，走一遍 codec encoder。
        let reference: Vec<f32> = pcm.iter().map(|sample| *sample as f32 / 32768.0).collect();
        let prompt = loaded.encode_reference(&reference, &cancel).unwrap();
        assert!(!prompt.is_empty(), "参考音频编码为空");
        let (cloned, cloned_rate, cloned_channels) = loaded
            .synthesize_item("你好。", &prompt, &cancel)
            .expect("voice clone");
        assert!(cloned.len() > (cloned_rate as usize / 4) * cloned_channels as usize);
        let clone_path = std::env::temp_dir().join("ai-cut-tts-smoke-clone.wav");
        write_wav(&clone_path, &cloned, cloned_channels, cloned_rate).unwrap();
        eprintln!(
            "wrote {} ({} samples, {} Hz, {} ch)",
            clone_path.display(),
            cloned.len(),
            cloned_rate,
            cloned_channels
        );
    }
}
