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

// ---------------------------------------------------------------------------
// 商店
// ---------------------------------------------------------------------------

/// 当前索引源。
pub fn market_source(host: &Arc<dyn Host>) -> String {
    super::market::fetch::load_source(&root(host))
}

pub fn market_set_source(host: &Arc<dyn Host>, url: &str) -> Result<String, String> {
    super::market::fetch::save_source(&root(host), url)
}

/// 搜索一页。`force` 跳过缓存（用户点「刷新」）。
pub async fn market_search(
    host: &Arc<dyn Host>,
    network: &crate::network::NetworkRuntime,
    app_version: &str,
    text: &str,
    offset: usize,
    limit: usize,
    force: bool,
) -> Result<serde_json::Value, String> {
    let root = root(host);
    let url = super::market::fetch::load_source(&root);
    let fetched = super::market::fetch::fetch_index(network, &root, &url, force).await?;
    let registry = load(&root)?;
    let (hits, total) = super::market::fetch::search_index(
        &fetched.index,
        &registry,
        app_version,
        text,
        offset,
        limit,
    );
    Ok(serde_json::json!({
        "source": fetched.source,
        "fetchedAt": fetched.fetched_at,
        "total": total,
        "hits": hits,
    }))
}

/// 按 `name@version` 安装（版本留空 = 兼容范围里最高的那个）。
pub async fn market_install(
    host: &Arc<dyn Host>,
    network: &crate::network::NetworkRuntime,
    app_version: &str,
    name: &str,
    version: &str,
) -> Result<PluginStatus, String> {
    let root = root(host);
    let url = super::market::fetch::load_source(&root);
    let fetched = super::market::fetch::fetch_index(network, &root, &url, false).await?;
    let plugin = fetched
        .index
        .plugins
        .iter()
        .find(|item| item.name == name)
        .ok_or_else(|| format!("索引里没有插件 {name}"))?;
    let target = if version.trim().is_empty() {
        super::market::index::best_version(plugin, app_version)
            .ok_or_else(|| format!("插件 {name} 没有与当前版本兼容的发布"))?
    } else {
        plugin
            .versions
            .iter()
            .find(|item| item.version == version)
            .ok_or_else(|| format!("插件 {name} 没有 {version} 这个版本"))?
    };
    let sha = target
        .sha256
        .clone()
        .ok_or_else(|| format!("插件 {name} 的 {} 缺少 sha256", target.version))?;

    let tarball = match &target.source {
        super::market::index::MarketSource::Tgz { url } => url.clone(),
        super::market::index::MarketSource::Npm { registry } => {
            let base = registry
                .clone()
                .unwrap_or_else(|| "https://registry.npmjs.org".to_string());
            npm_tarball(network, &base, name, &target.version).await?
        }
    };
    let bytes = download(network, &tarball).await?;
    let record = super::market::install::install_bytes(&root, &bytes, &sha, app_version)?;

    // 同名同 id：更新版本号与时间，保留 enabled 状态。
    let mut registry = load(&root)?;
    if let Some(existing) = registry.plugins.iter_mut().find(|item| item.id == record.id) {
        let enabled = existing.enabled;
        *existing = record.clone();
        existing.enabled = enabled;
    } else {
        registry.plugins.push(record.clone());
    }
    save(&root, &registry)?;
    super::market::install::gc(&root, 3);
    Ok(scan(&root, &record, app_version))
}

/// 卸载托管插件：删 `store/<id>`，保留 `data/<id>`。
pub fn market_remove(host: &Arc<dyn Host>, id: &str, app_version: &str) -> Result<Vec<PluginStatus>, String> {
    let root = root(host);
    let mut registry = load(&root)?;
    if let Some(record) = registry.plugins.iter().find(|item| item.id == id) {
        if record.kind == "store" {
            super::market::install::remove_store(&root, id)?;
        }
    }
    remove(&mut registry, id)?;
    save(&root, &registry)?;
    Ok(registry
        .plugins
        .iter()
        .map(|record| scan(&root, record, app_version))
        .collect())
}

/// 从 npm registry 查某个版本的 tarball 直链。
async fn npm_tarball(
    network: &crate::network::NetworkRuntime,
    base: &str,
    name: &str,
    version: &str,
) -> Result<String, String> {
    let encoded = name.replace('/', "%2F");
    let url = format!("{}/{encoded}/{version}", base.trim_end_matches('/'));
    let client = network.client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("查询 npm 失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("npm 返回 HTTP {}", response.status().as_u16()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("npm 响应不是 JSON：{error}"))?;
    value
        .get("dist")
        .and_then(|item| item.get("tarball"))
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("npm 的 {name}@{version} 没有 tarball 地址"))
}

async fn download(network: &crate::network::NetworkRuntime, url: &str) -> Result<Vec<u8>, String> {
    let client = network.client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载插件失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载插件返回 HTTP {}", response.status().as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取插件内容失败：{error}"))?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("插件包超过 512 MB".to_string());
    }
    Ok(bytes.to_vec())
}
