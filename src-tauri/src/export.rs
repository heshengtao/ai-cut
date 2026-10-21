//! ffmpeg 导出执行器：写临时滤镜脚本、spawn sidecar、回报进度、支持取消。

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::sidecar::run_sidecar;

/// 前端编译好的导出作业。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub inputs: Vec<String>,
    pub filter_graph: String,
    pub output_args: Vec<String>,
    pub duration: f64,
}

/// 导出进度事件。
#[derive(Clone, Serialize)]
pub struct ExportProgress {
    pub seconds: f64,
    pub fraction: f64,
}

/// 滤镜脚本的传递方式（ffmpeg 9 删除了 `-filter_complex_script`）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FilterMode {
    /// ffmpeg 7.1+：`-/filter_complex <file>`
    SlashFile,
    /// ffmpeg <= 7.0：`-filter_complex_script <file>`
    LegacyScript,
    /// 无法判断版本时退化为内联参数（所有版本都支持）。
    Inline,
}

/// 同一时间只允许一个导出任务。
#[derive(Default)]
pub struct ExportState {
    child: Mutex<Option<CommandChild>>,
    cancelled: AtomicBool,
    filter_mode: Mutex<Option<FilterMode>>,
}

impl Drop for ExportState {
    fn drop(&mut self) {
        // 应用退出时不要留下孤立的 ffmpeg 进程。
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

/// 临时滤镜脚本，离开作用域时删除。
struct TempGraph(PathBuf);

impl Drop for TempGraph {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// 解析 `-progress` 输出里的一行。
fn parse_progress_line(line: &str) -> Option<f64> {
    if let Some(v) = line.strip_prefix("out_time_us=") {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    // ffmpeg 的 out_time_ms 实际单位是微秒。
    if let Some(v) = line.strip_prefix("out_time_ms=") {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(v) = line.strip_prefix("out_time=") {
        let mut parts = v.trim().split(':');
        let h: f64 = parts.next()?.parse().ok()?;
        let m: f64 = parts.next()?.parse().ok()?;
        let s: f64 = parts.next()?.parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    None
}

/// 根据 `ffmpeg -version` 输出决定滤镜脚本的传递方式。
fn filter_mode_from_version(stdout: &str) -> FilterMode {
    let version = stdout
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(2))
        .unwrap_or("")
        .trim_start_matches('n');
    let mut parts = version.split('.');
    let major = parts.next().and_then(|p| p.parse::<u32>().ok());
    let minor = parts.next().and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
    match major {
        Some(m) if m >= 8 || (m == 7 && minor >= 1) => FilterMode::SlashFile,
        Some(_) => FilterMode::LegacyScript,
        None => FilterMode::Inline,
    }
}

/// 探测并缓存 ffmpeg 的滤镜脚本传递方式。
async fn resolve_filter_mode<R: Runtime>(app: &AppHandle<R>, state: &ExportState) -> FilterMode {
    if let Ok(guard) = state.filter_mode.lock() {
        if let Some(mode) = *guard {
            return mode;
        }
    }

    let args = vec!["-version".to_string()];
    let mode = match run_sidecar(app, "ffmpeg", &args).await {
        Ok((_, stdout)) => filter_mode_from_version(&String::from_utf8_lossy(&stdout)),
        Err(_) => FilterMode::Inline,
    };

    if let Ok(mut guard) = state.filter_mode.lock() {
        *guard = Some(mode);
    }
    mode
}

/// 解码 Canvas 传来的 base64 PNG。
fn decode_base64_image(data: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("文字图层解码失败：{e}"))
}

/// 把 Canvas 渲染出的 PNG 写入缓存目录，返回绝对路径。
#[tauri::command]
pub fn write_export_text_image<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    base64: String,
) -> Result<String, String> {
    let safe_name = name.replace('/', "_").replace('\\', "_");
    let path = crate::media::cache_dir(&app)?.join(safe_name);
    let bytes = decode_base64_image(&base64)?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入文字图层失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 取消当前导出。
#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::SeqCst);
    let child = {
        let mut guard = state.child.lock().map_err(|_| "导出状态锁失败".to_string())?;
        guard.take()
    };
    if let Some(child) = child {
        child.kill().map_err(|e| format!("停止 ffmpeg 失败：{e}"))?;
    }
    Ok(())
}

/// 执行一次导出，直到 ffmpeg 结束。
#[tauri::command]
pub async fn export_video<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ExportState>,
    job: ExportJob,
) -> Result<(), String> {
    {
        let guard = state.child.lock().map_err(|_| "导出状态锁失败".to_string())?;
        if guard.is_some() {
            return Err("已有导出任务在进行".into());
        }
    }
    state.cancelled.store(false, Ordering::SeqCst);

    // 输出目录可能还不存在（例如 render_storyboard 新建的目录）。
    if let Some(output) = job.output_args.last() {
        if let Some(parent) = std::path::Path::new(output).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建输出目录失败：{e}"))?;
            }
        }
    }

    let mode = resolve_filter_mode(&app, state.inner()).await;

    let script_path = if mode == FilterMode::Inline {
        None
    } else {
        let dir = crate::media::cache_dir(&app)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = dir.join(format!("export-{}-{}.ffgraph", std::process::id(), stamp));
        std::fs::write(&path, &job.filter_graph)
            .map_err(|e| format!("写入滤镜脚本失败：{e}"))?;
        Some(path)
    };
    let _temp = script_path.as_ref().map(|path| TempGraph(path.clone()));

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-y".into(),
    ];
    args.extend(job.inputs.iter().cloned());
    match mode {
        FilterMode::Inline => {
            args.push("-filter_complex".into());
            args.push(job.filter_graph.clone());
        }
        FilterMode::SlashFile => {
            args.push("-/filter_complex".into());
            args.push(
                script_path
                    .as_ref()
                    .ok_or("缺少滤镜脚本路径")?
                    .to_string_lossy()
                    .to_string(),
            );
        }
        FilterMode::LegacyScript => {
            args.push("-filter_complex_script".into());
            args.push(
                script_path
                    .as_ref()
                    .ok_or("缺少滤镜脚本路径")?
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    args.extend(job.output_args.iter().cloned());

    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg 不可用：{e}"))?;
    let (mut rx, child) = command
        .args(args)
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败：{e}"))?;

    {
        let mut guard = state.child.lock().map_err(|_| "导出状态锁失败".to_string())?;
        *guard = Some(child);
    }

    let duration = job.duration.max(0.001);
    let mut stdout_buf = String::new();
    let mut stderr_lines: VecDeque<String> = VecDeque::new();
    let mut exit_code: Option<Option<i32>> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(pos) = stdout_buf.find('\n') {
                    let line = stdout_buf[..pos].trim().to_string();
                    stdout_buf = stdout_buf[pos + 1..].to_string();
                    if line == "progress=end" {
                        let _ = app.emit(
                            "export-progress",
                            ExportProgress {
                                seconds: duration,
                                fraction: 1.0,
                            },
                        );
                    } else if let Some(seconds) = parse_progress_line(&line) {
                        let _ = app.emit(
                            "export-progress",
                            ExportProgress {
                                seconds,
                                fraction: (seconds / duration).clamp(0.0, 1.0),
                            },
                        );
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                for line in String::from_utf8_lossy(&bytes).lines() {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if stderr_lines.len() >= 20 {
                        stderr_lines.pop_front();
                    }
                    stderr_lines.push_back(line);
                }
            }
            CommandEvent::Error(error) => {
                if stderr_lines.len() >= 20 {
                    stderr_lines.pop_front();
                }
                stderr_lines.push_back(error);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = Some(payload.code);
                break;
            }
            _ => {}
        }
    }

    {
        let mut guard = state.child.lock().map_err(|_| "导出状态锁失败".to_string())?;
        *guard = None;
    }

    if state.cancelled.load(Ordering::SeqCst) {
        return Err("导出已取消".into());
    }

    match exit_code {
        Some(Some(0)) => Ok(()),
        Some(code) => {
            let tail = stderr_lines.into_iter().collect::<Vec<_>>().join("\n");
            if tail.is_empty() {
                Err(format!(
                    "ffmpeg 退出码：{}",
                    code.map(|c| c.to_string()).unwrap_or_else(|| "未知".into())
                ))
            } else {
                Err(tail)
            }
        }
        None => Err("ffmpeg 未正常结束".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_base64_image, filter_mode_from_version, parse_progress_line, FilterMode};

    #[test]
    fn decodes_text_image_payload() {
        assert_eq!(decode_base64_image("aGVsbG8=").unwrap(), b"hello");
        assert!(decode_base64_image("not base64!").is_err());
    }

    #[test]
    fn parses_microseconds() {
        assert_eq!(parse_progress_line("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_line("out_time_ms=2500000"), Some(2.5));
    }

    #[test]
    fn parses_timecode() {
        assert_eq!(parse_progress_line("out_time=00:00:01.500000"), Some(1.5));
        assert_eq!(parse_progress_line("out_time=01:02:03.250000"), Some(3723.25));
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert_eq!(parse_progress_line("frame=10"), None);
        assert_eq!(parse_progress_line("out_time=N/A"), None);
    }

    #[test]
    fn selects_filter_script_mode_by_version() {
        assert_eq!(
            filter_mode_from_version("ffmpeg version 9.0.1 Copyright (c)"),
            FilterMode::SlashFile
        );
        assert_eq!(
            filter_mode_from_version("ffmpeg version 7.1.1 Copyright (c)"),
            FilterMode::SlashFile
        );
        assert_eq!(
            filter_mode_from_version("ffmpeg version n6.1.1 Copyright (c)"),
            FilterMode::LegacyScript
        );
        assert_eq!(
            filter_mode_from_version("ffmpeg version N-12345-gabc"),
            FilterMode::Inline
        );
    }
}
