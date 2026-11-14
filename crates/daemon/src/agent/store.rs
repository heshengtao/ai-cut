//! 会话持久化：树形消息。
//!
//! 每个会话是一棵「节点树」：`Node` 带 `parent` 链，`head` 指向当前活跃叶。
//! 「编辑某条用户输入后重答」= 建一个同父兄弟节点并切换 `head`，因此天然支持分支。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub parent: Option<String>,
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallRef>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub head: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub count: usize,
}

#[derive(Clone)]
pub struct SessionStore {
    dir: Option<PathBuf>,
}

impl SessionStore {
    pub fn new(dir: Option<PathBuf>) -> Self {
        if let Some(dir) = &dir {
            let _ = std::fs::create_dir_all(dir);
        }
        Self { dir }
    }

    fn file(&self, id: &str) -> Option<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return None;
        }
        self.dir.as_ref().map(|dir| dir.join(format!("{id}.json")))
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        let Some(dir) = &self.dir else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut out: Vec<SessionSummary> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    return None;
                }
                let text = std::fs::read_to_string(&path).ok()?;
                let session: Session = serde_json::from_str(&text).ok()?;
                Some(SessionSummary {
                    id: session.id,
                    title: session.title,
                    updated_at: session.updated_at,
                    count: session
                        .nodes
                        .iter()
                        .filter(|node| node.role != "tool")
                        .count(),
                })
            })
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    pub fn load(&self, id: &str) -> Option<Session> {
        let path = self.file(id)?;
        let text = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn save(&self, session: &Session) -> Result<(), String> {
        let Some(path) = self.file(&session.id) else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        }
        let json = serde_json::to_string_pretty(session).map_err(|error| error.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|error| error.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|error| error.to_string())
    }

    pub fn delete(&self, id: &str) {
        if let Some(path) = self.file(id) {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        now_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn title_from(text: &str) -> String {
    let title: String = text.trim().chars().take(24).collect();
    if title.is_empty() {
        "新对话".into()
    } else {
        title
    }
}
