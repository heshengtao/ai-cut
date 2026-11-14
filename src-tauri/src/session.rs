//! 共享会话（桌面端）：把本机编辑推给内嵌 daemon，并接收其他客户端的补丁。

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

/// 桌面端收到的会话消息（供前端订阅；浏览器客户端走 WebSocket）。
pub const SESSION_EVENT: &str = "session://message";

#[tauri::command]
pub fn session_publish(
    state: State<'_, Arc<aicut_daemon::session::Session>>,
    project: String,
    revision: u64,
    origin: String,
    affected: Option<Value>,
    full: bool,
    dirty: bool,
    path: Option<String>,
) {
    state.publish_doc(
        project,
        revision,
        origin,
        affected.unwrap_or(Value::Null),
        full,
        dirty,
        path,
    );
}

#[tauri::command]
pub fn session_playhead(
    state: State<'_, Arc<aicut_daemon::session::Session>>,
    time: f64,
    playing: bool,
) {
    state.publish_playhead(time, playing);
}

/// 把 daemon 的会话广播桥接成 Tauri 事件，桌面端也能收到浏览器端推来的补丁。
pub fn spawn_bridge(app: AppHandle, session: Arc<aicut_daemon::session::Session>) {
    tauri::async_runtime::spawn(async move {
        let mut receiver = session.subscribe();
        loop {
            match receiver.recv().await {
                Ok(message) => {
                    let _ = app.emit(SESSION_EVENT, message.to_json());
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });
}
