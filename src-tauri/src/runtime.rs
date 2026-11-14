//! ONNX Runtime 运行库管理的**桌面壳薄层**：实现已搬到 `aicut_daemon::runtime_ort`。
//!
//! 清单、随包基线判定、CUDA 组件成套下载、断点续传、解包、待删除/待重启清单——全是纯逻辑，
//! 只依赖 `Host`（配置目录 / 事件）与 `NetworkRuntime`（代理 / 镜像）。下沉之后，
//! 浏览器与容器版本也能看运行库状态、装 / 删 CUDA（容器里通常用随包 CPU 那份）。
//!
//! 这里保留 `AppHandle` 签名，是为了不动 `backend` / `sdcpp` / `plugins` 里的既有调用点。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::runtime_ort::{bytes, cuda_flavor_of, RuntimeStatus, EVENT_RUNTIME};

#[cfg(not(target_os = "macos"))]
pub use aicut_daemon::runtime_ort::cuda_component_dirs;

#[tauri::command]
pub fn runtime_cancel() {
    aicut_daemon::runtime_ort::runtime_cancel()
}

#[tauri::command]
pub fn runtime_busy() -> bool {
    aicut_daemon::runtime_ort::runtime_busy()
}

fn host_of(app: &AppHandle) -> TauriHost {
    TauriHost::new(app.clone())
}

pub fn busy() -> bool {
    aicut_daemon::runtime_ort::busy()
}

pub fn installed(app: &AppHandle, id: &str) -> bool {
    aicut_daemon::runtime_ort::installed(&host_of(app), id)
}

pub fn missing_components(app: &AppHandle, core: &str) -> Vec<&'static str> {
    aicut_daemon::runtime_ort::missing_components(&host_of(app), core)
}

pub fn installed_runtime_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    aicut_daemon::runtime_ort::installed_runtime_dir(&host_of(app), id)
}

pub fn restart_pending(app: &AppHandle) -> bool {
    aicut_daemon::runtime_ort::restart_pending(&host_of(app))
}

pub fn init(app: &AppHandle) {
    aicut_daemon::runtime_ort::init(&host_of(app))
}

/// 把当前执行后端偏好交给运行时模块（决定"装/删是否需要重启"的提示）。
pub fn set_preference(preference: crate::backend::BackendPreference) {
    aicut_daemon::runtime_ort::set_preference(preference)
}

/// 桌面专属：在文件管理器里显示运行库目录。
pub(crate) fn reveal_runtime_dir(dir: &Path) -> Result<(), String> {
    crate::models::reveal_in_file_manager(dir)
}

#[tauri::command]
pub fn runtime_catalog(app: AppHandle) -> Vec<RuntimeStatus> {
    aicut_daemon::runtime_ort::runtime_catalog(&host_of(&app))
}

#[tauri::command]
pub async fn runtime_install(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    id: String,
    force: Option<bool>,
) -> Result<(), String> {
    let host = host_of(&app);
    aicut_daemon::runtime_ort::runtime_install(&host, network.inner(), id, force).await
}

#[tauri::command]
pub fn runtime_remove(app: AppHandle, id: String) -> Result<(), String> {
    aicut_daemon::runtime_ort::runtime_remove(&host_of(&app), id)
}

#[tauri::command]
pub fn runtime_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let dir = aicut_daemon::runtime_ort::runtime_dir_for(&host_of(&app), &id)?;
    crate::models::reveal_in_file_manager(&dir)
}

#[tauri::command]
pub fn app_restart(app: AppHandle) -> Result<(), String> {
    // 开发模式下重新拉起的进程仍指向 devUrl，而 dev server 会随旧进程退出——留一句提示。
    if cfg!(debug_assertions) {
        return Err("开发模式下自动重启会丢掉前端 dev server，请手动关闭应用后重新运行。".into());
    }
    app.restart()
}
