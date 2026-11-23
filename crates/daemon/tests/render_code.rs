//! `render_code`：代码出片的收尾契约。
//!
//! 覆盖三件事：
//! 1. 参数校验（工作目录 / 产物目录必须存在，跑之前就报）；
//! 2. 失败清理：命令写了半成品就失败 → 报错带输出尾部，**半成品被删掉**；
//! 3. 成功路径：产物入库，并（给了 nodeId 时）回填画布节点，溯源 params 保留。

use std::path::{Path, PathBuf};
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
        "aicut-render-code-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(dir.join("renders")).expect("临时目录");
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

    fn cwd(&self) -> String {
        self.dir.to_string_lossy().into_owned()
    }
}

/// 一张真实存在的小 PNG（当成“渲染出来的首帧”）。
fn sample_image() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/icons/32x32.png")
        .canonicalize()
        .expect("示例图片")
}

#[test]
fn rejects_bad_arguments_before_running() {
    let fixture = fixture();
    let error = fixture
        .tool(
            "render_code",
            json!({ "command": "true", "cwd": "/nope/nope", "outputPath": "a.png" }),
        )
        .expect_err("工作目录不存在要报错");
    assert!(error.contains("工作目录不存在"), "{error}");

    let error = fixture
        .tool(
            "render_code",
            json!({ "command": "true", "cwd": fixture.cwd(), "outputPath": "missing/a.png" }),
        )
        .expect_err("产物目录不存在要报错");
    assert!(error.contains("输出目录不存在"), "{error}");
}

#[test]
fn failed_command_cleans_its_partial_output() {
    let fixture = fixture();
    let output = fixture.dir.join("renders/hero.mp4");
    let error = fixture
        .tool(
            "render_code",
            json!({
                "command": "echo partial > renders/hero.mp4; echo boom >&2; exit 3",
                "cwd": fixture.cwd(),
                "outputPath": "renders/hero.mp4"
            }),
        )
        .expect_err("命令失败必须报错");
    assert!(error.contains("exit 3"), "报错要带退出码：{error}");
    assert!(error.contains("boom"), "报错要带命令输出尾部：{error}");
    assert!(!output.exists(), "本次新建的半成品要删掉");
}

#[test]
fn success_imports_and_backfills_the_node() {
    let fixture = fixture();
    let source = sample_image();

    // 先把节点放好：render_code 只回填，不替你建节点。
    fixture
        .tool(
            "board_apply_ops",
            json!({ "ops": [{ "kind": "add_node", "node": {
                "id": "d1",
                "type": "display.image",
                "position": { "x": 0, "y": 0 },
                "data": { "params": { "model": "flux" }, "bindings": {} }
            }}]}),
        )
        .expect("add_node");

    let command = format!("cp '{}' renders/hero.png", source.display());
    let result = fixture
        .tool(
            "render_code",
            json!({
                "command": command,
                "cwd": fixture.cwd(),
                "outputPath": "renders/hero.png",
                "name": "首帧",
                "nodeId": "d1",
                "params": { "entry": "scenes/hero.tsx", "fps": 30 }
            }),
        )
        .expect("成功路径");

    let asset_id = result["assetId"].as_str().expect("assetId").to_string();
    assert!(result["sizeBytes"].as_u64().unwrap_or(0) > 0);

    // 素材真的进库了
    let snapshot = fixture.snapshot();
    let assets = snapshot["assets"].as_array().expect("assets");
    let asset = assets
        .iter()
        .find(|asset| asset["id"] == asset_id)
        .expect("素材入库");
    assert_eq!(asset["kind"], "image");
    assert_eq!(asset["name"], "首帧");

    // 节点回填：素材换成结果，溯源 params 与原有 params 合并
    let node = snapshot["boards"][0]["doc"]["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["id"] == "d1")
        .expect("节点存在")
        .clone();
    assert_eq!(node["data"]["assetId"], asset_id);
    assert_eq!(node["data"]["assetIds"], json!([asset_id]));
    assert_eq!(node["data"]["params"]["entry"], "scenes/hero.tsx");
    assert_eq!(node["data"]["params"]["fps"], 30);
    assert_eq!(
        node["data"]["params"]["model"], "flux",
        "已有 params 不能被覆盖掉"
    );
}

#[test]
fn missing_output_is_an_error_not_a_silent_success() {
    let fixture = fixture();
    let error = fixture
        .tool(
            "render_code",
            json!({
                "command": "true",
                "cwd": fixture.cwd(),
                "outputPath": "renders/nothing.mp4"
            }),
        )
        .expect_err("命令成功但没产物，必须报错");
    assert!(error.contains("没有产出文件"), "{error}");
}

#[test]
fn timeout_kills_the_command_and_cleans_up() {
    let fixture = fixture();
    let output = fixture.dir.join("renders/slow.mp4");
    let started = std::time::Instant::now();
    let error = fixture
        .tool(
            "render_code",
            json!({
                "command": "echo partial > renders/slow.mp4; sleep 30",
                "cwd": fixture.cwd(),
                "outputPath": "renders/slow.mp4",
                "timeoutSec": 5
            }),
        )
        .expect_err("超时必须报错");
    assert!(error.contains("渲染超时"), "{error}");
    assert!(!output.exists(), "超时后的半成品要删掉");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(20),
        "超时应该真的杀掉进程，而不是等命令自己结束"
    );
}

#[test]
fn unknown_node_fails_loudly() {
    let fixture = fixture();
    let assets_before = fixture.snapshot()["assets"]
        .as_array()
        .map(Vec::len)
        .unwrap_or(0);
    let source = sample_image();
    let command = format!("cp '{}' renders/hero.png", source.display());
    let error = fixture
        .tool(
            "render_code",
            json!({
                "command": command,
                "cwd": fixture.cwd(),
                "outputPath": "renders/hero.png",
                "nodeId": "ghost"
            }),
        )
        .expect_err("节点不存在要报错");
    assert!(error.contains("节点不存在"), "{error}");
    // 节点校验在跑命令之前：既不该留下产物，也不该留下一条没人用的素材。
    assert!(
        !fixture.dir.join("renders/hero.png").exists(),
        "命令不应该被跑起来"
    );
    assert_eq!(
        fixture.snapshot()["assets"]
            .as_array()
            .map(Vec::len)
            .unwrap_or(0),
        assets_before,
        "失败不应该往素材库里多塞一条"
    );
}
