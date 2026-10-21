//! 云端 / 自定义 TTS 服务。
//!
//! 只接入「标准 HTTP 接口」的服务商。
//!
//! 支持：
//! - OpenAI 兼容 `/audio/speech`（SiliconFlow、TTS-WebUI、LocalAI、GPT-SoVITS 等）
//! - ElevenLabs
//! - Azure Speech（REST / SSML）
//! - Google Cloud TTS（REST / API Key）
//! - 百度语音（OAuth + form）
//! - MiniMax
//! - 火山引擎 / 豆包（NDJSON）
//! - 自定义 HTTP（GET / POST + 模板）

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::media;
use crate::network::NetworkRuntime;
use crate::tts::{self, TtsAudio, TtsItem, TtsVoice};

pub const DEFAULT_TEST_TEXT: &str = "你好，这是一段语音合成测试。";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CloudTtsKind {
    #[default]
    Openai,
    Elevenlabs,
    Azure,
    Google,
    Baidu,
    Minimax,
    Volcengine,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudTtsProvider {
    pub id: String,
    pub name: String,
    pub kind: CloudTtsKind,
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub api_secret: String,
    pub app_id: String,
    pub group_id: String,
    pub region: String,
    pub model: String,
    pub voice: String,
    pub format: String,
    pub speed: f32,
    pub volume: f32,
    pub pitch: f32,
    /// 额外音色，换行 / 逗号分隔；留空则使用接口返回或内置列表。
    pub voices: String,
    /// 以下仅 `custom` 使用。
    pub method: String,
    pub headers: String,
    pub body: String,
    pub audio_path: String,
}

impl Default for CloudTtsProvider {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: CloudTtsKind::Openai,
            enabled: true,
            base_url: String::new(),
            api_key: String::new(),
            api_secret: String::new(),
            app_id: String::new(),
            group_id: String::new(),
            region: String::new(),
            model: String::new(),
            voice: String::new(),
            format: "mp3".into(),
            speed: 1.0,
            volume: 1.0,
            pitch: 0.0,
            voices: String::new(),
            method: "POST".into(),
            headers: String::new(),
            body: String::new(),
            audio_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudTtsConfig {
    pub providers: Vec<CloudTtsProvider>,
}

pub struct CloudTtsRuntime {
    inner: Mutex<CloudTtsConfig>,
    path: Option<PathBuf>,
}

impl CloudTtsRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<CloudTtsConfig>(&text).ok())
            .unwrap_or_default();
        for provider in &mut config.providers {
            normalize(provider);
        }
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> CloudTtsConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: CloudTtsConfig) -> CloudTtsConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    pub fn provider(&self, id: &str) -> Option<CloudTtsProvider> {
        self.get().providers.into_iter().find(|item| item.id == id)
    }

    fn save(&self, config: &CloudTtsConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[tts] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[tts] 序列化配置失败：{error}"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudTtsTest {
    pub path: String,
    pub duration: f64,
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cloud_tts_config(state: State<'_, Arc<CloudTtsRuntime>>) -> CloudTtsConfig {
    state.get()
}

#[tauri::command]
pub fn cloud_tts_set_config(
    state: State<'_, Arc<CloudTtsRuntime>>,
    mut providers: Vec<CloudTtsProvider>,
) -> CloudTtsConfig {
    for provider in &mut providers {
        normalize(provider);
    }
    state.set(CloudTtsConfig { providers })
}

#[tauri::command]
pub async fn cloud_tts_voices(
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudTtsProvider,
) -> Result<Vec<TtsVoice>, String> {
    let client = network.client()?;
    list_voices(&client, &provider).await
}

#[tauri::command]
pub async fn cloud_tts_test(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudTtsProvider,
    text: String,
) -> Result<CloudTtsTest, String> {
    let client = network.client()?;
    let text = if text.trim().is_empty() {
        DEFAULT_TEST_TEXT
    } else {
        text.trim()
    };
    let call = Call::new(&provider, &client).await?;
    let (bytes, ext) = call.speak(text).await?;
    if bytes.is_empty() {
        return Err("TTS 返回了空音频".into());
    }
    let path = write_audio(&app, &bytes, &ext)?;
    let duration = probe_duration(&app, &path).await;
    Ok(CloudTtsTest {
        path: path.to_string_lossy().into_owned(),
        duration,
    })
}

#[tauri::command]
pub async fn cloud_tts_synthesize(
    app: AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    state: State<'_, Arc<CloudTtsRuntime>>,
    provider_id: String,
    items: Vec<TtsItem>,
    voice: Option<String>,
) -> Result<Vec<TtsAudio>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let provider = state
        .provider(&provider_id)
        .ok_or_else(|| format!("未找到 TTS 服务：{provider_id}"))?;
    let client = network.client()?;
    tts::begin_task()?;
    let result = synthesize(&app, &client, &provider, &items, voice.as_deref()).await;
    tts::end_task();
    match &result {
        Ok(_) => tts::emit(&app, "done", 1.0, None),
        Err(error) => tts::emit(&app, "error", 0.0, Some(error.clone())),
    }
    result
}

fn normalize(provider: &mut CloudTtsProvider) {
    if provider.id.trim().is_empty() {
        provider.id = uuid::Uuid::new_v4().to_string();
    }
    if provider.name.trim().is_empty() {
        provider.name = default_name(provider.kind).to_string();
    }
    if provider.format.trim().is_empty() {
        provider.format = "mp3".into();
    }
    if provider.method.trim().is_empty() {
        provider.method = "POST".into();
    }
    provider.speed = provider.speed.clamp(0.25, 4.0);
    provider.volume = provider.volume.clamp(0.0, 4.0);
    provider.pitch = provider.pitch.clamp(-20.0, 20.0);
    provider.name = provider.name.trim().to_string();
    provider.base_url = provider.base_url.trim().to_string();
    provider.api_key = provider.api_key.trim().to_string();
    provider.api_secret = provider.api_secret.trim().to_string();
    provider.app_id = provider.app_id.trim().to_string();
    provider.group_id = provider.group_id.trim().to_string();
    provider.region = provider.region.trim().to_string();
    provider.model = provider.model.trim().to_string();
    provider.voice = provider.voice.trim().to_string();
    provider.voices = provider.voices.trim().to_string();
    provider.headers = provider.headers.trim().to_string();
    provider.body = provider.body.trim().to_string();
    provider.audio_path = provider.audio_path.trim().to_string();
}

pub fn default_name(kind: CloudTtsKind) -> &'static str {
    match kind {
        CloudTtsKind::Openai => "OpenAI Compatible",
        CloudTtsKind::Elevenlabs => "ElevenLabs",
        CloudTtsKind::Azure => "Azure Speech",
        CloudTtsKind::Google => "Google Cloud TTS",
        CloudTtsKind::Baidu => "Baidu TTS",
        CloudTtsKind::Minimax => "MiniMax",
        CloudTtsKind::Volcengine => "Volcengine",
        CloudTtsKind::Custom => "Custom HTTP",
    }
}

// ---------------------------------------------------------------------------
// 合成
// ---------------------------------------------------------------------------

async fn synthesize(
    app: &AppHandle,
    client: &reqwest::Client,
    provider: &CloudTtsProvider,
    items: &[TtsItem],
    voice: Option<&str>,
) -> Result<Vec<TtsAudio>, String> {
    let call = Call::new_with_voice(provider, client, voice).await?;
    let total = items.len().max(1);
    let mut output = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if tts::cancelled() {
            return Err("已取消".into());
        }
        let text = item.text.trim();
        if text.is_empty() {
            continue;
        }
        tts::emit(
            app,
            "synthesizing",
            (index as f32 + 0.5) / total as f32,
            Some(format!("正在合成第 {}/{} 段", index + 1, total)),
        );
        let (bytes, ext) = call.speak(text).await?;
        if bytes.is_empty() {
            return Err("TTS 返回了空音频".into());
        }
        let path = write_audio(app, &bytes, &ext)?;
        let duration = probe_duration(app, &path).await;
        output.push(TtsAudio {
            id: item.id.clone(),
            path: path.to_string_lossy().into_owned(),
            duration,
        });
    }
    Ok(output)
}

struct Call<'a> {
    provider: &'a CloudTtsProvider,
    client: &'a reqwest::Client,
    voice: String,
    baidu_token: Option<String>,
}

impl<'a> Call<'a> {
    async fn new(provider: &'a CloudTtsProvider, client: &'a reqwest::Client) -> Result<Self, String> {
        Self::new_with_voice(provider, client, None).await
    }

    async fn new_with_voice(
        provider: &'a CloudTtsProvider,
        client: &'a reqwest::Client,
        voice: Option<&str>,
    ) -> Result<Self, String> {
        let voice = voice
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| provider.voice.trim())
            .to_string();
        let baidu_token = if provider.kind == CloudTtsKind::Baidu {
            Some(baidu_token(client, provider).await?)
        } else {
            None
        };
        Ok(Self {
            provider,
            client,
            voice,
            baidu_token,
        })
    }

    async fn speak(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        match self.provider.kind {
            CloudTtsKind::Openai => self.openai(text).await,
            CloudTtsKind::Elevenlabs => self.elevenlabs(text).await,
            CloudTtsKind::Azure => self.azure(text).await,
            CloudTtsKind::Google => self.google(text).await,
            CloudTtsKind::Baidu => self.baidu(text).await,
            CloudTtsKind::Minimax => self.minimax(text).await,
            CloudTtsKind::Volcengine => self.volcengine(text).await,
            CloudTtsKind::Custom => self.custom(text).await,
        }
    }

    fn format(&self) -> String {
        let format = self.provider.format.trim().to_lowercase();
        if format.is_empty() {
            "mp3".into()
        } else {
            format
        }
    }

    fn timeout(&self) -> std::time::Duration {
        std::time::Duration::from_secs(120)
    }

    async fn openai(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        let base = if self.provider.base_url.trim().is_empty() {
            "https://api.openai.com/v1".to_string()
        } else {
            self.provider.base_url.trim().trim_end_matches('/').to_string()
        };
        let url = if base.ends_with("/audio/speech") {
            base
        } else {
            format!("{base}/audio/speech")
        };
        let format = self.format();
        let voice = if self.voice.is_empty() {
            "alloy"
        } else {
            self.voice.as_str()
        };
        let model = if self.provider.model.trim().is_empty() {
            "tts-1"
        } else {
            self.provider.model.trim()
        };
        let mut body = json!({
            "model": model,
            "input": text,
            "voice": voice,
            "response_format": format,
        });
        if (self.provider.speed - 1.0).abs() > f32::EPSILON {
            body["speed"] = json!(self.provider.speed);
        }
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.provider.api_key)
            .json(&body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("OpenAI 兼容接口请求失败：{error}"))?;
        read_audio(response, "OpenAI 兼容接口", &format).await
    }

    async fn elevenlabs(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        if self.voice.is_empty() {
            return Err("ElevenLabs 需要填写 Voice ID".into());
        }
        let base = if self.provider.base_url.trim().is_empty() {
            "https://api.elevenlabs.io/v1".to_string()
        } else {
            self.provider.base_url.trim().trim_end_matches('/').to_string()
        };
        let url = if base.ends_with("/text-to-speech") {
            format!("{base}/{}", self.voice)
        } else {
            format!("{base}/text-to-speech/{}", self.voice)
        };
        let url = push_query(&url, "output_format", "mp3_44100_128");
        let model = if self.provider.model.trim().is_empty() {
            "eleven_multilingual_v2"
        } else {
            self.provider.model.trim()
        };
        let mut voice_settings = json!({
            "stability": 0.5,
            "similarity_boost": 0.75,
        });
        if (self.provider.speed - 1.0).abs() > f32::EPSILON {
            voice_settings["speed"] = json!(self.provider.speed);
        }
        let body = json!({
            "text": text,
            "model_id": model,
            "voice_settings": voice_settings,
        });
        let response = self
            .client
            .post(&url)
            .header("xi-api-key", &self.provider.api_key)
            .json(&body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("ElevenLabs 请求失败：{error}"))?;
        read_audio(response, "ElevenLabs", "mp3").await
    }

    async fn azure(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        if self.voice.is_empty() {
            return Err("Azure 需要填写音色（如 zh-CN-XiaoxiaoNeural）".into());
        }
        let url = if !self.provider.base_url.trim().is_empty() {
            self.provider.base_url.trim().to_string()
        } else {
            let region = if self.provider.region.trim().is_empty() {
                "eastasia"
            } else {
                self.provider.region.trim()
            };
            format!("https://{region}.tts.speech.microsoft.com/cognitiveservices/v1")
        };
        let lang = language_of(&self.voice);
        let output_format = match self.format().as_str() {
            "wav" => "riff-24khz-16bit-mono-pcm",
            "opus" | "ogg" => "ogg-16khz-16bit-mono-opus",
            _ => "audio-16khz-32kbitrate-mono-mp3",
        };
        let rate = format!(
            "{}{}%",
            if self.provider.speed >= 1.0 { "+" } else { "" },
            ((self.provider.speed - 1.0) * 100.0).round() as i32
        );
        let ssml = format!(
            "<speak version='1.0' xml:lang='{lang}'><voice name='{}'><prosody rate='{rate}'>{}</prosody></voice></speak>",
            xml_escape(&self.voice),
            xml_escape(text)
        );
        let response = self
            .client
            .post(&url)
            .header("Ocp-Apim-Subscription-Key", &self.provider.api_key)
            .header("Content-Type", "application/ssml+xml")
            .header("X-Microsoft-OutputFormat", output_format)
            .body(ssml)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("Azure 请求失败：{error}"))?;
        let actual_format = match self.format().as_str() {
            "wav" => "wav",
            "opus" | "ogg" => "opus",
            _ => "mp3",
        };
        read_audio(response, "Azure", actual_format).await
    }

    async fn google(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        if self.provider.api_key.trim().is_empty() {
            return Err("Google Cloud TTS 需要填写 API Key".into());
        }
        let base = if self.provider.base_url.trim().is_empty() {
            "https://texttospeech.googleapis.com".to_string()
        } else {
            self.provider.base_url.trim().trim_end_matches('/').to_string()
        };
        let url = format!(
            "{base}/v1/text:synthesize?key={}",
            url_encode(&self.provider.api_key)
        );
        let voice = if self.voice.is_empty() {
            "en-US-Studio-M"
        } else {
            self.voice.as_str()
        };
        let language = language_of(voice);
        let (encoding, actual_format) = match self.format().as_str() {
            "wav" => ("LINEAR16", "wav"),
            "opus" | "ogg" => ("OGG_OPUS", "opus"),
            _ => ("MP3", "mp3"),
        };
        let volume_gain = (20.0 * self.provider.volume.max(0.01).log10()).clamp(-96.0, 16.0);
        let body = json!({
            "input": { "text": text },
            "voice": { "languageCode": language, "name": voice },
            "audioConfig": {
                "audioEncoding": encoding,
                "speakingRate": self.provider.speed,
                "pitch": self.provider.pitch,
                "volumeGainDb": volume_gain,
            },
        });
        let response = self
            .client
            .post(&url)
            .json(&body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("Google TTS 请求失败：{error}"))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|error| format!("Google TTS 解析响应失败：{error}"))?;
        let Some(encoded) = value.get("audioContent").and_then(Value::as_str) else {
            return Err(format!(
                "Google TTS 返回错误（{status}）：{}",
                json_error(&value)
            ));
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("Google TTS 音频解码失败：{error}"))?;
        if encoding == "LINEAR16" {
            Ok((wrap_pcm_wav(&bytes, 24_000), "wav".into()))
        } else {
            Ok((bytes, ext_for(actual_format).to_string()))
        }
    }

    async fn baidu(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        let token = self
            .baidu_token
            .as_deref()
            .ok_or_else(|| "百度语音未获取到 access token".to_string())?;
        let voice = if self.voice.is_empty() {
            "0"
        } else {
            self.voice.as_str()
        };
        let params = vec![
            ("tex", text.to_string()),
            ("tok", token.to_string()),
            ("cuid", "ai-cut".to_string()),
            ("ctp", "1".to_string()),
            ("lan", "zh".to_string()),
            ("spd", scale_0_15(self.provider.speed).to_string()),
            ("pit", scale_0_15(self.provider.pitch / 10.0 + 1.0).to_string()),
            ("vol", scale_0_15(self.provider.volume).to_string()),
            ("per", voice.to_string()),
            ("aue", "3".to_string()),
        ];
        // reqwest 关闭默认特性后没有 `form`，这里手工拼 form body。
        let body = params
            .iter()
            .map(|(key, value)| format!("{}={}", url_encode(key), url_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        let response = self
            .client
            .post("https://tsn.baidu.com/text2audio")
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("百度语音请求失败：{error}"))?;
        read_audio(response, "百度语音", "mp3").await
    }

    async fn minimax(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        let base = if self.provider.base_url.trim().is_empty() {
            "https://api.minimax.chat".to_string()
        } else {
            self.provider.base_url.trim().trim_end_matches('/').to_string()
        };
        let url = if base.contains("/text_to_speech") {
            base
        } else {
            let url = format!("{base}/v1/text_to_speech");
            if self.provider.group_id.trim().is_empty() {
                url
            } else {
                push_query(&url, "GroupId", &url_encode(self.provider.group_id.trim()))
            }
        };
        let model = if self.provider.model.trim().is_empty() {
            "speech-01"
        } else {
            self.provider.model.trim()
        };
        let voice = if self.voice.is_empty() {
            "male-qn-qingse"
        } else {
            self.voice.as_str()
        };
        let body = json!({
            "model": model,
            "text": text,
            "voice_id": voice,
            "speed": self.provider.speed,
            "vol": self.provider.volume,
            "pitch": self.provider.pitch,
        });
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.provider.api_key)
            .json(&body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("MiniMax 请求失败：{error}"))?;
        read_audio(response, "MiniMax", "mp3").await
    }

    async fn volcengine(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        if self.provider.app_id.trim().is_empty() || self.provider.api_key.trim().is_empty() {
            return Err("火山引擎需要填写 App ID 和 Access Key".into());
        }
        let url = if self.provider.base_url.trim().is_empty() {
            "https://openspeech.bytedance.com/api/v3/tts/unidirectional".to_string()
        } else {
            self.provider.base_url.trim().to_string()
        };
        let resource = if self.provider.model.trim().is_empty() {
            "volc_tts_release"
        } else {
            self.provider.model.trim()
        };
        let voice = if self.voice.is_empty() {
            "zh_female_cancan_mars_bigtts"
        } else {
            self.voice.as_str()
        };
        let body = json!({
            "user": { "uid": "ai-cut" },
            "req_params": {
                "text": text,
                "speaker": voice,
                "speed_ratio": self.provider.speed,
                "audio_params": { "format": "mp3", "sample_rate": 24000 },
                "additions": "{\"disable_markdown_filter\":true}",
            },
        });
        let response = self
            .client
            .post(&url)
            .header("X-Api-App-Id", self.provider.app_id.trim())
            .header("X-Api-Access-Key", self.provider.api_key.trim())
            .header("X-Api-Resource-Id", resource)
            .json(&body)
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("火山引擎请求失败：{error}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| format!("火山引擎读取响应失败：{error}"))?;
        if !status.is_success() {
            return Err(format!(
                "火山引擎返回错误（{status}）：{}",
                truncate(&text, 320)
            ));
        }
        let mut audio = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let code = value.get("code").and_then(Value::as_i64).unwrap_or(0);
            if code != 0 && code != 20_000_000 {
                return Err(format!(
                    "火山引擎返回错误（{code}）：{}",
                    json_error(&value)
                ));
            }
            if let Some(data) = value.get("data").and_then(Value::as_str) {
                if let Ok(mut chunk) = base64::engine::general_purpose::STANDARD.decode(data) {
                    audio.append(&mut chunk);
                }
            }
        }
        if audio.is_empty() {
            return Err("火山引擎返回了空音频".into());
        }
        Ok((audio, "mp3".into()))
    }

    async fn custom(&self, text: &str) -> Result<(Vec<u8>, String), String> {
        let url = self.provider.base_url.trim();
        if url.is_empty() {
            return Err("自定义 TTS 需要填写接口地址".into());
        }
        let method = if self.provider.method.trim().is_empty() {
            "POST"
        } else {
            self.provider.method.trim()
        };
        let format = self.format();
        let uppercase = method.to_uppercase();
        let mut request = if uppercase == "GET" {
            self.client.get(fill_url(url, self.provider, text, &self.voice))
        } else {
            let body = if self.provider.body.trim().is_empty() {
                default_custom_body(text, &self.voice, self.provider.speed, &format)
            } else {
                fill_json(&self.provider.body, self.provider, text, &self.voice, &format)
            };
            self.client
                .post(url)
                .header("Content-Type", "application/json")
                .body(body)
        };
        for (name, value) in custom_headers(self.provider) {
            request = request.header(name, value);
        }
        if !self.provider.api_key.trim().is_empty()
            && !has_header(&self.provider.headers, "authorization")
        {
            request = request.bearer_auth(self.provider.api_key.trim());
        }
        let response = request
            .timeout(self.timeout())
            .send()
            .await
            .map_err(|error| format!("自定义 TTS 请求失败：{error}"))?;
        if self.provider.audio_path.trim().is_empty() {
            return read_audio(response, "自定义 TTS", &format).await;
        }
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|error| format!("自定义 TTS 解析响应失败：{error}"))?;
        let path = self.provider.audio_path.trim();
        let Some(encoded) = query_value(&value, path).and_then(Value::as_str) else {
            return Err(format!(
                "自定义 TTS 响应里没有 {path}（{status}）：{}",
                json_error(&value)
            ));
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("自定义 TTS 音频解码失败：{error}"))?;
        Ok(finish_audio(bytes, &format))
    }
}

// ---------------------------------------------------------------------------
// 音色列表
// ---------------------------------------------------------------------------

async fn list_voices(
    client: &reqwest::Client,
    provider: &CloudTtsProvider,
) -> Result<Vec<TtsVoice>, String> {
    let mut voices: Vec<TtsVoice> = Vec::new();
    for raw in provider
        .voices
        .split(|ch| ch == '\n' || ch == ',' || ch == ';')
    {
        let id = raw.trim();
        if !id.is_empty() {
            push_voice(&mut voices, id, id, "Custom");
        }
    }
    if !provider.voice.trim().is_empty() {
        push_voice(
            &mut voices,
            provider.voice.trim(),
            provider.voice.trim(),
            "Configured",
        );
    }

    match provider.kind {
        CloudTtsKind::Elevenlabs => {
            if !provider.api_key.trim().is_empty() {
                let base = if provider.base_url.trim().is_empty() {
                    "https://api.elevenlabs.io/v1".to_string()
                } else {
                    provider.base_url.trim().trim_end_matches('/').to_string()
                };
                let url = format!("{base}/voices");
                let response = client
                    .get(&url)
                    .header("xi-api-key", provider.api_key.trim())
                    .timeout(std::time::Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|error| format!("ElevenLabs 音色请求失败：{error}"))?;
                let status = response.status();
                let value: Value = response
                    .json()
                    .await
                    .map_err(|error| format!("ElevenLabs 音色解析失败：{error}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "ElevenLabs 音色返回错误（{status}）：{}",
                        json_error(&value)
                    ));
                }
                if let Some(items) = value.get("voices").and_then(Value::as_array) {
                    for item in items {
                        let id = item.get("voice_id").and_then(Value::as_str).unwrap_or("");
                        if id.is_empty() {
                            continue;
                        }
                        let name = item.get("name").and_then(Value::as_str).unwrap_or(id);
                        let group = item
                            .get("labels")
                            .and_then(|labels| labels.get("language"))
                            .and_then(Value::as_str)
                            .unwrap_or("ElevenLabs");
                        push_voice(&mut voices, id, name, group);
                    }
                }
            }
        }
        CloudTtsKind::Azure => {
            if !provider.api_key.trim().is_empty() {
                let url = if !provider.base_url.trim().is_empty() {
                    format!(
                        "{}/cognitiveservices/voices/list",
                        provider.base_url.trim().trim_end_matches('/')
                    )
                } else {
                    let region = if provider.region.trim().is_empty() {
                        "eastasia"
                    } else {
                        provider.region.trim()
                    };
                    format!("https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list")
                };
                let response = client
                    .get(&url)
                    .header("Ocp-Apim-Subscription-Key", provider.api_key.trim())
                    .timeout(std::time::Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|error| format!("Azure 音色请求失败：{error}"))?;
                let status = response.status();
                let value: Value = response
                    .json()
                    .await
                    .map_err(|error| format!("Azure 音色解析失败：{error}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "Azure 音色返回错误（{status}）：{}",
                        json_error(&value)
                    ));
                }
                if let Some(items) = value.as_array() {
                    for item in items {
                        let id = item.get("ShortName").and_then(Value::as_str).unwrap_or("");
                        if id.is_empty() {
                            continue;
                        }
                        let name = item
                            .get("LocalName")
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                            .unwrap_or(id);
                        let group = item
                            .get("Locale")
                            .and_then(Value::as_str)
                            .unwrap_or("Azure");
                        push_voice(&mut voices, id, name, group);
                    }
                }
            }
        }
        CloudTtsKind::Google => {
            if !provider.api_key.trim().is_empty() {
                let base = if provider.base_url.trim().is_empty() {
                    "https://texttospeech.googleapis.com".to_string()
                } else {
                    provider.base_url.trim().trim_end_matches('/').to_string()
                };
                let url = format!(
                    "{base}/v1/voices?key={}",
                    url_encode(provider.api_key.trim())
                );
                let response = client
                    .get(&url)
                    .timeout(std::time::Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|error| format!("Google 音色请求失败：{error}"))?;
                let status = response.status();
                let value: Value = response
                    .json()
                    .await
                    .map_err(|error| format!("Google 音色解析失败：{error}"))?;
                if !status.is_success() {
                    return Err(format!(
                        "Google 音色返回错误（{status}）：{}",
                        json_error(&value)
                    ));
                }
                if let Some(items) = value.get("voices").and_then(Value::as_array) {
                    for item in items {
                        let id = item.get("name").and_then(Value::as_str).unwrap_or("");
                        if id.is_empty() {
                            continue;
                        }
                        let group = item
                            .get("languageCodes")
                            .and_then(Value::as_array)
                            .and_then(|codes| codes.first())
                            .and_then(Value::as_str)
                            .unwrap_or("Google");
                        push_voice(&mut voices, id, id, group);
                    }
                }
            }
        }
        CloudTtsKind::Openai => {
            // OpenAI 官方没有音色列表接口；openedai-speech / Kokoro-FastAPI 等兼容服务
            // 约定暴露 GET /v1/audio/voices。探测失败就静默退回内置列表。
            for (id, name) in openai_extra_voices(client, provider).await {
                push_voice(&mut voices, &id, &name, "OpenAI Compatible");
            }
            for voice in [
                "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage",
                "shimmer", "verse",
            ] {
                push_voice(&mut voices, voice, voice, "OpenAI");
            }
        }
        CloudTtsKind::Minimax => {
            for (id, name) in [
                ("male-qn-qingse", "青涩青年"),
                ("male-qn-jingying", "精英青年"),
                ("female-shaonv", "少女"),
                ("female-yujie", "御姐"),
                ("presenter_male", "男性主持人"),
                ("presenter_female", "女性主持人"),
                ("audiobook_male_1", "男性有声书"),
                ("audiobook_female_1", "女性有声书"),
            ] {
                push_voice(&mut voices, id, name, "MiniMax");
            }
        }
        CloudTtsKind::Baidu => {
            for (id, name) in [
                ("0", "度小美"),
                ("1", "度小宇"),
                ("3", "度逍遥"),
                ("4", "度丫丫"),
                ("5", "度小娇"),
                ("103", "度米朵"),
                ("106", "度博文"),
                ("110", "度小童"),
                ("111", "度小萌"),
                ("5003", "度逍遥（情感）"),
                ("5118", "度小鹿"),
            ] {
                push_voice(&mut voices, id, name, "Baidu");
            }
        }
        CloudTtsKind::Volcengine | CloudTtsKind::Custom => {}
    }

    Ok(voices)
}

/// 兼容服务常见的音色列表端点（OpenAI 官方没有）。
async fn openai_extra_voices(
    client: &reqwest::Client,
    provider: &CloudTtsProvider,
) -> Vec<(String, String)> {
    let base = provider.base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Vec::new();
    }
    for url in [format!("{base}/audio/voices"), format!("{base}/voices")] {
        let Ok(response) = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(6))
            .send()
            .await
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(value) = response.json::<Value>().await else {
            continue;
        };
        let voices = parse_voice_list(&value);
        if !voices.is_empty() {
            return voices;
        }
    }
    Vec::new()
}

fn parse_voice_list(value: &Value) -> Vec<(String, String)> {
    let items = value
        .get("voices")
        .and_then(Value::as_array)
        .or_else(|| value.get("data").and_then(Value::as_array))
        .or_else(|| value.as_array());
    let Some(items) = items else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        if let Some(id) = item.as_str() {
            if !id.trim().is_empty() {
                out.push((id.trim().to_string(), id.trim().to_string()));
            }
        } else if let Some(id) = item.get("id").and_then(Value::as_str) {
            if id.trim().is_empty() {
                continue;
            }
            let name = item.get("name").and_then(Value::as_str).unwrap_or(id);
            out.push((id.trim().to_string(), name.to_string()));
        }
    }
    out
}

fn push_voice(voices: &mut Vec<TtsVoice>, id: &str, name: &str, group: &str) {
    if voices.iter().any(|voice| voice.id == id) {
        return;
    }
    voices.push(TtsVoice {
        id: id.to_string(),
        name: name.to_string(),
        group: group.to_string(),
    });
}

// ---------------------------------------------------------------------------
// Provider 请求辅助
// ---------------------------------------------------------------------------

async fn baidu_token(
    client: &reqwest::Client,
    provider: &CloudTtsProvider,
) -> Result<String, String> {
    if provider.api_key.trim().is_empty() || provider.api_secret.trim().is_empty() {
        return Err("百度语音需要填写 API Key 和 Secret Key".into());
    }
    let key = provider.api_key.trim();
    let secret = provider.api_secret.trim();
    if let Some(token) = cached_baidu_token(key) {
        return Ok(token);
    }
    let url = format!(
        "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={}&client_secret={}",
        url_encode(key),
        url_encode(secret)
    );
    let response = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("百度语音获取 token 失败：{error}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("百度语音 token 解析失败：{error}"))?;
    let Some(token) = value.get("access_token").and_then(Value::as_str) else {
        return Err(format!(
            "百度语音 token 返回错误（{status}）：{}",
            json_error(&value)
        ));
    };
    store_baidu_token(key, token);
    Ok(token.to_string())
}

fn baidu_cache() -> &'static Mutex<HashMap<String, String>> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_baidu_token(key: &str) -> Option<String> {
    baidu_cache().lock().ok()?.get(key).cloned()
}

fn store_baidu_token(key: &str, token: &str) {
    if let Ok(mut cache) = baidu_cache().lock() {
        cache.insert(key.to_string(), token.to_string());
    }
}

async fn read_audio(
    response: reqwest::Response,
    label: &str,
    format: &str,
) -> Result<(Vec<u8>, String), String> {
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{label} 读取响应失败：{error}"))?
        .to_vec();
    if !status.is_success() || content_type.contains("json") {
        let text = String::from_utf8_lossy(&bytes);
        let trimmed = text.trim_start();
        let looks_json = trimmed.starts_with('{') || trimmed.starts_with('[');
        if !status.is_success() || looks_json {
            return Err(format!(
                "{label} 返回错误（{status}）：{}",
                truncate(&text, 320)
            ));
        }
    }
    Ok(finish_audio(bytes, format))
}

fn finish_audio(bytes: Vec<u8>, format: &str) -> (Vec<u8>, String) {
    if format == "pcm" {
        return (wrap_pcm_wav(&bytes, 24_000), "wav".into());
    }
    // 自定义接口经常不按声明的 format 返回，按文件头纠正扩展名。
    let ext = sniff_ext(&bytes).unwrap_or_else(|| ext_for(format));
    (bytes, ext.to_string())
}

fn sniff_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("flac");
    }
    if bytes.starts_with(b"ID3") {
        return Some("mp3");
    }
    if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        return Some("m4a");
    }
    if bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        let layer = (bytes[1] >> 1) & 0x03;
        return Some(if layer == 0 { "aac" } else { "mp3" });
    }
    None
}

fn ext_for(format: &str) -> &'static str {
    match format {
        "wav" => "wav",
        "opus" | "ogg" => "ogg",
        "flac" => "flac",
        "aac" => "m4a",
        _ => "mp3",
    }
}

fn write_audio(app: &AppHandle, bytes: &[u8], ext: &str) -> Result<PathBuf, String> {
    let dir = media::cache_dir(app)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("cloud-tts-{stamp}-{}.{ext}", uuid::Uuid::new_v4()));
    std::fs::write(&path, bytes).map_err(|error| format!("写入合成音频失败：{error}"))?;
    Ok(path)
}

async fn probe_duration(app: &AppHandle, path: &Path) -> f64 {
    match media::probe_media(
        app.clone(),
        path.to_string_lossy().into_owned(),
    )
    .await
    {
        Ok(meta) => meta.duration,
        Err(_) => 0.0,
    }
}

fn default_custom_body(text: &str, voice: &str, speed: f32, format: &str) -> String {
    json!({
        "text": text,
        "voice": voice,
        "speed": speed,
        "format": format,
    })
    .to_string()
}

fn fill_url(
    template: &str,
    provider: &CloudTtsProvider,
    text: &str,
    voice: &str,
) -> String {
    template
        .replace("{{text}}", &url_encode(text))
        .replace("{{voice}}", &url_encode(voice))
        .replace("{{speed}}", &provider.speed.to_string())
        .replace("{{volume}}", &provider.volume.to_string())
        .replace("{{pitch}}", &provider.pitch.to_string())
        .replace("{{format}}", &url_encode(&provider.format))
        .replace("{{api_key}}", &url_encode(&provider.api_key))
        .replace("{{api_secret}}", &url_encode(&provider.api_secret))
}

fn fill_json(
    template: &str,
    provider: &CloudTtsProvider,
    text: &str,
    voice: &str,
    format: &str,
) -> String {
    template
        .replace("{{text}}", &json_escape(text))
        .replace("{{voice}}", &json_escape(voice))
        .replace("{{speed}}", &provider.speed.to_string())
        .replace("{{volume}}", &provider.volume.to_string())
        .replace("{{pitch}}", &provider.pitch.to_string())
        .replace("{{format}}", &json_escape(format))
        .replace("{{api_key}}", &json_escape(&provider.api_key))
        .replace("{{api_secret}}", &json_escape(&provider.api_secret))
        .replace("{{app_id}}", &json_escape(&provider.app_id))
        .replace("{{group_id}}", &json_escape(&provider.group_id))
}

fn custom_headers(provider: &CloudTtsProvider) -> Vec<(String, String)> {
    let raw = provider.headers.trim();
    if raw.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    object
        .iter()
        .map(|(name, value)| {
            let text = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            let text = text
                .replace("{{api_key}}", &provider.api_key)
                .replace("{{api_secret}}", &provider.api_secret)
                .replace("{{app_id}}", &provider.app_id);
            (name.clone(), text)
        })
        .collect()
}

fn has_header(raw: &str, name: &str) -> bool {
    let raw = raw.trim();
    if raw.is_empty() {
        return false;
    }
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|object| {
            object
                .keys()
                .any(|key| key.eq_ignore_ascii_case(name))
        })
        .unwrap_or(false)
}

fn query_value<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for key in path.split('.') {
        current = current.get(key)?;
    }
    Some(current)
}

fn json_error(value: &Value) -> String {
    let message = value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("base_resp")
                .and_then(|resp| resp.get("status_msg"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            value
                .get("detail")
                .and_then(|detail| {
                    detail
                        .get("message")
                        .and_then(Value::as_str)
                        .or_else(|| detail.as_str())
                })
        })
        .or_else(|| value.get("err_msg").and_then(Value::as_str));
    match message {
        Some(message) => message.to_string(),
        None => truncate(&value.to_string(), 320),
    }
}

fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let mut out: String = trimmed.chars().take(limit).collect();
    if trimmed.chars().count() > limit {
        out.push('…');
    }
    out
}

fn language_of(voice: &str) -> String {
    let parts: Vec<&str> = voice.split('-').collect();
    if parts.len() >= 2 {
        format!("{}-{}", parts[0], parts[1])
    } else if voice.is_empty() {
        "zh-CN".into()
    } else {
        voice.to_string()
    }
}

fn scale_0_15(value: f32) -> i32 {
    ((value - 1.0) * 5.0 + 5.0).round().clamp(0.0, 15.0) as i32
}

fn push_query(url: &str, key: &str, value: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}{key}={value}")
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn json_escape(text: &str) -> String {
    match serde_json::to_string(text) {
        Ok(value) => value[1..value.len().saturating_sub(1)].to_string(),
        Err(_) => String::new(),
    }
}

fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_url_components() {
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("你好"), "%E4%BD%A0%E5%A5%BD");
        assert_eq!(url_encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn escapes_json_strings() {
        assert_eq!(json_escape("a\"b\n你"), "a\\\"b\\n你");
    }

    #[test]
    fn derives_language_from_voice() {
        assert_eq!(language_of("zh-CN-XiaoxiaoNeural"), "zh-CN");
        assert_eq!(language_of("cmn-CN-Wavenet-A"), "cmn-CN");
        assert_eq!(language_of(""), "zh-CN");
    }

    #[test]
    fn wraps_pcm_in_wav_header() {
        let wav = wrap_pcm_wav(&[0, 0, 1, 0], 24_000);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(wav.len(), 48);
    }

    #[test]
    fn sniffs_common_audio_containers() {
        assert_eq!(sniff_ext(b"RIFF\0\0\0\0WAVEfmt "), Some("wav"));
        assert_eq!(sniff_ext(b"OggS...."), Some("ogg"));
        assert_eq!(sniff_ext(&[0xFF, 0xFB]), Some("mp3"));
        assert_eq!(sniff_ext(&[0xFF, 0xF1]), Some("aac"));
        assert_eq!(sniff_ext(b"nope"), None);
    }

    #[test]
    fn follows_audio_path() {
        let value = json!({ "data": { "audio": "abc" } });
        assert_eq!(
            query_value(&value, "data.audio").and_then(Value::as_str),
            Some("abc")
        );
    }

    #[test]
    fn fills_custom_templates() {
        let provider = CloudTtsProvider {
            api_key: "k".into(),
            ..Default::default()
        };
        let body = fill_json(
            r#"{"text":"{{text}}","voice":"{{voice}}"}"#,
            &provider,
            "你好\"x",
            "v",
            "mp3",
        );
        assert!(body.contains("你好\\\"x"));
        let url = fill_url(
            "http://x/tts?text={{text}}&key={{api_key}}",
            &provider,
            "a b",
            "v",
        );
        assert_eq!(url, "http://x/tts?text=a%20b&key=k");
    }
}

fn wrap_pcm_wav(pcm: &[u8], sample_rate: u32) -> Vec<u8> {
    let channels: u16 = 1;
    let bits: u16 = 16;
    let data_len = pcm.len() as u32;
    let byte_rate = sample_rate * u32::from(channels) * u32::from(bits / 8);
    let block_align = channels * (bits / 8);
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}
