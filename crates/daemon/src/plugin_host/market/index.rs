//! 商店索引：类型与校验。
//!
//! 索引是静态 JSON（`format: 1`）。这里的校验是**准入**：不合法的索引整份拒绝，
//! 而不是「能用多少算多少」——半份索引会让安装参数对不上。

use std::collections::{BTreeMap, HashSet};

use serde::Deserialize;

use super::super::manifest::{parse_version, version_matches, Version};

const FORMAT: u32 = 1;

/// 本地化文本：字符串，或 `{ "en": "...", "zh": "..." }`。
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum LocalizedText {
    Plain(String),
    Map(BTreeMap<String, String>),
}

impl LocalizedText {
    /// 取某个语言的文案；缺失时退到 `en`，再退到任意一条。
    pub fn resolve(&self, locale: &str) -> String {
        match self {
            LocalizedText::Plain(text) => text.clone(),
            LocalizedText::Map(map) => map
                .get(locale)
                .or_else(|| map.get("en"))
                .or_else(|| map.values().next())
                .cloned()
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MarketSource {
    Npm {
        #[serde(default)]
        registry: Option<String>,
    },
    Tgz {
        url: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketVersion {
    pub version: String,
    pub publish_timestamp: u64,
    pub source: MarketSource,
    #[serde(default)]
    pub engines: Option<super::super::manifest::Engines>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPlugin {
    pub name: String,
    #[serde(default)]
    pub title: Option<LocalizedText>,
    #[serde(default)]
    pub description: Option<LocalizedText>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    pub versions: Vec<MarketVersion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketIndex {
    pub format: u32,
    pub title: LocalizedText,
    #[serde(default)]
    pub description: Option<LocalizedText>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub plugins: Vec<MarketPlugin>,
}

/// 解析并校验整份索引。
pub fn parse_index(text: &str) -> Result<MarketIndex, String> {
    let index: MarketIndex =
        serde_json::from_str(text).map_err(|error| format!("索引不是合法 JSON：{error}"))?;
    if index.format != FORMAT {
        return Err(format!("索引 format 必须是 {FORMAT}，实际是 {}", index.format));
    }
    let mut names = HashSet::new();
    for plugin in &index.plugins {
        if plugin.name.trim().is_empty() {
            return Err("索引里有插件缺少 name".to_string());
        }
        if !names.insert(plugin.name.clone()) {
            return Err(format!("索引里插件名重复：{}", plugin.name));
        }
        if plugin.versions.is_empty() {
            return Err(format!("插件 {} 没有任何版本", plugin.name));
        }
        let mut versions = HashSet::new();
        for item in &plugin.versions {
            if !versions.insert(item.version.clone()) {
                return Err(format!(
                    "插件 {} 的版本 {} 重复",
                    plugin.name, item.version
                ));
            }
            parse_version(&item.version).map_err(|error| {
                format!("插件 {} 的版本号不合法：{error}", plugin.name)
            })?;
            let sha = item.sha256.as_deref().unwrap_or("");
            if !is_sha256(sha) {
                return Err(format!(
                    "插件 {} 的 {} 缺少合法的 sha256（需要 64 位十六进制）",
                    plugin.name, item.version
                ));
            }
            if item.size.unwrap_or(0) == 0 {
                return Err(format!(
                    "插件 {} 的 {} 缺少 size",
                    plugin.name, item.version
                ));
            }
            if let Some(engines) = &item.engines {
                version_matches(&engines.aicut, "1.0.0").map_err(|error| {
                    format!(
                        "插件 {} 的 {} 的 engines 写法不支持：{error}",
                        plugin.name, item.version
                    )
                })?;
            }
            if let MarketSource::Tgz { url } = &item.source {
                // 与索引地址同一条规则：只 HTTPS；本机 http 放行（本地自建市场 / 测试）。
                let local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
                if !url.starts_with("https://") && !local {
                    return Err(format!(
                        "插件 {} 的 {} 的 tgz 源必须是 https（本机 http 例外）：{url}",
                        plugin.name, item.version
                    ));
                }
            }
        }
    }
    Ok(index)
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64 && text.chars().all(|ch| ch.is_ascii_hexdigit())
}

/// 该插件在当前版本下可装的最高版本（`engines` 兼容）。
pub fn best_version<'a>(plugin: &'a MarketPlugin, app_version: &str) -> Option<&'a MarketVersion> {
    let mut best: Option<(&MarketVersion, Version)> = None;
    for item in &plugin.versions {
        let range = item
            .engines
            .as_ref()
            .map(|engines| engines.aicut.as_str())
            .unwrap_or("*");
        if !version_matches(range, app_version).unwrap_or(false) {
            continue;
        }
        let Ok(parsed) = parse_version(&item.version) else {
            continue;
        };
        if best.as_ref().map(|(_, current)| parsed > *current).unwrap_or(true) {
            best = Some((item, parsed));
        }
    }
    best.map(|(item, _)| item)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn index_json() -> String {
        format!(
            r#"{{
              "format": 1,
              "title": {{ "en": "AI Cut Plugins", "zh": "AI Cut 插件" }},
              "plugins": [{{
                "name": "@demo/a",
                "title": "Demo",
                "versions": [
                  {{ "version": "0.1.0", "publishTimestamp": 1, "sha256": "{SHA_A}", "size": 10, "source": {{ "type": "npm" }}, "engines": {{ "aicut": ">=1.0.0" }} }},
                  {{ "version": "0.2.0", "publishTimestamp": 2, "sha256": "{SHA_B}", "size": 20, "source": {{ "type": "tgz", "url": "https://example.com/a.tgz" }}, "engines": {{ "aicut": ">=1.0.0" }} }}
                ]
              }}]
            }}"#
        )
    }

    #[test]
    fn parses_a_valid_index() {
        let index = parse_index(&index_json()).unwrap();
        assert_eq!(index.plugins.len(), 1);
        assert_eq!(index.plugins[0].versions.len(), 2);
        assert_eq!(index.title.resolve("zh"), "AI Cut 插件");
    }

    #[test]
    fn accepts_an_empty_index() {
        let index = parse_index(r#"{"format":1,"title":"Empty","plugins":[]}"#).unwrap();
        assert!(index.plugins.is_empty());
    }

    #[test]
    fn rejects_unknown_format() {
        let text = index_json().replace("\"format\": 1", "\"format\": 2");
        assert!(parse_index(&text).unwrap_err().contains("format"));
    }

    #[test]
    fn rejects_duplicate_plugin_names() {
        let text = index_json().replace("\"plugins\": [", "\"plugins\": [{\"name\":\"@demo/a\",\"versions\":[]},");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("@demo/a"), "{}", error);
    }

    #[test]
    fn rejects_duplicate_versions() {
        let text = index_json().replace("\"version\": \"0.2.0\"", "\"version\": \"0.1.0\"");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("0.1.0"), "{}", error);
    }

    #[test]
    fn rejects_a_missing_or_short_sha256() {
        let text = index_json().replace(SHA_A, "aa");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("sha256"), "{}", error);
    }

    #[test]
    fn rejects_a_git_source() {
        let text = index_json().replace(
            r#"{ "type": "tgz", "url": "https://example.com/a.tgz" }"#,
            r#"{ "type": "git", "url": "https://example.com/a", "commit": "abc" }"#,
        );
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("git"), "{}", error);
    }

    #[test]
    fn rejects_a_plain_http_tgz_source() {
        let text = index_json().replace("https://example.com/a.tgz", "http://example.com/a.tgz");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("https"), "{}", error);
    }

    #[test]
    fn picks_the_highest_compatible_version() {
        let index = parse_index(&index_json()).unwrap();
        let best = best_version(&index.plugins[0], "1.4.0").unwrap();
        assert_eq!(best.version, "0.2.0");
        assert!(best_version(&index.plugins[0], "0.9.0").is_none());
    }
}
