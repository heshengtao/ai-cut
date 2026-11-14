//! 参考音色：从任意音频里挑一段“有声音的” 3~10 秒。

pub const REF_SR: f64 = 16_000.0;
pub const TARGET_SECS: f64 = 10.0;
pub const MIN_SECS: f64 = 3.0;
const FRAME_SECS: f64 = 0.02;
const STEP_SECS: f64 = 0.5;
const REL_DB: f32 = -35.0;
const ABS_DB: f32 = -45.0;
const PAD_SECS: f64 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub start: usize,
    pub len: usize,
}

fn frame_db(samples: &[f32], frame: usize) -> Vec<f32> {
    samples
        .chunks(frame)
        .map(|chunk| {
            let sum: f32 = chunk.iter().map(|v| v * v).sum();
            let rms = (sum / chunk.len().max(1) as f32).sqrt();
            20.0 * rms.max(1e-6).log10()
        })
        .collect()
}

/// 找一段有声窗口；找不到（太短 / 全静音）返回 `None`。
pub fn pick_window(samples: &[f32], sample_rate: f64) -> Option<Window> {
    if sample_rate <= 0.0 || samples.is_empty() {
        return None;
    }
    let frame = (sample_rate * FRAME_SECS).round() as usize;
    if frame == 0 {
        return None;
    }
    let db = frame_db(samples, frame);
    if db.is_empty() {
        return None;
    }
    let peak = db.iter().cloned().fold(f32::MIN, f32::max);
    let threshold = (peak + REL_DB).max(ABS_DB);

    // 5 帧滑动平均：单个爆破音不算“有声”。
    let smoothed: Vec<f32> = (0..db.len())
        .map(|i| {
            let lo = i.saturating_sub(2);
            let hi = (i + 3).min(db.len());
            db[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        })
        .collect();
    let voiced: Vec<bool> = smoothed.iter().map(|v| *v >= threshold).collect();
    if (voiced.iter().filter(|v| **v).count() as f64) * FRAME_SECS < MIN_SECS {
        return None;
    }

    let target = (TARGET_SECS / FRAME_SECS).round() as usize;
    let step = (STEP_SECS / FRAME_SECS).round() as usize;
    let mut best: Option<(usize, usize)> = None;
    let mut best_count = 0usize;
    let mut i = 0;
    while i < voiced.len() {
        let end = (i + target).min(voiced.len());
        let count = voiced[i..end].iter().filter(|v| **v).count();
        if count > best_count {
            best_count = count;
            best = Some((i, end));
        }
        if end == voiced.len() {
            break;
        }
        i += step;
    }
    let (mut start, mut end) = best?;

    // 去掉首尾静音帧，再补 50 ms 余量。
    while start < end && !voiced[start] {
        start += 1;
    }
    while end > start && !voiced[end - 1] {
        end -= 1;
    }
    let pad = (PAD_SECS / FRAME_SECS).round() as usize;
    start = start.saturating_sub(pad);
    end = (end + pad).min(voiced.len());
    if end <= start {
        return None;
    }
    let start_sample = start * frame;
    let len = ((end - start) * frame).min(samples.len().saturating_sub(start_sample));
    (len > 0).then_some(Window {
        start: start_sample,
        len,
    })
}

/// 峰值归一到 `target_dbfs`。
pub fn normalize(samples: &mut [f32], target_dbfs: f32) {
    let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    if peak <= 1e-6 {
        return;
    }
    let gain = 10f32.powf(target_dbfs / 20.0) / peak;
    for sample in samples.iter_mut() {
        *sample = (*sample * gain).clamp(-1.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f64, sr: f64, amp: f32) -> Vec<f32> {
        let n = (seconds * sr) as usize;
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / sr as f32).sin())
            .collect()
    }

    #[test]
    fn skips_leading_silence() {
        let sr = REF_SR;
        let mut samples = vec![0.0f32; (8.0 * sr) as usize];
        samples.extend(tone(6.0, sr, 0.3));
        let window = pick_window(&samples, sr).expect("应找到有声窗口");
        let start_secs = window.start as f64 / sr;
        assert!((7.9..=8.1).contains(&start_secs), "起点 {start_secs}");
        let len_secs = window.len as f64 / sr;
        assert!((5.5..=6.2).contains(&len_secs), "长度 {len_secs}");
    }

    #[test]
    fn rejects_short_and_silent() {
        assert!(pick_window(&tone(2.0, REF_SR, 0.3), REF_SR).is_none());
        assert!(pick_window(&vec![0.0f32; 16_000 * 10], REF_SR).is_none());
    }

    #[test]
    fn caps_at_ten_seconds() {
        let window = pick_window(&tone(30.0, REF_SR, 0.3), REF_SR).expect("应有窗口");
        assert!(window.len as f64 / REF_SR <= TARGET_SECS + 0.11);
    }

    #[test]
    fn normalize_hits_target() {
        let mut samples = tone(1.0, REF_SR, 0.05);
        normalize(&mut samples, -3.0);
        let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let db = 20.0 * (peak as f64).log10();
        assert!((db - (-3.0)).abs() < 0.5, "峰值 {db} dBFS");
    }
}
