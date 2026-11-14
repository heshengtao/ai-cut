//! 智能体 / MCP 的**工程命令桥（无头版）**（M5a）。
//!
//! 桌面壳里 `ProjectBridge::request()` 是"Rust emit 一条 `project-request`，前端执行完
//! 再 `bridge_respond` 回来"——浏览器里没有 webview 接单，所以这条路在浏览器/容器里
//! 走不通。这里换成**同一个方法名、不同的落地方式**：文档读写直接打到 daemon 已有的
//! QuickJS 文档引擎（`doc_apply` / `doc_snapshot` / `doc_view`）。
//!
//! 每个方法只做三种回答之一：
//! - 真实现（当前：`project.get` / `project.context` / `project.clip` / `project.apply`）；
//! - `unsupported`：还没搬过来，明确说明（附 `docs/docker-desktop-parity.md` §12 的分类）；
//! - 参数错误。
//!
//! **不做静默降级**：搬不过来的方法返回结构化错误，让智能体/前端知道"这条不能用"，
//! 而不是拿到一个空结果继续往下推理。

use serde_json::{json, Value};

use crate::DocHandle;

/// 桥接调用的结果。
pub type BridgeResult = Result<Value, String>;

/// 每个方法的实现状态（给诊断与前端提示用）。
pub const METHODS: &[(&str, &str)] = &[
    ("project.get", "ok"),
    ("project.context", "ok"),
    ("project.clip", "ok"),
    ("project.apply", "ok"),
    ("project.snapshot", "ok"),
    ("project.apply_batch", "ok"),
    ("project.track", "ok"),
    ("project.find_clips", "ok"),
    ("project.assets", "ok"),
    ("project.markers", "ok"),
    ("note.list", "unsupported"),
    ("project.undo", "unsupported"),
];

/// 方法是否已实现。
pub fn is_supported(method: &str) -> bool {
    METHODS
        .iter()
        .any(|(name, state)| *name == method && *state == "ok")
}

/// 一条桥接请求：`method` 与桌面端 `mcpBridge.ts` 的 `handle(method)` 同名。
pub async fn call(doc: &DocHandle, method: &str, payload: Value) -> BridgeResult {
    match method {
        // 整个工程：直接拿文档引擎的快照（浏览器编辑也走这份文档）。
        "project.get" | "project.snapshot" => {
            let text = doc.snapshot().await?;
            Ok(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null))
        }
        // 概览：领域层已经有只读视图（与桌面 `core/projectView` 同一实现）。
        "project.context" => Ok(serde_json::from_str::<Value>(
            &doc.view("overview".to_string(), "{}".to_string()).await?,
        )
        .unwrap_or(Value::Null)),
        // 单个片段的详情。
        "project.clip" => {
            let clip_id = payload
                .get("clipId")
                .or_else(|| payload.get("clip_id"))
                .or_else(|| payload.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| "project.clip 需要 clipId".to_string())?;
            let args = json!({ "clipId": clip_id }).to_string();
            Ok(
                serde_json::from_str::<Value>(&doc.view("clip".to_string(), args).await?)
                    .unwrap_or(Value::Null),
            )
        }
        // 单条编辑：payload 就是一条 `Command`（含 baseRevision）。
        "project.apply" => {
            let command = payload
                .get("command")
                .cloned()
                .unwrap_or_else(|| payload.clone());
            let result = doc.apply(command.to_string()).await?;
            Ok(serde_json::from_str::<Value>(&result).unwrap_or(Value::Null))
        }
        // 批量编辑：逐条 apply。
        //
        // **baseRevision 必须逐条注入，而且要用「那一条开始前的 revision」**：
        // 领域层要求每条命令都带它（缺了报 "stale revision: expected N, got undefined"），
        // 而每成功一条 revision 就 +1——沿用批前基线会让第二条起全部过期。
        // 调用方显式给了 `baseRevision` 时用它当第一条的基线（能挡住并发写）。
        //
        // **不是原子的**：任意一条失败就停下并报第几条（已成功的不会回滚——无头版没有
        // 撤销栈）。工具描述里如实写明，不做「整批不生效」的假承诺。
        "project.apply_batch" => {
            let commands = payload
                .get("commands")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "project.apply_batch 需要 commands 数组".to_string())?;
            let hint = payload.get("baseRevision").and_then(Value::as_u64);
            let total = commands.len();
            let mut applied = Vec::with_capacity(total);
            for (index, command) in commands.into_iter().enumerate() {
                let mut command = command;
                if command.get("baseRevision").is_none() {
                    // 第一条尊重调用方给的基线；之后一律取「此刻」的 revision。
                    let base = match (index, hint) {
                        (0, Some(value)) => value,
                        _ => doc.revision().await?,
                    };
                    if let Some(map) = command.as_object_mut() {
                        map.insert("baseRevision".into(), json!(base));
                    }
                }
                let result = doc
                    .apply(command.to_string())
                    .await
                    .map_err(|error| {
                        format!(
                            "第 {}/{} 条命令失败（前 {} 条已生效，无回滚）：{error}",
                            index + 1,
                            total,
                            index
                        )
                    })?;
                applied.push(serde_json::from_str::<Value>(&result).unwrap_or(Value::Null));
            }
            Ok(json!({ "applied": applied }))
        }
        // 渐进读取：都是领域层的只读视图（与桌面 `core/projectView` 同一实现）。
        "project.track" => view(doc, "track", &payload).await,
        "project.find_clips" => view(doc, "find_clips", &payload).await,
        "project.assets" => view(doc, "assets", &payload).await,
        "project.markers" => view(doc, "markers", &payload).await,
        other if is_supported(other) => Err(format!("方法 {other} 尚未实现")),
        other => Err(format!(
            "方法 {other} 还没有在浏览器/容器版本实现（见 docs/docker-desktop-parity.md §12）"
        )),
    }
}

/// 调领域层的只读视图，把 JSON 文本解码成 `Value`。
async fn view(doc: &DocHandle, name: &str, args: &Value) -> BridgeResult {
    // `null` 在领域层会被当成"没有参数"以外的东西：统一归一成空对象。
    let args = if args.is_null() {
        json!({})
    } else {
        args.clone()
    };
    let text = doc.view(name.to_string(), args.to_string()).await?;
    Ok(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_table_is_consistent() {
        for (name, state) in METHODS {
            assert!(
                matches!(*state, "ok" | "unsupported"),
                "{name} 的状态 {state} 不在约定内"
            );
        }
    }

    #[test]
    fn unknown_methods_are_rejected_explicitly() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let doc = DocHandle::spawn();
        let error = rt
            .block_on(call(&doc, "project.undo", Value::Null))
            .expect_err("未实现的方法必须报错");
        assert!(error.contains("§12"), "错误里应指向分类文档：{error}");
    }
}
