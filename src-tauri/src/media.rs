//! 媒体探测与派生产物（缩略图 / 波形）。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::sidecar::run_sidecar;

/// ffprobe 探测结果。`kind` 由前端按扩展名判定。
#[derive(Serialize, Default)]
pub struct MediaMeta {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// 旋转元数据（0 / 90 / 180 / 270）；手机视频常见。
    pub rotation: Option<i32>,
    pub has_video: bool,
    pub has_audio: bool,
    /// 容器名（如 `mov,mp4,m4a,3gp,3g2,mj2`）。
    pub format_name: String,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

/// 解析 ffprobe 的 `r_frame_rate`（形如 `30/1`）。
fn parse_frame_rate(raw: &str) -> Option<f64> {
    let (num, den) = raw.split_once('/').unwrap_or((raw, "1"));
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

#[tauri::command]
pub async fn probe_media<R: Runtime>(app: AppHandle<R>, path: String) -> Result<MediaMeta, String> {
    let args: Vec<String> = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        path.clone(),
    ];

    let (code, stdout) = run_sidecar(&app, "ffprobe", &args).await?;
    if code != Some(0) {
        return Err(format!("ffprobe 无法读取：{path}"));
    }

    let json: serde_json::Value =
        serde_json::from_slice(&stdout).map_err(|e| format!("ffprobe 输出解析失败：{e}"))?;
    let streams = json
        .get("streams")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    fn codec_of(s: &serde_json::Value) -> &str {
        s.get("codec_type").and_then(|c| c.as_str()).unwrap_or("")
    }

    // attached_pic 是封面图，不算真正的视频轨。
    let is_attached_pic = |s: &serde_json::Value| {
        s.get("disposition")
            .and_then(|d| d.get("attached_pic"))
            .and_then(|a| a.as_i64())
            .unwrap_or(0)
            == 1
    };

    let video = streams
        .iter()
        .find(|s| codec_of(s) == "video" && !is_attached_pic(s));
    let audio = streams.iter().find(|s| codec_of(s) == "audio");

    let mut meta = MediaMeta {
        has_video: video.is_some(),
        has_audio: audio.is_some(),
        ..Default::default()
    };

    let codec_name = |s: &serde_json::Value| {
        s.get("codec_name")
            .and_then(|c| c.as_str())
            .map(|c| c.to_string())
    };

    if let Some(v) = video {
        meta.width = v.get("width").and_then(|x| x.as_u64()).map(|x| x as u32);
        meta.height = v.get("height").and_then(|x| x.as_u64()).map(|x| x as u32);
        meta.fps = v
            .get("r_frame_rate")
            .and_then(|x| x.as_str())
            .and_then(parse_frame_rate);
        meta.rotation = v
            .get("side_data_list")
            .and_then(|list| list.as_array())
            .and_then(|list| {
                list.iter().find_map(|item| {
                    item.get("rotation")
                        .and_then(|rotation| {
                            rotation
                                .as_i64()
                                .or_else(|| rotation.as_f64().map(|value| value as i64))
                        })
                        .map(|rotation| rotation as i32)
                })
            })
            .or_else(|| {
                v.get("tags")
                    .and_then(|tags| tags.get("rotate"))
                    .and_then(|rotate| rotate.as_str())
                    .and_then(|rotate| rotate.parse::<i32>().ok())
            });
        meta.video_codec = codec_name(v);
    }
    if let Some(a) = audio {
        meta.audio_codec = codec_name(a);
    }

    meta.format_name = json
        .get("format")
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    meta.duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    // 单帧图片（无时长）在 ffprobe 里可能给不出 duration：当成 0。
    if !meta.duration.is_finite() {
        meta.duration = 0.0;
    }

    Ok(meta)
}

// ---------------------------------------------------------------------------
// 预览兼容层
//
// WebView 能直接解码的容器/编码有限（尤其 MOV 里的 PCM、MKV/AVI 等）。
// 这里统一用打包的 ffmpeg 生成缓存副本：音轨 → AAC/M4A，视频 → H.264/AAC MP4。
// 缓存按「路径 + 大小 + 修改时间」命名，源文件变化会自动重新生成。
// ---------------------------------------------------------------------------

/// 源文件指纹。
fn source_fingerprint(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(stamp) = modified.duration_since(UNIX_EPOCH) {
                stamp.as_nanos().hash(&mut hasher);
            }
        }
    }
    format!("{:016x}", hasher.finish())
}

/// 素材 id → 安全的文件名片段。
fn safe_file_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "asset".to_string()
    } else {
        cleaned
    }
}

fn cache_ready(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() > 0)
        .unwrap_or(false)
}

/// 把任意格式的音轨转成 WebAudio 稳定可解码的 AAC/M4A（放在缓存目录）。
///
/// 视频素材也走这里：避免把整个视频文件读进内存再 `decodeAudioData`。
#[tauri::command]
pub async fn extract_audio_preview<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
) -> Result<String, String> {
    let cache = cache_dir(&app)?;
    let id = safe_file_id(&asset_id);
    let stamp = source_fingerprint(&path);
    let out = cache.join(format!("audio-{id}-{stamp}.m4a"));
    if cache_ready(&out) {
        return Ok(out.to_string_lossy().into_owned());
    }

    let tmp = cache.join(format!(".audio-{}-{id}-{stamp}.m4a", std::process::id()));
    let _ = std::fs::remove_file(&tmp);

    let args: Vec<String> = vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-i".into(),
        path.clone(),
        "-map".into(),
        "0:a:0?".into(),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "48000".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        tmp.to_string_lossy().into_owned(),
    ];

    let (code, _) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) || !cache_ready(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("无法提取音频：{path}"));
    }
    std::fs::rename(&tmp, &out).map_err(|e| format!("写入音频缓存失败：{e}"))?;
    Ok(out.to_string_lossy().into_owned())
}

/// 把 WebView 放不了的视频容器 / 编码转成 H.264 + AAC 的 MP4 预览。
#[tauri::command]
pub async fn make_video_preview<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
) -> Result<String, String> {
    let cache = cache_dir(&app)?;
    let id = safe_file_id(&asset_id);
    let stamp = source_fingerprint(&path);
    let out = cache.join(format!("preview-{id}-{stamp}.mp4"));
    if cache_ready(&out) {
        return Ok(out.to_string_lossy().into_owned());
    }

    let tmp = cache.join(format!(".preview-{}-{id}-{stamp}.mp4", std::process::id()));
    let _ = std::fs::remove_file(&tmp);

    let args: Vec<String> = vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-i".into(),
        path.clone(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        // H.264 的 yuv420p 要求宽高为偶数；超过 1080p 的宽度缩到 1920。
        "-vf".into(),
        "scale='min(1920,iw)':-2,pad=ceil(iw/2)*2:ceil(ih/2)*2".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "21".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-ac".into(),
        "2".into(),
        "-movflags".into(),
        "+faststart".into(),
        tmp.to_string_lossy().into_owned(),
    ];

    let (code, _) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) || !cache_ready(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("无法生成视频预览：{path}"));
    }
    std::fs::rename(&tmp, &out).map_err(|e| format!("写入预览缓存失败：{e}"))?;
    Ok(out.to_string_lossy().into_owned())
}

/// 波形分桶数。片段缩放、裁剪时按素材内时间重新采样，桶数越多细节越真实。
const WAVE_BUCKETS: usize = 2048;

#[tauri::command]
pub async fn make_thumbnail<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
    at_sec: f64,
) -> Result<String, String> {
    let file = format!("{asset_id}.png");
    let out = cache_dir(&app)?.join(&file);

    let args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        format!("{at_sec}"),
        "-i".into(),
        path,
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=320:-1".into(),
        out.to_string_lossy().to_string(),
    ];

    let (code, _) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) || !out.exists() {
        return Err("生成缩略图失败".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn make_waveform<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
) -> Result<Vec<u8>, String> {
    // 解码成 8kHz 单声道 s16le 走 stdout：数据量小，且不产生临时文件。
    let args: Vec<String> = vec![
        "-v".into(),
        "quiet".into(),
        "-i".into(),
        path,
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "8000".into(),
        "-f".into(),
        "s16le".into(),
        "-".into(),
    ];

    let (code, stdout) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) {
        return Err("提取音频失败".into());
    }

    let peaks = compute_peaks(&stdout, WAVE_BUCKETS);
    if peaks.is_empty() {
        return Err("音频为空".into());
    }

    let cache = cache_dir(&app)?.join(format!("{asset_id}.wave.json"));
    if let Ok(json) = serde_json::to_string(&peaks) {
        let _ = std::fs::write(cache, json);
    }
    Ok(peaks)
}

/// 把 s16le PCM 分桶成 0..100 的峰值。
///
/// 每个桶按**整段样本的均匀比例**分配，保证桶数组完整覆盖 0 → 结尾；
/// 之前用整数 `per_bucket` 会在不能整除时丢掉尾部，导致波形被时间压缩。
fn compute_peaks(pcm: &[u8], buckets: usize) -> Vec<u8> {
    if buckets == 0 || pcm.len() < 2 {
        return Vec::new();
    }
    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    if samples.is_empty() {
        return Vec::new();
    }

    let buckets = buckets.min(samples.len());
    let mut peaks = Vec::with_capacity(buckets);
    for i in 0..buckets {
        let start = i * samples.len() / buckets;
        let end = (((i + 1) * samples.len()) / buckets).max(start + 1).min(samples.len());
        let peak = samples[start..end]
            .iter()
            .map(|s| s.unsigned_abs() as u32)
            .max()
            .unwrap_or(0);
        let scaled = (f64::from(peak) / 32768.0 * 100.0).round();
        peaks.push(scaled.clamp(0.0, 100.0) as u8);
    }
    peaks
}

#[cfg(test)]
mod tests {
    use super::{compute_peaks, safe_file_id, source_fingerprint};

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn sanitizes_asset_ids_for_cache_names() {
        assert_eq!(safe_file_id("a1b2-c3_d4"), "a1b2-c3_d4");
        assert_eq!(safe_file_id("../a/b"), "ab");
        assert_eq!(safe_file_id(""), "asset");
    }

    #[test]
    fn fingerprints_differ_by_path_and_are_stable_for_missing_files() {
        let a = source_fingerprint("/tmp/does-not-exist-a.mov");
        let b = source_fingerprint("/tmp/does-not-exist-b.mov");
        assert_ne!(a, b);
        assert_eq!(a, a);
    }

    #[test]
    fn peaks_cover_the_whole_signal() {
        // 1005 个样本分成 100 桶：最后一个桶必须覆盖到结尾的峰值。
        let mut samples = vec![0i16; 1004];
        samples.push(i16::MAX);
        let peaks = compute_peaks(&pcm(&samples), 100);
        assert_eq!(peaks.len(), 100);
        assert_eq!(peaks[99], 100);
    }

    #[test]
    fn peaks_keep_the_head_of_the_signal() {
        let mut samples = vec![0i16; 1004];
        samples[0] = i16::MIN;
        let peaks = compute_peaks(&pcm(&samples), 100);
        assert_eq!(peaks[0], 100);
    }

    #[test]
    fn peaks_handle_tiny_inputs() {
        assert!(compute_peaks(&[], 100).is_empty());
        assert_eq!(compute_peaks(&pcm(&[i16::MAX]), 100), vec![100]);
    }
}

/// 应用数据目录下的 cache/，用于缩略图与波形缓存。
pub(crate) fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    Ok(dir)
}
