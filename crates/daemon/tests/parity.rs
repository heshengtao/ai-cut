//! 一致性测试：QuickJS 里跑出来的结果，必须与 Node（V8）生成的 golden 逐字段相同。
//!
//! golden 由 `node scripts/domain-golden.mjs` 生成；改了领域代码或 fixture 后要重新生成。

use aicut_daemon::{DocEngine, IdSource};

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读取 {path} 失败：{e}"))
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("不是合法 JSON：{e}\n{text}"))
}

#[test]
fn quickjs_matches_v8_golden() {
    let engine = DocEngine::new(IdSource::Deterministic).expect("创建引擎");

    let project = fixture("project.json");
    engine.load(&project).expect("载入工程");

    let commands: Vec<serde_json::Value> = serde_json::from_str(&fixture("commands.json")).unwrap();
    let expected: serde_json::Value = serde_json::from_str(&fixture("expected.json")).unwrap();

    let results: Vec<serde_json::Value> = commands
        .iter()
        .map(|command| {
            let out = engine.apply(&command.to_string()).expect("应用命令");
            json(&out)
        })
        .collect();

    assert_eq!(
        serde_json::Value::Array(results),
        expected["results"],
        "命令结果与 Node golden 不一致"
    );

    let snapshot = json(&engine.snapshot().expect("取快照"));
    assert_eq!(
        snapshot, expected["snapshot"],
        "最终文档与 Node golden 不一致"
    );
}

#[test]
fn rejects_stale_revision() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    engine.load(&fixture("project.json")).unwrap();

    let command = r#"{
        "id": "c1",
        "baseRevision": 7,
        "actor": "human",
        "kind": "project.rename",
        "payload": { "name": "nope" },
        "label": "stale",
        "timestamp": 0
    }"#;
    let result = json(&engine.apply(command).unwrap());
    assert_eq!(result["ok"], false);
    assert_eq!(result["revision"], 0);
    assert!(result["error"].as_str().unwrap().contains("stale revision"));
}

#[test]
fn exposes_mcp_views() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    engine.load(&fixture("project.json")).unwrap();

    let overview = json(&engine.view("overview", "{}").unwrap());
    assert_eq!(overview["revision"], 0);
    assert!(overview["project"].is_object() || overview["name"].is_string());
}
