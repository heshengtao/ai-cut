# 云端语音识别服务（ASR Providers）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让语音识别下拉支持「首项跳转设置页配置云 API」，并接入 9 家同步协议的云 ASR 与 DeepSeek 的 ASR/TTS。

**Architecture:** 在 `crates/daemon` 里新增 `cloud_asr/` 模块（配置中心 + 协议适配 + 切段合并），`asr.rs` 只在 `transcribe_file` 入口按 `cloud:` 前缀分流，三个调用方（字幕 / 剪口播 / 参考音频）签名不变。前端复刻 TTS 的形态：`SettingsSection` 新增 `asr`，下拉首项是 `action` 项。

**Tech Stack:** Rust（reqwest 0.13 + serde_json + sherpa-onnx 的 Silero VAD）、Vue 3 + Pinia + Vitest、Tauri 命令薄壳、`crates/daemon` 的 RPC。

## Global Constraints

- 规格来源：`docs/superpowers/specs/2026-11-15-cloud-asr-providers-design.md`（下称「spec」），实现与 spec 冲突时以 spec 为准并回头改 spec。
- 一期只做 9 个同步 kind：`openai deepseek azure google aliyun tencent volcengine baidu custom`；**不要**实现 AWS、讯飞。
- 所有新配置字段必须 `#[serde(default)]`，保证旧 `asr.json`（不存在时）与二期字段兼容。
- daemon 里**禁止** `tauri` 引用；桌面壳只做 `#[tauri::command]` 转发。
- i18n 必须 zh/en 双写，键名一致。
- 两道门禁必须全绿：`pnpm test`、`pnpm build`、`cargo test --manifest-path crates/daemon/Cargo.toml`。
- 不修改 `src/core/{ops,commands,serialize}`，因此**不重生成** golden。
- 密钥明文存 `<config_dir>/asr.json`，与 `tts.json` 一致，不新增加密层。

---

### Task 1: cloud_asr 模块骨架与配置中心

**Files:**
- Create: `crates/daemon/src/cloud_asr/mod.rs`
- Modify: `crates/daemon/src/lib.rs`（`pub mod cloud_asr;`）
- Test: `crates/daemon/src/cloud_asr/mod.rs` 内 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `crate::host::Host`、`crate::network::NetworkRuntime`（本任务只用到 Host 的 config_dir）。
- Produces:
  - `pub enum CloudAsrKind { Openai, Deepseek, Azure, Google, Aliyun, Tencent, Volcengine, Baidu, Custom }`（`#[serde(rename_all = "snake_case")]`）
  - `pub struct CloudAsrProvider { id, name, kind, enabled, base_url, api_key, api_secret, app_id, region, model, language, max_seconds: f32, method, headers, body, text_path, words_path }`
  - `pub struct CloudAsrConfig { pub providers: Vec<CloudAsrProvider> }`
  - `pub struct CloudAsrRuntime { /* Mutex<CloudAsrConfig> + Option<PathBuf> */ }`，方法 `load(Option<PathBuf>) / get() / set(CloudAsrConfig) / provider(&str) -> Option<CloudAsrProvider>`
  - `pub fn default_name(kind: CloudAsrKind) -> &'static str`
  - `pub fn normalize(provider: &mut CloudAsrProvider)`
  - `pub fn kind_max_seconds(kind: CloudAsrKind) -> f32`
  - `pub fn kind_max_bytes(kind: CloudAsrKind) -> usize`
  - `pub fn cloud_asr_config(state: &CloudAsrRuntime) -> CloudAsrConfig`
  - `pub fn cloud_asr_set_config(state: &CloudAsrRuntime, providers: Vec<CloudAsrProvider>) -> CloudAsrConfig`

- [ ] **Step 1: 写失败测试**

在 `crates/daemon/src/cloud_asr/mod.rs` 末尾：

```rust
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr -- --nocapture`
Expected: 编译失败（`CloudAsrProvider` 不存在）

- [ ] **Step 3: 实现类型、预置与配置中心**

```rust
//! 云端 / 自定义语音识别服务（无头可直接用：只依赖 Host + NetworkRuntime）。
//!
//! 与 `cloud_tts` 同构：配置存 `<config_dir>/asr.json`，桌面壳转发命令，
//! 无头进程由 `rpc` 分发到这里。

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
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(config) {
            if let Err(error) = std::fs::write(path, json) {
                eprintln!("[asr] 写入配置失败：{error}");
            }
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

/// 单请求音频秒数预置值（spec「切段与合并」）。
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
```

在 `crates/daemon/src/lib.rs` 的 `pub mod cloud_tts;` 之后加一行 `pub mod cloud_asr;`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr -- --nocapture`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_asr/mod.rs crates/daemon/src/lib.rs
git commit -m "feat(cloud-asr): 配置中心与接口类型定义"
```

---

### Task 2: 切段计划（纯函数）

**Files:**
- Create: `crates/daemon/src/cloud_asr/chunk.rs`
- Modify: `crates/daemon/src/cloud_asr/mod.rs`（`mod chunk; pub use chunk::*;`）
- Test: `crates/daemon/src/cloud_asr/chunk.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `pub struct SpeechSpan { pub start: f64, pub end: f64 }`
  - `pub fn plan_chunks(spans: &[SpeechSpan], max_seconds: f32) -> Vec<(f64, f64)>` —— 合并相邻语音段，块边界落在语音段边界，块长度 ≤ max_seconds（单段本身超限时独占一块，不切段内）
  - `pub fn fixed_chunks(duration: f64, max_seconds: f32) -> Vec<(f64, f64)>` —— 无 VAD 时的定长切片

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn span(start: f64, end: f64) -> SpeechSpan {
        SpeechSpan { start, end }
    }

    #[test]
    fn merges_spans_that_fit() {
        let spans = [span(0.0, 2.0), span(3.0, 6.0), span(7.0, 8.0)];
        assert_eq!(plan_chunks(&spans, 30.0), vec![(0.0, 8.0)]);
    }

    #[test]
    fn breaks_before_exceeding_the_limit() {
        let spans = [span(0.0, 10.0), span(11.0, 20.0)];
        assert_eq!(plan_chunks(&spans, 15.0), vec![(0.0, 10.0), (11.0, 20.0)]);
    }

    #[test]
    fn keeps_an_oversized_span_on_its_own() {
        let spans = [span(0.0, 40.0), span(41.0, 42.0)];
        assert_eq!(plan_chunks(&spans, 15.0), vec![(0.0, 40.0), (41.0, 42.0)]);
    }

    #[test]
    fn skips_empty_spans() {
        let spans = [span(5.0, 5.0), span(6.0, 7.0)];
        assert_eq!(plan_chunks(&spans, 30.0), vec![(6.0, 7.0)]);
    }

    #[test]
    fn fixed_chunks_covers_the_whole_duration() {
        let chunks = fixed_chunks(75.0, 30.0);
        assert_eq!(chunks, vec![(0.0, 30.0), (30.0, 60.0), (60.0, 75.0)]);
    }

    #[test]
    fn fixed_chunks_ignores_tiny_tail() {
        assert_eq!(fixed_chunks(30.02, 30.0), vec![(0.0, 30.0)]);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::chunk`
Expected: 编译失败（模块不存在）

- [ ] **Step 3: 实现**

```rust
//! 把语音段合并成云服务能接受的请求块。

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SpeechSpan {
    pub start: f64,
    pub end: f64,
}

/// 块长上限的最小值：比 5 秒更小的设置没有意义，还会把词切碎。
const MIN_LIMIT: f32 = 5.0;

pub fn plan_chunks(spans: &[SpeechSpan], max_seconds: f32) -> Vec<(f64, f64)> {
    let limit = max_seconds.max(MIN_LIMIT) as f64;
    let mut out: Vec<(f64, f64)> = Vec::new();
    let mut current: Option<(f64, f64)> = None;
    for span in spans {
        if span.end <= span.start {
            continue;
        }
        match current {
            None => current = Some((span.start, span.end)),
            Some((start, end)) => {
                if span.end - start > limit {
                    out.push((start, end));
                    current = Some((span.start, span.end));
                } else {
                    current = Some((start, span.end));
                }
            }
        }
    }
    if let Some(block) = current {
        out.push(block);
    }
    out
}

/// 没有 VAD 模型时的退路：定长切片。
pub fn fixed_chunks(duration: f64, max_seconds: f32) -> Vec<(f64, f64)> {
    let step = max_seconds.max(MIN_LIMIT) as f64;
    let mut out = Vec::new();
    let mut start = 0.0;
    while start < duration {
        let end = (start + step).min(duration);
        if end - start > 0.05 {
            out.push((start, end));
        }
        start = end;
    }
    out
}
```

`mod.rs` 里加：

```rust
mod chunk;
pub use chunk::{fixed_chunks, plan_chunks, SpeechSpan};
```

`chunk.rs` 顶部需要 `use serde::{Deserialize, Serialize};`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::chunk`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_asr
git commit -m "feat(cloud-asr): 语音段合并与定长切片"
```

---

### Task 3: 响应解析（9 个 kind）

**Files:**
- Create: `crates/daemon/src/cloud_asr/parse.rs`
- Modify: `crates/daemon/src/cloud_asr/mod.rs`（`mod parse; pub use parse::*;`）
- Test: `crates/daemon/src/cloud_asr/parse.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: `CloudAsrKind`、`CloudAsrProvider`（Task 1）。
- Produces:
  - `pub struct ParsedChunk { pub text: String, pub sentences: Vec<(f64, f64, String)>, pub words: Vec<(String, f64, f64)> }`
  - `impl ParsedChunk { pub fn has_time(&self) -> bool }`
  - `pub fn parse_body(kind: CloudAsrKind, provider: &CloudAsrProvider, body: &[u8]) -> Result<ParsedChunk, String>` —— 按 kind 分派；`body` 是原始响应字节（非 JSON 时报错带前 200 字）
  - 单独暴露便于测试：`parse_openai / parse_deepseek / parse_azure / parse_google / parse_aliyun / parse_tencent / parse_volcengine / parse_baidu / parse_custom`

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn value(v: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn openai_verbose_json_gives_sentences_and_words() {
        let raw = value(json!({
            "text": "你好世界",
            "segments": [{"start": 0.0, "end": 1.5, "text": "你好"}],
            "words": [{"word": "你好", "start": 0.0, "end": 1.5}]
        }));
        let chunk = parse_openai(&raw).unwrap();
        assert_eq!(chunk.text, "你好世界");
        assert_eq!(chunk.sentences, vec![(0.0, 1.5, "你好".to_string())]);
        assert_eq!(chunk.words, vec![("你好".to_string(), 0.0, 1.5)]);
        assert!(chunk.has_time());
    }

    #[test]
    fn deepseek_returns_text_only() {
        let raw = value(json!({"request_id": "r", "text": "今天天气不错", "duration_ms": 3200}));
        let chunk = parse_deepseek(&raw).unwrap();
        assert_eq!(chunk.text, "今天天气不错");
        assert!(!chunk.has_time());
    }

    #[test]
    fn azure_phrases_use_milliseconds() {
        let raw = value(json!({
            "phrases": [{
                "offsetMilliseconds": 960,
                "durationMilliseconds": 640,
                "text": "Good afternoon.",
                "words": [{"text": "Good", "offsetMilliseconds": 960, "durationMilliseconds": 240}]
            }]
        }));
        let chunk = parse_azure(&raw).unwrap();
        assert_eq!(chunk.sentences[0].0, 0.96);
        assert!((chunk.sentences[0].1 - 1.6).abs() < 1e-9);
        assert_eq!(chunk.words[0].0, "Good");
    }

    #[test]
    fn google_offsets_are_seconds_with_suffix() {
        let raw = value(json!({
            "results": [{
                "alternatives": [{
                    "transcript": "hello",
                    "words": [{"word": "hello", "startOffset": "0.100s", "endOffset": "0.900s"}]
                }]
            }]
        }));
        let chunk = parse_google(&raw).unwrap();
        assert_eq!(chunk.text, "hello");
        assert_eq!(chunk.words[0], ("hello".to_string(), 0.1, 0.9));
    }

    #[test]
    fn aliyun_reads_openai_chat_content() {
        let raw = value(json!({
            "choices": [{"message": {"content": "这是识别结果"}}]
        }));
        let chunk = parse_aliyun(&raw).unwrap();
        assert_eq!(chunk.text, "这是识别结果");
        assert!(!chunk.has_time());
    }

    #[test]
    fn tencent_words_are_milliseconds() {
        let raw = value(json!({
            "result": {
                "voice_text_str": "你好",
                "words": [{"word": "你好", "start_time": 0, "end_time": 1200}]
            }
        }));
        let chunk = parse_tencent(&raw).unwrap();
        assert_eq!(chunk.words[0], ("你好".to_string(), 0.0, 1.2));
    }

    #[test]
    fn volcengine_utterances_carry_words() {
        let raw = value(json!({
            "result": {
                "text": "你好",
                "utterances": [{
                    "start_time": 0, "end_time": 1200, "text": "你好",
                    "words": [{"text": "你好", "start_time": 0, "end_time": 1200}]
                }]
            }
        }));
        let chunk = parse_volcengine(&raw).unwrap();
        assert_eq!(chunk.sentences, vec![(0.0, 1.2, "你好".to_string())]);
        assert_eq!(chunk.words[0].2, 1.2);
    }

    #[test]
    fn baidu_reports_error_code() {
        let raw = value(json!({"err_no": 3301, "err_msg": "speech quality error"}));
        let error = parse_baidu(&raw).unwrap_err();
        assert!(error.contains("3301"), "错误文案缺少错误码：{error}");
    }

    #[test]
    fn custom_follows_text_and_words_paths() {
        let provider = CloudAsrProvider {
            text_path: "data.transcript".into(),
            words_path: "data.items".into(),
            ..Default::default()
        };
        let raw = value(json!({
            "data": {
                "transcript": "自定义",
                "items": [{"text": "自定义", "start": 0.5, "end": 1.5}]
            }
        }));
        let chunk = parse_custom(&provider, &raw).unwrap();
        assert_eq!(chunk.text, "自定义");
        assert_eq!(chunk.words[0], ("自定义".to_string(), 0.5, 1.5));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::parse`
Expected: 编译失败

- [ ] **Step 3: 实现解析器**

```rust
//! 各家响应 → 统一的文本 / 句时间 / 词时间。所有时间统一换算成秒。

use serde_json::Value;

use super::{CloudAsrKind, CloudAsrProvider};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedChunk {
    pub text: String,
    /// 句级时间（相对块起点）；空 = 该服务没有原生时间。
    pub sentences: Vec<(f64, f64, String)>,
    /// 词级时间（相对块起点）。
    pub words: Vec<(String, f64, f64)>,
}

impl ParsedChunk {
    pub fn has_time(&self) -> bool {
        !self.sentences.is_empty() || !self.words.is_empty()
    }
}

pub fn parse_body(
    kind: CloudAsrKind,
    provider: &CloudAsrProvider,
    body: &[u8],
) -> Result<ParsedChunk, String> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("响应不是 JSON：{error}；原文：{}", preview(body)))?;
    match kind {
        CloudAsrKind::Openai => parse_openai_value(&value),
        CloudAsrKind::Deepseek => parse_deepseek_value(&value),
        CloudAsrKind::Azure => parse_azure_value(&value),
        CloudAsrKind::Google => parse_google_value(&value),
        CloudAsrKind::Aliyun => parse_aliyun_value(&value),
        CloudAsrKind::Tencent => parse_tencent_value(&value),
        CloudAsrKind::Volcengine => parse_volcengine_value(&value),
        CloudAsrKind::Baidu => parse_baidu_value(&value),
        CloudAsrKind::Custom => parse_custom_value(provider, &value),
    }
}

// 测试直接调用的包装：解析失败时把原文前 200 字带进错误。
pub fn parse_openai(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_openai_value)
}
pub fn parse_deepseek(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_deepseek_value)
}
pub fn parse_azure(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_azure_value)
}
pub fn parse_google(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_google_value)
}
pub fn parse_aliyun(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_aliyun_value)
}
pub fn parse_tencent(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_tencent_value)
}
pub fn parse_volcengine(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_volcengine_value)
}
pub fn parse_baidu(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_baidu_value)
}
pub fn parse_custom(provider: &CloudAsrProvider, raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, |value| parse_custom_value(provider, value))
}

fn parse_value(raw: &[u8], run: impl Fn(&Value) -> Result<ParsedChunk, String>) -> Result<ParsedChunk, String> {
    let value: Value = serde_json::from_slice(raw)
        .map_err(|error| format!("响应不是 JSON：{error}；原文：{}", preview(raw)))?;
    run(&value)
}

fn preview(raw: &[u8]) -> String {
    String::from_utf8_lossy(&raw[..raw.len().min(200)]).to_string()
}

fn as_secs(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    let text = value.as_str()?.trim_end_matches('s');
    text.parse::<f64>().ok()
}

fn as_ms(value: &Value) -> Option<f64> {
    value.as_f64().map(|ms| ms / 1000.0)
}

fn parse_openai_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk {
        text: value.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    };
    for segment in value.get("segments").and_then(Value::as_array).into_iter().flatten() {
        let (Some(start), Some(end)) = (segment.get("start").and_then(as_secs), segment.get("end").and_then(as_secs)) else {
            continue;
        };
        let text = segment.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, end, text));
        }
    }
    for word in value.get("words").and_then(Value::as_array).into_iter().flatten() {
        let (Some(start), Some(end)) = (word.get("start").and_then(as_secs), word.get("end").and_then(as_secs)) else {
            continue;
        };
        if let Some(text) = word.get("word").and_then(Value::as_str) {
            chunk.words.push((text.trim().to_string(), start, end));
        }
    }
    Ok(chunk)
}

fn parse_deepseek_value(value: &Value) -> Result<ParsedChunk, String> {
    if let Some(message) = value.get("error").and_then(|error| error.get("message")).and_then(Value::as_str) {
        return Err(format!("DeepSeek 返回错误：{message}"));
    }
    Ok(ParsedChunk {
        text: value.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    })
}

fn parse_azure_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk::default();
    for phrase in value.get("phrases").and_then(Value::as_array).into_iter().flatten() {
        let start = phrase.get("offsetMilliseconds").and_then(as_ms).unwrap_or(0.0);
        let duration = phrase.get("durationMilliseconds").and_then(as_ms).unwrap_or(0.0);
        let text = phrase.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, start + duration, text));
        }
        for word in phrase.get("words").and_then(Value::as_array).into_iter().flatten() {
            let word_start = word.get("offsetMilliseconds").and_then(as_ms).unwrap_or(start);
            let word_duration = word.get("durationMilliseconds").and_then(as_ms).unwrap_or(0.0);
            if let Some(text) = word.get("text").and_then(Value::as_str) {
                chunk.words.push((text.to_string(), word_start, word_start + word_duration));
            }
        }
    }
    chunk.text = chunk.sentences.iter().map(|(_, _, text)| text.as_str()).collect::<Vec<_>>().join(" ");
    Ok(chunk)
}

fn parse_google_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk::default();
    for result in value.get("results").and_then(Value::as_array).into_iter().flatten() {
        for alternative in result.get("alternatives").and_then(Value::as_array).into_iter().flatten().take(1) {
            if let Some(text) = alternative.get("transcript").and_then(Value::as_str) {
                chunk.text.push_str(text);
            }
            for word in alternative.get("words").and_then(Value::as_array).into_iter().flatten() {
                let (Some(start), Some(end)) = (
                    word.get("startOffset").and_then(as_secs),
                    word.get("endOffset").and_then(as_secs),
                ) else {
                    continue;
                };
                if let Some(text) = word.get("word").and_then(Value::as_str) {
                    chunk.words.push((text.to_string(), start, end));
                }
            }
        }
    }
    Ok(chunk)
}

fn parse_aliyun_value(value: &Value) -> Result<ParsedChunk, String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => return Err(format!("阿里百炼响应缺少文本：{value}")),
    };
    Ok(ParsedChunk { text, ..Default::default() })
}

fn parse_tencent_value(value: &Value) -> Result<ParsedChunk, String> {
    let result = value.get("result").ok_or_else(|| format!("腾讯云响应缺少 result：{value}"))?;
    let mut chunk = ParsedChunk {
        text: result.get("voice_text_str").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    };
    for word in result.get("words").and_then(Value::as_array).into_iter().flatten() {
        let (Some(start), Some(end)) = (
            word.get("start_time").and_then(as_ms),
            word.get("end_time").and_then(as_ms),
        ) else {
            continue;
        };
        if let Some(text) = word.get("word").and_then(Value::as_str) {
            chunk.words.push((text.to_string(), start, end));
        }
    }
    Ok(chunk)
}

fn parse_volcengine_value(value: &Value) -> Result<ParsedChunk, String> {
    let result = value.get("result").ok_or_else(|| format!("火山引擎响应缺少 result：{value}"))?;
    let mut chunk = ParsedChunk {
        text: result.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    };
    for utterance in result.get("utterances").and_then(Value::as_array).into_iter().flatten() {
        let start = utterance.get("start_time").and_then(as_ms).unwrap_or(0.0);
        let end = utterance.get("end_time").and_then(as_ms).unwrap_or(start);
        let text = utterance.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, end, text));
        }
        for word in utterance.get("words").and_then(Value::as_array).into_iter().flatten() {
            let word_start = word.get("start_time").and_then(as_ms).unwrap_or(start);
            let word_end = word.get("end_time").and_then(as_ms).unwrap_or(word_start);
            if let Some(text) = word.get("text").and_then(Value::as_str) {
                chunk.words.push((text.to_string(), word_start, word_end));
            }
        }
    }
    Ok(chunk)
}

fn parse_baidu_value(value: &Value) -> Result<ParsedChunk, String> {
    let code = value.get("err_no").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        let message = value.get("err_msg").and_then(Value::as_str).unwrap_or("未知错误");
        return Err(format!("百度语音错误 {code}：{message}"));
    }
    let text = value
        .get("result")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(ParsedChunk { text, ..Default::default() })
}

fn parse_custom_value(provider: &CloudAsrProvider, value: &Value) -> Result<ParsedChunk, String> {
    let text = pick(value, &provider.text_path)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut chunk = ParsedChunk { text, ..Default::default() };
    if let Some(items) = pick(value, &provider.words_path).and_then(Value::as_array) {
        for item in items {
            let start = item.get("start").and_then(as_secs).unwrap_or(0.0);
            let end = item.get("end").and_then(as_secs).unwrap_or(start);
            let text = item
                .get("text")
                .or_else(|| item.get("word"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !text.is_empty() {
                chunk.words.push((text.to_string(), start, end));
            }
        }
    }
    Ok(chunk)
}

/// 按 `a.b.c` 取 JSON 节点；空路径返回根。
fn pick<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.').filter(|part| !part.is_empty()) {
        current = current.get(part)?;
    }
    Some(current)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::parse`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_asr
git commit -m "feat(cloud-asr): 各厂商响应解析"
```

---

### Task 4: 请求构造与鉴权（含腾讯 TC3）

**Files:**
- Create: `crates/daemon/src/cloud_asr/request.rs`
- Create: `crates/daemon/src/cloud_asr/errors.rs`
- Modify: `crates/daemon/src/cloud_asr/mod.rs`（`mod request; mod errors; pub use request::*;`）
- Modify: `crates/daemon/src/cloud_tts.rs`（抽出可复用的百度 token 获取）
- Test: `crates/daemon/src/cloud_asr/request.rs` 与 `errors.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: `CloudAsrProvider`、`CloudAsrKind`、`NetworkRuntime`、`cloud_tts::baidu_token`。
- Produces:
  - `pub struct AudioPart<'a> { pub wav: &'a [u8], pub b64: &'a str, pub mime: &'a str }`
  - `pub async fn call(client: &reqwest::Client, provider: &CloudAsrProvider, audio: &AudioPart<'_>, language: Option<&str>) -> Result<Vec<u8>, String>` —— 发一个请求并返回响应字节（解析在 Task 3）
  - `pub fn endpoint(provider: &CloudAsrProvider) -> String` —— 各 kind 的默认地址/拼接规则
  - `pub(crate) fn tc3_authorization(secret_id: &str, secret_key: &str, host: &str, path: &str, query: &str, body: &[u8], timestamp: i64) -> String`
  - `pub(crate) fn canonical_query(raw: &str) -> String`
  - `errors::describe(status: u16, body: &[u8]) -> String`

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_query_sorts_and_keeps_encoding() {
        let raw = "voice_format=wav&secretid=AKID&timestamp=1700000000";
        assert_eq!(
            canonical_query(raw),
            "secretid=AKID&timestamp=1700000000&voice_format=wav"
        );
    }

    #[test]
    fn tc3_signature_is_stable_and_sensitive_to_body() {
        let first = tc3_authorization("AKID", "SECRET", "asr.cloud.tencent.com", "/asr/flash/v1/1300", "engine_type=16k_zh", b"audio", 1_700_000_000);
        let again = tc3_authorization("AKID", "SECRET", "asr.cloud.tencent.com", "/asr/flash/v1/1300", "engine_type=16k_zh", b"audio", 1_700_000_000);
        let other = tc3_authorization("AKID", "SECRET", "asr.cloud.tencent.com", "/asr/flash/v1/1300", "engine_type=16k_zh", b"audio2", 1_700_000_000);
        assert_eq!(first, again);
        assert_ne!(first, other);
        assert!(first.starts_with("TC3-HMAC-SHA256 Credential=AKID/"), "授权头格式不对：{first}");
        assert!(first.contains("/asr/flash/v1/1300"));
        assert!(first.contains("SignedHeaders=content-type;host"));
    }

    #[test]
    fn endpoint_defaults_per_kind() {
        let deepseek = CloudAsrProvider { kind: CloudAsrKind::Deepseek, ..Default::default() };
        assert_eq!(endpoint(&deepseek), "https://api.deepseek.com/v1/tools/asr");

        let azure = CloudAsrProvider { kind: CloudAsrKind::Azure, region: "eastasia".into(), ..Default::default() };
        assert_eq!(
            endpoint(&azure),
            "https://eastasia.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15"
        );

        let baidu = CloudAsrProvider { kind: CloudAsrKind::Baidu, ..Default::default() };
        assert!(endpoint(&baidu).starts_with("https://vop.baidu.com/server_api"));
    }

    #[test]
    fn maps_auth_and_rate_limits() {
        assert!(super::super::errors::describe(401, b"bad key").contains("密钥"));
        assert!(super::super::errors::describe(429, b"slow down").contains("频繁"));
        assert!(super::super::errors::describe(413, b"too big").contains("上限"));
        assert!(super::super::errors::describe(500, b"boom").contains("boom"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::request`
Expected: 编译失败

- [ ] **Step 3: 实现请求层**

```rust
// request.rs
//! 请求构造 + 鉴权。只负责「把一段音频发出去、拿回响应字节」。

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::{CloudAsrKind, CloudAsrProvider};

pub struct AudioPart<'a> {
    pub wav: &'a [u8],
    pub b64: &'a str,
    pub mime: &'a str,
}

pub fn endpoint(provider: &CloudAsrProvider) -> String {
    let base = provider.base_url.trim_end_matches('/');
    match provider.kind {
        CloudAsrKind::Deepseek => format!("{}/v1/tools/asr", if base.is_empty() { "https://api.deepseek.com" } else { base }),
        CloudAsrKind::Openai => format!("{}/audio/transcriptions", if base.is_empty() { "https://api.openai.com/v1" } else { base }),
        CloudAsrKind::Azure => {
            if !base.is_empty() {
                format!("{base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15")
            } else {
                format!(
                    "https://{}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
                    if provider.region.is_empty() { "eastasia" } else { &provider.region }
                )
            }
        }
        CloudAsrKind::Google => format!(
            "{}/v2/speech:recognize?key={}",
            if base.is_empty() { "https://speech.googleapis.com" } else { base },
            provider.api_key
        ),
        CloudAsrKind::Aliyun => format!(
            "{}/compatible-mode/v1/chat/completions",
            if base.is_empty() { "https://dashscope.aliyuncs.com" } else { base }
        ),
        CloudAsrKind::Tencent => format!(
            "https://asr.cloud.tencent.com/asr/flash/v1/{}",
            provider.app_id
        ),
        CloudAsrKind::Volcengine => {
            if base.is_empty() {
                "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash".to_string()
            } else {
                base.to_string()
            }
        }
        CloudAsrKind::Baidu => format!(
            "{}/server_api",
            if base.is_empty() { "https://vop.baidu.com" } else { base }
        ),
        CloudAsrKind::Custom => base.to_string(),
    }
}

pub async fn call(
    client: &reqwest::Client,
    provider: &CloudAsrProvider,
    audio: &AudioPart<'_>,
    language: Option<&str>,
) -> Result<Vec<u8>, String> {
    let timeout = std::time::Duration::from_secs(180);
    match provider.kind {
        CloudAsrKind::Deepseek => {
            let form = reqwest::multipart::Form::new()
                .part("file", reqwest::multipart::Part::bytes(audio.wav.to_vec())
                    .file_name("audio.wav")
                    .mime_str("audio/wav").map_err(|e| e.to_string())?);
            send(client, client.post(endpoint(provider))
                .bearer_auth(&provider.api_key)
                .multipart(form), timeout).await
        }
        CloudAsrKind::Openai => {
            let mut form = reqwest::multipart::Form::new()
                .part("file", reqwest::multipart::Part::bytes(audio.wav.to_vec())
                    .file_name("audio.wav")
                    .mime_str("audio/wav").map_err(|e| e.to_string())?)
                .text("response_format", "verbose_json");
            if !provider.model.is_empty() {
                form = form.text("model", provider.model.clone());
            }
            if let Some(language) = language {
                form = form.text("language", language.to_string());
            }
            send(client, client.post(endpoint(provider))
                .bearer_auth(&provider.api_key)
                .multipart(form), timeout).await
        }
        CloudAsrKind::Azure => {
            let definition = serde_json::json!({
                "locales": [if provider.language.is_empty() { "zh-CN".to_string() } else { provider.language.clone() }]
            });
            let form = reqwest::multipart::Form::new()
                .part("audio", reqwest::multipart::Part::bytes(audio.wav.to_vec())
                    .file_name("audio.wav")
                    .mime_str("audio/wav").map_err(|e| e.to_string())?)
                .text("definition", definition.to_string());
            send(client, client.post(endpoint(provider))
                .header("Ocp-Apim-Subscription-Key", &provider.api_key)
                .multipart(form), timeout).await
        }
        CloudAsrKind::Google => {
            let body = serde_json::json!({
                "config": {
                    "languageCode": if provider.language.is_empty() { "zh-CN" } else { provider.language.as_str() },
                    "enableWordTimeOffsets": true,
                    "enableAutomaticPunctuation": true,
                },
                "audio": { "content": audio.b64 }
            });
            send(client, client.post(endpoint(provider)).json(&body), timeout).await
        }
        CloudAsrKind::Aliyun => {
            let body = serde_json::json!({
                "model": if provider.model.is_empty() { "qwen3-asr-flash" } else { provider.model.as_str() },
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": { "data": format!("data:{};base64,{}", audio.mime, audio.b64) }
                    }]
                }]
            });
            send(client, client.post(endpoint(provider))
                .bearer_auth(&provider.api_key)
                .json(&body), timeout).await
        }
        CloudAsrKind::Tencent => {
            let timestamp = now_secs();
            let query = format!(
                "engine_type={}&voice_format=wav&secretid={}&timestamp={}&expired={}&nonce={}",
                if provider.model.is_empty() { "16k_zh" } else { provider.model.as_str() },
                url_encode(&provider.api_key),
                timestamp,
                timestamp + 3600,
                timestamp % 100_000,
            );
            let host = "asr.cloud.tencent.com";
            let path = format!("/asr/flash/v1/{}", provider.app_id);
            let authorization = tc3_authorization(&provider.api_key, &provider.api_secret, host, &path, &query, audio.wav, timestamp);
            let url = format!("https://{host}{path}?{query}");
            send(client, client.post(url)
                .header("Authorization", authorization)
                .header("Content-Type", "application/octet-stream")
                .body(audio.wav.to_vec()), timeout).await
        }
        CloudAsrKind::Volcengine => {
            let body = serde_json::json!({
                "user": { "uid": "ai-cut" },
                "audio": { "format": "wav", "data": audio.b64 },
                "request": { "model_name": if provider.model.is_empty() { "bigmodel" } else { provider.model.as_str() } }
            });
            let request_id = uuid::Uuid::new_v4().to_string();
            send(client, client.post(endpoint(provider))
                .header("X-Api-App-Key", &provider.app_id)
                .header("X-Api-Access-Key", &provider.api_key)
                .header("X-Api-Resource-Id", if provider.region.is_empty() { "volc.bigasr.auc_turbo" } else { provider.region.as_str() })
                .header("X-Api-Request-Id", request_id)
                .header("X-Api-Sequence", "-1")
                .json(&body), timeout).await
        }
        CloudAsrKind::Baidu => {
            let token = crate::cloud_tts::baidu_token_for(client, &provider.api_key, &provider.api_secret).await?;
            let url = format!(
                "{}?dev_pid={}&cuid=ai-cut&token={}",
                endpoint(provider),
                if provider.model.is_empty() { "1537" } else { provider.model.as_str() },
                url_encode(&token)
            );
            send(client, client.post(url)
                .header("Content-Type", "audio/wav")
                .body(audio.wav.to_vec()), timeout).await
        }
        CloudAsrKind::Custom => custom_call(client, provider, audio, timeout).await,
    }
}

async fn send(
    _client: &reqwest::Client,
    request: reqwest::RequestBuilder,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    let response = request
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(super::errors::describe(status.as_u16(), &bytes));
    }
    Ok(bytes.to_vec())
}

async fn custom_call(
    client: &reqwest::Client,
    provider: &CloudAsrProvider,
    audio: &AudioPart<'_>,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    let url = replace_placeholders(&provider.base_url, audio);
    let mut request = if provider.method.eq_ignore_ascii_case("GET") {
        client.get(url)
    } else {
        let body = if provider.body.trim().is_empty() {
            serde_json::json!({ "audio": audio.b64 }).to_string()
        } else {
            replace_placeholders(&provider.body, audio)
        };
        client.post(url)
            .header("Content-Type", "application/json")
            .body(body)
    };
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    for (name, value) in parse_headers(&provider.headers)? {
        request = request.header(name, value);
    }
    send(client, request, timeout).await
}

fn replace_placeholders(template: &str, audio: &AudioPart<'_>) -> String {
    template
        .replace("{{audio}}", audio.b64)
        .replace("{{mime}}", audio.mime)
}

fn parse_headers(raw: &str) -> Result<Vec<(String, String)>, String> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("请求头不是合法 JSON：{error}"))?;
    let object = value.as_object().ok_or("请求头必须是 JSON 对象")?;
    Ok(object
        .iter()
        .map(|(key, value)| (key.clone(), value.as_str().unwrap_or("").to_string()))
        .collect())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub(crate) fn canonical_query(raw: &str) -> String {
    let mut pairs: Vec<&str> = raw.split('&').filter(|pair| !pair.is_empty()).collect();
    pairs.sort_unstable();
    pairs.join("&")
}

/// 腾讯云 TC3-HMAC-SHA256 签名。
pub(crate) fn tc3_authorization(
    secret_id: &str,
    secret_key: &str,
    host: &str,
    path: &str,
    query: &str,
    body: &[u8],
    timestamp: i64,
) -> String {
    let date = chrono_like_date(timestamp);
    let payload_hash = hex(&Sha256::digest(body));
    let canonical_request = format!(
        "POST\n{path}\n{}\ncontent-type:application/octet-stream\nhost:{host}\n\ncontent-type;host\n{payload_hash}",
        canonical_query(query)
    );
    let scope = format!("{date}/asr/tc3_request");
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
        hex(&Sha256::digest(canonical_request.as_bytes()))
    );
    let secret_date = hmac(format!("TC3{secret_key}").as_bytes(), date.as_bytes());
    let secret_service = hmac(&secret_date, b"asr");
    let secret_signing = hmac(&secret_service, b"tc3_request");
    let signature = hex(&hmac(&secret_signing, string_to_sign.as_bytes()));
    format!(
        "TC3-HMAC-SHA256 Credential={secret_id}/{scope}, SignedHeaders=content-type;host, Signature={signature}"
    )
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC 接受任意长度密钥");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 只要 UTC 日期 `YYYY-MM-DD`，不引 chrono。
fn chrono_like_date(timestamp: i64) -> String {
    let days = timestamp.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
```

依赖：`crates/daemon/Cargo.toml` 增加 `hmac = "0.12"`、`sha2 = "0.10"`（若已有则复用，先 `grep`）。

`cloud_tts.rs` 里现有的 `async fn baidu_token(client, provider: &CloudTtsProvider)` 绑定在 TTS 结构上，
ASR 不能直接复用。抽出按字段取 token 的版本，原函数改为调它：

```rust
pub(crate) async fn baidu_token_for(
    client: &reqwest::Client,
    api_key: &str,
    api_secret: &str,
) -> Result<String, String> {
    if api_key.trim().is_empty() || api_secret.trim().is_empty() {
        return Err("百度语音需要填写 API Key 和 Secret Key".into());
    }
    // …以下就是原 baidu_token 的函数体，把 provider.api_key / provider.api_secret
    //   换成 api_key / api_secret 两个参数
}

async fn baidu_token(
    client: &reqwest::Client,
    provider: &CloudTtsProvider,
) -> Result<String, String> {
    baidu_token_for(client, &provider.api_key, &provider.api_secret).await
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::request`
Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_asr crates/daemon/src/cloud_tts.rs crates/daemon/Cargo.toml Cargo.lock
git commit -m "feat(cloud-asr): 请求构造与 TC3/百度鉴权"
```

---

### Task 5: 编排、合并与错误映射

**Files:**
- Create: `crates/daemon/src/cloud_asr/merge.rs`
- Modify: `crates/daemon/src/cloud_asr/mod.rs`（`mod merge; pub use merge::*;`）
- Modify: `crates/daemon/src/asr.rs`（`Transcript`、`TranscriptWord`、`SubtitleCue` 字段与 `extract_wav` / `temp_wav_path` / `speech_spans` 提升可见性）
- Test: `crates/daemon/src/cloud_asr/merge.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 1–4；`asr::{Transcript, TranscriptWord, SubtitleCue, extract_wav, temp_wav_path, speech_spans, emit, EVENT_ASR}`。
- Produces:
  - `pub struct Merged { pub cues: Vec<SubtitleCue>, pub words: Vec<TranscriptWord>, pub timed: bool }`
  - `pub fn append_chunk(merged: &mut Merged, parsed: ParsedChunk, offset: f64, span: (f64, f64))`
  - `pub fn split_pieces(text: &str) -> Vec<String>`
  - `pub fn distribute(pieces: &[String], start: f64, end: f64) -> Vec<(f64, f64, String)>`
  - `pub async fn transcribe(host: &dyn Host, network: &NetworkRuntime, provider: &CloudAsrProvider, path: &str, language: Option<String>, want_words: bool) -> Result<Transcript, String>`
  - `pub async fn cloud_asr_test(host: &dyn Host, network: &NetworkRuntime, provider: &CloudAsrProvider, path: &str) -> Result<CloudAsrTest, String>`

- [ ] **Step 1: 写失败测试（合并 + 错误映射）**

```rust
// merge.rs 末尾
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_punctuation() {
        assert_eq!(split_pieces("你好。世界！"), vec!["你好。", "世界！"]);
    }

    #[test]
    fn distributes_by_character_count() {
        let pieces = vec!["一二三".to_string(), "四五".to_string()];
        let spans = distribute(&pieces, 0.0, 5.0);
        assert_eq!(spans[0], (0.0, 3.0, "一二三".to_string()));
        assert_eq!(spans[1], (3.0, 5.0, "四五".to_string()));
    }

    #[test]
    fn native_sentences_keep_their_own_times() {
        let mut merged = Merged::default();
        let parsed = ParsedChunk {
            text: "你好".into(),
            sentences: vec![(0.5, 1.5, "你好".to_string())],
            words: vec![("你好".to_string(), 0.5, 1.5)],
        };
        append_chunk(&mut merged, parsed, 10.0, (10.0, 12.0));
        assert_eq!(merged.cues[0].start, 10.5);
        assert_eq!(merged.words[0].start, 10.5);
        assert!(merged.timed);
    }

    #[test]
    fn text_only_chunks_are_distributed_over_the_span() {
        let mut merged = Merged::default();
        let parsed = ParsedChunk { text: "你好。世界。".into(), ..Default::default() };
        append_chunk(&mut merged, parsed, 0.0, (0.0, 4.0));
        assert_eq!(merged.cues.len(), 2);
        assert_eq!(merged.cues[0].start, 0.0);
        assert!(!merged.timed);
    }

    #[test]
    fn drops_a_repeated_boundary_sentence() {
        let mut merged = Merged::default();
        append_chunk(&mut merged, ParsedChunk { text: "你好。".into(), ..Default::default() }, 0.0, (0.0, 1.0));
        let before = merged.cues.len();
        append_chunk(&mut merged, ParsedChunk { text: "你好。世界。".into(), ..Default::default() }, 1.0, (1.0, 3.0));
        assert_eq!(merged.cues.len(), before + 1, "重复的块首句没有被丢掉");
    }
}

```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr::merge`
Expected: 编译失败

- [ ] **Step 3: 实现 merge.rs 与 transcribe 编排**

```rust
// merge.rs
use super::ParsedChunk;
use crate::asr::{SubtitleCue, Transcript, TranscriptWord};

#[derive(Debug, Default)]
pub struct Merged {
    pub cues: Vec<SubtitleCue>,
    pub words: Vec<TranscriptWord>,
    pub timed: bool,
}

const MAX_CUE_CHARS: usize = 26;

pub fn split_pieces(text: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '!' | '?' | '；' | ';' | '…') {
            pieces.push(std::mem::take(&mut current));
        }
    }
    if !current.trim().is_empty() {
        pieces.push(current);
    }
    pieces
        .into_iter()
        .flat_map(|piece| {
            let trimmed = piece.trim().to_string();
            if trimmed.chars().count() <= MAX_CUE_CHARS {
                return vec![trimmed];
            }
            trimmed
                .chars()
                .collect::<Vec<_>>()
                .chunks(MAX_CUE_CHARS)
                .map(|chunk| chunk.iter().collect::<String>())
                .collect()
        })
        .filter(|piece| !piece.is_empty())
        .collect()
}

pub fn distribute(pieces: &[String], start: f64, end: f64) -> Vec<(f64, f64, String)> {
    let total: usize = pieces.iter().map(|piece| piece.chars().count()).sum();
    if total == 0 || end <= start {
        return Vec::new();
    }
    let mut cursor = start;
    let mut out = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        let chars = piece.chars().count();
        let share = (end - start) * chars as f64 / total as f64;
        let piece_end = if index + 1 == pieces.len() { end } else { cursor + share };
        out.push((cursor, piece_end, piece.clone()));
        cursor = piece_end;
    }
    out
}

pub fn append_chunk(merged: &mut Merged, parsed: ParsedChunk, offset: f64, span: (f64, f64)) {
    let mut push = |start: f64, end: f64, text: String| {
        if let Some(last) = merged.cues.last() {
            if last.text == text && start - last.end < 0.3 {
                return;
            }
        }
        merged.cues.push(SubtitleCue { start, end, text });
    };

    if parsed.sentences.is_empty() {
        let pieces = split_pieces(&parsed.text);
        for (start, end, text) in distribute(&pieces, span.0, span.1) {
            push(start, end, text);
        }
    } else {
        for (start, end, text) in &parsed.sentences {
            push(offset + start, offset + end, text.clone());
        }
    }

    if parsed.words.is_empty() {
        return;
    }
    merged.timed = true;
    for (text, start, end) in parsed.words {
        merged.words.push(TranscriptWord { text, start: offset + start, end: offset + end });
    }
}
```

编排（放在 `mod.rs` 末尾）：

```rust
#[derive(Debug, Clone, Serialize)]
pub struct CloudAsrTest {
    pub text: String,
    pub duration: f64,
}

pub async fn cloud_asr_test(
    host: &dyn Host,
    network: &NetworkRuntime,
    provider: &CloudAsrProvider,
    path: &str,
) -> Result<CloudAsrTest, String> {
    let result = transcribe(host, network, provider, path, None, false).await?;
    let text: String = result.cues.iter().map(|cue| cue.text.as_str()).collect::<Vec<_>>().join("");
    if text.trim().is_empty() {
        return Err("没有识别到语音，换一个更清晰的素材试试".into());
    }
    Ok(CloudAsrTest {
        text: text.chars().take(40).collect(),
        duration: result.cues.last().map(|cue| cue.end).unwrap_or(0.0),
    })
}

pub async fn transcribe(
    host: &dyn Host,
    network: &NetworkRuntime,
    provider: &CloudAsrProvider,
    path: &str,
    language: Option<String>,
    want_words: bool,
) -> Result<Transcript, String> {
    if provider.api_key.trim().is_empty() && provider.kind != CloudAsrKind::Custom {
        return Err(format!("{} 还没有填写 API Key", provider.name));
    }
    let client = network.client()?;
    let wav = crate::asr::temp_wav_path(host)?;
    crate::asr::extract_wav(host, path, &wav).await?;
    let duration = crate::asr::wav_duration(&wav)?;

    let spans = crate::asr::speech_spans(host, &wav)?;
    let limit = if provider.max_seconds > 0.0 {
        provider.max_seconds
    } else {
        kind_max_seconds(provider.kind)
    };
    // 16 kHz 单声道 WAV ≈ 32 KB/s，按字节上限再收一次口。
    let byte_limit = (kind_max_bytes(provider.kind) as f64 * 0.9 / 32_000.0) as f32;
    let limit = limit.min(byte_limit.max(5.0));
    let blocks = match &spans {
        Some(spans) if !spans.is_empty() => plan_chunks(spans, limit),
        _ => fixed_chunks(duration, limit.min(30.0)),
    };

    let mut merged = Merged::default();
    let total = blocks.len().max(1);
    for (index, (start, end)) in blocks.iter().enumerate() {
        if crate::asr::cancelled() {
            let _ = std::fs::remove_file(&wav);
            return Err("已取消".into());
        }
        crate::asr::emit(host, "transcribing", 0.1 + 0.85 * (index as f32 / total as f32), None);
        let slice = crate::asr::slice_wav(&wav, *start, *end)?;
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &slice);
        let audio = request::AudioPart { wav: &slice, b64: &encoded, mime: "audio/wav" };
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
```

`asr.rs` 需要新增/提升：

```rust
pub(crate) fn temp_wav_path(host: &dyn Host) -> Result<PathBuf, String>;   // 改可见性
pub(crate) async fn extract_wav(host: &dyn Host, source: &str, output: &PathBuf) -> Result<(), String>; // 改可见性
pub(crate) fn emit(host: &dyn Host, state: &str, progress: f32, message: Option<String>); // 改可见性
pub(crate) fn cancelled() -> bool { runtime().cancel.load(Ordering::Relaxed) }
pub(crate) fn wav_duration(path: &Path) -> Result<f64, String>;  // Wave::read → samples/16000
/// 读出语音段；VAD 模型未安装时返回 Ok(None)。
pub(crate) fn speech_spans(host: &dyn Host, wav: &Path) -> Result<Option<Vec<crate::cloud_asr::SpeechSpan>>, String>;
/// 截取 [start, end] 秒，重新写成独立 WAV（含头）。
pub(crate) fn slice_wav(path: &Path, start: f64, end: f64) -> Result<Vec<u8>, String>;
pub(crate) struct Transcript { pub(crate) cues, pub(crate) words, pub(crate) timed }  // 字段 pub(crate)
```

`speech_spans` 复用现有 VAD 配置；`slice_wav` 用 `Wave::read` 取样本后手工拼 44 字节 WAV 头（复用 `cloud_tts::wrap_pcm_wav` 的等价实现，建议把它抽成 `pub(crate)` 后直接调用）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_asr`
Expected: Task 1–5 全部通过

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_asr crates/daemon/src/asr.rs
git commit -m "feat(cloud-asr): 切段编排、时间合并与错误映射"
```

---

### Task 6: 接线（命令 / RPC / 能力表 / 桌面壳）

**Files:**
- Modify: `crates/daemon/src/asr.rs`（`transcribe_file` 前缀分支）
- Modify: `crates/daemon/src/capabilities.rs:95` 附近
- Modify: `crates/daemon/src/rpc.rs:1007` 附近
- Create: `src-tauri/src/cloud_asr.rs`
- Modify: `src-tauri/src/lib.rs`（`mod cloud_asr;`、状态、命令注册）
- Modify: `crates/daemon/src/bin/aicutd.rs`（构造 `CloudAsrRuntime`）
- Modify: `crates/daemon/src/doc_ops.rs`（`cloud_asr_of` 便捷函数）

**Interfaces:**
- Consumes: Task 1–5 的 `CloudAsrRuntime` / `cloud_asr_config` / `cloud_asr_set_config` / `cloud_asr_test` / `transcribe`。
- Produces: Tauri 命令 `cloud_asr_config`、`cloud_asr_set_config`、`cloud_asr_test`；RPC 同名方法；能力 `cloud_asr`；`asr_transcribe` 支持 `cloud:<id>`。

- [ ] **Step 1: 写失败测试（前缀分流）**

在 `crates/daemon/src/asr.rs` 的 tests 里加：

```rust
#[test]
fn cloud_model_ids_are_detected() {
    assert_eq!(cloud_provider_id("cloud:abc"), Some("abc"));
    assert_eq!(cloud_provider_id("paraformer"), None);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml cloud_model_ids`
Expected: 编译失败

- [ ] **Step 3: 实现分流与接线**

`asr.rs`：

```rust
pub(crate) fn cloud_provider_id(model_id: &str) -> Option<&str> {
    model_id.strip_prefix("cloud:")
}

async fn transcribe_file(...) -> Result<Transcript, String> {
    if let Some(provider_id) = cloud_provider_id(model_id) {
        let state = crate::doc_ops::cloud_asr_of(host.as_ref());
        let provider = state
            .provider(provider_id)
            .ok_or_else(|| format!("未找到语音识别服务：{provider_id}"))?;
        let runtime = runtime();
        if runtime.running.swap(true, Ordering::SeqCst) {
            return Err("已有字幕任务正在运行".into());
        }
        runtime.cancel.store(false, Ordering::Relaxed);
        let network = crate::doc_ops::network_of(host.as_ref());
        let result = crate::cloud_asr::transcribe(
            host.as_ref(), &network, &provider, path, language, want_words,
        ).await;
        runtime.running.store(false, Ordering::SeqCst);
        return result;
    }
    // …以下为现有本地分支，保持不变
}
```

`doc_ops.rs` 加：

```rust
pub fn cloud_asr_of(host: &dyn Host) -> crate::cloud_asr::CloudAsrRuntime {
    crate::cloud_asr::CloudAsrRuntime::load(Some(host.config_dir().join("asr.json")))
}
```

（`crate::doc_ops::network_of` 已在 `crates/daemon/src/doc_ops.rs:245` 存在，直接复用。）

`capabilities.rs` 在 `ok("cloud_tts")` 后加 `ok("cloud_asr"),`。

`rpc.rs`：先在 `RpcCtx`（第 36 行 `pub cloud_tts` 之后）加字段 `pub cloud_asr: Arc<crate::cloud_asr::CloudAsrRuntime>,`；
再在 args 结构区（约 549 行 `ProvidersArgs` 之后）加：

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsrProvidersArgs {
    #[serde(default)]
    providers: Vec<crate::cloud_asr::CloudAsrProvider>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsrTestArgs {
    provider: crate::cloud_asr::CloudAsrProvider,
    #[serde(default)]
    path: String,
}
```

最后在 `"cloud_tts_synthesize"` 分发块（约 1398 行）之后加：

```rust
// ---- 云端 ASR（同一套零依赖 HTTP 实现） ----
"cloud_asr_config" => Ok(json!(crate::cloud_asr::cloud_asr_config(&ctx.cloud_asr))),
"cloud_asr_set_config" => {
    let args: AsrProvidersArgs = from_value(args)?;
    Ok(json!(crate::cloud_asr::cloud_asr_set_config(
        &ctx.cloud_asr,
        args.providers,
    )))
}
"cloud_asr_test" => {
    let args: AsrTestArgs = from_value(args)?;
    Ok(json!(
        crate::cloud_asr::cloud_asr_test(host, &ctx.network, &args.provider, &args.path).await?
    ))
}
```

（`host` 是该 match 里已解构好的 `&Arc<dyn Host>`，与 `cloud_tts_test` 分支一致。）

`src-tauri/src/cloud_asr.rs`：

```rust
//! 云端 ASR 的桌面壳薄层：实现都在 aicut_daemon::cloud_asr。

use std::sync::Arc;
use tauri::State;

pub use aicut_daemon::cloud_asr::{CloudAsrConfig, CloudAsrProvider, CloudAsrTest};
use aicut_daemon::cloud_asr::CloudAsrRuntime;
use aicut_daemon::network::NetworkRuntime;
use aicut_daemon::Host;

#[tauri::command]
pub fn cloud_asr_config(state: State<'_, Arc<CloudAsrRuntime>>) -> CloudAsrConfig {
    aicut_daemon::cloud_asr::cloud_asr_config(state.inner())
}

#[tauri::command]
pub fn cloud_asr_set_config(
    state: State<'_, Arc<CloudAsrRuntime>>,
    providers: Vec<CloudAsrProvider>,
) -> CloudAsrConfig {
    aicut_daemon::cloud_asr::cloud_asr_set_config(state.inner(), providers)
}

#[tauri::command]
pub async fn cloud_asr_test(
    app: tauri::AppHandle,
    network: State<'_, Arc<NetworkRuntime>>,
    provider: CloudAsrProvider,
    path: String,
) -> Result<CloudAsrTest, String> {
    let host = crate::TauriHost::new(app);
    aicut_daemon::cloud_asr::cloud_asr_test(&host, network.inner(), &provider, &path).await
}
```

（`TauriHost::new(app)` 与同目录 `cloud_tts.rs:45` 的写法一致；`state` 参数在这里不需要，别照抄 TTS 的 `config`/`set_config` 只多此一行。）

`lib.rs`：
1. 顶部 `mod cloud_tts;` 旁加 `mod cloud_asr;`；
2. 第 407–410 行 `cloud_tts` 的 `app.manage(...)` 之后照同样格式加：

```rust
let cloud_asr = Arc::new(cloud_asr::CloudAsrRuntime::load(
    config_dir.as_ref().map(|dir| dir.join("asr.json")),
));
app.manage(cloud_asr);
```

3. `invoke_handler` 里 `cloud_tts::cloud_tts_synthesize,`（约 353 行）之后加：

```rust
cloud_asr::cloud_asr_config,
cloud_asr::cloud_asr_set_config,
cloud_asr::cloud_asr_test,
```

`aicutd.rs`：在 `cloud_tts`（第 67–71 行）之后加：

```rust
let cloud_asr = Arc::new(aicut_daemon::cloud_asr::CloudAsrRuntime::load(Some(
    host.config_dir().join("asr.json"),
)));
```

并在构造 `RpcCtx` 的地方补 `cloud_asr,`（与 `cloud_tts,` 同处）。

- [ ] **Step 4: 编译与测试**

Run:
```bash
cargo test --manifest-path crates/daemon/Cargo.toml cloud_model_ids
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: 测试通过、`cargo check` 无错误

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src src-tauri/src Cargo.lock src-tauri/Cargo.lock
git commit -m "feat(cloud-asr): 命令、RPC 与 asr_transcribe 云端分流"
```

---

### Task 7: 前端类型、API、选项构造与 store

**Files:**
- Modify: `src/types/models.ts`（`CloudAsrKind` / `CloudAsrProvider` / `CloudAsrConfig` / `CloudAsrTest`）
- Create: `src/core/cloudAsrApi.ts`
- Create: `src/core/asrSources.ts`
- Modify: `src/stores/asr.ts`（`providers` / `providersLoaded` / `loadProviders`）
- Test: `src/core/__tests__/asrSources.test.ts`

**Interfaces:**
- Consumes: `invoke`、`requireCapability`、`SelectOption`。
- Produces:
  - `CloudAsrKind`、`CloudAsrProvider`（snake_case 字段，与 Rust 一致）、`CloudAsrConfig`、`CloudAsrTest`
  - `cloudAsrConfig(): Promise<CloudAsrConfig>`、`cloudAsrSetConfig(providers): Promise<CloudAsrConfig>`、`cloudAsrTest(provider, path): Promise<CloudAsrTest>`
  - `ASR_SETTINGS_ACTION = "asr-settings"`、`CLOUD_ASR_PREFIX = "cloud:"`
  - `parseAsrModelId(id): { kind: "action" } | { kind: "local"; id } | { kind: "cloud"; id } | null`
  - `buildAsrOptions(rows: AsrOptionRow[], settings: { label: string; hint: string }): SelectOption[]`
  - `useAsrStore().providers` / `loadProviders(force?)`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  ASR_SETTINGS_ACTION,
  buildAsrOptions,
  parseAsrModelId,
} from "@/core/asrSources";

describe("parseAsrModelId", () => {
  it("recognizes the settings action", () => {
    expect(parseAsrModelId(ASR_SETTINGS_ACTION)).toEqual({ kind: "action" });
  });

  it("splits the cloud prefix", () => {
    expect(parseAsrModelId("cloud:abc")).toEqual({ kind: "cloud", id: "abc" });
  });

  it("keeps local model ids", () => {
    expect(parseAsrModelId("sherpa-paraformer")).toEqual({
      kind: "local",
      id: "sherpa-paraformer",
    });
  });

  it("ignores empty ids", () => {
    expect(parseAsrModelId(null)).toBeNull();
    expect(parseAsrModelId("")).toBeNull();
  });
});

describe("buildAsrOptions", () => {
  it("puts the settings action first", () => {
    const rows = [
      { id: "a", label: "本地 A", group: "本地模型" },
      { id: "cloud:b", label: "云端 B", group: "云端识别" },
    ];
    const options = buildAsrOptions(rows, { label: "配置…", hint: "添加云 API" });
    expect(options[0]).toMatchObject({ id: ASR_SETTINGS_ACTION, action: true });
    expect(options[0]?.label).toBe("配置…");
    expect(options.map((option) => option.id)).toEqual([
      ASR_SETTINGS_ACTION,
      "a",
      "cloud:b",
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/__tests__/asrSources.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/core/asrSources.ts`：

```ts
import type { SelectOption } from "@/components/common/Md3Select.vue";

export const ASR_SETTINGS_ACTION = "asr-settings";
export const CLOUD_ASR_PREFIX = "cloud:";

export type AsrSourceRef =
  | { kind: "action" }
  | { kind: "local"; id: string }
  | { kind: "cloud"; id: string };

export interface AsrOptionRow {
  id: string;
  label: string;
  hint?: string;
  group?: string;
}

export function parseAsrModelId(id: string | null | undefined): AsrSourceRef | null {
  if (!id) return null;
  if (id === ASR_SETTINGS_ACTION) return { kind: "action" };
  if (id.startsWith(CLOUD_ASR_PREFIX)) {
    return { kind: "cloud", id: id.slice(CLOUD_ASR_PREFIX.length) };
  }
  return { kind: "local", id };
}

export function buildAsrOptions(
  rows: AsrOptionRow[],
  settings: { label: string; hint: string },
): SelectOption[] {
  const options: SelectOption[] = [
    { id: ASR_SETTINGS_ACTION, label: settings.label, hint: settings.hint, action: true },
  ];
  for (const row of rows) {
    options.push({ id: row.id, label: row.label, hint: row.hint, group: row.group });
  }
  return options;
}
```

`src/core/cloudAsrApi.ts`：

```ts
import { invoke } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
import type { CloudAsrConfig, CloudAsrProvider, CloudAsrTest } from "@/types/models";

export function cloudAsrConfig(): Promise<CloudAsrConfig> {
  return invoke<CloudAsrConfig>("cloud_asr_config");
}

export function cloudAsrSetConfig(providers: CloudAsrProvider[]): Promise<CloudAsrConfig> {
  return invoke<CloudAsrConfig>("cloud_asr_set_config", { providers });
}

export async function cloudAsrTest(
  provider: CloudAsrProvider,
  path: string,
): Promise<CloudAsrTest> {
  await requireCapability("cloud_asr", t("caps.feature.cloudAsr"));
  return invoke<CloudAsrTest>("cloud_asr_test", { provider, path });
}
```

`types/models.ts` 追加（与 Rust 字段同步）：

```ts
export type CloudAsrKind =
  | "openai" | "deepseek" | "azure" | "google"
  | "aliyun" | "tencent" | "volcengine" | "baidu" | "custom";

export interface CloudAsrProvider {
  id: string;
  name: string;
  kind: CloudAsrKind;
  enabled: boolean;
  base_url: string;
  api_key: string;
  api_secret: string;
  app_id: string;
  region: string;
  model: string;
  language: string;
  max_seconds: number;
  method: string;
  headers: string;
  body: string;
  text_path: string;
  words_path: string;
}

export interface CloudAsrConfig { providers: CloudAsrProvider[]; }
export interface CloudAsrTest { text: string; duration: number; }
```

`stores/asr.ts` 追加（照 TTS store）：

```ts
import { cloudAsrConfig } from "@/core/cloudAsrApi";
import type { CloudAsrProvider } from "@/types/models";

const providers = ref<CloudAsrProvider[]>([]);
const providersLoaded = ref(false);

async function loadProviders(force = false): Promise<void> {
  if (providersLoaded.value && !force) return;
  try {
    providers.value = (await cloudAsrConfig()).providers;
    providersLoaded.value = true;
  } catch {
    providers.value = [];
  }
}
```

并在 `return { … }` 里补 `providers, providersLoaded, loadProviders`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/__tests__/asrSources.test.ts`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add src/core/asrSources.ts src/core/cloudAsrApi.ts src/core/__tests__/asrSources.test.ts src/types/models.ts src/stores/asr.ts
git commit -m "feat(cloud-asr): 前端类型、API 与下拉选项构造"
```

---

### Task 8: AiPane 下拉首项与云端就绪判断

**Files:**
- Modify: `src/components/workspace/panes/AiPane.vue:344-430`（模型选项与就绪判断）、`:2180-2205`（模板）、`:2912-2930`（剪口播下拉）
- Test: 无组件测试基建，逻辑已由 Task 7 的纯函数覆盖；本任务用 `pnpm build` + 手测验证

**Interfaces:**
- Consumes: `ASR_SETTINGS_ACTION`、`CLOUD_ASR_PREFIX`、`buildAsrOptions`、`parseAsrModelId`、`useAsrStore().providers`。
- Produces: `modelOptions` 首项 action；`selectedCloudAsr` computed；`onAsrSelectAction(id)`。

- [ ] **Step 1: 替换选中逻辑（不能再用 useModelChoice）**

`useModelChoice("asr", …)` 只在 `models.catalog` 里查找，`cloud:<id>` 会被判为「不存在」而回落到本地模型，
所以必须换成 TTS 那种「自己维护 id 列表 + modelChoice 持久化」的写法。删掉 344–360 行的
`useModelChoice("asr", …)` 解构，替换为：

（`asr`、`modelChoice`、`project`、`onMounted` 在 AiPane 里都已存在——`const asr = useAsrStore()` 在第 93 行，
不要重复声明；Vue 允许多个 `onMounted`，这里直接新增一个即可。）

```ts
const cloudAsrProviders = computed(() => asr.providers.filter((provider) => provider.enabled));

onMounted(() => {
  void asr.loadProviders();
});

const asrModels = computed(() => models.catalog.filter((model) => model.feature === "asr"));

/** 下拉里的全部候选 id（本地模型 / 云端服务用前缀区分），与 TTS 的 ttsOptionIds 同构。 */
const asrOptionIds = computed(() => [
  ...asrModels.value.map((model) => model.id),
  ...cloudAsrProviders.value.map((provider) => `${CLOUD_ASR_PREFIX}${provider.id}`),
]);

/** 选过哪个跨会话记住；没选过时：已装的本地模型 → 第一个云端服务 → 第一个本地模型。 */
const selectedModelId = computed<string | null>({
  get: () => {
    const saved = modelChoice.get("asr");
    if (saved && asrOptionIds.value.includes(saved)) return saved;
    const installed = asrModels.value.find((model) => model.installed);
    if (installed) return installed.id;
    const cloud = cloudAsrProviders.value[0];
    if (cloud) return `${CLOUD_ASR_PREFIX}${cloud.id}`;
    return asrModels.value[0]?.id ?? null;
  },
  set: (value) => {
    if (value) modelChoice.set("asr", value);
  },
});

const selectedAsrRef = computed(() => parseAsrModelId(selectedModelId.value));
const selectedModel = computed(() =>
  selectedAsrRef.value?.kind === "local"
    ? asrModels.value.find((model) => model.id === selectedAsrRef.value?.id) ?? null
    : null,
);
const selectedCloudAsr = computed(() => {
  const ref = selectedAsrRef.value;
  if (ref?.kind !== "cloud") return null;
  return cloudAsrProviders.value.find((provider) => provider.id === ref.id) ?? null;
});
const usingCloudAsr = computed(() => selectedAsrRef.value?.kind === "cloud");

const modelOptions = computed<SelectOption[]>(() => {
  const rows = [
    ...asrModels.value.map((model) => {
      const source = regionsLabel(i18n.t, model.regions);
      return {
        id: model.id,
        label: model.name,
        group: i18n.t("ai.asrLocalGroup"),
        hint: model.installed
          ? `${i18n.t("ai.modelReady")} · ${source}`
          : `${i18n.t("ai.modelNeedsDownload", { size: humanSize(missingBytes(model)) })} · ${source}`,
      };
    }),
    ...cloudAsrProviders.value.map((provider) => ({
      id: `${CLOUD_ASR_PREFIX}${provider.id}`,
      label: provider.name,
      group: i18n.t("ai.asrCloudGroup"),
      hint: i18n.t(`settings.asr.kind.${provider.kind}`),
    })),
  ];
  return buildAsrOptions(rows, {
    label: i18n.t("ai.asrSettings"),
    hint: i18n.t("ai.asrSettingsHint"),
  });
});

function onAsrSelectAction(id: string): void {
  if (id === ASR_SETTINGS_ACTION) layout.openSettings("asr");
}
```

同时把 `ready` / `missing` 改为：

```ts
const ready = computed(() => {
  if (usingCloudAsr.value) return Boolean(selectedCloudAsr.value);
  return Boolean(selectedModel.value?.installed && vadModel.value?.installed);
});

const missing = computed(() => {
  if (usingCloudAsr.value) return 0;
  const modelMissing = selectedModel.value ? missingBytes(selectedModel.value) : 0;
  const vadMissing = vadModel.value ? missingBytes(vadModel.value) : 0;
  return modelMissing + vadMissing;
});
```

`requestModelDownload()` 首行加 `if (usingCloudAsr.value) return;`。
`generateSubtitles()` 里 `const model = selectedModel.value;` 之后的缺失分支改为允许云端：

```ts
if (!model && !usingCloudAsr.value) {
  toast(i18n.t("ai.subtitleNoModel"));
  return;
}
```

实际调用把 `model.id` 换成 `selectedModelId.value`（云端时就是 `cloud:<id>`）。

`generateTranslation()`（约 1192 行）也拿 `selectedModel.value` 当识别模型，同样处理：

```ts
const model = selectedModel.value;
if (!model && !usingCloudAsr.value) {
  toast(i18n.t("ai.subtitleNoModel"));
  layout.openTab("models");
  return;
}
```

其后 `asr.generate(current.asset.src, model.id, "auto")` 改成 `selectedModelId.value!`，
`if (!ready.value) { await requestModelDownload(); return; }` 在 `usingCloudAsr` 时跳过。

- [ ] **Step 2: 改模板**

字幕页下拉（约 2196 行）加 `@action="onAsrSelectAction"`：

```vue
<Md3Select
  v-model="selectedModelId"
  :options="modelOptions"
  :label="i18n.t('cutReview.asrModel')"
  class="model-select"
  @action="onAsrSelectAction"
/>
```

剪口播下拉（约 2916 行）同样加 `@action="onAsrSelectAction"`。

- [ ] **Step 3: 跑类型检查**

Run: `pnpm build`
Expected: 通过（i18n 键在 Task 9 补齐，此时允许缺失但不得有 TS 错误）

- [ ] **Step 4: 手测**

启动 `pnpm tauri dev`，打开 AI 面板 → 字幕：下拉第一项是「配置语音识别服务…」，点击跳到设置；有云端服务时出现在「云端识别」分组。

- [ ] **Step 5: 提交**

```bash
git add src/components/workspace/panes/AiPane.vue
git commit -m "feat(cloud-asr): 字幕下拉首项跳设置与云端就绪判断"
```

---

### Task 9: 设置页「语音识别」分区与 i18n

**Files:**
- Modify: `src/stores/layout.ts:24-36`（`SettingsSection` 加 `"asr"`）
- Modify: `src/components/settings/SettingsView.vue`（侧栏 148-160、字段表、草稿、模板 `active === 'asr'`）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

**Interfaces:**
- Consumes: Task 7 的 `cloudAsrConfig / cloudAsrSetConfig / cloudAsrTest`。
- Produces: `SettingsSection = "asr"`；`ASR_FIELDS: Record<CloudAsrKind, ProviderField[]>`；`asrDraft` 等状态。

- [ ] **Step 1: 注册分区**

`layout.ts`：

```ts
export type SettingsSection =
  | "general" | "storage" | "appearance" | "layout"
  | "ai" | "gen" | "asr" | "tts" | "network" | "cli" | "about";
```

`SettingsView.vue` 侧栏数组在 tts 项前插入：

```ts
{ id: "asr", labelKey: "settings.section.asr", captionKey: "settings.section.asr.caption" },
```

- [ ] **Step 2: 字段表与草稿**

```ts
type AsrFieldKey =
  | "base_url" | "api_key" | "api_secret" | "app_id" | "region"
  | "model" | "language" | "max_seconds" | "method" | "headers"
  | "body" | "text_path" | "words_path";

interface AsrField { key: AsrFieldKey; labelKey: string; hintKey?: string; placeholder?: string; sensitive?: boolean; multiline?: boolean; }

interface AsrDraft {
  id: string; name: string; kind: CloudAsrKind; enabled: boolean;
  base_url: string; api_key: string; api_secret: string; app_id: string;
  region: string; model: string; language: string; max_seconds: string;
  method: string; headers: string; body: string; text_path: string; words_path: string;
}

const ASR_FIELDS: Record<CloudAsrKind, AsrField[]> = {
  deepseek: [
    { key: "base_url", labelKey: "settings.asr.baseUrl", hintKey: "settings.asr.baseUrlDeepseekHint", placeholder: "https://api.deepseek.com" },
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.apiKeyHint", placeholder: "sk-…", sensitive: true },
  ],
  openai: [
    { key: "base_url", labelKey: "settings.asr.baseUrl", hintKey: "settings.asr.baseUrlOpenaiHint", placeholder: "https://api.openai.com/v1" },
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.apiKeyHint", placeholder: "sk-…", sensitive: true },
    { key: "model", labelKey: "settings.asr.model", hintKey: "settings.asr.modelHint", placeholder: "whisper-1" },
    { key: "language", labelKey: "settings.asr.language", hintKey: "settings.asr.languageHint", placeholder: "zh" },
  ],
  azure: [
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.azureKeyHint", sensitive: true },
    { key: "region", labelKey: "settings.asr.region", hintKey: "settings.asr.regionHint", placeholder: "eastasia" },
    { key: "language", labelKey: "settings.asr.language", hintKey: "settings.asr.azureLanguageHint", placeholder: "zh-CN" },
  ],
  google: [
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.googleKeyHint", sensitive: true },
    { key: "language", labelKey: "settings.asr.language", hintKey: "settings.asr.azureLanguageHint", placeholder: "zh-CN" },
  ],
  aliyun: [
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.aliyunKeyHint", sensitive: true },
    { key: "model", labelKey: "settings.asr.model", hintKey: "settings.asr.aliyunModelHint", placeholder: "qwen3-asr-flash" },
  ],
  tencent: [
    { key: "app_id", labelKey: "settings.asr.appId", hintKey: "settings.asr.appIdHint", placeholder: "1300000000" },
    { key: "api_key", labelKey: "settings.asr.secretId", hintKey: "settings.asr.secretIdHint", placeholder: "AKID…", sensitive: true },
    { key: "api_secret", labelKey: "settings.asr.secretKey", hintKey: "settings.asr.secretKeyHint", sensitive: true },
    { key: "model", labelKey: "settings.asr.engine", hintKey: "settings.asr.engineHint", placeholder: "16k_zh" },
  ],
  volcengine: [
    { key: "app_id", labelKey: "settings.asr.appId", hintKey: "settings.asr.volcAppIdHint" },
    { key: "api_key", labelKey: "settings.asr.accessKey", hintKey: "settings.asr.accessKeyHint", sensitive: true },
    { key: "region", labelKey: "settings.asr.resourceId", hintKey: "settings.asr.resourceIdHint", placeholder: "volc.bigasr.auc_turbo" },
  ],
  baidu: [
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.baiduKeyHint", sensitive: true },
    { key: "api_secret", labelKey: "settings.asr.secretKey", hintKey: "settings.asr.baiduSecretHint", sensitive: true },
    { key: "model", labelKey: "settings.asr.devPid", hintKey: "settings.asr.devPidHint", placeholder: "1537" },
  ],
  custom: [
    { key: "base_url", labelKey: "settings.asr.url", hintKey: "settings.asr.urlHint", placeholder: "http://127.0.0.1:9000/asr" },
    { key: "method", labelKey: "settings.asr.method", hintKey: "settings.asr.methodHint" },
    { key: "api_key", labelKey: "settings.asr.apiKey", hintKey: "settings.asr.customKeyHint", sensitive: true },
    { key: "headers", labelKey: "settings.asr.headers", hintKey: "settings.asr.headersHint", multiline: true },
    { key: "body", labelKey: "settings.asr.body", hintKey: "settings.asr.bodyHint", multiline: true },
    { key: "text_path", labelKey: "settings.asr.textPath", hintKey: "settings.asr.textPathHint", placeholder: "text" },
    { key: "words_path", labelKey: "settings.asr.wordsPath", hintKey: "settings.asr.wordsPathHint", placeholder: "words" },
  ],
};

const asrDraft = ref<AsrDraft | null>(null);
const asrLoading = ref(false);
const asrSaving = ref(false);
const asrTesting = ref(false);
const asrTestResult = ref<{ ok: boolean; detail: string } | null>(null);
const asrFields = computed<AsrField[]>(() => (asrDraft.value ? ASR_FIELDS[asrDraft.value.kind] : []));
```

`toAsrDraft / fromAsrDraft`（数字 `max_seconds` 在字符串与 number 之间转换）、`loadAsr()`、`newAsr()`、`editAsr(provider)`、`saveAsr()`、`removeAsr(provider)`、`testAsr()` 全部照 TTS 的 `loadTts/newTts/editTts/saveTts/removeTts/testTts` 写，`testAsr` 的样本来自：

```ts
const sample = project.doc.assets.find(
  (asset) => !asset.offline && (asset.kind === "audio" || asset.kind === "video"),
);
if (!sample) {
  asrTestResult.value = { ok: false, detail: i18n.t("settings.asr.testNoMedia") };
  return;
}
const result = await cloudAsrTest(fromAsrDraft(asrDraft.value), sample.path);
asrTestResult.value = { ok: true, detail: i18n.t("settings.asr.testOk", { text: result.text }) };
```

- [ ] **Step 3: 模板**

在 TTS 的 `<template v-else-if="active === 'tts'">` 之前插入 `active === 'asr'` 分区：

```vue
<template v-else-if="active === 'asr'">
  <section class="group">
    <div class="group-title">{{ i18n.t("settings.asr.providers") }}</div>
    <p v-if="asrLoading" class="probe">{{ i18n.t("common.loading") }}</p>
    <p v-else-if="asrProviders.length === 0" class="probe">
      {{ i18n.t("settings.asr.empty") }}
    </p>
    <div v-for="provider in asrProviders" :key="provider.id" class="provider-card">
      <div class="provider-main">
        <span class="row-title">{{ provider.name }}</span>
        <span class="row-sub">
          {{ i18n.t(`settings.asr.kind.${provider.kind}`) }} ·
          {{ provider.model || i18n.t("settings.asr.model") }}
        </span>
      </div>
      <button class="ghost" type="button" :disabled="asrSaving" @click="editAsr(provider)">
        {{ i18n.t("settings.asr.edit") }}
      </button>
      <button class="ghost danger" type="button" :disabled="asrSaving" @click="removeAsr(provider)">
        {{ i18n.t("settings.asr.delete") }}
      </button>
    </div>
    <button class="ghost" type="button" @click="newAsr">
      {{ i18n.t("settings.asr.add") }}
    </button>
  </section>

  <section v-if="asrDraft" class="group">
    <div class="group-title">
      {{ i18n.t(editingAsrId ? "settings.asr.edit" : "settings.asr.new") }}
    </div>
    <label class="row">
      <span class="row-title">{{ i18n.t("settings.asr.name") }}</span>
      <span class="row-sub">{{ i18n.t("settings.asr.nameHint") }}</span>
      <input v-model="asrDraft.name" class="input" type="text" />
    </label>
    <div class="row">
      <span class="row-title">{{ i18n.t("settings.asr.kind") }}</span>
      <Md3Select
        v-model="asrDraft.kind"
        :options="asrKindOptions"
        :label="i18n.t('settings.asr.kind')"
      />
    </div>
    <div class="row">
      <span class="row-title">{{ i18n.t("settings.asr.enabled") }}</span>
      <span class="row-sub">{{ i18n.t("settings.asr.enabledHint") }}</span>
      <button
        class="switch"
        :class="{ on: asrDraft.enabled }"
        type="button"
        :aria-checked="asrDraft.enabled"
        @click="asrDraft.enabled = !asrDraft.enabled"
      />
    </div>
    <label v-for="field in asrFields" :key="field.key" class="row">
      <span class="row-title">{{ i18n.t(field.labelKey) }}</span>
      <span v-if="field.hintKey" class="row-sub">{{ i18n.t(field.hintKey) }}</span>
      <textarea
        v-if="field.multiline"
        v-model="asrDraft[field.key]"
        class="input"
        rows="3"
        :placeholder="field.placeholder"
      />
      <input
        v-else
        v-model="asrDraft[field.key]"
        class="input"
        :type="field.sensitive ? 'password' : 'text'"
        :placeholder="field.placeholder"
      />
    </label>
    <label class="row">
      <span class="row-title">{{ i18n.t("settings.asr.maxSeconds") }}</span>
      <span class="row-sub">{{ i18n.t("settings.asr.maxSecondsHint") }}</span>
      <input v-model="asrDraft.max_seconds" class="input" type="number" min="0" />
    </label>
    <div class="row">
      <button class="ghost" type="button" :disabled="asrTesting" @click="testAsr">
        {{ i18n.t(asrTesting ? "settings.asr.testing" : "settings.asr.test") }}
      </button>
      <p v-if="asrTestResult" class="probe" :class="{ error: !asrTestResult.ok }">
        {{ asrTestResult.detail }}
      </p>
    </div>
    <div class="row">
      <button class="primary" type="button" :disabled="asrSaving" @click="saveAsr">
        {{ i18n.t(asrSaving ? "settings.asr.saving" : "settings.asr.save") }}
      </button>
    </div>
  </section>
</template>
```

其中 `asrProviders`、`editingAsrId`、`asrKindOptions` 与 TTS 的 `cloudProviders`、`editingTtsId`、`ttsKindOptions` 一一对应：

```ts
const asrProviders = ref<CloudAsrProvider[]>([]);
const editingAsrId = ref<string | null>(null);
const asrKindOptions = computed<SelectOption[]>(() =>
  (["deepseek", "openai", "azure", "google", "aliyun", "tencent", "volcengine", "baidu", "custom"] as CloudAsrKind[])
    .map((kind) => ({ id: kind, label: i18n.t(`settings.asr.kind.${kind}`) })),
);
```

- [ ] **Step 4: i18n**

zh.ts 在 `settings.section.tts` 之前加：

```ts
"settings.section.asr": "语音识别",
"settings.section.asr.caption": "云端语音识别服务与自定义接口",
"settings.asr.providers": "识别服务",
"settings.asr.empty": "还没有配置任何识别服务。点击下方「添加服务」开始。",
"settings.asr.add": "添加服务",
"settings.asr.edit": "编辑服务",
"settings.asr.new": "新建服务",
"settings.asr.name": "名称",
"settings.asr.nameHint": "显示在字幕模型下拉列表里",
"settings.asr.kind": "接口类型",
"settings.asr.enabled": "启用",
"settings.asr.enabledHint": "停用后不会出现在字幕下拉列表",
"settings.asr.baseUrl": "接口地址",
"settings.asr.baseUrlDeepseekHint": "留空使用 https://api.deepseek.com",
"settings.asr.baseUrlOpenaiHint": "填到 /v1 为止",
"settings.asr.apiKey": "API Key",
"settings.asr.apiKeyHint": "保存在本地 asr.json",
"settings.asr.azureKeyHint": "Azure 语音资源的密钥",
"settings.asr.googleKeyHint": "Google Cloud API Key",
"settings.asr.aliyunKeyHint": "百炼 DashScope API Key",
"settings.asr.baiduKeyHint": "百度语音的 API Key",
"settings.asr.secretId": "SecretId",
"settings.asr.secretIdHint": "腾讯云 API 密钥 SecretId",
"settings.asr.secretKey": "SecretKey",
"settings.asr.secretKeyHint": "腾讯云 API 密钥 SecretKey",
"settings.asr.baiduSecretHint": "百度语音的 Secret Key",
"settings.asr.accessKey": "Access Key",
"settings.asr.accessKeyHint": "火山引擎 Access Key",
"settings.asr.appId": "App ID",
"settings.asr.appIdHint": "腾讯云账号的 AppId",
"settings.asr.volcAppIdHint": "火山引擎应用 AppId",
"settings.asr.region": "区域",
"settings.asr.regionHint": "如 eastasia、eastus",
"settings.asr.resourceId": "资源 ID",
"settings.asr.resourceIdHint": "如 volc.bigasr.auc_turbo",
"settings.asr.model": "模型",
"settings.asr.modelHint": "接口支持的模型名",
"settings.asr.aliyunModelHint": "如 qwen3-asr-flash",
"settings.asr.engine": "识别引擎",
"settings.asr.engineHint": "如 16k_zh",
"settings.asr.devPid": "模型编号",
"settings.asr.devPidHint": "如 1537（普通话）",
"settings.asr.language": "语言",
"settings.asr.languageHint": "如 zh、en；留空自动",
"settings.asr.azureLanguageHint": "如 zh-CN",
"settings.asr.maxSeconds": "单次时长上限",
"settings.asr.maxSecondsHint": "秒；0 = 使用该接口的预置值",
"settings.asr.method": "请求方法",
"settings.asr.methodHint": "GET 或 POST",
"settings.asr.headers": "请求头（JSON）",
"settings.asr.headersHint": "如 {\"Authorization\":\"Bearer x\"}",
"settings.asr.body": "请求体模板",
"settings.asr.bodyHint": "支持 {{audio}}（base64）与 {{mime}}",
"settings.asr.textPath": "文本字段路径",
"settings.asr.textPathHint": "如 data.text；留空表示整个响应",
"settings.asr.wordsPath": "词时间字段路径",
"settings.asr.wordsPathHint": "元素需含 text/word、start、end（秒）",
"settings.asr.url": "请求 URL",
"settings.asr.urlHint": "支持 {{audio}} 占位符",
"settings.asr.customKeyHint": "留空则不加 Authorization",
"settings.asr.test": "测试",
"settings.asr.testing": "测试中…",
"settings.asr.testNoMedia": "媒体库里没有可用的音视频素材，先导入一个再测试",
"settings.asr.testOk": "识别结果：{text}",
"settings.asr.save": "保存",
"settings.asr.saving": "保存中…",
"settings.asr.saved": "识别服务已保存",
"settings.asr.delete": "删除",
"settings.asr.deleteTitle": "删除识别服务？",
"settings.asr.deleteMessage": "「{name}」的接口配置会被移除。",
"settings.asr.kind.openai": "OpenAI 兼容",
"settings.asr.kind.deepseek": "DeepSeek",
"settings.asr.kind.azure": "Azure 语音",
"settings.asr.kind.google": "Google Cloud STT",
"settings.asr.kind.aliyun": "阿里百炼",
"settings.asr.kind.tencent": "腾讯云",
"settings.asr.kind.volcengine": "火山引擎",
"settings.asr.kind.baidu": "百度语音",
"settings.asr.kind.custom": "自定义 HTTP",
"ai.asrSettings": "配置语音识别服务…",
"ai.asrSettingsHint": "添加任意供应商的识别 API，也支持自定义接口",
"ai.asrLocalGroup": "本地模型",
"ai.asrCloudGroup": "云端识别",
"caps.feature.cloudAsr": "云端语音识别",
```

en.ts 同键英文对照（如 `"设置 → 语音识别"` → `"Speech recognition"`），逐条对齐。

- [ ] **Step 5: 验证并提交**

Run: `pnpm test && pnpm build`
Expected: 全绿

```bash
git add src/stores/layout.ts src/components/settings/SettingsView.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(cloud-asr): 设置页语音识别分区与文案"
```

---

### Task 10: DeepSeek TTS

**Files:**
- Modify: `crates/daemon/src/cloud_tts.rs`（`CloudTtsKind::Deepseek`、`default_name`、`Call::deepseek`、`synthesize` 分派、`list_voices` 分支）
- Modify: `src/types/models.ts`（`CloudTtsKind` 加 `"deepseek"`）
- Modify: `src/components/settings/SettingsView.vue`（`TTS_FIELDS.deepseek`、`blankDraft` 默认值）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`（`settings.tts.kind.deepseek`、`baseUrlDeepseekHint`、`voiceDeepseekHint`）

**Interfaces:**
- Consumes: 现有 `Call` 结构、`wrap_pcm_wav`。
- Produces: `CloudTtsKind::Deepseek`；TTS 表单可选 DeepSeek 并成功合成。

- [ ] **Step 1: 写失败测试**

`cloud_tts.rs` tests 里加：

```rust
#[test]
fn deepseek_body_carries_voice_and_format() {
    let body = deepseek_body("你好", "stella", "wav");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["text"], "你好");
    assert_eq!(value["voice_id"], "stella");
    assert_eq!(value["format"], "wav");
    assert_eq!(value["filter_markdown"], true);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml deepseek_body`
Expected: 编译失败

- [ ] **Step 3: 实现**

```rust
/// DeepSeek TTS：官方只支持 wav / pcm，音色只有 stella / tide。
fn deepseek_body(text: &str, voice: &str, format: &str) -> String {
    let voice = if voice.trim().is_empty() { "stella" } else { voice.trim() };
    let format = if format.trim() == "pcm" { "pcm" } else { "wav" };
    serde_json::json!({
        "text": text,
        "voice_id": voice,
        "format": format,
        "filter_markdown": true,
    })
    .to_string()
}
```

`Call::deepseek`：

```rust
async fn deepseek(&self, text: &str) -> Result<(Vec<u8>, String), String> {
    let base = if self.provider.base_url.trim().is_empty() {
        "https://api.deepseek.com"
    } else {
        self.provider.base_url.trim_end_matches('/')
    };
    let url = format!("{base}/v1/tools/tts");
    let format = if self.provider.format.eq_ignore_ascii_case("pcm") { "pcm" } else { "wav" };
    let body = deepseek_body(text, &self.voice, format);
    let response = self
        .client
        .post(url)
        .bearer_auth(&self.provider.api_key)
        .header("Content-Type", "application/json")
        .body(body)
        .timeout(self.timeout())
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?.to_vec();
    if !status.is_success() {
        return Err(super::cloud_asr::errors::describe(status.as_u16(), &bytes));
    }
    if bytes.is_empty() {
        return Err("DeepSeek 返回了空音频".into());
    }
    if format == "pcm" {
        return Ok((wrap_pcm_wav(&bytes, 24_000), "wav".into()));
    }
    Ok((bytes, "wav".into()))
}
```

`synthesize` 的分派 match 加 `CloudTtsKind::Deepseek => self.deepseek(text).await,`；`default_name` 加 `Deepseek => "DeepSeek"`；`list_voices` 加分支返回：

```rust
CloudTtsKind::Deepseek => Ok(vec![
    TtsVoice { id: "stella".into(), name: "Stella".into(), group: "DeepSeek".into() },
    TtsVoice { id: "tide".into(), name: "Tide".into(), group: "DeepSeek".into() },
]),
```

前端 `TTS_FIELDS.deepseek`：

```ts
deepseek: [
  { key: "base_url", labelKey: "settings.tts.baseUrl", hintKey: "settings.tts.baseUrlDeepseekHint", placeholder: "https://api.deepseek.com" },
  { key: "api_key", labelKey: "settings.tts.apiKey", hintKey: "settings.tts.apiKeyHint", placeholder: "sk-…", sensitive: true },
  { key: "voice", labelKey: "settings.tts.voice", hintKey: "settings.tts.voiceDeepseekHint", placeholder: "stella" },
  { key: "format", labelKey: "settings.tts.format", hintKey: "settings.tts.formatHint" },
],
```

`blankDraft("deepseek")` 默认 `{ voice: "stella", format: "wav" }`。

- [ ] **Step 4: 验证**

Run:
```bash
cargo test --manifest-path crates/daemon/Cargo.toml deepseek
pnpm test && pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add crates/daemon/src/cloud_tts.rs src/types/models.ts src/components/settings/SettingsView.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(tts): 接入 DeepSeek 语音合成"
```

---

### Task 11: 验收与文档同步

**Files:**
- Modify: `MODELS.md` 或 `docs/superpowers/specs/2026-11-15-cloud-asr-providers-design.md`（若实现与 spec 有偏差）
- Modify: `AGENTS.md`（「Web access / headless daemon」段补一句 cloud_asr 与 cloud_tts 同层）

**Interfaces:**
- 无新接口。

- [ ] **Step 1: 全量门禁**

```bash
pnpm test
pnpm build
cargo test --manifest-path crates/daemon/Cargo.toml
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

Expected: 全部通过

- [ ] **Step 2: 手测清单**（逐项打勾，失败就回去修）

- 设置 → 语音识别：9 种类型都能新建、保存、重新打开后字段还在
- 未填 Key 点测试 → 报「还没有填写 API Key」，不是 panic
- DeepSeek：填真实 Key → 测试回显识别文本；下拉选中后生成字幕，时间轴连续无重叠
- 长音频（>2 分钟）走 DeepSeek：自动切成多块，进度条推进，字幕跨块不重复
- 剪口播选 DeepSeek：完成并提示「无词时间戳，按语音段边界估算」
- 识别中点取消：立即停止，不落任何片段
- 停用某个服务：下拉里消失
- TTS 选 DeepSeek：合成 wav、可试听、可插入

- [ ] **Step 3: 同步文档**

`AGENTS.md` 的 daemon 段加：

```markdown
- 云端 TTS / ASR 都落在 `crates/daemon`（`cloud_tts.rs`、`cloud_asr/`），配置是
  `<data dir>/tts.json`、`asr.json`；桌面命令是薄壳，无头端由 `rpc` 分发。
  `asr_transcribe` 认 `cloud:<id>` 前缀分流到云服务，三个调用方不需要改。
```

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md docs MODELS.md
git commit -m "docs: 记录云端 ASR/TTS 的分层与云端分流约定"
```

---

## 自检记录

- **Spec 覆盖**：下拉首项（Task 8）、9 个 kind（Task 3/4）、切段与时间轴（Task 2/5）、设置页与 i18n（Task 9）、DeepSeek ASR（Task 3/4/6）、DeepSeek TTS（Task 10）、测试与门禁（各 Task + Task 11）、二期不实现（Global Constraints）。
- **类型一致性**：`CloudAsrProvider` 字段在 Task 1（Rust）、Task 7（TS）、Task 9（表单）三处同名同序；`ParsedChunk` 只在 Task 3/5 使用；`Merged` 只在 Task 5 使用。
- **已知风险**：TC3 签名只能用固定向量锁住格式，真实联调仍需要一个腾讯云账号；阿里一期无词时间戳，已在 spec 与 i18n 文案中说明。
