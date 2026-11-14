//! **HTDemucs 6s（Demucs v4 `htdemucs_6s`）—— 自足 ONNX 导出**：混音 → 6 条分轨
//! （鼓 / 贝斯 / 其他 / 人声 / 吉他 / 钢琴）。
//!
//! 与 [`super::demucs`] 不同，这份导出把 STFT 折进了图里：只有一个输入 `mix`
//! （原始波形 `[1,2,T]`），输出 `stems`（`[1,6,2,T]`）。因此这里不需要 `rustfft`。
//!
//! stem 顺序：`[drums, bass, other, vocals, guitar, piano]`。注意官方说明 `piano`
//! 分轨质量偏弱、`guitar` 尚可。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use super::{err, Progress};

/// 模型要求的采样率。
const SR: f64 = 44_100.0;
/// 单个模型窗口的样本数（~7.8 秒 @44.1 kHz）。
const T: usize = 343_980;
/// 窗口步进（重叠一半；每窗只取前一半样本）。
const WINDOW_HOP: usize = T / 2;
/// 分轨数与顺序（与官方 `htdemucs_6s` 一致）。
const STEM_NAMES: [&str; 6] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

const IN_MIX: &str = "mix";
const OUT_STEMS: &str = "stems";

/// 把交错多声道音频分离成六条分轨（样本数与声道数与输入一致）。
///
/// 内部会上下混成 L/R 并重采样到 44 100 Hz，跑完再重采样回源采样率。
/// `progress` 返回 `false` 即取消，返回已写完的部分。
pub fn separate(
    samples: &[f32],
    channels: usize,
    sample_rate: f64,
    model_path: &Path,
    progress: Progress,
) -> Result<super::Stems, String> {
    let mut session = super::build_session(model_path, "6 分轨")?;

    let channels = channels.max(1);
    let frames = samples.len() / channels;
    if frames == 0 || sample_rate <= 0.0 {
        return Ok(super::Stems::default());
    }

    let mut left: Vec<f32> = Vec::with_capacity(frames);
    let mut right: Vec<f32> = Vec::with_capacity(frames);
    for i in 0..frames {
        let base = i * channels;
        let l = samples[base];
        left.push(l);
        right.push(if channels == 1 {
            l
        } else {
            samples.get(base + 1).copied().unwrap_or(l)
        });
    }
    let left = super::resample::resample(&left, sample_rate, SR);
    let right = super::resample::resample(&right, sample_rate, SR);
    let n = left.len().min(right.len());
    if n == 0 {
        return Ok(super::Stems::default());
    }

    let sources = STEM_NAMES.len();
    let mut out: Vec<Vec<f32>> = (0..sources).map(|_| vec![0.0f32; 2 * n]).collect();

    let num_windows = if n <= WINDOW_HOP {
        1
    } else {
        (n - 1) / WINDOW_HOP + 1
    };
    let mut lwin = vec![0.0f32; T];
    let mut rwin = vec![0.0f32; T];
    let mut pos = 0usize;
    let mut done = 0usize;
    while pos < n {
        if !progress(done as f32 / num_windows as f32 * 0.97) {
            break;
        }
        lwin.fill(0.0);
        rwin.fill(0.0);
        let take = T.min(n - pos);
        lwin[..take].copy_from_slice(&left[pos..pos + take]);
        rwin[..take].copy_from_slice(&right[pos..pos + take]);

        let window_out = run_window(&mut session, &lwin, &rwin)?;
        let copy = WINDOW_HOP.min(T).min(n - pos);
        for (s, stem) in out.iter_mut().enumerate() {
            let base = s * 2 * T;
            for i in 0..copy {
                stem[2 * (pos + i)] = window_out[base + i];
                stem[2 * (pos + i) + 1] = window_out[base + T + i];
            }
        }

        done += 1;
        if pos + WINDOW_HOP >= n {
            break;
        }
        pos += WINDOW_HOP;
    }

    Ok(super::Stems {
        stems: STEM_NAMES
            .iter()
            .enumerate()
            .map(|(s, name)| {
                (
                    *name,
                    super::finish_stem(&out[s], channels, sample_rate, frames),
                )
            })
            .collect(),
    })
}

/// 跑一个模型窗口：波形输入 → 六条分轨的时域结果（长度 `6*2*T`）。
fn run_window(session: &mut Session, left: &[f32], right: &[f32]) -> Result<Vec<f32>, String> {
    let t = left.len();
    let mut mix = Vec::with_capacity(2 * t);
    mix.extend_from_slice(left);
    mix.extend_from_slice(right);
    let input = Tensor::from_array(([1usize, 2, t], mix)).map_err(|e| err("构造输入失败", e))?;
    let outputs = session
        .run(ort::inputs![IN_MIX => input])
        .map_err(|e| err("6 分轨推理失败", e))?;
    let (shape, data) = outputs[OUT_STEMS]
        .try_extract_tensor::<f32>()
        .map_err(|e| err("读取 stems 输出失败", e))?;
    if shape.len() != 4
        || shape[1] != STEM_NAMES.len() as i64
        || shape[2] != 2
        || shape[3] != t as i64
    {
        return Err(err("输出形状不符", format!("{shape:?}")));
    }
    Ok(data.to_vec())
}
