//! 本地 AI 执行后端的**桌面壳薄层**：实现已搬到 `aicut_daemon::ai_session`。
//!
//! 为什么要搬：会话创建、EP 注册、运行时懒加载这三件事对「桌面 / 桌面内嵌网页 /
//! 容器」是同一份需求，唯一的外部输入是「随包资源在哪儿」和「配置在哪儿」，
//! 而这两件事 `Host` 已经抽象掉了。搬走之后，`aicutd` 也能真的建 ONNX 会话，
//! 不再只有桌面版能跑本地推理。
//!
//! 这里保留 `AppHandle` 签名，是为了不动 `tts` / `asr` / `audio_ai` / `video_ai` /
//! `aligner` / `sdcpp` / `lib.rs` 里的既有调用点——那些模块下一步也会跟着下沉，
//! 到那时它们直接调 `aicut_daemon::ai_session` 即可。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::host::TauriHost;
use crate::network::NetworkRuntime;

pub use aicut_daemon::ai_backend::BackendPreference;
pub use aicut_daemon::ai_session::{
    apply, commit, device_profile, effective, ensure_runtime_loaded, preference, selftest,
    session_builder, set_coreml_cache_dir, set_preference, BackendInfo, BackendOption, DeviceProfile,
};

/// 启动时按当前偏好准备运行时（Windows / Linux 只登记路径，真正加载推迟到首次建会话）。
pub fn init_runtime(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    aicut_daemon::ai_session::init_runtime(Arc::new(TauriHost::new(app.clone())))
}

#[tauri::command]
pub fn ai_backend_info(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
) -> BackendInfo {
    let host = TauriHost::new(app);
    aicut_daemon::ai_session::ai_backend_info(&host, state.inner().as_ref())
}

#[tauri::command]
pub fn ai_set_backend(
    app: AppHandle,
    state: State<'_, Arc<NetworkRuntime>>,
    preference: BackendPreference,
) -> Result<BackendInfo, String> {
    let host = TauriHost::new(app);
    aicut_daemon::ai_session::ai_set_backend(&host, state.inner().as_ref(), preference)
}
