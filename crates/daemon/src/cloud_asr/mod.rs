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

use crate::asr::Transcript;
use crate::host::Host;
use crate::network::NetworkRuntime;

mod chunk;
mod errors;
mod merge;
mod parse;
mod request;
pub use chunk::{fixed_chunks, plan_chunks, SpeechSpan};
pub use parse::{parse_body, parse_custom, ParsedChunk};
pub use request::endpoint;
pub use errors::describe as describe_status;
pub use merge::Merged;

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

// ---------------------------------------------------------------------------
// 识别
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CloudAsrTest {
    pub text: String,
    pub duration: f64,
}

/// 设置页的「测试」：用一段素材跑完整链路，只回显前 40 字。
pub async fn cloud_asr_test(
    host: &dyn Host,
    network: &NetworkRuntime,
    provider: &CloudAsrProvider,
    path: &str,
) -> Result<CloudAsrTest, String> {
    let result = transcribe_inner(host, network, provider, path, None, false, Some(30.0)).await?;
    let text: String = result
        .cues
        .iter()
        .map(|cue| cue.text.as_str())
        .collect::<Vec<&str>>()
        .join("");
    if text.trim().is_empty() {
        return Err("没有识别到语音，换一个更清晰的素材试试".into());
    }
    Ok(CloudAsrTest {
        text: text.chars().take(40).collect(),
        duration: result.cues.last().map(|cue| cue.end).unwrap_or(0.0),
    })
}

/// 云端转写：解码 → VAD 切段 → 合并成块 → 逐块识别 → 合并时间轴。
pub async fn transcribe(
    host: &dyn Host,
    network: &NetworkRuntime,
    provider: &CloudAsrProvider,
    path: &str,
    language: Option<String>,
    want_words: bool,
) -> Result<Transcript, String> {
    transcribe_inner(host, network, provider, path, language, want_words, None).await
}

/// `total_limit` 只给设置页的「测试」用：只跑前 N 秒，别为一次测试把整段素材传上去。
async fn transcribe_inner(
    host: &dyn Host,
    network: &NetworkRuntime,
    provider: &CloudAsrProvider,
    path: &str,
    language: Option<String>,
    want_words: bool,
    total_limit: Option<f64>,
) -> Result<Transcript, String> {
    if provider.api_key.trim().is_empty() && provider.kind != CloudAsrKind::Custom {
        return Err(format!("{} 还没有填写 API Key", provider.name));
    }
    let client = network.client()?;
    let wav = crate::asr::temp_wav_path(host)?;
    crate::asr::extract_wav(host, path, &wav).await?;
    let duration = crate::asr::wav_duration(&wav)?;
    let samples = crate::asr::read_samples(&wav)?;

    let spans = crate::asr::speech_spans(host, &wav)?;
    let limit = if provider.max_seconds > 0.0 {
        provider.max_seconds
    } else {
        kind_max_seconds(provider.kind)
    };
    // 16 kHz 单声道 WAV ≈ 32 KB/s，字节上限再收一次口，避免只按秒数切导致超限。
    let byte_limit = (kind_max_bytes(provider.kind) as f64 * 0.9 / 32_000.0) as f32;
    let limit = limit.min(byte_limit.max(5.0));
    let duration = total_limit.map(|limit| duration.min(limit)).unwrap_or(duration);
    let mut blocks = match &spans {
        Some(spans) if !spans.is_empty() => plan_chunks(spans, limit),
        _ => fixed_chunks(duration, limit.min(30.0)),
    };
    if let Some(limit) = total_limit {
        blocks.retain(|(start, _)| *start < limit);
        for block in &mut blocks {
            block.1 = block.1.min(limit);
        }
    }

    let mut merged = Merged::default();
    let total = blocks.len().max(1);
    for (index, (start, end)) in blocks.iter().enumerate() {
        if crate::asr::cancelled() {
            let _ = std::fs::remove_file(&wav);
            return Err("已取消".into());
        }
        crate::asr::emit(
            host,
            "transcribing",
            0.1 + 0.85 * (index as f32 / total as f32),
            Some(format!("正在识别第 {}/{} 段", index + 1, total)),
        );
        let slice = crate::asr::samples_to_wav(&samples, *start, *end)?;
        let encoded =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &slice);
        let audio = request::AudioPart {
            wav: &slice,
            b64: &encoded,
            mime: "audio/wav",
        };
        let body = request::call(&client, provider, &audio, language.as_deref()).await?;
        let parsed = parse::parse_body(provider.kind, provider, &body)?;
        merge::append_chunk(&mut merged, parsed, *start, (*start, *end));
    }
    let _ = std::fs::remove_file(&wav);

    if merged.cues.is_empty() {
        return Err("没有识别到语音".into());
    }
    if !want_words {
        merged.words.clear();
    }
    Ok(Transcript {
        cues: merged.cues,
        words: merged.words,
        timed: merged.timed && want_words,
    })
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
