//! **数据目录**：默认 `%APPDATA%\com.aicut.editor`，但可以整体搬到别的盘。
//!
//! 为什么需要这一层：模型 / ONNX Runtime / OFX 插件 / 工程历史动辄几个 GB，系统盘很快
//! 被吃满。这里把「数据放哪」从 Tauri 的固定路径里抽出来，解析顺序是：
//!
//! 1. 命令行 `--data-dir <path>`（便携模式 / 自动化）
//! 2. 环境变量 `AICUT_DATA_DIR`
//! 3. 设置页写的指针文件 `<默认配置目录>/data-dir.json`（`path` 字段）
//! 4. 安装器写的注册表 `HKCU\Software\AI Cut\DataDir`
//! 5. 默认目录（Tauri 的 `app_data_dir` / `app_config_dir` / `app_cache_dir`）
//!
//! 指针文件必须留在**默认**配置目录里：它是启动时唯一能稳定找到的锚点（数据目录本身
//! 可能已经搬走）。安装器与设置页都写这里，二者不冲突——设置页写的优先级更高。
//!
//! 少数**发现文件**（`cli-path` / `app-path` / `mcp-url`）故意不跟着搬：外部 AI harness
//! 与 `aicut` CLI 是按 bundle id 推导配置目录来找它们的（见 `skills/aicut/SKILL.md`），
//! 跟着搬只会让它们找不到。它们都只有几十字节，留在系统盘无所谓.
//!
//! 迁移是「复制 → 写指针 → 提示重启」，不在进程运行中删除旧文件：模型文件、正在写的
//! 日志、插件缓存都还开着，删了只会留下一个半坏的应用。重启后设置页再提供「清理旧目录」。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 指针文件名（放在默认配置目录）。
const POINTER: &str = "data-dir.json";
/// Windows 安装器写数据目录用的注册表键。
#[cfg(windows)]
const REG_PATH: &str = r"Software\AI Cut";
/// 注册表里的值名。
#[cfg(windows)]
const REG_VALUE: &str = "DataDir";
/// 迁移 / 清理进度事件。
pub const EVENT_PROGRESS: &str = "data-dir-progress";

/// 由外部工具按 bundle id 查找的发现文件：**不跟着数据目录搬**。
const DISCOVERY: &[&str] = &["cli-path", "app-path", "mcp-url"];
/// 可以重建、且可能正被本进程占用的目录：迁移时跳过。
const REBUILDABLE: &[&str] = &["cache"];

/// 命令行显式指定的目录（进程内只解析一次）。
static CLI_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();
/// **本进程实际生效**的数据目录（启动时解析一次后冻结）。
///
/// 迁移只写指针、不改变这里的值：运行中的进程继续用旧目录，重启后新进程才按指针切到
/// 新目录。否则迁移完的一瞬间「插件还写在旧目录、模型却去新目录找」，状态会撕成两半。
static EFFECTIVE: OnceLock<Option<(PathBuf, &'static str)>> = OnceLock::new();

/// 迁移 / 清理进度。
#[derive(Debug, Clone, Serialize)]
pub struct DataDirProgress {
    /// `scan` / `copy` / `write` / `done`。
    pub phase: &'static str,
    /// 已处理字节。
    pub done: u64,
    /// 总字节（`scan` 阶段前为 0，界面走不确定态）。
    pub total: u64,
    /// 已复制文件数。
    pub files: u64,
    /// 补充说明（失败原因等）。
    pub message: Option<String>,
}

/// 当前数据目录概况（设置页读）。
#[derive(Debug, Clone, Serialize)]
pub struct DataDirInfo {
    /// 当前生效的数据目录（绝对路径）。
    pub current: String,
    /// 系统默认数据目录（用于「恢复默认」提示）。
    pub default: String,
    /// 当前缓存目录。
    pub cache: String,
    /// 来源：`cli` / `env` / `settings` / `installer` / `default`。
    pub source: String,
    /// 数据目录已占用字节数。
    pub size_bytes: u64,
    /// 是否由环境变量 / 命令行指定（便携模式，设置页改不了）。
    pub portable: bool,
    /// 上一次迁移留下的旧目录（重启后可一键清理）。
    pub previous: Vec<String>,
    /// 指针里的新目录（与 `current` 不同 = 已迁移、等重启）。
    pub next: Option<String>,
    /// 是否需要重启才能切到 `next`。
    pub restart_required: bool,
    /// 数据目录是否在系统盘上（设置页据此提示「可以迁到别的盘」）。
    pub on_system_drive: bool,
}

/// 指针文件内容。也兼容纯文本（一行路径）——手写或旧版本都能读。
#[derive(Debug, Default, Serialize, Deserialize)]
struct Pointer {
    path: String,
    #[serde(default)]
    previous: Vec<String>,
}

fn non_empty(path: PathBuf) -> Option<PathBuf> {
    let text = path.to_string_lossy();
    if text.trim().is_empty() {
        None
    } else {
        Some(path)
    }
}

/// 解析命令行 `--data-dir <path>` / `--data-dir=<path>`。启动最早期调用一次。
pub fn init_from_args() {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = if let Some(rest) = arg.strip_prefix("--data-dir=") {
            Some(rest.to_string())
        } else if arg == "--data-dir" {
            args.next()
        } else {
            None
        };
        if let Some(value) = value.and_then(|v| non_empty(PathBuf::from(v))) {
            let _ = CLI_OVERRIDE.set(value);
            return;
        }
    }
}

fn cli_override() -> Option<PathBuf> {
    CLI_OVERRIDE.get().cloned()
}

fn env_override() -> Option<PathBuf> {
    std::env::var_os("AICUT_DATA_DIR").and_then(|v| non_empty(PathBuf::from(v)))
}

fn default_data<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn default_config<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

/// **系统默认**配置目录（不受数据目录覆盖影响）。
///
/// 给「供外部工具按 bundle id 查找」的发现文件用（`cli-path` / `app-path` / `mcp-url`）：
/// 这些文件必须留在别人推导得到的位置，不能跟着数据目录搬走。
pub fn default_config_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    default_config(app)
}

fn read_pointer_from(dir: &Path) -> Option<Pointer> {
    let text = fs::read_to_string(dir.join(POINTER)).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(pointer) = serde_json::from_str::<Pointer>(trimmed) {
        return non_empty(PathBuf::from(pointer.path)).map(|path| Pointer {
            path: path.to_string_lossy().into_owned(),
            previous: pointer.previous,
        });
    }
    // 看起来是 JSON 却解析失败：别把整段 JSON 当成路径。
    if trimmed.starts_with('{') {
        return None;
    }
    // 老式 / 手写：文件里只有一行路径。
    non_empty(PathBuf::from(trimmed)).map(|path| Pointer {
        path: path.to_string_lossy().into_owned(),
        previous: Vec::new(),
    })
}

fn read_pointer<R: Runtime>(app: &AppHandle<R>) -> Option<Pointer> {
    // 只从**默认**配置目录读：数据目录搬走之后，这里仍是稳定的锚点。
    default_config(app).and_then(|dir| read_pointer_from(&dir))
}

#[cfg(windows)]
fn registry_data_dir() -> Option<PathBuf> {
    let key = windows_registry::CURRENT_USER.open(REG_PATH).ok()?;
    let value: String = key.get_string(REG_VALUE).ok()?;
    non_empty(PathBuf::from(value))
}

#[cfg(not(windows))]
fn registry_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn write_registry(path: &Path) -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(REG_PATH)
        .map_err(|error| format!("写注册表失败：{}", error.message()))?;
    key.set_string(REG_VALUE, &path.to_string_lossy().into_owned())
        .map_err(|error| format!("写注册表失败：{}", error.message()))
}

#[cfg(not(windows))]
fn write_registry(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// 解析覆盖目录（按优先级）。只在进程第一次用到路径时跑一次。
fn resolve_override<R: Runtime>(app: &AppHandle<R>) -> Option<(PathBuf, &'static str)> {
    if let Some(path) = cli_override() {
        return Some((path, "cli"));
    }
    if let Some(path) = env_override() {
        return Some((path, "env"));
    }
    if let Some(pointer) = read_pointer(app) {
        return Some((PathBuf::from(pointer.path), "settings"));
    }
    registry_data_dir().map(|path| (path, "installer"))
}

/// 本进程实际生效的目录（冻结）。
fn effective<R: Runtime>(app: &AppHandle<R>) -> Option<&'static (PathBuf, &'static str)> {
    EFFECTIVE.get_or_init(|| resolve_override(app)).as_ref()
}

/// 当前生效的数据目录。
pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some((root, _)) = effective(app) {
        return Ok(root.clone());
    }
    default_data(app).ok_or_else(|| "拿不到应用数据目录".to_string())
}

/// 当前生效的配置目录（覆盖时与数据目录同根，保证模型 / 运行时 / 插件一起搬走）。
pub fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some((root, _)) = effective(app) {
        return Ok(root.clone());
    }
    default_config(app).ok_or_else(|| "拿不到应用配置目录".to_string())
}

/// 当前生效的缓存目录（覆盖时挂在数据目录下的 `cache/`）。
///
/// 默认仍然是 `<数据目录>/cache`（和这一层出现之前一致）：缩略图 / 波形都在这儿，
/// 换一个默认位置等于让所有老用户凭空丢一次缓存。覆盖时它也随数据目录一起搬走。
pub fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some((root, _)) = effective(app) {
        return Ok(root.join("cache"));
    }
    default_data(app)
        .map(|dir| dir.join("cache"))
        .ok_or_else(|| "拿不到应用缓存目录".to_string())
}

/// 递归统计目录大小（读不到的条目按 0 算）。
pub fn dir_size(path: &Path) -> u64 {
    dir_size_excluding(path, &[])
}

/// 同 [`dir_size`]，但跳过顶层指定名字的条目。
fn dir_size_excluding(path: &Path, skip: &[&str]) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip.iter().any(|item| *item == name) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            total += dir_size(&entry.path());
        } else if let Ok(meta) = entry.metadata() {
            total += meta.len();
        }
    }
    total
}

/// 当前真正存数据的根目录（Windows 上 data / config 经常是同一个，去重）。
fn roots<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<PathBuf>, String> {
    let data = data_dir(app)?;
    let config = config_dir(app)?;
    let mut out = vec![data.clone()];
    if !same_path(&config, &data) {
        out.push(config);
    }
    Ok(out)
}

/// 当前数据目录概况（文件大小统计在后台线程做）。
pub fn info<R: Runtime>(app: &AppHandle<R>) -> Result<DataDirInfo, String> {
    let current = data_dir(app)?;
    let default = default_data(app).ok_or_else(|| "拿不到默认数据目录".to_string())?;
    let source = effective(app).map(|(_, item)| *item).unwrap_or("default");
    let pointer = read_pointer(app);
    let previous = pointer
        .as_ref()
        .map(|pointer| pointer.previous.clone())
        .unwrap_or_default();
    // 指针里的路径和本进程实际用的不同 = 上次迁移完还没重启。
    let next = pointer
        .as_ref()
        .map(|pointer| PathBuf::from(&pointer.path))
        .filter(|path| !same_path(path, &current));
    let restart_required = next.is_some();
    let size_bytes = roots(app)?.iter().map(|dir| dir_size(dir)).sum();
    Ok(DataDirInfo {
        current: current.to_string_lossy().into_owned(),
        default: default.to_string_lossy().into_owned(),
        cache: cache_dir(app)?.to_string_lossy().into_owned(),
        source: source.to_string(),
        size_bytes,
        portable: matches!(source, "cli" | "env"),
        previous,
        next: next.map(|path| path.to_string_lossy().into_owned()),
        restart_required,
        on_system_drive: on_system_drive(&current),
    })
}

/// 数据目录是不是落在 Windows 的 `%SystemDrive%` 上。
///
/// 其它平台没有「系统盘」这个概念（macOS / Linux 的用户目录本来就在系统卷上），恒为 false。
fn on_system_drive(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let Some(system) = std::env::var_os("SystemDrive") else {
            return false;
        };
        let system = system
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_lowercase();
        if system.is_empty() {
            return false;
        }
        let text = path.to_string_lossy().to_lowercase();
        return text == system
            || text.starts_with(&format!("{system}\\"))
            || text.starts_with(&format!("{system}/"));
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

fn lower(path: &Path) -> String {
    let text = path.to_string_lossy();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.into_owned()
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    lower(a) == lower(b)
}

/// 去掉 Windows `canonicalize` 加上的 `\\?\` 前缀。
///
/// 这个前缀 Rust 自己能处理，但写进指针后会传给引擎子进程 / 插件宿主，别的程序未必认；
/// 界面上显示出来也很难看。只用于**存储和显示**，路径比较仍用 canonical 形式。
fn simplified(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

/// `child` 是否在 `parent` 之内（含相等）。
fn inside(child: &Path, parent: &Path) -> bool {
    let child = lower(child);
    let parent = lower(parent).trim_end_matches(['/', '\\']).to_string();
    child == parent
        || child
            .strip_prefix(&parent)
            .map(|rest| rest.starts_with('/') || rest.starts_with('\\'))
            .unwrap_or(false)
}

/// 复制进度（跨多个源目录累加）。
struct CopyProgress<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    done: u64,
    total: u64,
    files: u64,
    last: Instant,
}

impl<R: Runtime> CopyProgress<'_, R> {
    fn file_done(&mut self, bytes: u64) {
        self.done += bytes;
        self.files += 1;
        if self.last.elapsed() >= Duration::from_millis(120) {
            self.last = Instant::now();
            emit(self.app, "copy", self.done, self.total, self.files, None);
        }
    }
}

fn copy_tree(
    src: &Path,
    dst: &Path,
    skip: &[&str],
    on_file: &mut dyn FnMut(u64),
) -> Result<(), String> {
    let entries = fs::read_dir(src).map_err(|e| format!("读 {} 失败：{e}", src.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip.iter().any(|item| *item == name) {
            continue;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        // 符号链接 / 目录联接一律跳过：迁移不是备份，跟着链接跑可能绕回自己。
        if kind.is_symlink() {
            continue;
        }
        let target = dst.join(&name);
        if kind.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|e| format!("建目录 {} 失败：{e}", target.display()))?;
            copy_tree(&path, &target, &[], on_file)?;
        } else if let Ok(meta) = entry.metadata() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("建目录失败：{e}"))?;
            }
            // 正在写的文件 / 被杀毒软件锁住的缓存可能复制失败：跳过它们，不值得让整次迁移失败。
            if fs::copy(&path, &target).is_ok() {
                on_file(meta.len());
            }
        }
    }
    Ok(())
}

/// 把复制到新目录里 JSON 状态文件中的旧绝对路径改成新路径。
///
/// 插件清单、模型元信息、历史索引都存的是**绝对路径**；只复制文件不改这些字符串，
/// 迁移后插件管理器会认为插件没装、模型会被判定为缺失。这里统一处理目标目录下的
/// `.json`：JSON 文本里的反斜杠是 `\\`，所以两种写法都替换。
fn rebase_json_paths(root: &Path, from: &Path, to: &Path) -> Result<u64, String> {
    let from_plain = from
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string();
    let to_plain = to
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string();
    if from_plain.is_empty() || to_plain.is_empty() || same_path(from, to) {
        return Ok(0);
    }
    let from_json = from_plain.replace('\\', "\\\\");
    let to_json = to_plain.replace('\\', "\\\\");
    let mut changed = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            // 工程快照一般 < 1 MB；超过 32 MB 的 JSON 不碰，避免误伤大文件。
            if meta.len() > 32 * 1024 * 1024 {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            if !text.contains(&from_json) && !text.contains(&from_plain) {
                continue;
            }
            let next = text
                .replace(&from_json, &to_json)
                .replace(&from_plain, &to_plain);
            if next != text && fs::write(&path, next).is_ok() {
                changed += 1;
            }
        }
    }
    Ok(changed)
}

/// 扫描要复制的源目录（去重：Windows 上 data / config 经常是同一个目录）。
fn sources<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<(PathBuf, Vec<&'static str>)>, String> {
    let mut skip: Vec<&'static str> = vec![POINTER];
    skip.extend_from_slice(REBUILDABLE);
    skip.extend_from_slice(DISCOVERY);
    Ok(roots(app)?
        .into_iter()
        .map(|root| (root, skip.clone()))
        .collect())
}

/// 把当前数据目录整体迁到 `target`（复制 + 写指针；旧目录留着重启后清理）。
pub fn migrate<R: Runtime>(app: &AppHandle<R>, target: String) -> Result<DataDirInfo, String> {
    let target = PathBuf::from(target.trim());
    if target.as_os_str().is_empty() {
        return Err("请选择一个数据目录".into());
    }
    if !target.is_absolute() {
        return Err("数据目录必须是绝对路径".into());
    }
    let current_roots = roots(app)?;
    fs::create_dir_all(&target).map_err(|e| format!("建目标目录失败：{e}"))?;
    // canonicalize 之后比较，避免 `D:\a\..\a` 这类写法绕过检查；比较用 canonical，
    // 落地（写指针 / 复制）用去掉 `\\?\` 的普通绝对路径。
    let target_canon = fs::canonicalize(&target).map_err(|e| format!("目标目录不可用：{e}"))?;
    if target_canon.parent().is_none() {
        return Err("数据目录不能选磁盘根目录，请新建一个专用文件夹".into());
    }
    for source in &current_roots {
        let source_canon = fs::canonicalize(source).unwrap_or_else(|_| source.clone());
        if same_path(&source_canon, &target_canon) {
            return Err("目标目录就是当前数据目录".into());
        }
        if inside(&target_canon, &source_canon) || inside(&source_canon, &target_canon) {
            return Err("目标目录不能是当前数据目录的父目录或子目录".into());
        }
    }
    let target = simplified(target_canon);
    let mut existing = fs::read_dir(&target)
        .map_err(|e| format!("读目标目录失败：{e}"))?
        .flatten();
    if existing.next().is_some() {
        return Err("目标目录不是空的：请新建一个专用文件夹（避免覆盖已有文件）".into());
    }

    emit(app, "scan", 0, 0, 0, None);
    let list = sources(app)?;
    let total: u64 = list
        .iter()
        .map(|(path, skip)| dir_size_excluding(path, skip))
        .sum();
    emit(app, "copy", 0, total, 0, None);

    let started = Instant::now();
    let mut progress = CopyProgress {
        app,
        done: 0,
        total,
        files: 0,
        last: Instant::now(),
    };
    for (path, skip) in &list {
        if path.is_dir() {
            let mut on_file = |bytes: u64| progress.file_done(bytes);
            copy_tree(path, &target, skip, &mut on_file)?;
        }
    }
    let files = progress.files;
    let copied = progress.done;
    emit(app, "write", copied, total, files, None);
    for (path, _) in &list {
        match rebase_json_paths(&target, path, &target) {
            Ok(0) => {}
            Ok(rebased) => eprintln!(
                "[paths] 已重写 {rebased} 个 JSON 文件里指向 {} 的旧路径",
                path.display()
            ),
            Err(error) => eprintln!("[paths] 重写 JSON 里的旧路径失败：{error}"),
        }
    }

    // 写指针：先写临时文件再改名，避免断电留下半个 JSON。
    let config = default_config(app).ok_or_else(|| "拿不到默认配置目录".to_string())?;
    fs::create_dir_all(&config).map_err(|e| format!("建配置目录失败：{e}"))?;
    let target_text = target.to_string_lossy().into_owned();
    // 旧目录列表要累加：连续搬两次（A→B→C）之后，A 也得能被清理，否则它会永远留在盘上。
    let mut previous: Vec<String> = read_pointer(app)
        .map(|pointer| pointer.previous)
        .unwrap_or_default();
    previous.extend(
        list.iter()
            .map(|(path, _)| path.to_string_lossy().into_owned()),
    );
    previous.retain(|path| !same_path(Path::new(path), &target));
    previous.sort();
    previous.dedup_by(|a, b| lower(Path::new(a)) == lower(Path::new(b)));
    let pointer = Pointer {
        path: target_text.clone(),
        previous,
    };
    let text = serde_json::to_string_pretty(&pointer).map_err(|e| e.to_string())?;
    let temp = config.join(format!("{POINTER}.tmp"));
    fs::write(&temp, text).map_err(|e| format!("写数据目录指针失败：{e}"))?;
    fs::rename(&temp, config.join(POINTER)).map_err(|e| format!("保存数据目录指针失败：{e}"))?;
    if let Err(error) = write_registry(&target) {
        // 注册表只是安装器那条后备路径，写不上不影响指针文件生效。
        eprintln!("[paths] {error}（忽略，指针文件已写）");
    }
    eprintln!(
        "[paths] 数据目录已迁移：{} → {target_text}（{files} 个文件，用时 {:.1}s）",
        list.first()
            .map(|(path, _)| path.display().to_string())
            .unwrap_or_default(),
        started.elapsed().as_secs_f32()
    );
    emit(app, "done", copied, total, files, None);
    info(app)
}

/// 清理上一次迁移留下的旧目录（重启后调用；失败条目跳过）。
///
/// 返回真正删掉的目录。只删「看起来确实是本应用数据目录」的路径：指针文件是可写的
/// 本地状态，万一被改坏 / 指向用户自己的文件夹，不能把人家整个目录删掉。
pub fn cleanup_previous<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<String>, String> {
    let Some(pointer) = read_pointer(app) else {
        return Ok(Vec::new());
    };
    if pointer.previous.is_empty() {
        return Ok(Vec::new());
    }
    let current = data_dir(app)?;
    let config = default_config(app);
    let mut removed = Vec::new();
    for previous in &pointer.previous {
        let old = PathBuf::from(previous);
        // 当前目录与旧目录不能互相包含：删父目录会把正在用的数据一起删掉，
        // 删子目录则可能删掉当前数据的一部分。两种都拒绝。
        if same_path(&old, &current) || inside(&current, &old) || inside(&old, &current) {
            continue;
        }
        let holds_pointer = config
            .as_ref()
            .map(|dir| same_path(dir, &old))
            .unwrap_or(false);
        if !old.exists() {
            removed.push(previous.clone());
            continue;
        }
        if !looks_like_data(&old) && !holds_pointer {
            eprintln!(
                "[paths] {} 不像 AI Cut 的数据目录，已跳过清理",
                old.display()
            );
            continue;
        }
        let Ok(entries) = fs::read_dir(&old) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // 指针 + 发现文件必须留着：它们在默认配置目录里，删了下次启动就找不到新目录。
            if holds_pointer && (name == POINTER || DISCOVERY.contains(&name.as_str())) {
                continue;
            }
            let path = entry.path();
            let result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            if let Err(error) = result {
                // Windows 上偶发占用（杀毒 / 索引）：跳过，下次再清。
                eprintln!("[paths] 清理 {} 失败：{error}", path.display());
            }
        }
        removed.push(previous.clone());
    }
    clear_previous(app)?;
    for path in &removed {
        eprintln!("[paths] 已清理旧数据目录：{path}");
    }
    Ok(removed)
}

/// 顶层出现这些名字，就认为它确实是本应用的数据目录。
fn looks_like_data(dir: &Path) -> bool {
    const KNOWN: &[&str] = &[
        "models",
        "runtime",
        "plugins",
        "history",
        "cache",
        "agent",
        "backend-cache",
        "network.json",
        "tts.json",
        "ai.json",
        "mcp.json",
        "presets.json",
    ];
    fs::read_dir(dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                KNOWN.contains(&name.as_str())
            })
        })
        .unwrap_or(false)
}

/// 把指针里的 `previous` 清掉（保留 `path`）。
fn clear_previous<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(config) = default_config(app) else {
        return Ok(());
    };
    let Some(pointer) = read_pointer(app) else {
        return Ok(());
    };
    let text = serde_json::to_string_pretty(&Pointer {
        path: pointer.path,
        previous: Vec::new(),
    })
    .map_err(|e| e.to_string())?;
    let temp = config.join(format!("{POINTER}.tmp"));
    fs::write(&temp, text).map_err(|e| format!("写数据目录指针失败：{e}"))?;
    fs::rename(&temp, config.join(POINTER)).map_err(|e| format!("保存数据目录指针失败：{e}"))?;
    Ok(())
}

fn emit<R: Runtime>(
    app: &AppHandle<R>,
    phase: &'static str,
    done: u64,
    total: u64,
    files: u64,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_PROGRESS,
        DataDirProgress {
            phase,
            done,
            total,
            files,
            message,
        },
    );
}

/// 设置页读：当前数据目录、默认目录、占用大小、来源。
#[tauri::command]
pub async fn data_dir_info(app: AppHandle) -> Result<DataDirInfo, String> {
    tauri::async_runtime::spawn_blocking(move || info(&app))
        .await
        .map_err(|error| error.to_string())?
}

/// 设置页一键迁移：复制当前数据到 `target`，写指针，返回需要重启的新状态。
#[tauri::command]
pub async fn data_dir_migrate(app: AppHandle, target: String) -> Result<DataDirInfo, String> {
    tauri::async_runtime::spawn_blocking(move || migrate(&app, target))
        .await
        .map_err(|error| error.to_string())?
}

/// 重启后清理上一次迁移的旧目录（返回清掉的路径）。
#[tauri::command]
pub async fn data_dir_cleanup_previous(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || cleanup_previous(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aicut-paths-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plain_text_pointer_is_accepted() {
        let dir = temp_dir("plain");
        fs::write(dir.join(POINTER), "D:\\AI Cut Data\n").unwrap();
        let pointer = read_pointer_from(&dir).expect("纯文本也要能读");
        assert_eq!(pointer.path, "D:\\AI Cut Data");
        assert!(pointer.previous.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_pointer_keeps_previous() {
        let dir = temp_dir("json");
        fs::write(
            dir.join(POINTER),
            r#"{"path":"E:\\Data","previous":["C:\\Old","C:\\Older"]}"#,
        )
        .unwrap();
        let pointer = read_pointer_from(&dir).expect("JSON 指针");
        assert_eq!(pointer.path, "E:\\Data");
        assert_eq!(pointer.previous, vec!["C:\\Old", "C:\\Older"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_json_is_not_mistaken_for_a_path() {
        let dir = temp_dir("broken");
        fs::write(dir.join(POINTER), r#"{"path": "E:\\Data""#).unwrap();
        assert!(read_pointer_from(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn nesting_checks_reject_parent_and_child() {
        let base = if cfg!(windows) {
            PathBuf::from(r"D:\AI Cut")
        } else {
            PathBuf::from("/ai-cut")
        };
        let child = base.join("models");
        assert!(inside(&child, &base));
        assert!(!inside(&base, &child));
        // 前缀相同但不是同一层：`D:\AI Cut2` 不算在里面。
        let sibling = base.with_file_name("AI Cut2");
        assert!(!inside(&sibling, &base));
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_prefix_is_stripped_before_storing() {
        assert_eq!(
            simplified(PathBuf::from(r"\\?\D:\AI Cut Data")),
            PathBuf::from(r"D:\AI Cut Data")
        );
        assert_eq!(
            simplified(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
    }

    #[test]
    fn copy_tree_skips_pointer_cache_and_discovery_files() {
        let base = temp_dir("copy");
        let src = base.join("src");
        let dst = base.join("dst");
        fs::create_dir_all(src.join("plugins").join("ofx")).unwrap();
        fs::create_dir_all(src.join("cache")).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join(POINTER), "{}").unwrap();
        fs::write(src.join("cli-path"), "C:\\AI Cut\\aicut.exe").unwrap();
        fs::write(src.join("network.json"), "{}").unwrap();
        fs::write(src.join("cache").join("thumb.jpg"), "junk").unwrap();
        fs::write(src.join("plugins").join("ofx").join("a.txt"), "x").unwrap();

        let mut skip: Vec<&str> = vec![POINTER];
        skip.extend_from_slice(REBUILDABLE);
        skip.extend_from_slice(DISCOVERY);
        let mut bytes = 0u64;
        let mut on_file = |len: u64| bytes += len;
        copy_tree(&src, &dst, &skip, &mut on_file).unwrap();

        assert!(dst.join("network.json").is_file());
        assert!(dst.join("plugins").join("ofx").join("a.txt").is_file());
        assert!(!dst.join("cache").exists());
        assert!(!dst.join(POINTER).exists());
        assert!(!dst.join("cli-path").exists());
        assert!(bytes > 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sizes_ignore_skipped_top_level_entries() {
        let base = temp_dir("size");
        fs::create_dir_all(base.join("cache")).unwrap();
        fs::write(base.join("cache").join("a.bin"), vec![0u8; 1024]).unwrap();
        fs::write(base.join("keep.txt"), vec![0u8; 8]).unwrap();
        assert_eq!(dir_size_excluding(&base, &[]), 1032);
        assert_eq!(dir_size_excluding(&base, &["cache"]), 8);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn json_state_paths_are_rebased_to_the_new_root() {
        let base = temp_dir("rebase");
        fs::create_dir_all(base.join("nested")).unwrap();
        let from = PathBuf::from(r"C:\Users\me\AppData\Roaming\com.aicut.editor");
        let to = PathBuf::from(r"D:\AI Cut Data");
        // JSON 里的反斜杠是双写的；写成原始字符串更接近磁盘上的真实内容。
        fs::write(
            base.join("plugins.json"),
            r#"{"bundle":"C:\\Users\\me\\AppData\\Roaming\\com.aicut.editor\\plugins\\ofx\\a.ofx.bundle"}"#,
        )
        .unwrap();
        fs::write(base.join("nested").join("plain.json"), "not a path").unwrap();
        let changed = rebase_json_paths(&base, &from, &to).unwrap();
        assert_eq!(changed, 1);
        let text = fs::read_to_string(base.join("plugins.json")).unwrap();
        assert!(text.contains(r"D:\\AI Cut Data\\plugins"), "{text}");
        assert!(!text.contains("com.aicut.editor"));
        let _ = fs::remove_dir_all(&base);
    }
}
