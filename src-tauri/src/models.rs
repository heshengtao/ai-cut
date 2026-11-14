//! 模型清单与下载器的**桌面壳薄层**：实现已搬到 `aicut_daemon::models`。
//!
//! 为什么搬：清单、路径解析、sha256 校验、多源下载、续传、硬链接复用——全是纯逻辑，
//! 只依赖 `Host`（目录 / 事件 / 跑 ffmpeg）与 `NetworkRuntime`（代理 / 镜像）。
//! 搬进 daemon 之后，浏览器与容器版本也能看模型、下模型、报"缺哪个组件"。
//!
//! 这里保留 `AppHandle` 签名，是为了不动散落在 `asr` / `tts` / `audio_ai` / `video_ai` /
//! `voice_change` 里的既有调用点（它们要等 M4 一起下沉）。

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

// 纯数据 / 清单：直接 re-export，桌面与无头同一份。
pub use aicut_daemon::models::{
    all, by_id, first_installed as first_installed_with_host, ModelAuth, ModelEntry, ModelFamily,
    ModelFile, ModelSource, ModelStatus, SourceProbe, EVENT_MODEL,
};

fn host_of(app: &AppHandle) -> TauriHost {
    TauriHost::new(app.clone())
}

/// 权重落地目录（配置目录的 `models/`）。
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    aicut_daemon::models::models_dir(&host_of(app))
}

/// 已安装目录：所有文件都在同一个候选目录里才算。
pub fn installed_dir(app: &AppHandle, entry: &ModelEntry) -> Option<PathBuf> {
    aicut_daemon::models::installed_dir(&host_of(app), entry)
}

/// 已安装目录，未安装时报错。
pub fn require_dir(app: &AppHandle, entry: &ModelEntry) -> Result<PathBuf, String> {
    aicut_daemon::models::require_dir(&host_of(app), entry)
}

/// 某个能力域下第一个已安装的模型。
pub fn first_installed(app: &AppHandle, feature: &str) -> Option<&'static ModelEntry> {
    aicut_daemon::models::first_installed(&host_of(app), feature)
}

#[tauri::command]
pub fn model_catalog(app: AppHandle) -> Vec<ModelStatus> {
    aicut_daemon::models::model_catalog(&host_of(&app))
}

#[tauri::command]
pub async fn model_download(
    app: AppHandle,
    network: State<'_, std::sync::Arc<NetworkRuntime>>,
    id: String,
) -> Result<Option<ModelAuth>, String> {
    let host = host_of(&app);
    aicut_daemon::models::model_download(&host, network.inner(), id).await
}

#[tauri::command]
pub async fn model_probe(
    app: AppHandle,
    network: State<'_, std::sync::Arc<NetworkRuntime>>,
    id: String,
) -> Result<Vec<SourceProbe>, String> {
    let host = host_of(&app);
    aicut_daemon::models::model_probe(&host, network.inner(), id).await
}

#[tauri::command]
pub fn model_cancel() {
    aicut_daemon::models::model_cancel()
}

#[tauri::command]
pub fn model_remove(app: AppHandle, id: String) -> Result<(), String> {
    aicut_daemon::models::model_remove(&host_of(&app), id)
}

/// 在系统文件管理器里显示模型文件（桌面专属：无头进程没有文件管理器）。
#[tauri::command]
pub fn model_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let entry = by_id(&id).ok_or_else(|| format!("未知模型：{id}"))?;
    let target = installed_dir(&app, entry)
        .or_else(|| {
            aicut_daemon::models::models_dir(&host_of(&app))
                .ok()
                .map(|dir| dir.join(entry.id))
        })
        .unwrap_or_else(|| models_dir(&app).unwrap_or_default());
    reveal_in_file_manager(&target)
}

/// 在系统文件管理器里显示任意路径（桌面专属，被 runtime / fonts / sdcpp 复用）。
pub(crate) fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let dir = path.parent().unwrap_or(path);
        let mut command = std::process::Command::new("xdg-open");
        command.arg(dir);
        command
    };
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}
