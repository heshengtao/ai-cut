//! TTS 的**跨壳公共部分**：前后端协议类型 + 任务锁 + 进度事件。
//!
//! 本地 TTS（`src-tauri/src/tts.rs`，ONNX 推理）与云端 TTS（`crate::cloud_tts`）
//! 共用同一把任务锁——两种合成不能同时写缓存。协议类型也必须同一份，否则浏览器端
//! 的 JSON 与桌面端的结构体会慢慢漂移。
//!
//! 这里不依赖 Tauri：进度事件通过 `Host::emit_value` 发，桌面壳转发给 webview，
//! 无头进程转发给 SSE。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::host::Host;

/// 朗读进度事件名。
pub const EVENT_TTS: &str = "tts-progress";

/// 进度载荷。
#[derive(Debug, Clone, Serialize)]
pub struct TtsProgress {
    pub state: String,
    pub progress: f32,
    pub message: Option<String>,
}

/// 一段待合成的文字（前端文字片段 id 原样回传，用来把音频放回正确时间点）。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TtsItem {
    pub id: String,
    pub text: String,
}

/// 合成结果：落盘的音频路径 + 时长。
#[derive(Debug, Clone, Serialize)]
pub struct TtsAudio {
    pub id: String,
    pub path: String,
    pub duration: f64,
}

/// 可供选择的音色。
#[derive(Debug, Clone, Serialize)]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
    pub group: String,
}

struct TaskState {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn task() -> &'static TaskState {
    static STATE: OnceLock<TaskState> = OnceLock::new();
    STATE.get_or_init(|| TaskState {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

/// 占住任务锁（本地与云端 TTS 共用）。
pub fn begin_task() -> Result<(), String> {
    if task().running.swap(true, Ordering::SeqCst) {
        return Err("已有朗读任务正在运行".into());
    }
    task().cancel.store(false, Ordering::Relaxed);
    Ok(())
}

/// 释放任务锁。
pub fn end_task() {
    task().running.store(false, Ordering::SeqCst);
}

/// 任务是否被取消。
pub fn cancelled() -> bool {
    task().cancel.load(Ordering::Relaxed)
}

/// 请求取消当前任务（无头进程没有窗口，取消只能从 RPC 打进来）。
pub fn cancel_task() {
    task().cancel.store(true, Ordering::Relaxed);
}

/// 任务是否在跑。
pub fn busy() -> bool {
    task().running.load(Ordering::Relaxed)
}

/// 取消标志的引用：阻塞式推理循环（ONNX 逐帧解码）直接轮询它，避免每帧过一遍函数调用。
pub fn cancel_flag() -> &'static AtomicBool {
    &task().cancel
}

/// 运行标志的引用（本机 TTS 直接管理任务生命周期时用）。
pub fn running_flag() -> &'static AtomicBool {
    &task().running
}

/// 发一条进度事件。
pub fn emit(host: &dyn Host, state: &str, progress: f32, message: Option<String>) {
    let payload = TtsProgress {
        state: state.to_string(),
        progress: progress.clamp(0.0, 1.0),
        message,
    };
    match serde_json::to_value(payload) {
        Ok(value) => host.emit(EVENT_TTS, value),
        Err(error) => eprintln!("[tts] 进度事件序列化失败：{error}"),
    }
}
