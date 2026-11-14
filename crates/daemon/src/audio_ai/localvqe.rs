//! **LocalVQE v1.2**（DeepVQE 的流式 CPU 派生版，Apache-2.0）：联合降噪 / 去混响。
//!
//! 权重是从官方 `localvqe-v1.2-1.3M.pt` 导出的 ONNX（单输入 `mic`、固定 2 秒窗口）。
//! 本模块做 50% 重叠的 Hann 交叠相加，并在进模型前重采样到 16 kHz、出模型后回源采样率。
//!
//! 注意：这是 **16 kHz 语音**模型（DNS / AEC Challenge 训练），对人声有效，对纯音乐会
//! 当成噪声压掉。音乐素材应走 ffmpeg DSP 降噪。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use super::resample;
use super::{hann, Progress};

/// 模型要求的采样率。
const SR: f64 = 16_000.0;
/// 导出时的固定输入长度（2 秒）。
const CHUNK: usize = 32_000;
/// 分块步进（1 秒 → 50% 重叠）。
const HOP: usize = CHUNK / 2;

const MODEL_INPUT: &str = "mic";
const MODEL_OUTPUT: &str = "out";

/// 对交错多声道音频降噪，返回同长度、同声道数的样本。
///
/// 每个声道独立处理（保住立体声像）。`progress` 返回 `false` 即取消。
pub fn enhance(
    samples: &[f32],
    channels: usize,
    sample_rate: f64,
    model_path: &Path,
    progress: Progress,
) -> Result<Vec<f32>, String> {
    let mut session = super::build_session(model_path, "LocalVQE")?;

    let channels = channels.max(1);
    if samples.is_empty() || sample_rate <= 0.0 {
        return Ok(vec![0.0; samples.len()]);
    }
    let frames = samples.len() / channels;
    let mut out = vec![0.0f32; samples.len()];
    for ch in 0..channels {
        let mono: Vec<f32> = (0..frames).map(|i| samples[i * channels + ch]).collect();
        let base = ch as f32 / channels as f32;
        let span = 1.0 / channels as f32;
        let Some(clean) = enhance_channel(&mut session, &mono, sample_rate, &|p| {
            progress(base + p * span)
        }) else {
            return Ok(out);
        };
        let n = frames.min(clean.len());
        for i in 0..n {
            out[i * channels + ch] = clean[i];
        }
    }
    Ok(out)
}

/// 单声道降噪；取消时返回 `None`。
fn enhance_channel(
    session: &mut Session,
    x: &[f32],
    sample_rate: f64,
    progress: Progress,
) -> Option<Vec<f32>> {
    if x.is_empty() {
        return Some(Vec::new());
    }
    let audio = resample::resample(x, sample_rate, SR);
    let window = hann(CHUNK);
    let mut acc = vec![0.0f32; audio.len()];
    let mut norm = vec![0.0f32; audio.len()];

    let chunks = if audio.len() <= CHUNK {
        1
    } else {
        (audio.len() - 1) / HOP + 1
    };
    let mut chunk = vec![0.0f32; CHUNK];
    for c in 0..chunks {
        if !progress(c as f32 / chunks as f32) {
            return None;
        }
        let start = c * HOP;
        chunk.fill(0.0);
        let end = (start + CHUNK).min(audio.len());
        chunk[..end - start].copy_from_slice(&audio[start..end]);

        let input = Tensor::from_array(([1usize, CHUNK], chunk.clone())).ok()?;
        let outputs = session.run(ort::inputs![MODEL_INPUT => input]).ok()?;
        let (_, clean) = outputs[MODEL_OUTPUT].try_extract_tensor::<f32>().ok()?;

        for i in 0..CHUNK {
            let t = start + i;
            if t >= acc.len() {
                break;
            }
            let w = window[i];
            acc[t] += clean[i] * w;
            norm[t] += w * w;
        }
    }
    for (i, v) in acc.iter_mut().enumerate() {
        if norm[i] > 1e-6 {
            *v /= norm[i];
        }
    }
    let mut back = resample::resample(&acc, SR, sample_rate);
    back.resize(x.len(), 0.0);
    Some(back)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled_model() -> Option<std::path::PathBuf> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/localvqe/localvqe-ns.onnx");
        path.is_file().then_some(path)
    }

    #[test]
    fn silence_stays_silent_when_the_model_is_present() {
        let Some(path) = bundled_model() else {
            eprintln!("跳过：未找到随包 LocalVQE 权重");
            return;
        };
        let silence = vec![0.0f32; 32_000];
        let out = enhance(&silence, 1, 16_000.0, &path, &|_| true).expect("降噪应成功");
        assert_eq!(out.len(), silence.len());
        let peak = out.iter().fold(0.0f32, |max, value| max.max(value.abs()));
        assert!(peak < 1e-3, "静音不该被放大出声音：峰值 {peak}");
    }

    #[test]
    fn cancellation_returns_a_same_length_buffer() {
        let Some(path) = bundled_model() else {
            return;
        };
        let audio = vec![0.1f32; 48_000];
        let out = enhance(&audio, 1, 16_000.0, &path, &|_| false).expect("取消也应正常返回");
        assert_eq!(out.len(), audio.len());
    }
}
