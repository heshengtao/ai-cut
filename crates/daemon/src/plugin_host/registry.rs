//! 插件名册（`plugins/host/plugins.json`）。
//!
//! 写盘用「临时文件 + rename」保证原子性；进程内用一把互斥锁串行化写者。
//! 单个桌面进程独占数据目录是本项目的既有约定（`paths.rs` 的「进程内冻结」），
//! 所以不引入跨进程文件锁。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 名册写盘互斥：一个进程内只允许一个写者。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub const REGISTRY_FILE: &str = "plugins.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    pub version: String,
    /// `linked`（本地目录）或 `store`（托管安装，M3 起使用）。
    pub kind: String,
    /// 仅 `linked` 持久化绝对路径；托管安装不落路径（数据目录可迁移）。
    #[serde(default)]
    pub path: Option<String>,
    pub enabled: bool,
    pub installed_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub format: u32,
    pub plugins: Vec<PluginRecord>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            format: 1,
            plugins: Vec::new(),
        }
    }
}

pub fn registry_path(root: &Path) -> PathBuf {
    root.join(REGISTRY_FILE)
}

pub fn load(root: &Path) -> Result<Registry, String> {
    let path = registry_path(root);
    if !path.is_file() {
        return Ok(Registry::default());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("读插件名册失败：{error}"))?;
    let mut registry: Registry =
        serde_json::from_str(&text).map_err(|error| format!("插件名册不是合法 JSON：{error}"))?;
    if registry.format != 1 {
        return Err(format!(
            "插件名册 format 必须是 1，实际是 {}",
            registry.format
        ));
    }
    registry.plugins.retain(|record| !record.id.trim().is_empty());
    Ok(registry)
}

pub fn save(root: &Path, registry: &Registry) -> Result<(), String> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "插件名册锁被污染".to_string())?;
    std::fs::create_dir_all(root).map_err(|error| format!("创建插件目录失败：{error}"))?;
    let path = registry_path(root);
    let temp = root.join(format!("{REGISTRY_FILE}.tmp"));
    let text = serde_json::to_string_pretty(registry)
        .map_err(|error| format!("序列化插件名册失败：{error}"))?;
    std::fs::write(&temp, text).map_err(|error| format!("写临时名册失败：{error}"))?;
    std::fs::rename(&temp, &path).map_err(|error| format!("替换名册失败：{error}"))?;
    Ok(())
}

/// 追加一条记录；同 id 已存在时报错并指出占用者。
pub fn upsert(registry: &mut Registry, record: PluginRecord) -> Result<(), String> {
    if let Some(existing) = registry.plugins.iter_mut().find(|item| item.id == record.id) {
        return Err(format!(
            "插件 {} 已被 {} 占用（{}）",
            record.id,
            existing.path.clone().unwrap_or_else(|| "托管安装".into()),
            existing.version
        ));
    }
    registry.plugins.push(record);
    Ok(())
}

pub fn set_enabled(registry: &mut Registry, id: &str, enabled: bool) -> Result<(), String> {
    for record in registry.plugins.iter_mut() {
        if record.id == id {
            record.enabled = enabled;
            record.updated_at = now_secs();
            return Ok(());
        }
    }
    Err(format!("名册里没有插件 {id}"))
}

pub fn remove(registry: &mut Registry, id: &str) -> Result<PluginRecord, String> {
    let index = registry
        .plugins
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| format!("名册里没有插件 {id}"))?;
    Ok(registry.plugins.remove(index))
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn record(id: &str) -> PluginRecord {
        PluginRecord {
            id: id.into(),
            version: "0.1.0".into(),
            kind: "linked".into(),
            path: Some("/tmp/demo".into()),
            enabled: true,
            installed_at: 1,
            updated_at: 1,
            last_error: None,
        }
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = TempDir::new().unwrap();
        let mut registry = Registry::default();
        upsert(&mut registry, record("@demo/a")).unwrap();
        save(dir.path(), &registry).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.plugins.len(), 1);
        assert_eq!(loaded.plugins[0].id, "@demo/a");
        assert!(loaded.plugins[0].enabled);
    }

    #[test]
    fn missing_file_is_an_empty_registry() {
        let dir = TempDir::new().unwrap();
        assert!(load(dir.path()).unwrap().plugins.is_empty());
    }

    #[test]
    fn rejects_duplicate_ids() {
        let mut registry = Registry::default();
        upsert(&mut registry, record("@demo/a")).unwrap();
        assert!(upsert(&mut registry, record("@demo/a"))
            .unwrap_err()
            .contains("@demo/a"));
    }

    #[test]
    fn toggles_enabled_and_removes() {
        let mut registry = Registry::default();
        upsert(&mut registry, record("@demo/a")).unwrap();
        set_enabled(&mut registry, "@demo/a", false).unwrap();
        assert!(!registry.plugins[0].enabled);
        let removed = remove(&mut registry, "@demo/a").unwrap();
        assert_eq!(removed.id, "@demo/a");
        assert!(registry.plugins.is_empty());
        assert!(remove(&mut registry, "@demo/a").is_err());
    }

    #[test]
    fn write_is_atomic_and_leaves_no_temp_files() {
        let dir = TempDir::new().unwrap();
        let mut registry = Registry::default();
        upsert(&mut registry, record("@demo/a")).unwrap();
        save(dir.path(), &registry).unwrap();
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }
}
