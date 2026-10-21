//! 剪辑智能体的 OpenAI 兼容端点配置（`ai.json`，明文）。

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl AgentConfig {
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
            && !self.api_key.trim().is_empty()
            && !self.model.trim().is_empty()
    }
}

pub struct AgentConfigRuntime {
    inner: Mutex<AgentConfig>,
    path: Option<PathBuf>,
}

impl AgentConfigRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        let config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<AgentConfig>(&text).ok())
            .unwrap_or_default();
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> AgentConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: AgentConfig) -> AgentConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    fn save(&self, config: &AgentConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[agent] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[agent] 序列化配置失败：{error}"),
        }
    }
}
