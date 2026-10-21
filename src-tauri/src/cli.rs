//! `aicut` 命令行的挂载 / 卸载。
//!
//! 不自动改 PATH：设置页里显式开关。macOS / Linux 用 `/usr/local/bin/aicut`
//! 软链到包内二进制；Windows 暂提供手工命令。无论是否挂载，`cli-path` 都会
//! 在每次启动时写入，外部 Harness 可以直接用全路径。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const COMMAND: &str = "aicut";
const PATH_FILE: &str = "cli-path";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliState {
    Installed,
    Missing,
    Conflict,
    System,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
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

#[cfg(not(unix))]
fn link_path() -> PathBuf {
    PathBuf::new()
}

fn looks_like_dev_build(path: &Path) -> bool {
    let text = path.to_string_lossy();
    #[cfg(target_os = "macos")]
    if text.contains(".app/Contents/MacOS/") {
        return false;
    }
    if let Some(position) = text.rfind("target") {
        let after = &text[position..];
        return after.contains("/debug/") || after.contains("/release/");
    }
    false
}

fn link_target(link: &Path) -> Option<PathBuf> {
    std::fs::read_link(link).ok()
}

fn classify(bundled: Option<&Path>) -> CliStatus {
    let link = link_path();
    let link_text = (!link.as_os_str().is_empty()).then(|| link.display().to_string());
    let bundled_text = bundled.map(|path| path.display().to_string());
    let manual_command = bundled.map(|path| {
        format!(
            "sudo mkdir -p /usr/local/bin && sudo ln -sfn '{}' '/usr/local/bin/{}'",
            path.display(),
            COMMAND
        )
    });

    let link_meta = if link.as_os_str().is_empty() {
        None
    } else {
        std::fs::symlink_metadata(&link).ok()
    };
    let is_symlink = link_meta
        .as_ref()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    let target = if is_symlink { link_target(&link) } else { None };

    let state = if link.as_os_str().is_empty() {
        CliState::Unsupported
    } else if is_symlink {
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
            if bundled.is_some() && looks_like_dev_build(bundled.unwrap()) {
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
            .or_else(|| link_text.clone())
    } else {
        None
    };

    CliStatus {
        state,
        command: COMMAND.to_string(),
        target: link_text,
        bundled: bundled_text.clone(),
        conflict,
        hint,
        manual_command,
        full_path: bundled_text,
    }
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

pub fn publish_path(app: &AppHandle) {
    let Some(dir) = config_dir(app) else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    if let Some(bundled) = bundled_binary() {
        let _ = std::fs::write(dir.join(PATH_FILE), bundled.display().to_string());
    }
}

pub fn status() -> CliStatus {
    classify(bundled_binary().as_deref())
}

#[cfg(target_os = "macos")]
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
fn install_unix(bundled: &Path) -> Result<(), String> {
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

#[cfg(not(unix))]
fn install_unix(_bundled: &Path) -> Result<(), String> {
    Err("Windows 暂不支持自动挂载，请使用包内全路径或手动加入 PATH".into())
}

pub fn install() -> Result<CliStatus, String> {
    let current = status();
    if current.state == CliState::Conflict && link_target(&link_path()).is_none() {
        return Err("目标路径已存在且不是本应用创建的软链，未做修改".into());
    }
    if current.state == CliState::System {
        return Ok(current);
    }

    let bundled = bundled_binary().ok_or_else(|| {
        "没有找到 aicut 可执行文件。请先运行 npm run build:aicut，或使用打包后的 AI Cut。"
            .to_string()
    })?;
    install_unix(&bundled)?;
    let next = status();
    if next.state != CliState::Installed && next.state != CliState::System {
        return Err("挂载似乎没有生效".into());
    }
    Ok(next)
}

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

#[cfg(not(unix))]
fn remove_link(_link: &Path) -> Result<(), String> {
    Ok(())
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
