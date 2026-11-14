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

// ---------------------------------------------------------------------------
// 领域写操作（`AICUT.op`）：AI 产出物的落位规则
//
// 这些用例盯的是"桌面怎么落、无头就怎么落"：同一个片段、同一批函数，
// 断言文档形状（轨道顺序 / 静音 / 替换还是另开一轨）。
// ---------------------------------------------------------------------------

use serde_json::json;

/// 应用一条命令（自动带上当前 revision）。
fn apply(engine: &DocEngine, kind: &str, payload: serde_json::Value) -> serde_json::Value {
    let command = json!({
        "kind": kind,
        "payload": payload,
        "baseRevision": engine.revision().unwrap(),
    });
    json(&engine.apply(&command.to_string()).unwrap())
}

/// 一条音轨 + 一个 10 秒音频片段（用命令搭，片段才会带 `trackId` 等派生字段）。
fn project_with_audio_clip(engine: &DocEngine) -> (String, String) {
    engine.load(&fixture("project.json")).unwrap();
    let track = apply(&engine, "track.add", json!({ "type": "audio", "name": "原声" }));
    let track_id = track["affected"]["trackIds"][0].as_str().unwrap().to_string();
    apply(
        &engine,
        "asset.add",
        json!({ "asset": {
            "id": "a1", "name": "in.wav", "kind": "audio", "src": "/tmp/in.wav",
            "duration": 10.0, "addedAt": 0, "hasAudio": true
        }}),
    );
    let clip = apply(
        &engine,
        "clip.add",
        json!({ "trackId": track_id, "clip": {
            "assetId": "a1", "start": 1.0, "duration": 10.0, "in": 0
        }}),
    );
    let clip_id = clip["affected"]["clipIds"][0].as_str().unwrap().to_string();
    (track_id, clip_id)
}

#[test]
fn op_subtitle_track_puts_captions_on_top() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    let (_track_id, _clip_id) = project_with_audio_clip(&engine);

    let outcome = json(
        &engine
            .op(
                "subtitle_track",
                &json!({ "cues": [
                    { "start": 0.0, "duration": 1.0, "text": "第一句" },
                    { "start": 1.5, "duration": 1.0, "text": "第二句" },
                    { "start": 3.0, "duration": 1.0, "text": "   " }
                ]})
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);
    assert_eq!(outcome["revision"], 4);
    assert_eq!(outcome["result"]["inserted"], 2);

    let snapshot = json(&engine.snapshot().unwrap());
    // 字幕轨必须在最上方（预览按轨道顺序叠层）。
    assert_eq!(snapshot["tracks"][0]["name"], "字幕");
    assert_eq!(snapshot["tracks"][0]["clips"].as_array().unwrap().len(), 2);
    assert_eq!(snapshot["tracks"][0]["clips"][0]["text"], "第一句");
}

#[test]
fn op_processed_audio_replaces_audio_in_place() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    let (track_id, clip_id) = project_with_audio_clip(&engine);

    let outcome = json(
        &engine
            .op(
                "processed_audio",
                &json!({
                    "assets": [{ "id": "a2", "name": "denoised.wav", "kind": "audio",
                                 "src": "/tmp/denoised.wav", "duration": 10.0, "addedAt": 0,
                                 "hasAudio": true }],
                    "clipId": clip_id,
                    "assetId": "a2",
                    "duration": 10.0,
                    "sourceKind": "audio",
                    "trackName": "AI 降噪",
                })
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);

    let snapshot = json(&engine.snapshot().unwrap());
    // 桌面对纯音频片段是"就地换素材"，不是另开一轨。
    assert_eq!(snapshot["tracks"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["tracks"][0]["id"], track_id.as_str());
    assert_eq!(snapshot["tracks"][0]["clips"][0]["assetId"], "a2");
    assert_eq!(outcome["result"]["tracks"].as_array().unwrap().len(), 0);
}

#[test]
fn op_stem_tracks_mute_source_and_insert_below() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    let (track_id, clip_id) = project_with_audio_clip(&engine);

    let outcome = json(
        &engine
            .op(
                "stem_tracks",
                &json!({
                    "assets": [
                        { "id": "s1", "name": "vocals.wav", "kind": "audio", "src": "/tmp/vocals.wav",
                          "duration": 10.0, "addedAt": 0, "hasAudio": true },
                        { "id": "s2", "name": "accompaniment.wav", "kind": "audio",
                          "src": "/tmp/accompaniment.wav", "duration": 10.0, "addedAt": 0,
                          "hasAudio": true },
                    ],
                    "clipId": clip_id,
                    "stems": [
                        { "name": "vocals", "assetId": "s1", "duration": 10.0 },
                        { "name": "accompaniment", "assetId": "s2", "duration": 10.0 },
                    ],
                })
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);

    let snapshot = json(&engine.snapshot().unwrap());
    let tracks = snapshot["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 3);
    // 分轨插在源轨道下方，源片段静音。
    assert_eq!(tracks[0]["id"], track_id.as_str());
    assert_eq!(tracks[0]["clips"][0]["muted"], true);
    assert_eq!(tracks[1]["clips"][0]["assetId"], "s1");
    assert_eq!(tracks[2]["clips"][0]["assetId"], "s2");
    // 分轨片段对齐到源片段起点。
    assert_eq!(tracks[1]["clips"][0]["start"], 1.0);
}

#[test]
fn op_replace_video_resets_clip_in_point() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    engine.load(&fixture("project.json")).unwrap();
    let track = apply(&engine, "track.add", json!({ "type": "video", "name": "画面" }));
    let track_id = track["affected"]["trackIds"][0].as_str().unwrap().to_string();
    apply(
        &engine,
        "asset.add",
        json!({ "asset": { "id": "v1", "name": "in.mp4", "kind": "video",
                           "src": "/tmp/in.mp4", "duration": 10.0, "addedAt": 0,
                           "hasAudio": true, "width": 1920, "height": 1080, "fps": 30.0 }}),
    );
    let clip = apply(
        &engine,
        "clip.add",
        json!({ "trackId": track_id, "clip": {
            "assetId": "v1", "start": 2.0, "duration": 5.0, "in": 3.0
        }}),
    );
    let clip_id = clip["affected"]["clipIds"][0].as_str().unwrap().to_string();

    let outcome = json(
        &engine
            .op(
                "replace_video",
                &json!({
                    "assets": [{ "id": "v2", "name": "out.mp4", "kind": "video",
                                 "src": "/tmp/out.mp4", "duration": 4.0, "addedAt": 0,
                                 "hasAudio": false, "width": 3840, "height": 2160, "fps": 30.0 }],
                    "clipId": clip_id,
                    "assetId": "v2",
                    "duration": 4.0,
                })
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);

    let snapshot = json(&engine.snapshot().unwrap());
    let clip = &snapshot["tracks"][0]["clips"][0];
    assert_eq!(clip["assetId"], "v2");
    assert_eq!(clip["in"], 0.0);
    assert_eq!(clip["duration"], 4.0);
}

#[test]
fn op_map_cues_snaps_to_frames_and_clips_to_window() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    let (_track_id, clip_id) = project_with_audio_clip(&engine);

    let outcome = json(
        &engine
            .op(
                "map_cues",
                &json!({ "clipId": clip_id, "fps": 30, "cues": [
                    { "start": 0.0, "end": 1.234, "text": "in-window" },
                    { "start": 12.0, "end": 13.0, "text": "outside-clip" }
                ]})
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);
    assert_eq!(outcome["changed"], false);
    let cues = outcome["result"]["cues"].as_array().unwrap();
    assert_eq!(cues.len(), 1, "超出片段窗口的字幕必须丢弃");
    assert_eq!(cues[0]["text"], "in-window");
    // 片段起点 1s + 帧吸附（30fps → 1/30 秒网格）。
    let start = cues[0]["start"].as_f64().unwrap();
    let snapped = (start - 1.0) * 30.0;
    assert!((snapped - snapped.round()).abs() < 1e-6, "start 没有吸附到帧：{start}");
}

#[test]
fn op_cut_filler_dry_run_changes_nothing() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    let (_track_id, clip_id) = project_with_audio_clip(&engine);
    let before = engine.snapshot().unwrap();

    let outcome = json(
        &engine
            .op(
                "cut_filler",
                &json!({
                    "clipId": clip_id,
                    "dryRun": true,
                    "timed": true,
                    "words": [
                        { "text": "嗯", "start": 0.0, "end": 0.3 },
                        { "text": "今天", "start": 0.3, "end": 0.9 },
                        { "text": "天气", "start": 0.9, "end": 1.5 }
                    ]
                })
                .to_string(),
            )
            .unwrap(),
    );
    assert_eq!(outcome["ok"], true);
    assert_eq!(outcome["result"]["applied"], false);
    assert!(outcome["result"]["cutCount"].as_u64().unwrap() >= 1);
    assert_eq!(engine.snapshot().unwrap(), before, "dryRun 不能改文档");
}

#[test]
fn op_translate_keys_uses_the_shared_dictionary() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    engine.load(&fixture("project.json")).unwrap();

    let zh = json(
        &engine
            .op("translate_keys", &json!({ "keys": ["ai.subtitleTrack"] }).to_string())
            .unwrap(),
    );
    assert_eq!(zh["result"]["labels"]["ai.subtitleTrack"], "字幕");

    engine.set_locale("en").unwrap();
    let en = json(
        &engine
            .op("translate_keys", &json!({ "keys": ["ai.subtitleTrack"] }).to_string())
            .unwrap(),
    );
    assert_eq!(en["result"]["labels"]["ai.subtitleTrack"], "Captions");
}

#[test]
fn op_rejects_unknown_operations() {
    let engine = DocEngine::new(IdSource::Deterministic).unwrap();
    engine.load(&fixture("project.json")).unwrap();
    let outcome = json(&engine.op("nope", "{}").unwrap());
    assert_eq!(outcome["ok"], false);
    assert!(outcome["error"].as_str().unwrap().contains("unknown op"));
}
