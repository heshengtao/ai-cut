//! 本地 AI 运行时（ONNX Runtime 构建）的下载 / 安装 / 删除。
//!
//! 目录布局与 ai-daw 保持一致（CUDA 12 / CUDA 13 各一套，互不混用）：
//!
//! ```text
//! <app_config>/runtime/ort/
//!   cuda/                                  ← CUDA 12 版 ONNX Runtime 本体
//!     onnxruntime.dll
//!     onnxruntime_providers_cuda.dll
//!     onnxruntime_providers_shared.dll
//!     cudart/cudart64_12.dll               ← 组件各占一个子目录
//!     cublas/cublas64_12.dll + cublasLt64_12.dll
//!     cufft/cufft64_11.dll
//!     cudnn/cudnn64_9.dll + cudnn_*64_9.dll
//!   cuda13/                                ← CUDA 13 版 ONNX Runtime 本体（ORT 1.31）
//!     cudart/cudart64_13.dll
//!     cublas/cublas64_13.dll + cublasLt64_13.dll
//!     cufft/cufft64_12.dll
//!     cudnn/cudnn64_9.dll + cudnn_*64_9.dll（CUDA 13 构建）
//! ```
//!
//! Linux 的目录布局完全相同，只是文件名换成 `lib*`：`cuda/cudart/libcudart.so.12`、
//! `cuda/cublas/libcublas.so.12`、`cuda/cufft/libcufft.so.11`、`cuda/cudnn/libcudnn*.so.9`
//! （CUDA 13 目录对应 `.so.13` / `.so.12`）。NVIDIA 的 Linux 组件只发 `.tar.xz`，
//! 解包时把带小版本号的实体落成 SONAME 名字——provider 是按 SONAME `dlopen` 的。
//!
//! **CUDA 这一套必须整包自带、版本互相匹配**（和 ai-daw 同一套做法）：
//! ORT 的 CUDA provider 是按**裸文件名**去 `LoadLibrary` 依赖的，用户机器上的
//! CUDA / cuDNN 版本五花八门（甚至根本没有），指望系统里那份凑齐就等于把 CUDA
//! 后端交给运气——表现就是「能建会话、GPU 利用率 0」的静默回落 CPU。
//! 所以这里把 ORT 本体与 cudart / cuBLAS / cuFFT / cuDNN 全部按**钉死的版本**下载，
//! 且加载时只认这些目录（见 `backend::preload_cuda`），不碰系统 PATH / CUDA Toolkit / pip。
//!
//! CUDA 12 与 CUDA 13 是**两套独立运行时**：安装包按大版本一起下（点「下载 CUDA 13」
//! 会顺带补齐 13 的四个组件），删一个不会动另一套；加载时也只把选中的那一套加进
//! 进程（见 `backend`），避免同一个进程里混进两个大版本。
//!
//! CPU / DirectML / CoreML 是随包基线（`bundled`，不可删除）；CUDA 版按需下载，
//! 安装 / 删除后重启应用生效。进度走 `runtime-progress` 事件。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::network::NetworkRuntime;

pub const EVENT_RUNTIME: &str = "runtime-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub id: String,
    /// i18n key（`runtime.<id>`）。
    pub label: String,
    /// i18n key（`runtime.<id>.note`）。
    pub note: String,
    /// 分组：`ort`（ONNX Runtime 本体）/ `cuda12` / `cuda13`（组件）。
    pub group: String,
    /// 是不是运行时本体（CUDA 版 ONNX Runtime）。
    pub core: bool,
    /// 需要下载的字节数；随包基线为 0。
    pub bytes: u64,
    pub installed: bool,
    /// 随安装包分发：不下载、不可删除。
    pub bundled: bool,
    pub license: String,
    /// 装好后的目录（「显示位置」用）；随包基线为空。
    pub dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProgress {
    pub id: String,
    /// `downloading` / `done` / `error`
    pub state: String,
    pub received: u64,
    pub total: u64,
    pub message: Option<String>,
}

struct RuntimeFile {
    /// 归档内路径（`/` 分隔）。
    from: &'static str,
    to: &'static str,
}

struct RuntimeSource {
    region: &'static str,
    url: &'static str,
}

struct RuntimeEntry {
    id: &'static str,
    /// `ort`（本体）或 `cuda12` / `cuda13`（组件）。
    group: &'static str,
    /// 运行时本体（CUDA 版 ONNX Runtime）。
    core: bool,
    /// 相对运行时根目录的安装路径（`cuda` / `cuda/cudart` / `cuda13` / `cuda13/cudnn`）。
    install_dir: &'static str,
    /// 判定「已安装」必须存在的文件（相对 `install_dir` 的单层文件名；
    /// `files` 非空时以 `files` 为准）。
    required: &'static [&'static str],
    /// 安装清单版本，写进 `marker.json`。
    ///
    /// 改版本号 = 老安装被判定为未安装、重新下载：这样「换了 ORT 版本」不会留下
    /// 「新本体 + 老组件」的混装（那种组合只有建会话时才会炸，且是静默回落 CPU）。
    revision: &'static str,
    bytes: u64,
    /// 归档 sha256（空 = 不校验）。
    sha256: &'static str,
    license: &'static str,
    bundled: bool,
    archive: &'static str,
    /// `zip` 或 `tgz`
    kind: &'static str,
    /// 归档里所有 `.dll` 平铺进安装目录（CUDA / cuDNN 组件用）。
    extract_dlls: bool,
    sources: &'static [RuntimeSource],
    files: &'static [RuntimeFile],
}

/// CUDA 12 的四个组件 id（顺序即界面组件卡片顺序）。
pub const CUDA12_COMPONENTS: [&str; 4] = ["cudart", "cublas", "cufft", "cudnn"];

/// CUDA 13 的四个组件 id（与 CUDA 12 是**两套**，可并存、互不影响）。
pub const CUDA13_COMPONENTS: [&str; 4] = ["cudart13", "cublas13", "cufft13", "cudnn13"];

/// 某个本体对应的组件 id（CPU / DirectML / CoreML 没有组件）。
pub fn components_of(core: &str) -> &'static [&'static str] {
    match core {
        "cuda" => &CUDA12_COMPONENTS,
        "cuda13" => &CUDA13_COMPONENTS,
        _ => &[],
    }
}

/// 一个运行时 / 组件属于哪套 CUDA 大版本（`None` = 与 CUDA 无关）。
pub fn cuda_flavor_of(id: &str) -> Option<u8> {
    if id == "cuda" || CUDA12_COMPONENTS.contains(&id) {
        Some(12)
    } else if id == "cuda13" || CUDA13_COMPONENTS.contains(&id) {
        Some(13)
    } else {
        None
    }
}

/// CUDA 组件在本体目录里的子目录名（`runtime/ort/cuda/<name>`、`runtime/ort/cuda13/<name>`）。
///
/// 必须与 [`WINDOWS_ENTRIES`] / [`LINUX_ENTRIES`] 里各组件条目的 `install_dir` 保持一致；
/// 加载侧（`backend::preload_cuda`）只认这些目录。
#[cfg(not(target_os = "macos"))]
pub const CUDA_COMPONENT_DIRS: [&str; 4] = ["cudart", "cublas", "cufft", "cudnn"];

/// 已存在的 CUDA 组件目录（不存在的不返回）。
///
/// 加载路径只用这个列表去找 cudart / cuBLAS / cuFFT / cuDNN，
/// **不会**再去搜 `CUDA_PATH` / `PATH` / pip / `torch/lib`：那些目录里的版本
/// 与我们下载的这一套对不上，混进进程反而更难查。
#[cfg(not(target_os = "macos"))]
pub fn cuda_component_dirs(runtime_dir: &Path) -> Vec<PathBuf> {
    CUDA_COMPONENT_DIRS
        .iter()
        .map(|name| runtime_dir.join(name))
        .filter(|dir| dir.is_dir())
        .collect()
}

/// Windows：DirectML 是基线；CUDA 12 / CUDA 13 本体与各自的四个组件都可按需下载。
///
/// 这一张表就是「CUDA 要完整匹配下载」的唯一事实来源：**版本必须互相匹配**。
/// - CUDA 12 用 ORT 1.26（provider 硬依赖 `cudart64_12` / `cublas64_12` /
///   `cublasLt64_12` / `cufft64_11` / `cudnn64_9`）；
/// - CUDA 13 用 ORT 1.31.1（provider 硬依赖 `cudart64_13` / `cublas64_13` /
///   `cublasLt64_13` / `cufft64_12` / `cudnn64_9`）。
///
/// 两份 build 不能混：1.30+ 的 provider 是 CUDA **13** 构建，硬导入 `cublas64_13`；
/// 与 CUDA 12 组件混装 → `LoadLibrary` 失败 → ORT 静默回落 CPU（界面看起来只是
/// 「CUDA 不可用」）。
/// Windows x86_64 的清单（**始终参与编译**：Linux 上也能被类型检查和测试覆盖）。
const WINDOWS_ENTRIES: &[RuntimeEntry] = &[
    RuntimeEntry {
        id: "cuda",
        group: "ort",
        core: true,
        install_dir: "cuda",
        required: &[],
        // 换 ORT 版本时改这里：老安装会被判定为未安装并重新下载。
        revision: "ort1.26.0-cuda12",
        bytes: 187_934_177,
        sha256: "2820b8cca24b7c2817f28aa6ea8774a5c519295caa7447b86d190c7079aabf0f",
        license: "MIT",
        bundled: false,
        archive: "microsoft.ml.onnxruntime.gpu.windows.1.26.0.nupkg",
        kind: "zip",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.windows/1.26.0/microsoft.ml.onnxruntime.gpu.windows.1.26.0.nupkg",
            },
            RuntimeSource {
                region: "cn",
                url: "https://mirrors.huaweicloud.com/artifactory/api/nuget/v3/nuget-remote/microsoft.ml.onnxruntime.gpu.windows/1.26.0/microsoft.ml.onnxruntime.gpu.windows.1.26.0.nupkg",
            },
        ],
        files: &[
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime.dll",
                to: "onnxruntime.dll",
            },
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime_providers_cuda.dll",
                to: "onnxruntime_providers_cuda.dll",
            },
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime_providers_shared.dll",
                to: "onnxruntime_providers_shared.dll",
            },
        ],
    },
    RuntimeEntry {
        id: "cuda13",
        group: "ort",
        core: true,
        install_dir: "cuda13",
        required: &[],
        revision: "ort1.31.1-cuda13",
        bytes: 160_446_793,
        sha256: "9c9c7c951b9e76036b5e90d2a519359969d717d1c16dfc718c808afb42d778b1",
        license: "MIT",
        bundled: false,
        archive: "microsoft.ml.onnxruntime.gpu.windows.1.31.1.nupkg",
        kind: "zip",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.windows/1.31.1/microsoft.ml.onnxruntime.gpu.windows.1.31.1.nupkg",
            },
            RuntimeSource {
                region: "cn",
                url: "https://mirrors.huaweicloud.com/artifactory/api/nuget/v3/nuget-remote/microsoft.ml.onnxruntime.gpu.windows/1.31.1/microsoft.ml.onnxruntime.gpu.windows.1.31.1.nupkg",
            },
        ],
        files: &[
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime.dll",
                to: "onnxruntime.dll",
            },
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime_providers_cuda.dll",
                to: "onnxruntime_providers_cuda.dll",
            },
            RuntimeFile {
                from: "runtimes/win-x64/native/onnxruntime_providers_shared.dll",
                to: "onnxruntime_providers_shared.dll",
            },
        ],
    },
    RuntimeEntry {
        id: "cudart",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cudart",
        required: &["cudart64_12.dll"],
        revision: "cuda12.8.90",
        bytes: 3_037_735,
        sha256: "4a39058fd8519444a81cfc7ae055d136f48d1a31ffa41ae255b35b2edd61e13b",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "cuda_cudart-windows-x86_64-12.8.90-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.8.90-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.8.90-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cublas",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cublas",
        required: &["cublas64_12.dll", "cublasLt64_12.dll"],
        revision: "cuda12.8.4.1",
        bytes: 563_660_944,
        sha256: "57a470112cec7e112c95253dde8b3c7184d795dbd92b0bde77a4cb7f8c94c8aa",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcublas-windows-x86_64-12.8.4.1-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-12.8.4.1-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-12.8.4.1-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cufft",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cufft",
        required: &["cufft64_11.dll"],
        revision: "cuda11.3.3.83",
        bytes: 190_568_498,
        // 来自 NVIDIA 的 redist 清单（redistrib_12.8.1.json），不是手填的。
        sha256: "cc6e0ba958cf23387b462017a24464c72bd901549046133f3d1ebcc3d7444c90",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcufft-windows-x86_64-11.3.3.83-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcufft/windows-x86_64/libcufft-windows-x86_64-11.3.3.83-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcufft/windows-x86_64/libcufft-windows-x86_64-11.3.3.83-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cudnn",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cudnn",
        // cuDNN 9 的子库是**运行期按裸文件名**载入的（9.27 还要 engines_tensor_ir 等
        // `ort` 清单里没有的），所以只校验两个入口库，其余整目录都在。
        required: &["cudnn64_9.dll", "cudnn_graph64_9.dll"],
        revision: "cudnn9.27.0.42-cuda12",
        bytes: 1_924_314_965,
        sha256: "93949680d6499ad0f17fc1abb131825c9dd41b460844513f608e840e0c8ce72b",
        license: "cuDNN",
        bundled: false,
        archive: "cudnn-windows-x86_64-9.27.0.42_cuda12-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.27.0.42_cuda12-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.27.0.42_cuda12-archive.zip",
            },
        ],
        files: &[],
    },
    // ---- CUDA 13：ORT 1.31 的 CUDA 13 构建 + 配套组件（与上面那套并存） ----
    RuntimeEntry {
        id: "cudart13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cudart",
        required: &["cudart64_13.dll"],
        revision: "cuda13.0.96",
        bytes: 2_873_447,
        sha256: "a2ed875f9997aa24904fb70cc9db3acd9308433cde99bc8e63ec1271c9da31b4",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "cuda_cudart-windows-x86_64-13.0.96-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-13.0.96-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-13.0.96-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cublas13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cublas",
        required: &["cublas64_13.dll", "cublasLt64_13.dll"],
        revision: "cublas13.0.2.14",
        bytes: 401_229_263,
        sha256: "b03fd06fb14fa33e27fc441433fe74ccee9738b62c62a08d39960cb0ce9f1d14",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcublas-windows-x86_64-13.0.2.14-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.0.2.14-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.0.2.14-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cufft13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cufft",
        required: &["cufft64_12.dll"],
        revision: "cufft12.0.0.61-cuda13",
        bytes: 212_026_245,
        sha256: "4f2695ea50f895618316ee32636f5d0e5e0bc330e74b3e0876bff002af9e1eb3",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcufft-windows-x86_64-12.0.0.61-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcufft/windows-x86_64/libcufft-windows-x86_64-12.0.0.61-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcufft/windows-x86_64/libcufft-windows-x86_64-12.0.0.61-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "cudnn13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cudnn",
        required: &["cudnn64_9.dll", "cudnn_graph64_9.dll"],
        revision: "cudnn9.27.0.42-cuda13",
        bytes: 1_330_803_635,
        sha256: "15595c7b52896262a0e590f02b3b3851c6a2c9046a72047526deaf59a9cbf7d5",
        license: "cuDNN",
        bundled: false,
        archive: "cudnn-windows-x86_64-9.27.0.42_cuda13-archive.zip",
        kind: "zip",
        extract_dlls: true,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.27.0.42_cuda13-archive.zip",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.27.0.42_cuda13-archive.zip",
            },
        ],
        files: &[],
    },
    RuntimeEntry {
        id: "directml",
        group: "ort",
        core: true,
        install_dir: "",
        required: &[],
        revision: "",
        bytes: 0,
        sha256: "",
        license: "MIT",
        bundled: true,
        archive: "",
        kind: "",
        extract_dlls: false,
        sources: &[],
        files: &[],
    },
];

/// Linux x86_64 的清单：CPU 基线 + CUDA 12 / CUDA 13 两套**完整自带**的运行时。
///
/// NVIDIA 的 Linux CUDA 组件只发 `.tar.xz`，而且归档里带版本号的是实体、
/// SONAME 是符号链接（没有内容），所以每个组件只取清单里的实体文件，落到 SONAME
/// 名字（`libcudart.so.12` 等）——ORT 的 provider 是按 SONAME `dlopen` 的。
/// 这样和 Windows 一样不依赖系统 CUDA。
const LINUX_ENTRIES: &[RuntimeEntry] = &[
    RuntimeEntry {
        id: "cpu",
        group: "ort",
        core: true,
        install_dir: "",
        required: &[],
        revision: "",
        bytes: 0,
        sha256: "",
        license: "MIT",
        bundled: true,
        archive: "",
        kind: "",
        extract_dlls: false,
        sources: &[],
        files: &[],
    },
    RuntimeEntry {
        id: "cuda",
        group: "ort",
        core: true,
        install_dir: "cuda",
        required: &[],
        // 1.30+ 的 Linux GPU 包是 CUDA **13** 构建；CUDA 12 必须钉 1.26。
        revision: "ort1.26.0-cuda12-linux",
        bytes: 225_183_750,
        sha256: "cf7943f58b9360fe1448c4baf40ac12ce4175978ecd3fe6f21a4c00976f63a59",
        license: "MIT",
        bundled: false,
        archive: "microsoft.ml.onnxruntime.gpu.linux.1.26.0.nupkg",
        kind: "zip",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.26.0/microsoft.ml.onnxruntime.gpu.linux.1.26.0.nupkg",
            },
            RuntimeSource {
                region: "cn",
                url: "https://mirrors.huaweicloud.com/artifactory/api/nuget/v3/nuget-remote/microsoft.ml.onnxruntime.gpu.linux/1.26.0/microsoft.ml.onnxruntime.gpu.linux.1.26.0.nupkg",
            },
        ],
        files: &[
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime.so",
                to: "libonnxruntime.so",
            },
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime_providers_cuda.so",
                to: "libonnxruntime_providers_cuda.so",
            },
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime_providers_shared.so",
                to: "libonnxruntime_providers_shared.so",
            },
        ],
    },
    RuntimeEntry {
        id: "cuda13",
        group: "ort",
        core: true,
        install_dir: "cuda13",
        required: &[],
        revision: "ort1.31.1-cuda13-linux",
        bytes: 244_926_281,
        sha256: "cfb5315b87f812d8d91194075eb4aab3cbfd97a932f2b56c9bfa41e36087c4a2",
        license: "MIT",
        bundled: false,
        archive: "microsoft.ml.onnxruntime.gpu.linux.1.31.1.nupkg",
        kind: "zip",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.31.1/microsoft.ml.onnxruntime.gpu.linux.1.31.1.nupkg",
            },
            RuntimeSource {
                region: "cn",
                url: "https://mirrors.huaweicloud.com/artifactory/api/nuget/v3/nuget-remote/microsoft.ml.onnxruntime.gpu.linux/1.31.1/microsoft.ml.onnxruntime.gpu.linux.1.31.1.nupkg",
            },
        ],
        files: &[
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime.so",
                to: "libonnxruntime.so",
            },
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime_providers_cuda.so",
                to: "libonnxruntime_providers_cuda.so",
            },
            RuntimeFile {
                from: "runtimes/linux-x64/native/libonnxruntime_providers_shared.so",
                to: "libonnxruntime_providers_shared.so",
            },
        ],
    },
    // ---- CUDA 12 组件（Linux，`.tar.xz`，落到 SONAME） ----
    RuntimeEntry {
        id: "cudart",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cudart",
        required: &[],
        revision: "cuda12.8.90-linux",
        bytes: 1_354_240,
        sha256: "8d566b5fe745c46842dc16945cf36686227536decd2302c372be86da37faca68",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "cuda_cudart-linux-x86_64-12.8.90-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-12.8.90-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-12.8.90-archive.tar.xz",
            },
        ],
        files: &[RuntimeFile {
            from: "cuda_cudart-linux-x86_64-12.8.90-archive/lib/libcudart.so.12.8.90",
            to: "libcudart.so.12",
        }],
    },
    RuntimeEntry {
        id: "cublas",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cublas",
        required: &[],
        revision: "cuda12.8.4.1-linux",
        bytes: 938_651_324,
        sha256: "21718957c2cf000bacd69d36c95708a2319199e39e056f8b4f0f68e3b9f323bb",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcublas-linux-x86_64-12.8.4.1-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-12.8.4.1-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-12.8.4.1-archive.tar.xz",
            },
        ],
        files: &[
            RuntimeFile {
                from: "libcublas-linux-x86_64-12.8.4.1-archive/lib/libcublas.so.12.8.4.1",
                to: "libcublas.so.12",
            },
            RuntimeFile {
                from: "libcublas-linux-x86_64-12.8.4.1-archive/lib/libcublasLt.so.12.8.4.1",
                to: "libcublasLt.so.12",
            },
        ],
    },
    RuntimeEntry {
        id: "cufft",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cufft",
        required: &[],
        revision: "cuda11.3.3.83-linux",
        bytes: 448_695_100,
        sha256: "126fe08fc0df07a7420c2da05a2ae72ea19660fff79bf06de16520d1f915cb83",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcufft-linux-x86_64-11.3.3.83-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcufft/linux-x86_64/libcufft-linux-x86_64-11.3.3.83-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcufft/linux-x86_64/libcufft-linux-x86_64-11.3.3.83-archive.tar.xz",
            },
        ],
        files: &[RuntimeFile {
            from: "libcufft-linux-x86_64-11.3.3.83-archive/lib/libcufft.so.11.3.3.83",
            to: "libcufft.so.11",
        }],
    },
    RuntimeEntry {
        id: "cudnn",
        group: "cuda12",
        core: false,
        install_dir: "cuda/cudnn",
        required: &[],
        revision: "cudnn9.27.0.42-cuda12-linux",
        bytes: 1_012_666_264,
        sha256: "dc45f8c5fd44955c6e950c690ea92c28ea848ffb1fefbaabf3a9d175d961263a",
        license: "cuDNN",
        bundled: false,
        archive: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.27.0.42_cuda12-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.27.0.42_cuda12-archive.tar.xz",
            },
        ],
        files: &[
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn.so.9.27.0",
                to: "libcudnn.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_adv.so.9.27.0",
                to: "libcudnn_adv.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_cnn.so.9.27.0",
                to: "libcudnn_cnn.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_engines_precompiled.so.9.27.0",
                to: "libcudnn_engines_precompiled.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_engines_runtime_compiled.so.9.27.0",
                to: "libcudnn_engines_runtime_compiled.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_engines_tensor_ir.so.9.27.0",
                to: "libcudnn_engines_tensor_ir.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_ext.so.9.27.0",
                to: "libcudnn_ext.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_graph.so.9.27.0",
                to: "libcudnn_graph.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_heuristic.so.9.27.0",
                to: "libcudnn_heuristic.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda12-archive/lib/libcudnn_ops.so.9.27.0",
                to: "libcudnn_ops.so.9",
            },
        ],
    },
    // ---- CUDA 13 组件（Linux）：与 CUDA 12 那套并存，目录名带 13 后缀 ----
    RuntimeEntry {
        id: "cudart13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cudart",
        required: &[],
        revision: "cuda13.0.96-linux",
        bytes: 1_487_960,
        sha256: "25b8071951baba827be1580b841d363464f6ee6c39f48d33a81646f90cc95ed1",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "cuda_cudart-linux-x86_64-13.0.96-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-13.0.96-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-13.0.96-archive.tar.xz",
            },
        ],
        files: &[RuntimeFile {
            from: "cuda_cudart-linux-x86_64-13.0.96-archive/lib/libcudart.so.13.0.96",
            to: "libcudart.so.13",
        }],
    },
    RuntimeEntry {
        id: "cublas13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cublas",
        required: &[],
        revision: "cublas13.0.2.14-linux",
        bytes: 800_056_524,
        sha256: "158c1d7e862282d5218ed82f173ba14679c0f8afa1fe8cb4a3a34a4c0a9a5ff9",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcublas-linux-x86_64-13.0.2.14-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-13.0.2.14-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-13.0.2.14-archive.tar.xz",
            },
        ],
        files: &[
            RuntimeFile {
                from: "libcublas-linux-x86_64-13.0.2.14-archive/lib/libcublas.so.13.0.2.14",
                to: "libcublas.so.13",
            },
            RuntimeFile {
                from: "libcublas-linux-x86_64-13.0.2.14-archive/lib/libcublasLt.so.13.0.2.14",
                to: "libcublasLt.so.13",
            },
        ],
    },
    RuntimeEntry {
        id: "cufft13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cufft",
        required: &[],
        revision: "cufft12.0.0.61-cuda13-linux",
        bytes: 354_634_628,
        sha256: "5cdef1238c270f8f148da18587fdba8b9478c596e40f5490bba2b15c94915dd9",
        license: "CUDA Toolkit",
        bundled: false,
        archive: "libcufft-linux-x86_64-12.0.0.61-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcufft/linux-x86_64/libcufft-linux-x86_64-12.0.0.61-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cuda/redist/libcufft/linux-x86_64/libcufft-linux-x86_64-12.0.0.61-archive.tar.xz",
            },
        ],
        files: &[RuntimeFile {
            from: "libcufft-linux-x86_64-12.0.0.61-archive/lib/libcufft.so.12.0.0.61",
            to: "libcufft.so.12",
        }],
    },
    RuntimeEntry {
        id: "cudnn13",
        group: "cuda13",
        core: false,
        install_dir: "cuda13/cudnn",
        required: &[],
        revision: "cudnn9.27.0.42-cuda13-linux",
        bytes: 937_996_620,
        sha256: "dd3245ba3aca8593934fc946d08649ad3a5ee8500e8da3870bc23bf7ddccd7f9",
        license: "cuDNN",
        bundled: false,
        archive: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive.tar.xz",
        kind: "tarxz",
        extract_dlls: false,
        sources: &[
            RuntimeSource {
                region: "intl",
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.27.0.42_cuda13-archive.tar.xz",
            },
            RuntimeSource {
                region: "cn",
                url: "https://developer.download.nvidia.cn/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.27.0.42_cuda13-archive.tar.xz",
            },
        ],
        files: &[
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn.so.9.27.0",
                to: "libcudnn.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_adv.so.9.27.0",
                to: "libcudnn_adv.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_cnn.so.9.27.0",
                to: "libcudnn_cnn.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_engines_precompiled.so.9.27.0",
                to: "libcudnn_engines_precompiled.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_engines_runtime_compiled.so.9.27.0",
                to: "libcudnn_engines_runtime_compiled.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_engines_tensor_ir.so.9.27.0",
                to: "libcudnn_engines_tensor_ir.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_ext.so.9.27.0",
                to: "libcudnn_ext.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_graph.so.9.27.0",
                to: "libcudnn_graph.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_heuristic.so.9.27.0",
                to: "libcudnn_heuristic.so.9",
            },
            RuntimeFile {
                from: "cudnn-linux-x86_64-9.27.0.42_cuda13-archive/lib/libcudnn_ops.so.9.27.0",
                to: "libcudnn_ops.so.9",
            },
        ],
    },
];

/// 其它平台（macOS）：只有随包基线，运行时不需要下载。
const MINIMAL_ENTRIES: &[RuntimeEntry] = &[RuntimeEntry {
    id: "coreml",
    group: "ort",
    core: true,
    install_dir: "",
    required: &[],
    revision: "",
    bytes: 0,
    sha256: "",
    license: "MIT",
    bundled: true,
    archive: "",
    kind: "",
    extract_dlls: false,
    sources: &[],
    files: &[],
}];

/// 本机平台的运行时清单。
///
/// 三张表都**始终参与编译**（只是数据）：Linux 那份在 Windows 上也能被类型检查和
/// 测试覆盖，写错一个文件名不用等到 Linux 才发现。
fn entries() -> &'static [RuntimeEntry] {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => WINDOWS_ENTRIES,
        ("linux", "x86_64") => LINUX_ENTRIES,
        _ => MINIMAL_ENTRIES,
    }
}

struct Installer {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn installer() -> &'static Installer {
    static INSTALLER: OnceLock<Installer> = OnceLock::new();
    INSTALLER.get_or_init(|| Installer {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

/// 是否有运行库正在下载（界面挂载时用来纠正「卡在下载中」的状态）。
pub fn busy() -> bool {
    installer().running.load(Ordering::SeqCst)
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::config_dir(app)
        .map(|dir| dir.join("runtime").join("ort"))
        .map_err(|error| format!("拿不到应用配置目录：{error}"))
}

fn runtime_dir(app: &AppHandle, entry: &RuntimeEntry) -> Result<PathBuf, String> {
    let mut dir = app_dir(app)?;
    for part in entry.install_dir.split('/').filter(|part| !part.is_empty()) {
        dir = dir.join(part);
    }
    Ok(dir)
}

fn entry(id: &str) -> Option<&'static RuntimeEntry> {
    entries().iter().find(|entry| entry.id == id)
}

/// 某个运行时 / 组件的下载体积（未知为 0）。
pub fn bytes(id: &str) -> u64 {
    entry(id).map(|entry| entry.bytes).unwrap_or(0)
}

/// 这一项在本机目录里是否**完整**（不看「待删除」清单）。
fn on_disk(app: &AppHandle, entry: &RuntimeEntry) -> bool {
    if entry.bundled {
        return true;
    }
    let Ok(dir) = runtime_dir(app, entry) else {
        return false;
    };
    dir_holds(entry, &dir)
}

/// 某个运行时 / 组件是否已装好（「待删除」的条目不算）。
pub fn installed(app: &AppHandle, id: &str) -> bool {
    let Some(entry) = entry(id) else {
        return false;
    };
    if entry.bundled {
        return true;
    }
    if pending_ids(app).iter().any(|pending| pending == id) {
        return false;
    }
    on_disk(app, entry)
}

/// 还缺哪些组件（空 = 齐了 / 不是 CUDA 本体）。
pub fn missing_components(app: &AppHandle, core: &str) -> Vec<&'static str> {
    components_of(core)
        .iter()
        .copied()
        .filter(|id| !installed(app, id))
        .collect()
}

/// `dir` 里的文件与版本是否都和 `entry` 对得上。
///
/// **版本也必须对**：换了 ORT / 组件的钉死版本后，老目录会被当成「没装」，
/// 走一次正常下载——否则就会留下「新本体 + 老组件」这种只有建会话时才炸的混装。
fn dir_holds(entry: &RuntimeEntry, dir: &Path) -> bool {
    let files_ok = if entry.files.is_empty() {
        entry.required.iter().all(|name| dir.join(name).is_file())
    } else {
        entry.files.iter().all(|file| dir.join(file.to).is_file())
    };
    files_ok && marker_revision(dir).as_deref() == Some(entry.revision)
}

/// `marker.json` 里记录的安装版本（没有 / 读不出来 = `None`）。
fn marker_revision(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("marker.json")).ok()?;
    // 有人用编辑器手动改过这个文件时可能带 BOM，`serde_json` 会因为 BOM 直接报错。
    let text = text.trim_start_matches('\u{feff}');
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value
        .get("revision")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn statuses(app: &AppHandle) -> Vec<RuntimeStatus> {
    let pending = pending_ids(app);
    entries()
        .iter()
        .map(|entry| RuntimeStatus {
            id: entry.id.to_string(),
            label: format!("runtime.{}", entry.id),
            note: format!("runtime.{}.note", entry.id),
            group: entry.group.to_string(),
            core: entry.core,
            bytes: entry.bytes,
            installed: entry.bundled
                || (!pending.iter().any(|id| id == entry.id) && on_disk(app, entry)),
            bundled: entry.bundled,
            license: entry.license.to_string(),
            dir: if entry.bundled {
                String::new()
            } else {
                runtime_dir(app, entry)
                    .map(|dir| dir.to_string_lossy().into_owned())
                    .unwrap_or_default()
            },
        })
        .collect()
}

#[tauri::command]
pub fn runtime_catalog(app: AppHandle) -> Vec<RuntimeStatus> {
    statuses(&app)
}

// ---------------------------------------------------------------------------
// 「待删除」清单：DLL 被本进程映射时删不掉，留到下次启动再删
// ---------------------------------------------------------------------------

/// 待删除 id 清单（`<配置目录>/runtime/ort/pending-remove.json`）。
fn pending_file(app: &AppHandle) -> Option<PathBuf> {
    app_dir(app).ok().map(|dir| dir.join("pending-remove.json"))
}

fn pending_ids(app: &AppHandle) -> Vec<String> {
    pending_file(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn write_pending(app: &AppHandle, ids: &[String]) -> Result<(), String> {
    let Some(path) = pending_file(app) else {
        return Err("拿不到应用配置目录".into());
    };
    if ids.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(ids).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// 记下「这次没删掉、下次启动再删」。界面上从这一刻起就当它不存在了。
fn mark_pending(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut ids = pending_ids(app);
    if !ids.iter().any(|existing| existing == id) {
        ids.push(id.to_string());
    }
    write_pending(app, &ids)
}

/// 重新安装 / 已经删干净：把待删除记录撤掉，免得下次启动把新装的又删了。
fn clear_pending(app: &AppHandle, id: &str) {
    let before = pending_ids(app);
    let mut ids = before.clone();
    ids.retain(|existing| existing != id);
    if ids.len() != before.len() {
        let _ = write_pending(app, &ids);
    }
}

/// 删除一个条目的文件（组件整目录删；本体只删自己那几个文件，不动组件子目录）。
fn remove_entry_files(entry: &RuntimeEntry, dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    if entry.extract_dlls {
        fs::remove_dir_all(dir).map_err(|error| format!("删除 {} 失败：{error}", entry.id))?;
        return Ok(());
    }
    for file in entry.files {
        let path = dir.join(file.to);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("删除 {} 失败：{error}", path.display()))?;
        }
    }
    let _ = fs::remove_file(dir.join("marker.json"));
    Ok(())
}

/// 启动时清理待删除目录（此时本进程还没加载任何 dylib，文件不再被占用）。
fn cleanup_pending(app: &AppHandle) {
    let ids = pending_ids(app);
    if ids.is_empty() {
        return;
    }
    let mut left: Vec<String> = Vec::new();
    for id in ids {
        let Some(entry) = entry(&id) else {
            continue;
        };
        let Ok(dir) = runtime_dir(app, entry) else {
            left.push(id);
            continue;
        };
        match remove_entry_files(entry, &dir) {
            Ok(()) => eprintln!("[runtime] 已清理待删除的目录：{}", dir.display()),
            Err(error) => {
                eprintln!(
                    "[runtime] 待删除的目录仍被占用（{}）：{error}",
                    dir.display()
                );
                left.push(id);
            }
        }
    }
    let _ = write_pending(app, &left);
}

// ---------------------------------------------------------------------------
// 「待重启」标记：装了 / 删了本进程已经加载的那一套运行时
// ---------------------------------------------------------------------------

/// `pending-restart` 标记文件（运行时根目录下）。
///
/// 为什么不能只比较「已加载路径 vs 期望路径」：**CUDA 组件**（cudart / cuBLAS /
/// cuFFT / cuDNN）是在加载那一刻一次性预载进进程的。之后再补装它们，已经注册好
/// 的 provider 用不上——可加载路径根本没变，只看路径会得出「不用重启」的错误结论，
/// 用户装完看到「已安装」，却依旧在跑 CPU。
fn pending_restart_file(app: &AppHandle) -> Option<PathBuf> {
    app_dir(app).ok().map(|dir| dir.join("pending-restart"))
}

/// 本进程里的运行时是否已经过时（装 / 删过当前选用的那一套）。
pub fn restart_pending(app: &AppHandle) -> bool {
    pending_restart_file(app).is_some_and(|path| path.is_file())
}

/// 记下「本进程里的运行时已经过时了」。
pub fn mark_restart_needed(app: &AppHandle) {
    if let Some(path) = pending_restart_file(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, b"1");
    }
}

/// 启动时清掉标记：重启之后改动就已经生效了。
fn clear_restart_needed(app: &AppHandle) {
    if let Some(path) = pending_restart_file(app) {
        let _ = fs::remove_file(path);
    }
}

/// 这次装 / 删会不会影响**当前选用**的那份运行时。
///
/// 在 CPU 后端下补下 CUDA 组件不该提示重启——那份运行时根本没加载。
/// 组件只影响同大版本的那份 CUDA（12 的组件不会影响 CUDA 13 本体）。
fn affects_chosen(id: &str) -> bool {
    let chosen = crate::backend::preference();
    chosen.cuda_flavor().is_some() && chosen.cuda_flavor() == cuda_flavor_of(id)
}

/// 启动时调用（**必须在任何 dylib 被加载之前**）：
/// 删掉上次没删干净的目录、清掉「待重启」标记。
pub fn init(app: &AppHandle) {
    cleanup_pending(app);
    clear_restart_needed(app);
}

/// 开始下载并安装一个运行时（本体 + 同大版本缺失的组件）。
///
/// CUDA 本体一次会顺带补齐它的四个组件：用户点一次「下载 CUDA 12 / 13」就够了，
/// 不用再逐个点 cudart / cuBLAS / cuFFT / cuDNN；两套大版本不会混装。
#[tauri::command]
pub async fn runtime_install(
    app: AppHandle,
    id: String,
    force: Option<bool>,
) -> Result<(), String> {
    let Some(requested) = entry(&id) else {
        return Err(format!("未知运行时：{id}"));
    };
    if requested.bundled {
        return Err("随包运行时不需要下载".into());
    }
    if installed(&app, requested.id) && !force.unwrap_or(false) {
        return Ok(());
    }
    if installer().running.swap(true, Ordering::SeqCst) {
        return Err("已有运行时正在下载".into());
    }
    installer().cancel.store(false, Ordering::Relaxed);
    let result = install_inner(&app, requested).await;
    installer().running.store(false, Ordering::SeqCst);
    result
}

/// 安装计划：请求的本体 + 同大版本里还没装的组件。
///
/// CUDA 12 / 13 的组件 id 不同（13 带后缀），所以这里按 `components_of` 取，
/// 不会把另一套的组件混进来。
fn bundle_plan(
    requested: &'static RuntimeEntry,
    installed: impl Fn(&str) -> bool,
) -> Vec<&'static RuntimeEntry> {
    let mut parts: Vec<&'static RuntimeEntry> = vec![requested];
    for id in components_of(requested.id) {
        if let Some(component) = entry(id) {
            if !installed(component.id) {
                parts.push(component);
            }
        }
    }
    parts
}

/// 安装一整包：请求的本体 + 同大版本里还没装的组件（进度折算进同一条进度条）。
async fn install_inner(app: &AppHandle, requested: &'static RuntimeEntry) -> Result<(), String> {
    let parts = bundle_plan(requested, |id| installed(app, id));
    let total: u64 = parts.iter().map(|entry| entry.bytes).sum();
    emit(app, requested.id, "downloading", 0, total, None);

    let mut base = 0u64;
    for part in parts {
        if installer().cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        install_one(app, part, requested.id, base, total).await?;
        base += part.bytes;
        // 装好了就把「待删除」撤掉：否则下次启动会把刚装上的这份当残留删掉。
        clear_pending(app, part.id);
        if affects_chosen(part.id) {
            mark_restart_needed(app);
        }
        emit(
            app,
            requested.id,
            "downloading",
            base.min(total),
            total,
            None,
        );
    }
    emit(app, requested.id, "done", total, total, None);
    Ok(())
}

/// 装一份归档；`report_id` 是进度事件上挂的 id（组件也挂在请求的本体下）。
/// 按「下载源区域偏好」排序后的下载源（同区域内保持清单顺序）。
fn ordered_sources(
    entry: &'static RuntimeEntry,
    preference: crate::network::ModelSourcePreference,
) -> Vec<&'static RuntimeSource> {
    use crate::network::ModelSourcePreference;
    let mut sources: Vec<&'static RuntimeSource> = entry.sources.iter().collect();
    match preference {
        ModelSourcePreference::Domestic => {
            sources.sort_by_key(|source| if source.region == "cn" { 0 } else { 1 });
        }
        ModelSourcePreference::International => {
            sources.sort_by_key(|source| if source.region == "intl" { 0 } else { 1 });
        }
        ModelSourcePreference::Auto => {}
    }
    sources
}

/// `.part` 断点文件的路径（`x.nupkg` → `x.nupkg.part`）。
fn part_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    path.with_file_name(name)
}

/// 下载一个归档到 `<archive>.part`，**支持断点续传**，校验通过后改名成 `archive`。
///
/// CUDA 组件包动辄 1.3 GB：断了从 0 重来对用户是很具体的伤害。取消 / 网络错误都保留
/// `.part`，下次接着下；只有「服务端对不上」（416）与校验失败才丢掉重来。
#[allow(clippy::too_many_arguments)]
async fn fetch_archive(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    archive: &Path,
    entry: &'static RuntimeEntry,
    report_id: &str,
    base: u64,
    total: u64,
) -> Result<(), String> {
    let part = part_path(archive);
    let mut existing = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
    let mut attempt = 0u8;

    loop {
        attempt += 1;
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }
        let mut response = request
            .send()
            .await
            .map_err(|error| format!("下载 {} 失败：{error}", entry.id))?;
        let status = response.status();

        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = fs::remove_file(&part);
            existing = 0;
            if attempt >= 2 {
                return Err(format!("{} 的断点文件无效", entry.id));
            }
            continue;
        }
        if !status.is_success() {
            return Err(format!("下载 {} 失败：HTTP {status}", entry.id));
        }

        // 服务器不认 Range（回 200）：只能从头写。
        let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT && existing > 0;
        if !resumed {
            existing = 0;
        }
        let mut file = if resumed {
            fs::OpenOptions::new().append(true).open(&part)
        } else {
            fs::File::create(&part)
        }
        .map_err(|error| format!("创建临时文件失败：{error}"))?;

        let mut received = existing;
        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                // 网络中途断了：保留 `.part`，下一次从断点续。
                Err(error) => return Err(format!("读取下载数据失败：{error}")),
            };
            if installer().cancel.load(Ordering::Relaxed) {
                drop(file);
                return Err("已取消".into());
            }
            file.write_all(&chunk)
                .map_err(|error| format!("写入运行时失败：{error}"))?;
            received += chunk.len() as u64;
            emit(
                app,
                report_id,
                "downloading",
                (base + received).min(total),
                total,
                None,
            );
        }
        drop(file);

        if received == 0 {
            let _ = fs::remove_file(&part);
            return Err(format!("下载到的 {} 为空", entry.id));
        }
        if !entry.sha256.is_empty() {
            let digest = sha256_file(&part)?;
            if !digest.eq_ignore_ascii_case(entry.sha256) {
                let _ = fs::remove_file(&part);
                return Err(format!("{} 校验失败（sha256 不匹配）：{digest}", entry.id));
            }
        }
        fs::rename(&part, archive).map_err(|error| format!("落盘失败：{error}"))?;
        return Ok(());
    }
}

async fn install_one(
    app: &AppHandle,
    entry: &'static RuntimeEntry,
    report_id: &str,
    base: u64,
    total: u64,
) -> Result<(), String> {
    let dir = runtime_dir(app, entry)?;
    // 归档放在运行时根目录的 `.download/`，不能放进 `dir`：组件安装前会清空 `dir`，
    // 放里面会连归档一起删掉（然后解压时找不到文件）。
    let downloads = app_dir(app)?.join(".download");
    fs::create_dir_all(&downloads).map_err(|error| format!("创建运行时目录失败：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建运行时目录失败：{error}"))?;

    let network = app.state::<Arc<NetworkRuntime>>();
    let client = network
        .client()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    let preference = network.get().model_source_preference;
    let archive = downloads.join(entry.archive);
    emit(app, report_id, "downloading", base.min(total), total, None);

    // 按源偏好排序试一遍：第一个不通（境内连 nuget.org 偶尔会卡住）就换下一个，
    // 断点文件会保留，下一轮从断的地方接着下。
    let mut last_error = String::new();
    let mut fetched = false;
    for source in ordered_sources(entry, preference) {
        if installer().cancel.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        match fetch_archive(app, &client, source.url, &archive, entry, report_id, base, total).await
        {
            Ok(()) => {
                fetched = true;
                break;
            }
            Err(error) => {
                if error == "已取消" {
                    return Err(error);
                }
                eprintln!("[runtime] {} 源失败：{error}（换下一个）", source.url);
                last_error = error;
            }
        }
    }
    if !fetched {
        return Err(if last_error.is_empty() {
            "运行时没有可用的下载源".into()
        } else {
            last_error
        });
    }

    // 组件目录是它独占的：重装前先清空，免得上一版的子库残留。
    // （cuDNN 是按裸文件名加载目录里所有 `cudnn*.so` / `cudnn*.dll` 的，残留就等于混进两套版本。）
    if (entry.extract_dlls || entry.kind == "tarxz") && dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| format!("清理旧组件失败：{error}"))?;
    }
    fs::create_dir_all(&dir).map_err(|error| format!("创建运行时目录失败：{error}"))?;
    extract(entry, &archive, &dir)?;
    let _ = fs::remove_file(&archive);

    if entry.extract_dlls {
        for name in entry.required {
            if !dir.join(name).is_file() {
                return Err(format!("{} 缺少文件：{name}", entry.id));
            }
        }
    } else {
        for file in entry.files {
            if !dir.join(file.to).is_file() {
                return Err(format!("{} 缺少文件：{}", entry.id, file.to));
            }
        }
    }

    // 老的布局把所有组件平铺在 `cuda/cuda/` 里；现在每个组件一个目录，
    // 顺手把那份遗留目录收掉（否则升级用户会白占几百 MB）。
    // 只对 CUDA 12 有意义（`cuda13/cuda` 本来就不存在）。
    if entry.group.starts_with("cuda12") {
        if let Some(parent) = dir.parent() {
            let legacy = parent.join("cuda");
            if legacy.is_dir() && legacy != dir {
                let _ = fs::remove_dir_all(&legacy);
            }
        }
    }

    let marker = serde_json::json!({
        "id": entry.id,
        "revision": entry.revision,
        "bytes": entry.bytes,
        "installedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or(0),
    });
    let _ = fs::write(
        dir.join("marker.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    );

    eprintln!(
        "[runtime] 已安装 {}（{:.1} MB）",
        entry.id,
        entry.bytes as f64 / 1048576.0
    );
    Ok(())
}

fn extract(entry: &RuntimeEntry, archive: &Path, dir: &Path) -> Result<(), String> {
    match entry.kind {
        "zip" if entry.extract_dlls => extract_zip_dlls(archive, dir),
        "zip" => extract_zip(entry, archive, dir),
        "tgz" => {
            let file = fs::File::open(archive).map_err(|error| format!("打开归档失败：{error}"))?;
            extract_tar_files(entry, flate2::read::GzDecoder::new(file), dir)
        }
        // NVIDIA 的 Linux CUDA 组件只发 `.tar.xz`（流式解码，不会把 1 GB 读进内存）。
        "tarxz" => {
            let file = fs::File::open(archive).map_err(|error| format!("打开归档失败：{error}"))?;
            extract_tar_files(entry, xz2::read::XzDecoder::new(file), dir)
        }
        other => Err(format!("不支持的归档类型：{other}")),
    }
}

/// 把归档里所有 `.dll` 平铺到目录（CUDA / cuDNN 的官方包都是 `bin/x64/*.dll`）。
fn extract_zip_dlls(archive: &Path, dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| format!("打开归档失败：{error}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| format!("解析 zip 失败：{error}"))?;
    let mut written = 0usize;
    for index in 0..zip.len() {
        let mut item = zip
            .by_index(index)
            .map_err(|error| format!("读取 zip 条目失败：{error}"))?;
        if item.is_dir() {
            continue;
        }
        let name = item.name().replace('\\', "/");
        let Some(file_name) = name.rsplit('/').next() else {
            continue;
        };
        if !file_name.to_ascii_lowercase().ends_with(".dll") {
            continue;
        }
        // 流式写盘：cuDNN 单个子库有 500 MB 上下，整块读进内存会在内存紧张的机器上把人搞崩。
        let mut out = fs::File::create(dir.join(file_name))
            .map_err(|error| format!("创建 {file_name} 失败：{error}"))?;
        std::io::copy(&mut item, &mut out)
            .map_err(|error| format!("写入 {file_name} 失败：{error}"))?;
        written += 1;
    }
    if written == 0 {
        return Err("归档里没有 DLL 文件".into());
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("打开下载文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("读取下载文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip(entry: &RuntimeEntry, archive: &Path, dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| format!("打开归档失败：{error}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| format!("解析 zip 失败：{error}"))?;
    for wanted in entry.files {
        let mut found = false;
        for index in 0..zip.len() {
            let mut item = zip
                .by_index(index)
                .map_err(|error| format!("读取 zip 条目失败：{error}"))?;
            let name = item.name().replace('\\', "/");
            if !name.ends_with(wanted.from) {
                continue;
            }
            // 同样流式写盘（ORT 的 CUDA provider 一个文件就 299 MB）。
            let mut out = fs::File::create(dir.join(wanted.to))
                .map_err(|error| format!("创建 {} 失败：{error}", wanted.to))?;
            std::io::copy(&mut item, &mut out)
                .map_err(|error| format!("写入 {} 失败：{error}", wanted.to))?;
            found = true;
            break;
        }
        if !found {
            return Err(format!("归档里没有 {}", wanted.from));
        }
    }
    Ok(())
}

/// 从 tar（gz / xz 任意解码器）里只取出清单列出的文件，并**流式**写盘。
///
/// Linux 的 cuDNN 单个 `.so` 有几百 MB，`read_to_end` 后再写会在小内存机器上把人搞崩；
/// 这里边读边写，且只认归档里的**实体文件**（SONAME 符号链接在 tar 里没有内容，
/// 清单里取的是带小版本号的实体）。
fn extract_tar_files<R: Read>(entry: &RuntimeEntry, reader: R, dir: &Path) -> Result<(), String> {
    let mut tar = tar::Archive::new(reader);
    let entries = tar
        .entries()
        .map_err(|error| format!("解析归档失败：{error}"))?;
    for item in entries {
        let mut item = item.map_err(|error| format!("读取归档条目失败：{error}"))?;
        if !item.header().entry_type().is_file() {
            continue;
        }
        let path = item
            .path()
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        // 有的打包工具会写 `./` 前缀；清单里不写。
        let path = path.trim_start_matches("./");
        let Some(file) = entry.files.iter().find(|file| file.from == path) else {
            continue;
        };
        let dest = dir.join(file.to);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut out =
            fs::File::create(&dest).map_err(|error| format!("创建 {} 失败：{error}", file.to))?;
        std::io::copy(&mut item, &mut out)
            .map_err(|error| format!("写入 {} 失败：{error}", file.to))?;
    }
    for file in entry.files {
        if !dir.join(file.to).is_file() {
            return Err(format!("归档里没有 {}", file.from));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn runtime_cancel() {
    installer().cancel.store(true, Ordering::Relaxed);
}

/// 当前是否有运行时正在下载（界面挂载时用来纠正「卡在下载中」的状态）。
#[tauri::command]
pub fn runtime_busy() -> bool {
    busy()
}

/// 删除一个已下载的运行时（只删下载目录）。
///
/// 文件被本进程映射时（Windows 删不掉已加载的 dll）不报错：记进「待删除」，
/// 下次启动在加载任何 dylib 之前清掉。
#[tauri::command]
pub fn runtime_remove(app: AppHandle, id: String) -> Result<(), String> {
    let Some(entry) = entry(&id) else {
        return Err(format!("未知运行时：{id}"));
    };
    if entry.bundled {
        return Err("随包运行时不能删除".into());
    }
    let dir = runtime_dir(&app, entry)?;
    if !dir.exists() {
        clear_pending(&app, entry.id);
        return Ok(());
    }
    // 删掉的是当前在用的那份（或它的组件）：本进程里它还映射着，重启后才真正释放。
    if affects_chosen(entry.id) {
        mark_restart_needed(&app);
    }
    match remove_entry_files(entry, &dir) {
        Ok(()) => {
            clear_pending(&app, entry.id);
            Ok(())
        }
        Err(error) => {
            // Windows 上 dll 一旦被本进程映射（CUDA 后端跑过一次就会这样），目录就删不掉。
            // 不把它当成失败：记进「待删除」，界面立刻按已删除显示，下次启动在加载任何
            // dylib 之前把目录删干净。
            mark_pending(&app, entry.id).map_err(|mark| {
                format!(
                    "删除 {} 失败：{error}（记录待清理也失败：{mark}）",
                    entry.id
                )
            })?;
            eprintln!(
                "[runtime] {} 的文件正在使用，已安排下次启动清理：{}",
                entry.id,
                dir.display()
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub fn runtime_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let Some(entry) = entry(&id) else {
        return Err(format!("未知运行时：{id}"));
    };
    let dir = runtime_dir(&app, entry)?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建目录失败：{error}"))?;
    crate::models::reveal_in_file_manager(&dir)
}

/// 重启应用：切换运行时 / 运行库后由设置页的确认框调用。
///
/// 开发模式（`tauri dev`）下不能用：重新拉起的进程仍指向 `devUrl`，但 dev server 会
/// 随旧进程退出一起被 CLI 关掉，结果就是一个“localhost 拒绝连接”的空白窗口。
#[tauri::command]
pub fn app_restart(app: AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("开发模式下自动重启会丢掉前端 dev server，请手动关闭应用后重新运行。".into());
    }
    app.restart();
}

fn emit(
    app: &AppHandle,
    id: &str,
    state: &str,
    received: u64,
    total: u64,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_RUNTIME,
        RuntimeProgress {
            id: id.to_string(),
            state: state.to_string(),
            received,
            total,
            message,
        },
    );
}

/// 给启动时加载运行时用：已装（且版本对得上）时返回它的目录。
pub fn installed_runtime_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let entry = entry(id)?;
    if !installed(app, id) {
        return None;
    }
    runtime_dir(app, entry).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一张清单（Windows / Linux）的结构检查：id 唯一、体积 / 源 / 清单齐全，
    /// 两个 CUDA 本体与各自四个组件都在，且分属正确的组和目录。
    fn validate_catalog(entries: &'static [RuntimeEntry]) {
        let mut ids = std::collections::HashSet::new();
        for entry in entries {
            assert!(ids.insert(entry.id), "重复的运行时 id：{}", entry.id);
            if entry.bundled {
                continue;
            }
            assert!(entry.bytes > 0, "{} 没有体积", entry.id);
            assert!(!entry.sources.is_empty(), "{} 没有下载源", entry.id);
            for source in entry.sources {
                assert!(
                    source.url.starts_with("https://"),
                    "{} 源不是 https",
                    entry.id
                );
            }
            assert!(
                entry.extract_dlls || !entry.files.is_empty(),
                "{} 没有文件清单",
                entry.id
            );
            // 没有 revision 的老目录会被一直当成「已安装」，版本一混就再也自愈不了。
            assert!(!entry.revision.is_empty(), "{} 没有 revision", entry.id);
            if entry.extract_dlls {
                assert!(!entry.required.is_empty(), "{} 没有校验文件", entry.id);
                assert!(!entry.install_dir.is_empty(), "{} 没有安装目录", entry.id);
            }
            for file in entry.files {
                assert!(
                    !file.to.contains('/'),
                    "{} 的目标必须是单层文件名",
                    entry.id
                );
            }
        }
        // 两个 CUDA 本体与各自四个组件都必须在清单里，否则界面会漏掉一套。
        for core in ["cuda", "cuda13"] {
            assert!(ids.contains(core), "缺少 CUDA 本体：{core}");
            for id in components_of(core) {
                assert!(ids.contains(*id), "{core} 缺少组件：{id}");
            }
        }
        let core12 = entries.iter().find(|entry| entry.id == "cuda").unwrap();
        let core13 = entries.iter().find(|entry| entry.id == "cuda13").unwrap();
        assert_eq!(core12.group, "ort");
        assert_eq!(core13.group, "ort");
        assert_eq!(core12.install_dir, "cuda");
        assert_eq!(core13.install_dir, "cuda13");
        for id in CUDA12_COMPONENTS {
            let entry = entries.iter().find(|entry| entry.id == id).unwrap();
            assert_eq!(entry.group, "cuda12");
            assert_eq!(entry.install_dir, format!("cuda/{id}"));
            assert_eq!(cuda_flavor_of(id), Some(12));
        }
        for id in CUDA13_COMPONENTS {
            let entry = entries.iter().find(|entry| entry.id == id).unwrap();
            assert_eq!(entry.group, "cuda13");
            assert_eq!(
                entry.install_dir,
                format!("cuda13/{}", id.trim_end_matches("13"))
            );
            assert_eq!(cuda_flavor_of(id), Some(13));
        }
        // 组件不能和本体挤在同一个目录里，否则「删组件」会连本体一起删掉。
        for entry in entries
            .iter()
            .filter(|entry| entry.group.starts_with("cuda"))
        {
            assert_ne!(entry.install_dir, core12.install_dir);
            assert_ne!(entry.install_dir, core13.install_dir);
        }
    }

    #[test]
    fn windows_catalog_is_well_formed() {
        validate_catalog(WINDOWS_ENTRIES);
    }

    #[test]
    fn linux_catalog_is_well_formed() {
        validate_catalog(LINUX_ENTRIES);
    }

    /// CUDA 12 / 13 的组件版本必须各自对齐自己的 ORT provider（两张表都查）。
    fn assert_flavors_aligned(entries: &'static [RuntimeEntry]) {
        for entry in entries.iter().filter(|entry| entry.group == "cuda12") {
            let names: Vec<&str> = if entry.files.is_empty() {
                entry.required.to_vec()
            } else {
                entry.files.iter().map(|file| file.to).collect()
            };
            for name in names {
                assert!(
                    !name.contains("64_13") && !name.contains(".so.13") && !name.contains("_8."),
                    "{} 里混进了非 CUDA 12 / 非 cuDNN 9 的库：{name}",
                    entry.id
                );
            }
        }
        for entry in entries.iter().filter(|entry| entry.group == "cuda13") {
            let names: Vec<&str> = if entry.files.is_empty() {
                entry.required.to_vec()
            } else {
                entry.files.iter().map(|file| file.to).collect()
            };
            for name in names {
                // CUDA 13 的 cuFFT 就叫 `cufft64_12.dll` / `libcufft.so.12`（cuFFT 自己的
                // 大版本），不能按「带 12 就是 CUDA 12」一刀切。
                let cuda12_name = matches!(
                    name,
                    "cudart64_12.dll"
                        | "cublas64_12.dll"
                        | "cublasLt64_12.dll"
                        | "cufft64_11.dll"
                        | "libcudart.so.12"
                        | "libcublas.so.12"
                        | "libcublasLt.so.12"
                        | "libcufft.so.11"
                );
                assert!(
                    !cuda12_name && !name.contains("_8."),
                    "{} 里混进了 CUDA 12 的库：{name}",
                    entry.id
                );
            }
        }
        let core12 = entries.iter().find(|entry| entry.id == "cuda").unwrap();
        assert!(
            core12.archive.contains("1.26.0"),
            "CUDA 12 必须钉 ORT 1.26，现在是 {}",
            core12.archive
        );
        let core13 = entries.iter().find(|entry| entry.id == "cuda13").unwrap();
        assert!(
            core13.archive.contains("1.31.1"),
            "CUDA 13 必须钉 ORT 1.31.1，现在是 {}",
            core13.archive
        );
    }

    #[test]
    fn windows_component_versions_match_the_pinned_ort() {
        assert_flavors_aligned(WINDOWS_ENTRIES);
    }

    #[test]
    fn linux_component_versions_match_the_pinned_ort() {
        assert_flavors_aligned(LINUX_ENTRIES);
    }

    /// 老版本（1.30 本体 / 旧目录布局）装过的东西必须被判定为「未安装」，
    /// 否则升级后仍是「新本体 + 老组件」，CUDA 照样静默回落 CPU。
    #[test]
    fn a_stale_install_is_not_treated_as_installed() {
        let dir = std::env::temp_dir().join(format!("ai-cut-runtime-stale-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let entry = RuntimeEntry {
            id: "cudart",
            group: "cuda12",
            core: false,
            install_dir: "cuda/cudart",
            required: &["cudart64_12.dll"],
            revision: "cuda12.8.90",
            bytes: 1,
            sha256: "",
            license: "CUDA Toolkit",
            bundled: false,
            archive: "a.zip",
            kind: "zip",
            extract_dlls: true,
            sources: &[],
            files: &[],
        };

        // 文件齐但没 marker（老版本装的）→ 不算已安装。
        fs::write(dir.join("cudart64_12.dll"), b"x").unwrap();
        assert!(!dir_holds(&entry, &dir));

        // marker 版本对不上（以前钉的是别的版本）→ 也不算。
        fs::write(
            dir.join("marker.json"),
            br#"{"id":"cudart","revision":"cuda12.6"}"#,
        )
        .unwrap();
        assert!(!dir_holds(&entry, &dir));

        // marker 版本对得上才算（带 BOM 的手改文件也要认）。
        fs::write(
            dir.join("marker.json"),
            b"\xEF\xBB\xBF{\"id\":\"cudart\",\"revision\":\"cuda12.8.90\"}",
        )
        .unwrap();
        assert!(dir_holds(&entry, &dir));

        // 版本对但文件被删了一个 → 仍需重新下载。
        fs::remove_file(dir.join("cudart64_12.dll")).unwrap();
        assert!(!dir_holds(&entry, &dir));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_extraction_picks_nested_paths() {
        let dir = std::env::temp_dir().join(format!("ai-cut-runtime-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("runtime.nupkg");
        {
            let file = fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for (name, data) in [
                ("runtimes/win-x64/native/onnxruntime.dll", b"ort".as_slice()),
                (
                    "runtimes/win-x64/native/onnxruntime_providers_cuda.dll",
                    b"cuda".as_slice(),
                ),
                ("runtimes/win-x64/native/other.dll", b"other".as_slice()),
            ] {
                zip.start_file(name, options).unwrap();
                zip.write_all(data).unwrap();
            }
            zip.finish().unwrap();
        }

        let entry = RuntimeEntry {
            id: "test",
            group: "ort",
            core: true,
            install_dir: "cuda",
            required: &[],
            revision: "test",
            bytes: 1,
            sha256: "",
            license: "MIT",
            bundled: false,
            archive: "runtime.nupkg",
            kind: "zip",
            extract_dlls: false,
            sources: &[],
            files: &[
                RuntimeFile {
                    from: "runtimes/win-x64/native/onnxruntime.dll",
                    to: "onnxruntime.dll",
                },
                RuntimeFile {
                    from: "runtimes/win-x64/native/onnxruntime_providers_cuda.dll",
                    to: "onnxruntime_providers_cuda.dll",
                },
            ],
        };
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        extract_zip(&entry, &archive, &out).unwrap();
        assert_eq!(fs::read(out.join("onnxruntime.dll")).unwrap(), b"ort");
        assert_eq!(
            fs::read(out.join("onnxruntime_providers_cuda.dll")).unwrap(),
            b"cuda"
        );
        assert!(!out.join("other.dll").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_dll_flattening_keeps_only_dlls() {
        let dir = std::env::temp_dir().join(format!("ai-cut-runtime-flat-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("cuda.zip");
        {
            let file = fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for (name, data) in [
                (
                    "cuda_cudart-archive/bin/cudart64_12.dll",
                    b"cudart".as_slice(),
                ),
                ("cuda_cudart-archive/bin/notes.txt", b"ignore".as_slice()),
                (
                    "libcublas-archive/bin/cublas64_12.dll",
                    b"cublas".as_slice(),
                ),
            ] {
                zip.start_file(name, options).unwrap();
                zip.write_all(data).unwrap();
            }
            zip.finish().unwrap();
        }
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        extract_zip_dlls(&archive, &out).unwrap();
        assert_eq!(fs::read(out.join("cudart64_12.dll")).unwrap(), b"cudart");
        assert_eq!(fs::read(out.join("cublas64_12.dll")).unwrap(), b"cublas");
        assert!(!out.join("notes.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Linux 的组件是 `.tar.xz`，归档里带小版本号的是实体、SONAME 是符号链接（没内容）。
    #[test]
    fn tarxz_extraction_maps_versioned_libs_to_the_soname() {
        let dir = std::env::temp_dir().join(format!("ai-cut-runtime-tarxz-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("cudart.tar.xz");
        {
            let file = fs::File::create(&archive).unwrap();
            let encoder = xz2::write::XzEncoder::new(file, 3);
            let mut tar = tar::Builder::new(encoder);
            for (path, data) in [
                (
                    "cuda_cudart-linux-x86_64-13.0.96-archive/lib/libcudart.so.13.0.96",
                    b"\x7fELF-cudart".as_slice(),
                ),
                (
                    "cuda_cudart-linux-x86_64-13.0.96-archive/lib/README.txt",
                    b"ignore".as_slice(),
                ),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append_data(&mut header, path, data).unwrap();
            }
            tar.into_inner().unwrap().finish().unwrap();
        }

        let entry = RuntimeEntry {
            id: "cudart13",
            group: "cuda13",
            core: false,
            install_dir: "cuda13/cudart",
            required: &[],
            revision: "test",
            bytes: 1,
            sha256: "",
            license: "CUDA Toolkit",
            bundled: false,
            archive: "cudart.tar.xz",
            kind: "tarxz",
            extract_dlls: false,
            sources: &[],
            files: &[RuntimeFile {
                from: "cuda_cudart-linux-x86_64-13.0.96-archive/lib/libcudart.so.13.0.96",
                to: "libcudart.so.13",
            }],
        };
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        extract(&entry, &archive, &out).unwrap();
        assert_eq!(
            fs::read(out.join("libcudart.so.13")).unwrap(),
            b"\x7fELF-cudart"
        );
        assert!(!out.join("libcudart.so.13.0.96").exists());
        assert!(!out.join("README.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 下载 CUDA 13 本体时只补 CUDA 13 缺的组件，不会把 CUDA 12 的组件拖进来。
    #[cfg(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64")
    ))]
    #[test]
    fn downloading_a_cuda_core_only_pulls_its_own_missing_components() {
        let core = entry("cuda13").unwrap();
        // 已经装了 cudart13 与（另一套的）cudnn。
        let plan = bundle_plan(core, |id| id == "cudart13" || id == "cudnn");
        let ids: Vec<&str> = plan.iter().map(|entry| entry.id).collect();
        assert_eq!(ids[0], "cuda13", "本体必须第一个下载");
        assert!(!ids.contains(&"cudart13"), "已装的组件不该重下");
        assert!(ids.contains(&"cublas13"));
        assert!(ids.contains(&"cufft13"));
        assert!(ids.contains(&"cudnn13"));
        assert!(!ids.contains(&"cublas"), "CUDA 12 的组件不能混进来");
        assert!(!ids.contains(&"cudart"));

        // 组件单独下载时不带任何别的组件。
        let part = entry("cufft13").unwrap();
        let plan = bundle_plan(part, |_| false);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].id, "cufft13");
    }

    /// 删本体只删它自己的文件，不能顺手带走 `<本体>/cudart` 这些组件目录。
    #[test]
    fn removing_a_core_keeps_its_component_directories() {
        let dir =
            std::env::temp_dir().join(format!("ai-cut-runtime-remove-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let cudart = dir.join("cudart");
        fs::create_dir_all(&cudart).unwrap();

        let core = RuntimeEntry {
            id: "cuda13",
            group: "ort",
            core: true,
            install_dir: "cuda13",
            required: &[],
            revision: "test",
            bytes: 1,
            sha256: "",
            license: "MIT",
            bundled: false,
            archive: "a.nupkg",
            kind: "zip",
            extract_dlls: false,
            sources: &[],
            files: &[
                RuntimeFile {
                    from: "runtimes/win-x64/native/onnxruntime.dll",
                    to: "onnxruntime.dll",
                },
                RuntimeFile {
                    from: "runtimes/win-x64/native/onnxruntime_providers_cuda.dll",
                    to: "onnxruntime_providers_cuda.dll",
                },
            ],
        };
        fs::write(dir.join("onnxruntime.dll"), b"core").unwrap();
        fs::write(dir.join("onnxruntime_providers_cuda.dll"), b"ep").unwrap();
        fs::write(dir.join("marker.json"), b"{}").unwrap();
        fs::write(cudart.join("cudart64_13.dll"), b"part").unwrap();

        remove_entry_files(&core, &dir).expect("删本体");
        assert!(!dir.join("onnxruntime.dll").exists());
        assert!(!dir.join("onnxruntime_providers_cuda.dll").exists());
        assert!(!dir.join("marker.json").exists());
        // 组件目录还在：两套运行时可以各删各的。
        assert!(cudart.join("cudart64_13.dll").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    /// PE 头里的 Machine 字段（`0x8664` = x64）。
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    fn pe_machine(path: &std::path::Path) -> Option<u16> {
        use std::io::{Seek, SeekFrom};

        let mut file = fs::File::open(path).ok()?;
        let mut dos = [0u8; 0x40];
        file.read_exact(&mut dos).ok()?;
        let offset = u32::from_le_bytes([dos[0x3c], dos[0x3d], dos[0x3e], dos[0x3f]]) as u64;
        file.seek(SeekFrom::Start(offset + 4)).ok()?;
        let mut machine = [0u8; 2];
        file.read_exact(&mut machine).ok()?;
        Some(u16::from_le_bytes(machine))
    }

    /// 手动验证：**用真实归档走一遍「下载完成之后」的安装步骤**。
    ///
    /// 断言三件事：sha256 与清单一致、必需文件解出来了、平铺进来的 DLL 全是 x64
    /// （防止把别的架构的同名 dll 覆盖进来——那会让用户那边一加载就 0xc000007b）。
    ///
    /// ```text
    /// $env:AICUT_TEST_ARCHIVES="D:\tmp\aicu-archives"   # 放 ORT 的 .nupkg 与 8 个组件 zip
    /// cargo test --lib installs_the_real_cuda_archives -- --ignored --nocapture
    /// ```
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    #[test]
    #[ignore = "手动：需要 AICUT_TEST_ARCHIVES（放着组件 zip 的目录）"]
    fn installs_the_real_cuda_archives() {
        let Some(raw) = std::env::var_os("AICUT_TEST_ARCHIVES") else {
            panic!("需要 AICUT_TEST_ARCHIVES");
        };
        let root = PathBuf::from(raw);
        let mut checked = 0usize;
        // 两个本体与 8 个组件都走一遍，和 `install_one` 的步骤一致。
        for entry in WINDOWS_ENTRIES.iter().filter(|entry| !entry.bundled) {
            let archive = root.join(entry.archive);
            if !archive.is_file() {
                eprintln!("跳过 {}：{} 不存在", entry.id, archive.display());
                continue;
            }
            if !entry.sha256.is_empty() {
                let digest = sha256_file(&archive).expect("算 sha256");
                assert!(
                    digest.eq_ignore_ascii_case(entry.sha256),
                    "{} 的 sha256 与清单不一致：{digest}",
                    entry.id
                );
            }
            let out = root.join(format!("out-{}", entry.id));
            let _ = fs::remove_dir_all(&out);
            fs::create_dir_all(&out).unwrap();
            extract(entry, &archive, &out).expect("解包");
            let expected: Vec<String> = if entry.files.is_empty() {
                entry.required.iter().map(|name| name.to_string()).collect()
            } else {
                entry.files.iter().map(|file| file.to.to_string()).collect()
            };
            for name in &expected {
                assert!(out.join(name).is_file(), "{} 解包后缺少 {name}", entry.id);
            }
            let mut dlls = 0usize;
            for file in fs::read_dir(&out).unwrap().flatten() {
                let path = file.path();
                if path.extension().is_none_or(|ext| ext != "dll") {
                    continue;
                }
                dlls += 1;
                assert_eq!(
                    pe_machine(&path),
                    Some(0x8664),
                    "{} 解出来的不是 x64：{}",
                    entry.id,
                    path.display()
                );
            }
            assert!(dlls > 0, "{} 一个 DLL 都没解出来", entry.id);
            eprintln!("{}: {dlls} 个 DLL 全部 x64，必需文件齐全", entry.id);
            let _ = fs::remove_dir_all(&out);
            checked += 1;
        }
        assert!(checked > 0, "一个组件归档都没测到");
    }

    /// 手动验证 Linux 那套：`tar.xz` 的 sha256、解包、SONAME 落地与 ELF 架构。
    ///
    /// 这个用例**任何平台都能跑**（`.tar.xz` 只是数据），所以可以在开发机上验证
    /// Linux 清单而没有 Linux 机器：
    ///
    /// ```text
    /// $env:AICUT_TEST_ARCHIVES="D:\tmp\linux-cuda"   # 放 Linux 的 .nupkg / .tar.xz
    /// cargo test --lib installs_the_real_linux_cuda_archives -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "手动：需要 AICUT_TEST_ARCHIVES（放着 Linux .nupkg / .tar.xz 的目录）"]
    fn installs_the_real_linux_cuda_archives() {
        let Some(raw) = std::env::var_os("AICUT_TEST_ARCHIVES") else {
            panic!("需要 AICUT_TEST_ARCHIVES");
        };
        let root = PathBuf::from(raw);
        let mut checked = 0usize;
        for entry in LINUX_ENTRIES.iter().filter(|entry| !entry.bundled) {
            let archive = root.join(entry.archive);
            if !archive.is_file() {
                eprintln!("跳过 {}：{} 不存在", entry.id, archive.display());
                continue;
            }
            if !entry.sha256.is_empty() {
                let digest = sha256_file(&archive).expect("算 sha256");
                assert!(
                    digest.eq_ignore_ascii_case(entry.sha256),
                    "{} 的 sha256 与清单不一致：{digest}",
                    entry.id
                );
            }
            let out = root.join(format!("out-{}", entry.id));
            let _ = fs::remove_dir_all(&out);
            fs::create_dir_all(&out).unwrap();
            extract(entry, &archive, &out).expect("解包");
            let expected: Vec<String> = if entry.files.is_empty() {
                entry.required.iter().map(|name| name.to_string()).collect()
            } else {
                entry.files.iter().map(|file| file.to.to_string()).collect()
            };
            for name in &expected {
                let path = out.join(name);
                assert!(path.is_file(), "{} 解包后缺少 {name}", entry.id);
                let mut head = [0u8; 4];
                fs::File::open(&path)
                    .and_then(|mut file| file.read_exact(&mut head))
                    .unwrap_or_else(|error| panic!("读 {name} 失败：{error}"));
                assert_eq!(&head, b"\x7fELF", "{} 解出来的不是 ELF：{name}", entry.id);
            }
            eprintln!("{}: {} 个 ELF，必需文件齐全", entry.id, expected.len());
            let _ = fs::remove_dir_all(&out);
            checked += 1;
        }
        assert!(checked > 0, "一个 Linux 归档都没测到");
    }
}
