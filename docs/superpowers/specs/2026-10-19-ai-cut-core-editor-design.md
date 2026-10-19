# AI Cut 核心剪辑引擎 — 设计文档

- 日期：2026-10-19
- 状态：待实现
- 范围：子系统 1「核心剪辑引擎」
- 目标：把现有静态原型变成真正可用的视频剪辑器（导入 → 编辑 → 播放 → 保存/重开）

---

## 1. 背景

现有仓库是 AI Cut 的产品原型：Tauri 2 + Vue 3 + TypeScript + Vite 6 + Tailwind 3 + Pinia，
MD3/Material You 设计语言。原型已完成布局与视觉（顶栏、预览区、时间线、右侧标签面板），
但**全部是静态占位**：

- `PreviewStage.vue`：CSS 拼的假帧 + 无功能走带。
- `TimelinePane.vue`：硬编码的 6 条轨道与假片段、假波形，播放头不可拖。
- `panes/*`：媒体库/属性/AI/导出均为假数据，无交互。
- `src-tauri/src/lib.rs`：只负责创建无标题栏窗口，无任何命令。
- 无工程数据结构、无持久化、无媒体处理。

本设计只覆盖**子系统 1**，把剪辑内核做真。导出渲染、AI 助手、转场/关键帧、多视频轨实时合成、
纯浏览器版明确不在本期范围（见 §3）。

---

## 2. 已确认决策

| 议题 | 决策 |
| --- | --- |
| 预览播放路线 | 原生 HTML5 `<video>` 单主视频轨播放（图片/文字叠层、音频多实例混音） |
| 本期编辑能力 | 标准剪辑集（移动/裁剪/分割/删除/吸附/缩放/多轨 + 撤销重做 + 快捷键） |
| 素材存储 | 工程 = 普通 `.json` 文件；素材只记录路径引用，不拷贝 |
| 整体架构 | 前端持有响应式文档模型（Pinia）+ 薄 Rust 后端 |
| ffmpeg | 作为 Tauri **sidecar** 打包，随应用分发，用户无需自行安装 |
| 时间单位 | 秒（float，来自 ffprobe）；落点吸附到帧网格。不引入整数帧 |
| 片段归属 | 片段挂在轨道下（`track.clips[]`），保证「轨内有序」不变量 |
| 自动保存 | 改动 debounce 2s 写到应用数据目录 `recovery/autosave.json` |
| 撤销/重做 | 快照历史（深拷贝 doc 入栈，上限 100 步） |
| 选中 | 单击单选 + `⇧` 多选（框选留后续） |

---

## 3. 非目标（本期不做）

- 导出渲染（ffmpeg 合成成片）—— 子系统 2
- AI 助手对话/自动字幕/自动粗剪 —— 子系统 3
- 转场、关键帧、调色、特效 —— 子系统 4
- 多条视频轨实时合成预览（画中画、混合模式）
- 纯浏览器运行（真实功能依赖 Tauri 与 sidecar）
- 波形/缩略图的增量重算与磁盘缓存失效策略（v1 简单按 assetId 缓存）

导出面板 UI 保留现状（不接线），待子系统 2。

---

## 4. 整体架构

```
┌─────────────────────────── Webview (Vue 3 + Pinia) ───────────────────────────┐
│                                                                               │
│  stores/             project(文档)  selection  playback  layout(已有)          │
│      │                    ▲                                                  │
│      │ 提交 op             │ 不可变返回                                        │
│      ▼                    │                                                  │
│  core/ops/  ── 纯函数 (doc, ...) => doc   ←─ vitest 单测                        │
│      │                                                                        │
│  core/media.ts  convertFileSrc 封装 + 素材探测调用                               │
│  core/playback/ PlaybackEngine（时间→片段映射、<video>/<audio> 池、时钟）          │
│                                                                               │
│  components/  TopBar  PreviewStage  TimelinePane  panes/*  (改造为真实数据)      │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    │ invoke (Tauri IPC)
┌───────────────────────────────────▼───────────────────────────────────────────┐
│                          Rust (src-tauri)                                     │
│  commands: probe_media · make_thumbnail · make_waveform · read_project ·        │
│            write_project                                                       │
│  sidecar:  ffmpeg / ffprobe（bundled externalBin，Rust 侧 spawn）                │
└───────────────────────────────────────────────────────────────────────────────┘
```

原则：

- **文档是纯数据**，所有剪辑是纯函数变换 `(doc, op) => doc`（不可变，返回新对象）。
- **Rust 只做前端做不了的事**：原生文件框、ffprobe/ffmpeg、磁盘读写。
- 前端与 Rust 之间只有一个窄接口（§12 的命令清单），无状态同步管道。

---

## 5. 数据模型

新文件 `src/types/project.ts`：

```ts
export type AssetKind = "video" | "audio" | "image";
export type TrackKind = "video" | "audio" | "text";

export interface MediaAsset {
  id: string;            // crypto.randomUUID()
  name: string;          // 显示名
  kind: AssetKind;
  src: string;           // 源文件绝对路径
  duration: number;      // 秒；image 为 0
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  thumb?: string;        // 缩略图缓存文件名（应用数据目录 cache/）
  wave?: number[];       // 波形峰值 0..100
  offline?: boolean;     // 载入时源文件缺失
  addedAt: number;       // epoch ms
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;         // 时间线起点（秒）
  duration: number;      // 时长（秒）
  in: number;            // 素材入点（秒）；出点 = in + duration
  text?: string;         // 文字片段内容
  gain?: number;         // 音量增益 dB（默认 0）
  opacity?: number;      // 不透明度 0..1（默认 1）
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  clips: Clip[];         // 轨内按 start 有序
}

export interface Project {
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  fps: number;           // 工程帧率，默认 30
  width: number;         // 默认 1920
  height: number;        // 默认 1080
  assets: MediaAsset[];
  tracks: Track[];
}
```

约定：

- 图片素材放在 `video` 轨；其片段时长可自由拉长（不受素材时长限制）。
- 视频/音频片段的 `in + duration ≤ asset.duration`（裁剪不得越界，op 内做 clamp）。
- 文字片段 `assetId` 为空串，内容在 `clip.text`。
- 新建工程默认轨道：`视频 1`(video)、`音频 1`(audio)、`文字 1`(text)。

时间精度：`start/duration/in` 用秒（double）。落点经 `snapToFrame(t, fps)` 吸附到帧网格，
显示与吸附用 `frameToSec/secToFrame` 工具换算。

---

## 6. 持久化与文件

**工程文件**：`<name>.json`，内容即 `Project` 的 JSON 序列化，无自定义后缀。

- 打开/保存/另存为走原生文件框（`tauri-plugin-dialog`）。
- 读写由 Rust 命令 `read_project` / `write_project` 完成（前端拿到字符串自行 parse/stringify）。
- 保存成功后清 dirty 标记、更新 `updatedAt`。

**自动保存（recovery）**：

- doc 变更后 debounce 2s，序列化写入应用数据目录 `<appDataDir>/recovery/autosave.json`。
- 应用启动时：若存在 autosave 且其 `updatedAt` 晚于最近打开的工程文件（或没有工程文件），
  弹出「检测到未保存的恢复草稿，是否恢复？」。

**素材缓存**：

- 缩略图：`<appDataDir>/cache/<assetId>.png`
- 波形：`<appDataDir>/cache/<assetId>.wave.json`
- 不写进工程文件，工程文件只存文件名。

**素材路径引用**：

- 存绝对路径。载入工程时逐个检查存在性，缺失则置 `asset.offline = true`。
- 离线素材：媒体库显示「离线」标记，时间线上相关片段渲染为斜纹占位块，提供「重新链接」选择新路径。

---

## 7. 状态层（Pinia）

| store | 职责 |
| --- | --- |
| `stores/project.ts` | 持有 `Project` doc、`dirty`、`filePath`；撤销/重做栈；`dispatch(mutate)` 作为唯一写入口 |
| `stores/selection.ts` | `selectedClipIds: Set<string>`、`activeTrackId`；单选/多选/additive 逻辑 |
| `stores/playback.ts` | `playhead`(秒)、`playing`、`zoom`(px/秒)、`loop`（时间线缩放归此 store，**不放 layout**） |
| `stores/layout.ts` | 保留现有（面板可见性/宽度/时间线高度，纯 UI，不改动职责） |

`project` store 对外只暴露：

- `doc`（只读）
- `dispatch(mutate: (doc: Project) => Project): void` —— 执行纯函数、入历史、置 dirty、触发 autosave。
  传的是「应用某 op 后的新 doc」，即 `dispatch(d => splitClips(d, ids, t))`，
  不引入额外的 `EditOp` 联合类型（ops 本身就是函数）。
- `undo()` / `redo()` / `canUndo` / `canRedo`
- `load(project)` / `newProject()` / `save()` / `saveAs()` / `open()`

组件不得直接改 `doc`。

---

## 8. 剪辑操作（纯函数）

目录 `src/core/ops/`，统一签名 `(doc: Project, ...args) => Project`，**不可变**：

```
assets.ts   addAsset(doc, asset) · removeAsset(doc, assetId)
            relinkAsset(doc, assetId, newSrc)
clips.ts    addClip(doc, trackId, clip)
            removeClips(doc, clipIds)
            moveClips(doc, clipIds, deltaSec, targetTrackId?)
            trimClip(doc, clipId, edge: "start" | "end", newTimeSec)
            splitClips(doc, clipIds, atSec)
            addTextClip(doc, trackId, start, duration, text)
            setClipText(doc, clipId, text)
            setClipGain(doc, clipId, db)
            setClipOpacity(doc, clipId, value)
tracks.ts   addTrack(doc, kind) · removeTrack(doc, trackId)
            renameTrack(doc, trackId, name)
            setTrackFlag(doc, trackId, "muted" | "solo" | "locked", value)
```

约束与规则（在这些地方做 clamp/校验，UI 不重复实现）：

- 移动后 `start ≥ 0`。**同轨禁止重叠**（明确策略）：拖动片段时，若落点与同轨相邻片段重叠，
  把被拖片段**顶到`阻挡片段的边缘`**（向左拖撞到左邻片段右缘、向右拖撞到右邻片段左缘），
  即最终位置为「最近的合法不重叠位置」；跨轨拖动到目标轨时同样在目标轨上做此约束。
  吸附（§11）在此约束之上优先对齐到边缘/播放头/整秒。
- 裁剪：`in ≥ 0` 且 `in + duration ≤ asset.duration`；`duration ≥ 1 帧`。
- 分割：在 `atSec` 处把一个片段拆成两个，前段 `duration = atSec - start`，后段 `in += 前段时长`；
  `atSec` 必须严格落在片段内部。
- 删除轨道时其片段一并移除；至少保留一条轨道。

这些纯函数是本期**单测重点**。

---

## 9. 撤销 / 重做

- **快照历史**：每次 `dispatch` 执行完 op 后，把返回的新 doc 深拷贝入 `undoStack`，清空 `redoStack`；
  `undoStack` 上限 100，超出丢最旧。
- `undo()`：当前 doc 入 `redoStack`，弹出 `undoStack` 顶部作为新 doc。
- `redo()`：反向。
- **连续操作合并**：拖拽/滑杆这类高频操作，在**指针按下时记录基线**，
  **松开时只 `dispatch` 一次**（期间只改本地预览态），避免一次拖拽产生几十步历史。
  属性面板滑杆用 `input` 事件做实时预览、`change` 事件才 `dispatch` 提交。
- 快捷键 `⌘Z` / `⇧⌘Z`。
- 新工程 / 打开工程时清空历史。

---

## 10. 预览引擎

目录 `src/core/playback/`：

**时间→片段映射（纯函数，单测）**

```
activeClipsAt(doc, t): Map<trackId, Clip | null>
```

对每条轨道返回覆盖 `t` 的片段（`start ≤ t < start + duration`），无则 null。

**主视频轨选择**：从上往下第一条 `kind === "video"` 且未被静音（考虑 solo）的轨道，
其 `activeClipsAt` 结果作为主画面。

**渲染层（PreviewStage 改造）**

- 画面区自上而下：`<video>`（主视频片段）→ `<img>` 图片叠层 → DOM 文字叠层。
- 音频：每条音频轨一个 `<audio>` 元素（池化复用），并行播放。
- `opacity` 映射到元素 style；`gain`(dB) 映射线性音量 `10^(db/20)`；`muted`/`solo` 生效。
- 无主视频时显示黑场 + 「无画面」。

**时钟与同步**

- 播放时用主 `<video>` 的 `requestVideoFrameCallback`（不可用时退化 `requestAnimationFrame` + `performance.now()`）
  驱动 `playback.playhead`。
- 主片段切换：当 `t` 越过片段边界，设置新 `src` 并 `currentTime = clip.in + (t - clip.start)`，继续播放。
- 音频元素每帧校正 `currentTime` 漂移（阈值 ~50ms 才 seek，避免抖动）。
- 拖动播放头（scrub）：暂停 → 按 `t` seek 主视频与音频 → 显示对应帧。

**与 UI 接线**

- 替换 `PreviewStage.vue` 的假帧；真实时间码（当前/总时长）、播放/暂停、逐帧、音量。
- 分辨率/帧率 chip 显示 `doc.width × doc.height · doc.fps`。

**已知限制**（写在文档，不实现）：单主视频轨、无实时转场/混合、无 GPU 合成。

---

## 11. 时间线交互

改造 `TimelinePane.vue`，数据源改为 `project.doc`：

- **片段拖拽移动**：同轨平移 + 跨轨（拖到别的轨道行）；带吸附。
- **边缘裁剪**：左/右把手拖拽改 `in`/`duration`。
- **分割**：`S` 在播放头处分割所有选中片段（无选中则分割播放头所在的主轨片段）。
- **删除**：`Delete` / `Backspace` 删除选中片段。
- **吸附**：候选点 = 相邻片段边缘、播放头、整秒、0；阈值 ~6px（换算成秒）；按住 `⌥` 临时关闭吸附。
- **缩放**：`playback.zoom`（px/秒）→ 车道背景网格与片段宽度；工具条滑杆与 `⌘滚轮` 控制（`⌘滚轮` 以光标为锚点）。
- **播放头**：点击/拖拽标尺定位；播放时自动跟随滚动（可选，v1 先做定位不做自动跟随）。
- **轨道头**：`M`(mute) `S`(solo) `L`(lock) 真正写回 op；`+` 添加轨道；右键/悬停删除轨道。
- **选中**：单击单选；`⇧` 点击多选（additive）；点空白清除。
- **从媒体库拖入**：把素材拖到某轨道 → `addClip`，`start` = 落点吸附后时间（默认 `in = 0`，
  时长取 `min(asset.duration, 默认 5s)`；图片默认 5s）。

片段渲染沿用现有视觉（`tone-*`、首帧图、波形），数据换成真实值；波形来自 `asset.wave`。

---

## 12. Rust 后端与 sidecar

**依赖**：`tauri-plugin-dialog`、`tauri-plugin-shell`（新增）。

**sidecar 打包**：

- 二进制放入 `src-tauri/binaries/`，带 target-triple 后缀：
  `ffmpeg-aarch64-apple-darwin`、`ffprobe-aarch64-apple-darwin`（本机 host = aarch64-apple-darwin）。
- `tauri.conf.json`：`bundle.externalBin: ["binaries/ffmpeg", "binaries/ffprobe"]`。
- **由 Rust 侧 spawn**（`app.shell().sidecar("ffmpeg")`），不经 JS，故 capabilities 无需开放 shell 执行权限。
- 注意事项：二进制体积各约数十 MB；Homebrew 的 ffmpeg 为 GPL 构建，正式分发需评估许可（原型/本地开发不受影响）。

**命令清单**（`src-tauri/src/`，注册到 `invoke_handler`）：

```rust
probe_media(path: String) -> MediaMeta
// MediaMeta { kind, duration, width, height, fps, has_audio }
// 实现：ffprobe -v quiet -print_format json -show_format -show_streams <path>，解析首个视频/音频流

make_thumbnail(path: String, asset_id: String, at_sec: f64) -> String
// 实现：ffmpeg -ss <t> -i <path> -frames:v 1 -vf scale=320:-1 <cache>/<id>.png
// 返回缓存文件名；失败返回 Err

make_waveform(path: String, asset_id: String) -> Vec<u8>
// 实现：ffmpeg 解码为 PCM（-f s16le -ac 1 -ar 8000）→ Rust 分桶取峰值 0..100 → 写缓存 json
// 返回峰值数组

read_project(path: String) -> String   // 读 .json 文本
write_project(path: String, json: String) -> ()
```

**前端封装** `src/core/media.ts`：

- `convertFileSrc()` 统一把绝对路径转 webview 可用 URL（预览、缩略图共用）。
- `probeMedia(path)`、`makeThumbnail(...)`、`makeWaveform(...)`、`readProject/writeProject` 的
  `invoke` 包装与类型。
- 启动检测：ffmpeg/ffprobe 是否可用（`probe_media` 探针或 `--version`），不可用时顶栏提示。

---

## 13. 面板接线

- **媒体库 `MediaPane.vue`**：真实 `doc.assets` 列表；「导入媒体」走 dialog（可多选）；
  搜索框与类型筛选真正生效；卡片可拖拽到时间线；离线素材显示标记与「重新链接」。
- **属性 `InspectorPane.vue`**：显示 `selection` 选中片段的真实属性；
  缩放/旋转/位置 v1 只展示（变换留后续），**不透明度**与**音量**滑杆写回
  `setClipOpacity` / `setClipGain`；选中的是文字片段时显示文字编辑框。
- **AI `AiPane.vue`**：保持占位（子系统 3）。
- **导出 `ExportPane.vue`**：保持占位（子系统 2）。
- **顶栏 `TopBar.vue`**：工程名接 `doc.name`，dirty 圆点接 `dirty`，草稿 chip 显示 fps/分辨率；
  新增「打开/保存/另存为」入口（设置菜单或菜单栏）。

---

## 14. 快捷键

| 快捷键 | 行为 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `⌘Z` / `⇧⌘Z` | 撤销 / 重做 |
| `S` | 在播放头处分割选中片段 |
| `Delete` / `Backspace` | 删除选中片段 |
| `←` / `→` | 后退 / 前进一帧 |
| `⌘S` | 保存 |
| `⌘⇧S` | 另存为 |
| `⌘O` | 打开工程 |
| `⌘滚轮` | 时间线缩放（以光标为锚点） |

输入框聚焦时（属性面板文字框、搜索框）不触发 `S`/`Delete`/`空格` 等编辑快捷键。

---

## 15. 错误处理

| 场景 | 处理 |
| --- | --- |
| 导入时 ffprobe/ffmpeg 失败 | 拒绝该素材 + toast 提示原因 |
| 源文件缺失（载入工程） | `asset.offline = true`；片段渲染离线占位；提供重新链接 |
| ffmpeg sidecar 缺失/启动失败 | 顶栏常驻提示「媒体处理不可用」；导入/缩略图/波形降级为不可用 |
| 保存失败 | toast + 保留 dirty，不丢内存数据 |
| 工程 JSON 解析失败 | 报错并保留当前内存工程，不覆盖 |
| 分割点落在片段外 | op 内忽略（无操作），不产生历史 |

统一 toast 组件（`src/components/common/Toast.vue`，新增，MD3 风格）。

---

## 16. 测试策略

- **单元测试（vitest，新增）**，重点：
  - `core/ops/*`：`trimClip`（两端、越界 clamp）、`splitClips`（正常/边界/片段外）、
    `moveClips`（同轨、跨轨、负数 clamp）、`removeClips`、`addClip`。
  - `core/playback/activeClipsAt`：边界（`t` 恰在 `start`、恰在 `start+duration`、空轨、多轨）。
  - 撤销/重做：连续 op 后 `undo`/`redo` 往返一致。
  - 时间换算：`secToFrame/frameToSec/snapToFrame`。
- **手动验收**（见 §19）。
- 保留 `npm run build`（`vue-tsc --noEmit` + vite build）与 `cargo check` 通过作为门槛。

---

## 17. 依赖与配置变更

**新增 npm 依赖**：`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-shell`；devDep `vitest`。

**新增 Rust 依赖**：`tauri-plugin-dialog`、`tauri-plugin-shell`。

**配置**：

- `src-tauri/tauri.conf.json`：`bundle.externalBin` 增加两个 sidecar。
- `src-tauri/capabilities/default.json`：增加 `dialog:default`（文件框）。
- `package.json`：新增 `test` 脚本（`vitest run`）。
- `src-tauri/binaries/`：放入 ffmpeg/ffprobe（带 target-triple 后缀）。

---

## 18. 文件清单

**新增**

```
src/types/project.ts
src/core/ops/{assets,clips,tracks}.ts
src/core/ops/index.ts
src/core/playback/{engine,activeClips}.ts
src/core/media.ts
src/core/time.ts
src/core/serialize.ts          // Project <-> JSON、版本校验、迁移占位
src/stores/{project,selection,playback}.ts
src/components/common/Toast.vue
src/core/ops/__tests__/*.test.ts
docs/superpowers/specs/2026-10-19-ai-cut-core-editor-design.md
src-tauri/binaries/ffmpeg-<triple>, ffprobe-<triple>
```

**修改**

```
src/components/workspace/PreviewStage.vue        // 接真实播放
src/components/workspace/TimelinePane.vue        // 接真实文档 + 交互
src/components/workspace/panes/MediaPane.vue     // 真实素材库 + 导入 + 拖拽
src/components/workspace/panes/InspectorPane.vue // 选中片段属性
src/components/layout/TopBar.vue                 // 工程名/dirty/打开保存
src/components/layout/SettingsMenu.vue           // 打开/保存入口（如需）
src/stores/layout.ts                             // 如需（本期职责不变）
src-tauri/src/lib.rs                             // 命令注册 + sidecar
src-tauri/Cargo.toml                             // 依赖
src-tauri/tauri.conf.json                        // externalBin
src-tauri/capabilities/default.json              // dialog 权限
package.json                                     // 依赖 + test 脚本
```

---

## 19. 验收标准

1. 启动应用 → 新建工程含默认 3 轨（视频/音频/文字）。
2. 「导入媒体」选一个真实 mp4 → 媒体库出现卡片，带真实时长与缩略图（有音频则显示波形）。
3. 把素材拖到视频轨 → 生成片段，显示真实首帧与波形。
4. 拖拽移动片段（含跨轨）、拖边缘裁剪、`S` 分割、`Delete` 删除，均即时正确。
5. 空格播放：预览区播放主视频轨当前片段，时间码走动；`←/→` 逐帧；拖动播放头可定位。
6. 音频轨在播放时出声；M/S 生效。
7. `⌘Z` / `⇧⌘Z` 能逐步撤销/重做上述操作。
8. `⌘S` 保存为 `.json`；`⌘O` 重新打开 → 工程结构、片段位置完全还原。
9. 关掉重开（或崩溃）→ 提示恢复 autosave 草稿。
10. 把工程里引用的源文件改名 → 重开工程显示离线占位 + 可重新链接。
11. `npm run build`、`cargo check`、`vitest run` 全部通过。

---

## 20. 风险与依赖

| 风险 | 缓解 |
| --- | --- |
| webview `<video>` 对多路音频/多格式解码支持不一 | 音频池化 + 漂移校正；不支持的格式给出明确错误 |
| 主片段切换处的 seek 抖动/黑帧 | 邻近预加载、切换到目标 `currentTime` 后再显示；必要时短暂黑场 |
| ffmpeg sidecar 体积与许可 | 原型阶段接受；分发前评估瘦身与 GPL 合规 |
| 大工程快照历史的深拷贝开销 | doc 为纯 JSON、规模有限；上限 100 步；必要时改结构化共享 |
| Tauri 沙箱下 pnpm install 曾失败（见 .workbuddy-ai 备忘） | 验证用既有 node_modules；必要时 npm 兜底 |
| 素材路径引用导致源文件移动即失效 | 离线检测 + 重新链接（v1 接受） |
```
