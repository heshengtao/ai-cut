//! Rust ↔ webview 的工程命令桥接。
//!
//! MCP 工具和内置剪辑智能体共用这条路径：Rust 发 `project-request`，
//! 前端执行 project store 的命令并 invoke `bridge_respond` 返回结果。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeReply {
    pub ok: bool,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

pub struct ProjectBridge {
    app: AppHandle,
    pending: Mutex<HashMap<String, oneshot::Sender<BridgeReply>>>,
    next_id: AtomicU64,
}

impl ProjectBridge {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// 向 webview 发一条命令并等待结果。
    pub async fn request(&self, method: &str, payload: Value) -> Result<Value, String> {
        let id = format!("bridge-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "桥接状态锁失败".to_string())?;
            pending.insert(id.clone(), tx);
        }

        if let Err(error) = self.app.emit(
            "project-request",
            json!({ "id": id, "method": method, "payload": payload }),
        ) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(format!("向前端发送命令失败：{error}"));
        }

        match tokio::time::timeout(TIMEOUT, rx).await {
            Ok(Ok(reply)) => {
                if reply.ok {
                    Ok(reply.data.unwrap_or(Value::Null))
                } else {
                    Err(reply.error.unwrap_or_else(|| "前端返回错误".into()))
                }
            }
            Ok(Err(_)) => Err("前端未返回结果".into()),
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err("等待前端响应超时".into())
            }
        }
    }

    pub fn resolve(&self, id: &str, reply: BridgeReply) {
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(tx) = pending.remove(id) {
                let _ = tx.send(reply);
            }
        }
    }
}

#[tauri::command]
pub fn bridge_respond(
    state: tauri::State<'_, Arc<ProjectBridge>>,
    id: String,
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    state.resolve(&id, BridgeReply { ok, data, error });
    Ok(())
}
