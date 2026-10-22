//! 发现正在运行的 AI Cut MCP 端点，以及本机安装的 AI Cut 应用。
//!
//! MCP 端点顺序：`AICUT_MCP_URL` → `<配置目录>/mcp-url` → 默认端口。
//! 应用路径顺序：`AICUT_APP_PATH` → `<配置目录>/app-path` → 平台常见安装位置。

use std::path::{Path, PathBuf};

pub const DEFAULT_URL: &str = "http://127.0.0.1:50563/mcp";

/// 应用可执行文件 / 安装包的候选名。
const APP_NAMES: &[&str] = &["AI Cut", "ai-cut", "aicut-app"];

pub fn config_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }?;
    Some(base.join("com.aicut.editor"))
}

pub fn candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Ok(value) = std::env::var("AICUT_MCP_URL") {
        if !value.trim().is_empty() {
            out.push(value.trim().to_string());
        }
    }
    if let Some(dir) = config_dir() {
        if let Ok(url) = std::fs::read_to_string(dir.join("mcp-url")) {
            let url = url.trim().to_string();
            if !url.is_empty() && !out.contains(&url) {
                out.push(url);
            }
        }
    }
    if !out.iter().any(|url| url == DEFAULT_URL) {
        out.push(DEFAULT_URL.to_string());
    }
    out
}

fn push_existing(out: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_file() && !out.contains(&path) {
        out.push(path);
    }
}

fn push_path(out: &mut Vec<PathBuf>, path: PathBuf) {
    if path.exists() && !out.contains(&path) {
        out.push(path);
    }
}

fn push_with_names(out: &mut Vec<PathBuf>, dir: &Path) {
    for name in APP_NAMES {
        push_existing(out, dir.join(name));
        push_existing(out, dir.join(format!("{name}.exe")));
    }
}

/// 本机所有可能的 AI Cut 应用路径，按优先级排序，只保留真实存在的文件。
pub fn app_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Ok(value) = std::env::var("AICUT_APP_PATH") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            push_existing(&mut out, PathBuf::from(trimmed));
        }
    }

    if let Some(dir) = config_dir() {
        if let Ok(path) = std::fs::read_to_string(dir.join("app-path")) {
            let path = path.trim();
            if !path.is_empty() {
                push_existing(&mut out, PathBuf::from(path));
            }
        }
    }

    // `aicut` 与主程序通常并排放在同一个目录（打包后的 sidecar / 开发构建）。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push_with_names(&mut out, dir);
            if let Some(parent) = dir.parent() {
                push_with_names(&mut out, parent);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        push_path(&mut out, PathBuf::from("/Applications/AI Cut.app"));
        if let Some(home) = std::env::var_os("HOME") {
            push_path(&mut out, PathBuf::from(home).join("Applications/AI Cut.app"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut bases = Vec::new();
        for key in ["LOCALAPPDATA", "PROGRAMFILES", "ProgramFiles(x86)"] {
            if let Some(value) = std::env::var_os(key) {
                bases.push(PathBuf::from(value));
            }
        }
        for base in bases {
            for dir in [
                base.join("Programs").join("AI Cut"),
                base.join("AI Cut"),
                base.join("ai-cut"),
            ] {
                push_with_names(&mut out, &dir);
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for dir in ["/usr/bin", "/usr/local/bin", "/opt/AI Cut", "/opt/ai-cut"] {
            push_with_names(&mut out, Path::new(dir));
        }
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            push_existing(&mut out, PathBuf::from(appimage));
        }
    }

    out
}

#[allow(dead_code)]
pub fn app_path() -> Option<PathBuf> {
    app_candidates().into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_url_is_last_resort() {
        let urls = candidates();
        assert_eq!(urls.last().map(String::as_str), Some(DEFAULT_URL));
    }

    #[test]
    fn app_candidates_only_return_existing_paths() {
        for path in app_candidates() {
            assert!(path.exists(), "候选路径不存在：{}", path.display());
        }
    }
}
