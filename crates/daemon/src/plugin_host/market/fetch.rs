//! 索引抓取、缓存与分页搜索。
//!
//! 只在 daemon 侧做：渲染进程永远拿一页结果，不拿整份索引。索引是第三方内容，
//! 只当数据处理。

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::super::registry::Registry;
use super::index::{best_version, parse_index, LocalizedText, MarketIndex, MarketSource};
use super::{CACHE_TTL_SECS, MAX_INDEX_BYTES, MAX_PAGE};

/// 默认索引源：作者自控的 GitHub 仓库（现在是空索引）。
pub const DEFAULT_INDEX_URL: &str =
    "https://raw.githubusercontent.com/heshengtao/ai-cut-plugin-market/main/index.json";

const SOURCE_FILE: &str = "market.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceConfig {
    #[serde(default)]
    url: String,
}

pub fn load_source(root: &Path) -> String {
    std::fs::read_to_string(root.join(SOURCE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<SourceConfig>(&text).ok())
        .map(|config| config.url)
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_INDEX_URL.to_string())
}

pub fn save_source(root: &Path, url: &str) -> Result<String, String> {
    check_url(url)?;
    std::fs::create_dir_all(root).map_err(|error| format!("创建插件目录失败：{error}"))?;
    let text = serde_json::to_string_pretty(&SourceConfig {
        url: url.to_string(),
    })
    .map_err(|error| format!("序列化索引源失败：{error}"))?;
    std::fs::write(root.join(SOURCE_FILE), text)
        .map_err(|error| format!("写索引源失败：{error}"))?;
    Ok(url.to_string())
}

/// 只允许 HTTPS；`localhost` / `127.0.0.1` 放行（本地自建市场）。
pub fn check_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("索引地址为空".to_string());
    }
    if url.contains('@') {
        return Err("索引地址不能带凭据".to_string());
    }
    if url.contains('#') {
        return Err("索引地址不能带 # 片段".to_string());
    }
    let local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
    if !url.starts_with("https://") && !local {
        return Err(format!("索引地址必须是 https（本机 http 例外）：{url}"));
    }
    Ok(())
}

pub fn cache_key(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    digest[..8].iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug, Clone)]
pub struct FetchedIndex {
    pub index: MarketIndex,
    /// `network` / `cache` / `stale-cache`。
    pub source: String,
    pub fetched_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn cache_paths(root: &Path, url: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = root.join("cache");
    let key = cache_key(url);
    (dir.join(format!("market-{key}.json")), dir.join(format!("market-{key}.meta.json")))
}

fn read_cache(root: &Path, url: &str) -> Option<(String, u64)> {
    let (body, meta) = cache_paths(root, url);
    let text = std::fs::read_to_string(body).ok()?;
    let fetched_at = std::fs::read_to_string(meta)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("fetchedAt").and_then(|item| item.as_u64()))
        .unwrap_or(0);
    Some((text, fetched_at))
}

fn write_cache(root: &Path, url: &str, text: &str) -> Result<(), String> {
    let (body, meta) = cache_paths(root, url);
    if let Some(parent) = body.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建缓存目录失败：{error}"))?;
    }
    std::fs::write(&body, text).map_err(|error| format!("写索引缓存失败：{error}"))?;
    let meta_text = serde_json::json!({ "fetchedAt": now_secs(), "url": url }).to_string();
    std::fs::write(&meta, meta_text).map_err(|error| format!("写索引缓存元数据失败：{error}"))?;
    Ok(())
}

/// 抓索引：命中新鲜缓存直接回；否则抓网络；网络失败但有旧缓存 → `stale-cache`。
pub async fn fetch_index(
    network: &crate::network::NetworkRuntime,
    root: &Path,
    url: &str,
    force: bool,
) -> Result<FetchedIndex, String> {
    check_url(url)?;
    let cached = read_cache(root, url);
    if let Some((text, fetched_at)) = &cached {
        let fresh = !force && now_secs().saturating_sub(*fetched_at) < CACHE_TTL_SECS;
        if fresh {
            if let Ok(index) = parse_index(text) {
                return Ok(FetchedIndex {
                    index,
                    source: "cache".to_string(),
                    fetched_at: *fetched_at,
                });
            }
        }
    }

    let client = network
        .client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("抓取索引失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        if let Some((text, fetched_at)) = cached {
            if let Ok(index) = parse_index(&text) {
                return Ok(FetchedIndex {
                    index,
                    source: "stale-cache".to_string(),
                    fetched_at,
                });
            }
        }
        return Err(format!("索引返回 HTTP {}", status.as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取索引失败：{error}"))?;
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(format!("索引超过 {} MB 上限", MAX_INDEX_BYTES / 1024 / 1024));
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let index = parse_index(&text)?;
    let _ = write_cache(root, url, &text);
    Ok(FetchedIndex {
        index,
        source: "network".to_string(),
        fetched_at: now_secs(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub name: String,
    pub title: String,
    pub description: String,
    pub icon: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub version: String,
    pub sha256: String,
    pub size: u64,
    pub published_at: u64,
    pub source: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub update_available: bool,
}

/// 在已解析的索引里搜索 + 分页。纯函数，便于单测。
pub fn search_index(
    index: &MarketIndex,
    registry: &Registry,
    app_version: &str,
    text: &str,
    offset: usize,
    limit: usize,
) -> (Vec<SearchHit>, usize) {
    let needle = text.trim().to_lowercase();
    let limit = limit.clamp(1, MAX_PAGE);
    let mut hits: Vec<SearchHit> = Vec::new();
    for plugin in &index.plugins {
        let title = plugin
            .title
            .as_ref()
            .map(|value| value.resolve("zh"))
            .unwrap_or_else(|| plugin.name.clone());
        let description = plugin
            .description
            .as_ref()
            .map(|value| value.resolve("zh"))
            .unwrap_or_default();
        if !needle.is_empty() {
            let haystack = format!(
                "{} {} {} {}",
                plugin.name.to_lowercase(),
                title.to_lowercase(),
                description.to_lowercase(),
                plugin.author.clone().unwrap_or_default().to_lowercase()
            );
            if !haystack.contains(&needle) {
                continue;
            }
        }
        let Some(version) = best_version(plugin, app_version) else {
            continue;
        };
        let installed = registry.plugins.iter().find(|item| item.id == plugin.name);
        let installed_version = installed.map(|item| item.version.clone());
        let update_available = installed_version
            .as_deref()
            .map(|current| current != version.version)
            .unwrap_or(false);
        hits.push(SearchHit {
            name: plugin.name.clone(),
            title,
            description,
            icon: plugin.icon.clone(),
            author: plugin.author.clone(),
            homepage: plugin.homepage.clone(),
            version: version.version.clone(),
            sha256: version.sha256.clone().unwrap_or_default(),
            size: version.size.unwrap_or(0),
            published_at: version.publish_timestamp,
            source: source_label(&version.source),
            installed: installed.is_some(),
            installed_version,
            update_available,
        });
    }
    hits.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    let total = hits.len();
    let page = hits.into_iter().skip(offset).take(limit).collect();
    (page, total)
}

fn source_label(source: &MarketSource) -> String {
    match source {
        MarketSource::Npm { registry } => match registry {
            Some(url) => format!("npm:{url}"),
            None => "npm".to_string(),
        },
        MarketSource::Tgz { url } => url.clone(),
    }
}

/// 把 `LocalizedText` 压平成字符串（RPC 输出用）。
pub fn flatten(text: &Option<LocalizedText>) -> String {
    text.as_ref().map(|value| value.resolve("zh")).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::registry::PluginRecord;

    const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn index_text() -> String {
        format!(
            r#"{{
              "format": 1,
              "title": "Demo",
              "plugins": [
                {{ "name": "@demo/a", "title": "Alpha", "author": "alice",
                   "versions": [{{ "version": "0.2.0", "publishTimestamp": 20, "sha256": "{SHA}", "size": 10,
                                  "source": {{ "type": "npm" }}, "engines": {{ "aicut": ">=1.0.0" }} }}] }},
                {{ "name": "@demo/b", "title": "Beta", "author": "bob",
                   "versions": [{{ "version": "0.1.0", "publishTimestamp": 10, "sha256": "{SHA}", "size": 20,
                                  "source": {{ "type": "tgz", "url": "https://example.com/b.tgz" }} }}] }}
              ]
            }}"#
        )
    }

    fn registry_with(id: &str, version: &str) -> Registry {
        let mut registry = Registry::default();
        registry.plugins.push(PluginRecord {
            id: id.into(),
            version: version.into(),
            kind: "store".into(),
            path: None,
            enabled: true,
            installed_at: 1,
            updated_at: 1,
            last_error: None,
        });
        registry
    }

    #[test]
    fn accepts_https_and_local_http_only() {
        assert!(check_url("https://example.com/index.json").is_ok());
        assert!(check_url("http://localhost:8080/index.json").is_ok());
        assert!(check_url("http://127.0.0.1:8080/index.json").is_ok());
        assert!(check_url("http://example.com/index.json").is_err());
        assert!(check_url("https://user:pw@example.com/i.json").is_err());
        assert!(check_url("https://example.com/i.json#frag").is_err());
    }

    #[test]
    fn source_round_trips_and_defaults() {
        let root = tempfile::TempDir::new().unwrap();
        assert_eq!(load_source(root.path()), DEFAULT_INDEX_URL);
        save_source(root.path(), "https://example.com/i.json").unwrap();
        assert_eq!(load_source(root.path()), "https://example.com/i.json");
        assert!(save_source(root.path(), "ftp://x/y.json").is_err());
    }

    #[test]
    fn search_filters_and_pages() {
        let index = parse_index(&index_text()).unwrap();
        let registry = Registry::default();
        let (hits, total) = search_index(&index, &registry, "1.4.0", "", 0, 10);
        assert_eq!(total, 2);
        assert_eq!(hits[0].name, "@demo/a"); // publishTimestamp 大的在前
        let (text_hits, total) = search_index(&index, &registry, "1.4.0", "beta", 0, 10);
        assert_eq!(total, 1);
        assert_eq!(text_hits[0].name, "@demo/b");
        let (second, _) = search_index(&index, &registry, "1.4.0", "", 1, 1);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].name, "@demo/b");
        let (none, total) = search_index(&index, &registry, "1.4.0", "zzz", 0, 10);
        assert!(none.is_empty());
        assert_eq!(total, 0);
    }

    #[test]
    fn search_reports_installed_and_update_available() {
        let index = parse_index(&index_text()).unwrap();
        let registry = registry_with("@demo/a", "0.1.0");
        let (hits, _) = search_index(&index, &registry, "1.4.0", "alpha", 0, 10);
        assert!(hits[0].installed);
        assert!(hits[0].update_available);
        assert_eq!(hits[0].installed_version.as_deref(), Some("0.1.0"));

        let registry = registry_with("@demo/a", "0.2.0");
        let (hits, _) = search_index(&index, &registry, "1.4.0", "alpha", 0, 10);
        assert!(!hits[0].update_available);
    }

    #[test]
    fn cache_round_trips() {
        let root = tempfile::TempDir::new().unwrap();
        write_cache(root.path(), "https://example.com/i.json", &index_text()).unwrap();
        let (text, fetched_at) = read_cache(root.path(), "https://example.com/i.json").unwrap();
        assert!(text.contains("@demo/a"));
        assert!(fetched_at > 0);
    }
}
