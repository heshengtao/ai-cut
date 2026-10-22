//! 剪辑工具面：MCP 服务器与内置剪辑智能体共用同一套定义与执行逻辑。
//!
//! 写操作统一转成前端命令总线的 `Command`，因此和界面操作一样进入撤销历史。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::analysis::{self, ObjectMode, ProbeOptions};
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
            description: "读取工程概览与 revision：只返回规格、轨道摘要与素材数量，不含片段/素材明细。按关注点继续读 get_context / get_track / find_clips / get_clip / get_assets。写操作前先调用它拿 revision。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "get_context",
            description: "读取用户当前关注点：播放头、是否在播放、选中的片段与活跃轨道。适合处理“这里”“选中的片段”这类指令。",
            parameters: json!({ "type": "object", "properties": {} }),
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
            name: "get_clip",
            description: "读取单个片段的完整属性、所在轨道、素材信息与前后邻居。",
            parameters: json!({
                "type": "object",
                "properties": { "clipId": { "type": "string" } },
                "required": ["clipId"]
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
            name: "list_ai_models",
            description: "列出本地 AI 模型。可按 feature 过滤：asr / vad / tts / tts-codec / enhance / separate / superres / interpolate / track / reframe。",
            parameters: json!({
                "type": "object",
                "properties": { "feature": { "type": "string" } }
            }),
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
            name: "denoise_audio",
            description: "用 LocalVQE 对片段做 AI 降噪；视频片段会保留画面、把处理后音频放到新轨。",
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
            name: "process_audio",
            description: "无模型音频 DSP：降噪（effect=denoise）或人声美化（effect=beautify）。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "effect": { "enum": ["denoise", "beautify"] },
                    "preset": {
                        "enum": ["light", "medium", "strong", "natural", "bright", "warm"]
                    }
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
            description: "Real-ESRGAN 视频超分（2x / 4x），用结果替换原片段。",
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
            name: "export_video",
            description: "导出时间线。outputPath 可省略：省略时写到工程所在目录（未保存的工程写到下载目录），文件名取工程名并自动去重，返回值里会给出最终 path。format/resolution/quality 等参数照常可用。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "outputPath": { "type": "string", "description": "可选；目标绝对路径，扩展名要与 format 匹配（mp4 / mov / gif）" },
                    "outputDir": { "type": "string", "description": "可选；只给目录时按工程名生成文件名" },
                    "format": { "enum": ["mp4", "prores", "gif"] },
                    "resolution": {
                        "enum": ["project", "1080p", "720p", "custom"],
                        "description": "默认 project；给出 width/height 时自动按 custom 处理"
                    },
                    "width": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "height": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "fit": {
                        "enum": ["contain", "cover"],
                        "description": "contain 加边（默认）；cover 裁切填满"
                    },
                    "fitAnchor": {
                        "enum": [
                            "top-left", "top", "top-right",
                            "left", "center", "right",
                            "bottom-left", "bottom", "bottom-right"
                        ],
                        "description": "cover 时保留的画面区域，默认 center"
                    },
                    "fps": { "type": "integer", "description": "省略则跟随工程；GIF 省略则为 15" },
                    "quality": { "enum": ["high", "standard", "small"] },
                    "gif": {
                        "type": "object",
                        "description": "仅 GIF 生效",
                        "properties": {
                            "colors": { "type": "integer", "minimum": 2, "maximum": 256 },
                            "dither": { "enum": ["sierra2_4a", "bayer", "floyd_steinberg", "none"] },
                            "loop": {
                                "type": "integer",
                                "minimum": -1,
                                "description": "0 = 无限，-1 = 不循环"
                            }
                        }
                    }
                }
            }),
        },
        ToolDef {
            name: "render_frame",
            description: "渲染时间线在指定时间的一帧到 PNG；复用导出滤镜，包含轨道叠加与文字。支持 width/height 自定义尺寸与 fit 适配。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "minimum": 0 },
                    "outputPath": { "type": "string", "description": "目标 .png 绝对路径" },
                    "resolution": {
                        "enum": ["project", "1080p", "720p", "custom"],
                        "description": "给出 width/height 时自动按 custom 处理"
                    },
                    "width": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "height": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "fit": { "enum": ["contain", "cover"] },
                    "fitAnchor": {
                        "enum": [
                            "top-left", "top", "top-right",
                            "left", "center", "right",
                            "bottom-left", "bottom", "bottom-right"
                        ],
                        "description": "cover 时保留的画面区域，默认 center"
                    },
                    "fps": { "type": "number", "description": "省略则跟随工程" }
                },
                "required": ["time", "outputPath"]
            }),
        },
        ToolDef {
            name: "render_storyboard",
            description: "按多个时间点连续渲染 PNG 到目录，用于快速自检时间线（frame-001.png…）。支持 width/height 自定义尺寸与 fit 适配。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "times": {
                        "type": "array",
                        "items": { "type": "number", "minimum": 0 },
                        "minItems": 1
                    },
                    "outputDir": { "type": "string" },
                    "prefix": { "type": "string", "description": "默认 frame" },
                    "resolution": {
                        "enum": ["project", "1080p", "720p", "custom"],
                        "description": "给出 width/height 时自动按 custom 处理"
                    },
                    "width": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "height": { "type": "integer", "minimum": 16, "maximum": 8192 },
                    "fit": { "enum": ["contain", "cover"] },
                    "fitAnchor": {
                        "enum": [
                            "top-left", "top", "top-right",
                            "left", "center", "right",
                            "bottom-left", "bottom", "bottom-right"
                        ],
                        "description": "cover 时保留的画面区域，默认 center"
                    },
                    "fps": { "type": "number" }
                },
                "required": ["times", "outputDir"]
            }),
        },
        ToolDef {
            name: "cancel_ai",
            description: "取消当前正在运行的同步 AI 任务（转写 / 分离 / 配音 / 视频 AI / 导出 / 模型下载）。",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "job_start",
            description: "异步启动 AI 任务并立即返回 jobId，不阻塞；用 job_status 轮询进度与结果。适合长时间导出、转写、视频 AI。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "kind": {
                        "enum": [
                            "transcribe", "separate", "denoise", "process_audio",
                            "loudness", "translate", "voiceover", "upscale",
                            "interpolate", "reframe", "process_video", "export",
                            "download_model"
                        ]
                    },
                    "params": { "type": "object", "description": "与同步工具相同的参数" }
                },
                "required": ["kind"]
            }),
        },
        ToolDef {
            name: "job_status",
            description: "查询异步 AI 任务的状态、进度、结果或错误。",
            parameters: json!({
                "type": "object",
                "properties": { "jobId": { "type": "string" } },
                "required": ["jobId"]
            }),
        },
        ToolDef {
            name: "job_cancel",
            description: "取消异步 AI 任务；省略 jobId 时取消当前任务。",
            parameters: json!({
                "type": "object",
                "properties": { "jobId": { "type": "string" } }
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
            description: "原子批量提交多条剪辑命令：全部成功才提交，一次 revision、一个撤销步；任意一条失败则整批不生效。每条命令自动使用同一个 baseRevision。",
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
            name: "set_clip_mask",
            description: "设置/移除静态蒙版（矩形/椭圆/线性渐变）。坐标与尺寸按画面归一化到 0..1；只对视频/图片生效。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "remove": { "type": "boolean", "description": "true 时移除蒙版" },
                    "shape": { "enum": ["rect", "ellipse", "linear"] },
                    "x": { "type": "number", "minimum": 0, "maximum": 1 },
                    "y": { "type": "number", "minimum": 0, "maximum": 1 },
                    "width": { "type": "number", "minimum": 0.01, "maximum": 1 },
                    "height": { "type": "number", "minimum": 0.01, "maximum": 1 },
                    "feather": { "type": "number", "minimum": 0, "maximum": 0.5 },
                    "angle": { "type": "number", "minimum": 0, "maximum": 360 },
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
            description: "设置/清空某个属性的关键帧。property: opacity / x / y / scale / rotation；时间相对片段起点。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "property": { "enum": ["opacity", "x", "y", "scale", "rotation"] },
                    "remove": { "type": "boolean" },
                    "keyframes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "time": { "type": "number", "minimum": 0 },
                                "value": { "type": "number" }
                            },
                            "required": ["time", "value"]
                        }
                    },
                    "baseRevision": { "type": "integer", "minimum": 0 }
                },
                "required": ["clipId", "property"]
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
            name: "new_project",
            description: "新建工程并替换当前工程。直接执行，不会弹保存/打开对话框，也不需要操作界面；当前工程会先进入工程历史。",
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
            description: "打开工程文件并替换当前工程。直接读 JSON，不会弹文件框；当前工程会先进入工程历史。",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "工程 .json 绝对路径" } },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "save_project",
            description: "保存当前工程到原路径或指定路径。直接写 JSON，不会弹保存对话框；未保存过且未给 path 时才失败。",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "目标 .json 绝对路径" } }
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
            name: "probe_media",
            description: "一次调用了解素材内容：ffprobe 元数据 + 按时间的运动采样与候选切点 + 可选目标框 + 可选语音转写。优先用它代替逐帧 render_frame 看图。objects 需要已安装 YuNet（face）或 YOLOX（person）模型；transcript 需要已安装 ASR + silero-vad。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "本机媒体绝对路径" },
                    "motion": { "type": "boolean", "description": "返回运动采样与切点，默认 true" },
                    "objects": {
                        "enum": ["none", "face", "person", "auto"],
                        "description": "目标框类型，默认 none"
                    },
                    "transcript": { "type": "boolean", "description": "同时做本地语音转写，默认 false" },
                    "interval": {
                        "type": "number",
                        "minimum": 0.25,
                        "maximum": 600,
                        "description": "采样间隔（秒），默认 2"
                    },
                    "maxSamples": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 300,
                        "description": "最多采样多少帧，默认 60"
                    },
                    "modelId": { "type": "string", "description": "指定 ASR 模型；省略时用第一个已安装的" }
                },
                "required": ["path"]
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
                    "offset": { "type": "number", "description": "整体时间偏移（秒）" },
                    "baseRevision": { "type": "integer", "minimum": 0 }
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
            name: "add_marker",
            description: "在时间线指定时间添加标记；name 省略时自动命名。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "minimum": 0 },
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "#rrggbb" },
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

/// 取当前 revision。只请求 revision，不拉整份工程。
async fn current_revision(bridge: &ProjectBridge) -> Result<u64, String> {
    let snapshot = bridge.request("project.revision", json!({})).await?;
    snapshot
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "工程快照缺少 revision".to_string())
}

async fn base_revision(bridge: &ProjectBridge, args: &Value) -> Result<u64, String> {
    match args.get("baseRevision").and_then(Value::as_u64) {
        Some(value) => Ok(value),
        None => current_revision(bridge).await,
    }
}

/// 给命令补齐 actor / sessionId / id / timestamp / label。
fn prepare_command(actor: &str, args: &Value) -> Result<Value, String> {
    let command = args
        .get("command")
        .cloned()
        .ok_or_else(|| "缺少 command".to_string())?;
    prepare_command_value(actor, command)
}

fn prepare_command_value(actor: &str, mut command: Value) -> Result<Value, String> {
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

fn macro_label(kind: &str) -> &'static str {
    match kind {
        "clip.append" => "追加片段",
        "clip.duplicate" => "复制片段",
        "clip.ripple_delete" => "波纹删除",
        "clip.speed" => "变速",
        "clip.color" => "调色",
        "clip.mask" => "蒙版",
        "clip.transition" => "转场",
        "clip.keyframes" => "关键帧",
        "marker.add" => "添加标记",
        "marker.update" => "修改标记",
        "marker.remove" => "删除标记",
        _ => "剪辑操作",
    }
}

/// 把宏工具的参数转成一条命令；`baseRevision` 不进入 payload。
async fn apply_macro(
    bridge: &ProjectBridge,
    actor: &str,
    kind: &str,
    args: &Value,
) -> Result<Value, String> {
    let mut payload = args.clone();
    if let Some(object) = payload.as_object_mut() {
        object.remove("baseRevision");
    }
    let base = base_revision(bridge, args).await?;
    let command = json!({
        "kind": kind,
        "payload": payload,
        "baseRevision": base,
        "label": macro_label(kind),
    });
    let command = prepare_command_value(actor, command)?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 调色参数是扁平的，收进 `patch` 后复用 clip.color 命令。
async fn apply_clip_color(
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let clip_id = args
        .get("clipId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 clipId".to_string())?;

    let mut patch = serde_json::Map::new();
    for key in ["brightness", "contrast", "saturation", "temperature", "tint"] {
        if let Some(value) = args.get(key) {
            patch.insert(key.to_string(), value.clone());
        }
    }

    let base = base_revision(bridge, args).await?;
    let command = prepare_command_value(
        actor,
        json!({
            "kind": "clip.color",
            "payload": { "clipId": clip_id, "patch": patch },
            "baseRevision": base,
            "label": macro_label("clip.color"),
        }),
    )?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 关键帧传数组；remove 时传 null 清空该属性。
async fn apply_clip_keyframes(
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let clip_id = args
        .get("clipId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 clipId".to_string())?;
    let property = args
        .get("property")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少 property".to_string())?;
    let keyframes = if args.get("remove").and_then(Value::as_bool) == Some(true) {
        Value::Null
    } else {
        args.get("keyframes")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()))
    };

    let base = base_revision(bridge, args).await?;
    let command = prepare_command_value(
        actor,
        json!({
            "kind": "clip.keyframes",
            "payload": { "clipId": clip_id, "property": property, "keyframes": keyframes },
            "baseRevision": base,
            "label": macro_label("clip.keyframes"),
        }),
    )?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 转场参数是扁平的，收进 transition 对象；remove 时传 null。
async fn apply_clip_transition(
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let clip_id = args
        .get("clipId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 clipId".to_string())?;
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

    let base = base_revision(bridge, args).await?;
    let command = prepare_command_value(
        actor,
        json!({
            "kind": "clip.transition",
            "payload": { "clipId": clip_id, "edge": edge, "transition": transition },
            "baseRevision": base,
            "label": macro_label("clip.transition"),
        }),
    )?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 蒙版参数是扁平的，`remove: true` 时传 null。
async fn apply_clip_mask(
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let clip_id = args
        .get("clipId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 clipId".to_string())?;

    let mask = if args.get("remove").and_then(Value::as_bool) == Some(true) {
        Value::Null
    } else {
        let mut mask = serde_json::Map::new();
        for key in ["shape", "x", "y", "width", "height", "feather", "angle"] {
            if let Some(value) = args.get(key) {
                mask.insert(key.to_string(), value.clone());
            }
        }
        Value::Object(mask)
    };

    let base = base_revision(bridge, args).await?;
    let command = prepare_command_value(
        actor,
        json!({
            "kind": "clip.mask",
            "payload": { "clipId": clip_id, "mask": mask },
            "baseRevision": base,
            "label": macro_label("clip.mask"),
        }),
    )?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 标记更新需要把扁平参数收进 `patch`，和其他命令保持同样的 payload 形状。
async fn apply_marker_update(
    bridge: &ProjectBridge,
    actor: &str,
    args: &Value,
) -> Result<Value, String> {
    let marker_id = args
        .get("markerId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 markerId".to_string())?;

    let mut patch = serde_json::Map::new();
    for key in ["time", "name", "color"] {
        if let Some(value) = args.get(key) {
            patch.insert(key.to_string(), value.clone());
        }
    }

    let base = base_revision(bridge, args).await?;
    let command = prepare_command_value(
        actor,
        json!({
            "kind": "marker.update",
            "payload": { "markerId": marker_id, "patch": patch },
            "baseRevision": base,
            "label": macro_label("marker.update"),
        }),
    )?;
    let result = bridge
        .request("project.apply", json!({ "command": command }))
        .await?;
    ensure_ok(result)
}

/// 批量命令：统一注入同一个 baseRevision，由前端一次性提交。
async fn apply_batch(bridge: &ProjectBridge, actor: &str, args: &Value) -> Result<Value, String> {
    let raw = args
        .get("commands")
        .and_then(Value::as_array)
        .ok_or_else(|| "缺少 commands 数组".to_string())?;
    if raw.is_empty() {
        return Err("commands 不能为空".into());
    }
    if raw.len() > 200 {
        return Err("一次最多应用 200 条命令".into());
    }

    let base = base_revision(bridge, args).await?;
    let label = args
        .get("label")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("批量剪辑");

    let mut commands = Vec::with_capacity(raw.len());
    for value in raw {
        let mut command = value.clone();
        let object = command
            .as_object_mut()
            .ok_or_else(|| "每条 command 必须是对象".to_string())?;
        object.insert("baseRevision".into(), json!(base));
        if !object
            .get("label")
            .and_then(Value::as_str)
            .map(|text| !text.is_empty())
            .unwrap_or(false)
        {
            object.insert("label".into(), json!(label));
        }
        commands.push(prepare_command_value(actor, command)?);
    }

    let result = bridge
        .request(
            "project.apply_batch",
            json!({ "commands": commands, "label": label }),
        )
        .await?;
    ensure_ok(result)
}

pub async fn dispatch(
    app: &AppHandle,
    bridge: &ProjectBridge,
    actor: &str,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    dispatch_with_cancel(app, bridge, actor, name, args, None).await
}

/// `cancel` 只由内置智能体传入（MCP / CLI 是同步调用，没有回合取消的概念）。
pub async fn dispatch_with_cancel(
    app: &AppHandle,
    bridge: &ProjectBridge,
    actor: &str,
    name: &str,
    args: Value,
    cancel: Option<&CancellationToken>,
) -> Result<Value, String> {
    match name {
        // 读取：只取当前关注的那一片，不在工具层拉整份工程。
        "get_project" => bridge.request("project.overview", json!({})).await,
        "get_context" => bridge.request("project.context", json!({})).await,
        "get_track" => bridge.request("project.track", args).await,
        "get_clip" => bridge.request("project.clip", args).await,
        "find_clips" => bridge.request("project.find_clips", args).await,
        "get_assets" => bridge.request("project.assets", args).await,
        "get_markers" => bridge.request("project.markers", args).await,

        // 写入：单条 / 批量 / 确定性宏 / 工程生命周期。
        "apply_command" => {
            let command = prepare_command(actor, &args)?;
            let result = bridge
                .request("project.apply", json!({ "command": command }))
                .await?;
            ensure_ok(result)
        }
        "apply_commands" => apply_batch(bridge, actor, &args).await,
        "append_clip" => apply_macro(bridge, actor, "clip.append", &args).await,
        "set_clip_speed" => apply_macro(bridge, actor, "clip.speed", &args).await,
        "set_clip_color" => apply_clip_color(bridge, actor, &args).await,
        "set_clip_mask" => apply_clip_mask(bridge, actor, &args).await,
        "set_clip_transition" => apply_clip_transition(bridge, actor, &args).await,
        "set_clip_keyframes" => apply_clip_keyframes(bridge, actor, &args).await,
        "duplicate_clips" => apply_macro(bridge, actor, "clip.duplicate", &args).await,
        "ripple_delete" => apply_macro(bridge, actor, "clip.ripple_delete", &args).await,
        "new_project" => bridge.request("project.new", args).await,
        "open_project" => bridge.request("project.open", args).await,
        "save_project" => bridge.request("project.save", args).await,
        "import_subtitles" => bridge.request("subtitle.import", args).await,
        "export_subtitles" => bridge.request("subtitle.export", args).await,
        "add_marker" => apply_macro(bridge, actor, "marker.add", &args).await,
        "update_marker" => apply_marker_update(bridge, actor, &args).await,
        "remove_marker" => apply_macro(bridge, actor, "marker.remove", &args).await,
        "undo" => {
            let result = bridge.request("project.undo", json!({})).await?;
            ensure_ok(result)
        }
        "redo" => {
            let result = bridge.request("project.redo", json!({})).await?;
            ensure_ok(result)
        }
        "aicut_help" => {
            let topic = args
                .get("topic")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            Ok(Value::String(help(&topic)))
        }
        "extract_audio" => bridge.request("edit.extract_audio", args).await,
        "list_ai_models" => bridge.request("ai.models.list", args).await,
        "cancel_ai" => bridge.request("ai.job.cancel", json!({})).await,
        "job_start" => bridge.request("ai.job.start", args).await,
        "job_status" => bridge.request("ai.job.status", args).await,
        "job_cancel" => bridge.request("ai.job.cancel", args).await,
        "transcribe" => run_ai_job(bridge, "transcribe", args, cancel).await,
        "separate_stems" => run_ai_job(bridge, "separate", args, cancel).await,
        "denoise_audio" => run_ai_job(bridge, "denoise", args, cancel).await,
        "process_audio" => run_ai_job(bridge, "process_audio", args, cancel).await,
        "measure_loudness" => run_ai_job(bridge, "loudness", args, cancel).await,
        "translate_audio" => run_ai_job(bridge, "translate", args, cancel).await,
        "synthesize_voiceover" => run_ai_job(bridge, "voiceover", args, cancel).await,
        "upscale_video" => run_ai_job(bridge, "upscale", args, cancel).await,
        "interpolate_video" => run_ai_job(bridge, "interpolate", args, cancel).await,
        "reframe_video" => run_ai_job(bridge, "reframe", args, cancel).await,
        "process_video" => run_ai_job(bridge, "process_video", args, cancel).await,
        "export_video" => {
            let args = prepare_export_args(bridge, args).await?;
            run_ai_job(bridge, "export", args, cancel).await
        }
        "render_frame" => bridge.request("export.frame", args).await,
        "render_storyboard" => bridge.request("export.storyboard", args).await,
        "download_model" => run_ai_job(bridge, "download_model", args, cancel).await,
        "import_asset" => import_asset(app, bridge, actor, &args).await,
        "probe_media" => probe_media_tool(app, &args).await,
        other => Err(format!("未知工具：{other}")),
    }
}

/// 启动一个前端 AI job 并轮询到完成。单次桥接请求都很短，长任务不会撞上 20 秒超时。
async fn run_ai_job(
    bridge: &ProjectBridge,
    kind: &str,
    params: Value,
    cancel: Option<&CancellationToken>,
) -> Result<Value, String> {
    if cancellation_requested(cancel) {
        return Err("已取消".into());
    }
    let started = bridge
        .request("ai.job.start", json!({ "kind": kind, "params": params }))
        .await?;
    let job_id = started
        .get("jobId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "AI 任务启动失败：缺少 jobId".to_string())?
        .to_string();

    if cancellation_requested(cancel) {
        let _ = bridge
            .request("ai.job.cancel", json!({ "jobId": job_id }))
            .await;
        return Err("已取消".into());
    }

    let mut status_failures = 0;
    loop {
        if sleep_or_cancel(cancel).await {
            let _ = bridge
                .request("ai.job.cancel", json!({ "jobId": job_id }))
                .await;
            return Err("已取消".into());
        }
        let status = match bridge
            .request("ai.job.status", json!({ "jobId": job_id }))
            .await
        {
            Ok(status) => {
                status_failures = 0;
                status
            }
            Err(error) => {
                // webview 偶尔忙一下不该判死；连续失败才认为前端已经失联。
                status_failures += 1;
                if status_failures >= 5 {
                    return Err(error);
                }
                continue;
            }
        };
        match status.get("status").and_then(Value::as_str) {
            Some("done") => return Ok(status.get("result").cloned().unwrap_or(Value::Null)),
            Some("error") => {
                return Err(status
                    .get("error")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .unwrap_or("AI 任务失败")
                    .to_string())
            }
            _ => {}
        }
    }
}

fn cancellation_requested(cancel: Option<&CancellationToken>) -> bool {
    cancel.map(|token| token.is_cancelled()).unwrap_or(false)
}

/// 返回 `true` 表示等待期间被取消。
async fn sleep_or_cancel(cancel: Option<&CancellationToken>) -> bool {
    let wait = tokio::time::sleep(std::time::Duration::from_millis(600));
    if let Some(token) = cancel {
        tokio::select! {
            _ = token.cancelled() => true,
            _ = wait => false,
        }
    } else {
        wait.await;
        false
    }
}

/// 前端命令总线把「版本过期 / 重叠 / payload 非法」编码在 `{ok:false, error}` 里，
/// 而不是 invoke 异常。这里统一翻成工具错误，否则 UI、MCP、CLI 都会把它当成功。
fn ensure_ok(value: Value) -> Result<Value, String> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .unwrap_or("命令执行失败");
        return Err(message.to_string());
    }
    Ok(value)
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

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|value| {
            if value.is_control() || matches!(value, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                value
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        return "export".into();
    }
    trimmed.chars().take(80).collect()
}

fn export_extension(format: Option<&str>, output_path: Option<&str>) -> Result<&'static str, String> {
    match format {
        Some("mp4") => Ok("mp4"),
        Some("prores") => Ok("mov"),
        Some("gif") => Ok("gif"),
        Some(other) => Err(format!("不支持的导出格式：{other}")),
        None => match output_path
            .and_then(|path| Path::new(path).extension())
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("mov") => Ok("mov"),
            Some("gif") => Ok("gif"),
            _ => Ok("mp4"),
        },
    }
}

fn default_output_dir(explicit: Option<&str>, file_path: Option<&str>) -> PathBuf {
    if let Some(dir) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        let dir = PathBuf::from(dir);
        if dir.is_absolute() {
            return dir;
        }
        return std::env::current_dir()
            .map(|cwd| cwd.join(dir))
            .unwrap_or_else(|_| PathBuf::from("."));
    }
    if let Some(file) = file_path {
        if let Some(parent) = Path::new(file).parent() {
            if !parent.as_os_str().is_empty() {
                return parent.to_path_buf();
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        let downloads = home.join("Downloads");
        if downloads.is_dir() {
            return downloads;
        }
        return home;
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn unique_output_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{extension}"));
    let mut index = 2;
    while candidate.exists() && index < 10_000 {
        candidate = dir.join(format!("{stem}-{index}.{extension}"));
        index += 1;
    }
    candidate
}

/// 导出路径可选：省略时写到工程目录（未保存的工程写到下载目录），并自动去重。
async fn prepare_export_args(bridge: &ProjectBridge, mut args: Value) -> Result<Value, String> {
    let (has_path, output_dir, format) = {
        let object = args
            .as_object()
            .ok_or_else(|| "导出参数必须是对象".to_string())?;
        (
            object
                .get("outputPath")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some(),
            object
                .get("outputDir")
                .and_then(Value::as_str)
                .map(str::to_string),
            object
                .get("format")
                .and_then(Value::as_str)
                .map(str::to_string),
        )
    };
    if has_path {
        return Ok(args);
    }

    let extension = export_extension(format.as_deref(), None)?;
    let overview = bridge.request("project.overview", json!({})).await?;
    let name = overview
        .get("project")
        .and_then(|project| project.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("AI Cut 导出");
    let file_path = overview.get("filePath").and_then(Value::as_str);
    let dir = default_output_dir(output_dir.as_deref(), file_path);
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建导出目录失败：{error}"))?;
    let path = unique_output_path(&dir, &sanitize_file_name(name), extension);

    let object = args
        .as_object_mut()
        .ok_or_else(|| "导出参数必须是对象".to_string())?;
    object.insert(
        "outputPath".into(),
        json!(path.to_string_lossy().into_owned()),
    );
    Ok(args)
}

async fn probe_media_tool(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少 path".to_string())?
        .to_string();
    let options = ProbeOptions {
        motion: args.get("motion").and_then(Value::as_bool).unwrap_or(true),
        transcript: args
            .get("transcript")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        objects: ObjectMode::parse(args.get("objects").and_then(Value::as_str))?,
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
    analysis::probe(app, path, options).await
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
    let result = ensure_ok(
        bridge
            .request("project.apply", json!({ "command": command }))
            .await?,
    )?;
    Ok(json!({ "asset": asset, "result": result }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepared_command_gets_agent_metadata() {
        let command = prepare_command_value(
            "mcp-session",
            json!({ "kind": "clip.add", "baseRevision": 3, "payload": {} }),
        )
        .unwrap();
        assert_eq!(command["actor"], "agent");
        assert_eq!(command["sessionId"], "mcp-session");
        assert_eq!(command["baseRevision"], 3);
        assert!(command["id"].as_str().unwrap_or("").len() > 8);
        assert_eq!(command["label"], "剪辑操作");
    }

    #[test]
    fn command_failure_is_surfaced_as_tool_error() {
        let error = ensure_ok(json!({
            "ok": false,
            "revision": 3,
            "error": "命令基于旧版本"
        }))
        .unwrap_err();
        assert!(error.contains("旧版本"));
        assert!(ensure_ok(json!({ "ok": true, "revision": 4 })).is_ok());
    }

    #[test]
    fn tool_names_are_unique_and_include_ai_surface() {
        let names: Vec<&str> = definitions().iter().map(|tool| tool.name).collect();
        let mut unique = names.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), names.len(), "duplicate tool name");

        for required in [
            "get_project",
            "get_context",
            "get_track",
            "get_clip",
            "find_clips",
            "get_assets",
            "apply_command",
            "apply_commands",
            "append_clip",
            "set_clip_speed",
            "set_clip_color",
            "set_clip_mask",
            "set_clip_transition",
            "set_clip_keyframes",
            "duplicate_clips",
            "ripple_delete",
            "new_project",
            "open_project",
            "save_project",
            "import_subtitles",
            "export_subtitles",
            "get_markers",
            "add_marker",
            "update_marker",
            "remove_marker",
            "transcribe",
            "separate_stems",
            "denoise_audio",
            "translate_audio",
            "synthesize_voiceover",
            "upscale_video",
            "interpolate_video",
            "reframe_video",
            "process_video",
            "export_video",
            "probe_media",
            "render_frame",
            "render_storyboard",
            "list_ai_models",
            "download_model",
            "cancel_ai",
            "job_start",
            "job_status",
            "job_cancel",
        ] {
            assert!(names.contains(&required), "missing tool: {required}");
        }
    }

    #[test]
    fn sanitizes_export_file_names() {
        assert_eq!(sanitize_file_name("海边日落"), "海边日落");
        assert_eq!(sanitize_file_name("a/b:c*?"), "a_b_c__");
        assert_eq!(sanitize_file_name("   "), "export");
        assert_eq!(sanitize_file_name(".hidden."), "hidden");
    }

    #[test]
    fn export_extension_follows_format_and_path() {
        assert_eq!(export_extension(Some("mp4"), None).unwrap(), "mp4");
        assert_eq!(export_extension(Some("prores"), None).unwrap(), "mov");
        assert_eq!(export_extension(None, Some("/tmp/out.gif")).unwrap(), "gif");
        assert_eq!(export_extension(None, None).unwrap(), "mp4");
        assert!(export_extension(Some("avi"), None).is_err());
    }

    #[test]
    fn export_paths_are_unique() {
        let dir = std::env::temp_dir().join(format!("aicut-export-{}", now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cut.mp4"), b"x").unwrap();
        let next = unique_output_path(&dir, "cut", "mp4");
        assert_eq!(next.file_name().and_then(|name| name.to_str()), Some("cut-2.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
