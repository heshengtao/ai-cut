//! 离线 AI 变声：MeanVC2 批量转换、音色库、参考音频截取。
//!
//! 一次命令处理整批片段：解码 → 16 kHz 单声道 → MeanVC2 → 48 kHz 立体声 WAV，
//! 进度通过 `voice-change-progress` 推给前端；取消用原子标志，取消后不返回结果。

pub mod meanvc2;
pub mod refs;
pub mod voices;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::audio_ai::{
    decode_segment, probe_duration, write_wav, OUT_CHANNELS, OUT_SAMPLE_RATE,
};
use crate::models;
use crate::paths;
use crate::voice_change::meanvc2::Model;
use crate::voice_change::refs::{normalize, pick_window, REF_SR};
use crate::voice_change::voices::{VoiceEntry, VoiceLibrary, VoiceSource};

/// 变声进度事件名。
pub const EVENT_VOICE: &str = "voice-change-progress";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcClip {
    pub clip_id: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcClipResult {
    pub clip_id: String,
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoProgress {
    state: String,
    progress: f32,
    index: usize,
    total: usize,
    message: Option<String>,
}

static CANCEL: AtomicBool = AtomicBool::new(false);

fn emit(
    app: &AppHandle,
    state: &str,
    progress: f32,
    index: usize,
    total: usize,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_VOICE,
        VoProgress {
            state: state.into(),
            progress: progress.clamp(0.0, 1.0),
            index,
            total,
            message,
        },
    );
}

fn cancelled() -> bool {
    CANCEL.load(Ordering::Relaxed)
}

/// 批量进度的纯函数：第 `index` 个片段内部的 `inner`（0..1）折算到总进度。
pub(crate) fn clip_progress(index: usize, total: usize, inner: f32) -> f32 {
    if total == 0 {
        return 0.0;
    }
    ((index as f32 + inner.clamp(0.0, 1.0)) / total as f32).clamp(0.0, 1.0)
}

/// 片段 id 派生噪声种子：同一片段重复跑结果一致。
pub(crate) fn seed_of(clip_id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in clip_id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn library(app: &AppHandle) -> Result<VoiceLibrary, String> {
    VoiceLibrary::open(&paths::data_dir(app)?.join("voices"))
}

fn to_16k(interleaved: &[f32], channels: usize) -> Vec<f32> {
    let channels = channels.max(1);
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    crate::audio_ai::resample::resample(&mono, OUT_SAMPLE_RATE as f64, REF_SR)
}

fn upsample(mono: &[f32]) -> Vec<f32> {
    let stereo = crate::audio_ai::resample::resample(mono, REF_SR, OUT_SAMPLE_RATE as f64);
    stereo.iter().flat_map(|v| [*v, *v]).collect()
}

/// 批量变声：片段串行处理，结果写到缓存目录，返回每个片段的输出路径。
#[tauri::command]
pub async fn voice_change_convert(
    app: AppHandle,
    clips: Vec<VcClip>,
    voice_id: String,
    model_id: String,
) -> Result<Vec<VcClipResult>, String> {
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "voice-change" {
        return Err(format!("{} 不是变声模型", entry.name));
    }
    if clips.is_empty() {
        return Err("没有要处理的片段".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let dir = models::require_dir(&app, entry)?;
    let spk = library(&app)?.embedding(&voice_id)?;
    let total = clips.len();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<VcClipResult>, String> {
        let mut model = Model::load(&dir, 2)?;
        let mut results = Vec::with_capacity(total);
        for (index, clip) in clips.iter().enumerate() {
            if cancelled() {
                return Err("已取消".into());
            }
            emit(
                &app_for_task,
                "decoding",
                clip_progress(index, total, 0.02),
                index,
                total,
                None,
            );
            let interleaved = tauri::async_runtime::block_on(decode_segment(
                &app_for_task,
                &clip.path,
                clip.start,
                clip.duration,
            ))?;
            if interleaved.is_empty() {
                return Err(format!("片段 {} 没有音频", clip.clip_id));
            }
            let mono = to_16k(&interleaved, OUT_CHANNELS as usize);
            emit(
                &app_for_task,
                "processing",
                clip_progress(index, total, 0.05),
                index,
                total,
                None,
            );
            let out = model.convert(&mono, &spk, seed_of(&clip.clip_id), &|p| {
                emit(
                    &app_for_task,
                    "processing",
                    clip_progress(index, total, 0.05 + p * 0.9),
                    index,
                    total,
                    None,
                );
                !cancelled()
            })?;
            emit(
                &app_for_task,
                "writing",
                clip_progress(index, total, 0.97),
                index,
                total,
                None,
            );
            let path = crate::media::cache_dir(&app_for_task)?
                .join(format!("voice-{}.wav", clip.clip_id));
            write_wav(&path, &upsample(&out), OUT_CHANNELS, OUT_SAMPLE_RATE)?;
            results.push(VcClipResult {
                clip_id: clip.clip_id.clone(),
                path: path.to_string_lossy().into_owned(),
                duration: out.len() as f64 / REF_SR,
            });
        }
        emit(
            &app_for_task,
            "done",
            1.0,
            total,
            total,
            Some("变声完成".into()),
        );
        Ok(results)
    })
    .await
    .map_err(|e| format!("变声任务异常：{e}"))?
}

#[tauri::command]
pub fn voice_change_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn voice_change_voice_list(app: AppHandle) -> Result<Vec<VoiceEntry>, String> {
    library(&app)?.list()
}

/// 从素材里截一段有声的参考音频，算出说话人向量后存进音色库。
#[tauri::command]
pub async fn voice_change_voice_import(
    app: AppHandle,
    asset_path: String,
    name: String,
    start: Option<f64>,
    duration: Option<f64>,
    speaker_model_id: String,
) -> Result<VoiceEntry, String> {
    let entry = models::by_id(&speaker_model_id)
        .ok_or_else(|| format!("未知模型：{speaker_model_id}"))?;
    if entry.id != "meanvc2-speaker" {
        return Err("需要 MeanVC2 音色编码器".into());
    }
    let dir = models::require_dir(&app, entry)?;

    let start = start.unwrap_or(0.0).max(0.0);
    let duration = duration.unwrap_or(0.0);
    let decoded = if duration > 0.0 {
        decode_segment(&app, &asset_path, start, duration).await?
    } else {
        let seconds = probe_duration(&app, std::path::Path::new(&asset_path))
            .await?
            .max(0.1);
        decode_segment(&app, &asset_path, 0.0, seconds).await?
    };
    let mono = to_16k(&decoded, OUT_CHANNELS as usize);
    let window = pick_window(&mono, REF_SR)
        .ok_or_else(|| "参考音频里没有足够的连续人声（至少 3 秒），换一段试试".to_string())?;
    let mut reference = mono[window.start..window.start + window.len].to_vec();
    normalize(&mut reference, -3.0);

    let (embedding, reference) = tauri::async_runtime::spawn_blocking(move || {
        let mut model = Model::load(&dir, 2)?;
        let embedding = model.embed(&reference)?;
        Ok::<_, String>((embedding, reference))
    })
    .await
    .map_err(|e| format!("音色编码异常：{e}"))??;

    library(&app)?.add(
        name,
        VoiceSource {
            asset_id: None,
            name: asset_path,
        },
        &reference,
        &embedding,
    )
}

#[tauri::command]
pub fn voice_change_voice_delete(app: AppHandle, id: String) -> Result<(), String> {
    library(&app)?.remove(&id)
}

#[cfg(test)]
mod tests {
    #[test]
    fn batch_progress_is_monotonic() {
        let mut last = 0.0f32;
        for (index, inner) in [(0usize, 0.0f32), (0, 0.5), (1, 0.0), (1, 1.0)] {
            let p = super::clip_progress(index, 2, inner);
            assert!(p >= last, "{p} < {last}");
            last = p;
        }
        assert!((last - 1.0).abs() < 1e-6);
    }

    #[test]
    fn seeds_differ_between_clips() {
        assert_ne!(super::seed_of("clip-a"), super::seed_of("clip-b"));
        assert_eq!(super::seed_of("clip-a"), super::seed_of("clip-a"));
    }
}
