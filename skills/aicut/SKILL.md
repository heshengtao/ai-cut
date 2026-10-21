---
name: aicut
description: AI 视频生产总入口——需求拆解、框架选型、分镜设计、素材生成、导入 AI Cut 剪辑、自动字幕/翻译/配音、人审与导出；同时通过内嵌 MCP 工具或 aicut 命令行读取工程、导入素材、增删轨道与片段、裁剪/移动/分割、调整文字与画面属性、撤销重做。凡用户要求做视频、剪辑、插入素材、调整时间线、加字幕或配音、批量修改片段时使用。
license: Apache-2.0
---

# AI Cut：AI 视频生产与时间线操作

这是能力包入口。本文件只给公共约定、路由和索引；动手前按任务加载 `references/` 下的能力域。

## 两条工作线

| 工作线 | 内容 | 入口 |
| --- | --- | --- |
| **生产** | 需求 → 调研 → 选框架 → 剧本/分镜 → 素材 → 粗剪 → 精剪 → 字幕/配音 → 人审 → 导出 | `references/pipeline.md` |
| **执行** | 读工程、导素材、改时间线、撤销重做 | 本文件的 MCP / CLI 部分 |

**先判断任务属于哪条线。** 用户说「帮我做一条视频」时，不要直接开始 `clip.add`；先走生产流程的 Gate 0，把 brief 和交付规格定下来。用户说「把这段往后挪 2 秒」时，直接走执行线的 `get_project` → `apply_command`。

## 最重要的边界

MCP 只暴露 6 个工具：`get_project` / `apply_command` / `import_asset` / `undo` / `redo` / `aicut_help`。

以下能力**不在 MCP 工具面**，必须在 AI Cut 应用界面里由人触发：

- 一键生成字幕（本地 ASR）
- 字幕翻译 / 译制配音
- AI 朗读（本地 TTS / 云端 TTS）
- 音频 AI：降噪、人声分离、响度测量、DSP
- 视频 AI：超分、补帧、智能重构；视频稳定/去噪/去闪烁/动态模糊
- 最终导出

智能体能做的是：准备素材与文字片段、搭好轨道、给出精确的界面操作清单、等人操作后重新 `get_project` 继续剪。**不要假装自己能直接生成字幕或导出。**

## 前提

- AI Cut 需要在运行。走 CLI 时先 `aicut status`，没开就 `aicut start`。
- 所有写操作都走与界面同一条命令总线：进入撤销历史，界面实时更新。
- 先 `get_project` 拿 `revision` 和 id，再 `apply_command`；`baseRevision` 过期会被拒绝。

## 三条入口

1. **逐个 MCP 工具**：`get_project` / `apply_command` / `import_asset` / `undo` / `redo` / `aicut_help`。
2. **网关**：`apply_command` 用「命令 + JSON payload」执行所有剪辑操作；`aicut_help(topic)` 按域取文档。
3. **命令行**：`aicut` 是 MCP 的薄客户端，命令面 = 工具面。

### 定位 App 与 CLI（不用搜索）

Bundle id 是 **`com.aicut.app`**，配置目录由它推导：

| 平台 | 配置目录 |
| --- | --- |
| macOS | `~/Library/Application Support/com.aicut.app/` |
| Linux | `~/.config/com.aicut.app/` |
| Windows | `%APPDATA%\com.aicut.app\` |

目录里有两个运行时文件（App 每次启动重写）：

- `cli-path`：包内 `aicut` 的绝对路径。读到就直接用，不需要 PATH。
- `mcp-url`：MCP 的 HTTP 端点（App 运行时才有）。

按顺序找：`command -v aicut` → `<配置目录>/cli-path` → 启动 App 后重试。

### CLI

```bash
aicut status
aicut start
aicut call get_project
aicut call apply_command --json '{"command":{"kind":"track.add","payload":{"index":0},"baseRevision":0}}'
aicut tools
```

## 工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `get_project` | — | 返回 `{revision, project}`；先读它拿 id 和 revision |
| `apply_command` | `command` | 执行一条可序列化命令，见下 |
| `import_asset` | `path`, `name?` | 探测媒体并加入素材库 |
| `undo` / `redo` | — | 撤销 / 重做 |
| `aicut_help` | `topic?` | 取能力域文档；留空给索引 |

## 命令

```json
{
  "kind": "clip.add",
  "baseRevision": 12,
  "payload": { "...": "..." },
  "label": "插入 B-roll",
  "actor": "agent"
}
```

常用 kind：

| kind | payload |
| --- | --- |
| `project.rename` | `{ name }` |
| `project.output` | `{ width?, height?, fps? }` |
| `track.add` | `{ index? }`（index 0 = 最上层；省略 = 追加到最底层） |
| `track.update` | `{ trackId, patch: { muted?, visible?, locked? } }` |
| `track.remove` | `{ trackId }` |
| `track.move` | `{ trackId, toIndex }` |
| `asset.add` | `{ asset }` |
| `asset.remove` | `{ assetId }` |
| `asset.update` | `{ assetId, patch }` |
| `clip.add` | `{ trackId, clip: { assetId, start, duration, in? } }` |
| `clip.update` | `{ clipId, patch }` |
| `clip.remove` | `{ clipIds }` |
| `clip.move` | `{ clipIds, delta, targetTrackId? }` |
| `clip.trim` | `{ clipId, edge: "start"\|"end", time }` |
| `clip.split` | `{ clipIds, at }` |

约束：

- 时间单位是秒；片段不能在同轨重叠。
- `clip.add` 的 `id` 可省略，会自动生成；`trackId` 必须存在。
- 文本片段的 `assetId` 是空字符串 `""`，用 `clip.update` 的 `patch.text` 改文案。
- 轨道名由 App 自动生成，MCP 建轨不能指定名字；**用 `get_project` 返回的 1 起始 `index` 定位轨道**，不要依赖名字。
- `track.add` 的 `index` 是 **0 基插入位**（0 = 插到最上层），`get_project` 的 `index` 是 **1 基展示号**，两者相差 1。
- 一次命令 = 一个撤销步骤；批量修改请拆成清晰的命令。

## 全流程速查

| 阶段 | 目标 | 产物 | 人审 Gate | 细则 |
| --- | --- | --- | --- | --- |
| 0 需求 | 定目标、平台、时长、画幅、调性、预算与边界 | `brief.md` | **G0 确认 brief** | `pipeline.md` |
| 1 调研 | 找参考片、视觉基准、素材与版权来源 | `research.md` | — | `pipeline.md` |
| 2 选型 | 选渲染框架、生成模型、音频链路、剪辑路径 | `tech-plan.md` | **G1 确认路线与成本** | `frameworks.md` |
| 3 剧本/分镜 | 旁白稿、镜头表、节奏与字幕规划 | `script.md` / `storyboard.csv` | **G2 确认分镜** | `storyboard.md` |
| 4 素材 | 实拍收集、关键帧、图生视频、代码渲染、TTS/BGM/SFX | `assets/` + `manifest.json` | **G3 看素材 selects** | `storyboard.md` |
| 5 导入/粗剪 | 建工程规格、导素材、搭轨、放主叙事 | AI Cut 工程 | **G4 看粗剪** | `pipeline.md` |
| 6 精剪 | 节奏、裁剪、分割、叠加、文字与画面属性 | 锁定画面 | **G5 picture lock** | `timeline.md` |
| 7 字幕/配音 | ASR 字幕、翻译、AI 朗读、对齐修正 | 字幕轨 + 朗读轨 | **G6 字幕/声音审** | `ai-features.md` |
| 8 增强 | 降噪、分离、响度、超分、补帧、竖屏重构 | 处理后的素材 | **G7 技术 QC** | `ai-features.md` |
| 9 人审 | 故事、节奏、可读性、声音、版权、平台规格 | `review-*.md` | **G8 签收** | `review.md` |
| 10 导出 | MP4 / ProRes / GIF，校验并归档 | 成片 + 工程 + 清单 | **G9 交付** | `review.md` |

**每个 Gate 都要停下来等人确认。** 不要一口气从 brief 干到 export；「AI 剪，人审片」是这个产品的定位。

## 能力域（按需加载）

| 域 | 加载 | 覆盖 |
| --- | --- | --- |
| 全流程 | `references/pipeline.md` | 十阶段 playbook、产物、命令、Gate、自动化边界 |
| 框架选型 | `references/frameworks.md` | Remotion / HyperFrames / Three.js / Manim / Blender / 生成式模型 / 音频 / skills 地图 / 许可证 |
| 分镜与素材 | `references/storyboard.md` | brief、剧本、镜头表、时长公式、提示词、字幕与音频规格 |
| AI 能力 | `references/ai-features.md` | 本地 ASR/TTS、翻译配音、音频 AI、视频 AI、模型管理、导出 |
| 人审与导出 | `references/review.md` | 审片清单、时间码反馈、验收标准、平台规格、归档 |
| 时间线 | `references/timeline.md` | 轨道、片段、移动/裁剪/分割 |
| 素材 | `references/assets.md` | 导入、探测、素材引用 |
| 工作流 | `references/workflow.md` | 读工程 → 改时间线 → 验证 → 撤销 |

## 约定与坑

- **先读后写**：`get_project` 的 id 才是真相；写完再读一次确认。
- **不要猜 revision**：每次写操作都用最近一次 `get_project` 的 revision。失败就重读，不要重试旧命令。
- **同轨不重叠**：插入前先看已有片段，必要时顺延或换轨。
- **宁可多条小命令**：一条命令一个撤销步，人更容易审阅。
- **轨道顺序**：`index 0` 是最上层。建多层画面时从底层往上建，每加一层用 `index: 0`；音轨顺序不影响混音。
- **字幕与转场尚未建模**：字幕 = 文字片段轨道；转场只能用淡入淡出、叠加与变换近似。不要承诺不存在的字幕文件或转场类型。
- **AI 功能是界面能力**：字幕、翻译、朗读、音频/视频 AI、导出都需要人在 App 里点。智能体负责准备与验收。
- **版权与许可证**：生成模型、素材库、字体、音乐、Remotion 商用许可都有条款；在 `research.md` / `manifest.json` 里记录来源与许可证。
- **不要凭搜索结果编造 API**：框架能力以官方仓库/文档为准；版本与可用性会变，执行前先核对。
