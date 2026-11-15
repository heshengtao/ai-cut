//! 云端 / 自定义语音识别服务（**无头可直接用**：只依赖 Host + NetworkRuntime）。
//!
//! 与 `cloud_tts` 同构：配置存 `<config_dir>/asr.json`，桌面壳转发命令，
//! 无头进程由 `rpc` 分发到这里。
//!
//! 只接入「标准 HTTP 接口」的服务商；一期是 9 个**同步**接口类型，
//! AWS（S3 异步）与讯飞（上传轮询）留到二期。

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CloudAsrKind {
    #[default]
    Openai,
    Deepseek,
    Azure,
    Google,
    Aliyun,
    Tencent,
    Volcengine,
    Baidu,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudAsrProvider {
    pub id: String,
    pub name: String,
    pub kind: CloudAsrKind,
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub api_secret: String,
    pub app_id: String,
    pub region: String,
    pub model: String,
    pub language: String,
    /// 单请求音频秒数上限；0 = 用 [`kind_max_seconds`] 的预置值。
    pub max_seconds: f32,
    /// 以下仅 `custom` 使用。
    pub method: String,
    pub headers: String,
    pub body: String,
    pub text_path: String,
    pub words_path: String,
}

impl Default for CloudAsrProvider {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: CloudAsrKind::Openai,
            enabled: true,
            base_url: String::new(),
            api_key: String::new(),
            api_secret: String::new(),
            app_id: String::new(),
            region: String::new(),
            model: String::new(),
            language: String::new(),
            max_seconds: 0.0,
            method: "POST".into(),
            headers: String::new(),
            body: String::new(),
            text_path: String::new(),
            words_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudAsrConfig {
    pub providers: Vec<CloudAsrProvider>,
}

pub struct CloudAsrRuntime {
    inner: Mutex<CloudAsrConfig>,
    path: Option<PathBuf>,
}

impl CloudAsrRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<CloudAsrConfig>(&text).ok())
            .unwrap_or_default();
        for provider in &mut config.providers {
            normalize(provider);
        }
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> CloudAsrConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: CloudAsrConfig) -> CloudAsrConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    pub fn provider(&self, id: &str) -> Option<CloudAsrProvider> {
        self.get().providers.into_iter().find(|item| item.id == id)
    }

    fn save(&self, config: &CloudAsrConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[asr] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[asr] 序列化配置失败：{error}"),
        }
    }
}

pub fn default_name(kind: CloudAsrKind) -> &'static str {
    match kind {
        CloudAsrKind::Openai => "OpenAI Compatible",
        CloudAsrKind::Deepseek => "DeepSeek",
        CloudAsrKind::Azure => "Azure Speech",
        CloudAsrKind::Google => "Google Cloud STT",
        CloudAsrKind::Aliyun => "Aliyun Bailian",
        CloudAsrKind::Tencent => "Tencent Cloud ASR",
        CloudAsrKind::Volcengine => "Volcengine",
        CloudAsrKind::Baidu => "Baidu ASR",
        CloudAsrKind::Custom => "Custom HTTP",
    }
}

/// 单请求音频秒数预置值。
pub fn kind_max_seconds(kind: CloudAsrKind) -> f32 {
    match kind {
        CloudAsrKind::Deepseek => 110.0,
        CloudAsrKind::Openai => 600.0,
        CloudAsrKind::Azure => 3600.0,
        CloudAsrKind::Google => 55.0,
        CloudAsrKind::Aliyun => 110.0,
        CloudAsrKind::Tencent => 600.0,
        CloudAsrKind::Volcengine => 600.0,
        CloudAsrKind::Baidu => 55.0,
        CloudAsrKind::Custom => 60.0,
    }
}

/// 单请求字节上限（内置常量，不进配置）。
pub fn kind_max_bytes(kind: CloudAsrKind) -> usize {
    match kind {
        CloudAsrKind::Deepseek => 8 * 1024 * 1024,
        CloudAsrKind::Openai => 25 * 1024 * 1024,
        CloudAsrKind::Azure => 500 * 1024 * 1024,
        CloudAsrKind::Google => 10 * 1024 * 1024,
        CloudAsrKind::Baidu => 10 * 1024 * 1024,
        _ => 60 * 1024 * 1024,
    }
}

pub fn normalize(provider: &mut CloudAsrProvider) {
    if provider.id.trim().is_empty() {
        provider.id = uuid::Uuid::new_v4().to_string();
    }
    provider.name = provider.name.trim().to_string();
    if provider.name.is_empty() {
        provider.name = default_name(provider.kind).to_string();
    }
    provider.base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    provider.api_key = provider.api_key.trim().to_string();
    provider.api_secret = provider.api_secret.trim().to_string();
    provider.app_id = provider.app_id.trim().to_string();
    provider.region = provider.region.trim().to_string();
    provider.model = provider.model.trim().to_string();
    provider.language = provider.language.trim().to_string();
    provider.method = if provider.method.trim().is_empty() {
        "POST".into()
    } else {
        provider.method.trim().to_uppercase()
    };
    provider.headers = provider.headers.trim().to_string();
    provider.body = provider.body.trim().to_string();
    provider.text_path = provider.text_path.trim().to_string();
    provider.words_path = provider.words_path.trim().to_string();
    provider.max_seconds = provider.max_seconds.clamp(0.0, 7200.0);
}

pub fn cloud_asr_config(state: &CloudAsrRuntime) -> CloudAsrConfig {
    state.get()
}

pub fn cloud_asr_set_config(
    state: &CloudAsrRuntime,
    mut providers: Vec<CloudAsrProvider>,
) -> CloudAsrConfig {
    for provider in &mut providers {
        normalize(provider);
    }
    state.set(CloudAsrConfig { providers })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_a_fresh_provider() {
        let mut provider = CloudAsrProvider {
            kind: CloudAsrKind::Deepseek,
            ..Default::default()
        };
        normalize(&mut provider);
        assert!(!provider.id.is_empty(), "缺少 id");
        assert_eq!(provider.name, "DeepSeek");
        assert_eq!(provider.method, "POST");
        assert!(provider.max_seconds >= 0.0);
    }

    #[test]
    fn keeps_user_name_and_limits() {
        let mut provider = CloudAsrProvider {
            name: "  我的识别  ".into(),
            kind: CloudAsrKind::Tencent,
            max_seconds: 90.0,
            ..Default::default()
        };
        normalize(&mut provider);
        assert_eq!(provider.name, "我的识别");
        assert_eq!(provider.max_seconds, 90.0);
    }

    #[test]
    fn clamps_absurd_max_seconds() {
        let mut provider = CloudAsrProvider {
            max_seconds: 99_999.0,
            ..Default::default()
        };
        normalize(&mut provider);
        assert_eq!(provider.max_seconds, 7200.0);
    }

    #[test]
    fn presets_match_the_spec() {
        assert_eq!(kind_max_seconds(CloudAsrKind::Deepseek), 110.0);
        assert_eq!(kind_max_seconds(CloudAsrKind::Openai), 600.0);
        assert_eq!(kind_max_seconds(CloudAsrKind::Azure), 3600.0);
        assert_eq!(kind_max_seconds(CloudAsrKind::Google), 55.0);
        assert_eq!(kind_max_seconds(CloudAsrKind::Baidu), 55.0);
        assert_eq!(kind_max_bytes(CloudAsrKind::Deepseek), 8 * 1024 * 1024);
        assert_eq!(kind_max_bytes(CloudAsrKind::Openai), 25 * 1024 * 1024);
    }
}
