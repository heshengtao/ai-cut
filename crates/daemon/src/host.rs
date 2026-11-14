//! 宿主能力：桌面壳（Tauri）与无头二进制（`aicutd`）各自实现。
//!
//! 命令实现只依赖这个 trait，不依赖 Tauri——这样同一份代码既能被桌面内嵌的
//! daemon 调用，也能在没有窗口、没有 webview 的容器里跑。

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use tokio_util::sync::CancellationToken;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 跑外部程序（ffmpeg / ffprobe）的选项。
#[derive(Clone, Debug, Default)]
pub struct RunOptions {
    /// 按原始字节读 stdout（rawvideo / s16le 必须开，否则会被按行切分并补换行）。
    pub raw_stdout: bool,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

/// 外部程序的输出。
#[derive(Clone, Debug, Default)]
pub struct Output {
    pub code: Option<i32>,
    /// stdout（`raw_stdout` 时是原始字节）。
    pub stdout: Vec<u8>,
    /// stderr，只保留开头一段，避免解码大文件时无限增长。
    pub stderr: String,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

/// 桌面壳提供的能力。无头实现只做进程与文件系统，`ui` 相关一律没有。
pub trait Host: Send + Sync + 'static {
    /// 当前生效的数据目录（模型 / 工程 / 字体 / 缓存都在这下面）。
    fn data_dir(&self) -> &Path;

    /// 当前生效的配置目录（覆盖数据目录时与它同根）。
    fn config_dir(&self) -> &Path;

    /// 缓存目录（缩略图 / 波形 / 代理），默认 `<data>/cache`。
    fn cache_dir(&self) -> PathBuf {
        self.data_dir().join("cache")
    }

    /// 向前端推事件（进度、AI 流）。
    ///
    /// 默认只进 SSE 总线；桌面壳还会额外 `app.emit` 给 webview。
    fn emit(&self, event: &str, payload: serde_json::Value) {
        crate::events::publish(event, &payload);
    }

    /// 跑一个外部程序并等它结束。
    fn run<'a>(
        &'a self,
        bin: &'a str,
        args: &'a [String],
        opts: RunOptions,
    ) -> BoxFuture<'a, Result<Output, String>>;

    /// 跑外部程序并把 stdout 逐块回调（导出进度 / 大文件处理用）。
    ///
    /// 默认实现退化为「跑完一次性回调」；桌面与无头各自覆盖成真正的流式读取。
    fn run_stream<'a>(
        &'a self,
        bin: &'a str,
        args: &'a [String],
        opts: RunOptions,
        on_stdout: Box<dyn Fn(&[u8]) + Send + 'a>,
        cancel: CancellationToken,
    ) -> BoxFuture<'a, Result<Output, String>> {
        let _ = cancel;
        Box::pin(async move {
            let output = self.run(bin, args, opts).await?;
            on_stdout(&output.stdout);
            Ok(output)
        })
    }

    /// 是否具备原生 UI 能力（文件框、reveal、更新）。浏览器端据此隐藏入口。
    fn has_ui(&self) -> bool {
        false
    }
}

/// 无头宿主：进程 + 文件系统，没有 Tauri、没有 webview。
///
/// ffmpeg / ffprobe 默认走 `PATH`（Docker 镜像里 `apt install ffmpeg`）；
/// 需要指定时用 `AICUT_FFMPEG` / `AICUT_FFPROBE` 环境变量。
pub struct HeadlessHost {
    data: PathBuf,
    config: PathBuf,
}

impl HeadlessHost {
    pub fn new(data: PathBuf, config: PathBuf) -> Self {
        Self { data, config }
    }
}

fn resolve_bin(bin: &str) -> String {
    let key = match bin {
        "ffmpeg" => "AICUT_FFMPEG",
        "ffprobe" => "AICUT_FFPROBE",
        _ => return bin.to_string(),
    };
    std::env::var(key).unwrap_or_else(|_| bin.to_string())
}

impl Host for HeadlessHost {
    fn data_dir(&self) -> &Path {
        &self.data
    }

    fn config_dir(&self) -> &Path {
        &self.config
    }

    fn run<'a>(
        &'a self,
        bin: &'a str,
        args: &'a [String],
        opts: RunOptions,
    ) -> BoxFuture<'a, Result<Output, String>> {
        Box::pin(async move {
            let program = resolve_bin(bin);
            let mut command = tokio::process::Command::new(&program);
            command
                .args(args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            if let Some(cwd) = opts.cwd {
                command.current_dir(cwd);
            }
            for (key, value) in opts.env {
                command.env(key, value);
            }
            let output = command
                .output()
                .await
                .map_err(|e| format!("执行 {program} 失败：{e}"))?;
            let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            stderr.truncate(8192);
            Ok(Output {
                code: output.status.code(),
                stdout: output.stdout,
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
        cancel: CancellationToken,
    ) -> BoxFuture<'a, Result<Output, String>> {
        Box::pin(async move {
            use tokio::io::AsyncReadExt;

            let program = resolve_bin(bin);
            let mut command = tokio::process::Command::new(&program);
            command
                .args(args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            if let Some(cwd) = opts.cwd {
                command.current_dir(cwd);
            }
            for (key, value) in opts.env {
                command.env(key, value);
            }
            let mut child = command
                .spawn()
                .map_err(|e| format!("执行 {program} 失败：{e}"))?;
            let mut stdout = child.stdout.take().ok_or("子进程没有 stdout")?;
            let mut stderr = child.stderr.take().ok_or("子进程没有 stderr")?;

            let stderr_task = tokio::spawn(async move {
                let mut buffer = Vec::new();
                let _ = stderr.read_to_end(&mut buffer).await;
                buffer
            });

            let mut chunk = vec![0u8; 16 * 1024];
            let mut collected = Vec::new();
            let mut cancelled = false;
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        let _ = child.kill().await;
                        cancelled = true;
                        break;
                    }
                    read = stdout.read(&mut chunk) => {
                        match read {
                            Ok(0) => break,
                            Ok(n) => {
                                let data = &chunk[..n];
                                collected.extend_from_slice(data);
                                on_stdout(data);
                            }
                            Err(error) => {
                                let _ = child.kill().await;
                                let _ = stderr_task.await;
                                return Err(format!("读取 {program} 输出失败：{error}"));
                            }
                        }
                    }
                }
            }
            let status = child
                .wait()
                .await
                .map_err(|e| format!("等待 {program} 结束失败：{e}"))?;
            let stderr_bytes = stderr_task.await.unwrap_or_default();
            let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).into_owned();
            stderr_text.truncate(8192);
            if cancelled {
                return Err("已取消".into());
            }
            Ok(Output {
                code: status.code(),
                stdout: collected,
                stderr: stderr_text,
            })
        })
    }
}
