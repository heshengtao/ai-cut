//! 音频解码与响度测量（**无头可用**：只依赖 `Host` 跑 ffmpeg）。
//!
//! 为什么要独立成模块：本地 AI 的降噪 / 分离 / 变声 / DSP 都要把素材解成
//! 48 kHz 立体声交错 `f32`；响度归一化（`audio_measure_loudness`）也要同一份解码。
//! 这段逻辑本来在 `src-tauri` 里，插件式调用（Tauri sidecar）绑死了桌面壳。
//!
//! 现在 `decode_segment` 与 `measure_loudness` 都收在这里，桌面壳与无头进程共用；
//! 后续把 `audio_ai` 的其余部分下沉时可以直接复用。

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use ebur128::{EbuR128, Mode};
use serde::Serialize;

use crate::host::Host;
use crate::media;

/// 解码输出采样率（与本地 AI 管线一致）。
pub const OUT_SAMPLE_RATE: u32 = 48_000;
/// 解码输出声道数。
pub const OUT_CHANNELS: u16 = 2;

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0)
}

fn cache_path(host: &dyn Host, tag: &str, ext: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(media::media_cache_dir(host)?);
    Ok(dir.join(format!("audio-ai-{tag}-{}.{ext}", stamp())))
}

/// 把源文件的某个区间解成 48 kHz 立体声交错 `f32`。
pub async fn decode_segment(
    host: &dyn Host,
    path: &str,
    start: f64,
    duration: f64,
) -> Result<Vec<f32>, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("处理时长必须大于 0".into());
    }
    let tmp = cache_path(host, "decode", "f32")?;
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
    let out = host
        .run("ffmpeg", &args, Default::default())
        .await
        .map_err(|error| format!("解码调用失败：{error}"))?;
    if out.code != Some(0) {
        let _ = std::fs::remove_file(&tmp);
        return Err("无法提取音频（该素材可能没有音轨）".into());
    }
    let bytes = std::fs::read(&tmp).map_err(|e| format!("读取解码结果失败：{e}"))?;
    let _ = std::fs::remove_file(&tmp);
    if bytes.len() < 4 || bytes.len() % 4 != 0 {
        return Err("解码结果不完整".into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// 积分响度与真峰值。
#[derive(Debug, Clone, Serialize)]
pub struct LoudnessReport {
    /// 积分响度（LUFS）；静音为 `None`。
    pub integrated_lufs: Option<f64>,
    /// 真峰值（dBTP）；静音为 `None`。
    pub true_peak_dbtp: Option<f64>,
}

/// 从交错 `f32` 计算积分响度与真峰值。
pub fn measure_loudness(
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

/// 测量一段素材的积分响度与真峰值（前端据此把 `clip.gain` 设到目标响度）。
pub async fn audio_measure_loudness(
    host: &dyn Host,
    path: String,
    start: f64,
    duration: f64,
) -> Result<LoudnessReport, String> {
    let samples = decode_segment(host, &path, start, duration).await?;
    measure_loudness(&samples, OUT_CHANNELS as usize, OUT_SAMPLE_RATE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(seconds: usize, amplitude: f32) -> Vec<f32> {
        let mut out = Vec::with_capacity(seconds * 2);
        for index in 0..seconds {
            let phase = 2.0 * std::f32::consts::PI * 440.0 * index as f32 / OUT_SAMPLE_RATE as f32;
            let value = phase.sin() * amplitude;
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
}
