//! 素材预检：一次调用返回元数据、运动/镜头切点、目标框与语音转写。
//!
//! 这是给智能体省 token 的入口：与其渲染很多帧再逐张看图，不如直接拿结构化结果。
//! 运动与目标框来自低分辨率采样；转写复用应用内的 ASR 链路。

use std::path::Path;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::asr;
use crate::media::probe_media;
use crate::models;
use crate::video_ai;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectMode {
    None,
    Face,
    Person,
    Auto,
}

impl ObjectMode {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("none").trim().to_ascii_lowercase().as_str() {
            "" | "none" | "off" | "false" => Ok(Self::None),
            "face" => Ok(Self::Face),
            "person" => Ok(Self::Person),
            "auto" => Ok(Self::Auto),
            other => Err(format!(
                "未知的检测对象「{other}」；可选 none / face / person / auto"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Face => "face",
            Self::Person => "person",
            Self::Auto => "auto",
        }
    }
}

pub struct ProbeOptions {
    pub motion: bool,
    pub transcript: bool,
    pub objects: ObjectMode,
    pub interval: Option<f64>,
    pub max_samples: usize,
    pub model_id: Option<String>,
}

impl Default for ProbeOptions {
    fn default() -> Self {
        Self {
            motion: true,
            transcript: false,
            objects: ObjectMode::None,
            interval: None,
            max_samples: 60,
            model_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MotionLevel {
    Low,
    Medium,
    High,
}

impl MotionLevel {
    fn of(score: f32) -> Self {
        if score >= 0.18 {
            Self::High
        } else if score >= 0.06 {
            Self::Medium
        } else {
            Self::Low
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

fn motion_segments(samples: &[video_ai::AnalysisSample], interval: f64) -> Vec<Value> {
    let mut segments = Vec::new();
    let mut index = 0;
    while index < samples.len() {
        let level = MotionLevel::of(samples[index].motion);
        let start = samples[index].time;
        let mut end = start + interval;
        let mut peak = samples[index].motion;
        let mut total = samples[index].motion;
        let mut count = 1usize;
        let mut next = index + 1;
        while next < samples.len() && MotionLevel::of(samples[next].motion) == level {
            end = samples[next].time + interval;
            peak = peak.max(samples[next].motion);
            total += samples[next].motion;
            count += 1;
            next += 1;
        }
        segments.push(json!({
            "start": start,
            "end": end,
            "level": level.as_str(),
            "averageMotion": total / count as f32,
            "peakMotion": peak,
        }));
        index = next;
    }
    segments
}

fn cuts(samples: &[video_ai::AnalysisSample]) -> Vec<f64> {
    samples
        .iter()
        .skip(1)
        .filter(|sample| sample.motion >= 0.22)
        .map(|sample| sample.time)
        .collect()
}

/// 一次完整预检。任何可选分析失败都降级为 `warnings`，不拖垮基础元数据。
pub async fn probe(app: &AppHandle, path: String, options: ProbeOptions) -> Result<Value, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("文件不存在：{path}"));
    }

    let meta = probe_media(app.clone(), path.clone()).await?;
    let has_video = meta.has_video;
    let has_audio = meta.has_audio;
    let duration = meta.duration;
    let mut warnings = Vec::new();

    let mut samples = Vec::new();
    let should_sample = has_video && (options.motion || options.objects != ObjectMode::None);
    let interval = options
        .interval
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(2.0);

    if should_sample {
        match video_ai::video_ai_samples(
            app.clone(),
            path.clone(),
            interval,
            options.max_samples,
            options.objects.as_str().to_string(),
        )
        .await
        {
            Ok(found) => samples = found,
            Err(error) => warnings.push(format!("画面采样失败：{error}")),
        }
    } else if !has_video {
        warnings.push("素材没有视频轨，跳过画面采样".into());
    }

    let transcript = if options.transcript {
        if !has_audio {
            warnings.push("素材没有音轨，跳过语音转写".into());
            None
        } else {
            match transcribe(app, &path, options.model_id.as_deref()).await {
                Ok(value) => Some(value),
                Err(error) => {
                    warnings.push(error);
                    None
                }
            }
        }
    } else {
        None
    };

    let media = serde_json::to_value(&meta).unwrap_or(Value::Null);
    Ok(json!({
        "path": path,
        "media": media,
        "duration": duration,
        "hasVideo": has_video,
        "hasAudio": has_audio,
        "sampleInterval": if should_sample { Some(interval) } else { None },
        "samples": samples,
        "motionSegments": motion_segments(&samples, interval),
        "cuts": cuts(&samples),
        "transcript": transcript,
        "warnings": warnings,
        "hint": "samples 里的 motion 是相对上一采样帧的运动量（0..1），objects 是归一化目标框。\
                 需要更细的切点或看清某个区间时，缩小 interval 或提高 maxSamples 再调用一次；\
                 不要把这里的结果当成逐帧精确检测。",
    }))
}

async fn transcribe(
    app: &AppHandle,
    path: &str,
    model_id: Option<&str>,
) -> Result<Value, String> {
    let entry = match model_id.filter(|value| !value.is_empty()) {
        Some(id) => models::by_id(id).ok_or_else(|| format!("未知模型：{id}"))?,
        None => models::first_installed(app, "asr").ok_or_else(|| {
            "没有已安装的 ASR 模型；先用 list_ai_models / download_model 安装".to_string()
        })?,
    };
    if entry.feature != "asr" {
        return Err(format!("{} 不是语音识别模型", entry.name));
    }
    let vad = models::by_id("silero-vad").ok_or("清单里缺少 VAD 模型")?;
    if models::installed_dir(app, vad).is_none() {
        return Err("语音检测模型 silero-vad 尚未安装".into());
    }

    let cues = asr::asr_transcribe(app.clone(), path.to_string(), entry.id.to_string(), None).await?;
    Ok(json!({
        "model": entry.id,
        "cues": cues,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video_ai::AnalysisSample;

    fn sample(time: f64, motion: f32) -> AnalysisSample {
        AnalysisSample {
            time,
            motion,
            objects: Vec::new(),
        }
    }

    #[test]
    fn cuts_flag_strong_motion() {
        let samples = vec![sample(0.0, 0.0), sample(2.0, 0.3), sample(4.0, 0.01)];
        assert_eq!(cuts(&samples), vec![2.0]);
    }

    #[test]
    fn motion_segments_group_adjacent_levels() {
        let samples = vec![
            sample(0.0, 0.0),
            sample(2.0, 0.01),
            sample(4.0, 0.2),
            sample(6.0, 0.3),
        ];
        let segments = motion_segments(&samples, 2.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0]["level"], "low");
        assert_eq!(segments[1]["level"], "high");
        let peak = segments[1]["peakMotion"].as_f64().unwrap();
        assert!((peak - 0.3).abs() < 1e-6);
    }

    #[test]
    fn object_mode_parses_aliases() {
        assert_eq!(ObjectMode::parse(None).unwrap(), ObjectMode::None);
        assert_eq!(ObjectMode::parse(Some("OFF")).unwrap(), ObjectMode::None);
        assert_eq!(ObjectMode::parse(Some("Person")).unwrap(), ObjectMode::Person);
        assert!(ObjectMode::parse(Some("cat")).is_err());
    }
}
