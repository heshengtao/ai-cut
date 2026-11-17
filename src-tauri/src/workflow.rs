//! 工作流库（桌面端入口）：实现住在 `aicut_daemon::workflow`。
//!
//! 与 `history` 同一分工：实现只依赖数据目录（浏览器端也要用），桌面壳在这里补上
//! 句柄 → 数据目录的解析和 `#[tauri::command]` 签名。

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};

pub use aicut_daemon::workflow::{SaveWorkflowRequest, WorkflowSnapshot, WorkflowVersion};

fn workflow_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::paths::data_dir(app).map_err(|e| format!("取应用数据目录失败：{e}"))
}

/// 列出工作流版本（最新的在前）。
#[tauri::command]
pub fn workflow_list<R: Runtime>(app: AppHandle<R>) -> Vec<WorkflowVersion> {
    workflow_root(&app)
        .map(|dir| aicut_daemon::workflow::list(&dir))
        .unwrap_or_default()
}

/// 保存一份工作流：给已有卡片追加版本，或新建一张卡片。
#[tauri::command]
pub fn workflow_save<R: Runtime>(
    app: AppHandle<R>,
    request: SaveWorkflowRequest,
) -> Result<WorkflowVersion, String> {
    let root = workflow_root(&app)?;
    aicut_daemon::workflow::save(&root, request)
}

/// 读取一个工作流版本（元信息 + 节点 / 连线）。
#[tauri::command]
pub fn workflow_get<R: Runtime>(app: AppHandle<R>, id: String) -> Result<WorkflowSnapshot, String> {
    let root = workflow_root(&app)?;
    aicut_daemon::workflow::get(&root, id)
}

/// 删除一张卡片的**所有**版本。
#[tauri::command]
pub fn workflow_delete<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let root = workflow_root(&app)?;
    aicut_daemon::workflow::delete(&root, id)
}

/// 重命名一张卡片（所有版本一起改）。
#[tauri::command]
pub fn workflow_rename<R: Runtime>(
    app: AppHandle<R>,
    root_id: String,
    name: String,
) -> Result<WorkflowVersion, String> {
    let root = workflow_root(&app)?;
    aicut_daemon::workflow::rename(&root, root_id, name)
}
