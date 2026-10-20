//! 调用打包进来的 ffmpeg / ffprobe sidecar。
//!
//! 一律从 Rust 侧 spawn，不经前端 JS——这样 capabilities 无需开放 shell 执行权限。

use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::ShellExt;

/// 运行 sidecar 并等待结束，返回 `(退出码, stdout 字节)`。
pub async fn run_sidecar<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: &[String],
) -> Result<(Option<i32>, Vec<u8>), String> {
    let command = app
        .shell()
        .sidecar(name)
        .map_err(|e| format!("sidecar {name} 不可用：{e}"))?;

    let output = command
        .args(args)
        .output()
        .await
        .map_err(|e| format!("执行 {name} 失败：{e}"))?;

    if !output.stderr.is_empty() {
        // 只记日志，不当作失败：ffmpeg 会把正常信息写到 stderr。
        eprintln!("[{name}] {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), output.stdout))
}
