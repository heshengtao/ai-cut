//! 插件宿主的服务层：给 RPC 用的四个动作。
//!
//! 只做「名册 + 目录」的事；加载/卸载客户端半由前端运行时负责（它是唯一有
//! Vue / 画布注册表的进程）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::host::Host;

use super::linked::{install_linked, scan, PluginStatus};
use super::registry::{load, remove, save, set_enabled, upsert};

/// 插件根目录：`<config>/plugins/host/`（OFX 在 `plugins/ofx/`，互不干扰）。
pub fn root(host: &Arc<dyn Host>) -> PathBuf {
    host.config_dir().join("plugins").join("host")
}

pub fn list(host: &Arc<dyn Host>, app_version: &str) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let registry = load(&root)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(&root, record, app_version))
        .collect())
}

/// 导入本地目录：先登记，再落盘（顺序反了会在名册里留下打不开的记录）。
pub fn install_local(
    host: &Arc<dyn Host>,
    source: &Path,
    app_version: &str,
) -> Result<PluginStatus, String> {
    let root = root(host);
    let record = install_linked(&root, source, app_version)?;
    let status = scan(&root, &record, app_version);
    let mut registry = load(&root)?;
    upsert(&mut registry, record)?;
    save(&root, &registry)?;
    Ok(status)
}

pub fn toggle(
    host: &Arc<dyn Host>,
    id: &str,
    enabled: bool,
    app_version: &str,
) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let mut registry = load(&root)?;
    set_enabled(&mut registry, id, enabled)?;
    save(&root, &registry)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(&root, record, app_version))
        .collect())
}

/// 移除记录。`linked` 插件**不删源目录**（卸载 ≠ 删作者的代码）。
pub fn forget(host: &Arc<dyn Host>, id: &str, app_version: &str) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let mut registry = load(&root)?;
    remove(&mut registry, id)?;
    save(&root, &registry)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(&root, record, app_version))
        .collect())
}
