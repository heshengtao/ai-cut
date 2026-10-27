//! `aicut` 命令行的挂载 / 卸载。
//!
//! 不自动改 PATH：设置页里显式开关。macOS / Linux 把 `/usr/local/bin/aicut`
//! 软链到包内二进制；Windows 把 sidecar 复制到 `%LOCALAPPDATA%\AI Cut\bin`
//! 并写入当前用户的 PATH（只动 HKCU，不需要管理员权限）。无论是否挂载，
//! `cli-path` 都会在每次启动时写入，外部 Harness 可以直接用全路径。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const COMMAND: &str = "aicut";
const PATH_FILE: &str = "cli-path";

#[cfg(windows)]
const WINDOWS_SHIM_FOLDER: &str = "AI Cut";
#[cfg(windows)]
const ENVIRONMENT_KEY: &str = "Environment";
#[cfg(windows)]
const PATH_VALUE: &str = "Path";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
// 这些状态是前后端共用的 API；某些平台不会构造其中的一部分。
#[allow(dead_code)]
pub enum CliState {
    Installed,
    Missing,
    Conflict,
    System,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum CliHint {
    DevBuild,
    AppImage,
    NeedsManual,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliStatus {
    pub state: CliState,
    pub command: String,
    pub target: Option<String>,
    pub bundled: Option<String>,
    pub conflict: Option<String>,
    pub hint: Option<CliHint>,
    pub manual_command: Option<String>,
    pub full_path: Option<String>,
}

fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn bundled_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "aicut.exe" } else { COMMAND };

    // 打包后 sidecar 就在主程序旁边；开发时 Tauri 可能还没把它复制过来，
    // 因此额外回退到仓库里刚构建出来的 CLI。
    let candidates = [
        dir.join(name),
        dir.join("../../../crates/aicut/target/release").join(name),
        dir.join("../../../crates/aicut/target/debug").join(name),
    ];
    candidates.into_iter().find(|candidate| candidate.exists())
}

#[cfg(unix)]
fn link_path() -> PathBuf {
    PathBuf::from("/usr/local/bin").join(COMMAND)
}

#[cfg(unix)]
fn link_target(link: &Path) -> Option<PathBuf> {
    std::fs::read_link(link).ok()
}

#[cfg(windows)]
fn shim_dir() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    if base.is_empty() {
        return None;
    }
    Some(PathBuf::from(base).join(WINDOWS_SHIM_FOLDER).join("bin"))
}

#[cfg(windows)]
fn shim_path() -> Option<PathBuf> {
    shim_dir().map(|dir| dir.join("aicut.exe"))
}

#[cfg(unix)]
fn looks_like_dev_build(path: &Path) -> bool {
    let text = path.to_string_lossy();
    #[cfg(target_os = "macos")]
    if text.contains(".app/Contents/MacOS/") {
        return false;
    }
    if let Some(position) = text.rfind("target") {
        let after = &text[position..];
        return after.contains("/debug/")
            || after.contains("\\debug\\")
            || after.contains("/release/")
            || after.contains("\\release\\");
    }
    false
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn command_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(if cfg!(windows) { "aicut.exe" } else { COMMAND });
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn no_binary_error() -> String {
    "没有找到 aicut 可执行文件。请先运行 npm run build:aicut，或使用打包后的 AI Cut。".into()
}

#[cfg(unix)]
fn manual_mount_command(path: &Path) -> Option<String> {
    Some(format!(
        "sudo mkdir -p /usr/local/bin && sudo ln -sfn '{}' '/usr/local/bin/{}'",
        path.display(),
        COMMAND
    ))
}

#[cfg(windows)]
fn manual_mount_command(path: &Path) -> Option<String> {
    let shim = shim_path()?;
    let dir = shim.parent()?.display().to_string();
    Some(format!(
        "New-Item -ItemType Directory -Force '{dir}' | Out-Null; Copy-Item -Force '{}' '{}'; [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User').TrimEnd(';') + ';{dir}', 'User')",
        path.display(),
        shim.display()
    ))
}

#[cfg(not(any(unix, windows)))]
fn manual_mount_command(_path: &Path) -> Option<String> {
    None
}

fn build_status(
    bundled: Option<&Path>,
    state: CliState,
    target: Option<&Path>,
    conflict: Option<String>,
    hint: Option<CliHint>,
) -> CliStatus {
    let bundled_text = bundled.map(|path| path.display().to_string());
    CliStatus {
        state,
        command: COMMAND.to_string(),
        target: target.map(|path| path.display().to_string()),
        bundled: bundled_text.clone(),
        conflict,
        hint,
        manual_command: bundled.and_then(manual_mount_command),
        full_path: bundled_text,
    }
}

#[cfg(unix)]
fn classify(bundled: Option<&Path>) -> CliStatus {
    let link = link_path();
    let link_meta = std::fs::symlink_metadata(&link).ok();
    let is_symlink = link_meta
        .as_ref()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    let target = if is_symlink { link_target(&link) } else { None };

    let state = if is_symlink {
        match bundled {
            Some(bundled)
                if target
                    .as_deref()
                    .map(|t| same_file(t, bundled))
                    .unwrap_or(false) =>
            {
                CliState::Installed
            }
            _ => CliState::Conflict,
        }
    } else if link_meta.is_some() {
        // 目标路径上是一个真实文件，不是本应用创建的软链。
        CliState::Conflict
    } else if command_on_path().is_some() {
        CliState::System
    } else if bundled.is_some() {
        CliState::Missing
    } else {
        CliState::Unsupported
    };

    let hint = match state {
        CliState::Unsupported => {
            if bundled.map(looks_like_dev_build).unwrap_or(false) {
                Some(CliHint::DevBuild)
            } else if std::env::var_os("APPIMAGE").is_some() {
                Some(CliHint::AppImage)
            } else {
                None
            }
        }
        CliState::Conflict => Some(CliHint::NeedsManual),
        _ => None,
    };

    let conflict = if state == CliState::Conflict {
        target
            .as_ref()
            .map(|path| path.display().to_string())
            .or_else(|| Some(link.display().to_string()))
    } else {
        None
    };

    build_status(bundled, state, Some(&link), conflict, hint)
}

#[cfg(windows)]
fn classify(bundled: Option<&Path>) -> CliStatus {
    let shim = shim_path();
    let shim_is_file = shim.as_deref().map(Path::is_file).unwrap_or(false);
    let on_path = command_on_path();
    let path_points_to_shim = match (on_path.as_deref(), shim.as_deref()) {
        (Some(found), Some(shim)) => same_file(found, shim),
        _ => false,
    };
    let on_user_path = shim
        .as_deref()
        .and_then(|path| path.parent())
        .map(user_path_has)
        .unwrap_or(false);

    let state = if shim_is_file && (on_user_path || path_points_to_shim) {
        CliState::Installed
    } else if on_path.is_some() && !path_points_to_shim {
        CliState::System
    } else if bundled.is_some() || shim_is_file {
        // shim 在、但 PATH 被手工删掉时也走这里：重新挂载即可修复。
        CliState::Missing
    } else {
        CliState::Unsupported
    };

    build_status(bundled, state, shim.as_deref(), None, None)
}

#[cfg(not(any(unix, windows)))]
fn classify(bundled: Option<&Path>) -> CliStatus {
    build_status(bundled, CliState::Unsupported, None, None, None)
}

fn status() -> CliStatus {
    classify(bundled_binary().as_deref())
}

#[cfg(unix)]
fn run_privileged_shell(shell: &str) -> Result<(), String> {
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        shell.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("调用管理员授权失败：{error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        if message.contains("User canceled") || message.contains("-128") {
            return Err("已取消管理员授权".into());
        }
        return Err(format!("管理员命令执行失败：{}", message.trim()));
    }
    Ok(())
}

#[cfg(unix)]
fn install_link(bundled: &Path) -> Result<(), String> {
    let dir = Path::new("/usr/local/bin");
    let link = link_path();

    #[cfg(target_os = "macos")]
    {
        let shell = format!(
            "/bin/mkdir -p '{}' && /bin/ln -sfn '{}' '{}'",
            dir.display(),
            bundled.display(),
            link.display()
        );
        return run_privileged_shell(&shell);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = std::fs::create_dir_all(dir);
        std::os::unix::fs::symlink(bundled, &link)
            .map_err(|error| format!("创建软链失败：{error}（可能需要 sudo）"))?;
        Ok(())
    }
}

#[cfg(unix)]
pub fn install() -> Result<CliStatus, String> {
    let current = status();
    if current.state == CliState::Conflict && link_target(&link_path()).is_none() {
        return Err("目标路径已存在且不是本应用创建的软链，未做修改".into());
    }
    if current.state == CliState::System {
        return Ok(current);
    }

    let bundled = bundled_binary().ok_or_else(no_binary_error)?;
    install_link(&bundled)?;
    let next = status();
    if next.state != CliState::Installed && next.state != CliState::System {
        return Err("挂载似乎没有生效".into());
    }
    Ok(next)
}

#[cfg(unix)]
pub fn uninstall() -> Result<CliStatus, String> {
    let link = link_path();
    if link_target(&link).is_some() {
        remove_link(&link)?;
    }
    Ok(status())
}

#[cfg(target_os = "macos")]
fn remove_link(link: &Path) -> Result<(), String> {
    let shell = format!("/bin/rm -f '{}'", link.display());
    run_privileged_shell(&shell)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn remove_link(link: &Path) -> Result<(), String> {
    std::fs::remove_file(link).map_err(|error| {
        format!(
            "删除软链失败：{error}。请手动执行 sudo rm -f '{}'",
            link.display()
        )
    })
}

#[cfg(windows)]
fn install() -> Result<CliStatus, String> {
    let current = status();
    if current.state == CliState::System {
        return Ok(current);
    }

    let bundled = bundled_binary().ok_or_else(no_binary_error)?;
    let shim = shim_path().ok_or_else(|| {
        "找不到 %LOCALAPPDATA%，无法确定挂载位置；请把 aicut.exe 所在目录手动加入 PATH".to_string()
    })?;
    let dir = shim
        .parent()
        .ok_or_else(|| format!("无效的挂载路径：{}", shim.display()))?;

    std::fs::create_dir_all(dir)
        .map_err(|error| format!("创建 {} 失败：{error}", dir.display()))?;
    copy_into_place(&bundled, &shim)?;
    add_to_user_path(dir)?;
    notify_environment_changed();

    let next = status();
    if next.state != CliState::Installed && next.state != CliState::System {
        return Err("挂载似乎没有生效".into());
    }
    Ok(next)
}

#[cfg(windows)]
pub fn uninstall() -> Result<CliStatus, String> {
    let Some(shim) = shim_path() else {
        return Ok(status());
    };
    if shim.is_file() {
        std::fs::remove_file(&shim).map_err(|error| {
            format!(
                "删除 {} 失败：{error}。请先关闭正在运行的 aicut 再重试",
                shim.display()
            )
        })?;
    }
    if let Some(dir) = shim.parent() {
        remove_from_user_path(dir)?;
        // 目录非空时删除会失败，忽略即可。
        let _ = std::fs::remove_dir(dir);
        if let Some(parent) = dir.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
    notify_environment_changed();
    Ok(status())
}

#[cfg(not(any(unix, windows)))]
pub fn install() -> Result<CliStatus, String> {
    Err("当前平台暂不支持自动挂载 aicut，请使用包内全路径".into())
}

#[cfg(not(any(unix, windows)))]
pub fn uninstall() -> Result<CliStatus, String> {
    Ok(status())
}

/// 升级后刷新 shim 指向的可执行文件。
///
/// Unix 的软链天然跟随应用；Windows 是复制品，应用更新后需要重新复制，
/// 否则终端里仍然是旧版 `aicut`。
#[cfg(windows)]
fn refresh_mounted_shim(bundled: &Path) {
    let Some(shim) = shim_path() else {
        return;
    };
    if !shim.is_file() {
        return;
    }
    let mounted = shim.parent().map(user_path_has).unwrap_or(false);
    if !mounted || same_contents(bundled, &shim) {
        return;
    }
    // 正在运行的 aicut 会占用旧文件；失败时保留旧版本，下次启动再试。
    let _ = copy_into_place(bundled, &shim);
}

#[cfg(windows)]
fn copy_into_place(bundled: &Path, shim: &Path) -> Result<(), String> {
    let temp = shim.with_file_name("aicut.exe.new");
    let _ = std::fs::remove_file(&temp);
    std::fs::copy(bundled, &temp).map_err(|error| format!("复制 aicut 失败：{error}"))?;
    if std::fs::rename(&temp, shim).is_ok() {
        return Ok(());
    }
    // 目标可能正被运行中的 aicut 占用：删掉旧文件再换一次。
    let _ = std::fs::remove_file(shim);
    match std::fs::rename(&temp, shim) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            Err(format!(
                "写入 {} 失败：{error}。请先关闭正在运行的 aicut 再重试",
                shim.display()
            ))
        }
    }
}

#[cfg(windows)]
fn same_contents(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(a_meta), Ok(b_meta)) if a_meta.len() == b_meta.len() => {
            match (std::fs::read(a), std::fs::read(b)) {
                (Ok(a_bytes), Ok(b_bytes)) => a_bytes == b_bytes,
                _ => false,
            }
        }
        _ => false,
    }
}

#[cfg(windows)]
fn user_path() -> Result<(String, windows_registry::Type), String> {
    let key = windows_registry::CURRENT_USER
        .create(ENVIRONMENT_KEY)
        .map_err(|error| format!("打开用户环境变量失败：{}", error.message()))?;
    let ty = match key.get_type(PATH_VALUE) {
        Ok(ty) => ty,
        Err(error) => {
            // ERROR_FILE_NOT_FOUND 或 HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)：
            // 用户 PATH 还不存在，按空值处理；其它错误不能当成空值，否则会覆盖掉 PATH。
            let code = error.code().0;
            if code == 2 || code == 0x8007_0002u32 as i32 {
                return Ok((String::new(), windows_registry::Type::ExpandString));
            }
            return Err(format!("读取用户 PATH 失败：{}", error.message()));
        }
    };
    if !matches!(
        ty,
        windows_registry::Type::String | windows_registry::Type::ExpandString
    ) {
        return Err("用户 PATH 不是字符串，未做修改".into());
    }
    let value = key
        .get_string(PATH_VALUE)
        .map_err(|error| format!("读取用户 PATH 失败：{}", error.message()))?;
    Ok((value, ty))
}

#[cfg(windows)]
fn user_path_has(dir: &Path) -> bool {
    match user_path() {
        Ok((value, _)) => path_list_contains(&value, dir),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn write_user_path(value: &str, expand: bool) -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(ENVIRONMENT_KEY)
        .map_err(|error| format!("打开用户环境变量失败：{}", error.message()))?;
    let result = if expand {
        key.set_expand_string(PATH_VALUE, value)
    } else {
        key.set_string(PATH_VALUE, value)
    };
    result.map_err(|error| format!("写入用户 PATH 失败：{}", error.message()))
}

#[cfg(windows)]
fn add_to_user_path(dir: &Path) -> Result<(), String> {
    let (value, ty) = user_path()?;
    if path_list_contains(&value, dir) {
        return Ok(());
    }
    let next = append_path_entry(&value, &dir.display().to_string());
    write_user_path(&next, ty == windows_registry::Type::ExpandString)
}

#[cfg(windows)]
fn remove_from_user_path(dir: &Path) -> Result<(), String> {
    let (value, ty) = user_path()?;
    let next = strip_path_entry(&value, dir);
    if next == value {
        return Ok(());
    }
    write_user_path(&next, ty == windows_registry::Type::ExpandString)
}

#[cfg(windows)]
fn append_path_entry(existing: &str, entry: &str) -> String {
    let base = existing.trim().trim_end_matches(';');
    if base.is_empty() {
        entry.to_string()
    } else {
        format!("{base};{entry}")
    }
}

#[cfg(windows)]
fn path_list_contains(value: &str, dir: &Path) -> bool {
    let wanted = normalize_path_text(&dir.display().to_string());
    value
        .split(';')
        .any(|entry| !entry.trim().is_empty() && normalize_path_text(entry) == wanted)
}

#[cfg(windows)]
fn strip_path_entry(existing: &str, dir: &Path) -> String {
    let wanted = normalize_path_text(&dir.display().to_string());
    existing
        .split(';')
        .filter(|entry| !entry.trim().is_empty() && normalize_path_text(entry) != wanted)
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(windows)]
fn normalize_path_text(entry: &str) -> String {
    let expanded = expand_env_vars(entry.trim().trim_matches('"')).replace('/', "\\");
    expanded.trim_end_matches('\\').to_lowercase()
}

/// 展开注册表 PATH 里的 `%VAR%`（HKCU 的 PATH 通常是 REG_EXPAND_SZ）。
#[cfg(windows)]
fn expand_env_vars(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                out.push_str(after);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(windows)]
fn notify_environment_changed() {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    // 应用进程内改注册表不会惊动已经在运行的程序；让 PowerShell 走 .NET 的
    // `SetEnvironmentVariable`，它会广播 WM_SETTINGCHANGE，新开的终端才能
    // 立刻拿到新的 PATH。值原样写回，不改内容。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$p = [Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', $p, 'User')",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn publish_path(app: &AppHandle) {
    let Some(dir) = config_dir(app) else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    // 外部 CLI（aicut start）据此找到本应用的真实可执行文件，不必再依赖
    // AICUT_APP_PATH 或平台猜测。
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::write(dir.join("app-path"), exe.display().to_string());
    }
    let Some(bundled) = bundled_binary() else {
        return;
    };
    let _ = std::fs::write(dir.join(PATH_FILE), bundled.display().to_string());

    #[cfg(windows)]
    refresh_mounted_shim(&bundled);
}

#[tauri::command]
pub fn cli_status() -> CliStatus {
    status()
}

#[tauri::command]
pub fn install_cli() -> Result<CliStatus, String> {
    install()
}

#[tauri::command]
pub fn uninstall_cli() -> Result<CliStatus, String> {
    uninstall()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn append_and_strip_round_trip() {
        let dir = Path::new(r"C:\Users\me\AppData\Local\AI Cut\bin");
        let original = r"C:\Windows;C:\Tools";

        let appended = append_path_entry(original, &dir.display().to_string());
        assert_eq!(appended, format!(r"C:\Windows;C:\Tools;{}", dir.display()));
        assert!(path_list_contains(&appended, dir));
        assert_eq!(strip_path_entry(&appended, dir), original);
        assert!(!path_list_contains(original, dir));
    }

    #[test]
    fn normalize_tolerates_quotes_and_slashes() {
        assert_eq!(
            normalize_path_text("\"C:/Program Files/AI Cut/Bin/\""),
            r"c:\program files\ai cut\bin"
        );
    }

    #[test]
    fn strip_keeps_unrelated_entries_and_drops_empty_ones() {
        let dir = Path::new(r"C:\Tools\AI Cut\bin");
        let existing = format!(r"C:\Windows;;{};C:\Other;", dir.display());
        assert_eq!(strip_path_entry(&existing, dir), r"C:\Windows;C:\Other");
    }
}
