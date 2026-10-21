//! 最小 MCP 客户端：JSON-RPC over HTTP，兼容 JSON 与 SSE 响应。

use std::time::Duration;

use serde_json::{json, Value};

pub struct Client {
    endpoint: String,
    session_id: Option<String>,
}

impl Client {
    pub fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            session_id: None,
        }
    }

    fn post(&mut self, body: &Value, timeout: Duration) -> Result<Value, String> {
        let agent = ureq::AgentBuilder::new()
            .timeout(timeout)
            .build();
        let mut request = agent
            .post(&self.endpoint)
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream");
        if let Some(session) = &self.session_id {
            request = request.set("Mcp-Session-Id", session);
        }

        let response = match request.send_string(&body.to_string()) {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let text = response.into_string().unwrap_or_default();
                return Err(format!("HTTP {status}：{text}"));
            }
            Err(error) => return Err(format!("连接失败：{error}")),
        };

        if let Some(session) = response.header("Mcp-Session-Id") {
            self.session_id = Some(session.to_string());
        }
        let content_type = response.header("Content-Type").unwrap_or("").to_string();
        let text = response.into_string().map_err(|error| error.to_string())?;

        if content_type.contains("text/event-stream") {
            for line in text.lines() {
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                return serde_json::from_str::<Value>(data)
                    .map_err(|error| format!("SSE 数据不是 JSON：{error}"));
            }
            return Err("SSE 响应为空".into());
        }

        serde_json::from_str::<Value>(&text).map_err(|error| format!("响应不是 JSON：{error}"))
    }

    fn rpc(&mut self, id: u64, method: &str, params: Value) -> Result<Value, String> {
        let response = self.post(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            Duration::from_secs(600),
        )?;
        if let Some(error) = response.get("error") {
            return Err(format!("MCP 错误：{error}"));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    pub fn initialize(&mut self) -> Result<Value, String> {
        let result = self.rpc(
            0,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "aicut", "version": env!("CARGO_PKG_VERSION") }
            }),
        )?;
        // 通知不需要响应；失败也不影响后续 tools/list。
        let _ = self.post(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            Duration::from_secs(10),
        );
        Ok(result)
    }

    pub fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let result = self.rpc(1, "tools/list", json!({}))?;
        Ok(result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    pub fn call_tool(&mut self, name: &str, arguments: Value) -> Result<String, String> {
        let result = self.rpc(2, "tools/call", json!({ "name": name, "arguments": arguments }))?;
        let is_error = result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let text = result
            .get("content")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| result.to_string());
        if is_error {
            Err(text)
        } else {
            Ok(text)
        }
    }
}

pub fn probe(endpoint: &str) -> bool {
    let mut client = Client::new(endpoint.to_string());
    client
        .post(
            &json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "aicut", "version": "probe" } }
            }),
            Duration::from_secs(2),
        )
        .is_ok()
}

pub fn connect_any() -> Result<(Client, String), String> {
    let mut tried = Vec::new();
    for endpoint in crate::discovery::candidates() {
        let mut client = Client::new(endpoint.clone());
        match client.initialize() {
            Ok(_) => return Ok((client, endpoint)),
            Err(error) => tried.push(format!("{endpoint}：{error}")),
        }
    }
    Err(format!(
        "没有找到正在运行的 AI Cut。\n尝试过：\n{}",
        tried.join("\n")
    ))
}