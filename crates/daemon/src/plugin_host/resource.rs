//! 插件资源解析：`(插件 id, 文件名)` → 绝对路径。
//!
//! 只允许落在该插件自己的目录里，且只接受**单层文件名**。这条路由存在的理由：
//! `/file` 能读任意绝对路径（`rpc.rs`），插件资源不能借道它。

use std::path::{Component, Path, PathBuf};

use super::registry::Registry;

/// 解析插件资源路径；任何越界、缺失、多段路径都返回 `Err`。
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
        assert!(resolve(root.path(), &registry, "@demo/x", "%2E%2E/secret").is_err());
    }

    #[test]
    fn rejects_missing_files() {
        let (root, registry) = setup();
        assert!(resolve(root.path(), &registry, "@demo/x", "nope.js").is_err());
    }
}
