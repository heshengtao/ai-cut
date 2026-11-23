//! **代码出片**（code2video）：跑一条外部渲染命令，把产物收进素材库并回填画布节点。
//!
//! 为什么不是内置渲染引擎：three.js / Remotion / Motion Canvas 的代码要先打包
//! （`node_modules` + vite），应用替不了这一步。这里只负责契约的另一半：
//!
//! 1. 在指定工作目录里跑命令（`sh -c` / `cmd /C`，stderr 合并进 stdout 便于报错）；
//! 2. 超时 / 取消都会杀掉命令进程（`sh` 的孙进程不保证一起退，读线程有 2 秒的止损），
//!    **失败时删掉本次新建的半成品**（跑之前就存在的文件不动）；
//! 3. 成功才探测媒体 → `import_asset` → 可选把结果写回画布节点（`assetId` + 溯源参数）。
//!
//! 桌面与无头共用 [`parse`] / [`execute`]；收尾（入库 / 回填）各自走自己的文档通道：
//! 无头是领域层 `board_apply`，桌面是桥接的 `board.apply` + `import_asset`。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::host::Host;
use crate::{doc_ops, DocHandle};

/// 渲染进度事件（桌面与浏览器客户端都能收到）。
pub const EVENT_RENDER_CODE: &str = "render-code-progress";

const TAIL_BYTES: usize = 8 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 900;
const MAX_TIMEOUT_SECONDS: u64 = 3600;
const MIN_TIMEOUT_SECONDS: u64 = 5;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(400);

/// 一次渲染请求（已校验）。
#[derive(Debug, Clone)]
pub struct Spec {
    /// 原样的命令行（交给 shell）。
    pub command: String,
    /// 工作目录：用户工程目录，命令在里面跑。
    pub cwd: PathBuf,
    /// 命令承诺产出的文件。
    pub output: PathBuf,
    pub timeout: Duration,
}

impl Spec {
    /// 产物的绝对路径（`outputPath` 允许写相对路径，相对 `cwd`）。
    pub fn output_abs(&self) -> PathBuf {
        if self.output.is_absolute() {
            self.output.clone()
        } else {
            self.cwd.join(&self.output)
        }
    }
}

/// 命令跑完的结果。
#[derive(Debug, Clone)]
pub struct RunResult {
    pub code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    /// 命令输出（stdout + stderr 合并）的尾部。
    pub tail: String,
}

impl RunResult {
    pub fn ok(&self) -> bool {
        !self.timed_out && !self.cancelled && self.code == Some(0)
    }
}

fn string_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("render_code 需要 {key}"))
}

/// 校验参数并拼出 [`Spec`]。
///
/// `outputPath` 的目录必须已存在：目录建错比命令失败更难查，所以跑之前就报。
pub fn parse(args: &Value) -> Result<Spec, String> {
    let command = string_arg(args, "command")?;
    let cwd = PathBuf::from(string_arg(args, "cwd")?);
    if !cwd.is_dir() {
        return Err(format!("工作目录不存在或不是目录：{}", cwd.display()));
    }
    let raw = string_arg(args, "outputPath")?;
    let output = {
        let path = PathBuf::from(&raw);
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    };
    let parent = output
        .parent()
        .ok_or_else(|| format!("输出路径不合法：{raw}"))?;
    if !parent.is_dir() {
        return Err(format!(
            "输出目录不存在：{}（先建好目录，避免渲染跑完才发现写不进去）",
            parent.display()
        ));
    }
    let timeout_sec = args
        .get("timeoutSec")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
    Ok(Spec {
        command,
        cwd,
        output,
        timeout: Duration::from_secs(timeout_sec),
    })
}

fn tail_text(tail: &Arc<Mutex<Vec<u8>>>) -> String {
    let buffer = tail.lock().map(|buffer| buffer.clone()).unwrap_or_default();
    String::from_utf8_lossy(&buffer).trim().to_string()
}

fn push_tail(tail: &Arc<Mutex<Vec<u8>>>, chunk: &[u8]) {
    if let Ok(mut buffer) = tail.lock() {
        buffer.extend_from_slice(chunk);
        if buffer.len() > TAIL_BYTES {
            let drop = buffer.len() - TAIL_BYTES;
            buffer.drain(..drop);
        }
    }
}

/// 跑命令：流式收输出、超时或取消就杀进程。
///
/// 与 `Host` 无关（`sh` 不是 sidecar）：桌面与无头都直接用它，语义只有一份。
pub async fn execute(
    spec: &Spec,
    cancel: Option<&CancellationToken>,
    on_progress: Arc<dyn Fn(&str) + Send + Sync>,
) -> Result<RunResult, String> {
    if cancel.is_some_and(|token| token.is_cancelled()) {
        return Ok(RunResult {
            code: None,
            timed_out: false,
            cancelled: true,
            tail: String::new(),
        });
    }

    let (program, program_args) = shell_command(&spec.command);
    let mut child = tokio::process::Command::new(program)
        .args(program_args)
        .current_dir(&spec.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动渲染命令失败：{error}（{program}）"))?;

    let tail = Arc::new(Mutex::new(Vec::<u8>::new()));
    let last_emit = Arc::new(Mutex::new(Instant::now() - PROGRESS_INTERVAL));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let readers = [stdout.map(Reader::Out), stderr.map(Reader::Err)]
        .into_iter()
        .flatten()
        .map(|reader| {
            let tail = tail.clone();
            let last_emit = last_emit.clone();
            let on_progress = on_progress.clone();
            tokio::spawn(async move {
                reader.pump(&tail, &last_emit, on_progress).await;
            })
        })
        .collect::<Vec<_>>();

    let timed_out = AtomicBool::new(false);
    let cancelled = AtomicBool::new(false);
    let status = tokio::select! {
        status = child.wait() => status,
        _ = wait_cancelled(cancel) => {
            cancelled.store(true, Ordering::SeqCst);
            let _ = child.kill().await;
            child.wait().await
        }
        _ = tokio::time::sleep(spec.timeout) => {
            timed_out.store(true, Ordering::SeqCst);
            let _ = child.kill().await;
            child.wait().await
        }
    };
    // 子进程已经杀掉，但 `sh` 的孙进程可能还握着管道：给读线程一个有界的等待，
    // 超时就放弃（不能因为一个卡住的管道把整次调用挂住）。
    for reader in readers {
        if tokio::time::timeout(Duration::from_secs(2), reader)
            .await
            .is_err()
        {
            break;
        }
    }

    Ok(RunResult {
        code: status.ok().and_then(|status| status.code()),
        timed_out: timed_out.load(Ordering::SeqCst),
        cancelled: cancelled.load(Ordering::SeqCst)
            || cancel.is_some_and(|token| token.is_cancelled()),
        tail: tail_text(&tail),
    })
}

enum Reader {
    Out(tokio::process::ChildStdout),
    Err(tokio::process::ChildStderr),
}

impl Reader {
    async fn pump(
        mut self,
        tail: &Arc<Mutex<Vec<u8>>>,
        last_emit: &Arc<Mutex<Instant>>,
        on_progress: Arc<dyn Fn(&str) + Send + Sync>,
    ) {
        use tokio::io::AsyncReadExt;
        let mut chunk = vec![0u8; 16 * 1024];
        loop {
            let read = match &mut self {
                Reader::Out(reader) => reader.read(&mut chunk).await,
                Reader::Err(reader) => reader.read(&mut chunk).await,
            };
            match read {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    push_tail(tail, &chunk[..size]);
                    let due = last_emit
                        .lock()
                        .map(|moment| moment.elapsed() >= PROGRESS_INTERVAL)
                        .unwrap_or(false);
                    if due {
                        if let Ok(mut moment) = last_emit.lock() {
                            *moment = Instant::now();
                        }
                        on_progress(&tail_text(tail));
                    }
                }
            }
        }
    }
}

/// `sh -c "cmd 2>&1"`（Windows：`cmd /C`）。
///
/// stderr 合并进 stdout：渲染器通常把进度和错误都写 stderr，分开收就只能二选一。
fn shell_command(command: &str) -> (&'static str, Vec<String>) {
    if cfg!(windows) {
        ("cmd", vec!["/C".to_string(), format!("{command} 2>&1")])
    } else {
        ("sh", vec!["-c".to_string(), format!("{command} 2>&1")])
    }
}

async fn wait_cancelled(token: Option<&CancellationToken>) {
    match token {
        Some(token) => token.cancelled().await,
        None => std::future::pending().await,
    }
}

/// 失败清理：只删本次新建的产物（跑之前就存在的文件绝不碰）。
pub fn cleanup(spec: &Spec, existed_before: bool) {
    if existed_before {
        return;
    }
    let path = spec.output_abs();
    if path.is_file() {
        let _ = std::fs::remove_file(&path);
    }
}

pub fn failure_message(result: &RunResult, spec: &Spec) -> String {
    let tail = if result.tail.is_empty() {
        String::new()
    } else {
        format!("\n最后输出：\n{}", result.tail)
    };
    if result.cancelled {
        format!("渲染已取消（未完成的产物已清理）{tail}")
    } else if result.timed_out {
        format!(
            "渲染超时（{} 秒）已终止，未完成的产物已清理{tail}",
            spec.timeout.as_secs()
        )
    } else {
        let code = result
            .code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "被信号终止".to_string());
        format!("渲染命令失败（exit {code}）{tail}")
    }
}

/// 产物检查：存在、是文件、非空。
pub fn verify_output(spec: &Spec) -> Result<u64, String> {
    let path = spec.output_abs();
    let Ok(meta) = std::fs::metadata(&path) else {
        return Err(format!(
            "命令成功退出，但没有产出文件：{}（确认命令里写了输出路径，且与 outputPath 一致）",
            path.display()
        ));
    };
    if !meta.is_file() {
        return Err(format!("产物不是文件：{}", path.display()));
    }
    if meta.len() == 0 {
        return Err(format!("产物是空文件：{}", path.display()));
    }
    Ok(meta.len())
}

/// 无头形态的完整流程：跑命令 → 入库 → 可选回填画布节点。
pub async fn run(
    host: &dyn Host,
    doc: &DocHandle,
    args: &Value,
    cancel: Option<&CancellationToken>,
) -> Result<Value, String> {
    let spec = parse(args)?;
    let existed_before = spec.output_abs().is_file();
    let node_id = args
        .get("nodeId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // 先确认节点存在再把命令跑起来：跑完才发现 nodeId 写错，会留下一条没人用的素材。
    let target = match node_id {
        Some(node_id) => Some(resolve_node(doc, node_id, args.get("params")).await?),
        None => None,
    };

    // 进度走全局事件总线：`execute` 里的读线程是 `'static` 的，不能借用 `host`。
    let result = execute(
        &spec,
        cancel,
        Arc::new(|tail: &str| {
            crate::events::publish(EVENT_RENDER_CODE, &json!({ "tail": tail }));
        }),
    )
    .await?;

    if !result.ok() {
        cleanup(&spec, existed_before);
        return Err(failure_message(&result, &spec));
    }

    let size = match verify_output(&spec) {
        Ok(size) => size,
        Err(error) => {
            cleanup(&spec, existed_before);
            return Err(error);
        }
    };
    let path = spec.output_abs().to_string_lossy().into_owned();
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let asset = doc_ops::asset_for(host, &path, name, None).await?;
    let asset_id = asset["id"].clone();
    doc_ops::call(doc, "add_assets", json!({ "assets": [asset.clone()] })).await?;

    let mut summary = json!({
        "assetId": asset_id,
        "path": path,
        "sizeBytes": size,
        "duration": asset.get("duration").cloned().unwrap_or(Value::Null),
    });

    if let Some((node_id, node_type, params)) = target {
        let canvas_id = args
            .get("canvasId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let patch = node_patch(&node_type, &asset_id, params);
        let mut payload = json!({
            "ops": [{ "kind": "update_node", "nodeId": node_id, "patch": patch }],
        });
        if let Some(canvas_id) = canvas_id {
            payload["canvasId"] = json!(canvas_id);
        }
        doc_ops::call(doc, "board_apply", payload).await?;
        if let Some(map) = summary.as_object_mut() {
            map.insert("nodeId".into(), json!(node_id));
            if let Some(canvas_id) = canvas_id {
                map.insert("canvasId".into(), json!(canvas_id));
            }
        }
    }

    Ok(summary)
}

/// 把溯源参数并进已有的 `params`：只收标量（schema 的 `normalizeParams` 也只保留标量）。
pub fn merge_params(existing: Value, extra: Option<&Value>) -> Value {
    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if let Some(extra) = extra.and_then(Value::as_object) {
        for (key, value) in extra {
            if value.is_string() || value.is_number() || value.is_boolean() {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(merged)
}

/// 找到要回填的节点，并把溯源参数并进它已有的 `params`。
///
/// 返回 `(nodeId, nodeType, mergedParams)`；节点不存在直接报错（不跑命令）。
async fn resolve_node(
    doc: &DocHandle,
    node_id: &str,
    params: Option<&Value>,
) -> Result<(String, String, Value), String> {
    let text = doc
        .snapshot()
        .await
        .map_err(|error| format!("读取工程快照失败：{error}"))?;
    let snapshot: Value =
        serde_json::from_str(&text).map_err(|error| format!("工程快照不是合法 JSON：{error}"))?;
    let mut node_type = String::new();
    let mut merged = serde_json::Map::new();
    if let Some(canvases) = snapshot.get("boards").and_then(Value::as_array) {
        'outer: for canvas in canvases {
            let Some(nodes) = canvas
                .get("doc")
                .and_then(|doc| doc.get("nodes"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for node in nodes {
                if node.get("id").and_then(Value::as_str) != Some(node_id) {
                    continue;
                }
                node_type = node
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if let Some(existing) = node
                    .get("data")
                    .and_then(|data| data.get("params"))
                    .and_then(Value::as_object)
                {
                    merged = existing.clone();
                }
                break 'outer;
            }
        }
    }
    if node_type.is_empty() {
        return Err(format!(
            "节点不存在：{node_id}（先用 board_apply_ops add_node，再让 render_code 回填）"
        ));
    }
    Ok((
        node_id.to_string(),
        node_type,
        merge_params(Value::Object(merged), params),
    ))
}

/// 回填节点的 patch：素材 id + 溯源参数。
pub fn node_patch(node_type: &str, asset_id: &Value, params: Value) -> Value {
    let mut data = json!({ "assetId": asset_id, "params": params });
    // 输入 / 显示节点的素材是「牌堆」：换成这次的结果，并把下标归零。
    if node_type.starts_with("display.") || node_type.starts_with("input.") {
        data["assetIds"] = json!([asset_id]);
        data["stackIndex"] = json!(0);
    }
    json!({ "data": data })
}
