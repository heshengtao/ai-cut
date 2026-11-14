//! 事件总线：把 `Host::emit` 出去的进度 / 流式内容转成 SSE，浏览器端按事件名订阅。
//!
//! 一个进程只有一个 daemon 会话，用一个全局 bus 足够；桌面壳与无头共用同一路径，
//! 这样「桌面导出、浏览器看进度」也不需要额外接线。

use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::broadcast;

/// 一条事件。
#[derive(Clone, Debug, Serialize)]
pub struct DaemonEvent {
    pub name: String,
    pub data: String,
}

/// 广播总线（容量按一次导出几十条进度事件估算）。
pub struct EventBus {
    tx: broadcast::Sender<DaemonEvent>,
}

impl EventBus {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    pub fn publish(&self, name: &str, data: String) {
        let _ = self.tx.send(DaemonEvent {
            name: name.to_string(),
            data,
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DaemonEvent> {
        self.tx.subscribe()
    }
}

fn global() -> &'static EventBus {
    static BUS: OnceLock<EventBus> = OnceLock::new();
    BUS.get_or_init(EventBus::new)
}

/// 发一条事件（payload 序列化成 JSON）。
pub fn publish(name: &str, payload: &serde_json::Value) {
    let data = serde_json::to_string(payload).unwrap_or_default();
    global().publish(name, data);
}

/// 订阅事件流。
pub fn subscribe() -> broadcast::Receiver<DaemonEvent> {
    global().subscribe()
}
