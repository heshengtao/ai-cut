//! 本地图像生成 / 图像编辑的**桌面壳薄层**：实现已搬到 `aicut_daemon::image_gen`。
//!
//! 为什么要搬：拼 `sd-cli` 参数、起子进程、解析 step 进度、取消、权重角色匹配
//! 全是纯逻辑，只依赖 `Host`（目录 / 事件 / 跑 ffmpeg）与 `NetworkRuntime`（引擎选择）。
//! 搬进 daemon 之后，浏览器与容器版本也能本地出图。
//!
//! 这里只做三件事：
//! 1. 把共用类型 re-export 回来，既有的 `crate::image_gen::ImageSpec` 等路径不变；
//! 2. 提供 `#[tauri::command]` 薄壳，命令名与参数名保持历史约定（前端照原样调用）；
//! 3. 保留 `prepare_init_image` 这个桌面内部入口（实现同样在 daemon）。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

// 纯数据 / 规格 / 事件名：桌面与无头同一份。
//
// 这里刻意整组 re-export（不只命令用得到的两个）：`crate::image_gen::*` 是既有
// 调用点用的路径，删掉其中任何一个都会让别处的 `use` 突然失效。
#[allow(unused_imports)]
pub use aicut_daemon::image_gen::{
    is_running, FileRole, ImageGenProgress, ImageGenRequest, ImageGenResult, ImageSpec, ModelFiles,
    TextEncoder, WeightLayout, EVENT_IMAGE_GEN,
};

/// 把素材库里的任意图片转成 PNG（云端出图与本地 sd.cpp 共用同一份缩放规则）。
///
/// 本地生成已经整体下沉到 daemon（内部直接调 `image_prep`），这个薄壳留给还按
/// `AppHandle` 调用的桌面模块。
#[allow(dead_code)]
pub(crate) async fn prepare_init_image(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    let host = TauriHost::new(app.clone());
    aicut_daemon::image_prep::prepare_init_image(&host, source).await
}

#[tauri::command]
pub async fn image_gen_start(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    request: ImageGenRequest,
) -> Result<ImageGenResult, String> {
    let host: Arc<dyn aicut_daemon::host::Host> = Arc::new(TauriHost::new(app));
    aicut_daemon::image_gen::image_gen_start(&host, state.inner().as_ref(), request).await
}

#[tauri::command]
pub fn image_gen_cancel() {
    aicut_daemon::image_gen::image_gen_cancel()
}

/// 当前是否有图像生成任务（界面挂载时纠正状态用）。
#[tauri::command]
pub fn image_gen_busy() -> bool {
    aicut_daemon::image_gen::image_gen_busy()
}
