//! 跨壳共享的「执行后端」偏好枚举。
//!
//! 为什么放在 daemon：网络配置（`network.json`）里存着这两项，而配置的读写要同时服务
//! 桌面壳与无头 daemon。枚举留在这里，两边共用同一份 serde 表示——桌面端只是
//! `pub use` 回去，既有的 `crate::backend::BackendPreference` 调用点不受影响。

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
    /// NVIDIA CUDA 12（Windows / Linux x86_64，运行时按需下载）。
    ///
    /// 旧配置里只写 `"cuda"`：继续按 CUDA 12 解释，别把老卡带到跑不起来的 13 上。
    #[serde(alias = "cuda")]
    Cuda12,
    /// NVIDIA CUDA 13（Windows x86_64；ORT 1.31 构建，Turing 起 + 驱动 580+）。
    Cuda13,
}

impl BackendPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::CoreMl => "coreml",
            Self::DirectMl => "directml",
            Self::Cuda12 => "cuda12",
            Self::Cuda13 => "cuda13",
        }
    }

    /// 运行时清单里的 id（CUDA 12 的目录 / 条目仍叫 `cuda`）。
    pub fn runtime_id(self) -> &'static str {
        match self {
            Self::Cuda12 => "cuda",
            Self::Cuda13 => "cuda13",
            other => other.as_str(),
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Cpu => 0,
            Self::CoreMl => 1,
            Self::DirectMl => 2,
            Self::Cuda12 => 3,
            Self::Cuda13 => 4,
        }
    }

    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::CoreMl,
            2 => Self::DirectMl,
            3 => Self::Cuda12,
            4 => Self::Cuda13,
            _ => Self::Cpu,
        }
    }

    /// 是不是 CUDA 家族（12 / 13）。
    pub const fn is_cuda(self) -> bool {
        matches!(self, Self::Cuda12 | Self::Cuda13)
    }

    /// CUDA 大版本（12 / 13）；非 CUDA 返回 `None`。
    pub const fn cuda_flavor(self) -> Option<u8> {
        match self {
            Self::Cuda12 => Some(12),
            Self::Cuda13 => Some(13),
            _ => None,
        }
    }

    /// 展示名（后端下发的中文兜底，界面优先用 i18n）。
    pub fn label(self) -> &'static str {
        match self {
            Self::Cpu => "CPU",
            Self::CoreMl => "Apple CoreML",
            Self::DirectMl => "DirectML",
            Self::Cuda12 => "CUDA 12",
            Self::Cuda13 => "CUDA 13",
        }
    }

    /// 一句话说明（后端下发的中文兜底，界面优先用 i18n）。
    pub fn note(self) -> &'static str {
        match self {
            Self::Cpu => "纯 CPU（默认，全平台可用）",
            Self::CoreMl => "Apple 神经引擎 / GPU（实测在这些小模型上比 CPU 慢）",
            Self::DirectMl => "DirectX 12 硬件加速（Windows）",
            Self::Cuda12 => {
                "NVIDIA 显卡加速（整套 CUDA 12 / cuFFT 11 / cuDNN 9 随下载自带，不依赖系统 CUDA；老卡 / 驱动 < 580 兼容性最好）"
            }
            Self::Cuda13 => {
                "NVIDIA 新卡加速（整套 CUDA 13 / cuFFT 12 / cuDNN 9 随下载自带；Turing 起且驱动 580+，更快）"
            }
        }
    }

    /// 本机平台是否支持这个后端。
    pub fn platform_ok(self) -> bool {
        match self {
            Self::Cpu => true,
            Self::CoreMl => cfg!(all(target_os = "macos", target_arch = "aarch64")),
            Self::DirectMl => cfg!(target_os = "windows"),
            Self::Cuda12 => cfg!(any(
                all(target_os = "windows", target_arch = "x86_64"),
                all(target_os = "linux", target_arch = "x86_64")
            )),
            // CUDA 13 的完整组件 Windows / Linux 都自带（Linux 走 `.tar.xz`）。
            Self::Cuda13 => cfg!(any(
                all(target_os = "windows", target_arch = "x86_64"),
                all(target_os = "linux", target_arch = "x86_64")
            )),
        }
    }
}

/// sd.cpp 的执行后端。与 ONNX Runtime 的 CPU / CUDA **不是同一套**：
/// 这里是 ggml 的 CPU / Vulkan / CUDA / ROCm / Metal，选择结果只影响视频生成进程。
///
/// 注意 CPU 在 macOS 上没有独立构建：它复用 Metal 包，用 `--backend cpu` 强制跑 CPU
/// （包里的 `libstable-diffusion.dylib` 本来就带着 ggml-cpu）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SdcppBackend {
    /// 旧配置兼容 / 内部兜底：按显卡自动挑（有 NVIDIA 且装了 CUDA 12 → CUDA 12，
    /// 有 AMD 且装了 ROCm → ROCm，否则 Vulkan，最后 CPU）。界面**不再**把它当作一个可选项，
    /// `info()` 会换算成实际挑中的那一份。
    #[default]
    Auto,
    /// 纯 CPU（全平台可用，最慢）。macOS 上复用 Metal 包、强制 CPU 后端。
    Cpu,
    /// Vulkan（Windows / Linux；AMD / Intel / NVIDIA 都能用）。
    Vulkan,
    /// NVIDIA CUDA 12（Windows x86_64）。
    #[serde(rename = "cuda12")]
    Cuda12,
    /// AMD ROCm / HIP（Windows / Linux x86_64）。
    #[serde(rename = "rocm")]
    Rocm,
    /// Apple Silicon Metal（macOS）。
    Metal,
}

impl SdcppBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cpu => "cpu",
            Self::Vulkan => "vulkan",
            Self::Cuda12 => "cuda12",
            Self::Rocm => "rocm",
            Self::Metal => "metal",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "自动",
            Self::Cpu => "CPU",
            Self::Vulkan => "Vulkan",
            Self::Cuda12 => "CUDA 12",
            Self::Rocm => "ROCm",
            Self::Metal => "Metal",
        }
    }

    pub fn platform_ok(self) -> bool {
        match self {
            Self::Auto | Self::Cpu => true,
            Self::Vulkan => cfg!(any(target_os = "windows", target_os = "linux")),
            Self::Cuda12 => cfg!(all(target_os = "windows", target_arch = "x86_64")),
            Self::Rocm => cfg!(all(
                any(target_os = "windows", target_os = "linux"),
                target_arch = "x86_64"
            )),
            Self::Metal => cfg!(all(target_os = "macos", target_arch = "aarch64")),
        }
    }

    pub fn from_device(device: &str) -> Option<Self> {
        match device {
            "cpu" => Some(Self::Cpu),
            "vulkan" => Some(Self::Vulkan),
            "cuda12" => Some(Self::Cuda12),
            "rocm" => Some(Self::Rocm),
            "metal" => Some(Self::Metal),
            _ => None,
        }
    }
}
