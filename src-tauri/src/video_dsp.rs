//! 无模型视频处理的**桌面壳薄层**：实现已搬到 `aicut_daemon::video_dsp`。
//!
//! 处理本身只是"拼滤镜链 + 一次 ffmpeg 转码"，ffmpeg 从 `Host` 跑；下沉之后
//! 浏览器 / 容器版本也能用同一套防抖 / 降噪 / 去频闪 / 运动模糊 / 放大。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;

pub use aicut_daemon::video_dsp::{
    Strength, VideoDspOptions, VideoDspProgress, VideoDspState, VideoProcessed, EVENT_VIDEO_DSP,
};

#[tauri::command]
pub async fn video_dsp_process(
    app: AppHandle,
    state: State<'_, Arc<VideoDspState>>,
    path: String,
    start: f64,
    duration: f64,
    fps: f64,
    options: VideoDspOptions,
) -> Result<VideoProcessed, String> {
    let host = TauriHost::new(app);
    aicut_daemon::video_dsp::video_dsp_process(
        &host,
        state.inner(),
        path,
        start,
        duration,
        fps,
        options,
    )
    .await
}

#[tauri::command]
pub fn video_dsp_cancel(state: State<'_, Arc<VideoDspState>>) -> Result<(), String> {
    aicut_daemon::video_dsp::video_dsp_cancel(state.inner())
}
