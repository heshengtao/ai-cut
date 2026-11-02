//! 本地 AI 执行后端（ONNX Runtime Execution Provider）的选择。
//!
//! - macOS：静态链接 ONNX Runtime（CoreML），没有运行时切换；
//! - Windows：运行时加载（`load-dynamic`），基线 CPU / DirectML 随包；
//!   CUDA **12** / CUDA **13** 由下载管理器分别安装到
//!   `<配置目录>/runtime/ort/cuda/` 与 `runtime/ort/cuda13/`，重启后按偏好加载。
//! - Linux：运行时加载（`load-dynamic`），CUDA **12** / CUDA **13** 同样整套自带
//!   （NVIDIA 的 Linux 组件是 `.tar.xz`，落到 SONAME 名字），加载只认应用自己的
//!   `runtime/ort/cuda[13]/<组件>`，不再回退系统 CUDA。
//!
//! CUDA 12 与 CUDA 13 是**两个独立后端**（和 ai-daw 一样让用户自己挑）：
//! 一份运行时只对一个大版本有效（CUDA 13 不再支持 Maxwell / Pascal / Volta），
//! 自动猜错时用户只会看到「选了 CUDA 却回落 CPU」，不如把选择权交出来。
//!
//! 选择存在 `network.json` 的 `backend_preference`，建会话时按当前选择注册 EP；
//! 不支持或注册失败时静默回落 CPU——所以状态接口额外下发 `missing` / `ep_ready`，
//! 让界面能把「假绿灯」说出来。
//!
//! **换运行时必须重启**：`ort` 的 dylib 在进程内只能加载一份（`OnceLock`），
//! 组件也是在加载那一刻一次性预载进来的。`restart_required` 就是给界面的提示。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use ort::ep::ExecutionProvider;
use ort::session::builder::SessionBuilder;
use ort::session::Session;
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

    fn as_u8(self) -> u8 {
        match self {
            Self::Cpu => 0,
            Self::CoreMl => 1,
            Self::DirectMl => 2,
            Self::Cuda12 => 3,
            Self::Cuda13 => 4,
        }
    }

    fn from_u8(value: u8) -> Self {
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

const ALL: [BackendPreference; 5] = [
    BackendPreference::Cpu,
    BackendPreference::CoreMl,
    BackendPreference::DirectMl,
    BackendPreference::Cuda12,
    BackendPreference::Cuda13,
];

static PREFERENCE: AtomicU8 = AtomicU8::new(0);
static COREML_CACHE: OnceLock<PathBuf> = OnceLock::new();

/// 当前进程实际加载的那份运行时 id（`cpu` / `directml` / `cuda` / `cuda13`）。
///
/// `None` = 还没加载过（自检 / 建会话前的兜底会补上）。
static LOADED_RUNTIME: Mutex<Option<&'static str>> = Mutex::new(None);

/// CUDA provider 库是否**真的注册进了 ONNX Runtime**，以及它是哪个大版本（0 = 没注册）。
///
/// 这是「显卡真的可用」的唯一诚实信号：只调 `with_execution_providers([CUDA])` 而
/// provider 库没注册成功时，ORT 会**静默**忽略它——会话照常 commit 到 CPU，一句错误
/// 都没有。以前不看这个标志，表现就是「界面写着 CUDA，GPU 利用率 0」。
#[cfg(any(target_os = "windows", target_os = "linux"))]
static CUDA_EP_FLAVOR: AtomicU8 = AtomicU8::new(0);

/// 已加载的 CUDA provider 路径（`init_from` 之后要注册给 ORT）。
#[cfg(any(target_os = "windows", target_os = "linux"))]
static CUDA_PROVIDER_PATH: OnceLock<PathBuf> = OnceLock::new();

/// 当前加载的 CUDA 运行时目录，按大版本分开（用它定位我们随下载装的组件目录）。
///
/// 用 `Mutex` 而不是 `OnceLock`：用户可能本次运行里刚装完运行时，设置页刷新
/// 状态时要能重新指向新目录，不能因为「第一次没装」就永远记着 `None`。
#[cfg(any(target_os = "windows", target_os = "linux"))]
static CUDA_RUNTIME_DIRS: Mutex<[Option<PathBuf>; 2]> = Mutex::new([None, None]);

/// 运行时是否已经加载过（`init_runtime` 或兜底加载）。
#[cfg(any(target_os = "windows", target_os = "linux"))]
static RUNTIME_LOADED: AtomicBool = AtomicBool::new(false);

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn cuda_slot(flavor: u8) -> usize {
    if flavor == 13 {
        1
    } else {
        0
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn set_cuda_runtime_dir(flavor: u8, dir: Option<PathBuf>) {
    if let Ok(mut slot) = CUDA_RUNTIME_DIRS.lock() {
        slot[cuda_slot(flavor)] = dir;
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn cuda_runtime_dir(flavor: u8) -> Option<PathBuf> {
    CUDA_RUNTIME_DIRS
        .lock()
        .ok()
        .and_then(|slot| slot[cuda_slot(flavor)].clone())
}

/// 已注册的 CUDA provider 大版本（`0` = 没注册；非 Windows / Linux 恒为 0）。
fn cuda_ep_flavor() -> u8 {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        CUDA_EP_FLAVOR.load(Ordering::Relaxed)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        0
    }
}

fn loaded_flavor() -> Option<u8> {
    LOADED_RUNTIME
        .lock()
        .ok()
        .and_then(|slot| *slot)
        .and_then(crate::runtime::cuda_flavor_of)
}

fn set_loaded_runtime(id: &'static str) {
    if let Ok(mut slot) = LOADED_RUNTIME.lock() {
        *slot = Some(id);
    }
}

/// 当前选用的运行时是否**完整可用**（本体 + 同大版本的全部组件）。
fn chosen_runtime_ready(app: &tauri::AppHandle) -> bool {
    let preference = preference();
    if !preference.is_cuda() {
        return true;
    }
    let id = preference.runtime_id();
    crate::runtime::installed(app, id) && crate::runtime::missing_components(app, id).is_empty()
}

/// 纯函数版本（单测用）：本次进程要不要重启才生效。
fn restart_required_from(
    preference: BackendPreference,
    loaded: Option<u8>,
    pending: bool,
    busy: bool,
    ready: bool,
) -> bool {
    // 正在下载 / 解压：此时文件可能还是一半，等这一轮装完再判断。
    if busy {
        return false;
    }
    // 本体或组件还没装齐：现在重启没有意义，等下载完再说。
    if !ready {
        return false;
    }
    match preference.cuda_flavor() {
        // 换了 CUDA 大版本（12 ↔ 13），或本进程加载之后又补装 / 删了组件。
        Some(flavor) => loaded != Some(flavor) || pending,
        // 从已加载的 CUDA 切回 CPU / DirectML：旧 dylib 还在进程里。
        None => loaded.is_some(),
    }
}

/// 切换后端 / 装删运行库之后是否需要重启才生效。
pub fn restart_required(app: &tauri::AppHandle) -> bool {
    let preference = preference();
    // 本机不支持的后端（例如 Linux 上残留的 cuda13 配置）不提示重启。
    if !preference.platform_ok() {
        return false;
    }
    restart_required_from(
        preference,
        loaded_flavor(),
        crate::runtime::restart_pending(app),
        crate::runtime::busy(),
        chosen_runtime_ready(app),
    )
}

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
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        BackendPreference::Cuda12 | BackendPreference::Cuda13 => apply_cuda(builder),
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

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn apply_cuda(builder: SessionBuilder) -> SessionBuilder {
    // 没注册成功就别装样子：`with_execution_providers` 会静默落到 CPU，
    // 日志里留一句、界面按「不可用」显示，比假装加速了强。
    //
    // 还要核对**大版本**：进程里只加载一份 dylib，用户从 CUDA 12 切到 13、但还没重启时，
    // provider 仍是 12 的——这时按 13 注册只会静默回落 CPU，界面应当提示重启。
    let Some(flavor) = effective().cuda_flavor() else {
        return builder;
    };
    if CUDA_EP_FLAVOR.load(Ordering::Relaxed) != flavor {
        eprintln!(
            "[backend] CUDA {flavor} provider 未就绪（运行时或组件没装齐 / 还没重启），本次会话走 CPU"
        );
        return builder;
    }
    builder
        .with_execution_providers([ort::ep::CUDA::default().build()])
        .unwrap_or_else(|error| {
            eprintln!("[backend] 注册 CUDA 执行后端失败（{error}），回落 CPU");
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
    ensure_runtime_loaded();
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
// 运行时加载（Windows / Linux）
// ---------------------------------------------------------------------------

/// ONNX Runtime 动态库文件名。
#[cfg(target_os = "windows")]
const ORT_LIBRARY: &str = "onnxruntime.dll";
#[cfg(target_os = "linux")]
const ORT_LIBRARY: &str = "libonnxruntime.so";
#[cfg(target_os = "macos")]
#[allow(dead_code)]
const ORT_LIBRARY: &str = "libonnxruntime.dylib";

/// 启动时调用：按偏好加载 CUDA 运行时或随包基线。macOS 是静态链接，直接返回。
pub fn init_runtime(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        Ok(None)
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let preference = preference();
        if let Some(flavor) = preference.cuda_flavor() {
            let id = preference.runtime_id();
            let cuda = crate::runtime::installed_runtime_dir(app, id);
            set_cuda_runtime_dir(flavor, cuda.clone());
            match cuda.as_ref() {
                Some(dir) => {
                    // 先把「组件齐不齐」说清楚：缺库时照样加载，但日志里要能看出原因。
                    let missing = cuda_missing_libraries(flavor);
                    if !missing.is_empty() {
                        eprintln!(
                            "[backend] CUDA {flavor} 组件不完整，缺：{}（设置 → AI → 运行库 里补齐）",
                            missing.join("、")
                        );
                    }
                    match load_ort(dir, Some(flavor)) {
                        Ok(()) => {
                            set_loaded_runtime(preference.runtime_id());
                            return Ok(Some(dir.clone()));
                        }
                        Err(error) => {
                            eprintln!(
                                "[backend] 加载 CUDA {flavor} 运行时失败（{error}），改用随包基线"
                            );
                        }
                    }
                }
                None => {
                    eprintln!("[backend] 已选 CUDA {flavor} 但没安装运行时，回退随包基线");
                }
            }
        }
        let dir = bundled_dir(app).ok_or_else(|| {
            format!("找不到随包的 ONNX Runtime（{ORT_LIBRARY}），先运行 pnpm fetch:ort")
        })?;
        load_ort(&dir, None)?;
        set_loaded_runtime(if dir.join("DirectML.dll").is_file() {
            "directml"
        } else {
            "cpu"
        });
        Ok(Some(dir))
    }
}

/// 随包基线运行时所在目录：资源目录 → exe 旁边的 `ort/` → 开发期资源目录。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn bundled_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::var_os("AICUT_ORT_BUNDLED") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("ort"));
        candidates.push(dir.join("resources").join("ort"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ort"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ort"),
    );
    candidates
        .into_iter()
        .find(|dir| dir.join(ORT_LIBRARY).is_file())
}

/// 创建 ORT 会话 builder。
///
/// Windows / Linux 是运行时加载：`Session::builder()` 会立刻初始化 ORT，
/// 所以必须先确保 dylib 已经加载（macOS 静态链接，这里是空操作）。
pub fn session_builder() -> Result<SessionBuilder, String> {
    ensure_runtime_loaded();
    Session::builder().map_err(|error| format!("初始化 ONNX Runtime 失败：{error}"))
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn load_ort(dir: &std::path::Path, flavor: Option<u8>) -> Result<(), String> {
    // 1. 把我们自己下载的组件目录加进 PATH。
    //
    //    ORT 的 CUDA provider 和 cuDNN 9 的十几个子库都是按**裸文件名** `LoadLibrary`
    //    的，而 Windows 的搜索顺序里**没有**「dll 自己所在目录」。不把
    //    `cuda/cudart|cublas|cufft|cudnn` 加进去，就是「会话照建、跑第一个算子才炸」。
    #[cfg(target_os = "windows")]
    extend_windows_dll_path(dir, flavor);
    #[cfg(target_os = "linux")]
    extend_linux_library_path(dir, flavor);

    // 2. 先按依赖顺序把 CUDA 组件载进进程：provider 依赖它们的符号，先载 provider 必失败。
    if let Some(flavor) = flavor {
        preload_cuda(dir, flavor);
        let provider = dir.join(cuda_provider_library());
        if provider.is_file() {
            let _ = CUDA_PROVIDER_PATH.set(provider);
        }
    }

    // 3. 再加载 ORT 本体。
    //
    //    **不要**换成 `ort::ep::cuda::preload_dylibs`：那个 helper 失败时会构造
    //    `ort::Error`，而它在构造错误信息时就去拿 ORT 的 API 指针；此刻 dylib 还没
    //    初始化，于是退回裸文件名去系统目录抓一份老版本 → `expect` 直接 panic。
    //    上面用的 `ort::util::preload_dylib` 只返回 `libloading::Error`，没有这个坑。
    let library = dir.join(ORT_LIBRARY);
    ort::init_from(&library)
        .map_err(|error| format!("加载 {} 失败：{error}", library.display()))?
        .with_name("ai-cut")
        .commit();

    // 4. **显式注册 provider 库**（顺序不能反：环境得先提交）。
    if let Some(flavor) = flavor {
        register_cuda_provider(flavor);
    }

    RUNTIME_LOADED.store(true, Ordering::Relaxed);
    Ok(())
}

/// 把 CUDA provider 库注册进 ONNX Runtime（进程内一次，成功后置
/// [`CUDA_EP_FLAVOR`]）。
///
/// CUDA 的 EP 实现早就不在核心 dll 里了：只调 `with_execution_providers([CUDA])`
/// 而不注册库时，ORT 会**静默忽略**它——会话照常 commit 到 CPU，一句错误都没有。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn register_cuda_provider(flavor: u8) {
    let Some(provider) = CUDA_PROVIDER_PATH.get().cloned() else {
        return;
    };
    if !provider.is_file() {
        eprintln!("[backend] CUDA provider 不存在：{}", provider.display());
        return;
    }
    match ort::environment::Environment::current() {
        Ok(env) => match env.register_ep_library("CUDA", &provider) {
            Ok(library) => {
                // 句柄一 drop 就会注销，这里故意不 drop。
                std::mem::forget(library);
                CUDA_EP_FLAVOR.store(flavor, Ordering::Relaxed);
                eprintln!(
                    "[backend] 已注册 CUDA {flavor} EP（{}）",
                    provider.display()
                );
            }
            Err(error) => eprintln!(
                "[backend] 注册 CUDA EP 失败（{}）：{error}——CUDA 会回落 CPU",
                provider.display()
            ),
        },
        Err(error) => eprintln!("[backend] 取 ONNX Runtime 环境失败：{error}"),
    }
}

/// CUDA provider 的文件名：用它判断当前目录是不是 CUDA 版运行时。
#[cfg(target_os = "windows")]
const fn cuda_provider_library() -> &'static str {
    "onnxruntime_providers_cuda.dll"
}
#[cfg(target_os = "linux")]
const fn cuda_provider_library() -> &'static str {
    "libonnxruntime_providers_cuda.so"
}

/// CUDA provider 硬依赖的核心库（按依赖顺序，先于 provider 进进程）。
///
/// `ort` crate 里的 `CUDA_DYLIBS` 只列了 CUDA 12 的名字；CUDA 13 的 provider 要的是
/// `cudart64_13` / `cublas64_13` / `cufft64_12`，不自己按大版本列出来，13 一个都预加载
/// 不到，最后又是一次静默回落 CPU。
#[cfg(target_os = "windows")]
fn cuda_dylibs(flavor: u8) -> &'static [&'static str] {
    if flavor == 13 {
        &[
            "cudart64_13.dll",
            "cublasLt64_13.dll",
            "cublas64_13.dll",
            "cufft64_12.dll",
        ]
    } else {
        &[
            "cudart64_12.dll",
            "cublasLt64_12.dll",
            "cublas64_12.dll",
            "cufft64_11.dll",
        ]
    }
}

#[cfg(target_os = "linux")]
fn cuda_dylibs(flavor: u8) -> &'static [&'static str] {
    if flavor == 13 {
        &[
            "libcudart.so.13",
            "libcublasLt.so.13",
            "libcublas.so.13",
            "libcufft.so.12",
        ]
    } else {
        &[
            "libcudart.so.12",
            "libcublasLt.so.12",
            "libcublas.so.12",
            "libcufft.so.11",
        ]
    }
}

/// ORT 这份 CUDA 构建**必须**有的组件（与我们钉死的那套版本一一对应）。
///
/// Windows 的清单来自 `onnxruntime_providers_cuda.dll`（1.26 / 1.31.1）的实际导入表。
#[cfg(target_os = "windows")]
fn cuda_required(flavor: u8) -> &'static [&'static str] {
    if flavor == 13 {
        &[
            "cudart64_13.dll",
            "cublas64_13.dll",
            "cublasLt64_13.dll",
            "cufft64_12.dll",
            "cudnn64_9.dll",
        ]
    } else {
        &[
            "cudart64_12.dll",
            "cublas64_12.dll",
            "cublasLt64_12.dll",
            "cufft64_11.dll",
            "cudnn64_9.dll",
        ]
    }
}

#[cfg(target_os = "linux")]
fn cuda_required(flavor: u8) -> &'static [&'static str] {
    if flavor == 13 {
        &[
            "libcudart.so.13",
            "libcublas.so.13",
            "libcublasLt.so.13",
            "libcufft.so.12",
            "libcudnn.so.9",
        ]
    } else {
        &[
            "libcudart.so.12",
            "libcublas.so.12",
            "libcublasLt.so.12",
            "libcufft.so.11",
            "libcudnn.so.9",
        ]
    }
}

/// 把 CUDA 组件（cudart / cuBLAS / cuFFT / cuDNN）预加载进进程。
///
/// **只认我们自己下载的那几个目录**（`runtime/ort/cuda/{cudart,cublas,cufft,cudnn}`，
/// CUDA 13 则是 `runtime/ort/cuda13/...`）：用户系统里的 CUDA Toolkit / pip 的
/// `nvidia-*` wheel / `torch/lib` 一律不碰。以前那一版的候选目录里排着 `CUDA_PATH`、
/// PATH、site-packages，结果是「用户机器上装的是哪套版本就用哪套」——版本对不上时
/// provider 静默回落 CPU，GPU 利用率 0，而且每台机器表现都不一样。
/// 现在 CUDA 是**整包自带、版本钉死**的。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn preload_cuda(dir: &std::path::Path, flavor: u8) {
    set_cuda_runtime_dir(flavor, Some(dir.to_path_buf()));
    let dirs = crate::runtime::cuda_component_dirs(dir);
    if dirs.is_empty() {
        eprintln!(
            "[backend] 没找到 CUDA {flavor} 组件目录（{}），CUDA 会回落 CPU；请在 设置 → AI → 运行库 里补齐",
            dir.display()
        );
        return;
    }
    let mut loaded = 0usize;
    let mut missing: Vec<&'static str> = Vec::new();
    for name in cuda_dylibs(flavor) {
        // 同名文件理论上有且只有一个（每个组件一个目录），取第一个存在的。
        match dirs
            .iter()
            .map(|root| root.join(name))
            .find(|file| file.is_file())
        {
            Some(file) => match ort::util::preload_dylib(&file) {
                Ok(()) => loaded += 1,
                Err(error) => {
                    eprintln!("[backend] 预加载 {} 失败：{error}", file.display());
                    missing.push(name);
                }
            },
            None => missing.push(name),
        }
    }
    // cuDNN **不点名**，整目录全载：9.x 的实现拆成十几个子库，清单随小版本增长
    // （9.27 会要 `cudnn_engines_tensor_ir64_9.dll`，`ort` 的清单里根本没有），
    // 而 cuDNN 前端是按裸文件名载它们的。
    let cudnn = dir.join("cudnn");
    if cudnn.is_dir() {
        loaded += preload_cudnn(&cudnn);
    } else {
        missing.push(cuda_required(flavor)[4]);
    }
    if missing.is_empty() {
        eprintln!("[backend] CUDA {flavor} 组件预加载完成（{loaded} 个）");
    } else {
        eprintln!(
            "[backend] CUDA {flavor} 组件预加载 {loaded} 个，缺：{}（补齐后重启应用）",
            missing.join("、")
        );
    }
}

/// 把一个目录里的 cuDNN 子库全载进来，返回载入个数。
///
/// 排序保证 `cudnn64_9.dll`（入口库）先于 `cudnn_*.dll` 子库进进程——
/// 按文件名天然成立（`6` < `_`）。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn preload_cudnn(dir: &std::path::Path) -> usize {
    let prefix = if cfg!(target_os = "windows") {
        "cudnn"
    } else {
        "libcudnn"
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            name.starts_with(prefix)
                                && (name.contains(".dll") || name.contains(".so"))
                        })
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
        .iter()
        .filter(|file| ort::util::preload_dylib(*file).is_ok())
        .count()
}

/// 找 CUDA 组件库时要看的目录。
///
/// Windows / Linux 都**只有**我们自己下载的那套（`runtime/ort/cuda[13]/<组件>`）。
/// Linux 也不再回退 `CUDA_PATH` / `/usr/local/cuda`：那正是「机器上装的是哪套就用哪套」
/// 的错配来源；组件没装齐时应当明确报缺，而不是悄悄借一套不匹配的。
#[cfg(target_os = "windows")]
fn cuda_library_dirs(flavor: u8) -> Vec<PathBuf> {
    cuda_runtime_dir(flavor)
        .map(|dir| crate::runtime::cuda_component_dirs(&dir))
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn cuda_library_dirs(flavor: u8) -> Vec<PathBuf> {
    cuda_runtime_dir(flavor)
        .map(|dir| crate::runtime::cuda_component_dirs(&dir))
        .unwrap_or_default()
}

/// 本机有没有 NVIDIA 驱动（**只查驱动文件，不初始化 CUDA**）。
///
/// 为什么需要它：`CUDA::is_available()` 会真初始化一次 CUDA（1~3 秒），放不进设置页的
/// 热路径；可完全不判断又会让 AMD / Intel 机器上「下载了 CUDA 运行时」显示成可用，
/// 建会话却只能回落 CPU——那是另一种假绿灯。
#[cfg(target_os = "windows")]
fn nvidia_driver_present() -> bool {
    let system32 = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    // 显示驱动自带的 NVAPI 与 nvidia-smi，装了驱动就一定在。
    system32.join("nvapi64.dll").is_file() || system32.join("nvidia-smi.exe").is_file()
}

#[cfg(target_os = "linux")]
fn nvidia_driver_present() -> bool {
    std::path::Path::new("/dev/nvidiactl").exists()
        || std::path::Path::new("/proc/driver/nvidia/version").exists()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn nvidia_driver_present() -> bool {
    false
}

/// NVIDIA 驱动的**主版本号**（读不到返回 `None`）。
///
/// CUDA 13 要求驱动 ≥ 580；这个判断只用来「推荐」后端，读不到时保守留在 CUDA 12
/// （那套在 580+ 驱动上照样能跑）。Windows / Linux 都有 `nvidia-smi`。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn nvidia_driver_major() -> Option<u32> {
    static CACHE: OnceLock<Option<u32>> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let output = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=driver_version", "--format=csv,noheader"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines()
            .next()
            .and_then(|line| line.trim().split('.').next())
            .and_then(|major| major.parse::<u32>().ok())
    })
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn nvidia_driver_major() -> Option<u32> {
    None
}

/// 本机是否适合 CUDA 13（驱动 ≥ 580）。
fn cuda13_supported() -> bool {
    BackendPreference::Cuda13.platform_ok()
        && nvidia_driver_present()
        && nvidia_driver_major()
            .map(|major| major >= 580)
            .unwrap_or(false)
}

/// 本机推荐的后端：NVIDIA + 新驱动用 CUDA 13，否则 CUDA 12；都不是就 CPU。
///
/// 「推荐」只看本机是否跑得动，不看装没装——设置页会把「需要下载」单独标出来。
fn recommended_backend() -> BackendPreference {
    if !nvidia_driver_present() || !BackendPreference::Cuda12.platform_ok() {
        return BackendPreference::Cpu;
    }
    if cuda13_supported() && BackendPreference::Cuda13.platform_ok() {
        BackendPreference::Cuda13
    } else {
        BackendPreference::Cuda12
    }
}

/// 还缺哪些组件库（空 = 齐了）。
///
/// 只做「文件在不在」的判断：能不能真的初始化 CUDA 只有建会话才知道，但缺库是最常见、
/// 也最容易提前告诉用户的失败原因。Windows 上只看我们自己装的那套——
/// 用户系统里有没有 CUDA 都不影响结论，这样「装完就能用」是可预期的。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn cuda_missing_libraries(flavor: u8) -> Vec<&'static str> {
    missing_in(&cuda_library_dirs(flavor), cuda_required(flavor))
}

/// 这些目录里还缺 `required` 中的哪些文件。
fn missing_in(dirs: &[PathBuf], required: &[&'static str]) -> Vec<&'static str> {
    required
        .iter()
        .filter(|name| !dirs.iter().any(|dir| dir.join(name).is_file()))
        .copied()
        .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn cuda_missing_libraries(_flavor: u8) -> Vec<&'static str> {
    Vec::new()
}

/// 确保运行时已加载：应用启动时由 `init_runtime` 完成；测试或直接建会话时兜底。
pub fn ensure_runtime_loaded() {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        if RUNTIME_LOADED.load(Ordering::Relaxed) {
            return;
        }
        if let Some(dir) = dev_bundled_dir() {
            if let Err(error) = load_ort(&dir, None) {
                eprintln!("[backend] 加载 ONNX Runtime 失败：{error}");
            } else {
                set_loaded_runtime(if dir.join("DirectML.dll").is_file() {
                    "directml"
                } else {
                    "cpu"
                });
            }
        }
    }
}

/// 没有 AppHandle 时的运行时目录：环境变量 → exe 旁边 → 开发期资源目录。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn dev_bundled_dir() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("AICUT_ORT_BUNDLED").map(PathBuf::from),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("ort"))),
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("ort"),
        ),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|dir| dir.join(ORT_LIBRARY).is_file())
}

/// 把运行时目录 + 我们装的 CUDA 组件目录加进 PATH。
///
/// 为什么必须这么做：ORT 的 CUDA provider、以及 cuDNN 9 的子库，都是按**裸文件名**
/// `LoadLibrary` 的，而 Windows 的搜索顺序里没有「dll 自己所在目录」。组件目录不进
/// PATH，就会出现「会话照建、跑第一个 Conv 才报找不到 cudnn_*.dll」。
///
/// 只加**我们自己下载**的目录：系统那份 CUDA 的 `bin` 故意不加，避免同一进程里
/// 混进第二套版本。CUDA 12 / 13 也只加选中的那一套。
#[cfg(target_os = "windows")]
fn extend_windows_dll_path(dir: &std::path::Path, flavor: Option<u8>) {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut extra: Vec<PathBuf> = vec![dir.to_path_buf()];
    if flavor.is_some() {
        extra.extend(crate::runtime::cuda_component_dirs(dir));
    }
    extra.retain(|path| path.is_dir());
    for path in extra.into_iter().rev() {
        if !paths.contains(&path) {
            paths.insert(0, path);
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

/// Linux 上 `dlopen` 只在进程启动时读一次 LD_LIBRARY_PATH；这里提前把我们自己的
/// 组件目录插到最前面。
///
/// **不再**把 `CUDA_HOME` / `CUDA_PATH` 加进去：系统里那套版本和我们的组件对不上，
/// 混进 `dlopen` 搜索路径就会重演「能载入、跑第一个算子才炸」的静默回落。
/// 已有的 `LD_LIBRARY_PATH` 保留在后面，供 libstdc++ 等系统依赖使用。
#[cfg(target_os = "linux")]
fn extend_linux_library_path(dir: &std::path::Path, flavor: Option<u8>) {
    let mut paths: Vec<PathBuf> = std::env::var_os("LD_LIBRARY_PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut extra: Vec<PathBuf> = vec![dir.to_path_buf()];
    if flavor.is_some() {
        extra.extend(crate::runtime::cuda_component_dirs(dir));
    }
    extra.retain(|path| path.is_dir());
    for path in extra.into_iter().rev() {
        if !paths.contains(&path) {
            paths.insert(0, path);
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("LD_LIBRARY_PATH", joined);
    }
}

/// `--ai-selftest`：无界面验证 ONNX Runtime 能否加载、各 EP 是否可用。
pub fn selftest() -> i32 {
    #[cfg(target_os = "macos")]
    {
        println!("macOS: ONNX Runtime 静态链接（CoreML），无需运行时文件");
        0
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        // `AICUT_ORT_RUNTIME`（文件或目录）优先：把自检直接指到下载管理器装好的那套
        // （含 CUDA 本体与组件），才能验证「完整匹配下载」这条路真的通。
        let dir = std::env::var_os("AICUT_ORT_RUNTIME")
            .map(PathBuf::from)
            .and_then(|path| {
                if path.join(ORT_LIBRARY).is_file() {
                    Some(path)
                } else {
                    path.parent().map(std::path::Path::to_path_buf)
                }
            })
            .filter(|dir| dir.join(ORT_LIBRARY).is_file())
            .or_else(|| {
                std::env::var_os("AICUT_ORT_BUNDLED")
                    .map(PathBuf::from)
                    .filter(|dir| dir.join(ORT_LIBRARY).is_file())
            })
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|dir| dir.join("ort")))
                    .filter(|dir| dir.join(ORT_LIBRARY).is_file())
            })
            .or_else(|| {
                let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources")
                    .join("ort");
                dev.join(ORT_LIBRARY).is_file().then_some(dev)
            });
        let Some(dir) = dir else {
            eprintln!("找不到 {ORT_LIBRARY}（先运行 pnpm fetch:ort）");
            return 1;
        };
        // 目录名是 `cuda` / `cuda13`，或解压目录里带对应 cudart；都没有就是基线。
        let flavor = if dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "cuda13")
            || dir.join("cudart64_13.dll").is_file()
            || dir.join("libcudart.so.13").is_file()
        {
            Some(13)
        } else if dir.join(cuda_provider_library()).is_file() {
            Some(12)
        } else {
            None
        };
        if let Some(flavor) = flavor {
            set_cuda_runtime_dir(flavor, Some(dir.clone()));
        }
        if let Err(error) = load_ort(&dir, flavor) {
            eprintln!("{error}");
            return 1;
        }
        println!("runtime: {}", dir.display());
        println!("cuda-build: {}", flavor.is_some());
        println!("cuda-flavor: {}", flavor.unwrap_or(0));
        println!("cpu: true");
        #[cfg(target_os = "windows")]
        println!(
            "directml: {}",
            ort::ep::DirectML::default().is_available().unwrap_or(false)
        );
        // 真初始化一次 CUDA（枚举设备 / 载 cuBLAS，1~3 秒）：自检就是为了拿到这个答案。
        println!(
            "cuda-ep: {}",
            ort::ep::CUDA::default().is_available().unwrap_or(false)
        );
        println!(
            "cuda-ep-ready: {}",
            CUDA_EP_FLAVOR.load(Ordering::Relaxed) != 0
        );
        if let Some(flavor) = flavor {
            println!("cuda-missing: {}", cuda_missing_libraries(flavor).join(","));
            for dir in cuda_library_dirs(flavor) {
                println!("cuda-lib-dir: {}", dir.display());
            }
        }
        0
    }
}

// ---------------------------------------------------------------------------
// 设置页协议
// ---------------------------------------------------------------------------

/// 一个可选后端（给设置页渲染）。
#[derive(Debug, Clone, Serialize)]
pub struct BackendOption {
    /// 稳定标识（`cpu` / `coreml` / `directml` / `cuda12` / `cuda13`）。
    pub kind: String,
    pub label: String,
    pub note: String,
    /// 是否本机可用（平台支持；CUDA 还要求本机不是明确别家显卡）。
    pub available: bool,
    /// 它需要哪一份运行时（`cpu` / `cuda` / `cuda13` / …）。
    pub runtime: String,
    /// 那份运行时装好了没有。
    pub runtime_installed: bool,
    /// 需要下载多少字节（0 = 已装好）。
    pub download_bytes: u64,
    /// 还缺哪些**组件**（运行时 id，例如 `cufft13`）。空 = 齐了 / 与它无关。
    ///
    /// CUDA 的 provider 硬依赖 cudart / cuBLAS / cuFFT / cuDNN，缺一个就载不进来并
    /// **静默回落 CPU**；界面要能提前说出来，而不是等用户发现「GPU 利用率 0」。
    pub missing: Vec<String>,
}

/// 后端选择 + 本机情况。
#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    pub preference: String,
    pub current: String,
    /// 本机推荐的后端（NVIDIA 新驱动时是 `cuda13`，老驱动 `cuda12`，否则 `cpu`）。
    pub recommended: String,
    pub platform: String,
    /// 进程里**已经加载**的那份运行时；未加载为 `null`。
    pub loaded_runtime: Option<String>,
    /// 刚切换过运行时 / 补装过组件，需要重启才生效。
    pub restart_required: bool,
    /// 当前选中的 CUDA provider 是否真的注册进了 ONNX Runtime。
    pub ep_ready: bool,
    /// 全部选项（**含**本机不支持的，`available = false`）。
    pub options: Vec<BackendOption>,
}

/// 本机是否可以用 CUDA：平台支持，且没有明确认出别家显卡。
fn cuda_available_here() -> bool {
    BackendPreference::Cuda12.platform_ok() && nvidia_driver_present()
}

fn option_available(kind: BackendPreference) -> bool {
    kind.platform_ok() && (!kind.is_cuda() || cuda_available_here())
}

fn info(app: &tauri::AppHandle, preference: BackendPreference) -> BackendInfo {
    let options = ALL
        .iter()
        .map(|kind| {
            let runtime = kind.runtime_id();
            let installed = if kind.is_cuda() {
                crate::runtime::installed(app, runtime)
            } else {
                kind.platform_ok()
            };
            let missing: Vec<String> = if kind.is_cuda() {
                crate::runtime::missing_components(app, runtime)
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            } else {
                Vec::new()
            };
            BackendOption {
                kind: kind.as_str().to_string(),
                label: kind.label().to_string(),
                note: kind.note().to_string(),
                available: option_available(*kind),
                runtime: runtime.to_string(),
                runtime_installed: installed,
                download_bytes: if kind.is_cuda() && !installed {
                    crate::runtime::bytes(runtime)
                } else {
                    0
                },
                missing,
            }
        })
        .collect();
    let current = if option_available(preference) {
        preference
    } else {
        BackendPreference::Cpu
    };
    BackendInfo {
        preference: preference.as_str().to_string(),
        current: current.as_str().to_string(),
        recommended: recommended_backend().as_str().to_string(),
        platform: platform_label(),
        loaded_runtime: LOADED_RUNTIME
            .lock()
            .ok()
            .and_then(|slot| *slot)
            .map(str::to_string),
        restart_required: restart_required(app),
        ep_ready: preference
            .cuda_flavor()
            .map(|flavor| cuda_ep_flavor() == flavor)
            .unwrap_or(false),
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

/// 刷新「CUDA 装在哪儿」这份缓存（两个大版本各自一份）。
///
/// 用户可能在本次运行里刚下载 / 删掉运行时；设置页刷新状态时应该立刻反映出来，
/// 而不是等到重启才更新「缺哪几个组件」。
fn refresh_cuda_runtime_dirs(app: &tauri::AppHandle) {
    for flavor in [12u8, 13u8] {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            let id = if flavor == 13 { "cuda13" } else { "cuda" };
            set_cuda_runtime_dir(flavor, crate::runtime::installed_runtime_dir(app, id));
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = (app, flavor);
        }
    }
}

#[tauri::command]
pub fn ai_backend_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::network::NetworkRuntime>>,
) -> BackendInfo {
    refresh_cuda_runtime_dirs(&app);
    info(&app, state.get().backend_preference)
}

#[tauri::command]
pub fn ai_set_backend(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::network::NetworkRuntime>>,
    preference: BackendPreference,
) -> Result<BackendInfo, String> {
    refresh_cuda_runtime_dirs(&app);
    let mut config = state.get();
    config.backend_preference = preference;
    let next = state.set(config);
    set_preference(next.backend_preference);
    Ok(info(&app, next.backend_preference))
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
        // 旧版只存 `"cuda"`：继续按 CUDA 12 解释，别把老卡带到 13。
        assert_eq!(
            serde_json::from_str::<BackendPreference>("\"cuda\"").unwrap(),
            BackendPreference::Cuda12
        );
        assert_eq!(
            serde_json::from_str::<BackendPreference>("\"cuda13\"").unwrap(),
            BackendPreference::Cuda13
        );
    }

    #[test]
    fn coreml_is_apple_silicon_only() {
        assert!(
            !BackendPreference::CoreMl.platform_ok()
                || cfg!(all(target_os = "macos", target_arch = "aarch64"))
        );
        assert!(!BackendPreference::DirectMl.platform_ok() || cfg!(target_os = "windows"));
        assert!(
            !BackendPreference::Cuda12.platform_ok()
                || cfg!(any(
                    all(target_os = "windows", target_arch = "x86_64"),
                    all(target_os = "linux", target_arch = "x86_64")
                ))
        );
        assert!(
            !BackendPreference::Cuda13.platform_ok()
                || cfg!(any(
                    all(target_os = "windows", target_arch = "x86_64"),
                    all(target_os = "linux", target_arch = "x86_64")
                ))
        );
        assert!(BackendPreference::Cpu.platform_ok());
    }

    #[test]
    fn restart_is_required_only_when_the_loaded_runtime_differs() {
        // 什么都没加载、也没装：不提示。
        assert!(!restart_required_from(
            BackendPreference::Cpu,
            None,
            false,
            false,
            true
        ));
        // 刚切到 CUDA、本进程还是基线：需要重启。
        assert!(restart_required_from(
            BackendPreference::Cuda12,
            None,
            false,
            false,
            true
        ));
        // 已经在用 CUDA 12：不需要。
        assert!(!restart_required_from(
            BackendPreference::Cuda12,
            Some(12),
            false,
            false,
            true
        ));
        // 从 CUDA 12 切到 13（还没重启）：需要。
        assert!(restart_required_from(
            BackendPreference::Cuda13,
            Some(12),
            false,
            false,
            true
        ));
        // 组件刚补装 / 删掉：加载路径没变，但进程里的那套已经不完整了。
        assert!(restart_required_from(
            BackendPreference::Cuda12,
            Some(12),
            true,
            false,
            true
        ));
        // 正在下载：等装完再判断。
        assert!(!restart_required_from(
            BackendPreference::Cuda12,
            None,
            false,
            true,
            true
        ));
        // 还没装齐：现在重启没有意义。
        assert!(!restart_required_from(
            BackendPreference::Cuda12,
            None,
            false,
            false,
            false
        ));
        // 从已加载的 CUDA 切回 CPU：旧 dylib 还在进程里。
        assert!(restart_required_from(
            BackendPreference::Cpu,
            Some(12),
            false,
            false,
            true
        ));
        assert!(!restart_required_from(
            BackendPreference::DirectMl,
            None,
            false,
            false,
            true
        ));
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    #[test]
    fn missing_libraries_look_only_at_the_given_dirs() {
        let root = std::env::temp_dir().join(format!("ai-cut-cuda-detect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cudart = root.join("cudart");
        let cudnn = root.join("cudnn");
        std::fs::create_dir_all(&cudart).unwrap();
        std::fs::create_dir_all(&cudnn).unwrap();

        let required: [&'static str; 2] = ["cudart64_12.dll", "cudnn64_9.dll"];
        let dirs = vec![cudart.clone(), cudnn.clone()];
        assert_eq!(missing_in(&dirs, &required), required.to_vec());

        // 组件分散在不同目录里也要能找到（cudart/cudnn 各一个目录）。
        std::fs::write(cudart.join("cudart64_12.dll"), b"x").unwrap();
        assert_eq!(missing_in(&dirs, &required), vec!["cudnn64_9.dll"]);
        std::fs::write(cudnn.join("cudnn64_9.dll"), b"x").unwrap();
        assert!(missing_in(&dirs, &required).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Windows 的组件清单必须按大版本对齐，且只看我们自己的目录。
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    #[test]
    fn cuda_required_matches_each_pinned_flavor() {
        let twelve = cuda_required(12);
        assert!(twelve.iter().any(|name| *name == "cufft64_11.dll"));
        for name in twelve {
            assert!(
                !name.contains("64_13"),
                "CUDA 12 清单混进了 13 的库：{name}"
            );
        }
        let thirteen = cuda_required(13);
        assert!(thirteen.iter().any(|name| *name == "cufft64_12.dll"));
        assert!(thirteen.iter().any(|name| *name == "cudart64_13.dll"));
        for name in thirteen {
            assert!(
                !name.contains("64_12") || *name == "cufft64_12.dll",
                "CUDA 13 清单混进了 12 的库：{name}"
            );
        }
        // 预加载顺序里必须有每一个依赖（否则 provider 载入必失败）。
        for flavor in [12u8, 13u8] {
            for name in cuda_required(flavor) {
                if name.contains("cudnn") {
                    continue;
                }
                assert!(
                    cuda_dylibs(flavor).contains(name),
                    "CUDA {flavor} 的依赖 {name} 不在预加载清单里"
                );
            }
        }
    }

    /// 整卡已用显存（MB）。Windows 上 `--query-compute-apps` 经常不按进程归账，
    /// 所以「建会话前后整卡涨了多少」是更可靠的判据。
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    fn vram_mb_total() -> Option<u64> {
        let output = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=memory.used", "--format=csv,noheader,nounits"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines()
            .next()
            .and_then(|line| line.trim().parse::<u64>().ok())
    }

    /// 手动验证：CUDA **真的能把模型跑起来**（不只是「EP 注册成功」）。
    ///
    /// `CUDA_EP_FLAVOR` 只证明 provider 注册进了 ORT；真正跑模型还会经过 cuDNN 的
    /// Convolution 内核，那里缺一个子库要到**第一次推理**才炸。所以这条用例既建会话，
    /// 也跑一次全零输入的推理，并用显存确认它确实在显卡上。
    ///
    /// ```text
    /// $env:AICUT_TEST_RUNTIME="$env:APPDATA\com.aicut.editor\runtime\ort\cuda13"
    /// $env:AICUT_TEST_MODEL="D:\ai-cut\src-tauri\resources\models\yolox-nano\yolox_nano.onnx"
    /// cargo test --lib cuda_runs_a_model -- --ignored --nocapture
    /// ```
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    #[test]
    #[ignore = "手动：需要 AICUT_TEST_RUNTIME（CUDA 运行时目录）与 AICUT_TEST_MODEL（一张 .onnx）"]
    fn cuda_runs_a_model() {
        let (Some(runtime), Some(model)) = (
            std::env::var_os("AICUT_TEST_RUNTIME"),
            std::env::var_os("AICUT_TEST_MODEL"),
        ) else {
            panic!("需要 AICUT_TEST_RUNTIME 与 AICUT_TEST_MODEL");
        };
        let runtime = PathBuf::from(runtime);
        let model = PathBuf::from(model);
        let flavor = if runtime
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "cuda13")
            || runtime.join("cudart64_13.dll").is_file()
        {
            13
        } else {
            12
        };
        set_cuda_runtime_dir(flavor, Some(runtime.clone()));
        load_ort(&runtime, Some(flavor)).expect("加载 CUDA 运行时");
        assert_eq!(
            CUDA_EP_FLAVOR.load(Ordering::Relaxed),
            flavor,
            "CUDA provider 没注册成功，建出来的会话只会是 CPU"
        );
        set_preference(if flavor == 13 {
            BackendPreference::Cuda13
        } else {
            BackendPreference::Cuda12
        });
        assert!(
            cuda_missing_libraries(flavor).is_empty(),
            "组件不齐：{:?}",
            cuda_missing_libraries(flavor)
        );

        let before = vram_mb_total();
        let builder = session_builder().expect("创建 builder");
        let mut session =
            commit(apply(builder), session_builder, &model, "测试模型").expect("建会话失败了");
        let after = vram_mb_total();
        eprintln!("整卡显存：{before:?} → {after:?} MB");
        if let (Some(before), Some(after)) = (before, after) {
            // CUDA 上下文 + cuBLAS/cuDNN 句柄至少几百 MB；静默回落 CPU 时几乎不涨。
            assert!(
                after >= before + 100,
                "建会话后显存只涨了 {} MB（{before} → {after}）——会话很可能悄悄落在了 CPU 上",
                after.saturating_sub(before)
            );
        }

        // 跑一次全零输入的推理：Conv 会走 cuDNN，缺子库在这里就会暴露。
        // 先把输入的元信息拷出来，再可变借用 `session` 去 run。
        let (name, ty, dims) = {
            let input = &session.inputs()[0];
            match input.dtype() {
                ort::value::ValueType::Tensor { ty, shape, .. } => {
                    (input.name().to_string(), *ty, shape.to_vec())
                }
                other => panic!("输入不是张量：{other:?}"),
            }
        };
        assert_eq!(
            ty,
            ort::value::TensorElementType::Float32,
            "只支持 fp32 输入"
        );
        assert!(
            dims.iter().all(|dim| *dim > 0),
            "动态输入 {dims:?}，换一张静态形状的模型再测"
        );
        let count: i64 = dims.iter().product();
        let tensor =
            ort::value::Tensor::from_array((dims, vec![0f32; count as usize])).expect("造输入");
        let outputs = session.run(ort::inputs![tensor]).expect("推理失败");
        eprintln!("推理完成：{name} → {} 个输出", outputs.len());
    }
}
