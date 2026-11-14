//! 素材预检的**桌面壳薄层**：实现已搬到 `aicut_daemon::analysis`。
//!
//! 一次调用返回元数据、运动 / 镜头切点、目标框与语音转写。它是智能体的
//! "省 token 入口"：与其渲染很多帧再逐张看图，不如直接拿结构化结果。
//! 采样与转写都走已经下沉的 `video_ai` / `asr`，所以这里只剩一层壳。

use std::sync::Arc;

use serde_json::Value;
use tauri::AppHandle;

use crate::host::TauriHost;

pub use aicut_daemon::analysis::{ObjectMode, ProbeOptions};

pub async fn probe(app: AppHandle, path: String, options: ProbeOptions) -> Result<Value, String> {
    let host: Arc<dyn aicut_daemon::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::analysis::probe(&host, path, options).await
}
