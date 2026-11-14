//! 无头模式的数据目录解析（不依赖 Tauri）。
//!
//! 桌面端由 Tauri 解析后通过 `Host::data_dir()` 注入；这里只服务 `aicutd`：
//! `--data-dir` > `AICUT_DATA_DIR` > 指针文件（`<默认配置目录>/data-dir.json`）> 系统默认。
//! 顺序与 `src-tauri/src/paths.rs` 保持一致，Docker 里一个 `--data-dir /data` 就能定死。

use std::path::{Path, PathBuf};

/// 应用标识：与 `tauri.conf.json` 的 `identifier` 一致，保证桌面/无头看到同一份默认目录。
pub const IDENTIFIER: &str = "com.aicut.editor";

/// 解析结果。
#[derive(Clone, Debug)]
pub struct DataPaths {
    data: PathBuf,
    config: PathBuf,
    cache: PathBuf,
    source: &'static str,
}

impl DataPaths {
    /// 按优先级解析；`cli` 来自 `--data-dir`。
    pub fn resolve(cli: Option<String>) -> Self {
        if let Some(path) = cli.filter(|value| !value.trim().is_empty()) {
            return Self::rooted(PathBuf::from(path), "cli");
        }
        if let Some(path) = std::env::var_os("AICUT_DATA_DIR")
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
        {
            return Self::rooted(path, "env");
        }
        if let Some(path) = read_pointer() {
            return Self::rooted(path, "settings");
        }
        let data = default_data_dir();
        let config = default_config_dir();
        Self {
            cache: data.join("cache"),
            data,
            config,
            source: "default",
        }
    }

    fn rooted(root: PathBuf, source: &'static str) -> Self {
        Self {
            cache: root.join("cache"),
            config: root.clone(),
            data: root,
            source,
        }
    }

    pub fn data(&self) -> &Path {
        &self.data
    }

    pub fn config(&self) -> &Path {
        &self.config
    }

    pub fn cache(&self) -> &Path {
        &self.cache
    }

    pub fn source(&self) -> &'static str {
        self.source
    }

    /// 建好目录（无头启动时调用一次）。
    pub fn ensure(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.data)?;
        std::fs::create_dir_all(&self.config)?;
        std::fs::create_dir_all(&self.cache)?;
        Ok(())
    }
}

/// 指针文件：设置页迁移数据目录后写下的新位置。
fn read_pointer() -> Option<PathBuf> {
    let dir = default_config_dir();
    let text = std::fs::read_to_string(dir.join("data-dir.json")).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        // 设置页写的 JSON 指针：{"path": "..."}。
        let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        return value
            .get("path")
            .and_then(|path| path.as_str())
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty());
    }
    Some(PathBuf::from(trimmed))
}

#[cfg(target_os = "macos")]
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
pub fn default_data_dir() -> PathBuf {
    home()
        .map(|home| home.join("Library/Application Support").join(IDENTIFIER))
        .unwrap_or_else(|| PathBuf::from(".").join(IDENTIFIER))
}

#[cfg(target_os = "macos")]
pub fn default_config_dir() -> PathBuf {
    default_data_dir()
}

#[cfg(windows)]
fn appdata() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(windows)]
pub fn default_data_dir() -> PathBuf {
    appdata()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(IDENTIFIER)
}

#[cfg(windows)]
pub fn default_config_dir() -> PathBuf {
    default_data_dir()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn default_data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| home().map(|home| home.join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join(IDENTIFIER)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn default_config_dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| home().map(|home| home.join(".config")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join(IDENTIFIER)
}
