//! 本地 AI 执行后端（ONNX Runtime Execution Provider）的选择。
//!
//! CPU / CoreML / DirectML 全部随包、零下载：加 cargo 特性只解锁 `ort::ep::*` 的 API，
//! 不改变链接的 ONNX Runtime。选择存在 `network.json` 的 `backend_preference`，
//! 建会话时按当前选择注册 EP；不支持或注册失败时静默回落 CPU。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

use ort::ep::ExecutionProvider;
use ort::session::builder::SessionBuilder;
use serde::{Deserialize, Serialize};

/// 执行后端偏好。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BackendPreference {
    /// 纯 CPU（默认，全平台可用）。
    #[default]
    Cpu,
    /// Apple CoreML（macOS Apple Silicon）。
    CoreMl,
    /// Windows DirectML。
    DirectMl,
}

impl BackendPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::CoreMl => "coreml",
            Self::DirectMl => "directml",
        }
    }

    fn as_u8(self) -> u8 {
        match self {
            Self::Cpu => 0,
            Self::CoreMl => 1,
            Self::DirectMl => 2,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::CoreMl,
            2 => Self::DirectMl,
            _ => Self::Cpu,
        }
    }

    /// 展示名（后端下发的中文兜底，界面优先用 i18n）。
    pub fn label(self) -> &'static str {
        match self {
            Self::Cpu => "CPU",
            Self::CoreMl => "Apple CoreML",
            Self::DirectMl => "DirectML",
        }
    }

    /// 一句话说明（后端下发的中文兜底，界面优先用 i18n）。
    pub fn note(self) -> &'static str {
        match self {
            Self::Cpu => "纯 CPU（默认，全平台可用）",
            Self::CoreMl => "Apple 神经引擎 / GPU（实测在这些小模型上比 CPU 慢）",
            Self::DirectMl => "DirectX 12 硬件加速（Windows）",
        }
    }

    /// 本机平台是否支持这个后端。
    pub fn platform_ok(self) -> bool {
        match self {
            Self::Cpu => true,
            Self::CoreMl => cfg!(all(target_os = "macos", target_arch = "aarch64")),
            Self::DirectMl => cfg!(target_os = "windows"),
        }
    }

    /// 平台支持且当前 ONNX Runtime 构建包含该 EP。
    pub fn available(self) -> bool {
        if !self.platform_ok() {
            return false;
        }
        if self == Self::Cpu {
            return true;
        }
        match self {
            Self::Cpu => true,
            #[cfg(target_os = "macos")]
            Self::CoreMl => ort::ep::CoreML::default().is_available().unwrap_or(false),
            #[cfg(target_os = "windows")]
            Self::DirectMl => ort::ep::DirectML::default().is_available().unwrap_or(false),
            _ => false,
        }
    }
}

const ALL: [BackendPreference; 3] = [
    BackendPreference::Cpu,
    BackendPreference::CoreMl,
    BackendPreference::DirectMl,
];

static PREFERENCE: AtomicU8 = AtomicU8::new(0);
static COREML_CACHE: OnceLock<PathBuf> = OnceLock::new();

/// 设置当前生效的后端（启动时与保存设置时调用）。
pub fn set_preference(preference: BackendPreference) {
    PREFERENCE.store(preference.as_u8(), Ordering::Relaxed);
}

/// 已保存的后端偏好。
pub fn preference() -> BackendPreference {
    BackendPreference::from_u8(PREFERENCE.load(Ordering::Relaxed))
}

/// 实际生效的后端：本机不支持时回落 CPU。
pub fn effective() -> BackendPreference {
    let preference = preference();
    if preference.platform_ok() {
        preference
    } else {
        BackendPreference::Cpu
    }
}

/// CoreML 编译产物缓存目录（跨重启复用，避免每次建会话都重编译）。
pub fn set_coreml_cache_dir(dir: PathBuf) {
    let _ = COREML_CACHE.set(dir);
}

/// 给 ONNX 会话注册当前执行后端；失败时保留原 builder（ort 会回落 CPU）。
pub fn apply(builder: SessionBuilder) -> SessionBuilder {
    match effective() {
        BackendPreference::Cpu => builder,
        #[cfg(target_os = "macos")]
        BackendPreference::CoreMl => apply_coreml(builder),
        #[cfg(target_os = "windows")]
        BackendPreference::DirectMl => apply_directml(builder),
        _ => builder,
    }
}

#[cfg(target_os = "macos")]
fn apply_coreml(builder: SessionBuilder) -> SessionBuilder {
    let mut ep = ort::ep::CoreML::default()
        .with_compute_units(ort::ep::coreml::ComputeUnits::CPUAndNeuralEngine);
    if let Some(dir) = COREML_CACHE.get() {
        ep = ep.with_model_cache_dir(dir.to_string_lossy().into_owned());
    }
    builder
        .with_execution_providers([ep.build()])
        .unwrap_or_else(|error| {
            eprintln!("[backend] 注册 CoreML 执行后端失败（{error}），回落 CPU");
            error.recover()
        })
}

#[cfg(target_os = "windows")]
fn apply_directml(builder: SessionBuilder) -> SessionBuilder {
    builder
        .with_execution_providers([ort::ep::DirectML::default().build()])
        .unwrap_or_else(|error| {
            eprintln!("[backend] 注册 DirectML 执行后端失败（{error}），回落 CPU");
            error.recover()
        })
}

/// 用已注册 EP 的 builder 建会话；失败时重建一个纯 CPU 会话。
///
/// CoreML / DirectML 都是 partitioning EP，注册成功不代表每张图都能编译
/// （例如某些动态图在 CoreML 下会直接失败）。这里按 ai-daw 的做法硬回落。
pub fn commit(
    mut builder: SessionBuilder,
    cpu_builder: impl FnOnce() -> Result<SessionBuilder, String>,
    path: &std::path::Path,
    label: &str,
) -> Result<ort::session::Session, String> {
    match builder.commit_from_file(path) {
        Ok(session) => Ok(session),
        Err(error) if effective() != BackendPreference::Cpu => {
            eprintln!(
                "[backend] {label} 在 {} 上建会话失败（{error}），回落 CPU",
                effective().label()
            );
            let mut builder = cpu_builder()?;
            builder
                .commit_from_file(path)
                .map_err(|error| format!("加载{label}权重失败：{error}"))
        }
        Err(error) => Err(format!("加载{label}权重失败：{error}")),
    }
}

// ---------------------------------------------------------------------------
// 设置页协议
// ---------------------------------------------------------------------------

/// 一个可选后端（给设置页渲染）。
#[derive(Debug, Clone, Serialize)]
pub struct BackendOption {
    pub kind: String,
    pub label: String,
    pub note: String,
    pub available: bool,
}

/// 后端选择 + 本机情况。
#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    pub preference: String,
    pub current: String,
    pub platform: String,
    pub options: Vec<BackendOption>,
}

fn info(preference: BackendPreference) -> BackendInfo {
    let options = ALL
        .iter()
        .filter(|kind| kind.platform_ok())
        .map(|kind| BackendOption {
            kind: kind.as_str().to_string(),
            label: kind.label().to_string(),
            note: kind.note().to_string(),
            available: kind.available(),
        })
        .collect();
    let current = if preference.platform_ok() {
        preference
    } else {
        BackendPreference::Cpu
    };
    BackendInfo {
        preference: preference.as_str().to_string(),
        current: current.as_str().to_string(),
        platform: platform_label(),
        options,
    }
}

fn platform_label() -> String {
    let mut label = format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH);
    if let Some(chip) = chip_name() {
        label.push_str(" · ");
        label.push_str(&chip);
    }
    label
}

#[cfg(target_os = "macos")]
fn chip_name() -> Option<String> {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(not(target_os = "macos"))]
fn chip_name() -> Option<String> {
    None
}

#[tauri::command]
pub fn ai_backend_info(
    state: tauri::State<'_, std::sync::Arc<crate::network::NetworkRuntime>>,
) -> BackendInfo {
    info(state.get().backend_preference)
}

#[tauri::command]
pub fn ai_set_backend(
    state: tauri::State<'_, std::sync::Arc<crate::network::NetworkRuntime>>,
    preference: BackendPreference,
) -> Result<BackendInfo, String> {
    let mut config = state.get();
    config.backend_preference = preference;
    let next = state.set(config);
    set_preference(next.backend_preference);
    Ok(info(next.backend_preference))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_ids_round_trip() {
        for kind in ALL {
            assert_eq!(BackendPreference::from_u8(kind.as_u8()), kind);
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, format!("\"{}\"", kind.as_str()));
        }
    }

    #[test]
    fn coreml_is_apple_silicon_only() {
        assert!(
            !BackendPreference::CoreMl.platform_ok()
                || cfg!(all(target_os = "macos", target_arch = "aarch64"))
        );
        assert!(!BackendPreference::DirectMl.platform_ok() || cfg!(target_os = "windows"));
        assert!(BackendPreference::Cpu.platform_ok());
    }
}
