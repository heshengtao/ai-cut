# 插件加载器与生命周期（M1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个放在本地目录、只带客户端半的插件，能被导入、出现在面板里、注册节点与命令、被禁用后干净消失；改文件后不重启即可重载。

**Architecture:** daemon 侧新增 `plugin_host` 模块（名册 + 清单校验 + 本地目录导入 + 资源路由），前端新增 `core/plugins` 运行时（动态 import + 惰性 factory + 注册桥 + disposer 栈）。两端只通过既有 `/rpc` 与事件通信，桌面/浏览器同一套命令名。

**Tech Stack:** Rust（daemon：`serde` / `serde_json` / `sha2` / `walkdir`）、Vue 3 + TypeScript + Pinia + Vitest。

**设计依据：** [`../specs/2026-11-17-plugin-architecture-design.md`](../specs/2026-11-17-plugin-architecture-design.md) §5–§12、§16.2
**前置：** M0 已完成（adapter/节点定义/命令表/插件词典/能力键）。

## Global Constraints

- 插件根目录：`<config_dir>/plugins/host/`；名册文件 `plugins.json`；不得占用 `plugins/ofx/`。
- 清单文件固定名 `aicut.plugin.json`；`format` 必须为 `1`；`id` 必须与 `package.json` 的 `name` 一致（有 package.json 时）。
- 插件 id 命名：npm 包名形态（`@scope/name` 或 `name`）；本地目录导入时也用清单里的 id，不用目录名。
- 版本范围：`engines.aicut` 只支持受限语法 —— `*`、`>=x.y.z`、`>x.y.z`、`<=x.y.z`、`<x.y.z`、`=x.y.z`、`x.y.z`，可用空格或逗号连接多个条件；**不实现 `^` / `~` / `||`**。
- 失败隔离：单个插件加载失败只标记它自己 `failed`，不阻断其它插件与宿主启动。
- 资源路径：任何插件文件只能从名册记录里的目录读出，禁 `..`、禁符号链接逃逸。
- i18n：内核新增文案必须同时进 `zh.ts` 与 `en.ts`。
- 提交粒度：每任务一次 commit。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `crates/daemon/src/plugin_host/mod.rs` | 模块导出 + 事件名 |
| `crates/daemon/src/plugin_host/manifest.rs` | `aicut.plugin.json` 解析与校验 + 版本范围 |
| `crates/daemon/src/plugin_host/registry.rs` | 名册读写（原子写 + 进程内互斥） |
| `crates/daemon/src/plugin_host/linked.rs` | 本地目录导入 / 卸载 / 状态扫描 / rev |
| `crates/daemon/src/plugin_host/resource.rs` | 资源路由解析（id + 文件名 → 绝对路径，限域） |
| `crates/daemon/src/rpc.rs` | 4 个命令 |
| `crates/daemon/src/http.rs` | `/plugins/{id}/{file}` 路由 |
| `src-tauri/src/plugin_host.rs` | Tauri 薄包装 |
| `src-tauri/src/lib.rs` | `generate_handler!` 注册 |
| `src/types/pluginHost.ts` | 前端类型 |
| `src/core/pluginHostApi.ts` | invoke 封装 |
| `src/core/plugins/manifest.ts` | 前端清单类型与校验（与 Rust 同规则） |
| `src/core/plugins/loader.ts` | import + factory + 注册桥 + disposer 栈 |
| `src/core/plugins/context.ts` | 构造插件 `ctx`（nodes / commands / i18n / log） |
| `src/stores/pluginHost.ts` | 列表 / 启用 / 禁用 / 移除 / 重载 |
| `src/components/workspace/panes/ExtensionsPane.vue` | 管理面板 |
| `src/stores/layout.ts` + `RightPanel.vue` | 新面板接线 |

---

### Task 1: 清单解析与版本范围（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/mod.rs`, `crates/daemon/src/plugin_host/manifest.rs`
- Modify: `crates/daemon/src/lib.rs`（`pub mod plugin_host;`）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces:
  - `pub const MANIFEST_FILE: &str = "aicut.plugin.json";`
  - `pub struct PluginManifest { pub format: u32, pub id: String, pub version: String, pub engines: Engines, pub host: Option<String>, pub client: Option<String>, pub inject: Vec<String>, pub external: Vec<String>, pub capabilities: serde_json::Value }`
  - `pub fn parse_manifest(text: &str) -> Result<PluginManifest, String>`
  - `pub fn version_matches(range: &str, version: &str) -> Result<bool, String>`

- [ ] **Step 1: 写失败测试**

```rust
// crates/daemon/src/plugin_host/manifest.rs 末尾
#[cfg(test)]
mod tests {
    use super::*;

    fn text(id: &str, version: &str, engines: &str) -> String {
        format!(
            r#"{{"format":1,"id":"{id}","version":"{version}","engines":{{"aicut":"{engines}"}},
                "client":"./client.js"}}"#
        )
    }

    #[test]
    fn parses_a_minimal_manifest() {
        let manifest = parse_manifest(&text("@demo/x", "0.1.0", ">=1.3.0")).unwrap();
        assert_eq!(manifest.id, "@demo/x");
        assert_eq!(manifest.client.as_deref(), Some("./client.js"));
        assert!(manifest.host.is_none());
    }

    #[test]
    fn rejects_unknown_format() {
        let raw = r#"{"format":2,"id":"a","version":"1.0.0"}"#;
        assert!(parse_manifest(raw).unwrap_err().contains("format"));
    }

    #[test]
    fn rejects_missing_id_or_version() {
        assert!(parse_manifest(r#"{"format":1,"version":"1.0.0"}"#).is_err());
        assert!(parse_manifest(r#"{"format":1,"id":"a"}"#).is_err());
    }

    #[test]
    fn rejects_bad_version() {
        assert!(parse_manifest(&text("a", "1.0", "*")).is_err());
        assert!(parse_manifest(&text("a", "abc", "*")).is_err());
    }

    #[test]
    fn matches_restricted_ranges() {
        assert!(version_matches("*", "1.2.3").unwrap());
        assert!(version_matches(">=1.3.0", "1.3.0").unwrap());
        assert!(version_matches(">=1.3.0 <2.0.0", "1.9.9").unwrap());
        assert!(!version_matches(">=1.3.0 <2.0.0", "2.0.0").unwrap());
        assert!(version_matches("=1.2.3", "1.2.3").unwrap());
        assert!(!version_matches("=1.2.3", "1.2.4").unwrap());
        assert!(version_matches(">=1.2.0, <1.3.0", "1.2.5").unwrap());
    }

    #[test]
    fn rejects_unsupported_range_syntax() {
        assert!(version_matches("^1.2.0", "1.2.3").is_err());
        assert!(version_matches("~1.2.0", "1.2.3").is_err());
        assert!(version_matches("1.x", "1.2.3").is_err());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::manifest`
Expected: 编译失败 —— `plugin_host` 模块不存在

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/mod.rs
//! 画布插件宿主：名册、清单校验、本地导入、资源路由。
//!
//! 与 `plugins` 模块（OFX）互不干扰：OFX 在 `plugins/ofx/`，这里在 `plugins/host/`。

pub mod manifest;

/// 插件宿主进度事件（安装 / 重载）。
pub const EVENT_PLUGIN_HOST: &str = "plugin-host-progress";
```

```rust
// crates/daemon/src/plugin_host/manifest.rs
use serde::Deserialize;

pub const MANIFEST_FILE: &str = "aicut.plugin.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Engines {
    pub aicut: String,
}

impl Default for Engines {
    fn default() -> Self {
        Self { aicut: "*".to_string() }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PluginManifest {
    pub format: u32,
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub engines: Engines,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default)]
    pub inject: Vec<String>,
    #[serde(default)]
    pub external: Vec<String>,
    #[serde(default)]
    pub capabilities: serde_json::Value,
}

/// 解析并校验清单。
pub fn parse_manifest(text: &str) -> Result<PluginManifest, String> {
    let manifest: PluginManifest = serde_json::from_str(text)
        .map_err(|error| format!("清单不是合法 JSON：{error}"))?;
    if manifest.format != 1 {
        return Err(format!("清单 format 必须是 1，实际是 {}", manifest.format));
    }
    if manifest.id.trim().is_empty() {
        return Err("清单缺少 id".to_string());
    }
    if manifest.client.is_none() && manifest.host.is_none() {
        return Err(format!("{} 既没有 client 也没有 host 产物", manifest.id));
    }
    parse_version(&manifest.version)?;
    Ok(manifest)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(u64, u64, u64);

fn parse_version(text: &str) -> Result<Version, String> {
    let core = text.split(['-', '+']).next().unwrap_or(text);
    let mut parts = core.split('.');
    let mut next = || -> Result<u64, String> {
        parts
            .next()
            .ok_or_else(|| format!("版本号 {text} 不是 x.y.z"))?
            .parse::<u64>()
            .map_err(|_| format!("版本号 {text} 不是 x.y.z"))
    };
    let major = next()?;
    let minor = next()?;
    let patch = next()?;
    if parts.next().is_some() {
        return Err(format!("版本号 {text} 不是 x.y.z"));
    }
    Ok(Version(major, minor, patch))
}

/// 受限版本范围：`*` / `>=` `>` `<=` `<` `=` + x.y.z，空格或逗号分隔多个条件。
pub fn version_matches(range: &str, version: &str) -> Result<bool, String> {
    let target = parse_version(version)?;
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Ok(true);
    }
    for clause in range.split([',', ' ']).filter(|item| !item.trim().is_empty()) {
        let clause = clause.trim();
        let (op, rest) = if let Some(rest) = clause.strip_prefix(">=") {
            (">=", rest)
        } else if let Some(rest) = clause.strip_prefix("<=") {
            ("<=", rest)
        } else if let Some(rest) = clause.strip_prefix('>') {
            (">", rest)
        } else if let Some(rest) = clause.strip_prefix('<') {
            ("<", rest)
        } else if let Some(rest) = clause.strip_prefix('=') {
            ("=", rest)
        } else if clause.starts_with('^') || clause.starts_with('~') || clause.contains('x') {
            return Err(format!("不支持的版本范围写法：{clause}"));
        } else {
            ("=", clause)
        };
        let bound = parse_version(rest.trim())?;
        let ok = match op {
            ">=" => target >= bound,
            ">" => target > bound,
            "<=" => target <= bound,
            "<" => target < bound,
            _ => target == bound,
        };
        if !ok {
            return Ok(false);
        }
    }
    Ok(true)
}
```

`crates/daemon/src/lib.rs` 加 `pub mod plugin_host;`（按字母序放在 `plugins` 附近）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::manifest`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host crates/daemon/src/lib.rs
git commit -m "feat(plugin-host): 清单解析与受限版本范围"
```

---

### Task 2: 名册读写（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/registry.rs`
- Modify: `crates/daemon/src/plugin_host/mod.rs`
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: Task 1 的 `PluginManifest`
- Produces:
  - `pub struct PluginRecord { pub id: String, pub version: String, pub kind: String, pub path: Option<String>, pub enabled: bool, pub installed_at: u64, pub updated_at: u64, pub last_error: Option<String> }`（`Serialize` + `Deserialize`，字段 camelCase）
  - `pub struct Registry { pub format: u32, pub plugins: Vec<PluginRecord> }`
  - `pub fn registry_path(root: &Path) -> PathBuf`
  - `pub fn load(root: &Path) -> Result<Registry, String>`
  - `pub fn save(root: &Path, registry: &Registry) -> Result<(), String>`（临时文件 + rename）
  - `pub fn upsert(registry: &mut Registry, record: PluginRecord) -> Result<(), String>`（同 id 冲突报错）
  - `pub fn set_enabled(registry: &mut Registry, id: &str, enabled: bool) -> Result<(), String>`
  - `pub fn remove(registry: &mut Registry, id: &str) -> Result<PluginRecord, String>`

- [ ] **Step 1: 写失败测试**

```rust
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
        assert!(upsert(&mut registry, record("@demo/a")).unwrap_err().contains("@demo/a"));
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::registry`
Expected: 编译失败 —— 模块不存在

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/registry.rs
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::manifest::parse_manifest;

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
    /// 仅 `linked` 持久化绝对路径。
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
        Self { format: 1, plugins: Vec::new() }
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
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("读插件名册失败：{error}"))?;
    let mut registry: Registry = serde_json::from_str(&text)
        .map_err(|error| format!("插件名册不是合法 JSON：{error}"))?;
    if registry.format != 1 {
        return Err(format!("插件名册 format 必须是 1，实际是 {}", registry.format));
    }
    registry.plugins.retain(|record| {
        // 丢掉坏记录不如保留并标记：这里只做最小清理（id 为空的行）。
        !record.id.trim().is_empty()
    });
    Ok(registry)
}

pub fn save(root: &Path, registry: &Registry) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "插件名册锁被污染".to_string())?;
    std::fs::create_dir_all(root).map_err(|error| format!("创建插件目录失败：{error}"))?;
    let path = registry_path(root);
    let temp = root.join(format!("{REGISTRY_FILE}.tmp"));
    let text = serde_json::to_string_pretty(registry)
        .map_err(|error| format!("序列化插件名册失败：{error}"))?;
    std::fs::write(&temp, text).map_err(|error| format!("写临时名册失败：{error}"))?;
    std::fs::rename(&temp, &path).map_err(|error| format!("替换名册失败：{error}"))?;
    Ok(())
}

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
```

（`parse_manifest` 的 import 留给 Task 3 使用；若本任务暂时未用到，先删掉该 `use` 以免警告。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::registry`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host
git commit -m "feat(plugin-host): 名册读写（原子写 + 冲突拒绝）"
```

---

### Task 3: 本地目录导入与状态扫描（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/linked.rs`
- Modify: `crates/daemon/src/plugin_host/mod.rs`（`pub mod linked;`）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: Task 1 `parse_manifest` / `version_matches`，Task 2 `PluginRecord`
- Produces:
  - `pub struct PluginStatus { pub id: String, pub version: String, pub kind: String, pub enabled: bool, pub dir: String, pub client: Option<String>, pub host_file: Option<String>, pub rev: String, pub compatible: bool, pub last_error: Option<String> }`（camelCase）
  - `pub fn install_linked(root: &Path, dir: &Path, app_version: &str) -> Result<PluginRecord, String>`
  - `pub fn scan(root: &Path, record: &PluginRecord, app_version: &str) -> PluginStatus`
  - `pub fn read_manifest(dir: &Path) -> Result<(PluginManifest, String), String>`（返回清单与原始文本）

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_plugin(dir: &Path, id: &str, version: &str, engines: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("aicut.plugin.json"),
            format!(
                r#"{{"format":1,"id":"{id}","version":"{version}","engines":{{"aicut":"{engines}"}},"client":"./client.js"}}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("client.js"), "export default {}").unwrap();
        std::fs::write(dir.join("package.json"), format!(r#"{{"name":"{id}"}}"#)).unwrap();
    }

    #[test]
    fn installs_a_linked_plugin_and_records_its_path() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        write_plugin(source.path(), "@demo/linked", "0.1.0", ">=1.3.0");
        let record = install_linked(root.path(), source.path(), "1.4.0").unwrap();
        assert_eq!(record.id, "@demo/linked");
        assert_eq!(record.kind, "linked");
        assert_eq!(record.path.as_deref(), Some(source.path().to_str().unwrap()));
        assert!(record.enabled);
    }

    #[test]
    fn rejects_a_directory_without_a_manifest() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        let error = install_linked(root.path(), source.path(), "1.4.0").unwrap_err();
        assert!(error.contains("aicut.plugin.json"));
    }

    #[test]
    fn rejects_a_mismatched_package_name() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        write_plugin(source.path(), "@demo/a", "0.1.0", "*");
        std::fs::write(
            source.path().join("package.json"),
            r#"{"name":"@demo/other"}"#,
        )
        .unwrap();
        let error = install_linked(root.path(), source.path(), "1.4.0").unwrap_err();
        assert!(error.contains("@demo/a"));
    }

    #[test]
    fn scan_reports_incompatible_engines_without_failing() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        write_plugin(source.path(), "@demo/old", "0.1.0", "<1.0.0");
        let record = install_linked(root.path(), source.path(), "1.4.0").unwrap();
        let status = scan(root.path(), &record, "1.4.0");
        assert!(!status.compatible);
        assert!(status.rev.contains("0.1.0"));
    }

    #[test]
    fn scan_marks_a_missing_directory_as_an_error() {
        let root = TempDir::new().unwrap();
        let record = PluginRecord {
            id: "@demo/gone".into(),
            version: "0.1.0".into(),
            kind: "linked".into(),
            path: Some("/definitely/not/here".into()),
            enabled: true,
            installed_at: 1,
            updated_at: 1,
            last_error: None,
        };
        let status = scan(root.path(), &record, "1.4.0");
        assert!(status.last_error.is_some());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::linked`
Expected: 编译失败

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/linked.rs
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::manifest::{parse_manifest, version_matches, PluginManifest, MANIFEST_FILE};
use super::registry::{now_secs, PluginRecord};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub id: String,
    pub version: String,
    pub kind: String,
    pub enabled: bool,
    pub dir: String,
    pub client: Option<String>,
    pub host_file: Option<String>,
    /// 版本 + 入口 mtime：前端据此判断是否需要热替换。
    pub rev: String,
    pub compatible: bool,
    pub last_error: Option<String>,
}

pub fn read_manifest(dir: &Path) -> Result<(PluginManifest, String), String> {
    let path = dir.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(format!("缺少 {MANIFEST_FILE}：{}", dir.display()));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("读 {MANIFEST_FILE} 失败：{error}"))?;
    let manifest = parse_manifest(&text)?;
    // 有 package.json 时，id 必须与 name 一致（防止「装的是 A、清单说 B」）。
    let package = dir.join("package.json");
    if package.is_file() {
        if let Ok(text) = std::fs::read_to_string(&package) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(name) = value.get("name").and_then(|item| item.as_str()) {
                    if name != manifest.id {
                        return Err(format!(
                            "清单 id（{}）与 package.json name（{name}）不一致",
                            manifest.id
                        ));
                    }
                }
            }
        }
    }
    Ok((manifest, text))
}

pub fn install_linked(
    _root: &Path,
    dir: &Path,
    app_version: &str,
) -> Result<PluginRecord, String> {
    let dir = std::fs::canonicalize(dir)
        .map_err(|error| format!("插件目录不可用：{error}"))?;
    let (manifest, _) = read_manifest(&dir)?;
    let compatible = version_matches(&manifest.engines.aicut, app_version)?;
    let now = now_secs();
    Ok(PluginRecord {
        id: manifest.id.clone(),
        version: manifest.version.clone(),
        kind: "linked".to_string(),
        path: Some(dir.to_string_lossy().into_owned()),
        enabled: true,
        installed_at: now,
        updated_at: now,
        last_error: if compatible {
            None
        } else {
            Some(format!(
                "需要 AI Cut {}，当前 {app_version}",
                manifest.engines.aicut
            ))
        },
    })
}

pub fn scan(_root: &Path, record: &PluginRecord, app_version: &str) -> PluginStatus {
    let mut status = PluginStatus {
        id: record.id.clone(),
        version: record.version.clone(),
        kind: record.kind.clone(),
        enabled: record.enabled,
        dir: String::new(),
        client: None,
        host_file: None,
        rev: record.version.clone(),
        compatible: true,
        last_error: record.last_error.clone(),
    };
    let Some(dir) = record.path.as_deref().map(PathBuf::from) else {
        status.last_error = Some("记录里没有目录".to_string());
        return status;
    };
    status.dir = dir.to_string_lossy().into_owned();
    match read_manifest(&dir) {
        Ok((manifest, _)) => {
            status.version = manifest.version.clone();
            status.compatible = version_matches(&manifest.engines.aicut, app_version).unwrap_or(false);
            status.client = manifest.client.as_ref().map(|name| file_in(&dir, name));
            status.host_file = manifest.host.as_ref().map(|name| file_in(&dir, name));
            status.rev = format!("{}-{}", manifest.version, mtime_token(&dir, &manifest));
            if !status.compatible && status.last_error.is_none() {
                status.last_error = Some(format!("需要 AI Cut {}", manifest.engines.aicut));
            }
        }
        Err(error) => status.last_error = Some(error),
    }
    status
}

fn file_in(dir: &Path, name: &str) -> String {
    let path = dir.join(name.trim_start_matches("./"));
    path.to_string_lossy().into_owned()
}

/// 入口文件（client 优先）的 mtime 毫秒 + 版本：任何入口改动都会换 rev。
fn mtime_token(dir: &Path, manifest: &PluginManifest) -> u128 {
    let entry = manifest
        .client
        .as_deref()
        .or(manifest.host.as_deref())
        .map(|name| dir.join(name.trim_start_matches("./")));
    entry
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or(0)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::linked`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host
git commit -m "feat(plugin-host): 本地目录导入与状态扫描"
```

---

### Task 4: RPC 命令 + 前端 API

**Files:**
- Create: `crates/daemon/src/plugin_host/service.rs`
- Modify: `crates/daemon/src/plugin_host/mod.rs`、`crates/daemon/src/rpc.rs`（dispatch 里加 4 个 arm）
- Create: `src/types/pluginHost.ts`、`src/core/pluginHostApi.ts`
- Modify: `src-tauri/src/plugin_host.rs`（新建）、`src-tauri/src/lib.rs`（mod + generate_handler）
- Test: `src/core/__tests__/pluginHostApi.test.ts`（用 mock invoke 验证参数名）

**Interfaces:**
- Produces（RPC 名）：
  - `plugin_host_list` → `{ plugins: PluginStatus[] }`
  - `plugin_host_install_local`（参数 `{ path: string }`）→ `PluginStatus`
  - `plugin_host_set_enabled`（`{ id: string, enabled: boolean }`）→ `{ plugins: PluginStatus[] }`
  - `plugin_host_remove`（`{ id: string }`）→ `{ plugins: PluginStatus[] }`
- 前端：`pluginHostList()` / `pluginHostInstallLocal(path)` / `pluginHostSetEnabled(id, enabled)` / `pluginHostRemove(id)` / `onPluginHostProgress(handler)`

- [ ] **Step 1: 写失败测试（前端参数名契约）**

```ts
// src/core/__tests__/pluginHostApi.test.ts
import { describe, expect, it, vi } from "vitest";

const invoked: { cmd: string; args?: Record<string, unknown> }[] = [];
vi.mock("@/platform/tauri", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    if (cmd === "plugin_host_list") return { plugins: [] };
    return { plugins: [{ id: "@demo/x" }] };
  },
  listen: async () => () => {},
}));

import { pluginHostInstallLocal, pluginHostList, pluginHostSetEnabled } from "../pluginHostApi";

describe("plugin host api", () => {
  it("calls the list command without arguments", async () => {
    await pluginHostList();
    expect(invoked.at(-1)).toEqual({ cmd: "plugin_host_list", args: undefined });
  });

  it("passes the directory path when installing", async () => {
    await pluginHostInstallLocal("/tmp/plugin");
    expect(invoked.at(-1)).toEqual({
      cmd: "plugin_host_install_local",
      args: { path: "/tmp/plugin" },
    });
  });

  it("passes id and enabled when toggling", async () => {
    await pluginHostSetEnabled("@demo/x", false);
    expect(invoked.at(-1)).toEqual({
      cmd: "plugin_host_set_enabled",
      args: { id: "@demo/x", enabled: false },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/__tests__/pluginHostApi.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写 Rust 服务层与 RPC**

```rust
// crates/daemon/src/plugin_host/service.rs
use std::path::{Path, PathBuf};

use crate::host::Host;

use super::linked::{install_linked, scan, PluginStatus};
use super::registry::{self, load, remove, save, set_enabled, upsert};

pub fn root(host: &dyn Host) -> PathBuf {
    host.config_dir().join("plugins").join("host")
}

pub fn list(host: &dyn Host, app_version: &str) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let registry = load(&root)?;
    let expected = app_version.to_string();
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(Path::new(&root), record, &expected))
        .collect())
}

pub fn install_local(
    host: &dyn Host,
    source: &Path,
    app_version: &str,
) -> Result<PluginStatus, String> {
    let root = root(host);
    let record = install_linked(&root, source, app_version)?;
    let status = scan(&root, &record, app_version);
    let mut registry = load(&root)?;
    upsert(&mut registry, record.clone())?;
    save(&root, &registry)?;
    Ok(status)
}

pub fn toggle(host: &dyn Host, id: &str, enabled: bool) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let mut registry = load(&root)?;
    set_enabled(&mut registry, id, enabled)?;
    save(&root, &registry)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(Path::new(&root), record, crate::VERSION))
        .collect())
}

pub fn forget(host: &dyn Host, id: &str) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let mut registry = load(&root)?;
    remove(&mut registry, id)?;
    save(&root, &registry)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(Path::new(&root), record, crate::VERSION))
        .collect())
}
```

`rpc.rs` 的 dispatch 里（紧跟 `plugin_installed` 之后）加：

```rust
        "plugin_host_list" => Ok(json!({
            "plugins": crate::plugin_host::service::list(&ctx.host, crate::VERSION)?
        })),
        "plugin_host_install_local" => {
            #[derive(serde::Deserialize)]
            struct Args {
                path: String,
            }
            let args: Args = from_value(args)?;
            Ok(json!({
                "plugin": crate::plugin_host::service::install_local(
                    &ctx.host,
                    std::path::Path::new(&args.path),
                    crate::VERSION,
                )?
            }))
        }
        "plugin_host_set_enabled" => {
            #[derive(serde::Deserialize)]
            struct Args {
                id: String,
                enabled: bool,
            }
            let args: Args = from_value(args)?;
            Ok(json!({
                "plugins": crate::plugin_host::service::toggle(&ctx.host, &args.id, args.enabled)?
            }))
        }
        "plugin_host_remove" => {
            #[derive(serde::Deserialize)]
            struct Args {
                id: String,
            }
            let args: Args = from_value(args)?;
            Ok(json!({
                "plugins": crate::plugin_host::service::forget(&ctx.host, &args.id)?
            }))
        }
```

`plugin_host/mod.rs` 增加 `pub mod service;`。`crate::VERSION` 若不存在，用 `ctx.version`：把 `toggle`/`forget` 改成接收 `app_version: &str` 参数，由 `rpc.rs` 传 `&ctx.version`。

- [ ] **Step 4: 写前端 API 与类型**

```ts
// src/types/pluginHost.ts
export interface PluginStatus {
  id: string;
  version: string;
  /** `linked`（本地目录）或 `store`（托管安装）。 */
  kind: "linked" | "store";
  enabled: boolean;
  dir: string;
  /** 客户端入口绝对路径；无客户端半时为 null。 */
  client: string | null;
  /** 宿主半入口绝对路径；无宿主半时为 null。 */
  hostFile: string | null;
  /** 版本 + 入口 mtime；变化即需要热替换。 */
  rev: string;
  compatible: boolean;
  lastError: string | null;
}

export interface PluginHostProgress {
  id: string;
  phase: "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "loading" | "done" | "error";
  message: string | null;
}
```

```ts
// src/core/pluginHostApi.ts
import { invoke, listen, type UnlistenFn } from "@/platform/tauri";
import type { PluginHostProgress, PluginStatus } from "@/types/pluginHost";

export async function pluginHostList(): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_list");
  return result.plugins;
}

export async function pluginHostInstallLocal(path: string): Promise<PluginStatus> {
  const result = await invoke<{ plugin: PluginStatus }>("plugin_host_install_local", { path });
  return result.plugin;
}

export async function pluginHostSetEnabled(id: string, enabled: boolean): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_set_enabled", { id, enabled });
  return result.plugins;
}

export async function pluginHostRemove(id: string): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_remove", { id });
  return result.plugins;
}

export function onPluginHostProgress(
  handler: (progress: PluginHostProgress) => void,
): Promise<UnlistenFn> {
  return listen<PluginHostProgress>("plugin-host-progress", (event) => handler(event.payload));
}
```

`src-tauri/src/plugin_host.rs` 四个 `#[tauri::command]` 薄包装（照 `src-tauri/src/plugins.rs` 的 `host_of(&app)` 写法），并在 `src-tauri/src/lib.rs` 加 `mod plugin_host;` 与 `generate_handler![...]` 四项。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/core/__tests__/pluginHostApi.test.ts && cargo test --manifest-path crates/daemon/Cargo.toml plugin_host`
Expected: 前端 3 passed；Rust 全绿

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src src-tauri/src src/types/pluginHost.ts src/core/pluginHostApi.ts src/core/__tests__/pluginHostApi.test.ts
git commit -m "feat(plugin-host): 名册 RPC 与前端 API"
```

---

### Task 5: 资源路由（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/resource.rs`
- Modify: `crates/daemon/src/http.rs`（加路由）、`crates/daemon/src/rpc.rs`（handler）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn resolve(root: &Path, registry: &Registry, id: &str, file: &str) -> Result<PathBuf, String>`

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::registry::PluginRecord;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Registry) {
        let root = TempDir::new().unwrap();
        let plugin = root.path().join("demo");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("client.js"), "export default {}").unwrap();
        let mut registry = Registry::default();
        registry.plugins.push(PluginRecord {
            id: "@demo/x".into(),
            version: "0.1.0".into(),
            kind: "linked".into(),
            path: Some(plugin.to_string_lossy().into_owned()),
            enabled: true,
            installed_at: 1,
            updated_at: 1,
            last_error: None,
        });
        (root, registry)
    }

    #[test]
    fn resolves_a_file_inside_the_plugin_dir() {
        let (root, registry) = setup();
        let path = resolve(root.path(), &registry, "@demo/x", "client.js").unwrap();
        assert!(path.ends_with("client.js"));
    }

    #[test]
    fn rejects_unknown_plugins() {
        let (root, registry) = setup();
        assert!(resolve(root.path(), &registry, "@nope/x", "client.js").is_err());
    }

    #[test]
    fn rejects_traversal() {
        let (root, registry) = setup();
        assert!(resolve(root.path(), &registry, "@demo/x", "../secret").is_err());
        assert!(resolve(root.path(), &registry, "@demo/x", "..%2Fsecret").is_err());
    }

    #[test]
    fn rejects_missing_files() {
        let (root, registry) = setup();
        assert!(resolve(root.path(), &registry, "@demo/x", "nope.js").is_err());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::resource`
Expected: 编译失败

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/resource.rs
use std::path::{Component, Path, PathBuf};

use super::registry::Registry;

/// 把 `(插件 id, 文件名)` 解析成绝对路径；只允许落在该插件自己的目录里。
pub fn resolve(
    _root: &Path,
    registry: &Registry,
    id: &str,
    file: &str,
) -> Result<PathBuf, String> {
    let record = registry
        .plugins
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("未安装的插件：{id}"))?;
    let dir = record
        .path
        .as_deref()
        .ok_or_else(|| format!("插件 {id} 没有可读目录"))?;
    let dir = std::fs::canonicalize(dir).map_err(|error| format!("插件目录不可用：{error}"))?;

    let decoded = percent_decode(file);
    // 只允许单段文件名：多段、`.`、`..` 一律拒绝。
    let relative = Path::new(&decoded);
    let mut parts = relative.components();
    let only = parts.next();
    if parts.next().is_some() {
        return Err("插件资源只能是单层文件名".to_string());
    }
    match only {
        Some(Component::Normal(name)) => {
            let path = dir.join(name);
            if !path.starts_with(&dir) || !path.is_file() {
                return Err(format!("插件资源不存在：{file}"));
            }
            Ok(path)
        }
        _ => Err("插件资源路径不合法".to_string()),
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
```

`http.rs` 加路由 `.route("/plugins/{id}/{file}", get(crate::rpc::plugin_file))`；`rpc.rs` 的 handler 读 `registry::load(&plugin_host::service::root(&ctx.host))`，再 `resource::resolve`，用 `ServeFile` 返回；`Content-Type` 按扩展名给 `text/javascript`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::resource`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host crates/daemon/src/http.rs crates/daemon/src/rpc.rs
git commit -m "feat(plugin-host): 插件资源路由（限域 + 拒穿越）"
```

---

### Task 6: 前端清单镜像与模块表（TS）

**Files:**
- Create: `src/core/plugins/manifest.ts`
- Test: `src/core/plugins/__tests__/manifest.test.ts`

**Interfaces:**
- Produces:
  - `interface PluginManifest { format: number; id: string; version: string; client?: string; host?: string; engines: { aicut: string }; inject: string[]; external: string[] }`
  - `parseManifest(raw: unknown): PluginManifest`（非法抛错，消息含字段名）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { parseManifest } from "../manifest";

const good = {
  format: 1,
  id: "@demo/x",
  version: "0.1.0",
  client: "./client.js",
  engines: { aicut: ">=1.3.0" },
};

describe("plugin manifest", () => {
  it("accepts a valid manifest", () => {
    expect(parseManifest(good).id).toBe("@demo/x");
  });

  it("rejects unsupported format", () => {
    expect(() => parseManifest({ ...good, format: 2 })).toThrow(/format/);
  });

  it("rejects missing id", () => {
    expect(() => parseManifest({ ...good, id: "" })).toThrow(/id/);
  });

  it("rejects a manifest with neither half", () => {
    const { client: _client, ...rest } = good;
    expect(() => parseManifest(rest)).toThrow(/client/);
  });

  it("defaults inject and external to empty arrays", () => {
    const parsed = parseManifest(good);
    expect(parsed.inject).toEqual([]);
    expect(parsed.external).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/plugins/__tests__/manifest.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写实现**

```ts
// src/core/plugins/manifest.ts
/**
 * 插件清单的前端镜像。
 *
 * 规则与 `crates/daemon/src/plugin_host/manifest.rs` 一致；这里只负责
 * 「加载前先自查一遍」和给 UI 提供类型，真正的准入仍以 daemon 为准。
 */
export interface PluginManifest {
  format: number;
  id: string;
  version: string;
  client?: string;
  host?: string;
  engines: { aicut: string };
  inject: string[];
  external: string[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`清单字段 ${field} 必须是非空字符串`);
  return value;
}

export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("清单必须是对象");
  const value = raw as Record<string, unknown>;
  if (value.format !== 1) throw new Error(`清单 format 必须是 1，实际是 ${String(value.format)}`);
  const id = asString(value.id, "id");
  const version = asString(value.version, "version");
  const client = typeof value.client === "string" && value.client ? value.client : undefined;
  const host = typeof value.host === "string" && value.host ? value.host : undefined;
  if (!client && !host) throw new Error(`清单 ${id} 既没有 client 也没有 host`);
  const engines = value.engines as { aicut?: unknown } | undefined;
  return {
    format: 1,
    id,
    version,
    client,
    host,
    engines: { aicut: typeof engines?.aicut === "string" ? engines.aicut : "*" },
    inject: Array.isArray(value.inject) ? value.inject.filter((item): item is string => typeof item === "string") : [],
    external: Array.isArray(value.external)
      ? value.external.filter((item): item is string => typeof item === "string")
      : [],
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/core/plugins/__tests__/manifest.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/core/plugins
git commit -m "feat(plugins): 清单前端镜像与校验"
```

---

### Task 7: 加载器、注册桥与 disposer 栈（TS）

**Files:**
- Create: `src/core/plugins/loader.ts`、`src/core/plugins/context.ts`
- Test: `src/core/plugins/__tests__/loader.test.ts`

**Interfaces:**
- Consumes: `registerNodeDefinition`（M0）、`registerAdapter`（M0）、`registerCommand`（M0）、`registerPluginMessages`（M0）
- Produces:
  - `interface PluginClientModule { id: string; apply(ctx: PluginContext): void | (() => void) }`
  - `interface PluginContext { id: string; nodes: { register(def, run): void }; commands: { register(spec): void }; i18n: { register(dicts): void }; log(message: string): void }`
  - `loadPluginModule(entry: { id: string; url: string }, module: PluginClientModule): { dispose(): void }`
  - `disposeAll(): void`

- [ ] **Step 1: 写失败测试**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "@/core/board/adapters";
import { nodeDefinition } from "@/core/board/registry";
import { commandFor } from "@/core/commandTable";
import { disposeAll, loadPluginModule } from "../loader";
import type { PluginClientModule } from "../loader";

const def = {
  type: "ext.demo.hello",
  titleKey: "@demo.hello",
  category: "model" as const,
  order: 999,
  inputs: [],
  outputs: [{ id: "out", type: "text" as const, labelKey: "@demo.out" }],
  params: [],
  defaultSize: { width: 300, height: 180 },
  cost: { lane: "api" as const },
};

function plugin(): PluginClientModule {
  return {
    id: "@demo/x",
    apply(ctx) {
      ctx.nodes.register(def, async () => ({ text: "hi" }));
      ctx.commands.register({ id: "ext.demo.run", titleKey: "@demo.cmd", run: () => {} });
      ctx.i18n.register({ zh: { hello: "你好" }, en: { hello: "Hello" } });
    },
  };
}

afterEach(() => disposeAll());

describe("plugin loader", () => {
  it("registers nodes, adapters, commands and messages", () => {
    const loaded = loadPluginModule({ id: "@demo/x", url: "memory:" }, plugin());
    expect(nodeDefinition("ext.demo.hello")).not.toBeNull();
    expect(adapterFor("ext.demo.hello")).not.toBeNull();
    expect(commandFor("ext.demo.run")).not.toBeNull();
    loaded.dispose();
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
    expect(adapterFor("ext.demo.hello")).toBeNull();
    expect(commandFor("ext.demo.run")).toBeNull();
  });

  it("rejects a module whose id does not match the entry", () => {
    expect(() => loadPluginModule({ id: "@demo/y", url: "memory:" }, plugin())).toThrow(/@demo\/x/);
  });

  it("rolls back half-applied registrations when apply throws", () => {
    const broken: PluginClientModule = {
      id: "@demo/broken",
      apply(ctx) {
        ctx.nodes.register(def, async () => ({}));
        throw new Error("boom");
      },
    };
    expect(() => loadPluginModule({ id: "@demo/broken", url: "memory:" }, broken)).toThrow(/boom/);
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
  });

  it("disposeAll clears every loaded plugin", () => {
    loadPluginModule({ id: "@demo/x", url: "memory:" }, plugin());
    disposeAll();
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/plugins/__tests__/loader.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写实现**

```ts
// src/core/plugins/context.ts
import { registerAdapter, type AdapterFn } from "@/core/board/adapters";
import { registerNodeDefinition } from "@/core/board/registry";
import { registerCommand, type CommandSpec } from "@/core/commandTable";
import { registerPluginMessages } from "@/i18n/translate";
import type { BoardNodeDefinition } from "@/types/board";
import type { Locale } from "@/i18n/translate";

/** 插件能用的注册面。每个 register 都往 disposer 栈里压一条。 */
export interface PluginContext {
  id: string;
  nodes: { register(definition: BoardNodeDefinition, run: AdapterFn): void };
  commands: { register(spec: CommandSpec): void };
  i18n: { register(dicts: Partial<Record<Locale, Record<string, string>>>): void };
  log(message: string): void;
}

export function createPluginContext(pluginId: string, push: (dispose: () => void) => void): PluginContext {
  return {
    id: pluginId,
    nodes: {
      register(definition, run) {
        push(registerNodeDefinition(definition, pluginId));
        push(registerAdapter(definition.type, run, pluginId));
      },
    },
    commands: {
      register(spec) {
        push(registerCommand({ ...spec, owner: spec.owner ?? pluginId }));
      },
    },
    i18n: {
      register(dicts) {
        push(registerPluginMessages(pluginId, dicts));
      },
    },
    log(message) {
      console.info(`[plugin ${pluginId}] ${message}`);
    },
  };
}
```

```ts
// src/core/plugins/loader.ts
import { createPluginContext, type PluginContext } from "./context";

export interface PluginClientModule {
  id: string;
  apply(ctx: PluginContext): void | (() => void);
}

interface Loaded {
  id: string;
  dispose(): void;
}

const LOADED = new Map<string, Loaded>();

/**
 * 把已 import 的模块挂进内核。
 *
 * 顺序纪律：先建 disposer 栈 → 再 apply → 失败时逆序回滚（半装载的节点 /
 * 命令不许留在内核里）。
 */
export function loadPluginModule(
  entry: { id: string; url: string },
  module: PluginClientModule,
): Loaded {
  const id = module.id;
  if (id !== entry.id) {
    throw new Error(`插件模块 id（${id}）与清单 id（${entry.id}）不一致`);
  }
  if (LOADED.has(id)) throw new Error(`插件 ${id} 已经加载过`);
  const stack: (() => void)[] = [];
  const ctx = createPluginContext(id, (dispose) => stack.push(dispose));
  let cleanup: (() => void) | undefined;
  try {
    cleanup = module.apply(ctx) ?? undefined;
  } catch (error) {
    for (const dispose of stack.reverse()) dispose();
    throw error;
  }
  if (cleanup) stack.push(cleanup);
  const loaded: Loaded = {
    id,
    dispose() {
      for (const dispose of stack.reverse()) dispose();
      LOADED.delete(id);
    },
  };
  LOADED.set(id, loaded);
  return loaded;
}

export function disposeAll(): void {
  for (const loaded of [...LOADED.values()]) loaded.dispose();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/core/plugins/__tests__/loader.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/core/plugins
git commit -m "feat(plugins): 注册桥与 disposer 栈（半装载可回滚）"
```

---

### Task 8: 插件宿主 store（TS）

**Files:**
- Create: `src/stores/pluginHost.ts`
- Test: `src/stores/__tests__/pluginHost.test.ts`

**Interfaces:**
- Consumes: `pluginHostApi`（Task 4）、`loadPluginModule`（Task 7）
- Produces: `usePluginHostStore()` 返回 `{ plugins, loading, error, refresh(), loadEnabled(), setEnabled(id, enabled), remove(id), installLocal(path) }`

- [ ] **Step 1: 写失败测试（mock API 与 loader）**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const list = vi.fn();
const setEnabled = vi.fn();
vi.mock("@/core/pluginHostApi", () => ({
  pluginHostList: () => list(),
  pluginHostSetEnabled: (...args: unknown[]) => setEnabled(...args),
  pluginHostRemove: vi.fn(),
  pluginHostInstallLocal: vi.fn(),
  onPluginHostProgress: vi.fn(),
}));

const dispose = vi.fn();
const loadPluginModule = vi.fn(() => ({ id: "@demo/x", dispose }));
vi.mock("@/core/plugins/loader", () => ({ loadPluginModule, disposeAll: vi.fn() }));

import { usePluginHostStore } from "../pluginHost";

const enabled = {
  id: "@demo/x",
  version: "0.1.0",
  kind: "linked" as const,
  enabled: true,
  dir: "/tmp/x",
  client: "/tmp/x/client.js",
  hostFile: null,
  rev: "0.1.0-1",
  compatible: true,
  lastError: null,
};

beforeEach(() => {
  setActivePinia(createPinia());
  list.mockReset();
  setEnabled.mockReset();
  dispose.mockReset();
  loadPluginModule.mockClear();
});

describe("plugin host store", () => {
  it("refreshes the list from the daemon", async () => {
    list.mockResolvedValue([enabled]);
    const store = usePluginHostStore();
    await store.refresh();
    expect(store.plugins).toHaveLength(1);
  });

  it("loads enabled plugins with a resolvable URL", async () => {
    list.mockResolvedValue([enabled]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    expect(loadPluginModule).toHaveBeenCalledOnce();
  });

  it("skips incompatible plugins and records why", async () => {
    list.mockResolvedValue([{ ...enabled, compatible: false, lastError: "需要 1.3.0" }]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async () => ({ id: "@demo/x", apply() {} }));
    expect(loadPluginModule).not.toHaveBeenCalled();
    expect(store.failed[0]).toContain("1.3.0");
  });

  it("disposes a plugin when it is disabled", async () => {
    list.mockResolvedValue([enabled]);
    setEnabled.mockResolvedValue([{ ...enabled, enabled: false }]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    await store.setEnabled("@demo/x", false);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/stores/__tests__/pluginHost.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写实现**

实现要点（照测试需求写）：
- `refresh()`：`plugins = await pluginHostList()`。
- `loadEnabled(importer)`：遍历 `plugins`，跳过 `!enabled`、`!compatible`、`!client`；`importer(entry)` 返回模块（真实实现用 `import(/* @vite-ignore */ url)`）；调用 `loadPluginModule({ id, url }, module)`；把 `{ id, dispose }` 存进 `loaded`；失败记 `failed.push(\`${id}: ${message}\`)` 并继续。
- `setEnabled(id, enabled)`：先 `plugins = await pluginHostSetEnabled(id, enabled)`；`enabled=false` 时 `loaded.get(id)?.dispose()` 并删除；`enabled=true` 时重新 `loadEnabled`。
- `remove(id)`：`loaded.get(id)?.dispose()`；`plugins = await pluginHostRemove(id)`。
- `installLocal(path)`：`const status = await pluginHostInstallLocal(path)`；`refresh()`；若 `status.enabled` 则 `loadEnabled`。
- URL 解析单独一个函数 `pluginModuleUrl(entry)`：桌面 `convertFileSrc(entry.client)`，浏览器 `${apiBase()}plugins/${encodeURIComponent(id)}/${file}?rev=`；由调用方注入，避免 store 直接依赖平台模块（测试里不需要 mock）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/stores/__tests__/pluginHost.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/stores/pluginHost.ts src/stores/__tests__/pluginHost.test.ts
git commit -m "feat(plugins): 插件宿主 store（加载/启用/禁用/移除）"
```

---

### Task 9: 管理面板与接线（Vue）

**Files:**
- Create: `src/components/workspace/panes/ExtensionsPane.vue`
- Modify: `src/stores/layout.ts`（`PaneId` 加 `extensions`、`PANES` 加一行）、`src/components/workspace/RightPanel.vue`（import + `v-else-if`）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`
- Test: `src/core/__tests__/i18nKeys.test.ts`（新增：本次新增 key 在两种语言里都存在且非空）

**Interfaces:**
- Consumes: `usePluginHostStore`
- Produces: 面板 `extensions`：列出插件、导入本地目录、启用/禁用、移除、显示 `lastError`

- [ ] **Step 1: 写失败测试**

```ts
// src/core/__tests__/i18nKeys.test.ts
import { describe, expect, it } from "vitest";
import zh from "@/i18n/zh";
import en from "@/i18n/en";

const KEYS = [
  "panel.extensions",
  "panel.extensionsHint",
  "extensions.title",
  "extensions.empty",
  "extensions.install",
  "extensions.remove",
  "extensions.enable",
  "extensions.disable",
  "extensions.incompatible",
  "extensions.failed",
  "extensions.confirmRemove",
];

describe("extensions i18n keys", () => {
  for (const key of KEYS) {
    it(`has ${key} in both locales`, () => {
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/__tests__/i18nKeys.test.ts`
Expected: FAIL —— 缺 key

- [ ] **Step 3: 加 i18n 与面板**

- `zh.ts` 加：`"panel.extensions": "插件扩展"`、`"panel.extensionsHint": "第三方画布插件"`、`extensions.*` 各条中文；
- `en.ts` 加同构英文；
- `layout.ts`：`PaneId` 联合加 `"extensions"`；`PANES` 在 `plugins` 之后插入 `{ id: "extensions", labelKey: "panel.extensions", hintKey: "panel.extensionsHint" }`；
- `RightPanel.vue`：静态 import `ExtensionsPane`，在 `v-else-if` 链里加 `layout.activeTab === 'extensions'`；
- `ExtensionsPane.vue`：顶部标题 + 「导入本地目录」按钮（`await import("@tauri-apps/plugin-dialog").then(m => m.open({ directory: true }))`，浏览器下按钮禁用）、列表项显示 `id@version`、状态徽标（启用/禁用/不兼容）、`lastError` 红字、启用/禁用/移除三个按钮（移除前 `confirm()`）。

- [ ] **Step 4: 跑测试与构建**

Run: `npx vitest run src/core/__tests__/i18nKeys.test.ts && pnpm build`
Expected: 11 passed、构建通过

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/panes/ExtensionsPane.vue src/stores/layout.ts src/components/workspace/RightPanel.vue src/i18n src/core/__tests__/i18nKeys.test.ts
git commit -m "feat(plugins): 插件扩展管理面板"
```

---

### Task 10: 启动接线与端到端自测

**Files:**
- Modify: `src/App.vue`（或 `src/main.ts`：启动时 `await pluginHost.loadEnabled(importer)`）
- Create: `src/core/plugins/importer.ts`（真实模块导入：桌面/浏览器 URL 解析）
- Test: `src/core/plugins/__tests__/importer.test.ts`

**Interfaces:**
- Produces: `importPluginModule(entry: { id: string; client: string; rev: string }): Promise<PluginClientModule>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { pluginModuleUrl } from "../importer";

describe("plugin module url", () => {
  it("uses the asset protocol on desktop", () => {
    expect(pluginModuleUrl("/tmp/x/client.js", "@demo/x", "0.1.0-1", { desktop: true })).toBe(
      "asset://localhost/%2Ftmp%2Fx%2Fclient.js",
    );
  });

  it("uses the daemon route in the browser with rev and encoded id", () => {
    expect(
      pluginModuleUrl("/tmp/x/client.js", "@demo/x", "0.1.0-1", { desktop: false, base: "/api/" }),
    ).toBe("/api/plugins/%40demo%2Fx/client.js?rev=0.1.0-1");
  });
});
```

（`importPluginModule` 自身用 `import(/* @vite-ignore */ url)`，在测试里只验 URL 拼装，不真 import。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/plugins/__tests__/importer.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写实现并接进启动**

```ts
// src/core/plugins/importer.ts
import { convertFileSrc, isWebRuntime } from "@/platform/tauri";
import { apiBase } from "@/platform/env";
import type { PluginClientModule } from "./loader";

export function pluginModuleUrl(
  clientPath: string,
  id: string,
  rev: string,
  options: { desktop: boolean; base?: string },
): string {
  if (options.desktop) return convertFileSrc(clientPath);
  const base = options.base ?? apiBase();
  const file = clientPath.split(/[\\/]/).pop() ?? "client.js";
  return `${base}plugins/${encodeURIComponent(id)}/${file}?rev=${encodeURIComponent(rev)}`;
}

export async function importPluginModule(entry: {
  id: string;
  client: string;
  rev: string;
}): Promise<PluginClientModule> {
  const url = pluginModuleUrl(entry.client, entry.id, entry.rev, { desktop: !isWebRuntime() });
  const module = (await import(/* @vite-ignore */ url)) as { default?: PluginClientModule };
  if (!module.default) throw new Error(`插件 ${entry.id} 的 client.js 没有 default 导出`);
  return module.default;
}
```

`App.vue` 的 `onMounted` 里：

```ts
  void usePluginHostStore()
    .refresh()
    .then(() => usePluginHostStore().loadEnabled(importPluginModule));
```

- [ ] **Step 4: 跑测试与全量**

Run: `npx vitest run src/core/plugins/__tests__/importer.test.ts && pnpm test && pnpm build`
Expected: 全绿

- [ ] **Step 5: 手测清单（无法自动化的部分）**

1. 造一个示例插件目录（`aicut.plugin.json` + `client.js`，`client.js` 的 `default` 导出 `{ id, apply(ctx) { ctx.nodes.register(...) } }`）；
2. 面板 → 导入本地目录 → 插件出现在列表；
3. 画布添加菜单里出现 `ext.*` 节点，跑一次；
4. 改 `client.js`（改节点标题文案）→ 点「刷新」或重进面板 → 节点定义更新；
5. 禁用 → 节点从菜单消失；启用 → 回来；
6. 移除 → 列表清空，磁盘上的源目录**仍在**。

- [ ] **Step 6: Commit**

```bash
git add src/core/plugins src/App.vue
git commit -m "feat(plugins): 启动加载已启用插件 + 模块 URL 解析"
```

---

## 收尾验收（M1 完成条件）

- [ ] `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host` 全绿
- [ ] `pnpm test`、`pnpm build` 全绿
- [ ] 手测清单 6 条全过（重点是第 6 条：移除不删源目录）
- [ ] `plugins/host/plugins.json` 里只有名册数据，没有绝对路径以外的派生字段
