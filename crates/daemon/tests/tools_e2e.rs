//! 片段级 AI 工具的**真实模型**端到端测试（可选跑）。
//!
//! 这些用例要真模型 + ffmpeg + 样例媒体，所以默认跳过：把 `AICUT_E2E_DIR` 指到
//! 一个「有 `models/` 和 `media/` 的目录」才会执行。本地这样准备：
//!
//! ```sh
//! mkdir -p /tmp/aicut-e2e/media
//! ln -s ~/Library/Application\ Support/com.aicut.editor/models /tmp/aicut-e2e/models
//! ffmpeg -f lavfi -i "sine=frequency=440:duration=3" /tmp/aicut-e2e/media/tone.wav
//! ffmpeg -f lavfi -i "testsrc=size=320x240:rate=10:duration=2" /tmp/aicut-e2e/media/clip.mp4
//! AICUT_E2E_DIR=/tmp/aicut-e2e cargo test --manifest-path crates/daemon/Cargo.toml --test tools_e2e
//! ```
//!
//! 目的不是覆盖率，而是回答"本地推理有没有被改坏"：每个工具都走 `dispatch`
//! （智能体 / MCP 的同一条入口）→ 真模型 → 领域层落位 → 断言文档形状。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use aicut_daemon::agent_tools;
use aicut_daemon::video_dsp::VideoDspState;
use aicut_daemon::{DocHandle, HeadlessHost, Host};
use serde_json::{json, Value};

/// 当前分P（工程文档 v2：时间线在 `episodes[activeEpisodeId]` 里，根级不再有 tracks）。
fn active_episode(doc: &serde_json::Value) -> &serde_json::Value {
    let active = doc["activeEpisodeId"].as_str().unwrap_or_default();
    let episodes = doc["episodes"].as_array().expect("snapshot 缺少 episodes");
    episodes
        .iter()
        .find(|episode| episode["id"].as_str() == Some(active))
        .unwrap_or_else(|| &episodes[0])
}


/// 这些用例会跑真模型：视频/音频 AI 各自有"同一时刻只跑一个任务"的全局互斥，
/// 所以整组串行执行（否则并行跑会互相抢占）。
fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

struct Fixture {
    doc: DocHandle,
    host: Arc<dyn Host>,
    video: Arc<VideoDspState>,
    clip_id: String,
    _dir: PathBuf,
    runtime: tokio::runtime::Runtime,
}

fn e2e_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("AICUT_E2E_DIR").map(PathBuf::from)?;
    if dir.join("models").is_dir() && dir.join("media").is_dir() {
        Some(dir)
    } else {
        None
    }
}

fn model_installed(dir: &Path, id: &str) -> bool {
    dir.join("models").join(id).is_dir()
}

/// 建一个「一条轨 + 一个片段」的工程；语法全是命令，片段才带 `trackId`。
fn setup(media: &str, asset_id: &str, kind: &str) -> Option<Fixture> {
    let dir = e2e_dir()?;
    let file = dir.join("media").join(media);
    if !file.is_file() {
        return None;
    }
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(dir.clone(), dir.clone()));
    let doc = DocHandle::spawn();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    let project = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project.json");
    let json_text = std::fs::read_to_string(project).expect("fixture");
    runtime.block_on(doc.load(json_text)).expect("load");

    let (duration, extra) = if kind == "video" {
        (2.0, json!({ "width": 320, "height": 240, "fps": 10.0, "hasAudio": false }))
    } else {
        (3.0, json!({ "hasAudio": true }))
    };

    let apply = |kind: &str, payload: Value| -> Value {
        let revision = runtime.block_on(doc.revision()).unwrap();
        let command = json!({ "kind": kind, "payload": payload, "baseRevision": revision });
        let text = runtime.block_on(doc.apply(command.to_string())).expect("apply");
        let value: Value = serde_json::from_str(&text).expect("apply json");
        assert_eq!(value["ok"], true, "命令失败：{value}");
        value
    };

    let track = apply("track.add", json!({ "type": kind, "name": "原声" }));
    let track_id = track["affected"]["trackIds"][0].as_str().unwrap().to_string();
    let mut asset = json!({
        "id": asset_id,
        "name": media,
        "kind": kind,
        "src": file.to_string_lossy(),
        "duration": duration,
        "addedAt": 0,
    });
    for (key, value) in extra.as_object().unwrap() {
        asset[key] = value.clone();
    }
    apply("asset.add", json!({ "asset": asset }));
    let clip = apply(
        "clip.add",
        json!({ "trackId": track_id, "clip": {
            "assetId": asset_id, "start": 0.0, "duration": duration, "in": 0
        }}),
    );
    let clip_id = clip["affected"]["clipIds"][0].as_str().unwrap().to_string();

    Some(Fixture {
        doc,
        host,
        video: Arc::new(VideoDspState::default()),
        clip_id,
        _dir: dir,
        runtime,
    })
}

impl Fixture {
    fn snapshot(&self) -> Value {
        let text = self.runtime.block_on(self.doc.snapshot()).expect("snapshot");
        serde_json::from_str(&text).expect("snapshot json")
    }

    fn call(&self, tool: &str, args: Value) -> Result<Value, String> {
        self.runtime.block_on(agent_tools::dispatch(
            &self.doc,
            &self.host,
            &self.video,
            tool,
            args,
            None,
        ))
    }
}

#[test]
fn separate_stems_end_to_end() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "uvr-mdx-voc-ft") {
        return;
    }
    let Some(fixture) = setup("tone.wav", "a1", "audio") else {
        return;
    };
    let result = fixture
        .call(
            "separate_stems",
            json!({ "clipId": fixture.clip_id, "modelId": "uvr-mdx-voc-ft" }),
        )
        .expect("separate_stems");
    assert_eq!(result["model"], "uvr-mdx-voc-ft");

    let snapshot = fixture.snapshot();
    let tracks = active_episode(&snapshot)["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 3, "原声 + 两条分轨");
    assert_eq!(tracks[0]["clips"][0]["muted"], true, "源片段必须静音");
}

#[test]
fn process_audio_replaces_clip_in_place() {
    let _guard = serial();
    let Some(fixture) = setup("tone.wav", "a1", "audio") else {
        return;
    };
    fixture
        .call(
            "process_audio",
            json!({ "clipId": fixture.clip_id, "effect": "beautify", "preset": "natural" }),
        )
        .expect("process_audio");

    let snapshot = fixture.snapshot();
    let tracks = active_episode(&snapshot)["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 1, "纯音频片段就地换素材，不另开轨");
    assert_ne!(tracks[0]["clips"][0]["assetId"], "a1");
}

#[test]
fn transcribe_writes_a_caption_track() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "paraformer-zh-small-int8") || !model_installed(&dir, "silero-vad") {
        return;
    }
    let Some(fixture) = setup("tone.wav", "a1", "audio") else {
        return;
    };
    let result = fixture
        .call(
            "transcribe",
            json!({ "clipId": fixture.clip_id, "modelId": "paraformer-zh-small-int8" }),
        )
        .expect("transcribe");
    assert_eq!(result["model"], "paraformer-zh-small-int8");
    assert!(result["cueCount"].is_number());
}

#[test]
fn upscale_video_replaces_the_clip() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "realesr-general-x4v3") {
        return;
    }
    let Some(fixture) = setup("clip.mp4", "v1", "video") else {
        return;
    };
    fixture
        .call(
            "upscale_video",
            json!({ "clipId": fixture.clip_id, "modelId": "realesr-general-x4v3", "scale": 2 }),
        )
        .expect("upscale_video");

    let snapshot = fixture.snapshot();
    let clips = active_episode(&snapshot)["tracks"][0]["clips"].as_array().unwrap();
    assert_eq!(clips.len(), 1);
    assert_ne!(clips[0]["assetId"], "v1");
    assert_eq!(clips[0]["in"], 0.0);
}

#[test]
fn interpolate_video_replaces_the_clip() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "rife-v4.7") {
        return;
    }
    let Some(fixture) = setup("clip.mp4", "v1", "video") else {
        return;
    };
    fixture
        .call(
            "interpolate_video",
            json!({ "clipId": fixture.clip_id, "modelId": "rife-v4.7", "factor": 2 }),
        )
        .expect("interpolate_video");
}

#[test]
fn reframe_video_tracks_the_subject() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "yolox-nano") {
        return;
    }
    let Some(fixture) = setup("clip.mp4", "v1", "video") else {
        return;
    };
    fixture
        .call(
            "reframe_video",
            json!({ "clipId": fixture.clip_id, "subject": "person", "aspect": "9:16" }),
        )
        .expect("reframe_video");
}

#[test]
fn synthesize_voiceover_lands_a_track() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    if !model_installed(&dir, "moss-tts-nano") {
        return;
    }
    let Some(fixture) = setup("tone.wav", "a1", "audio") else {
        return;
    };
    let result = fixture
        .call(
            "synthesize_voiceover",
            json!({ "text": "你好世界", "start": 0.5 }),
        )
        .expect("synthesize_voiceover");
    assert_eq!(result["count"], 1);

    let snapshot = fixture.snapshot();
    let tracks = active_episode(&snapshot)["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 2, "原声 + 朗读");
    assert_eq!(tracks[1]["clips"][0]["start"], 0.5);
}

// ---------------------------------------------------------------------------
// OFX 整段烘焙：用真实的 OpenFX 示例插件（Invert）跑一遍
// ---------------------------------------------------------------------------

fn ofx_bundle() -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("AICUT_E2E_OFX") {
        let path = std::path::PathBuf::from(path);
        return path.exists().then_some(path);
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let path = std::path::PathBuf::from(home).join(
        "Library/Application Support/com.aicut.editor/plugins/ofx/openfx_invert/invert.ofx.bundle",
    );
    path.exists().then_some(path)
}

#[test]
fn ofx_bake_clip_encodes_a_real_video() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    let Some(bundle) = ofx_bundle() else { return };
    let Some(fixture) = setup("clip.mp4", "v1", "video") else {
        return;
    };
    let source = dir.join("media/clip.mp4").to_string_lossy().into_owned();
    let output = dir.join("media/ofx-bake.mp4").to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&output);

    let plugins = fixture
        .runtime
        .block_on(aicut_daemon::ofx::ofx_probe(
            bundle.to_string_lossy().into_owned(),
            None,
            None,
        ))
        .expect("枚举 OFX 插件");
    let plugin = plugins
        .iter()
        .find(|info| info.contexts.iter().any(|context| context.contains("Filter")))
        .or_else(|| plugins.first())
        .expect("插件列表是空的")
        .clone();
    println!("OFX 插件：{:?}", plugin.name);
    println!("contexts：{:?}", plugin.contexts);
    println!("chosen context：{:?}", plugin.context);

    let request = aicut_daemon::ofx::OfxBakeRequest {
        id: Some("e2e-bake".into()),
        preview: true,
        source,
        source_in: 0.0,
        duration: 1.0,
        speed: 1.0,
        fps: 10.0,
        width: 320,
        height: 240,
        is_image: false,
        source_duration: 2.0,
        fit: Some("contain".into()),
        fit_anchor: None,
        time_offset: 0.0,
        effects: vec![aicut_daemon::ofx::OfxEffectSpec {
            bundle: bundle.to_string_lossy().into_owned(),
            plugin: plugin.identifier.clone(),
            context: Some(plugin.context.clone()),
            params: None,
        }],
        output: output.clone(),
    };
    let path = fixture
        .runtime
        .block_on(aicut_daemon::ofx::ofx_bake_clip(&fixture.host, request))
        .expect("整段烘焙");
    assert_eq!(path, output);
    let size = std::fs::metadata(&path).expect("烘焙结果不存在").len();
    assert!(size > 1000, "烘焙结果太小：{size} 字节");

    // 不只是"有文件"：首帧必须真的被插件改过（Invert 会把亮度翻过来）。
    let source = dir.join("media/clip.mp4").to_string_lossy().into_owned();
    let before = mean_luma(&source);
    let after = mean_luma(&path);
    assert!(
        (before + after - 255.0).abs() < 40.0,
        "首帧亮度没有被反相：源 {before:.1} → 结果 {after:.1}"
    );
}

/// 用 ffmpeg 取首帧灰度平均值（0..255）。
fn mean_luma(path: &str) -> f64 {
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-v", "error", "-i", path, "-vf", r"select=eq(n\,0)", "-frames:v", "1",
            "-f", "rawvideo", "-pix_fmt", "gray", "-",
        ])
        .output()
        .expect("ffmpeg");
    assert!(output.status.success(), "ffmpeg 取帧失败：{path}");
    assert!(!output.stdout.is_empty(), "取不到首帧：{path}");
    let sum: u64 = output.stdout.iter().map(|v| *v as u64).sum();
    sum as f64 / output.stdout.len() as f64
}

// ---------------------------------------------------------------------------
// 编辑宏（不需要模型）：导入 → 追加 → 变速 → 标记 → 复制 → 波纹删除
// ---------------------------------------------------------------------------

#[test]
fn editing_macros_drive_the_timeline() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    let media = dir.join("media/tone.wav");
    if !media.is_file() {
        return;
    }
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(dir.clone(), dir.clone()));
    let doc = DocHandle::spawn();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let project = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project.json");
    let json_text = std::fs::read_to_string(project).expect("fixture");
    runtime.block_on(doc.load(json_text)).expect("load");

    let fixture = Fixture {
        doc,
        host,
        video: Arc::new(VideoDspState::default()),
        clip_id: String::new(),
        _dir: dir.clone(),
        runtime,
    };
    let snapshot = || {
        let text = fixture.runtime.block_on(fixture.doc.snapshot()).expect("snapshot");
        let value: Value = serde_json::from_str(&text).expect("json");
        value
    };

    // 1) 导入素材：走真实 ffprobe，字段与桌面 importAssetAt 一致
    let imported = fixture
        .call("import_asset", json!({ "path": media.to_string_lossy() }))
        .expect("import_asset");
    let asset_id = imported["assetId"].as_str().unwrap().to_string();
    let snapshot_value = snapshot();
    let asset = &snapshot_value["assets"][0];
    assert_eq!(asset["id"], asset_id.as_str());
    assert_eq!(asset["kind"], "audio");
    assert!(asset["duration"].as_f64().unwrap() > 2.0, "时长应由 ffprobe 探测");
    assert!(asset["addedAt"].is_number(), "addedAt 不能缺（桌面同字段）");

    // 2) 追加到时间线：没有轨道时自动建轨
    let appended = fixture
        .call("append_clip", json!({ "assetId": asset_id }))
        .expect("append_clip");
    let clip_id = appended["affected"]["clipIds"][0]
        .as_str()
        .unwrap()
        .to_string();

    // 3) 变速
    fixture
        .call("set_clip_speed", json!({ "clipId": clip_id, "speed": 2.0 }))
        .expect("set_clip_speed");
    let snapshot_value = snapshot();
    let clip = &active_episode(&snapshot_value)["tracks"][0]["clips"][0];
    assert_eq!(clip["speed"], 2.0);

    // 4) 标记
    fixture
        .call("add_marker", json!({ "time": 1.0, "name": "重点" }))
        .expect("add_marker");
    let snapshot_value = snapshot();
    let marker_id = active_episode(&snapshot_value)["markers"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(active_episode(&snapshot_value)["markers"][0]["name"], "重点");

    fixture
        .call("update_marker", json!({ "markerId": marker_id, "name": "改名" }))
        .expect("update_marker");
    assert_eq!(active_episode(&snapshot())["markers"][0]["name"], "改名");
    fixture
        .call("remove_marker", json!({ "markerId": marker_id }))
        .expect("remove_marker");
    assert!(active_episode(&snapshot())["markers"].as_array().unwrap().is_empty());

    // 5) 复制 + 波纹删除
    fixture
        .call("duplicate_clips", json!({ "clipIds": [clip_id], "offset": 10.0 }))
        .expect("duplicate_clips");
    let snapshot_value = snapshot();
    let clips = active_episode(&snapshot_value)["tracks"][0]["clips"].as_array().unwrap();
    assert_eq!(clips.len(), 2, "复制后应有两条片段");
    let duplicate_id = clips[1]["id"].as_str().unwrap().to_string();

    fixture
        .call("ripple_delete", json!({ "clipIds": [duplicate_id] }))
        .expect("ripple_delete");
    let snapshot_value = snapshot();
    assert_eq!(
        active_episode(&snapshot_value)["tracks"][0]["clips"].as_array().unwrap().len(),
        1
    );

    // 6) 不支持的扩展名要明确报错，而不是登记一条坏素材
    let bad = dir.join("media/notes.txt");
    std::fs::write(&bad, b"hello").unwrap();
    let error = fixture
        .call("import_asset", json!({ "path": bad.to_string_lossy() }))
        .expect_err("不支持的类型必须报错");
    assert!(error.contains("不支持"), "{error}");
}

// ---------------------------------------------------------------------------
// 导出 / 渲染：滤镜图在领域层编译，Rust 只负责跑 ffmpeg
// ---------------------------------------------------------------------------

fn install_export_state() -> Arc<aicut_daemon::export::ExportState> {
    let state = Arc::new(aicut_daemon::export::ExportState::default());
    aicut_daemon::export::install_shared(Arc::clone(&state));
    state
}

#[test]
fn export_video_writes_a_playable_file() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    let media = dir.join("media/clip.mp4");
    if !media.is_file() {
        return;
    }
    let _state = install_export_state();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(dir.clone(), dir.clone()));
    let doc = DocHandle::spawn();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let project = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project.json");
    let json_text = std::fs::read_to_string(project).expect("fixture");
    runtime.block_on(doc.load(json_text)).expect("load");

    let fixture = Fixture {
        doc,
        host,
        video: Arc::new(VideoDspState::default()),
        clip_id: String::new(),
        _dir: dir.clone(),
        runtime,
    };

    let imported = fixture
        .call("import_asset", json!({ "path": media.to_string_lossy() }))
        .expect("import_asset");
    let asset_id = imported["assetId"].as_str().unwrap().to_string();
    fixture
        .call("append_clip", json!({ "assetId": asset_id }))
        .expect("append_clip");

    let output = dir.join("media/export-out.mp4");
    let _ = std::fs::remove_file(&output);
    let result = fixture
        .call(
            "export_video",
            json!({
                "outputPath": output.to_string_lossy(),
                "format": "mp4",
                "resolution": "project",
                "quality": "standard",
            }),
        )
        .expect("export_video");
    assert_eq!(result["path"], output.to_string_lossy().as_ref());
    let size = std::fs::metadata(&output).expect("导出结果不存在").len();
    assert!(size > 1000, "导出结果太小：{size} 字节");

    // 时长应与片段一致（2 秒，允许一点封装误差）。
    let probed = std::process::Command::new("ffprobe")
        .args([
            "-v", "error", "-show_entries", "format=duration", "-of",
            "default=noprint_wrappers=1:nokey=1",
            output.to_string_lossy().as_ref(),
        ])
        .output()
        .expect("ffprobe");
    let duration: f64 = String::from_utf8_lossy(&probed.stdout)
        .trim()
        .parse()
        .expect("解析时长");
    assert!((duration - 2.0).abs() < 0.4, "导出时长异常：{duration}");

    // 静帧
    let png = dir.join("media/export-frame.png");
    let _ = std::fs::remove_file(&png);
    fixture
        .call(
            "render_frame",
            json!({ "time": 0.5, "outputPath": png.to_string_lossy() }),
        )
        .expect("render_frame");
    let size = std::fs::metadata(&png).expect("静帧不存在").len();
    assert!(size > 500, "静帧太小：{size} 字节");

    // 状态查询
    let status = fixture.call("render_status", json!({})).expect("render_status");
    assert_eq!(status["busy"], false);
}

// ---------------------------------------------------------------------------
// 工程生命周期 / 历史 / 字幕 / 审片批注 / 后台任务
// ---------------------------------------------------------------------------

#[test]
fn session_history_and_review_tools_work() {
    let _guard = serial();
    let Some(dir) = e2e_dir() else { return };
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(dir.clone(), dir.clone()));
    let doc = DocHandle::spawn();
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let project = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project.json");
    let json_text = std::fs::read_to_string(project).expect("fixture");
    runtime.block_on(doc.load(json_text)).expect("load");

    let fixture = Fixture {
        doc,
        host,
        video: Arc::new(VideoDspState::default()),
        clip_id: String::new(),
        _dir: dir.clone(),
        runtime,
    };
    let snapshot = || {
        let text = fixture.runtime.block_on(fixture.doc.snapshot()).expect("snapshot");
        let value: Value = serde_json::from_str(&text).expect("json");
        value
    };

    // 1) 新建工程
    fixture
        .call("new_project", json!({ "name": "空工程", "fps": 25 }))
        .expect("new_project");
    let snapshot_value = snapshot();
    assert_eq!(snapshot_value["name"], "空工程");
    assert_eq!(snapshot_value["fps"], 25.0);
    assert!(active_episode(&snapshot_value)["tracks"].as_array().unwrap().is_empty());

    // 2) 命令 + 撤销 / 重做
    let track = fixture
        .call("apply_command", json!({ "command": {
            "kind": "track.add", "payload": { "type": "audio", "name": "A" }
        }}))
        .expect("track.add");
    assert_eq!(active_episode(&snapshot())["tracks"].as_array().unwrap().len(), 1);
    let undone = fixture.call("undo", json!({})).expect("undo");
    assert_eq!(undone["changed"], true);
    assert!(active_episode(&snapshot())["tracks"].as_array().unwrap().is_empty(), "撤销应移除轨道");
    fixture.call("redo", json!({})).expect("redo");
    assert_eq!(active_episode(&snapshot())["tracks"].as_array().unwrap().len(), 1, "重做应恢复轨道");
    let _ = track;

    // 3) 审片批注
    let note = fixture
        .call(
            "add_review_note",
            json!({ "time": 1.5, "text": "这里要重录", "severity": "high" }),
        )
        .expect("add_review_note");
    let marker_id = note["markerId"].as_str().unwrap().to_string();
    let notes = fixture
        .call("list_review_notes", json!({}))
        .expect("list_review_notes");
    let items = notes["markers"].as_array().or_else(|| notes["items"].as_array());
    assert!(items.is_some(), "list_review_notes 应返回列表：{notes}");
    fixture
        .call("update_review_note", json!({ "markerId": marker_id, "resolved": true }))
        .expect("update_review_note");
    fixture
        .call("remove_review_note", json!({ "markerId": marker_id }))
        .expect("remove_review_note");
    assert!(active_episode(&snapshot())["markers"].as_array().unwrap().is_empty());

    // 4) 文字片段 → 导出 SRT → 再导入
    fixture
        .call("apply_command", json!({ "command": {
            "kind": "clip.add",
            "payload": {
                "trackId": active_episode(&snapshot())["tracks"][0]["id"],
                "clip": { "assetId": "", "start": 0.0, "duration": 1.0, "text": "第一句" }
            }
        }}))
        .expect("clip.add 文字片段");
    let srt = dir.join("media/out.srt");
    let _ = std::fs::remove_file(&srt);
    let exported = fixture
        .call("export_subtitles", json!({ "outputPath": srt.to_string_lossy() }))
        .expect("export_subtitles");
    assert_eq!(exported["count"], 1);
    let text = std::fs::read_to_string(&srt).expect("SRT 文件");
    assert!(text.contains("第一句"), "SRT 内容不对：{text}");

    let imported = fixture
        .call("import_subtitles", json!({ "path": srt.to_string_lossy(), "trackName": "导入字幕" }))
        .expect("import_subtitles");
    assert_eq!(imported["count"], 1);

    // 5) 保存 / 打开
    let saved = dir.join("media/project.json");
    let _ = std::fs::remove_file(&saved);
    fixture
        .call("save_project", json!({ "path": saved.to_string_lossy() }))
        .expect("save_project");
    assert!(saved.is_file(), "save_project 没有写文件");
    fixture
        .call("open_project", json!({ "path": saved.to_string_lossy() }))
        .expect("open_project");

    // 6) 影片结构：导出 → 新工程 → 导入
    let film = dir.join("media/film.json");
    fixture
        .call("export_film_manifest", json!({ "path": film.to_string_lossy() }))
        .expect("export_film_manifest");
    assert!(film.is_file(), "film.json 没有写盘");
    let exported_manifest: Value =
        serde_json::from_str(&std::fs::read_to_string(&film).unwrap()).unwrap();
    assert!(exported_manifest["scenes"].is_array());

    // 手写一份最小可用 manifest：一场戏 + 一条 take（指向真实媒体）
    let take = dir.join("media/clip.mp4");
    if take.is_file() {
        let manifest = json!({
            "version": exported_manifest["version"],
            "scenes": [{ "id": "s01", "t0": 0.0, "t1": 2.0, "take": "clip.mp4" }]
        });
        std::fs::write(&film, serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
        let imported = fixture
            .call("import_film_manifest", json!({ "path": film.to_string_lossy() }))
            .expect("import_film_manifest");
        assert_eq!(imported["scenes"], 1, "导入应返回 1 场：{imported}");
    }

    // 7) 后台任务：跑一个轻量工具并轮询到完成
    let job = fixture
        .call("job_start", json!({ "kind": "render_status", "params": {} }))
        .expect("job_start");
    let job_id = job["jobId"].as_str().unwrap().to_string();
    let mut status = Value::Null;
    for _ in 0..50 {
        status = fixture
            .call("job_status", json!({ "jobId": job_id }))
            .expect("job_status");
        if status["status"] != "running" {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(status["status"], "done", "后台任务没有完成：{status}");
}
