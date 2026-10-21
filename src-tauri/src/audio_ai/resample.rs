//! 重采样：**多相窗函数 sinc**（Blackman 窗），只处理单声道 `f32`。
//!
//! LocalVQE 要 16 kHz、HTDemucs 要 44.1 kHz，而工程素材通常是 44.1 / 48 kHz，
//! 因此进出模型都要重采样。线性插值在降采样时会把高频镜像折回来，所以这里用带限 sinc。

/// 相位表精度：把每个输出点的分数延迟量化成 1/PHASES。
const PHASES: usize = 512;
/// 每侧抽头数（总共 2*TAPS 个抽头）。
const TAPS: usize = 16;

/// 把单声道 `x` 从 `from` Hz 重采样到 `to` Hz。
///
/// 采样率相同（或非法）时直接返回副本。输出长度 = `floor(len * to / from)`。
pub fn resample(x: &[f32], from: f64, to: f64) -> Vec<f32> {
    if x.is_empty() {
        return Vec::new();
    }
    if !(from > 0.0) || !(to > 0.0) || (from - to).abs() < 1e-9 {
        return x.to_vec();
    }
    let ratio = to / from;
    let table = coefficient_table(ratio);
    let n_out = ((x.len() as f64) * ratio).floor().max(0.0) as usize;
    let mut out = Vec::with_capacity(n_out);
    for i in 0..n_out {
        let t = i as f64 / ratio;
        let k = t.floor() as i64;
        let frac = t - k as f64;
        let phase = ((frac * PHASES as f64).round() as usize).min(PHASES - 1);
        let row = &table[phase * 2 * TAPS..(phase + 1) * 2 * TAPS];
        let mut acc = 0.0f32;
        for (j, c) in row.iter().enumerate() {
            let idx = k + j as i64 - (TAPS as i64 - 1);
            if idx >= 0 && (idx as usize) < x.len() {
                acc += x[idx as usize] * c;
            }
        }
        out.push(acc);
    }
    out
}

/// 预计算相位表：每行（一个相位）归一化到直流增益 1。
fn coefficient_table(ratio: f64) -> Vec<f32> {
    let cutoff = 0.5 * ratio.min(1.0);
    let mut table = vec![0.0f32; PHASES * 2 * TAPS];
    for p in 0..PHASES {
        let frac = p as f64 / PHASES as f64;
        let row = &mut table[p * 2 * TAPS..(p + 1) * 2 * TAPS];
        let mut sum = 0.0f64;
        for j in 0..2 * TAPS {
            let d = frac - (j as f64 - (TAPS as f64 - 1.0));
            let v = 2.0 * cutoff * sinc(2.0 * cutoff * d) * blackman(d / TAPS as f64);
            row[j] = v as f32;
            sum += v;
        }
        if sum.abs() > 1e-12 {
            for v in row.iter_mut() {
                *v = (*v as f64 / sum) as f32;
            }
        }
    }
    table
}

fn sinc(u: f64) -> f64 {
    if u.abs() < 1e-9 {
        1.0
    } else {
        let p = std::f64::consts::PI * u;
        p.sin() / p
    }
}

/// Blackman 窗，定义域 `-1..=1` 之外为 0。
fn blackman(t: f64) -> f64 {
    if t.abs() > 1.0 {
        return 0.0;
    }
    let x = (t + 1.0) * 0.5;
    0.42 - 0.5 * (std::f64::consts::TAU * x).cos() + 0.08 * (2.0 * std::f64::consts::TAU * x).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f64, seconds: f64, sr: f64) -> Vec<f32> {
        let n = (seconds * sr) as usize;
        (0..n)
            .map(|i| (std::f64::consts::TAU * freq * i as f64 / sr).sin() as f32 * 0.5)
            .collect()
    }

    fn tone_amplitude(x: &[f32], freq: f64, sr: f64) -> f32 {
        let skip = x.len() / 10;
        let body = &x[skip..x.len().saturating_sub(skip)];
        let mut re = 0.0f64;
        let mut im = 0.0f64;
        for (i, v) in body.iter().enumerate() {
            let phase = std::f64::consts::TAU * freq * (i + skip) as f64 / sr;
            re += *v as f64 * phase.cos();
            im -= *v as f64 * phase.sin();
        }
        2.0 * ((re * re + im * im).sqrt() / body.len() as f64) as f32
    }

    #[test]
    fn same_rate_is_a_copy() {
        let x = vec![0.1f32, -0.2, 0.3];
        assert_eq!(resample(&x, 48_000.0, 48_000.0), x);
    }

    #[test]
    fn dc_is_preserved() {
        let x = vec![0.25f32; 48_000];
        let y = resample(&x, 48_000.0, 22_050.0);
        for (i, v) in y.iter().enumerate().take(y.len() - 64).skip(64) {
            assert!((v - 0.25).abs() < 1e-3, "第 {i} 个样本 = {v}");
        }
    }

    #[test]
    fn a_midband_tone_survives_a_round_trip() {
        let sr_in = 48_000.0;
        let x = sine(1_000.0, 1.0, sr_in);
        let before = tone_amplitude(&x, 1_000.0, sr_in);
        let down = resample(&x, sr_in, 22_050.0);
        let after = tone_amplitude(&down, 1_000.0, 22_050.0);
        assert!(
            (after - before).abs() < before * 0.1,
            "1 kHz 通过 48k→22.05k 应基本无损：{before} -> {after}"
        );
    }

    #[test]
    fn upsampling_keeps_the_tone() {
        let x = sine(440.0, 0.5, 16_000.0);
        let before = tone_amplitude(&x, 440.0, 16_000.0);
        let y = resample(&x, 16_000.0, 48_000.0);
        let after = tone_amplitude(&y, 440.0, 48_000.0);
        assert!(
            (after - before).abs() < before * 0.05,
            "16k→48k：{before} -> {after}"
        );
    }
}
