//! 视频 AI 的**桌面壳薄层**：实现已搬到 `aicut_daemon::video_ai`。
//!
//! 超分（Real-ESRGAN）、补帧（RIFE）、智能裁剪 / 镜头追踪（YOLOX + YuNet）都是
//! 「ffmpeg 解码 → ONNX 推理 → ffmpeg 编码」，ffmpeg 走 `AICUT_FFMPEG` / PATH，
//! 推理走 `ai_session`——没有一处需要 Tauri。搬走之后浏览器与容器也能跑。

use std::sync::Arc;

use tauri::AppHandle;

use crate::host::TauriHost;

pub use aicut_daemon::video_ai::{
    detect, esrgan, frames, rife, AnalysisSample, VideoAiProgress, VideoProcessed, EVENT_VIDEO_AI,
};

fn host_of(app: AppHandle) -> Arc<dyn aicut_daemon::Host> {
    Arc::new(TauriHost::new(app))
}

#[tauri::command]
pub async fn video_ai_upscale(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    model_id: String,
    scale: u32,
) -> Result<VideoProcessed, String> {
    aicut_daemon::video_ai::video_ai_upscale(
        &host_of(app),
        path,
        start,
        duration,
        fps,
        model_id,
        scale,
    )
    .await
}

#[tauri::command]
pub async fn video_ai_upscale_image(
    app: AppHandle,
    path: String,
    model_id: String,
    scale: u32,
) -> Result<VideoProcessed, String> {
    aicut_daemon::video_ai::video_ai_upscale_image(&host_of(app), path, model_id, scale).await
}

#[tauri::command]
pub async fn video_ai_interpolate(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    model_id: String,
    factor: u32,
) -> Result<VideoProcessed, String> {
    aicut_daemon::video_ai::video_ai_interpolate(
        &host_of(app),
        path,
        start,
        duration,
        fps,
        model_id,
        factor,
    )
    .await
}

#[tauri::command]
pub async fn video_ai_reframe(
    app: AppHandle,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    yolo_model_id: Option<String>,
    yunet_model_id: Option<String>,
    subject: String,
    aspect: String,
    height: u32,
    smooth: f32,
) -> Result<VideoProcessed, String> {
    aicut_daemon::video_ai::video_ai_reframe(
        &host_of(app),
        path,
        start,
        duration,
        fps,
        yolo_model_id,
        yunet_model_id,
        subject,
        aspect,
        height,
        smooth,
    )
    .await
}

#[tauri::command]
pub async fn video_ai_samples(
    app: AppHandle,
    path: String,
    interval: f64,
    max_samples: usize,
    subject: String,
) -> Result<Vec<AnalysisSample>, String> {
    aicut_daemon::video_ai::video_ai_samples(&host_of(app), path, interval, max_samples, subject)
        .await
}

#[tauri::command]
pub fn video_ai_cancel() {
    aicut_daemon::video_ai::video_ai_cancel()
}
