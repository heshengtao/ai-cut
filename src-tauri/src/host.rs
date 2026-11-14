//! 桌面壳的 `Host` 实现：把 Tauri 的能力（sidecar、事件、数据目录）接到无头核心上。
//!
//! 这是「一条后端、两种外壳」的接缝：`crates/daemon` 只认 `Host`，桌面与 `aicutd`
//! 各自提供实现。

use std::path::{Path, PathBuf};

use aicut_daemon::host::{BoxFuture, Host, Output, RunOptions};
use tauri::AppHandle;

use crate::sidecar::{run_sidecar_full, run_sidecar_stream};

/// 桌面宿主。构造时把数据目录/配置目录定下来（进程内冻结，见 `paths::EFFECTIVE`）。
pub struct TauriHost {
    app: AppHandle,
    data: PathBuf,
    config: PathBuf,
}

impl TauriHost {
    pub fn new(app: AppHandle) -> Self {
        let data = crate::paths::data_dir(&app).unwrap_or_else(|_| PathBuf::from("."));
        let config = crate::paths::config_dir(&app).unwrap_or_else(|_| data.clone());
        Self { app, data, config }
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }
}

impl Host for TauriHost {
    fn data_dir(&self) -> &Path {
        &self.data
    }

    fn config_dir(&self) -> &Path {
        &self.config
    }

    fn emit(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        // 桌面 webview 与浏览器客户端都要收到同一条事件。
        aicut_daemon::events::publish(event, &payload);
        let _ = self.app.emit(event, payload);
    }

    fn run<'a>(
        &'a self,
        bin: &'a str,
        args: &'a [String],
        opts: RunOptions,
    ) -> BoxFuture<'a, Result<Output, String>> {
        Box::pin(async move {
            let (code, stdout, stderr) =
                run_sidecar_full(&self.app, bin, args, opts.raw_stdout).await?;
            Ok(Output {
                code,
                stdout,
                stderr,
            })
        })
    }

    fn run_stream<'a>(
        &'a self,
        bin: &'a str,
        args: &'a [String],
        opts: RunOptions,
        on_stdout: Box<dyn Fn(&[u8]) + Send + 'a>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> BoxFuture<'a, Result<Output, String>> {
        Box::pin(async move {
            let (code, stdout, stderr) = run_sidecar_stream(
                &self.app,
                bin,
                args,
                opts.raw_stdout,
                move |chunk| on_stdout(chunk),
                cancel,
            )
            .await?;
            Ok(Output {
                code,
                stdout,
                stderr,
            })
        })
    }

    fn has_ui(&self) -> bool {
        true
    }
}
