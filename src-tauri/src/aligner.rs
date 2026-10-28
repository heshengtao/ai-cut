//! Qwen3-ForcedAligner（0.6B，q4 ONNX）词级强制对齐。
//!
//! 与 ASR 解耦：文本由任意识别模型给出，这里只负责「每个词在音频里的起止」。
//! 一次前向吃 30 秒音频，输出每个 `<timestamp>` 槽位在 80 ms 时间格上的分类，
//! 每两个槽位对应一个词的起止。
//!
//! 参考实现：`qwen_asr` 的 `Qwen3ForcedAligner`（Apache-2.0）。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;
use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use tokenizers::Tokenizer;

const SAMPLE_RATE: usize = 16_000;
const N_FFT: usize = 400;
const HOP: usize = 160;
const N_MELS: usize = 128;
const N_BINS: usize = N_FFT / 2 + 1;
const CHUNK_SAMPLES: usize = 30 * SAMPLE_RATE;
const MAX_FRAMES: usize = 3000;
/// 一个时间格是多少毫秒（`config.json` 的 `timestamp_segment_time`）。
const BIN_MS: f32 = 80.0;
/// `<timestamp>` 的 token id（`config.json` 的 `timestamp_token_id`）。
const TIMESTAMP_ID: i64 = 151_705;

/// 一个对齐出来的词。
#[derive(Debug, Clone, PartialEq)]
pub struct AlignedWord {
    pub text: String,
    /// 素材内起点（秒）。
    pub start: f32,
    /// 素材内终点（秒）。
    pub end: f32,
}

pub struct Aligner {
    session: Session,
    tokenizer: Tokenizer,
}

impl Aligner {
    /// 从模型目录加载：需要 `model_q4.onnx` 与 `tokenizer.json`。
    pub fn load(dir: &Path) -> Result<Self, String> {
        let model = dir.join("model_q4.onnx");
        let tokenizer = dir.join("tokenizer.json");
        if !model.is_file() {
            return Err(format!("缺少对齐器模型：{}", model.display()));
        }
        if !tokenizer.is_file() {
            return Err(format!("缺少对齐器分词器：{}", tokenizer.display()));
        }
        let session = Session::builder()
            .map_err(|error| format!("创建对齐器会话失败：{error}"))?
            .commit_from_file(&model)
            .map_err(|error| format!("加载对齐器权重失败：{error}"))?;
        let tokenizer = Tokenizer::from_file(&tokenizer)
            .map_err(|error| format!("加载对齐器分词器失败：{error}"))?;
        Ok(Self { session, tokenizer })
    }

    /// 对齐一段文本。`samples` 是 16 kHz 单声道、范围 -1..1。
    ///
    /// 超过 30 秒的音频请由调用方切窗后分段调用（`windowed`）。
    pub fn align(&mut self, samples: &[f32], text: &str) -> Result<Vec<AlignedWord>, String> {
        let words = split_words(text);
        if words.is_empty() {
            return Ok(Vec::new());
        }
        let (features, frames) = log_mel(samples);
        let audio_tokens = audio_token_count(frames);
        let prompt = build_prompt(&words, audio_tokens);

        let encoding = self
            .tokenizer
            .encode(prompt, false)
            .map_err(|error| format!("对齐器分词失败：{error}"))?;
        let ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let positions: Vec<usize> = ids
            .iter()
            .enumerate()
            .filter(|(_, &id)| id == TIMESTAMP_ID)
            .map(|(index, _)| index)
            .collect();
        if positions.len() != words.len() * 2 {
            return Err(format!(
                "对齐器输入的槽位数不对：期望 {}，实际 {}",
                words.len() * 2,
                positions.len()
            ));
        }

        let seq = ids.len();
        let input_ids = Tensor::from_array(([1usize, seq], ids))
            .map_err(|error| format!("对齐器输入构建失败：{error}"))?;
        let attention = Tensor::from_array(([1usize, seq], vec![1i64; seq]))
            .map_err(|error| format!("对齐器掩码构建失败：{error}"))?;
        let features = Tensor::from_array(([1usize, N_MELS, MAX_FRAMES], features))
            .map_err(|error| format!("对齐器特征构建失败：{error}"))?;
        let mut mask = vec![1i32; MAX_FRAMES];
        for slot in mask.iter_mut().skip(frames) {
            *slot = 0;
        }
        let mask = Tensor::from_array(([1usize, MAX_FRAMES], mask))
            .map_err(|error| format!("对齐器特征掩码构建失败：{error}"))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids,
                "attention_mask" => attention,
                "input_features" => features,
                "feature_attention_mask" => mask,
            ])
            .map_err(|error| format!("对齐器推理失败：{error}"))?;
        let (shape, logits) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("对齐器输出读取失败：{error}"))?;
        let bins = *shape.last().unwrap_or(&0) as usize;
        if bins == 0 || logits.len() < seq * bins {
            return Err("对齐器输出形状异常".into());
        }

        let mut times: Vec<f32> = positions
            .iter()
            .map(|&token| {
                let row = &logits[token * bins..(token + 1) * bins];
                let best = row
                    .iter()
                    .enumerate()
                    .fold((0usize, f32::MIN), |acc, (index, &value)| {
                        if value > acc.1 {
                            (index, value)
                        } else {
                            acc
                        }
                    })
                    .0;
                best as f32 * BIN_MS
            })
            .collect();
        enforce_monotonic(&mut times);

        Ok(words
            .into_iter()
            .enumerate()
            .map(|(index, text)| AlignedWord {
                text,
                start: times[index * 2] / 1000.0,
                end: times[index * 2 + 1] / 1000.0,
            })
            .collect())
    }
}

/// 时间槽必须单调不减；塌成零长的词补一格（80 ms），不越过下一个词的起点。
fn enforce_monotonic(times: &mut [f32]) {
    for index in 1..times.len() {
        if times[index] < times[index - 1] {
            times[index] = times[index - 1];
        }
    }
    for index in 0..times.len().saturating_sub(1) {
        if times[index + 1] <= times[index] {
            times[index + 1] = times[index] + BIN_MS;
        }
    }
}

/// 文本 → 词：中文逐字，其余按空白切；标点丢弃。
fn split_words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for segment in text.split_whitespace() {
        let mut buffer = String::new();
        for ch in segment.chars() {
            if is_cjk(ch) {
                if !buffer.is_empty() {
                    out.push(std::mem::take(&mut buffer));
                }
                out.push(ch.to_string());
            } else if ch.is_alphanumeric() || ch == '\'' {
                buffer.push(ch);
            }
        }
        if !buffer.is_empty() {
            out.push(buffer);
        }
    }
    out
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

/// 音频编码器输出的 token 数（与官方 processor 的公式一致）。
fn audio_token_count(frames: usize) -> usize {
    let frames = frames as i32;
    let leave = frames % 100;
    let feats = if leave == 0 { 0 } else { (leave - 1) / 2 + 1 };
    let out = if feats == 0 {
        0
    } else {
        ((feats - 1) / 2 + 1 - 1) / 2 + 1
    };
    (out + frames / 100 * 13).max(0) as usize
}

fn build_prompt(words: &[String], audio_tokens: usize) -> String {
    let mut prompt = String::from("<|audio_start|>");
    prompt.push_str(&"<|audio_pad|>".repeat(audio_tokens));
    prompt.push_str("<|audio_end|>");
    // 每个词后面跟两个时间槽（参考实现用 join + 收尾，等价于「词 + 槽 + 槽」）。
    for word in words {
        prompt.push_str(word);
        prompt.push_str("<timestamp><timestamp>");
    }
    prompt
}

/// 128 维 slaney 梅尔滤波器组，行优先 `[mel][bin]`。
fn mel_filterbank() -> Vec<f32> {
    let min_hz = 0.0f32;
    let max_hz = 8_000.0f32;
    let mel_min = hz_to_mel(min_hz);
    let mel_max = hz_to_mel(max_hz);
    let points: Vec<f32> = (0..N_MELS + 2)
        .map(|index| {
            mel_to_hz(mel_min + (mel_max - mel_min) * index as f32 / (N_MELS + 1) as f32)
        })
        .collect();
    let freqs: Vec<f32> = (0..N_BINS)
        .map(|index| index as f32 * SAMPLE_RATE as f32 / N_FFT as f32)
        .collect();

    let mut filters = vec![0.0f32; N_MELS * N_BINS];
    for mel in 0..N_MELS {
        let lower = points[mel];
        let center = points[mel + 1];
        let upper = points[mel + 2];
        let norm = 2.0 / (upper - lower).max(f32::EPSILON);
        for (bin, &freq) in freqs.iter().enumerate() {
            let weight = if freq > lower && freq < center {
                (freq - lower) / (center - lower).max(f32::EPSILON)
            } else if freq >= center && freq < upper {
                (upper - freq) / (upper - center).max(f32::EPSILON)
            } else {
                0.0
            };
            filters[mel * N_BINS + bin] = weight * norm;
        }
    }
    filters
}

fn hz_to_mel(hz: f32) -> f32 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1_000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f32.ln() / 27.0;
    if hz >= min_log_hz {
        min_log_mel + (hz / min_log_hz).ln() / logstep
    } else {
        hz / f_sp
    }
}

fn mel_to_hz(mel: f32) -> f32 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1_000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f32.ln() / 27.0;
    if mel >= min_log_mel {
        min_log_hz * (logstep * (mel - min_log_mel)).exp()
    } else {
        f_sp * mel
    }
}

/// 音频 → 128 × 3000 的 log-mel（行优先 `[mel][frame]`），返回帧数。
fn log_mel(samples: &[f32]) -> (Vec<f32>, usize) {
    let mut audio = samples.to_vec();
    audio.resize(CHUNK_SAMPLES, 0.0);
    audio.truncate(CHUNK_SAMPLES);

    // torch.stft(center=True, pad_mode="reflect")：两侧各补 200 个样本，镜像不重复端点。
    let pad = N_FFT / 2;
    let mut padded = Vec::with_capacity(CHUNK_SAMPLES + 2 * pad);
    for index in (1..=pad).rev() {
        padded.push(audio[index]);
    }
    padded.extend_from_slice(&audio);
    for index in 0..pad {
        padded.push(audio[audio.len() - 2 - index]);
    }

    let window: Vec<f32> = (0..N_FFT)
        .map(|index| {
            let phase = 2.0 * std::f32::consts::PI * index as f32 / N_FFT as f32;
            0.5 - 0.5 * phase.cos()
        })
        .collect();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(N_FFT);
    let filters = mel_filterbank();
    let mut spectra = vec![0.0f32; MAX_FRAMES * N_BINS];
    let mut buffer = vec![Complex::new(0.0f32, 0.0f32); N_FFT];

    for frame in 0..MAX_FRAMES {
        let offset = frame * HOP;
        if offset + N_FFT > padded.len() {
            break;
        }
        for index in 0..N_FFT {
            buffer[index] = Complex::new(padded[offset + index] * window[index], 0.0);
        }
        fft.process(&mut buffer);
        for bin in 0..N_BINS {
            let value = buffer[bin];
            spectra[frame * N_BINS + bin] = value.re * value.re + value.im * value.im;
        }
    }

    let frames = MAX_FRAMES;
    let mut mel = vec![0.0f32; N_MELS * MAX_FRAMES];
    for channel in 0..N_MELS {
        for frame in 0..frames {
            let mut sum = 0.0f32;
            for bin in 0..N_BINS {
                sum += filters[channel * N_BINS + bin] * spectra[frame * N_BINS + bin];
            }
            mel[channel * MAX_FRAMES + frame] = sum.max(1e-10).log10();
        }
    }

    // Whisper：整体最大值往下 8 个数量级截断，再映射到 -1..1 附近。
    let max = mel.iter().cloned().fold(f32::MIN, f32::max);
    let floor = max - 8.0;
    for value in mel.iter_mut() {
        *value = (value.max(floor) + 4.0) / 4.0;
    }
    (mel, frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_f32(path: &str) -> Option<Vec<f32>> {
        let bytes = std::fs::read(path).ok()?;
        Some(
            bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect(),
        )
    }

    #[test]
    fn mel_matches_the_reference_frontend() {
        let Some(samples) = read_f32("/tmp/aicut-test/ref_samples.bin") else {
            return;
        };
        let Some(reference) = read_f32("/tmp/aicut-test/ref_mel.bin") else {
            return;
        };
        let (mel, frames) = log_mel(&samples);
        assert_eq!(frames, MAX_FRAMES);
        let mut worst = 0.0f32;
        let mut worst_at = 0usize;
        for (index, (a, b)) in mel.iter().zip(reference.iter()).enumerate() {
            let diff = (a - b).abs();
            if diff > worst {
                worst = diff;
                worst_at = index;
            }
        }
        assert!(
            worst < 1e-3,
            "最大误差 {worst}（第 {worst_at} 个值，Rust {} / 参考 {}）",
            mel[worst_at],
            reference[worst_at]
        );
    }

    #[test]
    #[ignore = "需要本地 1 GB 对齐器模型"]
    fn aligns_the_test_clip() {
        let samples = read_f32("/tmp/aicut-test/ref_samples.bin").expect("参考音频");
        let mut aligner = Aligner::load(Path::new("/tmp/aicut-test/aligner")).expect("加载对齐器");
        let text = "嗯那个大家好今天我们来聊一聊视频剪辑呃其实呢这件事没有想象中那么难嗯我们开始吧";
        let words = aligner.align(&samples, text).expect("对齐");
        assert_eq!(words.len(), text.chars().count());
        assert!((words[0].start - 0.0).abs() < 0.1, "第一个词起点 {:?}", words[0]);
        let um = words.iter().find(|word| word.text == "呃").expect("呃");
        assert!((um.start - 7.56).abs() < 0.15, "呃 起点 {:?}", um);
        assert!((um.end - 7.84).abs() < 0.15, "呃 终点 {:?}", um);
    }
}
