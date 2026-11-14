//! 历史工程（桌面端入口）：实现住在 `aicut_daemon::history`。
//!
//! 为什么搬走：浏览器端也要有「历史工程」。无头进程没有 AppHandle，只有数据目录，
//! 所以实现只依赖 `&Path`，桌面壳在这里补上 Tauri 的两件事——句柄 → 数据目录、
//! `#[tauri::command]` 签名。

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

pub use aicut_daemon::history::{HistoryEntry, HistorySnapshot};

fn history_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::paths::data_dir(app).map_err(|e| format!("取应用数据目录失败：{e}"))
}

/// 列出历史工程（最新的在前）。
#[tauri::command]
pub fn project_history_list<R: Runtime>(app: AppHandle<R>) -> Vec<HistoryEntry> {
    history_root(&app)
        .map(|dir| aicut_daemon::history::list(&dir))
        .unwrap_or_default()
}

/// 记录一份历史；空白工程、或内容完全相同的工程会跳过。
#[tauri::command]
pub fn project_history_record<R: Runtime>(
    app: AppHandle<R>,
    project: String,
    path: Option<String>,
    dirty: bool,
    thumbnail: Option<String>,
) -> Result<Option<HistoryEntry>, String> {
    let root = history_root(&app)?;
    aicut_daemon::history::record(&root, project, path, dirty, thumbnail)
}

/// 读取一份历史工程。
#[tauri::command]
pub fn project_history_get<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<HistorySnapshot, String> {
    let root = history_root(&app)?;
    aicut_daemon::history::get(&root, id)
}

/// 删除一份历史工程（索引项 + 快照文件）。
#[tauri::command]
pub fn project_history_delete<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let root = history_root(&app)?;
    aicut_daemon::history::delete(&root, id)
}
