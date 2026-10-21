//! 剪辑工具面：MCP 服务器与内置剪辑智能体共用同一套定义与执行逻辑。
//!
//! 写操作统一转成前端命令总线的 `Command`，因此和界面操作一样进入撤销历史。

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::bridge::ProjectBridge;
use crate::media::probe_media;

#[derive(Debug, Clone, Serialize)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

/// 技能文档：入口 + 按需加载的能力域。
pub const SKILL_DOCS: &[(&str, &str)] = &[
    ("", include_str!("../../skills/aicut/SKILL.md")),
    (
        "pipeline",
        include_str!("../../skills/aicut/references/pipeline.md"),
    ),
    (
        "frameworks",
        include_str!("../../skills/aicut/references/frameworks.md"),
    ),
    (
        "storyboard",
        include_str!("../../skills/aicut/references/storyboard.md"),
    ),
    (
        "ai",
        include_str!("../../skills/aicut/references/ai-features.md"),
    ),
    (
        "review",
        include_str!("../../skills/aicut/references/review.md"),
    ),
    (
        "timeline",
        include_str!("../../skills/aicut/references/timeline.md"),
    ),
    (
        "assets",
        include_str!("../../skills/aicut/references/assets.md"),
    ),
    (
        "workflow",
        include_str!("../../skills/aicut/references/workflow.md"),
    ),
];

const TOPICS: &[&str] = &[
    "pipeline",
    "frameworks",
    "storyboard",
    "ai",
    "review",
    "timeline",
    "assets",
    "workflow",
];

pub fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "get_project",
            description: "读取当前工程与 revision。写操作前先调用它拿 id 和 revision。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "apply_command",
            description: "提交一条可序列化剪辑命令。支持 project.rename、project.output、track.*、asset.*、clip.*；baseRevision 必须来自最近的 get_project。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "object",
                        "description": "Command：{ kind, payload, baseRevision, label?, sessionId?, actor? }"
                    }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "import_asset",
            description: "用 ffprobe 探测媒体并加入素材库，返回新素材与命令结果。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "本机绝对路径" },
                    "name": { "type": "string", "description": "可选显示名" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "undo",
            description: "撤销上一条命令。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "redo",
            description: "重做上一条被撤销的命令。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "aicut_help",
            description: "取回能力域文档（渐进式披露）。留空返回索引，可选 pipeline / frameworks / storyboard / ai / review / timeline / assets / workflow。",
            parameters: json!({
                "type": "object",
                "properties": { "topic": { "type": "string" } }
            }),
        },
    ]
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn kind_from_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    const IMAGE: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "tiff",
    ];
    const VIDEO: &[&str] = &[
        "mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv", "flv", "ts",
    ];
    const AUDIO: &[&str] = &[
        "wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif",
    ];
    if IMAGE.contains(&ext.as_str()) {
        Some("image")
    } else if VIDEO.contains(&ext.as_str()) {
        Some("video")
    } else if AUDIO.contains(&ext.as_str()) {
        Some("audio")
    } else {
        None
    }
}

/// 取当前 revision。
async fn current_revision(bridge: &ProjectBridge) -> Result<u64, String> {
    let snapshot = bridge.request("project.get", json!({})).await?;
    snapshot
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "工程快照缺少 revision".to_string())
}

/// 给命令补齐 actor / sessionId / id / timestamp / label。
fn prepare_command(actor: &str, args: &Value) -> Result<Value, String> {
    let mut command = args
        .get("command")
        .cloned()
        .ok_or_else(|| "缺少 command".to_string())?;
    let object = command
        .as_object_mut()
        .ok_or_else(|| "command 必须是对象".to_string())?;
    object.insert("actor".into(), json!("agent"));
    object.insert("sessionId".into(), json!(actor));
    object.insert("id".into(), json!(uuid::Uuid::new_v4().to_string()));
    object.insert("timestamp".into(), json!(now_millis()));
    let label = object
        .get("label")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("剪辑操作")
        .to_string();
    object.insert("label".into(), json!(label));
    Ok(command)
}

pub async fn dispatch(
    app: &AppHandle,
    bridge: &ProjectBridge,
    actor: &str,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    match name {
        "get_project" => bridge.request("project.get", json!({})).await,
        "apply_command" => {
            let command = prepare_command(actor, &args)?;
            bridge
                .request("project.apply", json!({ "command": command }))
                .await
        }
        "undo" => bridge.request("project.undo", json!({})).await,
        "redo" => bridge.request("project.redo", json!({})).await,
        "aicut_help" => {
            let topic = args
                .get("topic")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            Ok(Value::String(help(&topic)))
        }
        "import_asset" => import_asset(app, bridge, actor, &args).await,
        other => Err(format!("未知工具：{other}")),
    }
}

fn help(topic: &str) -> String {
    if let Some((_, text)) = SKILL_DOCS.iter().find(|(key, _)| *key == topic) {
        return (*text).to_string();
    }
    let index = SKILL_DOCS
        .iter()
        .find(|(key, _)| key.is_empty())
        .map(|(_, text)| *text)
        .unwrap_or("");
    if topic.is_empty() {
        index.to_string()
    } else {
        format!(
            "未知能力域「{topic}」。可选：{}。\n\n{index}",
            TOPICS.join(" / ")
        )
    }
}

async fn import_asset(
    app: &AppHandle,
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 path".to_string())?
        .to_string();
    if !Path::new(&path).exists() {
        return Err(format!("文件不存在：{path}"));
    }
    let kind = kind_from_path(&path).ok_or_else(|| format!("不支持的素材类型：{path}"))?;
    let meta = probe_media(app.clone(), path.clone()).await?;
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| file_name(&path));

    let asset = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "name": name,
        "kind": kind,
        "src": path,
        "duration": if kind == "image" { 0.0 } else { meta.duration },
        "width": meta.width,
        "height": meta.height,
        "fps": meta.fps,
        "hasAudio": meta.has_audio,
        "addedAt": now_millis(),
    });

    let revision = current_revision(bridge).await?;
    let command = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "baseRevision": revision,
        "actor": "agent",
        "sessionId": actor,
        "kind": "asset.add",
        "payload": { "asset": asset },
        "label": format!("导入素材 {}", asset["name"].as_str().unwrap_or("")),
        "timestamp": now_millis(),
    });
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    Ok(json!({ "asset": asset, "result": result }))
}
