//! ZipVoice 朗读：sherpa-onnx 原生 `OfflineTts`，123M 中英零样本音色克隆。
//!
//! 与 MOSS 不同，ZipVoice 需要「参考音频 + 与音频完全对应的参考文本」。
//! 默认音色使用模型包里自带的 `leijun-1.wav` 和 `prompt.txt` 文本；媒体库
//! 参考则由前端传入参考文本（可手动填写，或由 ASR 自动转写）。

use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
    OfflineTtsZipvoiceModelConfig, Wave,
};
use tauri::AppHandle;

use crate::media;
use crate::models;
use crate::sidecar;
use crate::tts::{emit, now_millis, to_pcm16, write_wav, TtsAudio, TtsItem};

/// 模型自带的默认音色。
const DEFAULT_VOICE_FILE: &str = "leijun-1.wav";
/// 与默认音色严格对应的文本（来自模型包的 `test_wavs/prompt.txt`）。
const DEFAULT_REFERENCE_TEXT: &str = "那还是36年前, 1987年. 我呢考上了武汉大学的计算机系.";
/// 参考音频统一重采样到 24 kHz 单声道。
const REFERENCE_RATE: i32 = 24_000;
/// 蒸馏模型推荐 4 步。
const NUM_STEPS: i32 = 4;

struct Loaded {
    model_id: String,
    tts: OfflineTts,
    default_reference: Vec<f32>,
    default_reference_rate: i32,
}

fn cache() -> &'static Mutex<Option<Loaded>> {
    static CACHE: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn with_loaded<R>(
    app: &AppHandle,
    model_id: &str,
    f: impl FnOnce(&Loaded) -> Result<R, String>,
) -> Result<R, String> {
    let mut guard = cache()
        .lock()
        .map_err(|_| "ZipVoice 状态损坏".to_string())?;
    let reload = guard
        .as_ref()
        .map(|loaded| loaded.model_id != model_id)
        .unwrap_or(true);
    if reload {
        emit(app, "loading", 0.03, Some("正在加载 ZipVoice 模型".into()));
        *guard = Some(Loaded::load(app, model_id)?);
    }
    let loaded = guard.as_ref().ok_or_else(|| "ZipVoice 模型未加载".to_string())?;
    f(loaded)
}

fn ensure_espeak_data(dir: &Path) -> Result<PathBuf, String> {
    let target = dir.join("espeak-ng-data");
    if target.is_dir() {
        return Ok(target);
    }
    let archive_path = dir.join("espeak-ng-data.tar.gz");
    let file =
        File::open(&archive_path).map_err(|error| format!("打开 espeak-ng-data 失败：{error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(dir)
        .map_err(|error| format!("解压 espeak-ng-data 失败：{error}"))?;
    if target.is_dir() {
        Ok(target)
    } else {
        Err("espeak-ng-data 解压后目录缺失".into())
    }
}

fn build_config(dir: &Path) -> Result<OfflineTtsConfig, String> {
    let data_dir = ensure_espeak_data(dir)?;
    let path = |name: &str| dir.join(name).to_string_lossy().into_owned();
    Ok(OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            zipvoice: OfflineTtsZipvoiceModelConfig {
                tokens: Some(path("tokens.txt")),
                encoder: Some(path("encoder.int8.onnx")),
                decoder: Some(path("decoder.int8.onnx")),
                vocoder: Some(path("vocos_24khz.onnx")),
                data_dir: Some(data_dir.to_string_lossy().into_owned()),
                lexicon: Some(path("lexicon.txt")),
                feat_scale: 0.1,
                t_shift: 0.5,
                target_rms: 0.1,
                guidance_scale: 1.0,
            },
            num_threads: 4,
            ..Default::default()
        },
        ..Default::default()
    })
}

impl Loaded {
    fn load(app: &AppHandle, model_id: &str) -> Result<Self, String> {
        let entry =
            models::by_id(model_id).ok_or_else(|| format!("未知朗读模型：{model_id}"))?;
        if entry.family != models::ModelFamily::ZipVoice {
            return Err(format!("{} 不是 ZipVoice 模型", entry.name));
        }
        let dir = models::require_dir(app, entry)?;
        let config = build_config(&dir)?;
        let tts = OfflineTts::create(&config).ok_or_else(|| "无法创建 ZipVoice 引擎".to_string())?;

        let voice_path = dir.join(DEFAULT_VOICE_FILE).to_string_lossy().into_owned();
        let wave = Wave::read(&voice_path).ok_or_else(|| "ZipVoice 默认音色缺失".to_string())?;
        let default_reference = wave.samples().to_vec();
        let default_reference_rate = wave.sample_rate();
        if default_reference.is_empty() {
            return Err("ZipVoice 默认音色为空".into());
        }

        Ok(Self {
            model_id: model_id.to_string(),
            tts,
            default_reference,
            default_reference_rate,
        })
    }
}

/// 合成选中的文字。`reference` 为空时使用模型自带的默认音色。
pub fn synthesize(
    app: &AppHandle,
    model_id: &str,
    items: &[TtsItem],
    reference: Option<&[f32]>,
    reference_rate: i32,
    reference_text: Option<&str>,
    cancel: &'static AtomicBool,
) -> Result<Vec<TtsAudio>, String> {
    with_loaded(app, model_id, |loaded| {
        let (reference_audio, reference_rate, reference_text) = match reference {
            Some(samples) => {
                if samples.is_empty() {
                    return Err("参考音频为空".into());
                }
                let text = reference_text
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "ZipVoice 需要参考音频的文本，请手动填写或自动识别".to_string())?;
                (samples.to_vec(), reference_rate, text.to_string())
            }
            None => (
                loaded.default_reference.clone(),
                loaded.default_reference_rate,
                DEFAULT_REFERENCE_TEXT.to_string(),
            ),
        };

        let mut extra = HashMap::new();
        extra.insert("min_char_in_sentence".to_string(), serde_json::json!(10));
        let config = GenerationConfig {
            speed: 1.0,
            reference_audio: Some(reference_audio),
            reference_sample_rate: reference_rate,
            reference_text: Some(reference_text),
            num_steps: NUM_STEPS,
            extra: Some(extra),
            ..Default::default()
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

            let progress_base = 0.1 + 0.85 * (index as f32 / total as f32);
            let progress_scale = 0.85 / total as f32;
            let app_cb = app.clone();
            let generated = loaded.tts.generate_with_config(
                text,
                &config,
                Some(move |_samples: &[f32], progress: f32| -> bool {
                    emit(
                        &app_cb,
                        "synthesizing",
                        progress_base + progress_scale * progress,
                        Some(format!("正在朗读 {}/{}", index + 1, total)),
                    );
                    !cancel.load(Ordering::Relaxed)
                }),
            );
            let audio = match generated {
                Some(audio) => audio,
                None if cancel.load(Ordering::Relaxed) => return Err("已取消".into()),
                None => return Err("ZipVoice 生成失败".into()),
            };

            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }

            let samples = audio.samples();
            let rate = audio.sample_rate().max(1) as u32;
            let pcm: Vec<i16> = samples.iter().map(|sample| to_pcm16(*sample)).collect();
            let path = dir.join(format!(
                "tts-{}-{}-{}.wav",
                now_millis(),
                index,
                uuid::Uuid::new_v4().simple()
            ));
            write_wav(&path, &pcm, 1, rate)?;
            results.push(TtsAudio {
                id: item.id.clone(),
                path: path.to_string_lossy().into_owned(),
                duration: samples.len() as f64 / rate as f64,
            });
        }

        Ok(results)
    })
}

/// 媒体库参考音频：ffmpeg 解成 24 kHz 单声道 float32，最多取 10 秒。
pub async fn load_reference(app: &AppHandle, path: &str) -> Result<Vec<f32>, String> {
    let args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-t".into(),
        "10".into(),
        "-i".into(),
        path.to_string(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        REFERENCE_RATE.to_string(),
        "-f".into(),
        "f32le".into(),
        "-".into(),
    ];
    let (code, stdout) = sidecar::run_sidecar(app, "ffmpeg", &args).await?;
    if code != Some(0) {
        return Err(format!("无法读取参考音频：{path}"));
    }
    if stdout.len() < 48_000 {
        return Err("参考音频太短".into());
    }
    let samples: Vec<f32> = stdout
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    if samples.is_empty() {
        return Err("参考音频为空".into());
    }
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实权重冒烟测试：ZIPVOICE_DIR 指向包含 encoder/decoder/vocoder/tokens/
    /// lexicon/leijun-1.wav 的目录；未设置时跳过。
    #[test]
    fn real_zipvoice_smoke() {
        let Ok(dir) = std::env::var("ZIPVOICE_DIR") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let config = build_config(&dir).expect("ZipVoice config");
        let tts = OfflineTts::create(&config).expect("create ZipVoice");
        let voice_path = dir.join(DEFAULT_VOICE_FILE).to_string_lossy().into_owned();
        let wave = Wave::read(&voice_path).expect("default voice");
        let reference = wave.samples().to_vec();
        let reference_rate = wave.sample_rate();

        let mut extra = HashMap::new();
        extra.insert("min_char_in_sentence".to_string(), serde_json::json!(10));
        let generation = GenerationConfig {
            speed: 1.0,
            reference_audio: Some(reference),
            reference_sample_rate: reference_rate,
            reference_text: Some(DEFAULT_REFERENCE_TEXT.to_string()),
            num_steps: NUM_STEPS,
            extra: Some(extra),
            ..Default::default()
        };

        let audio = tts
            .generate_with_config(
                "你好，世界。",
                &generation,
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("generate");
        let samples = audio.samples();
        assert!(!samples.is_empty(), "ZipVoice 没有生成音频");
        let energy: f64 = samples
            .iter()
            .map(|sample| (*sample as f64) * (*sample as f64))
            .sum::<f64>()
            / samples.len() as f64;
        assert!(energy > 1e-8, "生成的音频几乎是静音：{energy}");

        let rate = audio.sample_rate().max(1) as u32;
        let pcm: Vec<i16> = samples.iter().map(|sample| to_pcm16(*sample)).collect();
        let path = std::env::temp_dir().join("ai-cut-zipvoice-smoke.wav");
        write_wav(&path, &pcm, 1, rate).expect("write wav");
        eprintln!(
            "wrote {} ({} samples, {} Hz, {:.2}s)",
            path.display(),
            samples.len(),
            rate,
            samples.len() as f64 / rate as f64
        );
    }
}
