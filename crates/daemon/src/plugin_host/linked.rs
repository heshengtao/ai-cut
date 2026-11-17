//! 本地目录插件（`kind = "linked"`）：导入、卸载、状态扫描。
//!
//! 导入**不复制**源码：名册只记住绝对路径，卸载只移除记录。这是作者自己用的
//! 「私有插件」形态（不进商店索引、不进主仓库）。

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
    /// 客户端半入口的绝对路径（无客户端半时为 `None`）。
    pub client: Option<String>,
    /// 宿主半入口的绝对路径（无宿主半时为 `None`）。
    pub host_file: Option<String>,
    /// 版本 + 入口 mtime：前端据此判断是否需要热替换。
    pub rev: String,
    pub compatible: bool,
    pub last_error: Option<String>,
}

/// 读清单并校验「id 与 package.json name 一致」。
pub fn read_manifest(dir: &Path) -> Result<(PluginManifest, String), String> {
    let path = dir.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(format!("缺少 {MANIFEST_FILE}：{}", dir.display()));
    }
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("读 {MANIFEST_FILE} 失败：{error}"))?;
    let manifest = parse_manifest(&text)?;
    let package = dir.join("package.json");
    if package.is_file() {
        if let Ok(package_text) = std::fs::read_to_string(&package) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&package_text) {
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

/// 把一个本地目录登记成插件；不复制文件。
pub fn install_linked(
    _root: &Path,
    dir: &Path,
    app_version: &str,
) -> Result<PluginRecord, String> {
    let dir = std::fs::canonicalize(dir).map_err(|error| format!("插件目录不可用：{error}"))?;
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

/// 扫一条记录，产出给前端的完整状态（不报错，错误进 `last_error`）。
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
            status.compatible =
                version_matches(&manifest.engines.aicut, app_version).unwrap_or(false);
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

/// 入口文件（client 优先）的 mtime 毫秒：任何入口改动都会换 rev。
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
        assert_eq!(
            record.path.as_deref(),
            Some(source.path().canonicalize().unwrap().to_str().unwrap())
        );
        assert!(record.enabled);
        assert!(record.last_error.is_none());
    }

    #[test]
    fn rejects_a_directory_without_a_manifest() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        let error = install_linked(root.path(), source.path(), "1.4.0").unwrap_err();
        assert!(error.contains(MANIFEST_FILE));
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
        assert!(status.last_error.is_some());
        assert!(status.client.is_some());
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
