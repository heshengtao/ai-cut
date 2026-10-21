//! 发现正在运行的 AI Cut MCP 端点。
//!
//! 顺序：`AICUT_MCP_URL` → `<配置目录>/mcp-url` → 默认端口。

use std::path::PathBuf;

pub const DEFAULT_URL: &str = "http://127.0.0.1:50563/mcp";

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

pub fn app_path() -> Option<String> {
    std::env::var("AICUT_APP_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
}