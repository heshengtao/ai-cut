//! OpenAI 兼容 Chat Completions 客户端：模型列表、连通性测试、SSE 流式对话与工具调用。

use std::time::Instant;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::config::AgentConfig;

#[derive(Debug, Clone, Serialize)]
pub struct AgentProbe {
    pub ok: bool,
    pub detail: String,
    pub ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Default)]
pub struct ChatOutcome {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub stopped: bool,
}

pub enum StreamEvent {
    Content(String),
    Reasoning(String),
}

#[derive(Default)]
struct ToolCallAccum {
    id: String,
    name: String,
    arguments: String,
}

pub fn normalize_base(raw: &str) -> String {
    let mut base = raw.trim().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/completions", "/models"] {
        if let Some(stripped) = base.strip_suffix(suffix) {
            base = stripped.trim_end_matches('/').to_string();
        }
    }
    base
}

fn chat_url(base: &str) -> String {
    format!("{}/chat/completions", normalize_base(base))
}

fn models_url(base: &str) -> String {
    format!("{}/models", normalize_base(base))
}

/// 有 Key 才发 `Authorization`：本地端点（Ollama / vLLM）不需要，
/// 空的 `Bearer ` 反而会被一些网关当成非法头直接 401。
fn authorize(request: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
    let key = api_key.trim();
    if key.is_empty() {
        request
    } else {
        request.bearer_auth(key)
    }
}

pub async fn list_models(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("基础 URL 为空".into());
    }
    let response = authorize(
        client.get(models_url(base_url)),
        api_key,
    )
    .timeout(std::time::Duration::from_secs(20))
    .send()
        .await
        .map_err(|error| format!("请求模型列表失败：{error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {status}：{}", text.trim()));
    }
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("模型列表不是 JSON：{error}"))?;
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

pub async fn test_connection(client: &reqwest::Client, config: &AgentConfig) -> AgentProbe {
    let started = Instant::now();
    if config.base_url.trim().is_empty() {
        return AgentProbe {
            ok: false,
            detail: "基础 URL 为空".into(),
            ms: started.elapsed().as_millis() as u64,
        };
    }
    match list_models(client, &config.base_url, &config.api_key).await {
        Ok(models) => AgentProbe {
            ok: true,
            detail: format!("{} 个模型", models.len()),
            ms: started.elapsed().as_millis() as u64,
        },
        Err(first_error) => {
            // 有些网关不实现 /models：退回一次极短的 chat 请求。
            let body = json!({
                "model": config.model,
                "messages": [{ "role": "user", "content": "ping" }],
                "max_tokens": 1,
                "stream": false
            });
            match authorize(
                client.post(chat_url(&config.base_url)),
                &config.api_key,
            )
            .json(&body)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            {
                Ok(response) if response.status().is_success() => AgentProbe {
                    ok: true,
                    detail: "chat 端点可达".into(),
                    ms: started.elapsed().as_millis() as u64,
                },
                Ok(response) => AgentProbe {
                    ok: false,
                    detail: format!("HTTP {}：{}", response.status(), first_error),
                    ms: started.elapsed().as_millis() as u64,
                },
                Err(error) => AgentProbe {
                    ok: false,
                    detail: format!("{first_error}；chat 请求失败：{error}"),
                    ms: started.elapsed().as_millis() as u64,
                },
            }
        }
    }
}

pub async fn stream_chat(
    client: &reqwest::Client,
    config: &AgentConfig,
    messages: &[Value],
    tools: &[Value],
    cancel: &CancellationToken,
    on_event: &mut (dyn FnMut(StreamEvent) + Send),
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning_effort: Option<&str>,
    top_p: Option<f32>,
) -> Result<ChatOutcome, String> {
    if !config.is_configured() {
        return Err("智能体尚未配置".into());
    }

    let mut body = json!({
        "model": config.model,
        "messages": messages,
        "stream": true
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = json!("auto");
    }
    if let Some(temperature) = temperature {
        if temperature.is_finite() {
            body["temperature"] = json!(temperature.clamp(0.0, 2.0));
        }
    }
    if let Some(max_tokens) = max_tokens {
        if max_tokens > 0 {
            body["max_tokens"] = json!(max_tokens.min(1_000_000));
        }
    }
    apply_sampling(&mut body, top_p, reasoning_effort);

    let response = authorize(client.post(chat_url(&config.base_url)), &config.api_key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|error| format!("请求模型失败：{error}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}：{}", text.trim()));
    }

    let mut stream = Box::pin(response.bytes_stream());
    let mut buffer: Vec<u8> = Vec::new();
    let mut outcome = ChatOutcome::default();
    let mut calls: Vec<ToolCallAccum> = Vec::new();

    'outer: loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => {
                outcome.stopped = true;
                break 'outer;
            }
            next = stream.next() => next,
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| format!("读取流失败：{error}"))?;
        buffer.extend_from_slice(&chunk);

        loop {
            let Some(position) = buffer.iter().position(|byte| *byte == b'\n') else {
                break;
            };
            let line_bytes: Vec<u8> = buffer.drain(..=position).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim_end_matches(['\r', '\n']);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                break 'outer;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let Some(delta) = value.pointer("/choices/0/delta") else {
                continue;
            };

            if let Some(content) = delta.get("content") {
                if let Some(text) = content.as_str() {
                    if !text.is_empty() {
                        outcome.content.push_str(text);
                        on_event(StreamEvent::Content(text.to_string()));
                    }
                } else if let Some(parts) = content.as_array() {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                outcome.content.push_str(text);
                                on_event(StreamEvent::Content(text.to_string()));
                            }
                        }
                    }
                }
            }

            for key in ["reasoning_content", "reasoning"] {
                if let Some(text) = delta.get(key).and_then(Value::as_str) {
                    if !text.is_empty() {
                        outcome.reasoning.push_str(text);
                        on_event(StreamEvent::Reasoning(text.to_string()));
                    }
                }
            }

            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for call in tool_calls {
                    let index = call
                        .get("index")
                        .and_then(Value::as_u64)
                        .unwrap_or(calls.len() as u64) as usize;
                    if calls.len() <= index {
                        calls.resize_with(index + 1, ToolCallAccum::default);
                    }
                    let accum = &mut calls[index];
                    if let Some(id) = call.get("id").and_then(Value::as_str) {
                        accum.id = id.to_string();
                    }
                    if let Some(function) = call.get("function") {
                        if let Some(name) = function.get("name").and_then(Value::as_str) {
                            accum.name = name.to_string();
                        }
                        if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                            accum.arguments.push_str(arguments);
                        }
                    }
                }
            }
        }
    }

    outcome.tool_calls = calls
        .into_iter()
        .enumerate()
        .filter(|(_, call)| !call.name.is_empty())
        .map(|(index, call)| ToolCall {
            id: if call.id.is_empty() {
                format!("call_{index}")
            } else {
                call.id
            },
            name: call.name,
            arguments: if call.arguments.is_empty() {
                "{}".into()
            } else {
                call.arguments
            },
        })
        .collect();

    Ok(outcome)
}

/// 一条对话消息（`role` + 纯文本 `content`）；文本节点只需要这一种形态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    #[serde(default)]
    pub role: String,
    /// 纯文本，或 OpenAI 兼容的多模态 content parts 数组（图片 / 视频）。
    #[serde(default)]
    pub content: Value,
}

/// 文本模型的完整返回：内容 + 思考过程。
#[derive(Debug, Clone, Default, Serialize)]
pub struct LlmReply {
    pub text: String,
    pub reasoning: String,
}

/// 一次性（非流式）对话：画布「文本生成」节点直接用它。
///
/// 走的是同一份 `AgentConfig`（同一个 OpenAI 兼容端点、同一把 Key），
/// 只是把 `temperature` / `max_tokens` 交给调用方控制——节点上这两个是显式参数。
pub async fn chat_once(
    client: &reqwest::Client,
    config: &AgentConfig,
    model: &str,
    messages: &[ChatMessage],
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    top_p: Option<f32>,
    reasoning_effort: Option<&str>,
) -> Result<LlmReply, String> {
    let base_url = config.base_url.trim();
    if base_url.is_empty() {
        return Err("还没有配置算力端点（设置 → 算力配置）".into());
    }
    let model = model.trim();
    if model.is_empty() {
        return Err("还没有选择文本模型".into());
    }
    if messages.is_empty() {
        return Err("提示词为空".into());
    }

    let wire: Vec<Value> = messages
        .iter()
        .map(|message| json!({ "role": message.role, "content": message.content.clone() }))
        .collect();
    let mut body = json!({
        "model": model,
        "messages": wire,
        "stream": false
    });
    if let Some(temperature) = temperature {
        if temperature.is_finite() {
            body["temperature"] = json!(temperature.clamp(0.0, 2.0));
        }
    }
    if let Some(max_tokens) = max_tokens {
        if max_tokens > 0 {
            body["max_tokens"] = json!(max_tokens.min(1_000_000));
        }
    }
    apply_sampling(&mut body, top_p, reasoning_effort);

    let response = authorize(client.post(chat_url(base_url)), &config.api_key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|error| format!("请求文本模型失败：{error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {status}：{}", truncate(&text, 400)));
    }
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("响应不是 JSON：{error}"))?;
    let message = value.pointer("/choices/0/message");
    let content = message
        .and_then(|message| message.get("content"))
        .map(content_text)
        .unwrap_or_default();
    let reasoning = message
        .and_then(|message| message.get("reasoning_content").or_else(|| message.get("reasoning")))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if content.trim().is_empty() && reasoning.trim().is_empty() {
        return Err("文本模型没有返回内容".into());
    }
    Ok(LlmReply { text: content, reasoning })
}

/// 采样参数 / 思考强度：只在显式给了值时才写进请求体，避免老端点不认。
fn apply_sampling(body: &mut Value, top_p: Option<f32>, reasoning_effort: Option<&str>) {
    if let Some(top_p) = top_p {
        if top_p.is_finite() {
            body["top_p"] = json!(top_p.clamp(0.0, 1.0));
        }
    }
    if let Some(effort) = reasoning_effort.map(str::trim).filter(|value| !value.is_empty()) {
        if effort != "off" {
            body["reasoning_effort"] = json!(effort);
        }
    }
}

/// `content` 既可能是字符串，也可能是 `[{type:"text",text:"…"}]` 分片。
fn content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let mut out = String::new();
    if let Some(parts) = content.as_array() {
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                out.push_str(text);
            }
        }
    }
    out
}

/// 错误信息里截短响应体，免得上百 KB 的 HTML 糊满界面。
fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let short: String = trimmed.chars().take(limit).collect();
    format!("{short}…")
}
