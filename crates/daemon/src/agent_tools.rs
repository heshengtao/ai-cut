//! 智能体的工具分发（无头版）。
//!
//! 桌面壳的工具实现（`src-tauri/src/tools.rs`，2271 行）把每个工具映射到一条
//! `ProjectBridge` 方法，再等 webview 执行。无头版本不需要那一跳：
//! **文档类工具**直接落到 `crate::agent_bridge`（QuickJS 文档引擎 / `doc_apply`），
//! 尚未下沉的工具明确报错（附原因），不让模型拿着空结果继续推理。
//!
//! 工具名与桌面 `tools.rs` 保持完全一致——模型看到的工具清单不变，行为差异只在
//! "哪些已经能用"。

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::agent_bridge;
use crate::host::Host;
use crate::DocHandle;

/// 一次工具调用。
pub async fn dispatch(
    doc: &DocHandle,
    host: &std::sync::Arc<dyn Host>,
    video_dsp: &std::sync::Arc<crate::video_dsp::VideoDspState>,
    name: &str,
    args: Value,
    cancel: Option<&CancellationToken>,
) -> Result<Value, String> {
    if cancel.is_some_and(|token| token.is_cancelled()) {
        return Err("已取消".into());
    }
    // 文档类工具：映射到 `agent_bridge` 的同名方法（参数形状与桌面 `tools.rs` 一致）。
    let (method, payload) = match name {
        // 画布 / 工作流：桌面版走渲染进程的画布 store；无头版只能读工程快照。
        // 快照里的 `boards` / `activeBoardId` 就是真相，读工具据此汇总。
        "board_list_canvases" => return board_list_canvases(doc).await,
        "board_get_canvas" => return board_get_canvas(doc, &args).await,
        "workflow_list" => return Ok(workflow_list(host.as_ref())),
        // 画布写入与工作流运行需要渲染进程的节点定义 / 运行器：明确报错，不伪造成功。
        "board_create_canvas"
        | "board_delete_canvas"
        | "board_rename_canvas"
        | "board_open_canvas"
        | "board_apply_ops"
        | "workflow_publish"
        | "workflow_run" => return Err(desktop_only(name)),
        // 概览：桌面把 `get_project` 走 `project.overview`；这里统一用概览视图。
        "get_project" | "get_context" => ("project.context", json!({})),
        "get_clip" => ("project.clip", args),
        "get_track" => ("project.track", args),
        "find_clips" => ("project.find_clips", args),
        "get_assets" => ("project.assets", args),
        "get_markers" => ("project.markers", args),
        // `apply_command` 的参数是 `{ command: {...} }`：桥接层还会再取一次
        // `payload.command`，所以这里必须把内层命令取出来，不能再包一层
        // （否则领域层收到的是 `{command:{...}}`，报 "stale revision ... undefined"）。
        // 单条命令：**必须**注入 baseRevision 并把 `{ok:false}` 变成错误——
        // 之前直接把命令透传给 `project.apply`，领域层报 "stale revision ... undefined"，
        // 工具却回了一个 ok:false 的"成功"结果，模型会以为写进去了。
        "apply_command" => {
            let command = args
                .get("command")
                .cloned()
                .filter(|value| !value.is_null())
                .ok_or_else(|| "apply_command 需要 command".to_string())?;
            return apply_domain_command(doc, command, &args).await;
        }
        "apply_commands" => ("project.apply_batch", args),
        // 无模型视频处理：滤镜链 + 一次 ffmpeg 转码，结果替换原片段（桌面同名同参）。
        "process_video" => {
            let target = media_target(doc, &args).await?;
            target.require_video()?;
            let options: crate::video_dsp::VideoDspOptions = args
                .get("options")
                .cloned()
                .filter(|value| !value.is_null())
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| format!("options 参数不合法：{error}"))?
                .unwrap_or_default();
            let enabled = options.stabilize.is_some()
                || options.denoise.is_some()
                || options.deflicker.is_some()
                || options.motion_blur.unwrap_or(0.0) > 0.0
                || options.upscale.unwrap_or(1.0) > 1.0;
            if !enabled {
                return Err("options 里至少要启用一项视频处理".into());
            }
            let result = crate::video_dsp::video_dsp_process(
                host.as_ref(),
                video_dsp.as_ref(),
                target.src()?,
                target.in_point(),
                target.duration()?,
                target.fps_or(doc).await?,
                options,
            )
            .await?;
            return replace_video(host, doc, &target, &result.path, result.duration, "视频处理")
                .await;
        }
        // 响度：纯 ffmpeg + ebur128，增益计算与写回走领域层（与桌面同一份）。
        "measure_loudness" => {
            let target = media_target(doc, &args).await?;
            target.require_media()?;
            let clip_id = target
                .clip_id
                .clone()
                .ok_or_else(|| "measure_loudness 需要 clipId".to_string())?;
            let report = crate::audio_analysis::audio_measure_loudness(
                host.as_ref(),
                target.src()?,
                target.in_point(),
                target.duration()?,
            )
            .await?;
            let outcome = crate::doc_ops::call(
                doc,
                "apply_loudness",
                json!({
                    "clipId": clip_id,
                    "report": report,
                    "targetLufs": args.get("targetLufs").and_then(Value::as_f64).unwrap_or(-14.0),
                    "apply": args.get("apply").and_then(Value::as_bool).unwrap_or(false),
                }),
            )
            .await?;
            let mut result = outcome["result"].clone();
            if let Some(map) = result.as_object_mut() {
                map.insert("revision".into(), outcome["revision"].clone());
            }
            return Ok(result);
        }
        // 区间级 AI：片段 → 模型 → 落位（落位规则全部在领域层）。
        // 纯音频片段就地换素材、视频片段静音后另开一轨——与桌面 `applyProcessedAudio` 一致。
        "denoise_audio" => {
            let target = media_target(doc, &args).await?;
            target.require_media()?;
            let clip_id = target
                .clip_id
                .clone()
                .ok_or_else(|| "denoise_audio 需要 clipId".to_string())?;
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "enhance",
                args.get("modelId").and_then(Value::as_str),
                "音频降噪",
            )?;
            let output = crate::audio_ai::audio_ai_denoise(
                host,
                target.src()?,
                target.in_point(),
                target.duration()?,
                model.id.to_string(),
            )
            .await?;
            return process_audio_result(doc, host, &clip_id, &target, &output, "audio.aiDenoiseTrack")
                .await;
        }
        // 无模型 DSP：同一套落位，只换"跑什么"。
        "process_audio" => {
            let target = media_target(doc, &args).await?;
            target.require_media()?;
            let clip_id = target
                .clip_id
                .clone()
                .ok_or_else(|| "process_audio 需要 clipId".to_string())?;
            let effect = args
                .get("effect")
                .and_then(Value::as_str)
                .ok_or_else(|| "process_audio 需要 effect（denoise / beautify）".to_string())?
                .to_string();
            let preset = args
                .get("preset")
                .and_then(Value::as_str)
                .ok_or_else(|| "process_audio 需要 preset".to_string())?
                .to_string();
            let output = crate::audio_ai::audio_dsp_process(
                host,
                target.src()?,
                target.in_point(),
                target.duration()?,
                effect.clone(),
                preset.clone(),
            )
            .await?;
            let track_key = if effect == "denoise" {
                "audio.aiDenoiseTrack"
            } else {
                "audio.beautifyTrack"
            };
            return process_audio_result(doc, host, &clip_id, &target, &output, track_key).await;
        }
        // 素材预检：一次拿到元数据 + 运动/切点 + 可选目标框 + 可选转写。
        // 它本来就住在 `analysis`（已下沉），这里只是把桌面同名工具的参数搬过来。
        "probe_media" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "probe_media 需要 path".to_string())?
                .to_string();
            let options = crate::analysis::ProbeOptions {
                motion: args.get("motion").and_then(Value::as_bool).unwrap_or(true),
                transcript: args
                    .get("transcript")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                objects: crate::analysis::ObjectMode::parse(
                    args.get("objects").and_then(Value::as_str),
                )?,
                interval: args.get("interval").and_then(Value::as_f64),
                max_samples: args
                    .get("maxSamples")
                    .and_then(Value::as_u64)
                    .unwrap_or(60) as usize,
                model_id: args
                    .get("modelId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            };
            let report = crate::analysis::probe(host, path, options).await?;
            return Ok(report);
        }
        // 模型清单：让模型先看一眼"装了什么"，再决定要不要下载 / 用哪个。
        "list_ai_models" => {
            let feature = args.get("feature").and_then(Value::as_str);
            let catalog = crate::models::model_catalog(host.as_ref());
            let items: Vec<Value> = catalog
                .into_iter()
                .filter(|item| feature.is_none_or(|wanted| item.feature == wanted))
                .map(|item| {
                    let mut value = serde_json::to_value(item).unwrap_or(Value::Null);
                    // 只留决策需要的字段：整份清单（含每个文件的 URL 与大小）对模型太长。
                    if let Some(map) = value.as_object_mut() {
                        map.retain(|key, _| {
                            matches!(
                                key.as_str(),
                                "id" | "name" | "feature" | "family" | "installed" | "bundled"
                            )
                        });
                    }
                    value
                })
                .collect();
            return Ok(serde_json::json!({ "models": items }));
        }
        // ------------------------------------------------------------------
        // 片段级 AI：模型在 daemon 里跑，**落位交给领域层**
        // （`doc_ops::call` → `AICUT.op` → 与桌面 `core/aiActions` 同一批纯函数）
        // ------------------------------------------------------------------

        // 一键字幕：识别 → 帧吸附映射 → 顶部字幕轨。
        "transcribe" => {
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "asr",
                args.get("modelId").and_then(Value::as_str),
                "语音识别",
            )?;
            crate::doc_ops::require_installed(host.as_ref(), "vad", "语音检测")?;
            let target = media_target(doc, &args).await?;
            let language = args
                .get("language")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let cues = crate::asr::asr_transcribe(host, target.src()?, model.id.to_string(), language)
                .await?;
            let mapped = map_cues(doc, &target, &cues).await?;
            let mut track = Value::Null;
            let mut inserted = 0u64;
            let mut revision = Value::Null;
            let insert = args
                .get("insertSubtitles")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            if insert {
                let outcome = crate::doc_ops::call(
                    doc,
                    "subtitle_track",
                    json!({
                        "cues": mapped,
                        "baseName": args.get("trackName").and_then(Value::as_str).unwrap_or(""),
                    }),
                )
                .await?;
                track = outcome["result"]["track"].clone();
                inserted = outcome["result"]["inserted"].as_u64().unwrap_or(0);
                revision = outcome["revision"].clone();
            }
            return Ok(json!({
                "model": model.id,
                "cueCount": cues.len(),
                "inserted": inserted,
                "track": track,
                "revision": revision,
            }));
        }
        // 智能剪口播：识别 → 词级时间 → 口癖/停顿检测 → 剪口落地 → 口播字幕。
        "cut_filler_words" => {
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "asr",
                args.get("modelId").and_then(Value::as_str),
                "语音识别",
            )?;
            // 对齐器是必选：没有它只有估算时间，剪口会偏。
            let aligner = crate::models::by_id("qwen3-aligner-0.6b-q4")
                .ok_or_else(|| "清单里缺少强制对齐器".to_string())?;
            if crate::models::installed_dir(host.as_ref(), aligner).is_none() {
                return Err("剪口播需要强制对齐器：请先下载「Qwen3 强制对齐器」".into());
            }
            let target = media_target(doc, &args).await?;
            let clip_id = target
                .clip_id
                .clone()
                .ok_or_else(|| "剪口播需要 clipId（素材要先放到时间线上：先 append_clip）".to_string())?;
            let transcription = crate::asr::asr_transcribe_words(
                host,
                target.src()?,
                model.id.to_string(),
                None,
            )
            .await?;
            let outcome = crate::doc_ops::call(
                doc,
                "cut_filler",
                json!({
                    "clipId": clip_id,
                    "words": transcription.words,
                    "timed": transcription.timed,
                    "dryRun": args.get("dryRun").and_then(Value::as_bool).unwrap_or(false),
                    "options": {
                        "includeSoft": args.get("includeSoft").and_then(Value::as_bool),
                        "custom": args.get("customWords").cloned().unwrap_or(Value::Null),
                        "disabled": args.get("disabledWords").cloned().unwrap_or(Value::Null),
                        "minPause": args.get("minPause").cloned().unwrap_or(Value::Null),
                        "pauseKeep": args.get("pauseKeep").cloned().unwrap_or(Value::Null),
                        "sentenceKeep": args.get("sentenceKeep").cloned().unwrap_or(Value::Null),
                        "pad": args.get("trimPad").cloned().unwrap_or(Value::Null),
                    },
                }),
            )
            .await?;
            let mut result = outcome["result"].clone();
            if let Some(map) = result.as_object_mut() {
                map.insert("model".into(), json!(model.id));
            }
            return Ok(result);
        }
        // 音源分离：每条 stem 一条轨，源片段静音。
        "separate_stems" => {
            let target = media_target(doc, &args).await?;
            target.require_media()?;
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "separate",
                args.get("modelId").and_then(Value::as_str),
                "音源分离",
            )?;
            let stems = crate::audio_ai::audio_ai_separate(
                host,
                target.src()?,
                target.in_point(),
                target.duration()?,
                model.id.to_string(),
            )
            .await?;
            let mut assets = Vec::with_capacity(stems.len());
            let mut entries = Vec::with_capacity(stems.len());
            for stem in &stems {
                let asset =
                    crate::doc_ops::asset_for(host.as_ref(), &stem.path, None, Some("audio"))
                        .await?;
                entries.push(json!({
                    "name": stem.name,
                    "assetId": asset["id"],
                    "duration": stem.duration,
                }));
                assets.push(asset);
            }
            let outcome = crate::doc_ops::call(
                doc,
                "stem_tracks",
                json!({
                    "assets": assets,
                    "clipId": target.clip_id,
                    "stems": entries,
                }),
            )
            .await?;
            return Ok(json!({
                "model": model.id,
                "stems": outcome["result"]["tracks"],
                "revision": outcome["revision"],
            }));
        }
        // 译制：转写 → 翻译 → 译文字幕轨（dub=true 再生成配音）。
        "translate_audio" => {
            let target = media_target(doc, &args).await?;
            target.require_media()?;
            let target_name = target.display_id();
            let asr_model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "asr",
                args.get("asrModelId").and_then(Value::as_str),
                "语音识别",
            )?;
            crate::doc_ops::require_installed(host.as_ref(), "vad", "语音检测")?;
            let target_lang = args
                .get("target")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "translate_audio 需要 target".to_string())?
                .to_string();
            let cues = crate::asr::asr_transcribe(
                host,
                target.src()?,
                asr_model.id.to_string(),
                None,
            )
            .await?;
            let mapped = map_cues(doc, &target, &cues).await?;
            let mapped_cues = mapped
                .as_array()
                .cloned()
                .ok_or_else(|| "字幕映射失败".to_string())?;
            if mapped_cues.is_empty() {
                return Ok(json!({
                    "cueCount": 0, "translated": 0, "track": Value::Null, "dubbed": 0,
                }));
            }
            let texts: Vec<String> = mapped_cues
                .iter()
                .map(|cue| cue.get("text").and_then(Value::as_str).unwrap_or("").to_string())
                .collect();
            let prompt = translate_prompt(&target_lang);
            let network = crate::doc_ops::network_of(host.as_ref());
            let translated = crate::audio_ai::translate_text(
                &network,
                crate::doc_ops::ai_endpoint(host.as_ref()),
                texts.clone(),
                prompt,
            )
            .await?;
            if translated.len() != mapped_cues.len() {
                return Err(format!(
                    "翻译结果数量不匹配：{} ≠ {}",
                    translated.len(),
                    mapped_cues.len()
                ));
            }
            let mut subtitles = mapped_cues.clone();
            for (index, cue) in subtitles.iter_mut().enumerate() {
                if let Some(map) = cue.as_object_mut() {
                    map.insert("text".into(), json!(translated[index]));
                }
            }
            let outcome = crate::doc_ops::call(
                doc,
                "subtitle_track",
                json!({ "cues": subtitles, "defaultName": "audio.translatedSubtitleTrack" }),
            )
            .await?;
            let track = outcome["result"]["track"].clone();
            let mut dubbed = 0usize;
            if args.get("dub").and_then(Value::as_bool).unwrap_or(false) {
                dubbed =
                    translate_dub(host, doc, &target, &mapped_cues, &translated, &args).await?;
            }
            return Ok(json!({
                "cueCount": cues.len(),
                "translated": translated.len(),
                "track": track,
                "dubbed": dubbed,
                "clip": target_name,
                "revision": outcome["revision"],
            }));
        }
        // 朗读：文字片段 / 一段文字 → 本地或云端 TTS → 朗读轨。
        "synthesize_voiceover" => {
            return synthesize_voiceover(host, doc, &args).await;
        }
        // 超分（视频 / 图片）：结果替换原片段引用。
        "upscale_video" => {
            let target = media_target(doc, &args).await?;
            target.require_visual()?;
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "superres",
                args.get("modelId").and_then(Value::as_str),
                "超分",
            )?;
            let scale = if args.get("scale").and_then(Value::as_u64) == Some(4) {
                4
            } else {
                2
            };
            let result = if target.kind() == "image" {
                crate::video_ai::video_ai_upscale_image(
                    host,
                    target.src()?,
                    model.id.to_string(),
                    scale,
                )
                .await?
            } else {
                crate::video_ai::video_ai_upscale(
                    host,
                    target.src()?,
                    target.in_point(),
                    target.duration()?,
                    target.fps_or(doc).await?,
                    model.id.to_string(),
                    scale,
                )
                .await?
            };
            return replace_video(host, doc, &target, &result.path, result.duration, "videoAi.upscale")
                .await;
        }
        // 补帧：结果替换原片段引用。
        "interpolate_video" => {
            let target = media_target(doc, &args).await?;
            target.require_video()?;
            let model = crate::doc_ops::pick_installed(
                host.as_ref(),
                "interpolate",
                args.get("modelId").and_then(Value::as_str),
                "视频补帧",
            )?;
            let factor = if args.get("factor").and_then(Value::as_u64) == Some(4) {
                4
            } else {
                2
            };
            let result = crate::video_ai::video_ai_interpolate(
                host,
                target.src()?,
                target.in_point(),
                target.duration()?,
                target.fps_or(doc).await?,
                model.id.to_string(),
                factor,
            )
            .await?;
            return replace_video(host, doc, &target, &result.path, result.duration, "videoAi.interpolate")
                .await;
        }
        // 智能裁剪 / 镜头追踪：结果替换原片段引用。
        "reframe_video" => {
            let target = media_target(doc, &args).await?;
            target.require_video()?;
            let subject = args
                .get("subject")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    if args.get("mode").and_then(Value::as_str) == Some("track") {
                        "person".into()
                    } else {
                        "face".into()
                    }
                });
            let aspect = args
                .get("aspect")
                .and_then(Value::as_str)
                .unwrap_or("9:16")
                .to_string();
            let height = args
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(1080.0)
                .round()
                .max(240.0) as u32;
            let smooth = args
                .get("smooth")
                .and_then(Value::as_f64)
                .unwrap_or(0.6) as f32;
            let track_model = if subject == "person" || subject == "auto" {
                Some(
                    crate::doc_ops::pick_installed(host.as_ref(), "track", None, "人物检测")?
                        .id
                        .to_string(),
                )
            } else {
                None
            };
            let face_model = if subject == "face" || subject == "auto" {
                Some(
                    crate::doc_ops::pick_installed(host.as_ref(), "reframe", None, "人脸检测")?
                        .id
                        .to_string(),
                )
            } else {
                None
            };
            let result = crate::video_ai::video_ai_reframe(
                host,
                target.src()?,
                target.in_point(),
                target.duration()?,
                target.fps_or(doc).await?,
                track_model,
                face_model,
                subject.clone(),
                aspect,
                height,
                smooth,
            )
            .await?;
            let label = if args.get("mode").and_then(Value::as_str) == Some("track") {
                "videoAi.track"
            } else {
                "videoAi.crop"
            };
            return replace_video(host, doc, &target, &result.path, result.duration, label).await;
        }

        // ---- 编辑宏：与桌面 `apply_macro` 同一套形状（参数 → 一条命令）----
        "append_clip" => return macro_command(doc, "clip.append", &args).await,
        "set_clip_speed" => return macro_command(doc, "clip.speed", &args).await,
        "duplicate_clips" => return macro_command(doc, "clip.duplicate", &args).await,
        "ripple_delete" => return macro_command(doc, "clip.ripple_delete", &args).await,
        "add_marker" => return macro_command(doc, "marker.add", &args).await,
        "remove_marker" => return macro_command(doc, "marker.remove", &args).await,
        // 调色：扁平参数收进 `patch`，复用 `clip.color` 命令。
        "set_clip_color" => {
            let clip_id = require_arg(&args, "clipId")?;
            let mut patch = serde_json::Map::new();
            for key in [
                "brightness",
                "contrast",
                "saturation",
                "temperature",
                "tint",
            ] {
                if let Some(value) = args.get(key) {
                    patch.insert(key.to_string(), value.clone());
                }
            }
            return apply_domain_command(
                doc,
                json!({ "kind": "clip.color", "payload": { "clipId": clip_id, "patch": patch } }),
                &args,
            )
            .await;
        }
        // 关键帧：整组替换；`remove=true` 时传 null 清空。
        "set_clip_keyframes" => {
            let clip_id = require_arg(&args, "clipId")?;
            let keyframes = if args.get("remove").and_then(Value::as_bool) == Some(true) {
                Value::Null
            } else {
                args.get("keyframes").cloned().unwrap_or_else(|| json!([]))
            };
            return apply_domain_command(
                doc,
                json!({ "kind": "clip.keyframes", "payload": { "clipId": clip_id, "keyframes": keyframes } }),
                &args,
            )
            .await;
        }
        // 转场：扁平参数收进 `transition`；`remove=true` 时传 null。
        "set_clip_transition" => {
            let clip_id = require_arg(&args, "clipId")?;
            let edge = args
                .get("edge")
                .and_then(Value::as_str)
                .filter(|value| *value == "in" || *value == "out")
                .ok_or_else(|| "edge 必须是 in / out".to_string())?;
            let transition = if args.get("remove").and_then(Value::as_bool) == Some(true) {
                Value::Null
            } else {
                let mut transition = serde_json::Map::new();
                for key in ["type", "duration", "direction"] {
                    if let Some(value) = args.get(key) {
                        transition.insert(key.to_string(), value.clone());
                    }
                }
                Value::Object(transition)
            };
            return apply_domain_command(
                doc,
                json!({
                    "kind": "clip.transition",
                    "payload": { "clipId": clip_id, "edge": edge, "transition": transition },
                }),
                &args,
            )
            .await;
        }
        // 标记更新：扁平参数收进 `patch`。
        "update_marker" => {
            let marker_id = require_arg(&args, "markerId")?;
            let mut patch = serde_json::Map::new();
            for key in [
                "time",
                "name",
                "color",
                "kind",
                "sceneId",
                "note",
                "severity",
                "resolved",
                "bbox",
                "screenshot",
                "tags",
            ] {
                if let Some(value) = args.get(key) {
                    patch.insert(key.to_string(), value.clone());
                }
            }
            return apply_domain_command(
                doc,
                json!({ "kind": "marker.update", "payload": { "markerId": marker_id, "patch": patch } }),
                &args,
            )
            .await;
        }
        // 导入素材：探测元数据 → 登记到素材库（与桌面 `importAssetAt` 同一套字段）。
        "import_asset" => {
            let path = require_arg(&args, "path")?;
            let name = args
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            let asset = crate::doc_ops::asset_for(host.as_ref(), &path, name, None).await?;
            let asset_id = asset["id"].clone();
            crate::doc_ops::call(doc, "add_assets", json!({ "assets": [asset] })).await?;
            return Ok(json!({ "assetId": asset_id, "path": path }));
        }

        // ---- 撤销 / 重做：引擎侧快照栈（`AICUT.undo/redo`）----
        "undo" => {
            let text = doc.undo().await?;
            return Ok(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null));
        }
        "redo" => {
            let text = doc.redo().await?;
            return Ok(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null));
        }
        // ---- 工程生命周期：不弹任何对话框，直接读写 JSON ----
        "new_project" => {
            let outcome = crate::doc_ops::call(
                doc,
                "new_project",
                json!({
                    "name": args.get("name").cloned().unwrap_or(Value::Null),
                    "width": args.get("width").cloned().unwrap_or(Value::Null),
                    "height": args.get("height").cloned().unwrap_or(Value::Null),
                    "fps": args.get("fps").cloned().unwrap_or(Value::Null),
                }),
            )
            .await?;
            set_current_project_path(None);
            let mut result = outcome["result"].clone();
            if let Some(map) = result.as_object_mut() {
                map.insert("revision".into(), outcome["revision"].clone());
            }
            return Ok(result);
        }
        "open_project" => {
            let path = require_arg(&args, "path")?;
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("读取工程失败：{error}"))?;
            let loaded = doc.load(text.clone()).await?;
            let value: Value = serde_json::from_str(&loaded).unwrap_or(Value::Null);
            if value.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err(value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("工程文件无法载入")
                    .to_string());
            }
            set_current_project_path(Some(path.clone()));
            let overview = crate::agent_bridge::call(doc, "project.context", json!({})).await?;
            return Ok(json!({ "path": path, "project": overview }));
        }
        "save_project" => {
            let explicit = args
                .get("path")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            let path = match explicit {
                Some(value) => value,
                None => current_project_path().ok_or_else(|| {
                    "工程尚未保存过：请提供 path（无头版没有「另存为」对话框）".to_string()
                })?,
            };
            let text = doc.snapshot().await?;
            if let Some(parent) = std::path::Path::new(&path).parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| format!("创建目录失败：{error}"))?;
                }
            }
            std::fs::write(&path, text.as_bytes())
                .map_err(|error| format!("写入工程失败：{error}"))?;
            set_current_project_path(Some(path.clone()));
            let revision = doc.revision().await?;
            return Ok(json!({ "saved": true, "path": path, "revision": revision }));
        }
        // ---- 能力域文档（与桌面 `skills/aicut` 同一份）----
        "aicut_help" => {
            let topic = args
                .get("topic")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            return Ok(Value::String(help(&topic)));
        }
        // ---- 取消所有同步 AI 任务 ----
        "cancel_ai" => {
            cancel_all_ai();
            return Ok(json!({ "cancelled": true }));
        }
        // ---- 模型下载（等到装完；需要 gated 授权时返回 auth 给客户端处理）----
        "download_model" => {
            let id = require_arg(&args, "id")?;
            let network = crate::doc_ops::network_of(host.as_ref());
            let auth = crate::models::model_download(host.as_ref(), &network, id.clone()).await?;
            let installed = crate::models::by_id(&id)
                .and_then(|entry| crate::models::installed_dir(host.as_ref(), entry))
                .is_some();
            return Ok(json!({
                "id": id,
                "installed": installed,
                "auth": auth,
            }));
        }
        // ---- 拆音轨：视频片段静音，声音落到下面一条音轨 ----
        "extract_audio" => {
            let clip_id = require_arg(&args, "clipId")?;
            let outcome = crate::doc_ops::call(
                doc,
                "extract_audio",
                json!({
                    "clipId": clip_id,
                    "baseName": args.get("trackName").and_then(Value::as_str).unwrap_or(""),
                }),
            )
            .await?;
            return Ok(outcome["result"].clone());
        }
        // ---- 字幕导入 / 导出（解析与序列化都在领域层）----
        "import_subtitles" => {
            let path = require_arg(&args, "path")?;
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("读取字幕文件失败：{error}"))?;
            let outcome = crate::doc_ops::call(
                doc,
                "place_subtitles",
                json!({
                    "text": text,
                    "path": path,
                    "baseName": args.get("trackName").and_then(Value::as_str).unwrap_or(""),
                    "offset": args.get("offset").and_then(Value::as_f64).unwrap_or(0.0),
                }),
            )
            .await?;
            let mut result = outcome["result"].clone();
            if let Some(map) = result.as_object_mut() {
                map.insert("revision".into(), outcome["revision"].clone());
            }
            return Ok(result);
        }
        "export_subtitles" => {
            let output_path = require_arg(&args, "outputPath")?;
            let format = args
                .get("format")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    if output_path.to_ascii_lowercase().ends_with(".vtt") {
                        "vtt".to_string()
                    } else {
                        "srt".to_string()
                    }
                });
            let outcome = crate::doc_ops::call(
                doc,
                "serialize_subtitles",
                json!({
                    "trackId": args.get("trackId").cloned().unwrap_or(Value::Null),
                    "format": format,
                }),
            )
            .await?;
            let text = outcome["result"]["text"].as_str().unwrap_or("").to_string();
            if let Some(parent) = std::path::Path::new(&output_path).parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| format!("创建目录失败：{error}"))?;
                }
            }
            std::fs::write(&output_path, text.as_bytes())
                .map_err(|error| format!("写入字幕文件失败：{error}"))?;
            return Ok(json!({
                "path": output_path,
                "format": format,
                "count": outcome["result"]["count"],
            }));
        }

        // ------------------------------------------------------------------
        // 导出 / 渲染：滤镜图在领域层编译（与导出按钮同一份），这里只执行
        // ------------------------------------------------------------------

        // 整段导出时间线。
        "export_video" => return export_timeline(doc, host, &args, None).await,
        // 导出区间。
        "render_range" => {
            let start = args.get("start").and_then(Value::as_f64).unwrap_or(-1.0);
            let end = args.get("end").and_then(Value::as_f64).unwrap_or(-1.0);
            if !(start >= 0.0) || !(end > start) {
                return Err("render_range 需要 start 与大于它的 end".into());
            }
            return export_timeline(doc, host, &args, Some((start, end))).await;
        }
        // 静帧：同一份计划，输出参数换成单帧 PNG。
        "render_frame" => {
            let time = args
                .get("time")
                .and_then(Value::as_f64)
                .ok_or_else(|| "render_frame 需要 time".to_string())?;
            let output_path = require_arg(&args, "outputPath")?;
            let plan = compile_export(doc, &args, &output_path, Some(time)).await?;
            let state = crate::export::shared()
                .ok_or_else(|| "导出状态未初始化：请通过 daemon / 桌面壳启动".to_string())?;
            let job = export_job(&plan)?;
            crate::export::export_video(host.as_ref(), state.as_ref(), job).await?;
            return Ok(json!({
                "path": output_path,
                "time": time,
                "width": plan["width"],
                "height": plan["height"],
                "warnings": plan["warnings"],
                "revision": doc.revision().await?,
            }));
        }
        // 导出运行态。
        "render_status" => match crate::export::shared() {
            Some(state) => return Ok(serde_json::to_value(state.status()).unwrap_or(Value::Null)),
            None => return Ok(json!({ "busy": false, "seconds": 0.0, "fraction": 0.0 })),
        },

        // ---- 审片批注：就是带 note/severity 的标记 ----
        "add_review_note" => {
            let time = args
                .get("time")
                .and_then(Value::as_f64)
                .ok_or_else(|| "需要 time（秒）".to_string())?;
            if time < 0.0 {
                return Err("time 不能为负".into());
            }
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "需要非空 text".to_string())?
                .to_string();
            let severity = args.get("severity").and_then(Value::as_str);
            let title = truncate_text(&text, 40);
            let name = match severity {
                Some(level) => format!("[{level}] {title}"),
                None => title,
            };
            // 标记 id 由调用方给（领域层的 affected 只有 clip/track/asset 三类 id）。
            let marker_id = uuid::Uuid::new_v4().to_string();
            let mut payload = json!({
                "id": marker_id,
                "time": time,
                "name": name,
                "kind": "review",
                "note": text,
            });
            for key in ["severity", "sceneId", "bbox", "screenshot", "tags", "color"] {
                if let Some(value) = args.get(key) {
                    payload[key] = value.clone();
                }
            }
            if args.get("resolved").and_then(Value::as_bool) == Some(true) {
                payload["resolved"] = json!(true);
            }
            let result = apply_domain_command(
                doc,
                json!({ "kind": "marker.add", "payload": payload }),
                &args,
            )
            .await?;
            return Ok(json!({ "markerId": marker_id, "revision": result["revision"] }));
        }
        "list_review_notes" => {
            let mut payload = args.clone();
            if let Some(map) = payload.as_object_mut() {
                map.insert("noteOnly".into(), json!(true));
            }
            return crate::agent_bridge::call(doc, "project.markers", payload).await;
        }
        "update_review_note" => {
            let marker_id = require_arg(&args, "markerId")?;
            let mut patch = serde_json::Map::new();
            if let Some(value) = args.get("text") {
                patch.insert("note".into(), value.clone());
            }
            for key in ["severity", "resolved", "bbox", "screenshot", "tags", "time"] {
                if let Some(value) = args.get(key) {
                    patch.insert(key.to_string(), value.clone());
                }
            }
            if patch.is_empty() {
                return Err("没有要修改的字段".into());
            }
            return apply_domain_command(
                doc,
                json!({
                    "kind": "marker.update",
                    "payload": { "markerId": marker_id, "patch": Value::Object(patch) },
                }),
                &args,
            )
            .await;
        }
        "remove_review_note" => {
            let marker_id = require_arg(&args, "markerId")?;
            return apply_domain_command(
                doc,
                json!({ "kind": "marker.remove", "payload": { "markerId": marker_id } }),
                &args,
            )
            .await;
        }
        // ---- 影片结构（film.json）：解析 / 生成命令 / 重建都在领域层 ----
        "import_film_manifest" => {
            let path = require_arg(&args, "path")?;
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("读取 film.json 失败：{error}"))?;
            let base_dir = std::path::Path::new(&path)
                .parent()
                .map(|parent| parent.to_string_lossy().into_owned())
                .unwrap_or_else(|| ".".to_string());
            let resolved = resolve_manifest_assets(&text, &base_dir);
            let outcome = crate::doc_ops::call(
                doc,
                "film_import",
                json!({
                    "path": path,
                    "text": text,
                    "mode": args.get("mode").cloned().unwrap_or_else(|| json!("replace")),
                    "trackName": args.get("trackName").cloned().unwrap_or(Value::Null),
                    "assets": resolved,
                    "conform": args.get("conform").cloned().unwrap_or(Value::Null),
                }),
            )
            .await?;
            let mut result = outcome["result"].clone();
            if let Some(map) = result.as_object_mut() {
                map.insert("revision".into(), outcome["revision"].clone());
            }
            return Ok(result);
        }
        "export_film_manifest" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            let base_dir = path
                .as_deref()
                .and_then(|value| std::path::Path::new(value).parent())
                .map(|parent| parent.to_string_lossy().into_owned())
                .unwrap_or_else(|| ".".to_string());
            let previous = path
                .as_deref()
                .and_then(|value| std::fs::read_to_string(value).ok())
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .filter(|value| value.is_object());
            let outcome = crate::doc_ops::call(
                doc,
                "film_export",
                json!({ "baseDir": base_dir, "previous": previous }),
            )
            .await?;
            let manifest = outcome["result"]["manifest"].clone();
            if let Some(path) = path.as_deref() {
                let text = serde_json::to_string_pretty(&manifest)
                    .map_err(|error| format!("序列化 film.json 失败：{error}"))?;
                if let Some(parent) = std::path::Path::new(path).parent() {
                    if !parent.as_os_str().is_empty() {
                        std::fs::create_dir_all(parent)
                            .map_err(|error| format!("创建目录失败：{error}"))?;
                    }
                }
                std::fs::write(path, text.as_bytes())
                    .map_err(|error| format!("写入 film.json 失败：{error}"))?;
            }
            return Ok(json!({
                "path": path,
                "manifest": manifest,
                "revision": outcome["revision"],
            }));
        }

        // ---- 后台任务：把任意工具放到后台跑，前端/MCP 轮询状态 ----
        "job_start" => {
            let kind = args
                .get("kind")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "job_start 需要 kind（工具名）".to_string())?
                .to_string();
            let params = args.get("params").cloned().unwrap_or_else(|| json!({}));
            let job_id = job_start(doc.clone(), host.clone(), video_dsp.clone(), kind, params);
            return Ok(json!({ "jobId": job_id }));
        }
        "job_status" => {
            let job_id = require_arg(&args, "jobId")?;
            let status = job_status(&job_id).ok_or_else(|| format!("AI 任务不存在：{job_id}"))?;
            return Ok(json!({
                "status": status.status,
                "progress": if status.status == "running" { 0.0 } else { 1.0 },
                "message": status.error,
                "result": status.result,
                "error": status.error,
            }));
        }
        "job_cancel" => {
            let job_id = args
                .get("jobId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let cancelled = match job_id.as_deref() {
                Some(id) => job_cancel(id),
                None => job_cancel_active(),
            };
            return Ok(json!({ "cancelled": cancelled, "jobId": job_id }));
        }

        // ---- 故事板：按时间点连续渲染 PNG（每帧都走同一套导出滤镜）----
        "render_storyboard" => {
            let times: Vec<f64> = args
                .get("times")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default();
            if times.is_empty() {
                return Err("render_storyboard 需要 times（时间点数组）".into());
            }
            let output_dir = require_arg(&args, "outputDir")?;
            std::fs::create_dir_all(&output_dir)
                .map_err(|error| format!("创建输出目录失败：{error}"))?;
            let prefix = args
                .get("prefix")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("frame")
                .to_string();
            let mut frames = Vec::with_capacity(times.len());
            for (index, time) in times.iter().enumerate() {
                let output_path = std::path::Path::new(&output_dir)
                    .join(format!("{prefix}-{:03}.png", index + 1))
                    .to_string_lossy()
                    .into_owned();
                let mut frame_args = args.clone();
                frame_args["time"] = json!(time);
                frame_args["outputPath"] = json!(output_path);
                let plan = compile_export(doc, &frame_args, &output_path, Some(*time)).await?;
                run_export_job(host, &plan).await?;
                frames.push(json!({
                    "time": time,
                    "path": output_path,
                    "width": plan["width"],
                    "height": plan["height"],
                }));
            }
            return Ok(json!({ "frames": frames }));
        }
        // ---- 接触表：渲染若干帧 → xstack 拼成一张 PNG + 图例 JSON ----
        "render_contact_sheet" => {
            let output_path = require_arg(&args, "outputPath")?;
            let mut frames: Vec<String> = args
                .get("frames")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let times: Vec<f64> = args
                .get("times")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default();
            if frames.is_empty() {
                if times.is_empty() {
                    return Err("render_contact_sheet 需要 frames 或 times".into());
                }
                let frame_dir = std::path::Path::new(&output_path)
                    .parent()
                    .map(|parent| parent.to_path_buf())
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join(format!(
                        "frames-{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|span| span.as_millis())
                            .unwrap_or(0)
                    ));
                std::fs::create_dir_all(&frame_dir)
                    .map_err(|error| format!("创建帧目录失败：{error}"))?;
                for (index, time) in times.iter().enumerate() {
                    let path = frame_dir
                        .join(format!("cell-{:03}.png", index + 1))
                        .to_string_lossy()
                        .into_owned();
                    let mut frame_args = args.clone();
                    frame_args["time"] = json!(time);
                    frame_args["outputPath"] = json!(path);
                    let plan = compile_export(doc, &frame_args, &path, Some(*time)).await?;
                    run_export_job(host, &plan).await?;
                    frames.push(path);
                }
            }
            let count = frames.len();
            let layout = crate::doc_ops::call(
                doc,
                "contact_layout",
                json!({
                    "count": count,
                    "cols": args.get("cols").cloned().unwrap_or(Value::Null),
                    "cellWidth": args.get("cellWidth").cloned().unwrap_or(Value::Null),
                }),
            )
            .await?;
            let layout = layout["result"].clone();
            let cell_width = layout["cellWidth"].as_u64().unwrap_or(480);
            let cell_height = layout["cellHeight"].as_u64().unwrap_or(270);
            let cols = layout["cols"].as_u64().unwrap_or(1);
            let rows = layout["rows"].as_u64().unwrap_or(1);
            let total = layout["total"].as_u64().unwrap_or(count as u64) as usize;
            let mut padded = frames.clone();
            while padded.len() < total {
                padded.push(frames[frames.len() - 1].clone());
            }
            let layout_text = layout["layout"].as_str().unwrap_or("").to_string();
            let mut inputs: Vec<String> = Vec::new();
            let mut filters: Vec<String> = Vec::new();
            for index in 0..padded.len() {
                inputs.push("-i".into());
                inputs.push(padded[index].clone());
                filters.push(format!(
                    "[{index}:v]scale={cell_width}:{cell_height}:force_original_aspect_ratio=decrease,pad={cell_width}:{cell_height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[c{index}]"
                ));
            }
            let labels: String = (0..padded.len()).map(|index| format!("[c{index}]")).collect();
            filters.push(format!(
                "{labels}xstack=inputs={}:layout={layout_text}:fill=black[out]",
                padded.len()
            ));
            let job = crate::export::ExportJob {
                inputs,
                filter_graph: filters.join(";"),
                output_args: vec![
                    "-map".into(),
                    "[out]".into(),
                    "-frames:v".into(),
                    "1".into(),
                    output_path.clone(),
                ],
                duration: 1.0 / 30.0,
            };
            run_export_job_direct(host, job).await?;

            let cells: Vec<Value> = frames
                .iter()
                .enumerate()
                .map(|(index, path)| {
                    let mut cell = json!({ "index": index, "framePath": path });
                    if let Some(time) = times.get(index) {
                        cell["time"] = json!(time);
                    }
                    cell
                })
                .collect();
            let legend = json!({
                "path": output_path,
                "cols": cols,
                "rows": rows,
                "cellWidth": cell_width,
                "cellHeight": cell_height,
                "cells": cells,
            });
            let legend_path = format!("{output_path}.json");
            std::fs::write(
                &legend_path,
                serde_json::to_string_pretty(&legend).unwrap_or_default(),
            )
            .map_err(|error| format!("写入图例失败：{error}"))?;
            return Ok(json!({
                "path": output_path,
                "width": cols * cell_width,
                "height": rows * cell_height,
                "cols": cols,
                "rows": rows,
                "cells": cells,
                "legendPath": legend_path,
            }));
        }
        // ---- 对比两版导出：SSIM 逐帧分数 + 低于阈值的变化点 + 并排帧 ----
        "compare_takes" => return compare_takes(doc, host, &args).await,

        // ---- 逐场渲染：串行跑每个场景区间（无头版不复用桌面缓存，结果一致）----
        "render_manifest" => {
            let mut scenes: Vec<Value> = args
                .get("scenes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if scenes.is_empty() {
                let path = require_arg(&args, "manifestPath")?;
                let text = std::fs::read_to_string(&path)
                    .map_err(|error| format!("读取 film.json 失败：{error}"))?;
                let outcome = crate::doc_ops::call(
                    doc,
                    "manifest_scenes",
                    json!({ "path": path, "text": text }),
                )
                .await?;
                scenes = outcome["result"]["scenes"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
            }
            if scenes.is_empty() {
                return Err("render_manifest 需要 scenes 或 manifestPath（且至少有一场）".into());
            }
            let output_dir = args
                .get("outputDir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if let Some(dir) = &output_dir {
                std::fs::create_dir_all(dir)
                    .map_err(|error| format!("创建输出目录失败：{error}"))?;
            }
            let started = std::time::Instant::now();
            let mut segments = Vec::new();
            let mut errors = Vec::new();
            let mut rendered = 0u64;
            for (index, scene) in scenes.iter().enumerate() {
                let start = num(scene, "start");
                let end = num(scene, "end");
                if !(end > start) {
                    errors.push(json!({
                        "id": scene.get("id").cloned().unwrap_or(Value::Null),
                        "error": "场景区间为空",
                    }));
                    continue;
                }
                let name = scene
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("scene-{}", index + 1));
                let mut scene_args = args.clone();
                scene_args["start"] = json!(start);
                scene_args["end"] = json!(end);
                if let Some(dir) = &output_dir {
                    scene_args["outputPath"] = json!(std::path::Path::new(dir)
                        .join(format!("{name}.mp4"))
                        .to_string_lossy());
                }
                match export_timeline(doc, host, &scene_args, Some((start, end))).await {
                    Ok(result) => {
                        rendered += 1;
                        segments.push(json!({
                            "id": scene.get("id").cloned().unwrap_or(Value::Null),
                            "path": result["path"],
                            "start": start,
                            "end": end,
                            "duration": result["duration"],
                            "cached": false,
                        }));
                    }
                    Err(error) => errors.push(json!({
                        "id": scene.get("id").cloned().unwrap_or(Value::Null),
                        "error": error,
                    })),
                }
            }
            return Ok(json!({
                "total": scenes.len(),
                "rendered": rendered,
                "cached": 0,
                "failed": errors.len(),
                "segments": segments,
                "errors": errors,
                "elapsedMs": started.elapsed().as_millis() as u64,
            }));
        }

        other => {
            return Err(format!(
                "工具 {other} 还没有在浏览器/容器版本实现（见 docs/docker-desktop-parity.md §12）"
            ))
        }
    };
    agent_bridge::call(doc, method, payload).await
}




// ---------------------------------------------------------------------------
// 画布 / 工作流（读工程快照 + 工作流库）
// ---------------------------------------------------------------------------

/// 无头版没有渲染进程：画布写入与工作流运行明确报错，并指出去哪执行。
fn desktop_only(tool: &str) -> String {
    format!(
        "工具 {tool} 还没有在浏览器/容器版本实现：画布写入与工作流运行需要桌面版的渲染进程（Tauri 窗口里的画布 store 与运行器，见 docs/docker-desktop-parity.md §12）"
    )
}

/// 当前工程快照（画布读工具的数据源）。
///
/// 快照由领域层 `serializeProject` 写出：`boards` / `activeBoardId` 是真相，
/// `board` 只是活动画布的访问器，不会出现在 JSON 里。
async fn project_snapshot(doc: &DocHandle) -> Result<Value, String> {
    let text = doc
        .snapshot()
        .await
        .map_err(|error| format!("读取工程快照失败，无法读取画布：{error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("工程快照不是合法 JSON：{error}"))
}

fn boards_of(snapshot: &Value) -> &[Value] {
    snapshot
        .get("boards")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// 活动画布 id；`activeBoardId` 失效时回落到第一张（与 `projectBoards.activeCanvas` 一致）。
fn active_canvas_id(snapshot: &Value) -> String {
    let boards = boards_of(snapshot);
    let declared = snapshot
        .get("activeBoardId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if boards
        .iter()
        .any(|canvas| canvas.get("id").and_then(Value::as_str) == Some(declared))
    {
        return declared.to_string();
    }
    boards
        .first()
        .and_then(|canvas| canvas.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// 开始节点发布的输入 / 结束节点收集的输出（`data.signature`）。
///
/// 只读快照里的签名行，不复制前端的校验（`publishable` / `problems` 依赖节点
/// 定义与类型注册表，留在桌面版回答）。
fn signature_ports(nodes: &[Value], node_type: &str, field: &str) -> Vec<Value> {
    nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some(node_type))
        .and_then(|node| node.get("data"))
        .and_then(|data| data.get("signature"))
        .and_then(|signature| signature.get(field))
        .and_then(Value::as_array)
        .map(|decls| {
            decls
                .iter()
                .map(|decl| {
                    let name = decl
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| decl.get("label").and_then(Value::as_str))
                        .or_else(|| decl.get("id").and_then(Value::as_str))
                        .unwrap_or("");
                    json!({
                        "name": name,
                        "type": decl.get("type").and_then(Value::as_str).unwrap_or("any"),
                    })
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default()
}

/// 一张画布的摘要（字段与桌面 `canvasApi.canvasList` 同名；少 `publishable` / `problems`）。
fn canvas_summary(canvas: &Value, active_id: &str) -> Value {
    let id = canvas.get("id").and_then(Value::as_str).unwrap_or("");
    let doc = canvas.get("doc").cloned().unwrap_or(Value::Null);
    let nodes = doc
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let edges = doc
        .get("edges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
        "id": id,
        "title": canvas.get("title").and_then(Value::as_str).unwrap_or(""),
        "active": id == active_id,
        "nodeCount": nodes.len(),
        "edgeCount": edges.len(),
        "source": doc.get("source").and_then(|source| source.get("name")),
        "inputs": signature_ports(&nodes, "workflow.start", "inputs"),
        "outputs": signature_ports(&nodes, "workflow.end", "outputs"),
    })
}

/// `board.list` 的无头实现：从工程快照汇总画布列表。
async fn board_list_canvases(doc: &DocHandle) -> Result<Value, String> {
    let snapshot = project_snapshot(doc).await?;
    let active = active_canvas_id(&snapshot);
    let canvases: Vec<Value> = boards_of(&snapshot)
        .iter()
        .map(|canvas| canvas_summary(canvas, &active))
        .collect();
    Ok(json!({ "activeId": active, "canvases": canvases }))
}

/// `board.get` 的无头实现：从工程快照取一张画布的节点与连线。
async fn board_get_canvas(doc: &DocHandle, args: &Value) -> Result<Value, String> {
    let snapshot = project_snapshot(doc).await?;
    let active = active_canvas_id(&snapshot);
    let requested = args
        .get("canvasId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let id = requested.unwrap_or(active.as_str());
    let canvas = boards_of(&snapshot)
        .iter()
        .find(|canvas| canvas.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| format!("画布不存在：{id}"))?;
    let canvas_doc = canvas.get("doc").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "canvas": canvas_summary(canvas, &active),
        "nodes": canvas_doc.get("nodes").cloned().unwrap_or_else(|| json!([])),
        "edges": canvas_doc.get("edges").cloned().unwrap_or_else(|| json!([])),
    }))
}

/// `workflow.list` 的无头实现：只列发布过的卡片（标签 `api` / `subworkflow`），
/// 每张卡片取最新版本，签名从快照里的开始 / 结束节点读出。
fn workflow_list(host: &dyn Host) -> Value {
    let mut latest: std::collections::HashMap<String, crate::workflow::WorkflowVersion> =
        std::collections::HashMap::new();
    for entry in crate::workflow::list(host.data_dir()) {
        if !entry
            .tags
            .iter()
            .any(|tag| tag == "api" || tag == "subworkflow")
        {
            continue;
        }
        let newer = latest
            .get(&entry.root_id)
            .map(|known| entry.version > known.version)
            .unwrap_or(true);
        if newer {
            latest.insert(entry.root_id.clone(), entry);
        }
    }
    let mut entries: Vec<_> = latest.into_values().collect();
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let rows: Vec<Value> = entries
        .into_iter()
        .map(|entry| {
            // 快照读不出来时仍列出条目（名字 / 标签可发现），签名留空。
            let (inputs, outputs) = match crate::workflow::get(host.data_dir(), entry.id.clone()) {
                Ok(snapshot) => {
                    let nodes = snapshot.nodes.as_array().cloned().unwrap_or_default();
                    (
                        signature_ports(&nodes, "workflow.start", "inputs"),
                        signature_ports(&nodes, "workflow.end", "outputs"),
                    )
                }
                Err(_) => (Vec::new(), Vec::new()),
            };
            json!({
                "rootId": entry.root_id,
                "name": entry.name,
                "version": entry.version,
                "tags": entry.tags,
                "inputs": inputs,
                "outputs": outputs,
            })
        })
        .collect();
    Value::Array(rows)
}

/// 截断显示文本（保留前 `limit` 个字符，超出加省略号）。
fn truncate_text(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    let head: String = text.chars().take(limit).collect();
    format!("{head}…")
}

/// 把 film.json 里的相对素材路径解析成绝对路径（相对 manifest 所在目录）。
///
/// 与桌面 `manifestSidePath` 同规则：绝对路径原样保留，`..` 参与归一化。
fn resolve_manifest_assets(text: &str, base_dir: &str) -> Value {
    let Ok(raw) = serde_json::from_str::<Value>(text) else {
        return json!([]);
    };
    let mut out = Vec::new();
    for section in ["scenes", "assets", "clips"] {
        let Some(items) = raw.get(section).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let Some(path) = item
                .get("path")
                .or_else(|| item.get("src"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let resolved = if std::path::Path::new(path).is_absolute() {
                std::path::PathBuf::from(path)
            } else {
                std::path::Path::new(base_dir).join(path)
            };
            out.push(json!({
                "path": resolved.to_string_lossy(),
                "name": item.get("name").and_then(Value::as_str),
                "kind": item.get("kind").and_then(Value::as_str),
            }));
        }
    }
    Value::Array(out)
}


// ---------------------------------------------------------------------------
// 后台任务（job_*）
// ---------------------------------------------------------------------------

/// 一个后台任务的运行态。
struct JobEntry {
    kind: String,
    status: &'static str,
    result: Option<Value>,
    error: Option<String>,
    cancel: Option<tokio_util::sync::CancellationToken>,
}

fn jobs_slot() -> &'static std::sync::Mutex<std::collections::HashMap<String, JobEntry>> {
    static SLOT: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, JobEntry>>> =
        std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 最近一个还在跑的任务（`job_cancel` 省略 jobId 时用）。
fn active_job_slot() -> &'static std::sync::Mutex<Option<String>> {
    static SLOT: std::sync::OnceLock<std::sync::Mutex<Option<String>>> = std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(None))
}

/// 后台任务状态快照。
struct JobStatus {
    status: &'static str,
    result: Value,
    error: Option<String>,
}

/// 把一次工具调用放到后台跑。
///
/// 无头版没有"前端 AI 任务队列"，但语义要一致：`job_start` 立刻返回 id，
/// 调用方用 `job_status` 轮询、`job_cancel` 取消。任务本身仍然是同一个
/// `dispatch`（所以工具行为与同步调用完全一致）。
fn job_start(
    doc: DocHandle,
    host: std::sync::Arc<dyn Host>,
    video_dsp: std::sync::Arc<crate::video_dsp::VideoDspState>,
    kind: String,
    params: Value,
) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let token = tokio_util::sync::CancellationToken::new();
    {
        if let Ok(mut jobs) = jobs_slot().lock() {
            jobs.insert(
                id.clone(),
                JobEntry {
                    kind: kind.clone(),
                    status: "running",
                    result: None,
                    error: None,
                    cancel: Some(token.clone()),
                },
            );
        }
        if let Ok(mut active) = active_job_slot().lock() {
            *active = Some(id.clone());
        }
    }

    let task_id = id.clone();
    tokio::spawn(async move {
        let outcome = Box::pin(dispatch(
            &doc,
            &host,
            &video_dsp,
            &kind,
            params,
            Some(&token),
        ))
        .await;
        if let Ok(mut jobs) = jobs_slot().lock() {
            if let Some(entry) = jobs.get_mut(&task_id) {
                entry.cancel = None;
                match outcome {
                    Ok(value) => {
                        entry.status = "done";
                        entry.result = Some(value);
                    }
                    Err(error) => {
                        entry.status = "error";
                        entry.error = Some(error);
                    }
                }
            }
        }
        if let Ok(mut active) = active_job_slot().lock() {
            if active.as_deref() == Some(task_id.as_str()) {
                *active = None;
            }
        }
    });

    id
}

fn job_status(id: &str) -> Option<JobStatus> {
    let jobs = jobs_slot().lock().ok()?;
    let entry = jobs.get(id)?;
    Some(JobStatus {
        status: entry.status,
        result: entry.result.clone().unwrap_or(Value::Null),
        error: entry.error.clone(),
    })
}

/// 取消指定任务：置取消令牌，并顺手停掉所有同步 AI 任务（模型推理不轮询令牌）。
fn job_cancel(id: &str) -> bool {
    let cancel = jobs_slot()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(id).and_then(|entry| entry.cancel.clone()));
    match cancel {
        Some(token) => {
            token.cancel();
            cancel_all_ai();
            true
        }
        None => false,
    }
}

/// 取消最近一个还在跑的任务。
fn job_cancel_active() -> bool {
    let id = active_job_slot().lock().ok().and_then(|active| active.clone());
    match id {
        Some(id) => job_cancel(&id),
        None => false,
    }
}

/// 停掉所有同步 AI 任务（与 `cancel_ai` 同一个实现）。
fn cancel_all_ai() {
    crate::asr::asr_cancel();
    crate::tts::tts_cancel();
    crate::audio_ai::audio_ai_cancel();
    crate::video_ai::video_ai_cancel();
    crate::voice_change::voice_change_cancel();
    crate::models::model_cancel();
}


/// 偶数化（ffmpeg 要求偶数宽高）。
fn even_of(value: u32, fallback: u32) -> u32 {
    let value = if value == 0 { fallback } else { value };
    if value % 2 == 0 {
        value
    } else {
        value + 1
    }
}

/// 跑一次导出作业（用进程级导出状态，保证"同时只有一个导出"）。
async fn run_export_job(host: &std::sync::Arc<dyn Host>, plan: &Value) -> Result<(), String> {
    run_export_job_direct(host, export_job(plan)?).await
}

async fn run_export_job_direct(
    host: &std::sync::Arc<dyn Host>,
    job: crate::export::ExportJob,
) -> Result<(), String> {
    let state = crate::export::shared()
        .ok_or_else(|| "导出状态未初始化：请通过 daemon / 桌面壳启动".to_string())?;
    crate::export::export_video(host.as_ref(), state.as_ref(), job).await
}

/// ffmpeg 滤镜里的路径转义（与 `core/render/compare.ts` 的 `escapeFilterPath` 一致）。
fn escape_filter_path(path: &str) -> String {
    path.replace('\\', "/").replace('\'', "\\'")
}

/// 两版导出对比：SSIM 逐帧分数 + 变化点 + 并排关键帧。
async fn compare_takes(
    doc: &DocHandle,
    host: &std::sync::Arc<dyn Host>,
    args: &Value,
) -> Result<Value, String> {
    let a = require_arg(args, "a")?;
    let b = require_arg(args, "b")?;
    let probe_a = crate::media::probe_media(host.as_ref(), a.clone()).await?;
    let probe_b = crate::media::probe_media(host.as_ref(), b.clone()).await?;
    if !(probe_a.duration > 0.0) || !(probe_b.duration > 0.0) {
        return Err("对比失败：无法读取视频时长".into());
    }
    let range = args
        .get("range")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .as_object()
        .cloned()
        .unwrap_or_default();
    let start = range
        .get("start")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let shorter = probe_a.duration.min(probe_b.duration);
    let end = range
        .get("end")
        .and_then(Value::as_f64)
        .unwrap_or(shorter)
        .min(shorter);
    if !(end > start) {
        return Err("对比区间为空".into());
    }
    let fps = args
        .get("fps")
        .and_then(Value::as_f64)
        .unwrap_or(30.0)
        .round()
        .max(1.0);
    let width = even_of(
        probe_a.width.unwrap_or(1280).min(probe_b.width.unwrap_or(1280)),
        1280,
    );
    let height = even_of(
        probe_a.height.unwrap_or(720).min(probe_b.height.unwrap_or(720)),
        720,
    );
    let duration = end - start;
    let mut warnings: Vec<String> = Vec::new();
    if (probe_a.duration - probe_b.duration).abs() > 0.05 {
        warnings.push(format!(
            "两版时长不同（{:.2}s vs {:.2}s），只比较交集",
            probe_a.duration, probe_b.duration
        ));
    }

    let cache = crate::media::media_cache_dir(host.as_ref())?;
    std::fs::create_dir_all(&cache).map_err(|error| format!("创建缓存目录失败：{error}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|span| span.as_millis())
        .unwrap_or(0);
    let stats_path = std::path::Path::new(&cache).join(format!("ssim-{stamp}.log"));

    let fit = |label: &str| {
        format!(
            "[{label}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps}"
        )
    };
    let graph = format!(
        "{}[a];{}[b];[a][b]ssim=stats_file='{}'[s]",
        fit("0"),
        fit("1"),
        escape_filter_path(&stats_path.to_string_lossy())
    );
    let ssim_job = crate::export::ExportJob {
        inputs: vec![
            "-ss".into(),
            format!("{start}"),
            "-t".into(),
            format!("{duration}"),
            "-i".into(),
            a.clone(),
            "-ss".into(),
            format!("{start}"),
            "-t".into(),
            format!("{duration}"),
            "-i".into(),
            b.clone(),
        ],
        filter_graph: graph,
        output_args: vec![
            "-map".into(),
            "[s]".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ],
        duration,
    };
    run_export_job_direct(host, ssim_job).await?;

    let stats_text = std::fs::read_to_string(&stats_path).unwrap_or_default();
    if stats_text.is_empty() {
        warnings.push("SSIM 统计读取失败：统计文件为空".into());
    }
    let parsed = crate::doc_ops::call(
        doc,
        "parse_ssim",
        json!({
            "text": stats_text,
            "fps": fps,
            "start": start,
            "threshold": args.get("threshold").and_then(Value::as_f64).unwrap_or(0.98),
        }),
    )
    .await?;
    let summary = parsed["result"].clone();

    // 关键帧：默认取区间的 25% / 50% / 75%，每个时间点并排 A|B。
    let frames_from_args: Vec<f64> = args
        .get("times")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let times: Vec<f64> = if frames_from_args.is_empty() {
        [0.25, 0.5, 0.75]
            .iter()
            .map(|ratio| start + duration * ratio)
            .collect()
    } else {
        frames_from_args
            .into_iter()
            .filter(|time| *time >= start && *time <= end)
            .take(8)
            .collect()
    };
    let output_dir = args
        .get("outputDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::path::Path::new(&cache)
                .join("compare")
                .to_string_lossy()
                .into_owned()
        });
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("创建对比目录失败：{error}"))?;

    let known = summary["frames"].as_array().cloned().unwrap_or_default();
    let mut frames = Vec::with_capacity(times.len());
    for (index, time) in times.iter().enumerate() {
        let path = std::path::Path::new(&output_dir)
            .join(format!("compare-{:03}.png", index + 1))
            .to_string_lossy()
            .into_owned();
        let frame_graph = format!(
            "{}[a];{}[b];[a][b]hstack=inputs=2[out]",
            fit("0"),
            fit("1")
        );
        let job = crate::export::ExportJob {
            inputs: vec![
                "-ss".into(),
                format!("{time}"),
                "-i".into(),
                a.clone(),
                "-ss".into(),
                format!("{time}"),
                "-i".into(),
                b.clone(),
            ],
            filter_graph: frame_graph,
            output_args: vec![
                "-map".into(),
                "[out]".into(),
                "-frames:v".into(),
                "1".into(),
                path.clone(),
            ],
            duration: 1.0 / fps,
        };
        run_export_job_direct(host, job).await?;
        let nearest = known
            .iter()
            .filter_map(|item| {
                Some((
                    (num(item, "time") - time).abs(),
                    item.get("score").and_then(Value::as_f64).unwrap_or(1.0),
                ))
            })
            .min_by(|left, right| left.0.partial_cmp(&right.0).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(_, score)| score)
            .unwrap_or(1.0);
        frames.push(json!({ "time": time, "path": path, "score": nearest }));
    }

    Ok(json!({
        "ssim": summary["ssim"],
        "changed": summary["changed"],
        "frames": frames,
        "statsPath": stats_path.to_string_lossy(),
        "start": start,
        "end": end,
        "fps": fps,
        "warnings": warnings,
    }))
}

// ---------------------------------------------------------------------------
// 导出 / 渲染的共用部分
// ---------------------------------------------------------------------------

/// 解析导出选项（与 `src/types/export.ts` 的 `ExportOptions` 一一对应）。
fn export_options(args: &Value) -> Value {
    let raw = args.get("options").cloned().unwrap_or_else(|| json!({}));
    let format = match raw.get("format").and_then(Value::as_str) {
        Some("prores") => "prores",
        Some("gif") => "gif",
        _ => "mp4",
    };
    json!({
        "format": format,
        "resolution": raw.get("resolution").and_then(Value::as_str).unwrap_or("project"),
        "width": raw.get("width").cloned().unwrap_or(Value::Null),
        "height": raw.get("height").cloned().unwrap_or(Value::Null),
        "fps": raw.get("fps").cloned().unwrap_or(Value::Null),
        "quality": raw.get("quality").and_then(Value::as_str).unwrap_or("high"),
        "fit": raw.get("fit").and_then(Value::as_str).unwrap_or("contain"),
        "fitAnchor": raw.get("fitAnchor").and_then(Value::as_str).unwrap_or("center"),
        "gifColors": raw.get("gifColors").cloned().unwrap_or(json!(256)),
        "gifDither": raw.get("gifDither").and_then(Value::as_str).unwrap_or("sierra2_4a"),
        "gifLoop": raw.get("gifLoop").cloned().unwrap_or(json!(0)),
        "audio": raw.get("audio").cloned().unwrap_or(json!(true)),
    })
}

/// 调领域层编译导出计划（返回 `{format,width,height,fps,duration,inputs,filterGraph,outputArgs,warnings}`）。
async fn compile_export(
    doc: &DocHandle,
    args: &Value,
    output_path: &str,
    frame_time: Option<f64>,
) -> Result<Value, String> {
    let mut payload = json!({
        "outputPath": output_path,
        "options": export_options(args),
    });
    if let Some(time) = frame_time {
        payload["frameTime"] = json!(time);
        // 静帧只输出画面：不编译音频链，避免未连接的 anullsrc 让 ffmpeg 报错。
        payload["options"]["audio"] = json!(false);
    }
    if let Some(window) = args.get("window").filter(|value| !value.is_null()) {
        payload["window"] = window.clone();
    }
    let outcome = crate::doc_ops::call(doc, "compile_export", payload).await?;
    Ok(outcome["result"].clone())
}

fn export_job(plan: &Value) -> Result<crate::export::ExportJob, String> {
    serde_json::from_value(json!({
        "inputs": plan["inputs"],
        "filterGraph": plan["filterGraph"],
        "outputArgs": plan["outputArgs"],
        "duration": plan["duration"],
    }))
    .map_err(|error| format!("导出计划不合法：{error}"))
}

/// 导出扩展名（与桌面同名规则）。
fn export_extension(format: &str) -> &'static str {
    match format {
        "prores" => "mov",
        "gif" => "gif",
        _ => "mp4",
    }
}

/// 从路径取扩展名（小写）。
fn extension_of(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// 目标路径：调用方给 `outputPath` 就用它；只给 `outputDir` 时按工程名生成，
/// 重名自动加 `-2`、`-3`（与桌面 `unique_output_path` 同规则）。
async fn resolve_export_path(doc: &DocHandle, args: &Value, format: &str) -> Result<String, String> {
    let ext = export_extension(format);
    if let Some(path) = args
        .get("outputPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        let current = extension_of(path);
        if !current.is_empty() && current != ext {
            return Err(format!(
                "扩展名与格式不匹配：format={format} 需要 .{ext}，实际是 .{current}"
            ));
        }
        return Ok(path.to_string());
    }
    let dir = args
        .get("outputDir")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "export_video 需要 outputPath 或 outputDir".to_string())?;
    let snapshot: Value = serde_json::from_str(&doc.snapshot().await?)
        .map_err(|error| format!("工程快照不合法：{error}"))?;
    let name = snapshot
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("export")
        .to_string();
    let mut candidate = std::path::Path::new(dir).join(format!("{name}.{ext}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = std::path::Path::new(dir).join(format!("{name}-{index}.{ext}"));
        index += 1;
    }
    Ok(candidate.to_string_lossy().into_owned())
}

/// 整段（或区间）导出时间线。
async fn export_timeline(
    doc: &DocHandle,
    host: &std::sync::Arc<dyn Host>,
    args: &Value,
    window: Option<(f64, f64)>,
) -> Result<Value, String> {
    let options = export_options(args);
    let format = options
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("mp4")
        .to_string();
    let output_path = resolve_export_path(doc, args, &format).await?;
    let mut args = args.clone();
    if let Some((start, end)) = window {
        args["window"] = json!({ "start": start, "end": end });
    }
    let plan = compile_export(doc, &args, &output_path, None).await?;
    let state = crate::export::shared()
        .ok_or_else(|| "导出状态未初始化：请通过 daemon / 桌面壳启动".to_string())?;
    let job = export_job(&plan)?;
    crate::export::export_video(host.as_ref(), state.as_ref(), job).await?;
    let warnings = plan["warnings"].clone();
    if let Some(list) = warnings.as_array() {
        if !list.is_empty() {
            // 无头侧没有 Canvas 渲染文字图层：计划里的文字块会被跳过（带 warning）。
            // 这里不假装成功——把 warning 原样返回给调用方。
            let text_layers = list.iter().any(|item| {
                item.as_str()
                    .map(|text| text.contains("文字") || text.contains("text"))
                    .unwrap_or(false)
            });
            if text_layers {
                eprintln!("[export] 文字图层在无头导出中被跳过：{list:?}");
            }
        }
    }
    Ok(json!({
        "path": output_path,
        "format": format,
        "duration": plan["duration"],
        "width": plan["width"],
        "height": plan["height"],
        "fps": plan["fps"],
        "warnings": warnings,
        "revision": doc.revision().await?,
    }))
}

// ---------------------------------------------------------------------------
// 编辑宏的共用部分
// ---------------------------------------------------------------------------

/// 取一个必填字符串参数。
fn require_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("缺少 {key}"))
}

/// 提交一条命令：`baseRevision` 由这里注入（调用方显式给了就用它的）。
async fn apply_domain_command(
    doc: &DocHandle,
    mut command: Value,
    args: &Value,
) -> Result<Value, String> {
    let base = match args.get("baseRevision").and_then(Value::as_u64) {
        Some(value) => value,
        None => doc.revision().await?,
    };
    if let Some(map) = command.as_object_mut() {
        map.insert("baseRevision".into(), json!(base));
    }
    let result =
        crate::agent_bridge::call(doc, "project.apply", json!({ "command": command })).await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("命令失败")
            .to_string());
    }
    Ok(result)
}

/// 宏工具：参数去掉 `baseRevision` 后原样作为 payload（与桌面 `apply_macro` 一致）。
async fn macro_command(doc: &DocHandle, kind: &str, args: &Value) -> Result<Value, String> {
    let mut payload = args.clone();
    if let Some(map) = payload.as_object_mut() {
        map.remove("baseRevision");
    }
    apply_domain_command(doc, json!({ "kind": kind, "payload": payload }), args).await
}

// ---------------------------------------------------------------------------
// 片段级 AI 的共用部分
// ---------------------------------------------------------------------------

/// 一次片段级 AI 的目标：片段（可能没有）+ 素材。
struct Target {
    clip_id: Option<String>,
    clip: Option<Value>,
    asset: Value,
}

fn num(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

impl Target {
    fn src(&self) -> Result<String, String> {
        self.asset
            .get("src")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "这个片段没有素材（纯合成 / 文字片段）".to_string())
    }

    fn display_id(&self) -> String {
        self.clip_id
            .clone()
            .or_else(|| self.asset.get("id").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default()
    }

    fn asset_name(&self) -> String {
        self.asset
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("片段")
            .to_string()
    }

    fn kind(&self) -> String {
        self.asset
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    }

    fn start(&self) -> f64 {
        self.clip.as_ref().map(|clip| num(clip, "start")).unwrap_or(0.0)
    }

    fn in_point(&self) -> f64 {
        self.clip.as_ref().map(|clip| num(clip, "in")).unwrap_or(0.0)
    }

    fn duration(&self) -> Result<f64, String> {
        let value = self
            .clip
            .as_ref()
            .map(|clip| num(clip, "duration"))
            .filter(|value| *value > 0.0)
            .unwrap_or_else(|| num(&self.asset, "duration"));
        if value > 0.0 {
            Ok(value)
        } else {
            Err(format!("片段 {} 时长无效", self.display_id()))
        }
    }

    /// 素材在线、时长有效（与桌面 `requireMediaClip` 同语义）。
    fn require_media(&self) -> Result<(), String> {
        if self.asset.get("offline").and_then(Value::as_bool) == Some(true) {
            return Err(format!("素材离线：{}", self.asset_name()));
        }
        self.duration().map(|_| ())
    }

    fn require_video(&self) -> Result<(), String> {
        self.require_media()?;
        if self.kind() != "video" {
            return Err(format!("片段 {} 不是视频素材", self.display_id()));
        }
        if self
            .clip
            .as_ref()
            .and_then(|clip| clip.get("audioOnly"))
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Err(format!("片段 {} 是纯音频片段", self.display_id()));
        }
        Ok(())
    }

    fn require_visual(&self) -> Result<(), String> {
        self.require_media()?;
        let kind = self.kind();
        if kind != "video" && kind != "image" {
            return Err(format!("片段 {} 不是视频或图片素材", self.display_id()));
        }
        Ok(())
    }

    /// 素材自带帧率优先，否则用工程帧率。
    async fn fps_or(&self, doc: &DocHandle) -> Result<f64, String> {
        let fps = num(&self.asset, "fps");
        if fps > 0.0 {
            Ok(fps)
        } else {
            crate::doc_ops::fps_of(doc).await
        }
    }
}

/// 定位目标：优先 `clipId`，其次 `assetId`（与桌面 `transcribe` / `cut_filler_words` 一致）。
async fn media_target(doc: &DocHandle, args: &Value) -> Result<Target, String> {
    if let Some(clip_id) = args
        .get("clipId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let view = crate::doc_ops::clip_view(doc, clip_id).await?;
        let clip = view
            .get("clip")
            .cloned()
            .filter(|value| !value.is_null())
            .ok_or_else(|| format!("片段不存在：{clip_id}"))?;
        let asset = view
            .get("asset")
            .cloned()
            .filter(|value| !value.is_null())
            .ok_or_else(|| format!("片段 {clip_id} 没有关联素材"))?;
        return Ok(Target {
            clip_id: Some(clip_id.to_string()),
            clip: Some(clip),
            asset,
        });
    }
    if let Some(asset_id) = args
        .get("assetId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let asset = crate::doc_ops::asset_by_id(doc, asset_id).await?;
        return Ok(Target {
            clip_id: None,
            clip: None,
            asset,
        });
    }
    Err("需要 clipId 或 assetId".into())
}

/// 只读文案查表（轨道名 / 标签与桌面同一份 i18n）。
async fn translate_keys(
    doc: &DocHandle,
    keys: &[&str],
) -> Result<std::collections::HashMap<String, String>, String> {
    let outcome = crate::doc_ops::call(doc, "translate_keys", json!({ "keys": keys })).await?;
    let mut labels = std::collections::HashMap::new();
    if let Some(map) = outcome["result"]["labels"].as_object() {
        for (key, value) in map {
            if let Some(text) = value.as_str() {
                labels.insert(key.clone(), text.to_string());
            }
        }
    }
    Ok(labels)
}

/// 素材内字幕 → 时间线字幕（帧吸附 + 片段窗口裁剪都在领域层做）。
async fn map_cues(
    doc: &DocHandle,
    target: &Target,
    cues: &[crate::asr::SubtitleCue],
) -> Result<Value, String> {
    let fps = crate::doc_ops::fps_of(doc).await?;
    let outcome = crate::doc_ops::call(
        doc,
        "map_cues",
        json!({ "cues": cues, "clipId": target.clip_id, "fps": fps }),
    )
    .await?;
    Ok(outcome["result"]["cues"].clone())
}

/// 目标语言 → 翻译提示词（与桌面 `TRANSLATE_PROMPTS` 同一张表）。
fn translate_prompt(target: &str) -> String {
    match target {
        "en" => "English",
        "zh" => "Simplified Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        other => other,
    }
    .to_string()
}

/// 视频处理结果落回时间线：新素材替换片段引用（入点归零、时长夹到素材长度）。
///
/// `label` 可以是 i18n 键（`videoAi.upscale`），也可以是字面量（桌面 `process_video`
/// 用的就是中文「视频处理」）：查不到译文时原样使用。
async fn replace_video(
    host: &std::sync::Arc<dyn Host>,
    doc: &DocHandle,
    target: &Target,
    path: &str,
    duration: f64,
    label: &str,
) -> Result<Value, String> {
    let labels = translate_keys(doc, &[label]).await?;
    let label = labels.get(label).cloned().unwrap_or_else(|| label.to_string());
    let name = format!("{} · {}", target.asset_name(), label);
    let kind = if target.kind() == "image" {
        Some("image")
    } else {
        Some("video")
    };
    let asset = crate::doc_ops::asset_for(host.as_ref(), path, Some(&name), kind).await?;
    let asset_id = asset["id"].clone();
    let clip_id = target
        .clip_id
        .clone()
        .ok_or_else(|| "视频 AI 需要 clipId（素材要先放到时间线上）".to_string())?;
    let outcome = crate::doc_ops::call(
        doc,
        "replace_video",
        json!({
            "assets": [asset],
            "clipId": clip_id,
            "assetId": asset_id,
            "duration": duration,
        }),
    )
    .await?;
    Ok(json!({
        "assetId": asset_id,
        "duration": duration,
        "revision": outcome["revision"],
    }))
}

/// 音频处理结果落位：与桌面 `applyProcessedAudio` 同一条规则
/// （纯音频片段就地换素材、视频片段静音后另开一轨）。
async fn process_audio_result(
    doc: &DocHandle,
    host: &std::sync::Arc<dyn Host>,
    clip_id: &str,
    target: &Target,
    output: &crate::audio_ai::AudioProcessed,
    track_key: &str,
) -> Result<Value, String> {
    let asset = crate::doc_ops::asset_for(host.as_ref(), &output.path, None, Some("audio")).await?;
    let labels = translate_keys(doc, &[track_key]).await?;
    let track_name = labels
        .get(track_key)
        .cloned()
        .unwrap_or_else(|| track_key.to_string());
    let outcome = crate::doc_ops::call(
        doc,
        "processed_audio",
        json!({
            "assets": [asset],
            "clipId": clip_id,
            "assetId": asset["id"],
            "duration": output.duration,
            "sourceKind": target.kind(),
            "trackName": track_name,
        }),
    )
    .await?;
    Ok(json!({
        "ok": true,
        "output": output.path,
        "duration": output.duration,
        "assetId": asset["id"],
        "tracks": outcome["result"]["tracks"],
        "revision": outcome["revision"],
    }))
}

/// 译制配音：逐句合成 → 落「译音」轨，原片段静音。
async fn translate_dub(
    host: &std::sync::Arc<dyn Host>,
    doc: &DocHandle,
    target: &Target,
    mapped: &[Value],
    translated: &[String],
    args: &Value,
) -> Result<usize, String> {
    if translated.is_empty() {
        return Ok(0);
    }
    let items: Vec<crate::tts_core::TtsItem> = translated
        .iter()
        .enumerate()
        .map(|(index, text)| crate::tts_core::TtsItem {
            id: index.to_string(),
            text: text.clone(),
        })
        .collect();
    let provider = args
        .get("providerId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let voice = args.get("voiceId").and_then(Value::as_str).map(str::to_string);

    let audios = if let Some(provider_id) = provider {
        let network = crate::doc_ops::network_of(host.as_ref());
        let state = crate::doc_ops::cloud_tts_of(host.as_ref());
        crate::cloud_tts::cloud_tts_synthesize(
            host.as_ref(),
            &network,
            &state,
            provider_id.to_string(),
            items,
            voice,
        )
        .await?
    } else {
        let model = crate::doc_ops::pick_installed(
            host.as_ref(),
            "tts",
            args.get("ttsModelId").and_then(Value::as_str),
            "语音合成",
        )?;
        if model.family == crate::models::ModelFamily::MossTtsNano {
            crate::doc_ops::require_installed(host.as_ref(), "tts-codec", "语音编解码")?;
        }
        // 参考音色取片段前 10 秒（ZipVoice 克隆音色要用）。
        let reference_text = mapped
            .iter()
            .filter(|cue| num(cue, "start") - target.start() < 10.0)
            .map(|cue| {
                cue.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(" ");
        let reference_text = reference_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let reference = if reference_text.is_empty() {
            None
        } else {
            Some(
                crate::audio_ai::audio_extract_reference(
                    host.as_ref(),
                    target.src()?,
                    target.in_point(),
                    target.duration()?.min(10.0),
                )
                .await?,
            )
        };
        crate::tts::tts_synthesize(
            host,
            model.id.to_string(),
            items,
            None,
            reference.as_ref().map(|audio| audio.path.clone()),
            if reference_text.is_empty() {
                None
            } else {
                Some(reference_text)
            },
        )
        .await?
    };

    let mut assets = Vec::with_capacity(audios.len());
    let mut entries = Vec::with_capacity(audios.len());
    for audio in &audios {
        let asset = crate::doc_ops::asset_for(host.as_ref(), &audio.path, None, Some("audio")).await?;
        let index: usize = audio.id.parse().unwrap_or(0);
        let start = mapped
            .get(index)
            .map(|cue| num(cue, "start"))
            .unwrap_or_else(|| target.start());
        entries.push(json!({
            "id": audio.id,
            "assetId": asset["id"],
            "start": start,
            "duration": audio.duration,
        }));
        assets.push(asset);
    }
    crate::doc_ops::call(
        doc,
        "voiceover",
        json!({
            "assets": assets,
            "items": entries,
            "muteClipId": target.clip_id,
            "defaultName": "audio.dubTrack",
        }),
    )
    .await?;
    Ok(audios.len())
}

/// 朗读：文字片段 / 一段文字 → 本地或云端 TTS → 朗读轨。
async fn synthesize_voiceover(
    host: &std::sync::Arc<dyn Host>,
    doc: &DocHandle,
    args: &Value,
) -> Result<Value, String> {
    let mut spoken: Vec<crate::tts_core::TtsItem> = Vec::new();
    let mut starts: std::collections::HashMap<String, f64> = std::collections::HashMap::new();

    let clip_ids = args
        .get("clipIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !clip_ids.is_empty() {
        for id in &clip_ids {
            let clip_id = id
                .as_str()
                .ok_or_else(|| "clipIds 必须是字符串数组".to_string())?;
            let view = crate::doc_ops::clip_view(doc, clip_id).await?;
            let Some(clip) = view.get("clip").cloned().filter(|value| !value.is_null()) else {
                continue;
            };
            if clip.get("assetId").and_then(Value::as_str).unwrap_or("") != "" {
                continue;
            }
            let text = clip
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }
            starts.insert(clip_id.to_string(), num(&clip, "start"));
            spoken.push(crate::tts_core::TtsItem {
                id: clip_id.to_string(),
                text,
            });
        }
        if spoken.is_empty() {
            return Err("给定的 clipIds 里没有可朗读的文字片段".into());
        }
    } else if let Some(text) = args
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        starts.insert("0".into(), args.get("start").and_then(Value::as_f64).unwrap_or(0.0));
        spoken.push(crate::tts_core::TtsItem {
            id: "0".into(),
            text: text.to_string(),
        });
    } else {
        return Err("需要 text，或包含文字的 clipIds".into());
    }

    let provider = args
        .get("providerId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let voice = args.get("voiceId").and_then(Value::as_str).map(str::to_string);

    let audios = if let Some(provider_id) = provider {
        let network = crate::doc_ops::network_of(host.as_ref());
        let state = crate::doc_ops::cloud_tts_of(host.as_ref());
        crate::cloud_tts::cloud_tts_synthesize(
            host.as_ref(),
            &network,
            &state,
            provider_id.to_string(),
            spoken.clone(),
            voice.clone(),
        )
        .await?
    } else {
        let model = crate::doc_ops::pick_installed(
            host.as_ref(),
            "tts",
            args.get("modelId").and_then(Value::as_str),
            "语音合成",
        )?;
        if model.family == crate::models::ModelFamily::MossTtsNano {
            crate::doc_ops::require_installed(host.as_ref(), "tts-codec", "语音编解码")?;
        }
        let reference_id = args
            .get("referenceAssetId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let mut reference_path = None;
        let mut reference_text = args
            .get("referenceText")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(asset_id) = reference_id {
            let asset = crate::doc_ops::asset_by_id(doc, asset_id).await?;
            let reference_src = asset
                .get("src")
                .and_then(Value::as_str)
                .ok_or_else(|| "参考素材没有路径".to_string())?
                .to_string();
            if model.family == crate::models::ModelFamily::ZipVoice && reference_text.is_none() {
                let asr_model =
                    crate::doc_ops::pick_installed(host.as_ref(), "asr", None, "语音识别")?;
                crate::doc_ops::require_installed(host.as_ref(), "vad", "语音检测")?;
                let cues =
                    crate::asr::asr_transcribe(host, reference_src.clone(), asr_model.id.to_string(), None)
                        .await?;
                let joined = cues
                    .iter()
                    .map(|cue| cue.text.trim())
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                let collapsed = joined.split_whitespace().collect::<Vec<_>>().join(" ");
                if !collapsed.is_empty() {
                    reference_text = Some(collapsed);
                }
            }
            reference_path = Some(reference_src);
        }
        crate::tts::tts_synthesize(
            host,
            model.id.to_string(),
            spoken.clone(),
            if reference_id.is_some() { None } else { voice.clone() },
            reference_path,
            reference_text,
        )
        .await?
    };
    if audios.is_empty() {
        return Err("语音合成没有产出音频".into());
    }

    let mut assets = Vec::with_capacity(audios.len());
    let mut entries = Vec::with_capacity(audios.len());
    for audio in &audios {
        let text = spoken
            .iter()
            .find(|item| item.id == audio.id)
            .map(|item| item.text.clone())
            .unwrap_or_default();
        let name = if text.is_empty() {
            None
        } else {
            Some(text.chars().take(30).collect::<String>())
        };
        let asset =
            crate::doc_ops::asset_for(host.as_ref(), &audio.path, name.as_deref(), Some("audio"))
                .await?;
        entries.push(json!({
            "id": audio.id,
            "assetId": asset["id"],
            "start": starts.get(&audio.id).copied().unwrap_or(0.0),
            "duration": audio.duration,
        }));
        assets.push(asset);
    }
    let outcome = crate::doc_ops::call(
        doc,
        "voiceover",
        json!({
            "assets": assets,
            "items": entries,
            "defaultName": "ai.voiceoverTrack",
        }),
    )
    .await?;
    Ok(json!({
        "count": audios.len(),
        "assets": outcome["result"]["tracks"],
        "revision": outcome["revision"],
    }))
}

/// 一个工具定义（与桌面 `tools.rs` 的 `ToolDef` 同形）。
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

/// 无头版提供的工具清单（与桌面同名同参数；未搬过来的工具不列进清单，
/// 模型就不会调用它们）。
pub fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "get_project",
            description: "读取工程概览与 revision：只返回规格、轨道摘要与素材数量，不含片段/素材明细。按关注点继续读 get_context / get_track / find_clips / get_clip / get_assets。写操作前先调用它拿 revision。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "get_context",
            description: "读取用户当前关注点：播放头、是否在播放、选中的片段与活跃轨道。适合处理“这里”“选中的片段”这类指令。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "get_clip",
            description: "读取单个片段的完整属性、所在轨道、素材信息与前后邻居。",
            parameters: json!({
                "type": "object",
                "properties": { "clipId": { "type": "string" } },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "get_track",
            description: "按页读取一条轨道的片段。trackId 可传轨道 id 或概览里的 1 起始 index。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "trackId": {
                        "oneOf": [{ "type": "string" }, { "type": "integer", "minimum": 1 }],
                        "description": "轨道 id 或 1 起始 index"
                    },
                    "offset": { "type": "integer", "minimum": 0, "description": "跳过多少条片段，默认 0" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "本页片段数，默认 40" }
                },
                "required": ["trackId"]
            }),
        },
        ToolDef {
            name: "find_clips",
            description: "按轨道、素材、文字、时间区间或类型检索片段，返回分页摘要。用于找出所有字幕、某个素材的片段，或某段时间里有什么。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "trackId": {
                        "oneOf": [{ "type": "string" }, { "type": "integer", "minimum": 1 }],
                        "description": "轨道 id 或 1 起始 index"
                    },
                    "assetId": { "type": "string" },
                    "text": { "type": "string", "description": "文字片段包含该子串（不区分大小写）" },
                    "kind": { "enum": ["video", "audio", "image", "text", "missing"] },
                    "from": { "type": "number", "description": "时间下限（秒）" },
                    "to": { "type": "number", "description": "时间上限（秒）" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "默认 40" }
                }
            }),
        },
        ToolDef {
            name: "get_assets",
            description: "分页读取素材库，可按类型、名称与离线状态过滤。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "kind": { "enum": ["video", "audio", "image"] },
                    "name": { "type": "string" },
                    "offline": { "type": "boolean" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200, "description": "默认 50" }
                }
            }),
        },
        ToolDef {
            name: "get_markers",
            description: "读取时间线标记，可按时间区间过滤。标记用于定位、章节与审片批注。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "from": { "type": "number", "description": "时间下限（秒）" },
                    "to": { "type": "number", "description": "时间上限（秒）" }
                }
            }),
        },
        ToolDef {
            name: "denoise_audio",
            description: "用 LocalVQE 对片段做 AI 降噪：处理结果落到一条新音轨，原片段静音（画面保留）。模型没装时先用 list_ai_models 查。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "modelId": { "type": "string", "description": "默认 localvqe（随包）" }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "process_audio",
            description: "无模型音频 DSP：降噪（effect=denoise）或人声美化（effect=beautify）。结果落到新音轨，原片段静音。不依赖任何模型。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "effect": { "enum": ["denoise", "beautify"] },
                    "preset": { "enum": ["light", "medium", "strong", "natural", "bright", "warm"] }
                },
                "required": ["clipId", "effect", "preset"]
            }),
        },
        ToolDef {
            name: "measure_loudness",
            description: "测量片段积分响度与真峰值；apply=true 时把建议增益写回片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "targetLufs": { "type": "number", "description": "默认 -14" },
                    "apply": { "type": "boolean" }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "process_video",
            description: "无模型视频处理：稳定 / 降噪 / 去闪烁 / 动态模糊 / 放大，用结果替换原片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "options": {
                        "type": "object",
                        "properties": {
                            "stabilize": { "enum": ["light", "medium", "strong"] },
                            "denoise": { "enum": ["light", "medium", "strong"] },
                            "deflicker": { "enum": ["light", "medium", "strong"] },
                            "motionBlur": { "type": "number", "minimum": 0, "maximum": 1 },
                            "upscale": { "type": "number", "description": "1.5 或 2" }
                        }
                    }
                },
                "required": ["clipId", "options"]
            }),
        },
        ToolDef {
            name: "list_ai_models",
            description: "列出本地 AI 模型。可按 feature 过滤：asr / vad / tts / tts-codec / enhance / separate / superres / interpolate / track / reframe。",
            parameters: json!({
                "type": "object",
                "properties": { "feature": { "type": "string" } }
            }),
        },
        ToolDef {
            name: "probe_media",
            description: "一次调用了解素材内容：元数据 + 按时间的运动采样与候选切点 + 可选目标框 + 可选语音转写。不要逐帧看图，先用它。objects 需要已安装 YuNet（face）或 YOLOX（person）；transcript 需要已安装 ASR + silero-vad。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "本机媒体绝对路径" },
                    "motion": { "type": "boolean", "description": "返回运动采样与切点，默认 true" },
                    "objects": { "enum": ["none", "face", "person", "auto"], "description": "目标框类型，默认 none" },
                    "transcript": { "type": "boolean", "description": "同时做本地语音转写，默认 false" },
                    "interval": { "type": "number", "minimum": 0.25, "maximum": 600, "description": "采样间隔（秒），默认 2" },
                    "maxSamples": { "type": "integer", "minimum": 1, "maximum": 300, "description": "最多采样多少帧，默认 60" },
                    "modelId": { "type": "string", "description": "指定 ASR 模型；省略时用第一个已安装的" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "transcribe",
            description: "用本地 ASR 转写音频/视频片段，并把字幕写入时间线（默认新建字幕轨）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "assetId": { "type": "string" },
                    "language": { "type": "string", "description": "默认 auto" },
                    "modelId": { "type": "string" },
                    "insertSubtitles": { "type": "boolean", "description": "默认 true" },
                    "trackName": { "type": "string" }
                },
                "anyOf": [{ "required": ["clipId"] }, { "required": ["assetId"] }]
            }),
        },
        ToolDef {
            name: "cut_filler_words",
            description: "智能剪口播：识别 → 强制对齐器给词级时间 → 剪掉口癖与长停顿，并生成「口播字幕」轨供改字。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string", "description": "要剪的片段；省略时按 assetId 找时间线上引用它的片段" },
                    "assetId": { "type": "string" },
                    "modelId": { "type": "string", "description": "语音识别模型，省略时用 SenseVoice" },
                    "minPause": { "type": "number", "description": "长停顿阈值（秒），默认 0.8" },
                    "pauseKeep": { "type": "number", "description": "剪停顿后段中保留多少秒，默认 0.3" },
                    "sentenceKeep": { "type": "number", "description": "剪停顿后句末保留多少秒，默认 0.4" },
                    "includeSoft": { "type": "boolean", "description": "是否也剪「那个 / 就是」这类口头禅，默认 true" },
                    "dryRun": { "type": "boolean", "description": "只返回建议，不改时间线" },
                    "customWords": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "自定义过滤词（任意语言），命中就剪"
                    },
                    "disabledWords": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "从默认过滤词里移除的词"
                    },
                    "trimPad": { "type": "number", "description": "切点向两侧静音扩展多少秒，默认 0.12；时间戳卡在字音峰值时可避免残留尾音" }
                }
            }),
        },
        ToolDef {
            name: "separate_stems",
            description: "对片段做音源/人声分离（UVR / HTDemucs），生成分轨轨道并静音源片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "modelId": { "type": "string" }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "translate_audio",
            description: "转写片段并翻译成目标语言，生成译文字幕轨；dub=true 时再生成译制配音。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "target": { "type": "string", "description": "en / zh / ja / ko / es / fr / de，或完整提示词" },
                    "dub": { "type": "boolean" },
                    "asrModelId": { "type": "string" },
                    "ttsModelId": { "type": "string" },
                    "providerId": { "type": "string" },
                    "voiceId": { "type": "string" }
                },
                "required": ["clipId", "target"]
            }),
        },
        ToolDef {
            name: "synthesize_voiceover",
            description: "把文字片段（clipIds）或一段文字（text）合成语音并放回时间线。本地/云端 TTS 均可。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipIds": { "type": "array", "items": { "type": "string" } },
                    "text": { "type": "string" },
                    "start": { "type": "number", "description": "text 模式的起点，默认 0" },
                    "modelId": { "type": "string" },
                    "providerId": { "type": "string" },
                    "voiceId": { "type": "string" },
                    "referenceAssetId": { "type": "string" },
                    "referenceText": { "type": "string" }
                }
            }),
        },
        ToolDef {
            name: "upscale_video",
            description: "Real-ESRGAN 视频 / 图片超分（2x / 4x），用结果替换原片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "modelId": { "type": "string" },
                    "scale": { "enum": [2, 4] }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "interpolate_video",
            description: "RIFE 视频补帧（2x / 4x），用结果替换原片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "modelId": { "type": "string" },
                    "factor": { "enum": [2, 4] }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "reframe_video",
            description: "智能裁剪 / 镜头追踪，输出竖屏或方屏；用结果替换原片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "mode": { "enum": ["crop", "track"], "description": "默认 crop" },
                    "subject": { "enum": ["face", "person", "auto", "center"] },
                    "aspect": { "enum": ["9:16", "1:1", "16:9", "source"] },
                    "height": { "type": "integer" },
                    "smooth": { "type": "number" }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "append_clip",
            description: "把素材追加到轨道末尾。trackId 省略时用最后一条轨道，没有轨道时自动新建；start 省略时接在轨道末尾；duration 省略时用素材时长（图片默认 5 秒）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "assetId": { "type": "string" },
                    "trackId": {
                        "oneOf": [{ "type": "string" }, { "type": "integer", "minimum": 1 }],
                        "description": "轨道 id 或 1 起始 index"
                    },
                    "trackName": { "type": "string", "description": "自动新建轨道时的名字" },
                    "start": { "type": "number", "description": "省略则接在轨道末尾" },
                    "duration": { "type": "number", "description": "省略则用素材时长" },
                    "in": { "type": "number", "description": "素材入点，默认 0" },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["assetId"]
            }),
        },
        ToolDef {
            name: "set_clip_speed",
            description: "设置片段播放速度（0.1–4）。保持素材区间不变，自动调整时间线时长，并避开同轨下一个片段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "speed": { "type": "number", "minimum": 0.1, "maximum": 4 },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipId", "speed"]
            }),
        },
        ToolDef {
            name: "set_clip_color",
            description: "调整片段调色：亮度 -1..1、对比度 0..2、饱和度 0..3、色温/色调 -1..1。只传要改的字段。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "brightness": { "type": "number", "minimum": -1, "maximum": 1 },
                    "contrast": { "type": "number", "minimum": 0, "maximum": 2 },
                    "saturation": { "type": "number", "minimum": 0, "maximum": 3 },
                    "temperature": { "type": "number", "minimum": -1, "maximum": 1 },
                    "tint": { "type": "number", "minimum": -1, "maximum": 1 },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "set_clip_transition",
            description: "设置/移除片段入场或出场转场（fade / slide）。duration 以时间线秒为单位。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "edge": { "enum": ["in", "out"] },
                    "remove": { "type": "boolean" },
                    "type": { "enum": ["fade", "slide"] },
                    "duration": { "type": "number", "minimum": 0 },
                    "direction": { "enum": ["left", "right", "up", "down"] },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipId", "edge"]
            }),
        },
        ToolDef {
            name: "set_clip_keyframes",
            description: "整组替换片段的关键帧。每个关键帧记录该时刻的全部画面参数（opacity / x / y / scale / rotation），缺省字段沿用片段当前静态值；相邻关键帧之间自动线性插值。remove: true 清空全部关键帧。时间相对片段起点。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "remove": { "type": "boolean", "description": "true 时清空全部关键帧" },
                    "keyframes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "time": { "type": "number", "minimum": 0 },
                                "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
                                "x": { "type": "number", "minimum": -100, "maximum": 100 },
                                "y": { "type": "number", "minimum": -100, "maximum": 100 },
                                "scale": { "type": "number", "minimum": 0.01, "maximum": 10 },
                                "rotation": { "type": "number", "minimum": -360, "maximum": 360 }
                            },
                            "required": ["time"]
                        }
                    },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "duplicate_clips",
            description: "复制片段并按 offset 偏移。省略 targetTrackId 时留在原轨道；结果与现有片段重叠会被拒绝。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipIds": { "type": "array", "items": { "type": "string" } },
                    "offset": { "type": "number", "description": "时间偏移（秒），默认 0" },
                    "targetTrackId": {
                        "oneOf": [{ "type": "string" }, { "type": "integer", "minimum": 1 }]
                    },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipIds"]
            }),
        },
        ToolDef {
            name: "ripple_delete",
            description: "波纹删除：删除片段，并把同一轨道上后续片段左移，补上被删片段留下的空隙。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipIds": { "type": "array", "items": { "type": "string" } },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipIds"]
            }),
        },
        ToolDef {
            name: "add_marker",
            description: "在时间线指定时间添加标记；name 省略时自动命名。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "minimum": 0 },
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "#rrggbb" },
                    "kind": { "enum": ["scene", "hit", "review", "chapter"] },
                    "sceneId": { "type": "string" },
                    "note": { "type": "string" },
                    "severity": { "enum": ["blocker", "high", "medium", "low"] },
                    "resolved": { "type": "boolean" },
                    "bbox": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number" }, "y": { "type": "number" },
                            "width": { "type": "number" }, "height": { "type": "number" }
                        }
                    },
                    "screenshot": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["time"]
            }),
        },
        ToolDef {
            name: "update_marker",
            description: "修改标记的时间、名称或颜色。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "markerId": { "type": "string" },
                    "time": { "type": "number", "minimum": 0 },
                    "name": { "type": "string" },
                    "color": { "type": "string" },
                    "kind": { "enum": ["scene", "hit", "review", "chapter"] },
                    "sceneId": { "type": "string" },
                    "note": { "type": "string" },
                    "severity": { "enum": ["blocker", "high", "medium", "low"] },
                    "resolved": { "type": "boolean" },
                    "bbox": { "type": ["object", "null"] },
                    "screenshot": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["markerId"]
            }),
        },
        ToolDef {
            name: "remove_marker",
            description: "删除一个时间线标记。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "markerId": { "type": "string" },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["markerId"]
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
            name: "new_project",
            description: "新建工程并替换当前工程。直接执行，不会弹保存/打开对话框，也不需要操作界面。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "width": { "type": "integer" },
                    "height": { "type": "integer" },
                    "fps": { "type": "number" }
                }
            }),
        },
        ToolDef {
            name: "open_project",
            description: "打开工程文件并替换当前工程。直接读 JSON，不会弹文件框。",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "工程 .json 绝对路径" } },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "save_project",
            description: "保存当前工程到原路径或指定路径。直接写 JSON，不会弹保存对话框。",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "目标 .json 绝对路径" } }
            }),
        },
        // ---- 画布 / 工作流：多画布文档 + 库里已发布的工作流 ----
        ToolDef {
            name: "board_list_canvases",
            description: "列出当前工程的所有画布（一个工程可以有多张画布）：id、标题、是否活动、节点/连线数、来源与工作流签名（开始节点声明的输入 / 结束节点声明的输出）。先看这张表，再决定读或改哪张画布。无头版从工程快照汇总这些字段；publishable / problems 由桌面版提供。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "board_get_canvas",
            description: "读取一张画布的完整内容（节点与连线）与摘要；省略 canvasId 时读当前活动画布。无头版直接读工程快照。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "canvasId": { "type": "string", "description": "画布 id；省略时用活动画布" }
                }
            }),
        },
        ToolDef {
            name: "board_create_canvas",
            description: "新建一张空画布并切换过去，返回新画布的 id 与标题（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "properties": { "title": { "type": "string", "description": "画布标题，省略时自动命名" } }
            }),
        },
        ToolDef {
            name: "board_delete_canvas",
            description: "删除一张画布；工程至少保留一张画布，删最后一张会被拒绝（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "properties": { "canvasId": { "type": "string" } },
                "required": ["canvasId"]
            }),
        },
        ToolDef {
            name: "board_rename_canvas",
            description: "重命名一张画布（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "canvasId": { "type": "string" },
                    "title": { "type": "string" }
                },
                "required": ["canvasId", "title"]
            }),
        },
        ToolDef {
            name: "board_open_canvas",
            description: "切换活动画布（会先把当前画布的编辑落盘），返回新的 activeId（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "properties": { "canvasId": { "type": "string" } },
                "required": ["canvasId"]
            }),
        },
        ToolDef {
            name: "board_apply_ops",
            description: "在画布上原子地改节点与连线：按顺序执行 ops（add_node / update_node / remove_node / connect / disconnect / clear / load），整个调用进入一个撤销步（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "$defs": {
                    "node": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "type": { "type": "string", "description": "节点类型，如 input.text / model.image / workflow.call" },
                            "position": {
                                "type": "object",
                                "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
                                "required": ["x", "y"]
                            },
                            "size": {
                                "type": "object",
                                "properties": { "width": { "type": "number" }, "height": { "type": "number" } },
                                "required": ["width", "height"]
                            },
                            "data": {
                                "type": "object",
                                "description": "节点数据；params / bindings 是通用字段，其余按节点类型（assetId / items / signature …）",
                                "properties": {
                                    "params": { "type": "object" },
                                    "bindings": { "type": "object" }
                                }
                            }
                        },
                        "required": ["id", "type", "position", "data"]
                    },
                    "edge": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "source": { "type": "string" },
                            "sourcePort": { "type": "string" },
                            "target": { "type": "string" },
                            "targetPort": { "type": "string" },
                            "kind": { "enum": ["pair"] }
                        },
                        "required": ["id", "source", "sourcePort", "target", "targetPort"]
                    }
                },
                "properties": {
                    "canvasId": { "type": "string", "description": "目标画布 id；省略时用活动画布" },
                    "ops": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "add_node" },
                                        "node": { "$ref": "#/$defs/node" }
                                    },
                                    "required": ["kind", "node"]
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "update_node" },
                                        "nodeId": { "type": "string" },
                                        "patch": {
                                            "type": "object",
                                            "properties": {
                                                "position": {
                                                    "type": "object",
                                                    "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
                                                    "required": ["x", "y"]
                                                },
                                                "size": {
                                                    "type": "object",
                                                    "properties": { "width": { "type": "number" }, "height": { "type": "number" } },
                                                    "required": ["width", "height"]
                                                },
                                                "data": { "type": "object", "description": "只合并给出的字段" }
                                            }
                                        }
                                    },
                                    "required": ["kind", "nodeId"]
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "remove_node" },
                                        "nodeIds": { "type": "array", "minItems": 1, "items": { "type": "string" } }
                                    },
                                    "required": ["kind", "nodeIds"]
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "connect" },
                                        "edge": { "$ref": "#/$defs/edge" }
                                    },
                                    "required": ["kind", "edge"]
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "disconnect" },
                                        "edgeIds": { "type": "array", "minItems": 1, "items": { "type": "string" } }
                                    },
                                    "required": ["kind", "edgeIds"]
                                },
                                {
                                    "type": "object",
                                    "properties": { "kind": { "const": "clear" } },
                                    "required": ["kind"]
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": { "const": "load" },
                                        "nodes": { "type": "array", "items": { "$ref": "#/$defs/node" } },
                                        "edges": { "type": "array", "items": { "$ref": "#/$defs/edge" } }
                                    },
                                    "required": ["kind", "nodes", "edges"]
                                }
                            ]
                        }
                    }
                },
                "required": ["ops"]
            }),
        },
        ToolDef {
            name: "workflow_publish",
            description: "把一张画布发布成工作流：校验签名与图，保存进工作流库并打标签（subworkflow / api）。桌面版专用：无头版没有画布运行器。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "canvasId": { "type": "string" },
                    "name": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                }
            }),
        },
        ToolDef {
            name: "workflow_list",
            description: "列出工作流库里已发布的工作流（标签含 api 或 subworkflow；每张卡片取最新版本），返回 rootId、名称、版本、标签与签名。workflow_run 只接受这里列出的条目。无头版直接读本机工作流库。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "workflow_run",
            description: "运行一张已发布的工作流，返回签名输出（键是结束节点声明的输出名）。只有带 api / subworkflow 标签的工作流能被调用（仅桌面版；无头/容器版会明确报错）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "rootId": { "type": "string", "description": "workflow_list 返回的 rootId" },
                    "workflowId": { "type": "string", "description": "rootId 的别名（也接受带版本的 id）" },
                    "inputs": { "type": "object", "description": "按签名输入名传值：{ 名称: 值 }" }
                },
                "anyOf": [{ "required": ["rootId"] }, { "required": ["workflowId"] }]
            }),
        },
        ToolDef {
            name: "aicut_help",
            description: "取回能力域文档（渐进式披露）。留空返回索引，可选 pipeline / frameworks / storyboard / ai / review / timeline / assets / workflow / render。",
            parameters: json!({
                "type": "object",
                "properties": { "topic": { "type": "string" } }
            }),
        },
        ToolDef {
            name: "cancel_ai",
            description: "取消当前正在运行的同步 AI 任务（转写 / 分离 / 朗读 / 变声 / 视频 AI / 模型下载）。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "download_model",
            description: "下载并安装一个 AI 模型；会一直等到完成。先用 list_ai_models 查 id。",
            parameters: json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }),
        },
        ToolDef {
            name: "extract_audio",
            description: "把视频片段的音轨拆到下面一条新轨道：原片段静音，新音频片段复用同一素材。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "trackName": { "type": "string" }
                },
                "required": ["clipId"]
            }),
        },
        ToolDef {
            name: "import_subtitles",
            description: "导入 SRT / VTT 字幕文件到置顶文字轨；重叠条目会自动拆到新轨。返回条目数与新增轨道。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "字幕文件绝对路径" },
                    "trackName": { "type": "string", "description": "默认「字幕」" },
                    "offset": { "type": "number", "description": "整体时间偏移（秒）" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "export_subtitles",
            description: "把文字片段导出为 SRT / VTT。trackId 省略时导出全部文字片段；格式由扩展名或 format 决定。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "outputPath": { "type": "string", "description": "目标 .srt / .vtt 绝对路径" },
                    "trackId": {
                        "oneOf": [{ "type": "string" }, { "type": "integer", "minimum": 1 }],
                        "description": "只导出某条文字轨"
                    },
                    "format": { "enum": ["srt", "vtt"] }
                },
                "required": ["outputPath"]
            }),
        },
        ToolDef {
            name: "export_video",
            description: "导出时间线。outputPath 可省略：只给 outputDir 时按工程名生成文件名并自动去重。滤镜图与导出按钮同一份（核心域编译）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "outputPath": { "type": "string", "description": "目标绝对路径，扩展名要与 format 匹配（mp4 / mov / gif）" },
                    "outputDir": { "type": "string", "description": "只给目录时按工程名生成文件名" },
                    "format": { "enum": ["mp4", "prores", "gif"] },
                    "resolution": { "enum": ["project", "1080p", "720p", "custom"] },
                    "width": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "height": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "fit": { "enum": ["contain", "cover"] },
                    "fitAnchor": {
                        "enum": ["top-left","top","top-right","left","center","right","bottom-left","bottom","bottom-right"]
                    },
                    "fps": { "type": "integer" },
                    "quality": { "enum": ["high", "standard", "small"] },
                    "gif": {
                        "type": "object",
                        "properties": {
                            "colors": { "type": "integer", "minimum": 2, "maximum": 256 },
                            "dither": { "enum": ["sierra2_4a", "bayer", "floyd_steinberg", "none"] },
                            "loop": { "type": "integer", "minimum": -1 }
                        }
                    }
                }
            }),
        },
        ToolDef {
            name: "render_frame",
            description: "渲染时间线上某一时刻的静帧（PNG）。走同一套导出滤镜，只输出一帧。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "description": "时间线时间（秒）" },
                    "outputPath": { "type": "string", "description": "目标 .png 绝对路径" },
                    "resolution": { "enum": ["project", "1080p", "720p", "custom"] },
                    "width": { "type": "integer" },
                    "height": { "type": "integer" },
                    "fit": { "enum": ["contain", "cover"] },
                    "fps": { "type": "integer" }
                },
                "required": ["time", "outputPath"]
            }),
        },
        ToolDef {
            name: "render_range",
            description: "只导出时间线的一个区间（粗剪审片用）。参数同 export_video，另加 start / end。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "start": { "type": "number", "description": "区间起点（秒）" },
                    "end": { "type": "number", "description": "区间终点（秒）" },
                    "outputPath": { "type": "string" },
                    "outputDir": { "type": "string" },
                    "format": { "enum": ["mp4", "prores", "gif"] },
                    "resolution": { "enum": ["project", "1080p", "720p", "custom"] },
                    "width": { "type": "integer" },
                    "height": { "type": "integer" },
                    "fit": { "enum": ["contain", "cover"] },
                    "fps": { "type": "integer" },
                    "quality": { "enum": ["high", "standard", "small"] }
                },
                "required": ["start", "end"]
            }),
        },
        ToolDef {
            name: "render_status",
            description: "查询导出进度（busy / seconds / fraction）。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "add_review_note",
            description: "写一条结构化审片意见（时间线 marker，kind=review）。time 用秒；severity 用 blocker/high/medium/low；可带 sceneId、归一化 bbox、截图路径。返回 markerId，供后续 resolved。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "description": "时间线时间（秒）" },
                    "text": { "type": "string", "description": "批注正文" },
                    "severity": { "enum": ["blocker", "high", "medium", "low"] },
                    "sceneId": { "type": "string" },
                    "bbox": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number", "minimum": 0, "maximum": 1 },
                            "y": { "type": "number", "minimum": 0, "maximum": 1 },
                            "width": { "type": "number", "minimum": 0, "maximum": 1 },
                            "height": { "type": "number", "minimum": 0, "maximum": 1 }
                        },
                        "required": ["x", "y", "width", "height"]
                    },
                    "screenshot": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "color": { "type": "string", "description": "#rrggbb" }
                },
                "required": ["time", "text"]
            }),
        },
        ToolDef {
            name: "list_review_notes",
            description: "列出审片批注（只看带 note 的标记）。可按时间区间、场景、严重度、是否已解决过滤。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "from": { "type": "number" },
                    "to": { "type": "number" },
                    "sceneId": { "type": "string" },
                    "severity": { "type": "string" },
                    "resolved": { "type": "boolean" },
                    "offset": { "type": "integer" },
                    "limit": { "type": "integer" }
                }
            }),
        },
        ToolDef {
            name: "update_review_note",
            description: "修改一条审片批注：正文、严重度、是否已解决、bbox、截图、标签或时间。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "markerId": { "type": "string" },
                    "text": { "type": "string" },
                    "severity": { "type": "string" },
                    "resolved": { "type": "boolean" },
                    "bbox": { "type": "object" },
                    "screenshot": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "time": { "type": "number" }
                },
                "required": ["markerId"]
            }),
        },
        ToolDef {
            name: "remove_review_note",
            description: "删除一条审片批注。",
            parameters: json!({
                "type": "object",
                "properties": { "markerId": { "type": "string" } },
                "required": ["markerId"]
            }),
        },
        ToolDef {
            name: "import_film_manifest",
            description: "从 film.json 导入影片结构（场次 / 命中 / 审片批注 / 素材），生成对应轨道与片段。mode=replace 会同步删除本次已不存在的条目。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "film.json 绝对路径" },
                    "mode": { "enum": ["replace", "merge"] },
                    "trackName": { "type": "string", "description": "默认 Scenes" },
                    "conform": { "type": "boolean", "description": "把工程 fps/宽高改成 manifest 的交付规格" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "export_film_manifest",
            description: "把当前工程导出为 film.json。省略 path 时只返回 manifest（不写盘）；给了 path 会保留旧文件里的 music 与未知字段。",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "目标 film.json 绝对路径" } }
            }),
        },
        ToolDef {
            name: "job_start",
            description: "把一次工具调用放到后台跑：立刻返回 jobId，用 job_status 轮询、job_cancel 取消。kind 传工具名，params 传该工具的参数。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "description": "工具名，例如 transcribe / export_video" },
                    "params": { "type": "object", "description": "该工具的参数" }
                },
                "required": ["kind"]
            }),
        },
        ToolDef {
            name: "job_status",
            description: "查询后台任务状态：running / done / error，附带结果或错误。",
            parameters: json!({
                "type": "object",
                "properties": { "jobId": { "type": "string" } },
                "required": ["jobId"]
            }),
        },
        ToolDef {
            name: "job_cancel",
            description: "取消后台任务。省略 jobId 时取消最近一个还在跑的任务。",
            parameters: json!({
                "type": "object",
                "properties": { "jobId": { "type": "string" } }
            }),
        },
        ToolDef {
            name: "render_storyboard",
            description: "按时间点连续渲染 PNG（每个时间点一帧），供快速查看时间线。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "times": { "type": "array", "items": { "type": "number" }, "description": "时间点（秒）" },
                    "outputDir": { "type": "string", "description": "输出目录" },
                    "prefix": { "type": "string", "description": "文件名前缀，默认 frame" },
                    "resolution": { "enum": ["project", "1080p", "720p", "custom"] },
                    "width": { "type": "integer" },
                    "height": { "type": "integer" },
                    "fit": { "enum": ["contain", "cover"] },
                    "fps": { "type": "integer" }
                },
                "required": ["times", "outputDir"]
            }),
        },
        ToolDef {
            name: "render_contact_sheet",
            description: "接触表：把多帧拼成一张 PNG，并写一份 cell → 时间的图例 JSON。frames 省略时用 times 现渲染。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "outputPath": { "type": "string", "description": "目标 PNG 绝对路径" },
                    "frames": { "type": "array", "items": { "type": "string" }, "description": "已渲染好的帧路径" },
                    "times": { "type": "array", "items": { "type": "number" }, "description": "与帧一一对应的时间" },
                    "cols": { "type": "integer", "minimum": 1, "maximum": 6 },
                    "cellWidth": { "type": "integer", "minimum": 64 }
                },
                "required": ["outputPath"]
            }),
        },
        ToolDef {
            name: "compare_takes",
            description: "对比两版导出：ffmpeg SSIM 逐帧分数 + 低于 threshold 的变化点 + 并排关键帧 PNG。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "a": { "type": "string", "description": "A 版视频绝对路径" },
                    "b": { "type": "string", "description": "B 版视频绝对路径" },
                    "times": { "type": "array", "items": { "type": "number", "minimum": 0 } },
                    "outputDir": { "type": "string" },
                    "range": {
                        "type": "object",
                        "properties": {
                            "start": { "type": "number", "minimum": 0 },
                            "end": { "type": "number", "minimum": 0 }
                        }
                    },
                    "threshold": { "type": "number", "minimum": 0, "maximum": 1 },
                    "fps": { "type": "integer" }
                },
                "required": ["a", "b"]
            }),
        },
        ToolDef {
            name: "render_manifest",
            description: "按场景逐个渲染并写出 mp4。scenes 或 manifestPath 二选一；返回 rendered/failed 与每段结果。注意：无头版不复用桌面缓存，每次都重新渲染。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "scenes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "start": { "type": "number", "minimum": 0 },
                                "end": { "type": "number", "minimum": 0 }
                            },
                            "required": ["start", "end"]
                        }
                    },
                    "manifestPath": { "type": "string" },
                    "outputDir": { "type": "string" },
                    "force": { "type": "boolean" },
                    "cache": { "type": "boolean" }
                }
            }),
        },
        ToolDef {
            name: "apply_command",
            description: "提交一条可序列化剪辑命令。支持 project.rename、project.output、track.*、asset.*、clip.*（含 clip.append / clip.duplicate / clip.ripple_delete）；baseRevision 来自最近的 get_project，或上一条命令返回的 revision。多条命令请用 apply_commands。",
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
            name: "apply_commands",
            description: "批量提交多条剪辑命令；每条自动使用同一个 baseRevision。注意：逐条应用，任意一条失败即停并返回第几条（已成功的不会回滚）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "commands": {
                        "type": "array",
                        "items": { "type": "object" },
                        "description": "Command 数组；baseRevision 可省略，由工具统一注入"
                    },
                    "baseRevision": { "type": "integer", "minimum": 0, "description": "省略则读取当前 revision" },
                    "label": { "type": "string", "description": "整批操作的撤销/活动流标签" }
                },
                "required": ["commands"]
            }),
        },
    ]
}

/// 技能文档（系统提示里的索引）：与桌面 `tools.rs` 同一份 SKILL.md。
pub const SKILL_DOCS: &[(&str, &str)] = &[
    ("", include_str!("../../../skills/aicut/SKILL.md")),
    (
        "pipeline",
        include_str!("../../../skills/aicut/references/pipeline.md"),
    ),
    (
        "frameworks",
        include_str!("../../../skills/aicut/references/frameworks.md"),
    ),
    (
        "storyboard",
        include_str!("../../../skills/aicut/references/storyboard.md"),
    ),
    (
        "ai",
        include_str!("../../../skills/aicut/references/ai-features.md"),
    ),
    (
        "review",
        include_str!("../../../skills/aicut/references/review.md"),
    ),
    (
        "timeline",
        include_str!("../../../skills/aicut/references/timeline.md"),
    ),
    (
        "assets",
        include_str!("../../../skills/aicut/references/assets.md"),
    ),
    (
        "workflow",
        include_str!("../../../skills/aicut/references/workflow.md"),
    ),
    (
        "render",
        include_str!("../../../skills/aicut/references/render.md"),
    ),
];

/// 能力域索引（与桌面 `TOPICS` 同一份）。
const TOPICS: &[&str] = &[
    "pipeline",
    "frameworks",
    "storyboard",
    "ai",
    "review",
    "timeline",
    "assets",
    "workflow",
    "render",
];

/// 渐进式披露：`topic` 为空返回索引，未知 topic 附带可选清单。
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

/// 当前工程路径（`save_project` 省略 path 时用）。
///
/// 无头进程里只有一个工程，用一个进程级槽位足够；桌面壳那边路径存在 store 里。
fn project_path_slot() -> &'static std::sync::Mutex<Option<String>> {
    static SLOT: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
        std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(None))
}

fn set_current_project_path(path: Option<String>) {
    if let Ok(mut slot) = project_path_slot().lock() {
        *slot = path;
    }
}

fn current_project_path() -> Option<String> {
    project_path_slot()
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
}

/// 当前可用的工具名（诊断 / 前端提示用）。
pub const TOOLS: &[&str] = &[
    "get_project",
    "get_context",
    "get_clip",
    "get_track",
    "find_clips",
    "get_assets",
    "get_markers",
    "apply_command",
    "apply_commands",
    "measure_loudness",
    "process_video",
    "list_ai_models",
    "probe_media",
    "denoise_audio",
    "process_audio",
    "transcribe",
    "cut_filler_words",
    "separate_stems",
    "translate_audio",
    "synthesize_voiceover",
    "upscale_video",
    "interpolate_video",
    "reframe_video",
    "append_clip",
    "set_clip_speed",
    "set_clip_color",
    "set_clip_transition",
    "set_clip_keyframes",
    "duplicate_clips",
    "ripple_delete",
    "add_marker",
    "update_marker",
    "remove_marker",
    "import_asset",
    "undo",
    "redo",
    "new_project",
    "open_project",
    "save_project",
    "board_list_canvases",
    "board_get_canvas",
    "board_create_canvas",
    "board_delete_canvas",
    "board_rename_canvas",
    "board_open_canvas",
    "board_apply_ops",
    "workflow_publish",
    "workflow_list",
    "workflow_run",
    "aicut_help",
    "cancel_ai",
    "download_model",
    "extract_audio",
    "import_subtitles",
    "export_subtitles",
    "export_video",
    "render_frame",
    "render_range",
    "render_status",
    "add_review_note",
    "list_review_notes",
    "update_review_note",
    "remove_review_note",
    "import_film_manifest",
    "export_film_manifest",
    "job_start",
    "job_status",
    "job_cancel",
    "render_storyboard",
    "render_contact_sheet",
    "compare_takes",
    "render_manifest",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_tools_are_rejected_explicitly() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let doc = DocHandle::spawn();
        let host: std::sync::Arc<dyn Host> = std::sync::Arc::new(crate::HeadlessHost::new(
            std::env::temp_dir().join("aicut-agent-tools-test"),
            std::env::temp_dir().join("aicut-agent-tools-test"),
        ));
        let video = std::sync::Arc::new(crate::video_dsp::VideoDspState::default());
        let error = rt
            .block_on(dispatch(&doc, &host, &video, "upscale", json!({}), None))
            .expect_err("未实现的工具必须报错");
        assert!(error.contains("§12"), "{error}");
    }

    #[test]
    fn document_tools_are_listed() {
        assert!(TOOLS.contains(&"apply_command"));
        assert!(TOOLS.contains(&"get_clip"));
        // 画布 / 工作流工具与桌面版同名：读工具可无头执行，写工具明确报错。
        assert!(TOOLS.contains(&"board_list_canvases"));
        assert!(TOOLS.contains(&"workflow_publish"));
    }

    #[test]
    fn desktop_only_tools_explain_the_limit() {
        for tool in [
            "board_create_canvas",
            "board_apply_ops",
            "workflow_publish",
            "workflow_run",
        ] {
            let message = desktop_only(tool);
            assert!(message.contains(tool), "{message}");
            assert!(message.contains("渲染进程"), "{message}");
            assert!(message.contains("§12"), "{message}");
        }
    }

    #[test]
    fn signature_ports_read_workflow_signatures() {
        let nodes = json!([
            {
                "id": "s",
                "type": "workflow.start",
                "data": {
                    "signature": {
                        "inputs": [{ "id": "in-a", "name": "prompt", "label": "提示词", "type": "text" }],
                        "outputs": []
                    }
                }
            },
            {
                "id": "e",
                "type": "workflow.end",
                "data": {
                    "signature": {
                        "inputs": [],
                        "outputs": [{ "id": "out-a", "name": "result", "label": "结果", "type": "image" }]
                    }
                }
            }
        ]);
        let list = nodes.as_array().cloned().unwrap_or_default();
        let inputs = signature_ports(&list, "workflow.start", "inputs");
        assert_eq!(inputs.len(), 1);
        assert_eq!(inputs[0]["name"], "prompt");
        assert_eq!(inputs[0]["type"], "text");
        let outputs = signature_ports(&list, "workflow.end", "outputs");
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0]["name"], "result");
    }

    #[test]
    fn active_canvas_falls_back_to_first_board() {
        let snapshot = json!({
            "boards": [
                { "id": "canvas-b", "title": "B", "doc": { "nodes": [], "edges": [] } },
                { "id": "canvas-a", "title": "A", "doc": { "nodes": [], "edges": [] } }
            ],
            "activeBoardId": "missing"
        });
        assert_eq!(active_canvas_id(&snapshot), "canvas-b");
    }
}
