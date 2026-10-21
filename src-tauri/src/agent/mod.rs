//! 剪辑智能体：OpenAI 兼容流式对话 + 工具调用 + 会话树持久化。
//!
//! 工具调用和 MCP 共用 `crate::tools` 与 `ProjectBridge`：所有写操作都进入
//! 前端命令总线，界面实时更新、撤销历史一致。

pub mod config;
pub mod openai;
pub mod store;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::bridge::ProjectBridge;
use crate::network::NetworkRuntime;
use crate::tools;
use config::{AgentConfig, AgentConfigRuntime};
use openai::{ChatOutcome, StreamEvent};
use store::{
    new_id, now_millis, title_from, Node, Session, SessionStore, SessionSummary, ToolCallRef,
};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted {
        session_id: String,
        user_node: Node,
    },
    Delta {
        node_id: String,
        text: String,
    },
    Reasoning {
        node_id: String,
        text: String,
    },
    ToolCall {
        node_id: String,
        call_id: String,
        name: String,
        args: Value,
    },
    ToolResult {
        node_id: String,
        call_id: String,
        ok: bool,
        output: String,
    },
    NodeAdded {
        node: Node,
    },
    TurnFinished {
        session_id: String,
        head: String,
        title: String,
        stopped: bool,
    },
    Error {
        message: String,
    },
}

pub struct AgentState {
    app: AppHandle,
    bridge: Arc<ProjectBridge>,
    network: Arc<NetworkRuntime>,
    config: AgentConfigRuntime,
    store: SessionStore,
    running: AtomicBool,
    cancel: Mutex<Option<CancellationToken>>,
}

impl AgentState {
    pub fn new(
        app: AppHandle,
        bridge: Arc<ProjectBridge>,
        network: Arc<NetworkRuntime>,
        config_path: Option<PathBuf>,
        sessions_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            app,
            bridge,
            network,
            config: AgentConfigRuntime::load(config_path),
            store: SessionStore::new(sessions_dir),
            running: AtomicBool::new(false),
            cancel: Mutex::new(None),
        }
    }

    fn emit(&self, event: AgentEvent) {
        let _ = self.app.emit("agent-event", event);
    }

    /// 当前 OpenAI 兼容端点配置（翻译等能力复用同一份配置）。
    pub(crate) fn config(&self) -> AgentConfig {
        self.config.get()
    }
}

#[tauri::command]
pub fn agent_config(state: State<'_, Arc<AgentState>>) -> AgentConfig {
    state.config.get()
}

#[tauri::command]
pub fn agent_set_config(
    state: State<'_, Arc<AgentState>>,
    base_url: String,
    api_key: String,
    model: String,
) -> AgentConfig {
    state.config.set(AgentConfig {
        base_url,
        api_key,
        model,
    })
}

#[tauri::command]
pub async fn agent_models(
    state: State<'_, Arc<AgentState>>,
    base_url: String,
    api_key: String,
    _model: String,
) -> Result<Vec<String>, String> {
    let client = state.network.client()?;
    openai::list_models(&client, &base_url, &api_key).await
}

#[tauri::command]
pub async fn agent_test(
    state: State<'_, Arc<AgentState>>,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<openai::AgentProbe, String> {
    let client = state.network.client()?;
    Ok(openai::test_connection(
        &client,
        &AgentConfig {
            base_url,
            api_key,
            model,
        },
    )
    .await)
}

#[tauri::command]
pub fn agent_sessions(state: State<'_, Arc<AgentState>>) -> Vec<SessionSummary> {
    state.store.list()
}

#[tauri::command]
pub fn agent_session(state: State<'_, Arc<AgentState>>, id: String) -> Result<Session, String> {
    state
        .store
        .load(&id)
        .ok_or_else(|| format!("会话不存在：{id}"))
}

#[tauri::command]
pub fn agent_delete_session(state: State<'_, Arc<AgentState>>, id: String) -> Result<(), String> {
    state.store.delete(&id);
    Ok(())
}

#[tauri::command]
pub fn agent_set_head(
    state: State<'_, Arc<AgentState>>,
    id: String,
    node_id: String,
) -> Result<Session, String> {
    let mut session = state
        .store
        .load(&id)
        .ok_or_else(|| format!("会话不存在：{id}"))?;
    if !session.nodes.iter().any(|node| node.id == node_id) {
        return Err(format!("节点不存在：{node_id}"));
    }
    session.head = Some(node_id);
    session.updated_at = now_millis();
    state.store.save(&session)?;
    Ok(session)
}

#[tauri::command]
pub fn agent_send(
    state: State<'_, Arc<AgentState>>,
    session_id: Option<String>,
    parent_id: Option<String>,
    text: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("消息为空".into());
    }
    if !state.config.get().is_configured() {
        return Err("智能体尚未配置".into());
    }
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("智能体正在运行".into());
    }

    let id = session_id.unwrap_or_else(new_id);
    let mut session = state.store.load(&id).unwrap_or_else(|| Session {
        id: id.clone(),
        title: String::new(),
        created_at: now_millis(),
        updated_at: now_millis(),
        nodes: Vec::new(),
        head: None,
    });

    let parent = parent_id.or_else(|| session.head.clone());
    let user_node = Node {
        id: new_id(),
        parent: parent.clone(),
        role: "user".into(),
        content: text.trim().to_string(),
        reasoning: None,
        tool_calls: Vec::new(),
        tool_call_id: None,
        name: None,
        created_at: now_millis(),
        error: None,
    };
    if session.title.trim().is_empty() {
        session.title = title_from(&user_node.content);
    }
    session.nodes.push(user_node.clone());
    session.head = Some(user_node.id.clone());
    session.updated_at = now_millis();
    if let Err(error) = state.store.save(&session) {
        state.running.store(false, Ordering::SeqCst);
        return Err(error);
    }

    state.emit(AgentEvent::TurnStarted {
        session_id: id.clone(),
        user_node,
    });

    let cancel = CancellationToken::new();
    if let Ok(mut slot) = state.cancel.lock() {
        *slot = Some(cancel.clone());
    }

    let shared = state.inner().clone();
    let turn_id = id.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(shared, turn_id, cancel).await;
    });

    Ok(id)
}

#[tauri::command]
pub fn agent_cancel(state: State<'_, Arc<AgentState>>) -> Result<(), String> {
    if let Ok(slot) = state.cancel.lock() {
        if let Some(token) = slot.as_ref() {
            token.cancel();
        }
    }
    Ok(())
}

async fn run_turn(state: Arc<AgentState>, session_id: String, cancel: CancellationToken) {
    let result = run_turn_inner(&state, &session_id, &cancel).await;
    if let Err(error) = result {
        state.emit(AgentEvent::Error { message: error });
    }
    state.running.store(false, Ordering::SeqCst);
    if let Ok(mut slot) = state.cancel.lock() {
        *slot = None;
    }
}

async fn run_turn_inner(
    state: &AgentState,
    session_id: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let mut session = state
        .store
        .load(session_id)
        .ok_or_else(|| format!("会话不存在：{session_id}"))?;
    let config = state.config.get();
    let client = state.network.client()?;
    let tool_defs = tool_defs_json();
    let mut stopped = false;

    for _round in 0..24 {
        if cancel.is_cancelled() {
            stopped = true;
            break;
        }

        let messages = build_messages(&session);
        let assistant_id = new_id();
        let mut on_event = |event: StreamEvent| match event {
            StreamEvent::Content(text) => state.emit(AgentEvent::Delta {
                node_id: assistant_id.clone(),
                text,
            }),
            StreamEvent::Reasoning(text) => state.emit(AgentEvent::Reasoning {
                node_id: assistant_id.clone(),
                text,
            }),
        };

        let outcome = match openai::stream_chat(
            &client,
            &config,
            &messages,
            &tool_defs,
            cancel,
            &mut on_event,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                let node = assistant_error_node(assistant_id, session.head.clone(), error.clone());
                session.nodes.push(node.clone());
                session.head = Some(node.id.clone());
                session.updated_at = now_millis();
                let _ = state.store.save(&session);
                state.emit(AgentEvent::NodeAdded { node });
                return Err(error);
            }
        };

        let node = assistant_node(assistant_id.clone(), session.head.clone(), &outcome);
        session.nodes.push(node.clone());
        session.head = Some(node.id.clone());
        session.updated_at = now_millis();
        state.store.save(&session)?;
        state.emit(AgentEvent::NodeAdded { node });

        if outcome.stopped || cancel.is_cancelled() {
            stopped = true;
            break;
        }
        if outcome.tool_calls.is_empty() {
            break;
        }

        for call in outcome.tool_calls {
            if cancel.is_cancelled() {
                stopped = true;
                break;
            }
            let args = serde_json::from_str::<Value>(&call.arguments).unwrap_or_else(|_| json!({}));
            state.emit(AgentEvent::ToolCall {
                node_id: assistant_id.clone(),
                call_id: call.id.clone(),
                name: call.name.clone(),
                args: args.clone(),
            });

            let result = tools::dispatch(&state.app, &state.bridge, "chat", &call.name, args).await;
            let (ok, output) = match result {
                Ok(value) => (
                    true,
                    serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                ),
                Err(error) => (false, error),
            };
            state.emit(AgentEvent::ToolResult {
                node_id: assistant_id.clone(),
                call_id: call.id.clone(),
                ok,
                output: truncate(&output, 20_000),
            });

            let tool_node = Node {
                id: new_id(),
                parent: Some(assistant_id.clone()),
                role: "tool".into(),
                content: truncate(&output, 20_000),
                reasoning: None,
                tool_calls: Vec::new(),
                tool_call_id: Some(call.id),
                name: Some(call.name),
                created_at: now_millis(),
                error: if ok {
                    None
                } else {
                    Some(truncate(&output, 2_000))
                },
            };
            session.nodes.push(tool_node.clone());
            session.head = Some(tool_node.id.clone());
            session.updated_at = now_millis();
            state.store.save(&session)?;
            state.emit(AgentEvent::NodeAdded { node: tool_node });
        }
    }

    let head = session.head.clone().unwrap_or_default();
    state.store.save(&session)?;
    state.emit(AgentEvent::TurnFinished {
        session_id: session_id.to_string(),
        head,
        title: session.title,
        stopped,
    });
    Ok(())
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit).collect();
    out.push_str("\n…（已截断）");
    out
}

fn assistant_node(id: String, parent: Option<String>, outcome: &ChatOutcome) -> Node {
    Node {
        id,
        parent,
        role: "assistant".into(),
        content: outcome.content.clone(),
        reasoning: if outcome.reasoning.trim().is_empty() {
            None
        } else {
            Some(outcome.reasoning.clone())
        },
        tool_calls: outcome
            .tool_calls
            .iter()
            .map(|call| ToolCallRef {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            })
            .collect(),
        tool_call_id: None,
        name: None,
        created_at: now_millis(),
        error: None,
    }
}

fn assistant_error_node(id: String, parent: Option<String>, error: String) -> Node {
    Node {
        id,
        parent,
        role: "assistant".into(),
        content: String::new(),
        reasoning: None,
        tool_calls: Vec::new(),
        tool_call_id: None,
        name: None,
        created_at: now_millis(),
        error: Some(error),
    }
}

fn build_messages(session: &Session) -> Vec<Value> {
    let mut path: Vec<&Node> = Vec::new();
    let mut cursor = session.head.clone();
    while let Some(id) = cursor {
        let Some(node) = session.nodes.iter().find(|node| node.id == id) else {
            break;
        };
        path.push(node);
        cursor = node.parent.clone();
    }
    path.reverse();

    let result_ids: std::collections::HashSet<String> = session
        .nodes
        .iter()
        .filter(|node| node.role == "tool")
        .filter_map(|node| node.tool_call_id.clone())
        .collect();

    let mut messages = vec![json!({
        "role": "system",
        "content": system_prompt()
    })];

    for node in path {
        match node.role.as_str() {
            "user" => messages.push(json!({
                "role": "user",
                "content": node.content
            })),
            "assistant" => {
                let calls: Vec<Value> = node
                    .tool_calls
                    .iter()
                    .filter(|call| result_ids.contains(&call.id))
                    .map(|call| {
                        json!({
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": call.arguments
                            }
                        })
                    })
                    .collect();
                if node.content.trim().is_empty() && calls.is_empty() {
                    continue;
                }
                let mut message = json!({
                    "role": "assistant",
                    "content": node.content
                });
                if !calls.is_empty() {
                    message["tool_calls"] = Value::Array(calls);
                }
                messages.push(message);
            }
            "tool" => {
                let mut message = json!({
                    "role": "tool",
                    "tool_call_id": node.tool_call_id,
                    "content": node.content
                });
                if let Some(name) = &node.name {
                    message["name"] = json!(name);
                }
                messages.push(message);
            }
            _ => {}
        }
    }
    messages
}

fn tool_defs_json() -> Vec<Value> {
    tools::definitions()
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            })
        })
        .collect()
}

fn system_prompt() -> String {
    let index = tools::SKILL_DOCS
        .iter()
        .find(|(key, _)| key.is_empty())
        .map(|(_, text)| *text)
        .unwrap_or("");
    format!(
        "你是 AI Cut 的剪辑智能体。你通过工具直接操作正在运行的剪辑器：读取工程、导入素材、增删轨道与片段、调整属性。\
所有写操作都会进入撤销历史，界面会实时更新。先调用 get_project 拿 revision 和 id，再 apply_command；\
一次只做一件清晰的事。需要细则时调用 aicut_help 取对应能力域文档。\n\n--- 技能索引 ---\n{index}"
    )
}
