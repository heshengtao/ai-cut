//! 无头形态的**画布写入**：这是 MCP 边界（以前 `board_apply_ops` 等五个工具在无头版
//! 直接返回「需要桌面版渲染进程」）。
//!
//! 现在画布写入走领域引擎（`core/board/ops.ts` + `domain/host.ts` 的 `board_*` op），
//! 与桌面的 `board.apply` 同一份语义。这组测试守住：
//!
//! 1. 五个写工具在无头形态真的能落地（不再是 desktop_only）；
//! 2. 画布写操作进引擎侧撤销栈（`undo` 能撤回）；
//! 3. `workflow_publish` / `workflow_run` 仍然是桌面专属（它们要工作流库 / 运行器）。

use std::path::PathBuf;
use std::sync::Arc;

use aicut_daemon::video_dsp::VideoDspState;
use aicut_daemon::{agent_tools, DocHandle, HeadlessHost, Host};
use serde_json::{json, Value};

struct Fixture {
    doc: DocHandle,
    host: Arc<dyn Host>,
    video: Arc<VideoDspState>,
    runtime: tokio::runtime::Runtime,
    dir: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn fixture() -> Fixture {
    // 每次调用都要唯一：并发测试共用同一个临时根，撞名会让先结束的那个把目录删掉。
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "aicut-board-headless-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("临时目录");
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(dir.clone(), dir.clone()));
    let doc = DocHandle::spawn();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let project = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project.json");
    let text = std::fs::read_to_string(project).expect("fixture");
    runtime.block_on(doc.load(text)).expect("load");
    Fixture {
        doc,
        host,
        video: Arc::new(VideoDspState::default()),
        runtime,
        dir,
    }
}

impl Fixture {
    fn tool(&self, name: &str, args: Value) -> Result<Value, String> {
        self.runtime.block_on(agent_tools::dispatch(
            &self.doc,
            &self.host,
            &self.video,
            name,
            args,
            None,
        ))
    }

    fn snapshot(&self) -> Value {
        let text = self
            .runtime
            .block_on(self.doc.snapshot())
            .expect("snapshot");
        serde_json::from_str(&text).expect("snapshot json")
    }

    fn canvases(&self) -> Vec<Value> {
        self.snapshot()["boards"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
}

fn node(id: &str, kind: &str) -> Value {
    json!({
        "id": id,
        "type": kind,
        "position": { "x": 0, "y": 0 },
        "data": { "params": {}, "bindings": {} },
    })
}

#[test]
fn board_apply_ops_lands_headless() {
    let fixture = fixture();
    let applied = fixture
        .tool(
            "board_apply_ops",
            json!({ "ops": [
                { "kind": "add_node", "node": node("i1", "input.image") },
                { "kind": "add_node", "node": node("d1", "display.image") },
                { "kind": "connect", "edge": {
                    "id": "e1", "source": "i1", "sourcePort": "image",
                    "target": "d1", "targetPort": "in"
                }},
                { "kind": "update_node", "nodeId": "d1",
                  "patch": { "data": { "params": { "command": "npx remotion render" } } } }
            ]}),
        )
        .expect("无头版应该能改画布");
    assert_eq!(applied["applied"], 4);

    let canvas = &fixture.canvases()[0];
    let nodes = canvas["doc"]["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 2);
    let ids: Vec<&str> = nodes
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert!(ids.contains(&"i1") && ids.contains(&"d1"));
    let display = nodes
        .iter()
        .find(|item| item["id"] == "d1")
        .expect("display 节点");
    assert_eq!(
        display["data"]["params"]["command"], "npx remotion render",
        "params 是开放标量袋子：溯源字段必须原样落盘"
    );
    assert_eq!(canvas["doc"]["edges"].as_array().map(Vec::len), Some(1));
}

#[test]
fn board_apply_ops_is_one_undo_step() {
    let fixture = fixture();
    fixture
        .tool(
            "board_apply_ops",
            json!({ "ops": [
                { "kind": "add_node", "node": node("i1", "input.text") },
                { "kind": "add_node", "node": node("d1", "display.text") },
            ]}),
        )
        .expect("apply");
    assert_eq!(
        fixture.canvases()[0]["doc"]["nodes"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    let undone = fixture.tool("undo", json!({})).expect("undo");
    assert_eq!(undone["changed"], true);
    assert_eq!(
        fixture.canvases()[0]["doc"]["nodes"]
            .as_array()
            .map(Vec::len),
        Some(0)
    );
}

#[test]
fn board_canvas_crud_lands_headless() {
    let fixture = fixture();
    let created = fixture
        .tool("board_create_canvas", json!({ "title": "渲染草稿" }))
        .expect("create");
    let canvas_id = created["id"].as_str().expect("id").to_string();
    assert_eq!(created["title"], "渲染草稿");
    assert_eq!(fixture.snapshot()["activeBoardId"], canvas_id);

    let renamed = fixture
        .tool(
            "board_rename_canvas",
            json!({ "canvasId": canvas_id, "title": "成片" }),
        )
        .expect("rename");
    assert_eq!(renamed["title"], "成片");

    let first = fixture.canvases()[0]["id"].as_str().unwrap().to_string();
    let opened = fixture
        .tool("board_open_canvas", json!({ "canvasId": first }))
        .expect("open");
    assert_eq!(opened["activeId"], first);

    fixture
        .tool("board_delete_canvas", json!({ "canvasId": canvas_id }))
        .expect("delete");
    assert_eq!(fixture.canvases().len(), 1);
}

#[test]
fn board_write_errors_are_explicit() {
    let fixture = fixture();
    let error = fixture
        .tool(
            "board_apply_ops",
            json!({ "ops": [
                { "kind": "connect", "edge": {
                    "id": "e1", "source": "ghost", "sourcePort": "image",
                    "target": "ghost2", "targetPort": "in"
                }}
            ]}),
        )
        .expect_err("悬空端点必须报错");
    assert!(error.contains("连线接不上"), "错误信息要能定位：{error}");

    let error = fixture
        .tool("board_open_canvas", json!({ "canvasId": "canvas-nope" }))
        .expect_err("不存在的画布必须报错");
    assert!(error.contains("画布不存在"), "{error}");

    // 工程至少保留一张画布
    let only = fixture.canvases()[0]["id"].as_str().unwrap().to_string();
    let error = fixture
        .tool("board_delete_canvas", json!({ "canvasId": only }))
        .expect_err("最后一张不能删");
    assert!(error.contains("至少要保留一张画布"), "{error}");
}

#[test]
fn workflow_publish_and_run_stay_desktop_only() {
    let fixture = fixture();
    for name in ["workflow_publish", "workflow_run"] {
        let error = fixture
            .tool(name, json!({}))
            .expect_err("工作流发布 / 调用仍然需要桌面渲染进程");
        assert!(
            error.contains("桌面"),
            "{name} 的报错要说清楚为什么：{error}"
        );
    }
}

#[test]
fn all_board_tools_are_listed() {
    let tools = agent_tools::TOOLS;
    for name in [
        "board_list_canvases",
        "board_get_canvas",
        "board_create_canvas",
        "board_delete_canvas",
        "board_rename_canvas",
        "board_open_canvas",
        "board_apply_ops",
        "render_code",
    ] {
        assert!(tools.contains(&name), "工具面缺少 {name}");
    }
}
