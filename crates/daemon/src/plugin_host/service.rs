//! 插件宿主的服务层：给 RPC 用的四个动作。
//!
//! 只做「名册 + 目录」的事；加载/卸载客户端半由前端运行时负责（它是唯一有
//! Vue / 画布注册表的进程）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::host::Host;

use super::linked::{install_linked, scan, PluginStatus};
use super::runtime::{Budget, HostRuntime, SpawnOptions};
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

// ---------------------------------------------------------------------------
// 宿主半（QuickJS）
// ---------------------------------------------------------------------------

/// 运行中的宿主半：`plugin id → HostRuntime`。进程内单例——插件线程绑定数据目录。
static RUNNING: OnceLock<Mutex<HashMap<String, HostRuntime>>> = OnceLock::new();

fn running_map() -> &'static Mutex<HashMap<String, HostRuntime>> {
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 插件数据目录：`<config>/plugins/data/<safe-id>`。
pub fn data_root(host: &Arc<dyn Host>, id: &str) -> PathBuf {
    root(host).join("data").join(super::linked::safe_id(id))
}

/// 起一个插件的宿主半（重复调用是幂等的）。
pub fn start(
    host: &Arc<dyn Host>,
    network: &crate::network::NetworkRuntime,
    id: &str,
) -> Result<(), String> {
    if running_map().lock().unwrap().contains_key(id) {
        return Ok(());
    }
    let root = root(host);
    let registry = load(&root)?;
    let record = registry
        .plugins
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("名册里没有插件 {id}"))?;
    let status = scan(&root, record, "0.0.0");
    let host_file = status
        .host_file
        .ok_or_else(|| format!("插件 {id} 没有宿主半（host.js）"))?;
    let source = std::fs::read_to_string(&host_file)
        .map_err(|error| format!("读 host.js 失败：{error}"))?;
    let options = SpawnOptions {
        budget: Budget::default(),
        data_root: data_root(host, id),
        net: Some(super::NetHandle {
            handle: tokio::runtime::Handle::current(),
            client: network.client()?,
        }),
    };
    let runtime = HostRuntime::spawn(id.to_string(), source, options)?;
    running_map().lock().unwrap().insert(id.to_string(), runtime);
    Ok(())
}

/// 调插件宿主半的 `run(input)`；返回它给的字符串（约定是 JSON）。
pub fn invoke(id: &str, input: &str) -> Result<String, String> {
    let map = running_map().lock().unwrap();
    let runtime = map
        .get(id)
        .ok_or_else(|| format!("插件 {id} 的宿主半没有运行"))?;
    runtime.invoke(input.to_string())
}

/// 停掉宿主半；没有在跑也返回 `false` 而不是报错。
pub fn stop(id: &str) -> bool {
    let removed = running_map().lock().unwrap().remove(id);
    match removed {
        Some(runtime) => {
            runtime.stop();
            true
        }
        None => false,
    }
}

/// 当前在跑的插件 id（排序后）。
pub fn running() -> Vec<String> {
    let mut ids: Vec<String> = running_map().lock().unwrap().keys().cloned().collect();
    ids.sort();
    ids
}
