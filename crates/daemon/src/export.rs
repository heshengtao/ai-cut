//! ffmpeg 导出执行器：写临时滤镜脚本、流式读进度、支持取消。
//!
//! 桌面（sidecar）与无头（PATH 里的 ffmpeg）共用这一份实现，差别只在 `Host::run_stream`。

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::host::{Host, RunOptions};

/// 前端编译好的导出作业（与 `src/core/export/plan.ts` 对应）。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub inputs: Vec<String>,
    pub filter_graph: String,
    pub output_args: Vec<String>,
    pub duration: f64,
}

/// 导出进度事件（`export-progress`）。
#[derive(Clone, Copy, Debug, Serialize)]
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
    cancel: Mutex<Option<CancellationToken>>,
    filter_mode: Mutex<Option<FilterMode>>,
}

impl ExportState {
    pub fn busy(&self) -> bool {
        self.cancel
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    /// 取消当前导出（没有任务时是 no-op）。
    pub fn cancel(&self) -> Result<(), String> {
        let token = self
            .cancel
            .lock()
            .map_err(|_| "导出状态锁失败".to_string())?
            .take();
        if let Some(token) = token {
            token.cancel();
        }
        Ok(())
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
    if let Some(value) = line.strip_prefix("out_time_us=") {
        return value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    // ffmpeg 的 out_time_ms 实际单位是微秒。
    if let Some(value) = line.strip_prefix("out_time_ms=") {
        return value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time=") {
        let mut parts = value.trim().split(':');
        let hours: f64 = parts.next()?.parse().ok()?;
        let minutes: f64 = parts.next()?.parse().ok()?;
        let seconds: f64 = parts.next()?.parse().ok()?;
        return Some(hours * 3600.0 + minutes * 60.0 + seconds);
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
    let major = parts.next().and_then(|part| part.parse::<u32>().ok());
    let minor = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    match major {
        Some(major) if major >= 8 || (major == 7 && minor >= 1) => FilterMode::SlashFile,
        Some(_) => FilterMode::LegacyScript,
        None => FilterMode::Inline,
    }
}

async fn resolve_filter_mode(host: &dyn Host, state: &ExportState) -> FilterMode {
    if let Ok(guard) = state.filter_mode.lock() {
        if let Some(mode) = *guard {
            return mode;
        }
    }
    let mode = match host
        .run("ffmpeg", &["-version".to_string()], RunOptions::default())
        .await
    {
        Ok(output) => filter_mode_from_version(&String::from_utf8_lossy(&output.stdout)),
        Err(_) => FilterMode::Inline,
    };
    if let Ok(mut guard) = state.filter_mode.lock() {
        *guard = Some(mode);
    }
    mode
}

fn decode_base64_image(data: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("文字图层解码失败：{e}"))
}

fn cache_dir(host: &dyn Host) -> Result<PathBuf, String> {
    let dir = host.cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    Ok(dir)
}

/// 把 Canvas 渲染出的 PNG 写入缓存目录，返回绝对路径。
pub fn write_export_text_image(
    host: &dyn Host,
    name: &str,
    base64: &str,
) -> Result<String, String> {
    let safe_name = name.replace(['/', '\\'], "_");
    let path = cache_dir(host)?.join(safe_name);
    let bytes = decode_base64_image(base64)?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入文字图层失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 取消当前导出。
pub fn cancel(state: &ExportState) -> Result<(), String> {
    state.cancel()
}

/// 执行一次导出，直到 ffmpeg 结束。
pub async fn export_video(
    host: &dyn Host,
    state: &ExportState,
    job: ExportJob,
) -> Result<(), String> {
    if state.busy() {
        return Err("已有导出任务在进行".into());
    }
    let token = CancellationToken::new();
    {
        let mut guard = state
            .cancel
            .lock()
            .map_err(|_| "导出状态锁失败".to_string())?;
        *guard = Some(token.clone());
    }

    let result = run_export(host, state, &job, token).await;

    if let Ok(mut guard) = state.cancel.lock() {
        *guard = None;
    }
    result
}

async fn run_export(
    host: &dyn Host,
    state: &ExportState,
    job: &ExportJob,
    cancel: CancellationToken,
) -> Result<(), String> {
    // 输出目录可能还不存在（例如 storyboard 新建的目录）。
    if let Some(output) = job.output_args.last() {
        if let Some(parent) = std::path::Path::new(output).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
            }
        }
    }

    let mode = resolve_filter_mode(host, state).await;

    let script_path = if mode == FilterMode::Inline {
        None
    } else {
        let dir = cache_dir(host)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = dir.join(format!("export-{}-{stamp}.ffgraph", std::process::id()));
        std::fs::write(&path, &job.filter_graph).map_err(|e| format!("写入滤镜脚本失败：{e}"))?;
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

    let duration = job.duration.max(0.001);

    // ffmpeg 的 `-progress` 每个块会重复给出 out_time_us / out_time_ms / out_time；
    // 只在块结束（progress=continue / end）时发一条，避免同一秒刷三次。
    struct ProgressSink {
        buffer: String,
        pending: Option<f64>,
    }
    let sink = Mutex::new(ProgressSink {
        buffer: String::new(),
        pending: None,
    });
    let stderr_lines: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

    let output = host
        .run_stream(
            "ffmpeg",
            &args,
            RunOptions {
                raw_stdout: true,
                ..Default::default()
            },
            Box::new(move |chunk: &[u8]| {
                let Ok(mut guard) = sink.lock() else {
                    return;
                };
                guard.buffer.push_str(&String::from_utf8_lossy(chunk));
                while let Some(position) = guard.buffer.find('\n') {
                    let line = guard.buffer[..position].trim().to_string();
                    let rest = guard.buffer[position + 1..].to_string();
                    guard.buffer = rest;
                    let progress = match line.as_str() {
                        "progress=continue" => guard.pending.take().map(|seconds| ExportProgress {
                            seconds,
                            fraction: (seconds / duration).clamp(0.0, 1.0),
                        }),
                        "progress=end" => {
                            guard.pending = None;
                            Some(ExportProgress {
                                seconds: duration,
                                fraction: 1.0,
                            })
                        }
                        other => {
                            if let Some(seconds) = parse_progress_line(other) {
                                guard.pending = Some(seconds);
                            }
                            None
                        }
                    };
                    if let Some(progress) = progress {
                        host.emit("export-progress", serde_json::json!(progress));
                    }
                }
            }),
            cancel,
        )
        .await;

    let output = match output {
        Ok(output) => output,
        Err(error) if error == "已取消" => return Err("导出已取消".into()),
        Err(error) => return Err(error),
    };

    for line in output.stderr.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(mut guard) = stderr_lines.lock() {
            if guard.len() >= 20 {
                guard.pop_front();
            }
            guard.push_back(line.to_string());
        }
    }

    if output.code == Some(0) {
        return Ok(());
    }
    let tail = stderr_lines
        .lock()
        .map(|guard| guard.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
    if tail.is_empty() {
        Err(format!(
            "ffmpeg 退出码：{}",
            output
                .code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "未知".into())
        ))
    } else {
        Err(tail)
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
        assert_eq!(
            parse_progress_line("out_time=01:02:03.250000"),
            Some(3723.25)
        );
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
