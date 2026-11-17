//! `aicut.plugin.json` 的解析与校验。
//!
//! 版本范围是**受限语法**：只有 `*`、`>=`、`>`、`<=`、`<`、`=`，多个条件用空格
//! 或逗号连接。`^` / `~` / `x` / `||` 一律拒绝——宁可让作者写清楚，也不要让
//! 「大概兼容」的插件把加载期搞崩。

use serde::Deserialize;

pub const MANIFEST_FILE: &str = "aicut.plugin.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Engines {
    pub aicut: String,
}

impl Default for Engines {
    fn default() -> Self {
        Self {
            aicut: "*".to_string(),
        }
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
    let manifest: PluginManifest =
        serde_json::from_str(text).map_err(|error| format!("清单不是合法 JSON：{error}"))?;
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

/// 受限版本范围匹配。语法错误返回 `Err`，不匹配返回 `Ok(false)`。
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
        assert_eq!(manifest.engines.aicut, ">=1.3.0");
    }

    #[test]
    fn rejects_unknown_format() {
        let raw = r#"{"format":2,"id":"a","version":"1.0.0","client":"./c.js"}"#;
        assert!(parse_manifest(raw).unwrap_err().contains("format"));
    }

    #[test]
    fn rejects_missing_id_or_version() {
        assert!(parse_manifest(r#"{"format":1,"version":"1.0.0","client":"./c.js"}"#).is_err());
        assert!(parse_manifest(r#"{"format":1,"id":"a","client":"./c.js"}"#).is_err());
    }

    #[test]
    fn rejects_a_manifest_without_any_half() {
        let raw = r#"{"format":1,"id":"a","version":"1.0.0"}"#;
        assert!(parse_manifest(raw).unwrap_err().contains("client"));
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
        assert!(version_matches(">1.2.3", "1.2.4").unwrap());
        assert!(!version_matches(">1.2.3", "1.2.3").unwrap());
    }

    #[test]
    fn rejects_unsupported_range_syntax() {
        assert!(version_matches("^1.2.0", "1.2.3").is_err());
        assert!(version_matches("~1.2.0", "1.2.3").is_err());
        assert!(version_matches("1.x", "1.2.3").is_err());
    }
}
