//! 插件宿主的端到端流程：导入本地目录 → 列出 → 禁用 → 移除。
//!
//! 只覆盖 daemon 侧的「名册 + 磁盘」；客户端半的加载在前端单测里覆盖。

use std::path::PathBuf;
use std::sync::Arc;

use aicut_daemon::host::{HeadlessHost, Host};
use aicut_daemon::plugin_host::{linked, registry, resource, service};
use tempfile::TempDir;

fn plugin_dir(root: &TempDir, id: &str) -> PathBuf {
    let dir = root.path().join("plugin-src");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("aicut.plugin.json"),
        format!(
            r#"{{"format":1,"id":"{id}","version":"0.1.0","engines":{{"aicut":">=1.0.0"}},"client":"./client.js"}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("client.js"), "export default {id, apply(){}}\n").unwrap();
    std::fs::write(dir.join("package.json"), format!(r#"{{"name":"{id}"}}"#)).unwrap();
    dir
}

#[test]
fn install_list_toggle_remove_round_trip() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = plugin_dir(&temp, "@demo/it");

    let installed = service::install_local(&host, &source, "1.4.0").unwrap();
    assert_eq!(installed.id, "@demo/it");
    assert!(installed.enabled);
    assert!(installed.compatible);

    let listed = service::list(&host, "1.4.0").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].client.as_deref(), installed.client.as_deref());

    // 名册落在 `<config>/plugins/host/plugins.json`。
    let root = service::root(&host);
    assert!(registry::registry_path(&root).is_file());

    // 资源路由只认登记过的目录。
    let loaded = registry::load(&root).unwrap();
    let path = resource::resolve(&root, &loaded, "@demo/it", "client.js").unwrap();
    assert!(path.ends_with("client.js"));
    assert!(resource::resolve(&root, &loaded, "@demo/it", "../plugins.json").is_err());

    let disabled = service::toggle(&host, "@demo/it", false, "1.4.0").unwrap();
    assert!(!disabled[0].enabled);

    let remaining = service::forget(&host, "@demo/it", "1.4.0").unwrap();
    assert!(remaining.is_empty());
    // 移除只删记录，不删作者的源目录。
    assert!(source.join("client.js").is_file());
}

#[test]
fn duplicate_id_is_rejected() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = plugin_dir(&temp, "@demo/dup");

    service::install_local(&host, &source, "1.4.0").unwrap();
    let error = service::install_local(&host, &source, "1.4.0").unwrap_err();
    assert!(error.contains("@demo/dup"), "{}", error);
}

#[test]
fn linked_scan_detects_a_removed_source_directory() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = plugin_dir(&temp, "@demo/gone");
    service::install_local(&host, &source, "1.4.0").unwrap();

    std::fs::remove_dir_all(&source).unwrap();
    let listed = service::list(&host, "1.4.0").unwrap();
    assert!(listed[0].last_error.is_some());
}

#[test]
fn incompatible_engines_are_reported_but_kept() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("old");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(
        source.join("aicut.plugin.json"),
        r#"{"format":1,"id":"@demo/old","version":"0.1.0","engines":{"aicut":"<1.0.0"},"client":"./client.js"}"#,
    )
    .unwrap();
    std::fs::write(source.join("client.js"), "export default {}").unwrap();

    service::install_local(&host, &source, "1.4.0").unwrap();
    let listed = service::list(&host, "1.4.0").unwrap();
    assert!(!listed[0].compatible);
    assert!(listed[0].last_error.clone().unwrap().contains("1.0.0"));
    assert_eq!(
        linked::read_manifest(&source).map(|(manifest, _)| manifest.id).unwrap(),
        "@demo/old"
    );
}
