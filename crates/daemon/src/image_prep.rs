//! 输入图片预处理：把用户选的本地图片转成统一的 PNG（长边 ≤ 2048）。
//!
//! 云端出图（`cloud_gen`）与本地 sd.cpp（`image_gen`）都要这一份：
//! - 提前缩小可以避免 stb_image 把整张 50MP 原图读进内存；
//! - 统一 PNG 之后两边的"图生图"入口行为一致。
//!
//! 不依赖 Tauri：ffmpeg 走 `Host::run`，落盘目录走 `media::media_cache_dir`。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::host::Host;
use crate::media;

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0)
}

/// 把 `source` 转成缓存目录里的 PNG，返回路径。
pub async fn prepare_init_image(host: &dyn Host, source: &str) -> Result<PathBuf, String> {
    if !Path::new(source).is_file() {
        return Err(format!("原图不存在：{source}"));
    }
    let dir = PathBuf::from(media::media_cache_dir(host)?);
    let target = dir.join(format!(
        "image-gen-init-{}-{}.png",
        std::process::id(),
        stamp()
    ));
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        source.into(),
        "-frames:v".into(),
        "1".into(),
        // 长边超过 2048 的照片先缩下来：sd.cpp 反正会按请求尺寸重采样，
        // 提前缩小可以避免 stb_image 把整张 50MP 原图读进内存。
        "-vf".into(),
        "scale=w='min(iw\\,2048)':h='min(ih\\,2048)':force_original_aspect_ratio=decrease".into(),
        target.to_string_lossy().into_owned(),
    ];
    let out = host
        .run("ffmpeg", &args, Default::default())
        .await
        .map_err(|error| format!("转码调用失败：{error}"))?;
    if out.code != Some(0) || !target.is_file() {
        return Err(format!("无法读取原图：{source}"));
    }
    Ok(target)
}
