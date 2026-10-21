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
    // 回合进行中删除会被下一次整份 save 写回来；直接拒绝，交给用户先停止。
    if state.running.load(Ordering::SeqCst) {
        return Err("智能体正在运行，请先停止".into());
    }
    state.store.delete(&id);
    Ok(())
}

#[tauri::command]
pub fn agent_set_head(
    state: State<'_, Arc<AgentState>>,
    id: String,
    node_id: String,
) -> Result<Session, String> {
    // 回合进行中切分支会被下一次 save 静默覆盖回旧 head。
    if state.running.load(Ordering::SeqCst) {
        return Err("智能体正在运行，请先停止".into());
    }
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

    let (id, mut session) = match session_id {
        Some(id) => {
            let session = state
                .store
                .load(&id)
                .ok_or_else(|| format!("会话不存在：{id}"))?;
            (id, session)
        }
        None => {
            let id = new_id();
            let session = Session {
                id: id.clone(),
                title: String::new(),
                created_at: now_millis(),
                updated_at: now_millis(),
                nodes: Vec::new(),
                head: None,
            };
            (id, session)
        }
    };

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
pub fn agent_cancel(state: State<'_, Arc<AgentState>>) -> bool {
    let was_running = state.running.load(Ordering::SeqCst);
    if let Ok(slot) = state.cancel.lock() {
        if let Some(token) = slot.as_ref() {
            token.cancel();
        }
    }
    was_running
}

/// 当前是否有回合在跑。webview 重载后前端用它跟后端对齐状态。
#[tauri::command]
pub fn agent_running(state: State<'_, Arc<AgentState>>) -> bool {
    state.running.load(Ordering::SeqCst)
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
    let mut exhausted = false;
    const MAX_ROUNDS: usize = 24;

    for round in 0..MAX_ROUNDS {
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

        // 用户中途停止时，流里可能只攒到半个工具调用：别把它当成一次真实调用
        // 落盘（否则下一条消息会带着没有结果的 tool_calls，被端点拒绝）。
        let keep_calls = !outcome.stopped && !cancel.is_cancelled();
        let node = assistant_node(
            assistant_id.clone(),
            session.head.clone(),
            &outcome,
            keep_calls,
        );
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
        if round + 1 == MAX_ROUNDS {
            exhausted = true;
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

            // 工具在后台跑的时候也要能停止：AI job 会被 cancel 令牌中止，
            // 其它工具（import_asset 等）则直接放弃等待，未回答的 tool_call
            // 会在 build_messages 里按分支配对规则丢弃。
            let result = tokio::select! {
                _ = cancel.cancelled() => {
                    stopped = true;
                    break;
                }
                result = tools::dispatch_with_cancel(
                    &state.app,
                    &state.bridge,
                    "chat",
                    &call.name,
                    args,
                    Some(cancel),
                ) => result,
            };
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
                // 挂在当前 head 上而不是统一的 assistant 节点上：一次回复可能有多个
                // 工具调用，链式相连才能让每个结果都出现在 head → parent 路径里。
                parent: session.head.clone(),
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
    if exhausted && !stopped {
        state.emit(AgentEvent::Error {
            message: format!(
                "已达到 {MAX_ROUNDS} 轮工具调用上限，任务可能还没完成；继续发一条消息即可接着做。"
            ),
        });
    }
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

fn assistant_node(
    id: String,
    parent: Option<String>,
    outcome: &ChatOutcome,
    keep_calls: bool,
) -> Node {
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
        tool_calls: if keep_calls {
            outcome
                .tool_calls
                .iter()
                .map(|call| ToolCallRef {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
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

    // 只认「有调用、也有结果」的工具对，而且必须在**当前分支**上成对。
    // 取消 / 中断可能在助手节点里留下半截调用（没有对应的 tool 消息），原样发给
    // 模型会被 OpenAI 兼容端点判成非法消息。
    let called: std::collections::HashSet<&str> = path
        .iter()
        .filter(|node| node.role == "assistant")
        .flat_map(|node| node.tool_calls.iter().map(|call| call.id.as_str()))
        .collect();
    let answered: std::collections::HashSet<&str> = path
        .iter()
        .filter(|node| node.role == "tool")
        .filter_map(|node| node.tool_call_id.as_deref())
        .collect();
    let paired = |id: &str| called.contains(id) && answered.contains(id);

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
                    .filter(|call| paired(&call.id))
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
                if calls.is_empty() {
                    // 没有可用工具调用的节点退化成普通助手消息；连正文都没有就跳过。
                    if !node.content.trim().is_empty() {
                        messages.push(json!({
                            "role": "assistant",
                            "content": node.content
                        }));
                    }
                    continue;
                }
                let content = if node.content.is_empty() {
                    Value::Null
                } else {
                    Value::String(node.content.clone())
                };
                messages.push(json!({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": calls
                }));
            }
            "tool" => {
                let Some(id) = node.tool_call_id.as_deref() else {
                    continue;
                };
                if !paired(id) {
                    continue;
                }
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": node.content
                }));
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
        "你是 AI Cut 的剪辑智能体。你通过工具直接操作正在运行的剪辑器：读取工程、导入素材、增删轨道与片段、调整属性，\
也可以直接调用本地 AI：语音转写、音源分离、降噪、响度、翻译、配音、视频超分/补帧/重构、导出。\
所有写操作都会进入撤销历史，界面会实时更新。写命令的 baseRevision 可以用 get_project 返回的值，也可以用上一条命令或 AI 工具返回的 revision。\
读取要渐进：get_project 只给概览（规格、轨道摘要、素材数量）。按关注点再取：get_context 看播放头与选中片段，get_track 分页读某轨，find_clips 按时间/素材/文字检索，get_clip 读单片段，get_assets 读素材。不要要求整份工程。\
批量修改用 apply_commands：一次 revision、一个撤销步、失败整批回滚。追加片段用 append_clip，波纹删除用 ripple_delete，复制用 duplicate_clips。分离视频音轨用 extract_audio，不要手工拼 track.add + clip.add。\
字幕文件用 import_subtitles / export_subtitles；标记用 get_markers / add_marker / update_marker / remove_marker，不要把标记当片段。合成原语用 set_clip_color / set_clip_mask / set_clip_transition / set_clip_keyframes；转场是片段入/出动画，不支持重叠式交叉淡化。需要看画面时用 render_frame 或 render_storyboard 导出 PNG 自检。\
AI 工具默认同步：调用后会等到任务结束；缺模型时先用 list_ai_models 查看、download_model 下载。长任务可用 job_start 立即拿 jobId，再用 job_status 轮询、job_cancel 取消。\
一次只做一件清晰的事。需要细则时调用 aicut_help 取对应能力域文档。\n\n--- 技能索引 ---\n{index}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use store::ToolCallRef;

    fn node(id: &str, parent: Option<&str>, role: &str) -> Node {
        Node {
            id: id.into(),
            parent: parent.map(str::to_owned),
            role: role.into(),
            content: String::new(),
            reasoning: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
            name: None,
            created_at: 0,
            error: None,
        }
    }

    fn call(id: &str) -> ToolCallRef {
        ToolCallRef {
            id: id.into(),
            name: "get_project".into(),
            arguments: "{}".into(),
        }
    }

    fn session(nodes: Vec<Node>, head: &str) -> Session {
        Session {
            id: "s".into(),
            title: "t".into(),
            created_at: 0,
            updated_at: 0,
            nodes,
            head: Some(head.into()),
        }
    }

    #[test]
    fn build_messages_drops_tool_calls_without_results() {
        let mut asst = node("a", Some("u"), "assistant");
        asst.content = "先读工程。".into();
        asst.tool_calls = vec![call("c1"), call("c2")];
        let mut tool = node("t", Some("a"), "tool");
        tool.tool_call_id = Some("c1".into());
        tool.content = "ok".into();
        let s = session(vec![node("u", None, "user"), asst, tool], "t");

        let msgs = build_messages(&s);
        assert_eq!(msgs.len(), 4, "{msgs:#?}");
        let calls = msgs[2]["tool_calls"].as_array().expect("tool_calls");
        assert_eq!(calls.len(), 1, "orphan call must be dropped: {msgs:#?}");
        assert_eq!(calls[0]["id"], "c1");
        assert_eq!(msgs[3]["tool_call_id"], "c1");
    }

    #[test]
    fn build_messages_keeps_parallel_tool_results() {
        // 一次回复里两个工具调用，结果节点链式挂在 head 上（修复后的落盘形态）。
        let mut asst = node("a", Some("u"), "assistant");
        asst.tool_calls = vec![call("c1"), call("c2")];
        let mut first = node("t1", Some("a"), "tool");
        first.tool_call_id = Some("c1".into());
        first.content = "one".into();
        let mut second = node("t2", Some("t1"), "tool");
        second.tool_call_id = Some("c2".into());
        second.content = "two".into();
        let s = session(vec![node("u", None, "user"), asst, first, second], "t2");

        let msgs = build_messages(&s);
        // system + user + assistant + tool + tool
        assert_eq!(msgs.len(), 5, "{msgs:#?}");
        assert!(msgs[2]["content"].is_null());
        let calls = msgs[2]["tool_calls"].as_array().expect("tool_calls");
        assert_eq!(calls.len(), 2, "{msgs:#?}");
        assert_eq!(msgs[3]["tool_call_id"], "c1");
        assert_eq!(msgs[4]["tool_call_id"], "c2");
    }

    #[test]
    fn build_messages_skips_tool_results_from_other_branches() {
        // 旧数据：多个结果节点都挂在同一个助手节点下，只有最后一个在 head 链上。
        // 不在链上的结果和它的调用必须一起丢掉，否则会发出无结果的 tool_calls。
        let mut asst = node("a", Some("u"), "assistant");
        asst.tool_calls = vec![call("c1"), call("c2")];
        let mut first = node("t1", Some("a"), "tool");
        first.tool_call_id = Some("c1".into());
        let mut second = node("t2", Some("a"), "tool");
        second.tool_call_id = Some("c2".into());
        let s = session(vec![node("u", None, "user"), asst, first, second], "t2");

        let msgs = build_messages(&s);
        assert_eq!(msgs.len(), 4, "{msgs:#?}");
        let calls = msgs[2]["tool_calls"].as_array().expect("tool_calls");
        assert_eq!(calls.len(), 1, "{msgs:#?}");
        assert_eq!(calls[0]["id"], "c2");
        assert_eq!(msgs[3]["tool_call_id"], "c2");
    }

    #[test]
    fn build_messages_drops_empty_assistant_without_calls() {
        let mut asst = node("a", Some("u"), "assistant");
        asst.tool_calls = vec![call("c1")];
        let s = session(vec![node("u", None, "user"), asst], "a");

        let msgs = build_messages(&s);
        assert_eq!(
            msgs.len(),
            2,
            "empty assistant step should disappear: {msgs:#?}"
        );
    }

    #[test]
    fn assistant_node_discards_partial_calls_when_stopped() {
        let outcome = ChatOutcome {
            content: "半个回答".into(),
            reasoning: String::new(),
            tool_calls: vec![openai::ToolCall {
                id: "c1".into(),
                name: "get_project".into(),
                arguments: "{}".into(),
            }],
            stopped: true,
        };
        let kept = assistant_node("a".into(), None, &outcome, false);
        assert!(kept.tool_calls.is_empty());
        assert_eq!(kept.content, "半个回答");
    }
}
