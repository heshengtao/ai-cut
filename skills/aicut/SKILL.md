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

## 工具面

智能体可以读工程、改时间线，也可以直接调用本地 AI 与导出：

| 类别 | 工具 |
| --- | --- |
| 读取 | `get_project`（概览）、`get_context`（播放头/选中）、`get_track`（分页读轨）、`get_clip`（单片段）、`find_clips`（按时间/素材/文字检索）、`get_assets`（素材分页）、`get_markers`、`list_ai_models`、`aicut_help` |
| 剪辑 | `apply_command`、`apply_commands`（批量原子）、`append_clip`、`set_clip_speed`、`set_clip_color`、`set_clip_mask`、`set_clip_transition`、`set_clip_keyframes`、`duplicate_clips`、`ripple_delete`、`extract_audio`、`import_asset`、`undo`、`redo` |
| 字幕 | `import_subtitles`、`export_subtitles` |
| 标记 | `add_marker`、`update_marker`、`remove_marker` |
| 工程 | `new_project`、`open_project`、`save_project` |
| 音频 AI | `transcribe`、`translate_audio`、`synthesize_voiceover`、`separate_stems`、`denoise_audio`、`process_audio`、`measure_loudness` |
| 视频 AI | `upscale_video`、`interpolate_video`、`reframe_video`、`process_video` |
| 产出 | `export_video`、`render_frame`、`render_storyboard`、`download_model`、`cancel_ai` |
| 异步任务 | `job_start`、`job_status`、`job_cancel` |

AI 工具默认是同步的：调用后会等到任务结束，期间可以用 `cancel_ai` 或停止按钮中止。模型缺失时先 `list_ai_models` 查 id，再 `download_model`。

需要不阻塞（长导出、转写、视频 AI）时用 `job_start`：立即返回 `jobId`，再用 `job_status` 轮询；`job_cancel` 可取消。当前同一时间只允许一个 AI 任务。

### 渐进式读取（重要）

不要一次读完整个工程。按关注点逐层取：

1. `get_project`：工程规格、轨道摘要、素材数量、`revision`。
2. 用户说“这里 / 选中的片段” → `get_context`：播放头、选中片段、活跃轨道。
3. 要动某条轨 → `get_track(trackId, offset, limit)`；要找一个片段 → `find_clips`（按轨道/素材/文字/时间区间/类型）。
4. 要改一个片段 → `get_clip(clipId)` 拿完整属性与前后邻居。
5. 要选素材 → `get_assets(kind?, name?, offset?, limit?)`；要看章节/批注 → `get_markers`。
6. `apply_command` 写一条；多条用 `apply_commands`。

只读你下一步真正要用的数据。读工程不是越全越好，返回体积会直接挤占上下文。

## 前提

- AI Cut 需要在运行。走 CLI 时先 `aicut status`，没开就 `aicut start`。
- 所有写操作都走与界面同一条命令总线：进入撤销历史，界面实时更新。
- 先 `get_project` 拿 `revision` 和轨道摘要，按需再取片段 / 素材；`baseRevision` 过期会被拒绝。上一条命令、批量命令或 AI 工具的返回值里也有新 `revision`，可以直接接着用，不必每步重读概览。
- `get_project` 永远只返回概览，不返回片段与素材明细；细节用 `get_track` / `find_clips` / `get_clip` / `get_assets` 按需取。

## 三条入口

1. **逐个 MCP 工具**：时间线命令走 `apply_command`，确定性与 AI 动作走各自的工具（见上方工具面）。
2. **网关**：`apply_command` 执行一条「命令 + JSON payload」，`apply_commands` 原子批量执行；`aicut_help(topic)` 按域取文档。
3. **命令行**：`aicut` 是 MCP 的薄客户端，命令面 = 工具面。

### 定位 App 与 CLI（不用搜索）

Bundle id 是 **`com.aicut.editor`**，配置目录由它推导：

| 平台 | 配置目录 |
| --- | --- |
| macOS | `~/Library/Application Support/com.aicut.editor/` |
| Linux | `~/.config/com.aicut.editor/` |
| Windows | `%APPDATA%\com.aicut.editor\` |

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
| `get_project` | — | 概览：`revision`、规格、轨道摘要、素材数量 |
| `get_context` | — | 播放头、播放状态、选中片段、活跃轨道 |
| `get_track` | `trackId`, `offset?`, `limit?` | 分页读一条轨道的片段 |
| `get_clip` | `clipId` | 单片段完整属性、素材与前后邻居 |
| `find_clips` | `trackId?`, `assetId?`, `text?`, `kind?`, `from?`, `to?`, `offset?`, `limit?` | 按关注点检索片段 |
| `get_assets` | `kind?`, `name?`, `offline?`, `offset?`, `limit?` | 分页读素材库 |
| `get_markers` | `from?`, `to?` | 读时间线标记 |
| `import_subtitles` | `path`, `trackName?`, `offset?` | 导入 SRT/VTT 到置顶文字轨 |
| `export_subtitles` | `outputPath`, `trackId?`, `format?` | 从文字片段导出 SRT/VTT |
| `add_marker` | `time`, `name?`, `color?` | 添加标记 |
| `update_marker` | `markerId`, `time?`, `name?`, `color?` | 修改标记 |
| `remove_marker` | `markerId` | 删除标记 |
| `apply_command` | `command` | 执行一条可序列化命令，见下 |
| `apply_commands` | `commands`, `baseRevision?`, `label?` | 原子批量执行；一次 revision、一个撤销步 |
| `append_clip` | `assetId`, `trackId?`, `start?`, `duration?`, `in?` | 追加到轨道末尾，自动建轨/接尾 |
| `duplicate_clips` | `clipIds`, `offset?`, `targetTrackId?` | 复制并偏移；重叠会被拒绝 |
| `ripple_delete` | `clipIds` | 波纹删除并左移同轨后续片段 |
| `new_project` | `name?`, `width?`, `height?`, `fps?` | 新建工程（当前工程进入历史） |
| `open_project` | `path` | 打开工程文件（当前工程进入历史） |
| `save_project` | `path?` | 保存工程；省略路径时存回原路径 |
| `extract_audio` | `clipId`, `trackName?` | 把视频音轨拆到新轨道并静音原片段 |
| `import_asset` | `path`, `name?` | 探测媒体并加入素材库 |
| `undo` / `redo` | — | 撤销 / 重做 |
| `transcribe` | `clipId`/`assetId`, `modelId?`, `language?` | 转写并写入字幕轨 |
| `translate_audio` | `clipId`, `target`, `dub?` | 译文字幕，可选译制配音 |
| `synthesize_voiceover` | `clipIds`/`text`, `modelId?`/`providerId?` | 合成朗读并放回时间线 |
| `separate_stems` | `clipId`, `modelId?` | 人声/音源分离 |
| `denoise_audio` | `clipId`, `modelId?` | LocalVQE 降噪 |
| `process_audio` | `clipId`, `effect`, `preset` | 无模型降噪 / 美化 |
| `measure_loudness` | `clipId`, `targetLufs?`, `apply?` | 测量响度，可写回 gain |
| `upscale_video` / `interpolate_video` / `reframe_video` | `clipId`, … | 超分 / 补帧 / 重构 |
| `process_video` | `clipId`, `options` | 稳定/去噪/去闪烁/动态模糊/放大 |
| `export_video` | `outputPath`, `format?`, `resolution?`, `width?`, `height?`, `fit?`, `fitAnchor?`, `fps?`, `quality?`, `gif?` | 导出到指定路径；支持任意尺寸与裁切 |
| `render_frame` | `time`, `outputPath`, `resolution?`, `width?`, `height?`, `fit?`, `fitAnchor?`, `fps?` | 渲染时间线某一帧到 PNG |
| `render_storyboard` | `times[]`, `outputDir`, `prefix?`, `width?`, `height?`, `fit?`, `fitAnchor?` | 按多个时间点连续输出 PNG |
| `list_ai_models` / `download_model` | `feature?` / `id` | 查模型 / 下载模型 |
| `cancel_ai` | — | 取消当前同步 AI 任务 |
| `job_start` | `kind`, `params?` | 异步启动 AI 任务，立即返回 `jobId` |
| `job_status` | `jobId` | 查询异步任务状态、进度与结果 |
| `job_cancel` | `jobId?` | 取消异步任务；省略时取消当前任务 |
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
| `clip.update` | `{ clipId, patch }`（不允许改 `id` / `trackId`） |
| `clip.remove` | `{ clipIds }` |
| `clip.move` | `{ clipIds, delta, targetTrackId? }` |
| `clip.trim` | `{ clipId, edge: "start"\|"end", time }` |
| `clip.split` | `{ clipIds, at }` |
| `clip.append` | `{ assetId, trackId?, trackName?, start?, duration?, in? }` |
| `clip.speed` | `{ clipId, speed }`（0.1–4） |
| `clip.color` | `{ clipId, patch: { brightness?, contrast?, saturation?, temperature?, tint? } }` |
| `clip.mask` | `{ clipId, mask: { shape, x, y, width, height, feather?, angle? } \| null }` |
| `clip.transition` | `{ clipId, edge: "in"\|"out", transition: { type, duration, direction? } \| null }` |
| `clip.keyframes` | `{ clipId, property, keyframes: [{ time, value }] \| null }` |
| `clip.duplicate` | `{ clipIds, offset?, targetTrackId? }` |
| `clip.ripple_delete` | `{ clipIds }` |
| `subtitle.import` | `{ entries: [{ start, end, text }], trackName?, offset? }` |
| `marker.add` | `{ time, name?, color? }` |
| `marker.update` | `{ markerId, patch: { time?, name?, color? } }` |
| `marker.remove` | `{ markerId }` |

约束：

- 时间单位是秒；片段不能在同轨重叠。
- `trackId` / `targetTrackId` 都可以传轨道 id 或 **1 起始 index**。
- `clip.add` 会校验素材存在、`in + duration` 不越过素材范围、时长大于 0；文字片段（`assetId:""`）不受素材范围限制。
- `clip.update` 是整片段校验：改 `start` / `duration` / `in` 时同样不能重叠、不能越界。
- 文本片段的 `assetId` 是空字符串 `""`，用 `clip.update` 的 `patch.text` 改文案。
- `track.add` 可以传 `name`；`get_project` 的轨道摘要也包含 `name`。仍然推荐用 1 起始 `index` 定位。
- `track.add` 的 `index` 是 **0 基插入位**（0 = 插到最上层），`get_project` 的 `index` 是 **1 基展示号**，两者相差 1。
- 一次 `apply_command` = 一个撤销步骤；一组相关修改用 `apply_commands` 合成一个撤销步。

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

- **按需读，不要全量读**：`get_project` 只给概览；片段、素材用 `get_track` / `find_clips` / `get_clip` / `get_assets` 逐片取。
- **先读后写**：id 与轨道现状以读取结果为准；写完再读对应片段确认，不要重读整份工程。
- **不要猜 revision**：用 `get_project` 或上一条命令返回的 revision。失败就重读，不要重试旧命令。
- **同轨不重叠**：插入前先看已有片段，必要时顺延或换轨；`clip.append` 会自动接在轨尾。
- **批量优先**：一组相关修改用 `apply_commands`，一次 revision、一个撤销步，失败整批回滚。
- **轨道顺序**：`index 0` 是最上层。建多层画面时从底层往上建，每加一层用 `index: 0`；音轨顺序不影响混音。
- **字幕可以交换，但仍是文字片段**：用 `import_subtitles` / `export_subtitles` 读写 SRT/VTT；时间线里仍是文字片段，样式与普通文字一致。
- **标记是工程级对象**：用 `get_markers` 读，`add_marker` / `update_marker` / `remove_marker` 写；不要把它当成片段。
- **合成原语**：调色、静态蒙版、片段入/出转场、关键帧都走命令总线；预览是近似，最终以导出为准。
- **转场是片段入/出动画**：支持 `fade` / `slide`；不支持相邻片段重叠式交叉淡化，不要承诺。
- **关键帧属性**：`opacity` / `x` / `y` / `scale` / `rotation`；时间相对片段起点。
- **AI 任务会真的跑模型**：字幕、翻译、朗读、音频/视频 AI、导出都可能耗时数分钟；调用前确认用户意图，缺模型先下载，并在 Gate 处等人确认。
- **版权与许可证**：生成模型、素材库、字体、音乐、Remotion 商用许可都有条款；在 `research.md` / `manifest.json` 里记录来源与许可证。
- **不要凭搜索结果编造 API**：框架能力以官方仓库/文档为准；版本与可用性会变，执行前先核对。
