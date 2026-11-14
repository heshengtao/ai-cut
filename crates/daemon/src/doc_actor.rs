//! 文档引擎的线程化句柄。
//!
//! `DocEngine` 里的 QuickJS 运行时绑定线程、不是 `Send`，所以放进专属线程，
//! RPC 通过消息驱动；这样 axum 的 async handler 仍然是非阻塞的。

use tokio::sync::{mpsc, oneshot};

use crate::{DocEngine, IdSource};

enum Request {
    Load {
        json: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Snapshot {
        reply: oneshot::Sender<Result<String, String>>,
    },
    Revision {
        reply: oneshot::Sender<Result<u64, String>>,
    },
    Apply {
        command: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    View {
        method: String,
        args: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
}

/// 可克隆的引擎句柄（内部是一条消息队列）。
#[derive(Clone)]
pub struct DocHandle {
    tx: mpsc::UnboundedSender<Request>,
}

impl DocHandle {
    /// 起一条引擎线程；引擎创建失败时后续调用会返回「已停止」。
    pub fn spawn() -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Request>();
        std::thread::Builder::new()
            .name("aicut-doc-engine".into())
            .spawn(move || {
                let engine = match DocEngine::new(IdSource::Real) {
                    Ok(engine) => engine,
                    Err(error) => {
                        eprintln!("[daemon] 文档引擎启动失败：{error}");
                        return;
                    }
                };
                while let Some(request) = rx.blocking_recv() {
                    match request {
                        Request::Load { json, reply } => {
                            let _ = reply.send(engine.load(&json));
                        }
                        Request::Snapshot { reply } => {
                            let _ = reply.send(engine.snapshot());
                        }
                        Request::Revision { reply } => {
                            let _ = reply.send(engine.revision());
                        }
                        Request::Apply { command, reply } => {
                            let _ = reply.send(engine.apply(&command));
                        }
                        Request::View {
                            method,
                            args,
                            reply,
                        } => {
                            let _ = reply.send(engine.view(&method, &args));
                        }
                    }
                }
            })
            .ok();
        Self { tx }
    }

    async fn call(
        &self,
        build: impl FnOnce(oneshot::Sender<Result<String, String>>) -> Request,
    ) -> Result<String, String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(build(reply))
            .map_err(|_| "文档引擎已停止".to_string())?;
        receiver.await.map_err(|_| "文档引擎无响应".to_string())?
    }

    pub async fn load(&self, json: String) -> Result<String, String> {
        self.call(|reply| Request::Load { json, reply }).await
    }

    pub async fn snapshot(&self) -> Result<String, String> {
        self.call(|reply| Request::Snapshot { reply }).await
    }

    pub async fn revision(&self) -> Result<u64, String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(Request::Revision { reply })
            .map_err(|_| "文档引擎已停止".to_string())?;
        receiver.await.map_err(|_| "文档引擎无响应".to_string())?
    }

    pub async fn apply(&self, command: String) -> Result<String, String> {
        self.call(|reply| Request::Apply { command, reply }).await
    }

    pub async fn view(&self, method: String, args: String) -> Result<String, String> {
        self.call(|reply| Request::View {
            method,
            args,
            reply,
        })
        .await
    }
}
