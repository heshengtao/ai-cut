//! 调用打包进来的 ffmpeg / ffprobe sidecar。
//!
//! 一律从 Rust 侧 spawn，不经前端 JS——这样 capabilities 无需开放 shell 执行权限。

use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// stderr 只保留开头一段用于报错，避免解码大文件时无限增长。
const STDERR_LIMIT: usize = 8192;

/// 运行 sidecar 并等待结束，返回 `(退出码, stdout 字节)`。
///
/// stdout **必须按原始字节读取**：`Command::output()` 走的是按行切分，会在每个
/// 数据块后补一个换行，读 rawvideo / s16le / f32le 时会把数据撑大并错位。
pub async fn run_sidecar<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: &[String],
) -> Result<(Option<i32>, Vec<u8>), String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar(name)
        .map_err(|e| format!("sidecar {name} 不可用：{e}"))?
        .args(args)
        .set_raw_out(true)
        .spawn()
        .map_err(|e| format!("执行 {name} 失败：{e}"))?;

    let mut code = None;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(chunk) => stdout.extend_from_slice(&chunk),
            CommandEvent::Stderr(chunk) => {
                if stderr.len() < STDERR_LIMIT {
                    stderr.extend_from_slice(&chunk);
                }
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                return Err(format!("执行 {name} 失败：{error}"));
            }
            _ => {}
        }
    }

    if !stderr.is_empty() {
        // 只记日志，不当作失败：ffmpeg 会把正常信息写到 stderr。
        eprintln!("[{name}] {}", String::from_utf8_lossy(&stderr));
    }
    Ok((code, stdout))
}
