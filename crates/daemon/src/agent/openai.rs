//! OpenAI 兼容 Chat Completions 客户端：模型列表、连通性测试、SSE 流式对话与工具调用。

use std::time::Instant;

use futures_util::StreamExt;
use serde::Serialize;
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

pub async fn list_models(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("基础 URL 为空".into());
    }
    let response = client
        .get(models_url(base_url))
        .bearer_auth(api_key)
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
            match client
                .post(chat_url(&config.base_url))
                .bearer_auth(&config.api_key)
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

    let response = client
        .post(chat_url(&config.base_url))
        .bearer_auth(&config.api_key)
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
