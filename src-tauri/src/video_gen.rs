//! 本地视频生成的**桌面壳薄层**：实现已搬到 `aicut_daemon::video_gen`。
//!
//! 为什么要搬：家族规格（帧率 / 帧数网格 / 编码器参数）、拼 `sd-cli` 参数、起子进程、
//! 解析 step 进度、取消、参考输入转码全是纯逻辑，只依赖 `Host`（目录 / 事件 / 跑 ffmpeg）
//! 与 `NetworkRuntime`（引擎选择）。搬进 daemon 之后，浏览器与容器版本也能本地出视频。
//!
//! 这里只做三件事：
//! 1. 把共用类型 re-export 回来，既有的 `crate::video_gen::VideoSpec` 等路径不变；
//! 2. 提供 `#[tauri::command]` 薄壳，命令名与参数名保持历史约定（前端照原样调用）；
//! 3. 保留 `is_running` / `align_dimension` 这类桌面内部还用的入口。

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

// 纯数据 / 规格 / 事件名：桌面与无头同一份。
//
// 这里刻意整组 re-export（不只命令用得到的两个）：`crate::video_gen::*` 是既有
// 调用点用的路径，删掉其中任何一个都会让别处的 `use` 突然失效。
#[allow(unused_imports)]
pub use aicut_daemon::video_gen::{
    align_dimension, is_running, FileRole, ModelFiles, TextEncoder, VideoGenProgress,
    VideoGenRequest, VideoGenResult, VideoSpec, EVENT_VIDEO_GEN,
};

#[tauri::command]
pub async fn video_gen_start(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    request: VideoGenRequest,
) -> Result<VideoGenResult, String> {
    let host: Arc<dyn aicut_daemon::host::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::video_gen::video_gen_start(&host, state.inner().as_ref(), request).await
}

#[tauri::command]
pub fn video_gen_cancel() {
    aicut_daemon::video_gen::video_gen_cancel()
}

/// 当前是否有生成任务（界面挂载时纠正状态用）。
#[tauri::command]
pub fn video_gen_busy() -> bool {
    aicut_daemon::video_gen::video_gen_busy()
}
