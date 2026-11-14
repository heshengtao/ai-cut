//! 字体库（桌面端入口）：实现住在 `aicut_daemon::fonts`。
//!
//! 为什么搬走：浏览器端也要能装字体。无头进程没有 AppHandle，只有数据目录，所以实现
//! 只依赖 `&Path` + 一个 HTTP 客户端 + 一个进度回调。桌面壳在这里补三件事：
//!
//! 1. 句柄 → 数据目录（`crate::paths::data_dir`）；
//! 2. 设置页的代理 → HTTP 客户端（`NetworkRuntime`，无头进程则用环境变量代理）；
//! 3. 进度事件 → `app.emit`（无头进程直接进 SSE 总线）。
//!
//! `font_reveal` 是唯一留在桌面端的：它要在系统文件管理器里打开目录。

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::network::NetworkRuntime;

pub use aicut_daemon::fonts::{FontManifest, FontProbe, FontRegistryView};

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::paths::data_dir(app).map_err(|e| format!("取应用数据目录失败：{e}"))
}

fn client<R: Runtime>(app: &AppHandle<R>) -> Result<reqwest::Client, String> {
    app.state::<Arc<NetworkRuntime>>()
        .client()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
}

/// 进度回调：桌面 webview 与连在本机的浏览器客户端都要收到同一条事件。
fn emitter<R: Runtime>(app: &AppHandle<R>) -> impl Fn(&str, Value) + Sync + '_ {
    move |name, payload| {
        aicut_daemon::events::publish(name, &payload);
        let _ = app.emit(name, payload);
    }
}

/// 安装 / 删除 / 列举等都要这条：数据目录可能还没建。
fn ensure_dir(dir: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败：{e}"))
}

#[tauri::command]
pub async fn font_registry<R: Runtime>(
    app: AppHandle<R>,
    force: Option<bool>,
) -> Result<FontRegistryView, String> {
    let dir = data_dir(&app)?;
    ensure_dir(&dir)?;
    let client = client(&app)?;
    aicut_daemon::fonts::registry(&dir, &client, force).await
}

#[tauri::command]
pub fn font_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<FontManifest>, String> {
    let dir = data_dir(&app)?;
    ensure_dir(&dir)?;
    aicut_daemon::fonts::list(&dir)
}

#[tauri::command]
pub async fn font_install<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    weights: Vec<u16>,
) -> Result<FontManifest, String> {
    let dir = data_dir(&app)?;
    ensure_dir(&dir)?;
    let client = client(&app)?;
    let emit = emitter(&app);
    aicut_daemon::fonts::install(&dir, &client, &emit, id, weights).await
}

#[tauri::command]
pub fn font_cancel(id: Option<String>) {
    aicut_daemon::fonts::cancel(id);
}

#[tauri::command]
pub fn font_remove<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    aicut_daemon::fonts::remove(&dir, id)
}

#[tauri::command]
pub fn font_probe(path: String) -> Result<FontProbe, String> {
    aicut_daemon::fonts::probe(path)
}

#[tauri::command]
pub fn font_import<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    family: Option<String>,
    weight: Option<u16>,
    style: Option<String>,
) -> Result<FontManifest, String> {
    let dir = data_dir(&app)?;
    ensure_dir(&dir)?;
    aicut_daemon::fonts::import(&dir, path, family, weight, style)
}

/// 在系统文件管理器中显示字体目录。**只有桌面端能做到**，浏览器端明确拒绝。
#[tauri::command]
pub fn font_reveal<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let root = data_dir(&app).ok();
    let target = root
        .as_ref()
        .map(|dir| {
            let font = dir.join("fonts").join(&id);
            if font.is_dir() {
                font
            } else {
                dir.join("fonts")
            }
        })
        .unwrap_or_default();
    crate::models::reveal_in_file_manager(&target)
}
