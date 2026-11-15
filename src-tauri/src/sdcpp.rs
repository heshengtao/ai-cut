//! stable-diffusion.cpp 引擎管理的**桌面壳薄层**：实现已搬到 `aicut_daemon::sdcpp`。
//!
//! 为什么要搬：引擎清单 / 多源下载 / 续传 / sha256 校验 / 解压 / 选择全是纯逻辑，
//! 只依赖 `Host`（目录 / 事件）与 `NetworkRuntime`（代理 / 镜像 / 区域偏好）。
//! 搬进 daemon 之后，浏览器与容器版本也能下载引擎、切换视频后端。
//!
//! 这里只做三件事：
//! 1. 把共用类型 re-export 回来，既有的 `crate::sdcpp::SdcppInfo` 等路径不变；
//! 2. 提供 `#[tauri::command]` 薄壳，命令名与参数名保持历史约定（前端照原样调用）；
//! 3. 保留桌面独有的「在文件管理器里显示」。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

// 枚举本体在 daemon（与 `BackendPreference` 一起），桌面壳只 re-export。
pub use aicut_daemon::ai_backend::SdcppBackend;

// 纯数据 / 事件名：桌面与无头同一份。
//
// 这里刻意整组 re-export（不只 `SdcppInfo` / `SdcppStatus`）：`crate::sdcpp::*`
// 是既有调用点用的路径，删掉其中任何一个都会让别处的 `use` 突然失效。
#[allow(unused_imports)]
pub use aicut_daemon::sdcpp::{
    best_device, busy, usable_device, SdcppInfo, SdcppOption, SdcppProgress, SdcppStatus,
    EVENT_SDCPP,
};

fn host_of(app: &AppHandle) -> TauriHost {
    TauriHost::new(app.clone())
}

/// 某个引擎（下载条目 id）的安装目录。
pub fn engine_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    aicut_daemon::sdcpp::engine_dir(&host_of(app), id)
}

#[tauri::command]
pub fn sdcpp_catalog(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
) -> Vec<SdcppStatus> {
    aicut_daemon::sdcpp::sdcpp_catalog(&host_of(&app), state.inner().as_ref())
}

#[tauri::command]
pub fn sdcpp_info(app: AppHandle, state: State<'_, Arc<NetworkRuntime>>) -> SdcppInfo {
    aicut_daemon::sdcpp::sdcpp_info(&host_of(&app), state.inner().as_ref())
}

#[tauri::command]
pub fn sdcpp_set_backend(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    backend: SdcppBackend,
) -> Result<SdcppInfo, String> {
    aicut_daemon::sdcpp::sdcpp_set_backend(&host_of(&app), state.inner().as_ref(), backend)
}

#[tauri::command]
pub fn sdcpp_select(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    id: Option<String>,
) -> Result<(), String> {
    aicut_daemon::sdcpp::sdcpp_select(&host_of(&app), state.inner().as_ref(), id)
}

#[tauri::command]
pub fn sdcpp_remove(app: AppHandle, id: String) -> Result<(), String> {
    aicut_daemon::sdcpp::sdcpp_remove(&host_of(&app), id)
}

/// 在系统文件管理器里显示引擎目录（桌面专属：无头进程没有文件管理器）。
#[tauri::command]
pub fn sdcpp_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let dir = engine_dir(&app, &id)?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    crate::models::reveal_in_file_manager(&dir)
}

#[tauri::command]
pub fn sdcpp_cancel() {
    aicut_daemon::sdcpp::sdcpp_cancel()
}

#[tauri::command]
pub fn sdcpp_busy() -> bool {
    aicut_daemon::sdcpp::sdcpp_busy()
}

#[tauri::command]
pub async fn sdcpp_install(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    id: String,
    force: Option<bool>,
) -> Result<(), String> {
    let host = host_of(&app);
    aicut_daemon::sdcpp::sdcpp_install(&host, state.inner().as_ref(), id, force).await
}

/// 启动时清掉上次没下完的暂存目录（`.download`）。
pub fn init(app: &AppHandle) {
    aicut_daemon::sdcpp::init(&host_of(app))
}
