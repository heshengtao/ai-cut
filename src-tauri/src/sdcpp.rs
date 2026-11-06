//! **stable-diffusion.cpp 引擎的下载 / 安装 / 选择**——下载管理器里「视频引擎」那一组。
//!
//! MiniMax-H3 不走 ONNX Runtime：它是 ggml 图 + 自定义算子，由 `sd-cli.exe` 独立进程
//! 执行。所以这里的「运行时」是**另一套东西**，管理方式与 ONNX Runtime 完全分开：
//!
//! ```text
//! <应用配置目录>/runtime/sdcpp/
//!   cpu/       sd-cli.exe + ggml*.dll        （macOS 上没有这个目录：CPU 复用 metal/）
//!   vulkan/    同上（Vulkan 后端）
//!   cuda12/    同上 + CUDA 12 运行库
//!   rocm/      同上 + HIP / ROCm 运行库（Windows 包自带；Linux 要系统装 ROCm）
//!   metal/     macOS 的 Metal 构建（也用来跑「强制 CPU」，靠 --backend cpu）
//!   preferred  用户挑的那一份（不写则按显卡自动挑）
//! ```
//!
//! 每个后端是 stable-diffusion.cpp 官方 release 的一份自包含 zip。官方只发布 Windows /
//! Linux / macOS 的**整包**，没有单文件下载，所以这里整包下载、整包解压、按发布页给的
//! sha256 校验；装完只认目录里的 `sd-cli.exe`（zip 内的目录层级由官方决定，不写死）。
//!
//! **不随包**：安装包一个字节都不涨，全部按需下载——视频生成是可选能力。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::network::{ModelSourcePreference, NetworkRuntime};

pub const EVENT_SDCPP: &str = "sdcpp-progress";

/// 清单版本：换 official release 时同步换掉，老安装会被判定为未安装并重新下载。
const REVISION: &str = "sd-master-1031-c6dfa9d";

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

    fn from_device(device: &str) -> Option<Self> {
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

#[derive(Debug, Clone, Copy)]
struct Source {
    region: &'static str,
    url: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Part {
    /// 下载归档的字节数（官方 release asset 的精确大小）。
    bytes: u64,
    sha256: &'static str,
    archive: &'static str,
    sources: &'static [Source],
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Pack {
    id: &'static str,
    device: &'static str,
    parts: &'static [Part],
}

impl Pack {
    fn bytes(&self) -> u64 {
        self.parts.iter().map(|part| part.bytes).sum()
    }
}

macro_rules! gh_source {
    ($asset:literal) => {
        Source {
            region: "intl",
            url: concat!(
                "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-1031-c6dfa9d/",
                $asset
            ),
        }
    };
}

/// 魔搭社区上的官方 Release 镜像（由项目维护者 `ailm32442` 原样转存，
/// sha256 与 GitHub Release 完全一致）。只使用公开模型社区的官方镜像，
/// 不接入任何第三方下载代理。
macro_rules! ms_source {
    ($path:literal) => {
        Source {
            region: "cn",
            url: concat!(
                "https://modelscope.cn/models/ailm32442/sd-cpp-binaries/resolve/master/",
                $path
            ),
        }
    };
}

const WINDOWS_PACKS: &[Pack] = &[
    Pack {
        id: "sdcpp-cpu",
        device: "cpu",
        parts: &[Part {
            bytes: 18_094_519,
            sha256: "82f2fa57e325895d2d1d649a9ed48e35cda7a415a255f9fc3c9d682381960f08",
            archive: "sd-master-c6dfa9d-bin-win-cpu-x64.zip",
            sources: &[
                gh_source!("sd-master-c6dfa9d-bin-win-cpu-x64.zip"),
                ms_source!("windows/sd-master-c6dfa9d-bin-win-cpu-x64.zip"),
            ],
        }],
    },
    Pack {
        id: "sdcpp-vulkan",
        device: "vulkan",
        parts: &[Part {
            bytes: 29_827_028,
            sha256: "31a26c404fab36ba8fe527116c4f039e70fe3f440cd6b75b28ff06305532208c",
            archive: "sd-master-c6dfa9d-bin-win-vulkan-x64.zip",
            sources: &[
                gh_source!("sd-master-c6dfa9d-bin-win-vulkan-x64.zip"),
                ms_source!("windows/sd-master-c6dfa9d-bin-win-vulkan-x64.zip"),
            ],
        }],
    },
    Pack {
        id: "sdcpp-cuda12",
        device: "cuda12",
        // 官方把 CUDA 版拆成两个包：引擎本体（sd-cli + ggml-cuda.dll）与 CUDA
        // 运行库（cudart / cuBLAS）。两个都装才跑得起来，缺一个就会在加载
        // ggml-cuda.dll 时报“找不到 cudart64_12.dll”。
        parts: &[
            Part {
                bytes: 354_188_849,
                sha256: "b1754e73934f4e1c1cc61d6228ebff44624c8a528a9ab850ad07d5179a3dbbac",
                archive: "sd-master-c6dfa9d-bin-win-cuda12-x64.zip",
                sources: &[
                    gh_source!("sd-master-c6dfa9d-bin-win-cuda12-x64.zip"),
                    ms_source!("windows/sd-master-c6dfa9d-bin-win-cuda12-x64.zip"),
                ],
            },
            Part {
                bytes: 563_452_046,
                sha256: "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d",
                archive: "cudart-sd-bin-win-cu12-x64.zip",
                sources: &[
                    gh_source!("cudart-sd-bin-win-cu12-x64.zip"),
                    ms_source!("windows/cudart-sd-bin-win-cu12-x64.zip"),
                ],
            },
        ],
    },
    Pack {
        id: "sdcpp-rocm",
        device: "rocm",
        // AMD 的 HIP 运行库整包自带（amdhip64 / amd_comgr），不需要额外的运行库包。
        parts: &[Part {
            bytes: 265_663_896,
            sha256: "d6046d4c35f2767bdb5c53de19f67a64a465eac305426efa32bcd8a9d798a743",
            archive: "sd-master-c6dfa9d-bin-win-rocm-10.1.0-x64.zip",
            sources: &[gh_source!("sd-master-c6dfa9d-bin-win-rocm-10.1.0-x64.zip")],
        }],
    },
];

const LINUX_PACKS: &[Pack] = &[
    Pack {
        id: "sdcpp-cpu",
        device: "cpu",
        parts: &[Part {
            bytes: 27_338_281,
            sha256: "05020fdf7fd5c710c2b55bf3bd43a3b60439bdd6b57eee7fca5d14c2084b421a",
            archive: "sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64.zip",
            sources: &[
                gh_source!("sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64.zip"),
                ms_source!("linux/sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64.zip"),
            ],
        }],
    },
    Pack {
        id: "sdcpp-vulkan",
        device: "vulkan",
        parts: &[Part {
            bytes: 37_698_801,
            sha256: "8c7a4b9364ac8ff75635cd6ddbc858bea4e0224a746b0ba0dc7d2e32e4929a41",
            archive: "sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
            sources: &[
                gh_source!("sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip"),
                ms_source!("linux/sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip"),
            ],
        }],
    },
    Pack {
        id: "sdcpp-rocm",
        device: "rocm",
        // 和 Windows 那份一样：HIP / ROCm 运行库都在包里，装完只需要系统的 AMD 驱动。
        parts: &[Part {
            bytes: 297_941_221,
            sha256: "c6785c3c961a1ddb02fcddc6edbd42b6aad6b001ddc8c4b915f545da8151b495",
            archive: "sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-rocm-10.1.0.zip",
            sources: &[gh_source!(
                "sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-rocm-10.1.0.zip"
            )],
        }],
    },
];

const MACOS_PACKS: &[Pack] = &[Pack {
    id: "sdcpp-metal",
    device: "metal",
    parts: &[Part {
        bytes: 37_603_978,
        sha256: "33282a6708809185d9c66d073bfb2feed7b302a4eb40c5e1829c13dab1a80f5d",
        archive: "sd-master-c6dfa9d-bin-Darwin-macOS-26.6.2-arm64.zip",
        sources: &[
            gh_source!("sd-master-c6dfa9d-bin-Darwin-macOS-26.6.2-arm64.zip"),
            ms_source!("macos/sd-master-c6dfa9d-bin-Darwin-macOS-26.6.2-arm64.zip"),
        ],
    }],
}];

fn packs() -> &'static [Pack] {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => WINDOWS_PACKS,
        ("linux", "x86_64") => LINUX_PACKS,
        ("macos", "aarch64") => MACOS_PACKS,
        _ => &[],
    }
}

fn pack(id: &str) -> Option<&'static Pack> {
    packs().iter().find(|pack| pack.id == id)
}

/// 某个后端实际用哪份构建。
///
/// macOS 的 `cpu` 不是独立下载，而是**复用 Metal 包**（用 `--backend cpu` 强制 CPU）——
/// 官方从来没发过 macOS 的 CPU-only 构建，但 Metal 包里带着 ggml-cpu。
fn pack_for_device(device: &str) -> Option<&'static Pack> {
    packs()
        .iter()
        .find(|pack| pack.device == build_device_for(device, cfg!(target_os = "macos")))
}

/// `device` 落在哪份构建上。抽成纯函数，macOS 的「CPU 借用 Metal」在 Windows 上也能测。
fn build_device_for(device: &str, macos: bool) -> &str {
    if macos && device == "cpu" {
        "metal"
    } else {
        device
    }
}

/// 平台有没有这个后端的**构建**（macOS 的 CPU 用 Metal 包，算有）。
fn has_device(device: &str) -> bool {
    pack_for_device(device).is_some()
}

/// 传给 `sd-cli --backend` 的参数值。
///
/// 只有「强制 CPU」需要显式指定：macOS 的 Metal 包里默认走 GPU，不传就永远用不到 CPU；
/// 其余后端各自是独立的构建，二进制里只有一种设备，传不传都一样。
pub(crate) fn backend_arg(device: &str) -> Option<&'static str> {
    (device == "cpu").then_some("cpu")
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

pub fn busy() -> bool {
    installer().running.load(Ordering::SeqCst)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdcppProgress {
    pub id: String,
    /// `downloading` / `done` / `error`
    pub state: String,
    pub received: u64,
    pub total: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdcppStatus {
    pub id: String,
    /// i18n key（`sdcpp.<device>`）。
    pub label: String,
    /// i18n key（`sdcpp.<device>.note`）。
    pub note: String,
    pub device: String,
    pub bytes: u64,
    pub installed: bool,
    /// 用户挑的那一份（没挑过时是自动挑中的那一份）。
    pub selected: bool,
    pub automatic: bool,
    /// 本机能不能跑这份构建（AMD 机器上的 CUDA = false）。
    pub usable: bool,
    pub license: String,
    pub dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdcppOption {
    pub kind: String,
    pub label: String,
    pub note: String,
    /// 平台有没有这份构建（Windows 上 CUDA 恒为 true）。
    pub available: bool,
    /// 本机**能不能跑**（CUDA 要求 NVIDIA 显卡；ROCm 要求 AMD 显卡；Metal 要求 Apple Silicon）。
    pub usable: bool,
    /// 是不是本机最优选择（与装没装无关）。
    pub recommended: bool,
    pub installed: bool,
    pub bytes: u64,
    /// 选它要下载哪一份构建（macOS 的 CPU 复用 Metal 包）。界面直接拿它去下载管理器。
    pub download_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdcppInfo {
    pub preference: String,
    pub current: String,
    /// 本机最优的引擎（**不看装没装**）：NVIDIA → `cuda12`；macOS → `metal`；
    /// 其它有显卡的桌面平台 → `vulkan`；都没有 → `cpu`。
    pub recommended: String,
    pub platform: String,
    pub options: Vec<SdcppOption>,
}

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("runtime").join("sdcpp");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn dir_of(app: &AppHandle, pack: &Pack) -> Result<PathBuf, String> {
    Ok(root(app)?.join(pack.device))
}

fn marker_revision(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("marker.json")).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value
        .get("revision")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn find_cli(dir: &Path) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    let mut found: Vec<PathBuf> = WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case("sd-cli.exe") || name == "sd-cli")
                .unwrap_or(false)
        })
        .collect();
    found.sort_by_key(|path| path.components().count());
    found.into_iter().next()
}

fn installed(app: &AppHandle, pack: &Pack) -> bool {
    let Ok(dir) = dir_of(app, pack) else {
        return false;
    };
    find_cli(&dir).is_some() && marker_revision(&dir).as_deref() == Some(REVISION)
}

fn preference(app: &AppHandle) -> SdcppBackend {
    app.state::<Arc<NetworkRuntime>>().get().sdcpp_backend
}

fn nvidia_present() -> bool {
    crate::backend::device_profile().vendor == "nvidia"
}

fn amd_present() -> bool {
    crate::backend::device_profile().vendor == "amd"
}

/// 本机**能不能跑**这套构建（与「装没装」无关）。
///
/// 与 [`SdcppBackend::platform_ok`] 的区别：后者只说「这个平台有这份构建」，
/// Windows 上任何机器都成立；这里还要看显卡——AMD 机器上装一份 917 MB 的 CUDA
/// 引擎，只会在启动 `sd-cli` 时报「找不到 nvcuda.dll」。
pub fn usable_device(device: &str) -> bool {
    match device {
        "cpu" => true,
        // Vulkan 走各家驱动，N 卡 / A 卡 / 核显都能用。
        "vulkan" => cfg!(any(target_os = "windows", target_os = "linux")),
        // sd.cpp 官方只发 CUDA 12 构建；判定依据是「有没有 N 卡」。
        "cuda12" | "cuda13" => nvidia_present(),
        // ROCm 只对 A 卡有意义（N 卡装上也只会报找不到 HIP 设备）。
        "rocm" => {
            cfg!(all(
                any(target_os = "windows", target_os = "linux"),
                target_arch = "x86_64"
            )) && amd_present()
        }
        "metal" => cfg!(all(target_os = "macos", target_arch = "aarch64")),
        _ => false,
    }
}

/// 本机最优的引擎（**不看装没装**，用来推荐下载）。
///
/// 平台里没有这份构建时继续往下退：Linux 没有 CUDA 构建，N 卡也只会推荐 Vulkan；
/// AMD 优先 ROCm（比 Vulkan 快），没装/不支持时再退 Vulkan。
pub fn best_device() -> &'static str {
    if cfg!(target_os = "macos") {
        return if has_device("metal") { "metal" } else { "cpu" };
    }
    if nvidia_present() && has_device("cuda12") {
        return "cuda12";
    }
    if amd_present() && usable_device("rocm") && has_device("rocm") {
        return "rocm";
    }
    if usable_device("vulkan") && has_device("vulkan") {
        return "vulkan";
    }
    "cpu"
}

pub fn auto_device(app: &AppHandle) -> &'static str {
    let has = |device: &str| {
        pack_for_device(device)
            .map(|pack| installed(app, pack))
            .unwrap_or(false)
    };
    // 最优的那份装了就用它；否则退到任意一份装好的（用户可能只下了 CPU 兜底）。
    let best = best_device();
    if has(best) {
        return best;
    }
    for device in ["metal", "cuda12", "rocm", "vulkan", "cpu"] {
        if usable_device(device) && has(device) {
            return device;
        }
    }
    "cpu"
}

pub fn effective_device(app: &AppHandle) -> &'static str {
    let chosen = preference(app);
    if chosen == SdcppBackend::Auto {
        return auto_device(app);
    }
    let device = chosen.as_str();
    // 三重条件缺一不可：平台有这份构建、本机真能跑（A 卡别选 CUDA）、确实装好了。
    // 任何一条不满足都退回自动——而不是「选了 CPU / ROCm 却悄悄跑在别的后端上」。
    if chosen.platform_ok()
        && usable_device(device)
        && pack_for_device(device)
            .map(|pack| installed(app, pack))
            .unwrap_or(false)
    {
        device
    } else {
        auto_device(app)
    }
}

/// 实际会用的引擎（给视频生成拿 `sd-cli` 路径用）。
pub(crate) fn effective_pack(app: &AppHandle) -> Option<&'static Pack> {
    pack_for_device(effective_device(app))
}

/// 引擎可执行文件；没装 / 文件丢了返回 `None`。
pub(crate) fn cli_path(app: &AppHandle, pack: &Pack) -> Option<PathBuf> {
    let dir = dir_of(app, pack).ok()?;
    if marker_revision(&dir).as_deref() != Some(REVISION) {
        return None;
    }
    find_cli(&dir)
}

fn statuses(app: &AppHandle) -> Vec<SdcppStatus> {
    let chosen = effective_device(app);
    let automatic = preference(app) == SdcppBackend::Auto;
    // 实际在用的那份构建（macOS 选 CPU 时是 Metal 包），用来给下载列表打「已选」。
    let active = pack_for_device(chosen)
        .filter(|pack| installed(app, pack))
        .map(|pack| pack.id);
    packs()
        .iter()
        .map(|pack| SdcppStatus {
            id: pack.id.to_string(),
            label: format!("sdcpp.{}", pack.device),
            note: format!("sdcpp.{}.note", pack.device),
            device: pack.device.to_string(),
            bytes: pack.bytes(),
            installed: installed(app, pack),
            selected: pack.device == chosen || active == Some(pack.id),
            automatic,
            usable: usable_device(pack.device),
            license: "MIT".into(),
            dir: dir_of(app, pack)
                .map(|dir| dir.to_string_lossy().into_owned())
                .unwrap_or_default(),
        })
        .collect()
}

fn info(app: &AppHandle, preference: SdcppBackend) -> SdcppInfo {
    let current = effective_device(app);
    let best = best_device();
    // 界面没有「自动」这一档：旧配置里存的 auto（或本机不支持的后端）直接显示成
    // 自动挑中的那一份，用户点选视频后端时才会写下一个具体选择。
    //
    // 一份引擎都没装时显示**本机最优**（N 卡是 CUDA、macOS 是 Metal），而不是永远落在
    // CPU 上——否则第一次打开设置的人会以为这台机器只支持 CPU。
    let shown = if preference == SdcppBackend::Auto || !preference.platform_ok() {
        let auto = if pack_for_device(current)
            .map(|pack| installed(app, pack))
            .unwrap_or(false)
        {
            current
        } else {
            best
        };
        SdcppBackend::from_device(auto).unwrap_or(SdcppBackend::Cpu)
    } else {
        preference
    };
    let mut options: Vec<SdcppOption> = packs()
        .iter()
        .map(|pack| {
            let backend = SdcppBackend::from_device(pack.device).unwrap_or_default();
            SdcppOption {
                kind: pack.device.to_string(),
                label: format!("sdcpp.{}", pack.device),
                note: format!("sdcpp.{}.note", pack.device),
                available: backend.platform_ok(),
                usable: usable_device(pack.device),
                recommended: pack.device == best,
                installed: installed(app, pack),
                bytes: pack.bytes(),
                download_id: pack.id.to_string(),
            }
        })
        .collect();
    // macOS 的 CPU 没有独立构建：复用 Metal 包、启动时加 `--backend cpu`。
    // 官方的 Metal 包本来就把 ggml-cpu 编进去了，所以不用多下一份。
    // 放在**最前**：Windows / Linux 的清单也是 CPU 打头（它是全平台兜底），macOS 不该例外。
    if cfg!(target_os = "macos") {
        if let Some(metal) = pack_for_device("metal") {
            options.insert(
                0,
                SdcppOption {
                    kind: "cpu".into(),
                    label: "sdcpp.cpu".into(),
                    note: "sdcpp.cpuMac.note".into(),
                    available: true,
                    usable: true,
                    recommended: false,
                    installed: installed(app, metal),
                    bytes: metal.bytes(),
                    download_id: metal.id.to_string(),
                },
            );
        }
    }
    SdcppInfo {
        preference: shown.as_str().to_string(),
        current: current.to_string(),
        recommended: best.to_string(),
        platform: format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH),
        options,
    }
}

#[tauri::command]
pub fn sdcpp_catalog(app: AppHandle) -> Vec<SdcppStatus> {
    statuses(&app)
}

#[tauri::command]
pub fn sdcpp_info(app: AppHandle, state: tauri::State<'_, Arc<NetworkRuntime>>) -> SdcppInfo {
    info(&app, state.get().sdcpp_backend)
}

#[tauri::command]
pub fn sdcpp_set_backend(
    app: AppHandle,
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    backend: SdcppBackend,
) -> Result<SdcppInfo, String> {
    // 「自动」只留给旧配置；界面上点到的必须是本机真能跑的后端。
    if backend != SdcppBackend::Auto && (!backend.platform_ok() || !usable_device(backend.as_str()))
    {
        return Err(format!(
            "{} 在本机不可用（需要对应的显卡 / 驱动）",
            backend.label()
        ));
    }
    let mut config = state.get();
    config.sdcpp_backend = backend;
    let next = state.set(config);
    Ok(info(&app, next.sdcpp_backend))
}

#[tauri::command]
pub fn sdcpp_select(
    app: AppHandle,
    state: tauri::State<'_, Arc<NetworkRuntime>>,
    id: Option<String>,
) -> Result<(), String> {
    let backend = match id {
        Some(id) => {
            let pack = pack(&id).ok_or_else(|| format!("未知引擎：{id}"))?;
            if !installed(&app, pack) {
                return Err(format!("{} 还没下载", pack.device));
            }
            if !usable_device(pack.device) {
                return Err(format!("{} 在本机不可用", pack.device));
            }
            SdcppBackend::from_device(pack.device).ok_or_else(|| format!("未知引擎：{id}"))?
        }
        None => SdcppBackend::Auto,
    };
    let mut config = state.get();
    config.sdcpp_backend = backend;
    state.set(config);
    Ok(())
}

#[tauri::command]
pub fn sdcpp_remove(app: AppHandle, id: String) -> Result<(), String> {
    let pack = pack(&id).ok_or_else(|| format!("未知引擎：{id}"))?;
    let dir = dir_of(&app, pack)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| format!("删除失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn sdcpp_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let pack = pack(&id).ok_or_else(|| format!("未知引擎：{id}"))?;
    let dir = dir_of(&app, pack)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    crate::models::reveal_in_file_manager(&dir)
}

#[tauri::command]
pub fn sdcpp_cancel() {
    installer().cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn sdcpp_busy() -> bool {
    busy()
}

pub fn init(app: &AppHandle) {
    if let Ok(dir) = root(app) {
        let staging = dir.join(".download");
        if staging.is_dir() {
            let _ = fs::remove_dir_all(staging);
        }
    }
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
        EVENT_SDCPP,
        SdcppProgress {
            id: id.to_string(),
            state: state.to_string(),
            received,
            total,
            message,
        },
    );
}

#[tauri::command]
pub async fn sdcpp_install(app: AppHandle, id: String, force: Option<bool>) -> Result<(), String> {
    let pack = pack(&id).ok_or_else(|| format!("未知引擎：{id}"))?;
    if installed(&app, pack) && !force.unwrap_or(false) {
        return Ok(());
    }
    if installer().running.swap(true, Ordering::SeqCst) {
        return Err("已有引擎正在下载".into());
    }
    installer().cancel.store(false, Ordering::Relaxed);
    let result = install_inner(&app, pack).await;
    installer().running.store(false, Ordering::SeqCst);
    let total = pack.bytes();
    match &result {
        Ok(()) => emit(&app, pack.id, "done", total, total, None),
        Err(error) => emit(&app, pack.id, "error", 0, total, Some(error.clone())),
    }
    result
}

async fn install_inner(app: &AppHandle, pack: &'static Pack) -> Result<(), String> {
    let dir = dir_of(app, pack)?;
    let staging = root(app)?.join(".download");
    fs::create_dir_all(&staging).map_err(|error| format!("建缓存目录失败：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("建目录失败：{error}"))?;

    let network = app.state::<Arc<NetworkRuntime>>();
    let client = network
        .client()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;
    let config = network.get();
    let total = pack.bytes();

    emit(app, pack.id, "downloading", 0, total, None);
    let mut staged: Vec<(PathBuf, &'static Part)> = Vec::new();
    let mut base = 0u64;
    for part in pack.parts {
        let archive = staging.join(part.archive);
        let mut last_error = String::new();
        let mut downloaded = false;
        for source in candidates(part.sources, &config) {
            if installer().cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            match download(app, pack.id, base, total, &client, &source, &archive).await {
                Ok(()) => {
                    eprintln!(
                        "[sdcpp] {} 下载完成（{:.1} MB）",
                        part.archive,
                        part.bytes as f64 / 1048576.0
                    );
                    downloaded = true;
                    break;
                }
                Err(error) => {
                    last_error = error;
                    eprintln!("[sdcpp] {source} 源失败：{last_error}");
                    // 不要删 `.part`：换源 / 重试时还能接着下。
                    // 只有校验失败才需要从头来（那说明这份数据本身是坏的）。
                }
            }
        }
        if !downloaded {
            return Err(if last_error.is_empty() {
                "没有可用的下载源".into()
            } else {
                last_error
            });
        }
        if !part.sha256.is_empty() {
            let digest = sha256_file(&archive)?;
            if !digest.eq_ignore_ascii_case(part.sha256) {
                let _ = fs::remove_file(&archive);
                return Err(format!("{} 校验失败（sha256 不匹配）", part.archive));
            }
        }
        staged.push((archive, part));
        base += part.bytes;
        emit(app, pack.id, "downloading", base, total, None);
    }

    // 全部下载并校验完再动旧目录：中途失败不会留下半个引擎。
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| format!("清理旧引擎失败：{error}"))?;
    }
    fs::create_dir_all(&dir).map_err(|error| format!("建目录失败：{error}"))?;
    for (archive, _) in &staged {
        extract_zip(archive, &dir)?;
    }
    for (archive, _) in &staged {
        let _ = fs::remove_file(archive);
    }

    let cli = find_cli(&dir).ok_or_else(|| "引擎包里没有 sd-cli".to_string())?;
    // CUDA 运行库在官方包里是 `cudart/*.dll`；ggml-cuda.dll 按裸文件名找它们，
    // 必须和 sd-cli 放在同一目录（Windows 只搜 exe 目录与 PATH，不搜子目录）。
    flatten_cudart(&dir, &cli);

    let relative = cli
        .strip_prefix(&dir)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| "sd-cli.exe".into());
    let marker = serde_json::json!({
        "id": pack.id,
        "revision": REVISION,
        "cli": relative,
        "bytes": total,
        "installedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or(0),
    });
    fs::write(
        dir.join("marker.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    )
    .map_err(|error| format!("写标记失败：{error}"))?;
    eprintln!("[sdcpp] 已安装 {}（{}）", pack.id, cli.display());
    Ok(())
}

/// 把 `cudart/` 里的 DLL 搬到 `sd-cli` 同目录；没有就什么都不做。
fn flatten_cudart(dir: &Path, cli: &Path) {
    let Some(target) = cli.parent() else {
        return;
    };
    let Some(source) = WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .find(|entry| entry.file_type().is_dir() && entry.file_name().to_string_lossy() == "cudart")
        .map(|entry| entry.into_path())
    else {
        return;
    };
    let Ok(entries) = fs::read_dir(&source) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let destination = target.join(name);
        if destination.exists() {
            continue;
        }
        if fs::rename(&path, &destination).is_err() {
            let _ = fs::copy(&path, &destination);
            let _ = fs::remove_file(&path);
        }
    }
    let _ = fs::remove_dir_all(&source);
}

fn apply_prefix(prefix: &str, url: &str) -> String {
    let prefix = prefix.trim();
    if prefix.is_empty() {
        return url.to_string();
    }
    if prefix.contains("{url}") {
        prefix.replace("{url}", url)
    } else {
        format!("{prefix}{url}")
    }
}

/// 候选地址：用户镜像前缀 → GitHub 下载代理 → 区域偏好排序后的官方源。
fn candidates(sources: &[Source], network: &crate::network::NetworkConfig) -> Vec<String> {
    let mut ordered: Vec<&Source> = sources.iter().collect();
    match network.model_source_preference {
        ModelSourcePreference::Domestic => {
            ordered.sort_by_key(|source| if source.region == "cn" { 0 } else { 1 });
        }
        ModelSourcePreference::International => {
            ordered.sort_by_key(|source| if source.region == "intl" { 0 } else { 1 });
        }
        // auto：按清单顺序走官方源；失败后仍会尝试用户自己配置的镜像 / 下载代理。
        ModelSourcePreference::Auto => {}
    }
    let mut out: Vec<String> = Vec::new();
    let mut push = |url: String| {
        if !url.is_empty() && !out.iter().any(|existing| existing == &url) {
            out.push(url);
        }
    };
    for source in ordered {
        for mirror in &network.model_mirrors {
            push(apply_prefix(mirror, source.url));
        }
        push(apply_prefix(&network.download_prefix, source.url));
        push(source.url.to_string());
    }
    out
}

/// `.part` 断点文件的路径（`foo.zip` → `foo.zip.part`）。
fn part_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    path.with_file_name(name)
}

/// 下载一个归档到 `<path>.part`，**支持断点续传**，成功后改名成 `path`。
///
/// 为什么必须续传：CUDA 运行库单个包 563 MB、引擎包 917 MB，断一次就从 0 重来
/// 对用户是很具体的伤害（尤其是在按流量 / 慢网环境下）。
///
/// 取消 / 读写出错时**保留** `.part`，下次接着下；只有「服务端对不上」
/// （416）或校验失败才丢掉重来。
#[allow(clippy::too_many_arguments)]
async fn download(
    app: &AppHandle,
    id: &str,
    base: u64,
    total: u64,
    client: &reqwest::Client,
    url: &str,
    path: &Path,
) -> Result<(), String> {
    let part = part_path(path);
    let mut existing = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
    let mut attempt = 0u8;

    loop {
        attempt += 1;
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }
        let mut response = request.send().await.map_err(|error| format!("连接失败：{error}"))?;
        let status = response.status();

        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            // 本地断点和远端对不上（换了版本 / 文件被改过）：丢掉重来一次。
            let _ = fs::remove_file(&part);
            existing = 0;
            if attempt >= 2 {
                return Err("断点文件无效".into());
            }
            continue;
        }
        if !status.is_success() {
            return Err(format!("HTTP {status}"));
        }

        // 服务器不认 Range（回 200 而不是 206）时只能从头写：把已有的截断。
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
                // 网络断了：保留 `.part`，下次续传。
                Err(error) => return Err(format!("读取数据失败：{error}")),
            };
            if installer().cancel.load(Ordering::Relaxed) {
                drop(file);
                // 取消同样保留 `.part`：用户多半是「先停一下」而不是「不要了」。
                return Err("已取消".into());
            }
            file.write_all(&chunk)
                .map_err(|error| format!("写入失败：{error}"))?;
            received += chunk.len() as u64;
            emit(
                app,
                id,
                "downloading",
                (base + received).min(total),
                total,
                None,
            );
        }
        file.flush().map_err(|error| error.to_string())?;
        drop(file);
        fs::rename(&part, path).map_err(|error| format!("落盘失败：{error}"))?;
        return Ok(());
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip(archive: &Path, dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| format!("打开归档失败：{error}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| format!("读取 zip 失败：{error}"))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| format!("读取 zip 条目失败：{error}"))?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let target = dir.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut out = fs::File::create(&target)
            .map_err(|error| format!("写入 {} 失败：{error}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|error| format!("解压失败：{error}"))?;
        out.flush().map_err(|error| error.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_ids_match_devices() {
        for pack in packs() {
            assert!(pack.id.starts_with("sdcpp-"));
            assert!(SdcppBackend::from_device(pack.device).is_some());
        }
        // 「自动」不是引擎、也不是界面上的选项：它只作为旧配置与兜底留在内部。
        assert_eq!(SdcppBackend::from_device("auto"), None);
        if cfg!(target_os = "windows") {
            assert_eq!(packs().len(), 4, "Windows 应有 CPU / Vulkan / CUDA 12 / ROCm");
            let cuda = pack("sdcpp-cuda12").unwrap();
            assert_eq!(cuda.parts.len(), 2, "CUDA 需要引擎 + 运行库两个包");
            assert_eq!(cuda.bytes(), 354_188_849 + 563_452_046);
        }
    }

    /// macOS 的 CPU 不是独立构建：它落在 Metal 包里，启动时靠 `--backend cpu` 强制 CPU。
    #[test]
    fn macos_cpu_reuses_the_metal_build() {
        assert_eq!(build_device_for("cpu", true), "metal");
        assert_eq!(build_device_for("cpu", false), "cpu");
        assert_eq!(build_device_for("metal", true), "metal");
        assert_eq!(build_device_for("rocm", true), "rocm");
        // 只有强制 CPU 才需要 `--backend`；其余后端是独立构建，二进制里只有一种设备。
        assert_eq!(backend_arg("cpu"), Some("cpu"));
        assert_eq!(backend_arg("metal"), None);
        assert_eq!(backend_arg("rocm"), None);
    }

    /// ROCm 只在 x86_64 的 Windows / Linux 上、且本机确实是 A 卡时才算可用。
    #[test]
    fn rocm_is_an_x86_64_amd_backend() {
        assert_eq!(
            SdcppBackend::Rocm.platform_ok(),
            cfg!(all(
                any(target_os = "windows", target_os = "linux"),
                target_arch = "x86_64"
            ))
        );
        assert_eq!(serde_json::to_string(&SdcppBackend::Rocm).unwrap(), "\"rocm\"");
        assert_eq!(
            SdcppBackend::from_device("rocm"),
            Some(SdcppBackend::Rocm)
        );
    }

    #[test]
    fn backend_serde_uses_stable_ids() {
        assert_eq!(
            serde_json::to_string(&SdcppBackend::Cuda12).unwrap(),
            "\"cuda12\""
        );
        assert_eq!(
            serde_json::to_string(&SdcppBackend::Cpu).unwrap(),
            "\"cpu\""
        );
        assert_eq!(
            serde_json::to_string(&SdcppBackend::Auto).unwrap(),
            "\"auto\""
        );
        assert_eq!(
            serde_json::from_str::<SdcppBackend>("\"vulkan\"").unwrap(),
            SdcppBackend::Vulkan
        );
    }

    #[test]
    fn every_pack_has_official_and_modelscope_source() {
        for pack in packs() {
            for part in pack.parts {
                let has_intl = part.sources.iter().any(|source| {
                    source.region == "intl"
                        && source.url.starts_with(
                            "https://github.com/leejet/stable-diffusion.cpp/releases/download/",
                        )
                });
                assert!(has_intl, "{} 缺少 GitHub 官方源", part.archive);
                // ROCm 是官方后补的构建，魔搭镜像里没有：只要求「有镜像时必须是官方镜像」，
                // 不能要求每个包都有。
                for source in part.sources.iter().filter(|source| source.region == "cn") {
                    assert!(
                        source.url.starts_with(
                            "https://modelscope.cn/models/ailm32442/sd-cpp-binaries/resolve/master/"
                        ),
                        "{} 的镜像源不是官方镜像：{}",
                        part.archive,
                        source.url
                    );
                }
                assert!(part
                    .sources
                    .iter()
                    .all(|source| !source.url.contains("ghproxy")
                        && !source.url.contains("gh-proxy")
                        && !source.url.contains("hf-mirror")));
            }
        }
        // 除了 ROCm，其它包都该有国内镜像（别让用户只能挤 GitHub）。
        for pack in packs().iter().filter(|pack| pack.device != "rocm") {
            for part in pack.parts {
                assert!(
                    part.sources.iter().any(|source| source.region == "cn"),
                    "{} 缺少魔搭镜像",
                    part.archive
                );
            }
        }
    }

    #[test]
    fn candidates_put_mirrors_and_proxy_first() {
        let sources = &[Source {
            region: "intl",
            url: "https://github.com/a.zip",
        }];
        let mut network = crate::network::NetworkConfig::default();
        network.model_mirrors = vec!["https://m/".into()];
        network.download_prefix = "https://p/".into();
        let out = candidates(sources, &network);
        assert_eq!(out[0], "https://m/https://github.com/a.zip");
        assert_eq!(out[1], "https://p/https://github.com/a.zip");
        assert!(out.contains(&"https://github.com/a.zip".to_string()));
    }

    #[test]
    fn best_device_is_always_usable() {
        // 「推荐」不能推一份本机跑不起来的构建（AMD 机器上推 CUDA 是最典型的 bug）。
        let best = best_device();
        assert!(packs().iter().any(|pack| pack.device == best), "{best} 不在清单里");
        assert!(usable_device(best), "{best} 在本机不可用");
    }

    #[test]
    fn usable_device_matches_platform_rules() {
        assert!(usable_device("cpu"));
        assert_eq!(
            usable_device("metal"),
            cfg!(all(target_os = "macos", target_arch = "aarch64"))
        );
        assert_eq!(
            usable_device("vulkan"),
            cfg!(any(target_os = "windows", target_os = "linux"))
        );
        // ROCm 还要看显卡：N 卡 / 没卡时不成立。
        if !cfg!(all(
            any(target_os = "windows", target_os = "linux"),
            target_arch = "x86_64"
        )) {
            assert!(!usable_device("rocm"));
        }
    }

    #[test]
    fn extracts_a_nested_cli_and_finds_it() {
        let root = std::env::temp_dir().join(format!("aicut-sdcpp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("pack.zip");
        {
            let file = fs::File::create(&archive).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("bin/sd-cli.exe", options).unwrap();
            writer.write_all(b"exe").unwrap();
            writer.start_file("bin/ggml.dll", options).unwrap();
            writer.write_all(b"dll").unwrap();
            writer.finish().unwrap();
        }
        let out = root.join("out");
        fs::create_dir_all(&out).unwrap();
        extract_zip(&archive, &out).unwrap();
        let cli = find_cli(&out).expect("找到 sd-cli");
        assert!(cli.ends_with("bin/sd-cli.exe"), "{}", cli.display());
        let _ = fs::remove_dir_all(&root);
    }
}
