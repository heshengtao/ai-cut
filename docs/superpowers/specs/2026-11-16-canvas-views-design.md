# 三视图外壳 · 工程分P · 无限画布设计

- 日期：2026-11-16
- 状态：**已实现**（P0–P7，见 §12 与 `docs/superpowers/plans/`）
- 目标形态：顶栏三视图切换（预览 / 画布 / 剧集）· 工程内多分P · 工程级共享的无限画布与素材库
- 参考：`ai-board`（无限画布交互与视觉，React + @xyflow/react）、`ai-daw`（顶栏切换与检查器习语）
- 不在本设计范围：互动视频分支的实际执行（只留文档字段）、多人协同、插件化节点市场、云端多模态服务商超过 MiniMax 一家

---

## 1. 问题与目标

AI Cut 现在只有一个工作区：预览台 + 时间线 + 右侧面板。两类需求现有结构放不下：

1. **一部剧 / 一个动漫 / 一个自媒体合集**有多个分P，每个分P 有自己的时间线，但共享素材与工程设置。
2. 复杂的 AI 模型组合（例如 MiniMax-H3 需要 9 图 + 3 音频 + 3 视频参考）用侧栏表单很难表达，需要一张能连线的无限画布。

目标：

1. 顶栏切三个界面，**只切换主窗口内容**，外壳与右侧面板不动。
2. 一个工程 = 一部剧，**分P = 工程内的子时间线**；画布与素材库工程级共享，整体仍保存为同一个工程文件。
3. 无限画布复刻 `ai-board` 的交互：4 输入 + 4 显示 + 7 模型节点，节点操作全部收进检查器。
4. 模型节点不区分本地/云端类型，在节点内的模型下拉里切换。
5. MiniMax-H3 的 9 图 + 3 音频 + 3 视频参考在**本地与云端都**要能跑。

非目标（本设计明确不做）：

- 互动视频的分支编辑界面（只预留 `Episode.transitions` 字段）。
- 分P 之间共享或引用的进阶语义（分P 资产完全隔离、跨分P 引用计数）。
- 画布节点的插件注册机制（11 个节点全部内置，注册表是编译期常量）。

---

## 2. 关键事实（实现前已核对）

| 事实 | 结论 |
| --- | --- |
| `Project` 当前是 `version: 1` + 根级 `tracks/clips/markers` | 改成"工程 → 分P"必须做文档 v2 + 兼容读 v1 |
| 代码里有 308 处 `doc.tracks`、571 处 `.tracks` 引用 | 逐处改造回归面过大，采用非枚举投影（§4.2） |
| `AiVideoPage.vue` 已有"同一模型下拉里本地/云端并列"的完整逻辑（`useModelChoice` + `sourceIdFor/splitSourceId` + `providersForCapability`） | 模型节点直接复用这套选择原语，不新造 |
| 本地 H3 Ref2VA 已支持 `refImages` + `refAudios`（`videoGenApi` → `video_gen.rs`） | 多图/多音频已通，缺视频参考 |
| 上游 sd.cpp 的 H3 文档已列出 `--ref-image` / `--ref-video` / `--ref-video-audio`（可重复，参考视频 = 图片帧目录、24fps） | 本地视频参考是**缺实现**而非做不到；需核对 pin 的构建（§9 待验证 1） |
| `cloud_gen.rs` 目前只支持单张 `initImage` | 云端多模态参考需要新增能力（§7.2） |
| 工程文件在 `<数据目录>/projects/*.json`，历史索引由 daemon 维护（`project_history_*`） | 分P 不需要新工程存储，只需文档结构变化 |
| `crates/daemon/assets/domain.js` 由 `src/core/{ops,serialize,…}` 打包，供 QuickJS 引擎使用 | 文档结构变化后必须重新生成 golden，并保证 domain 入口先归一化（§4.4） |

---

## 3. 界面外壳：顶栏三视图

### 3.1 状态与持久化

新增 `src/stores/view.ts`：

```ts
export type AppView = "preview" | "board" | "series";
```

- 持久化：URL hash（复用 `layout.restoreFromHash` 的同一套解析）优先，localStorage 兜底；两者都没有时默认 `preview`。
- 不放进 `layout` store：`layout` 管的是面板尺寸与标签页，视图是更高一层的信息架构。

### 3.2 顶栏

`src/components/layout/TopBar.vue`：在「Logo + 工程名」与 `BarActions` 之间插入 MD3 分段控件 `预览 | 画布 | 剧集`；竖屏时放到标签栏左侧。窗口拖拽逻辑要把它加进 `NO_DRAG_SELECTOR`（分段控件是 `[role=tab]`/button）。

快捷键进 `src/core/shortcuts.ts`：`⌘1/⌘2/⌘3`（Win `Ctrl+1..3`）。

### 3.3 主窗口

`src/components/layout/AppShell.vue` 只对 `<main>` 分支，顶栏、`WindowControls`、右侧面板、`PanelResizer` 全部不动：

| 视图 | 主窗口内容 |
| --- | --- |
| `preview` | 现有 `PreviewStage` + `PanelResizer` + `TimelinePane`（行为完全不变） |
| `board` | `BoardView` 替换**预览台那一块**（时间线、右侧面板保持原样） |
| `series` | `SeriesView` 替换**预览台那一块**（时间线、右侧面板保持原样） |

实现方式是新增 `StageView.vue`：横屏的 `.app-main` 与竖屏的 `.portrait-preview` 都渲染它，
由它按 `view` 在 `PreviewStage / BoardView / SeriesView` 之间切换。设置页仍是最高优先级。

### 3.4 右侧面板

- `PaneId` 增加 `"boardInspector"`，`PANES` 里登记（不进「+」选择器的通用列表则用 `hidden: true`，只能由画布双击节点打开）。
- `layout` 增加 `tabByView: Record<AppView, PaneId>` 与 `panelOpenByView`：切视图恢复各自的面板状态；画布默认 `boardInspector`，预览默认沿用上次的标签，剧集默认隐藏面板。
- 画布节点双击 → `selectNode(id)` + 打开 `boardInspector`，与 ai-board 的 `onNodeDoubleClick → openPanel('inspector')` 一致。

---

## 4. 工程文档 v2：工程 → 多分P

### 4.1 结构

```ts
// src/types/project.ts —— PROJECT_VERSION = 2
interface Project {
  version: 2;
  name: string;
  createdAt: number;
  updatedAt: number;
  fps: number;
  width: number;
  height: number;
  assets: MediaAsset[];        // 工程级共享
  episodes: Episode[];         // 分P：时间线数据的唯一真相
  activeEpisodeId: string;
  board?: BoardDoc;            // 工程级共享，一张画布
  cutScopes?: CutScope[];      // 工程级共享
}

interface Episode {
  id: string;
  name: string;
  order: number;
  tracks: Track[];
  markers: Marker[];
  createdAt: number;
  updatedAt: number;
  /** 互动分支预留：本设计不实现，只保留字段。 */
  transitions?: { choice: string; toEpisodeId: string }[];
}
```

共享 / 独立的边界（已确认）：

- **每分P 独立**：轨道、剪辑、标记、播放头与缩放手势、时长。
- **工程级共享**：素材库 `assets`、画布 `board`、分辨率/fps/输出设置、剪口组 `cutScopes`。

### 4.2 非枚举投影（本设计的核心纪律）

`src/core/serialize.ts` 的 `normalizeProject()` 在解析完成后，于 doc 上挂两个**可枚举**访问器：

- `doc.tracks` → getter 返回 `episodes[active].tracks` 的**真实数组引用**；setter 整体替换该数组。
- `doc.markers` → 同上。

为什么可行：308 处 `doc.tracks` 调用里绝大多数是只读遍历与原地修改（`push/splice/sort`），拿到真实引用后全部自然正确；只有整体赋值会走 setter，而 setter 会写进当前分P。

**为什么必须是可枚举**（实现期修正）：`{ ...doc }` 这种展开只复制自有可枚举属性。不可枚举访问器会被展开丢掉，于是 `addAsset(doc)` 这类"不改时间线"的 op 返回后 `doc.tracks` 变成 `undefined`，现有调用点会成片崩。改成可枚举后，展开会把数组值拷过去，外部代码零改动。

纪律（必须由测试锁死）：

1. 所有外部 JSON 入口（打开工程、历史恢复、会话 `full` 快照、domain 引擎、MCP/agent 桥）统一走 `normalizeProject`，不允许裸 `JSON.parse` 直接进 store。
2. `serializeProject()` 负责在写盘前把根级 `tracks/markers` 剔除（它们是可枚举的，否则 JSON 里会出现两份时间线）。
3. 任何 `structuredClone` 之后必须重新 `normalizeProject`（clone 不复制访问器）。
4. **改工程级字段/分P 列表必须走 `patchProjectMeta(doc, patch)`**，不能裸 `{ ...doc, patch }`：展开会把当前分P 的 `tracks` 拷成自有字段，折返时灌进新的当前分P（切分P 会把上一集的轨道带过去）。

### 4.3 迁移与兼容

- 读 `version: 1`：把根级 `tracks/markers` 包成 `episodes: [{ id, name: i18n("episode.defaultName", { index: 1 }), order: 0, tracks, markers }]`，`activeEpisodeId` 指向它；`board` 缺省为 `undefined`。
- `assertProjectShape` 接受 1 与 2，其他版本明确报错（现有文案体系）。
- 首次保存写 v2；新工程直接建 v2 + 一个默认分P。分P 默认名统一走 i18n（`分P 1` / `Part 1`），新建与复制沿用同一规则（复制自动加 `副本` 后缀）。
- `PROJECT_VERSION` 变更会触发 `src/core/__tests__/serialize.test.ts` 与 domain golden 的同步更新（见 §4.4）。

### 4.4 domain 引擎与 golden

`crates/daemon/assets/domain.js` 由 `scripts/build-domain.mjs` 打包 `src/core/{ops,commands,serialize,…}`。因为 QuickJS 侧只有纯 JSON，**domain 入口在拿到文档后必须先 `normalizeProject`**，否则 `doc.tracks` 不存在。

流程（CI 会 diff golden）：

1. 改 `serialize.ts` / `ops` 后跑 `pnpm domain:golden`；
2. `cargo test --manifest-path crates/daemon/Cargo.toml`；
3. golden 里的 v1 工程样例要保留一份，用来证明 v1→v2 的 domain 行为一致。

### 4.5 切分P

`stores/project.ts` 新增 `switchEpisode(id)`：

1. 播放头归零、清空选择、停止播放；
2. **撤销栈按分P 独立**（`history` 的栈按 `episodeId` 分组，避免撤销串集）；
3. 写回 `activeEpisodeId`、`updatedAt`，触发自动保存与 `session_publish`（`full`）；
4. 主窗口若在 `preview` 视图，直接呈现该分P 的时间线。

### 4.6 会话合并

`src/core/sessionMerge.ts` 的 `affected` 增加 `episodeId`：

- 不同分P 的编辑互不覆盖；
- 同一分P 仍按轨道合并；
- `full` 快照携带全部 `episodes`；
- 桌面命令（`src-tauri/src/session.rs`）与 HTTP RPC（`crates/daemon/src/rpc.rs`）要同步改 payload。

### 4.7 画布文档

```ts
interface BoardDoc {
  version: 1;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;
}
```

- 存进工程 JSON（`project.board`），随工程保存与历史快照一起走。
- 节点产物不进 JSON：落盘到 `<数据目录>/boards/<projectCreatedAt>/<nodeId>/`，`assets` 里只存路径与元数据。
- 节点产物在运行完成时自动 `addAsset` 进当前工程素材库，`MediaAsset` 增加可选 `boardOrigin?: { nodeId: string; nodeType: string }`，素材库据此显示来源角标并支持筛选；中间产物（抽帧目录、转码临时文件）不登记。
- 画布写回用 `watch(boardStore, debounce(400))`，与现有自动保存合并成一次写入，避免双写。

---

## 5. 无限画布

### 5.1 技术路线

Vue Flow 重写（已确认方案 A）：`@vue-flow/core` + `@vue-flow/background` + `@vue-flow/minimap`，不自绘 controls，以保持 MD3 视觉一致。

不采用"内嵌 React 岛"的原因：ai-board 的画布深度依赖它自己的 `@ai-board/kernel`、`@ai-board/sdk`、`@ai-board/ui`、插件运行时与 MCP server，剥离成本高于重写，且会长久维护 React + Vue 双框架与状态桥。

### 5.2 模块划分

| 文件 | 职责 |
| --- | --- |
| `src/stores/board.ts` | 画布文档、选择、运行状态、队列视图状态；防抖写回 `project.doc.board` |
| `src/core/board/schema.ts` | `BoardNode` / `BoardEdge` / 端口 / `ParamSpec` / 节点定义类型；normalize |
| `src/core/board/registry.ts` | 11 个节点定义（§6） |
| `src/core/board/compat.ts` | 端口兼容矩阵（纯函数，单测覆盖） |
| `src/core/board/queue.ts` | 串行任务队列（本地 GPU 一次一个），取消 / 去重 / 重排 |
| `src/core/board/run.ts` | 单节点执行：解析上游 → 调既有 store/API → 落盘 → 自动入素材库 → 下游标过期 |
| `src/components/board/BoardView.vue` | 画布容器、事件绑定、拖放 |
| `src/components/board/BoardNode.vue` | 通用节点卡片（11 个节点共用） |
| `src/components/board/BoardToolbar.vue` | 浮动工具栏 |
| `src/components/board/BoardEdge.vue` | 连线（含运行中动画） |
| `src/components/board/BoardMenus.vue` | 节点 / 连线 / 空白三种右键菜单 + 添加节点选择器（复用 `common/ContextMenu.vue` + `MenuPanel.vue` 的 item 模型） |
| `src/components/workspace/panes/BoardInspectorPane.vue` | 画布检查器 |

### 5.3 复刻清单（逐条验收）

双层点阵背景（22 / 110 间距）· 左下 MiniMap · 浮动工具栏（运行▾ / 交互模式 拖动↔框选 / ＋添加节点（可搜索、按分类分组）/ 撤销 / 重做 / 适应视图 / 网格吸附 / 缩放 − chip +）· 右键菜单（节点 / 连线 / 空白）· 文件拖入画布自动生成对应输入节点 · 拖线到空白处弹"兼容节点选择器" · 双击节点开检查器 · ⌘A 全选 · 空格抓手 · 滚轮平移 · zoom 0.15–2.2 · 22px 吸附 · 边动画。

画布自己的撤销/重做**不复用时间线的 `history`**：画布操作（增删节点、连线、移动、改参数）走 `stores/board.ts` 内独立的 undo 栈，避免与时间线编辑互相污染。

### 5.4 节点卡片

`inlineHeader`（标题只在卡片里出现一次）：

1. `label 行`：类型图标 + 标题 + 状态点（idle / queued / running / done / error / stale）；
2. `hover 控制`：运行、禁用、复制、删除；
3. `surface`：错误条 · 左侧输入句柄 + 参数名 · 右侧输出句柄 + 输出 dock；
4. `运行进度条`；
5. **底部可展开实时输出区（模型节点专用）**：图片/视频/音频给预览，文本给 markdown ↔ 纯文本切换。显示节点是"中间展示"，右键 = 下载到本地（文本节点无下载）。

### 5.5 执行模型（ComfyUI 式，默认手动）

工具栏运行按钮 ▾ 的下拉：

- `运行一次`（默认）
- `自动重跑`（跑完立即再入队，配合随机种子 = 连续抽卡）
- `变化时重跑`（onChange）
- `重复 N 次`
- `仅排队不执行`（静音）
- `队列面板`（取消 / 清空 / 重排）

每节点可覆盖 `manual | always | onChange | never`，默认 `manual`。所有任务进同一条串行队列；节点显示 `排队中(n) / 运行中 x% / 完成 / 失败 / 已跳过`，可单独取消。入队前按（节点 + 解析后的参数指纹）去重。

"运行一次"的语义是"运行当前选择，没有选择则运行所有可运行节点"；`stale` 只在参数/上游变化时打标，不自动触发（除 `always` / `onChange` 模式）。

### 5.6 检查器

所有节点操作只在 `boardInspector` 里，卡片上不放参数：

1. 标题 / 类型 / 运行状态；
2. **参数区**：由 `registry.ts` 的 `ParamSpec[]` 渲染（模型下拉、提示词、分辨率、步数、种子…），控件复用 `Md3Select`、`NumberField`、`SegmentedControl`、`ToggleSwitch`；
3. **输入区**：每个参数可"连接上游"或"手填"（ai-board 的 binding 模型），已连线时显示上游节点名；
4. **输出区**：实时预览 + 打开所在文件夹 + 加入素材库/插入时间线；
5. 通用：宽高、运行模式覆盖、禁用、删除。

---

## 6. 节点集

### 6.1 输入 / 显示（4 + 4）

| 输入节点 | 来源 | 显示节点 | 右键 |
| --- | --- | --- | --- |
| 图片输入 | 本地文件 / 素材库挑选 | 图片显示 | 下载到本地 |
| 视频输入 | 本地文件 / 素材库（含代理） | 视频显示 | 下载到本地 |
| 音频输入 | 本地文件 / 素材库（波形） | 音频显示 | 下载到本地 |
| 文本输入 | 手填 / 素材库字幕段 | 文本显示（markdown ↔ 纯文本） | 无下载 |

输入节点也可以是画布的拖放目标：从系统拖文件进画布 → 自动建对应类型的输入节点。

### 6.2 模型节点（7 个）

一种能力一个节点，节点内下拉切本地/云端；缺模型或未配置云端时节点内内联提示与按钮。

| 节点 | 复用的现有实现 |
| --- | --- |
| 图像生成 | `AiImagePage` 的参数集 + `core/imageGenApi`（sd.cpp）/ `cloudGen.startImage` |
| 视频生成 | `AiVideoPage` 的参数集 + `core/videoGenApi` / `cloudGen.startVideo`；H3 多模态见 §7 |
| 语音合成 | `stores/tts` + `core/modelApi`（本地）/ `core/cloudTtsApi`（云端） |
| 语音识别 | `stores/asr` + `core/asrSources` + `core/cloudAsrApi`（本地 / `cloud:<provider>`） |
| 文本·LLM | 现有 `core/agentApi` 后端（提示词模板 + 上游文本拼接） |
| 画面增强 | `stores/videoAi` + `core/videoAiApi`（超分 / 插帧 / 重构，`superres` / `interpolate` / `reframe`） |
| 音频分离 | `stores/audioAi` + `core/audioAiApi`（`separate` 分轨输出） |

模型下拉的构造复用 `utils/cloudGen.ts` 的 `providersForCapability` / `sourceIdFor` / `splitSourceId` 与 `stores/modelChoice`（记住上次选择），与 `AiVideoPage` 完全同一套，不再有第二套"来源"概念。

### 6.3 端口与兼容

类型：`text | image | video | audio | any`，每种带 channel（`inline` / `blob`）。兼容规则在 `core/board/compat.ts`，连接时校验；不兼容直接拒绝并在光标旁给出原因（例如"该模型只接受图片参考"）。

典型链路：图片输入 ×9 + 音频输入 ×3 + 视频输入 ×3 → 视频生成（H3 Ref2VA）→ 视频显示 → 下载/插入时间线。

---

## 7. MiniMax-H3 多模态（本地 + 云端）

### 7.1 本地

- 节点端口：`9 × 图片参考` + `3 × 音频参考` + `3 × 视频参考` + 可选首帧/尾帧 + 提示词；端口按模型能力位动态显隐（只有 H3 Ref2VA 点亮 9/3/3）。
- `VideoGenRequest` 增加 `refVideos?: string[]`；`VideoModelSpec` 增加 `refVideo: boolean`（与 Rust `VideoSpec` 同步，遵守现有"两处同源"约定）。
- `video_gen.rs`：
  - 视频参考 → ffmpeg 抽帧到临时目录（字典序、24fps）→ `--ref-video <dir>`；
  - 参考视频自带音轨 → 抽 WAV → `--ref-video-audio`（与 `--ref-video` 按序号配对）；
  - 现有 `-r`（参考图）与 `--ref-audio` 保持不变；
  - 能力校验：`ref_video: false` 的家族收到视频参考必须明确报错，而不是静默丢参数。
- 中间产物（抽帧目录、转码 WAV）只进临时目录，不进素材库。

### 7.2 云端

`crates/daemon/src/cloud_gen.rs` 为 `minimax` 新增 references 请求体（多图 / 多音频 / 多视频 URL），并在 `GenCapability` 体系里表达"多模态参考"这一能力：

- 服务不支持时明确报"该服务不支持多模态参考"，不静默降级为单首帧；
- 云端不支持的能力在节点上是禁用态并附原因，而不是隐藏（用户需要知道为什么不能选）。

### 7.3 待验证（P0 内完成，结果写回本文件）

1. **sd.cpp 构建**：pin 的 `master-1031-c6dfa9d` 是否已含 `--ref-video` / `--ref-video-audio`。验证方式：安装该后端后跑 `sd-cli --help` 核对。若不支持：升级 pin（后续如有破坏性变更按现有"改 pin 必须 bump revision"约定处理），或在节点上明确标注"本地暂不支持视频参考"。
2. **MiniMax 云端多模态**：真实请求字段形态（多图/多音频/多视频如何编码）。验证方式：用已配置的 MiniMax 账号发一次最小请求。若与预想不同，以实测为准调整 `cloud_gen.rs`。

---

## 8. 剧集界面与错误处理

### 8.1 剧集界面

- 全高分P 网格。顶部工具条：`＋ 新建分P（空白 / 复制当前分P）`、搜索、排序（手动拖拽 / 时长 / 更新时间）、密度切换。
- 卡片：封面（该分P 首个可见剪辑的 `thumb`，无则占位）、分P 名（原位改名）、时长、轨道/剪辑数、更新时间、`⋯`（重命名 / 复制 / 删除 / 移到最前 / 导出该分P）。
- 点击卡片：切到 `preview` 视图 + `switchEpisode(id)` + 播放头归零。
- 工程信息条：工程名、分P 数、总时长、画布节点数（点击跳画布）。
- 删除分P：保留至少一个；有剪辑时二次确认。

### 8.2 错误处理

| 场景 | 表现 |
| --- | --- |
| 模型未安装 / 云端未配置 | 节点内联提示 + 一键下载（`AiSetupDialog`）/ 去设置，不阻塞其他节点 |
| 生成失败 / 被取消 | 节点错误条 + 检查器完整日志 + toast；下游标 `stale` 而非 `error` |
| 上游端口断开 | 下游标"缺输入"，运行按钮给出具体缺哪个参数 |
| 节点引用丢失（旧画布） | 保留幽灵节点骨架，可重新绑定，不整体拒载 |
| 素材文件被移动/删除 | 输入节点显示占位 + "重新指定文件" |
| 工程文档坏档 | `assertProjectShape` 明确报错，不把半截数据灌进内存 |
| v1 工程 | 静默迁移为一个分P，首次保存写 v2 |

---

## 9. 测试

| 测试 | 覆盖 |
| --- | --- |
| `core/__tests__/projectV2.test.ts` | v1→v2 迁移；v2 round-trip 后 `tracks/markers` 投影仍在；原地 `push/splice` 与整体替换都落到当前分P |
| `core/__tests__/episodeSwitch.test.ts` | 切分P 的撤销栈隔离、播放头/选择复位、`activeEpisodeId` 持久化 |
| `core/__tests__/sessionMerge.test.ts`（扩展） | 不同分P 的补丁互不覆盖 |
| `board/__tests__/compat.test.ts` | 端口兼容矩阵 |
| `board/__tests__/queue.test.ts` | manual / always / onChange / repeat / 静音、去重、取消 |
| `board/__tests__/run.test.ts` | 自动入素材库、下游过期标记、失败传播 |
| `videoGen` 扩展 | H3 端口数量与能力位、`refVideos` → CLI 参数拼装、云端不支持时的明确报错 |
| Rust | `cargo test --lib`（ref-video 抽帧/配对、cloud references） |
| domain | `pnpm domain:golden` + `cargo test --manifest-path crates/daemon/Cargo.toml` |
| 全量 | `pnpm test`、`pnpm build` |

---

## 10. 分阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 工程 v2 + 迁移 + 投影 + domain golden + 会话合并按分P + §7.3 两项实测 | 全部测试绿，现有功能行为不变 |
| P1 | 顶栏切换器 + 三视图骨架 + 每视图面板记忆 | 三个视图可切，预览功能无回归 |
| P2 | 画布内核：Vue Flow、工具栏、菜单、撤销、持久化 | 能建/连/删/拖动节点，刷新后画布还原 |
| P3 | 4 输入 + 4 显示 + 检查器 + 素材库往返 | 导入→显示→下载，素材库双向通 |
| P4 | 7 个模型节点 + 队列 + 运行模式 | 每个节点本地/云端各跑通一次 |
| P5 | H3 多模态：本地 `--ref-video` + 云端 references | 9图3音频3视频真实出片（或按 §7.3 的验证结果明确降级） |
| P6 | 剧集界面（新建/复制/排序/删除/搜索/封面/跳转） | 多分P 切换与保存正确 |
| P7 | 打磨：i18n 双语、快捷键、空态、引导、视觉细节 | 与 ai-board 观感一致 |

**i18n 纪律**：所有新文案同时进 `src/i18n/zh.ts` 与 `src/i18n/en.ts`。

---

## 11. 风险与取舍

1. **投影的隐式性**：`doc.tracks` 变成访问器后，任何绕过 `normalizeProject` 的入口都会拿到 `undefined`。缓解：唯一入口 + round-trip 测试 + domain 入口强制归一化；改工程级字段只允许走 `patchProjectMeta`。
2. **文档版本迁移**：v1 工程被静默改写为 v2 后不可回退。缓解：首次保存前保留一份 v1 备份在历史索引里（现有 `project_history_record` 已经做了这件事，无需新增机制）。
3. **画布与时间线的双写**：画布防抖写回与自动保存可能互相覆盖。缓解：统一走 `project.touch()` 与单个保存入口，不允许 board store 自己 `invoke` 保存。
4. **串行队列**：云端任务本可并行，串行会拖慢。v1 接受（本地 GPU 是瓶颈，且串行让取消语义简单），后续按 provider 分流。
5. **H3 能力待实测**：见 §7.3，是唯一可能改变 P5 交付形态的外部依赖。

---

## 12. 实现状态（2026-11-16）

已落地：

| 阶段 | 提交要点 |
| --- | --- |
| P0 工程文档 v2 | `episodes` 单一真相 + 可枚举投影（`attachEpisodeView` / `patchProjectMeta`）、v1 兼容迁移、会话合并按分P（TS + Rust 两侧）、domain golden 重生成 |
| P1 三视图外壳 | `stores/view.ts`（hash 优先 + localStorage）、顶栏分段控件、`⌘1/2/3`、每视图面板记忆、剧集界面（网格 / 新建 / 复制 / 改名 / 拖拽排序 / 删除 / 搜索 / 点击跳预览） |
| P2 画布内核 | Vue Flow、双层点阵背景、MiniMap、浮动工具栏、右键菜单（节点 / 空白）、文件拖入建输入节点、连接端口类型校验、画布独立撤销栈、产物自动落盘 |
| P3 输入 / 显示节点 | 4 + 4 节点、素材库往返（选文件 / 从素材库挑 / 插入当前分P 时间线 / 复制路径 / 下载到本地） |
| P4 模型节点 | 7 个模型节点（图 / 视 / 音 / 听 / 文 / 增强 / 分离）、节点内本地/云端模型下拉、串行运行队列、运行模式（手动 / 自动重跑 / 重复 N / 仅标记） |
| P5 H3 多模态 | 视频节点的 9 图 + 3 音频 + 3 视频动态端口；本地 `--ref-video` / `--ref-video-audio`；云端 MiniMax v2 `/v2/video_generation` content 数组 + v2 query 轮询 |
| P6 / P7 打磨 | 右键菜单下载、拖入建节点、每视图面板记忆、`copy_file` 贯通 daemon/RPC/Tauri |
| P8 ai-board 复刻 | 轨道槽滑动切换器（对齐 ai-daw `Md3Segmented`）、舞台只替换预览区、分类子菜单 + 搜索摊平、节点/分类图标、锚定弹层（运行模式 / 右键菜单不再偏移）、拖线到空白弹兼容节点、节点悬停控制、节点缩放、双击开检查器、网格吸附 / 交互模式、小地图配色 |
| P9 节点与检查器样式 | 节点改成 ai-board 结构：卡外浮动 label（图标/标题/类型/状态）、无内边距内容舞台（图片视频铺满）、媒体条、图片牌堆（多图堆叠 + 循环切换 + 按比例定高）、显示节点被动空态并解析上游素材；检查器改 MD3：节点标题条、分区小标题、MD3 输入框/下拉/开关/按钮、牌堆缩略图网格；子菜单改为 220ms 悬停延时（斜向移动不再误关）；三级菜单不再 Teleport 出父级 DOM（原先指针进入浮层会触发父级 mouseleave 导致整串菜单消失），并在渲染后按浮层实际尺寸夹回视口 |
| P10 图片节点逐项对齐 | 图片输入/显示按 ai-board 的 art-card 重写：`.art-card` / `.art-stage`（棋盘底 + `object-fit: contain`）/ `.art-deck`（`translate(14+9i, 8+6i) rotate(1.6+1.5i)`）/ `1 / 2` 叠牌胶囊 / 内缩虚线 `.art-empty`（本地文件 + 素材库两个入口）；卡片本身是拖放面（文件直接追加/替换，`data-drop` 高亮）；导入与 `@load` 都按 `mediaHeight()` 把图片高度写回节点（140–1200，宽不变、不记撤销步），图片/视频节点 `lockAspectRatio`，拖拽缩放也不裁图；检查器根节点改为 `flex: 1 1 auto; width: 100%; min-width: 0`，字段/多选/按钮在 280–520px 侧栏内自适应换行，显示节点检查器解析上游素材并只读展示 |
| P11 节点 / 检查器整体对齐 ai-board | 画布配色收进 `.ab-canvas` 作用域：`--node-card-top/bottom`（深色 63 59 72 → 48 45 56）、`--md-surface*` 换成 ai-board 的深色阶、画布底色 30 27 36、点阵 0.45/0.8、小地图同色；节点补齐 ai-board 的三种内容舞台——文本输入改成 `node-text-card`（MD3 filled 编辑区 + 8px 等宽字符数页脚 + 复制/清空）、文本显示改成 `node-text-display`（顶部把手点 + 13px/1.68 阅读面）、视频改 `media-video`（自绘 orb + 46px 播放条 + 时间轴/静音/全屏，播放时隐藏控制条）、音频改 `media-audio`（44px orb + 名称/时间 + 56 柱波形按进度点亮）、模型节点改 `mn-card`（30px 图标、12.5/650 标题、mono 副标题、22px 状态胶囊、9.5px 字段标签 + 30px 控件、数字两两并排、mono 页脚）；label 图标按类型着色（文本蓝 / 图片紫 / 视频粉 / 音频绿）、悬停控制 22px、进度改成 conic 描边环、图片 `object-fit: contain`、默认尺寸对齐 ai-board（文本 340×200、模型 420×300 / 380×310 等）；检查器重写为 ai-board 的 `InspectorPanel` 结构（标题卡 24px 图标 + 11.5/650、输入参数卡 30px 下拉 + 9px 说明、输出卡状态/预览、标题 36px 输入、参数逐项 `.md-field`、素材条 60px 网格 + 64×52 预览、尺寸两列、运行/复制/删除胶囊 + 底部文字动作），面板底色 `--app-card`、留白 16px/13px |
| P12 拖线手感 + 输出附件卡 | 端口悬停放大保留 Vue Flow 的 `translate(±50%, -50%)`（原先被 `translateY(-50%)` 覆盖，左右各跳半个宽度 → 指针反复进出 = 抽搐）；`onConnectStart` 同时接受 source / target，**输入端向前拖出**也会弹兼容节点列表（「接入这个输入」，候选按锚点输入端口逐个匹配），落点走 ai-board `addNodeConnected` 的规则：横向固定 80px（下游在右 / 上游在左）、纵向跟随松手点、`findFreePosition` 避让、网格吸附；`connection-mode` 固定 Strict，保证 source / target 语义；模型节点产物从卡片主体移到**卡片下方 8px 的输出附件卡**（`node-output-dock`：标题 + 模型 + 流式点 + 收起、多输出缩略图 / 编号切换、text / image / video / audio 四种正文、折叠态存 `outputOpen`，收起后卡片右下角留展开钮），`outputAssetIds` 保留本次运行的全部产物（音频分离多轨、重复运行累积），点缩略图 = 改 `outputAssetId` 并标记下游 stale；复制 / 导入工作流清空产物与折叠态；`z-index: 1030` 抬升 owning node，附件卡不被邻居盖住 |
| P13 运行反馈 + 模型检查器 + 流式 | 节点运行计时（`startedAt` / `durationMs`，标签角标运行中显示 `42% · 1.2s`、结束后显示耗时，检查器状态卡追加耗时）；运行进度：本地图像 / 视频 / TTS / ASR / 增强 / 分离分别订阅 `image-gen-progress` / `video-gen-progress` / `tts-progress` / `asr-progress` / … 事件，卡片画 conic 进度环（有百分比时确定、没有时旋转弧段），附件卡底部加细进度条和 shimmer 占位；文本生成新增 Rust `llm_stream`（OpenAI 兼容 SSE，桌面发 `llm-stream` Tauri event、无头走同名 SSE 事件），实时 delta / reasoning 写入内存 `liveRuns`，结束把 `outputText` + `outputReasoning` 落盘，输出附件卡用「内容 / 思考」两个 tab；文本节点新增可选图片 / 视频输入（多模态 content parts，`file_data_url` 限 32 MB），检查器新增「流式输出 / 思考强度 / Top P / 生成数量」高级项（`inspectorOnly` + `hintKey`），模型下拉开头统一加「配置云端 API」快捷项（按 llm / gen / tts / asr 跳设置分区）；检查器移除宽高字段、输出卡只列类型 / 数量 / 已发布状态，不再预览内容；所有模型默认宽度统一 400、输入 / 显示统一 380（载入旧工程时仅把仍等于旧默认值的宽度收口，用户拖过的宽度保留，图片 / 视频按比例缩放高度）；新增「重建节点」（右键菜单 + 节点右上角工具按钮）：清空产物 / 文本 / 思考过程后从头运行；文本显示与附件卡加 `nowheel` + `overscroll-behavior: contain`，长文本可以滚动查看 |
| P14 输出附件与运行细节返工 | 检查器「运行控制」从最开头移到「运行此节点」按钮正上方；显示节点补齐输出端口（输入原样透传到输出，下游可以继续接；`resolveUpstream` 把显示节点当透传，不必先跑显示节点，和 ai-board 的 display 跟随实时输入一致）；输出附件去掉边框 / 背景 / 顶部栏 / 底部 meta / 进度条，正文直接铺满整宽（图片 `width:100%; height:auto; object-fit:contain`，视频 / 音频满宽，文本仅留可读性内边距），收起按钮固定在节点右下角（展开时向上、收起时向下），多图的浮层缩略图 + `1 / 2` 计数、思考 / 内容用浮层胶囊切换；运行进度环改成 SVG rounded-rect 描边（`pathLength=100` + `stroke-dashoffset` 按百分比生长；不确定进度用 18% 的弧段沿边框跑，不再整圈方框旋转）；「重建节点」改为**只重置**：模型参数回默认、产物 / 文本 / 思考 / 耗时清空、不运行（输入 / 显示节点保留素材与显示方式，标题 / 连线 / 绑定保留，记一步撤销）；文本显示外框加 `nowheel` 与显式滚动条，长文本可滚动 |

| P15 输入依赖 / 组节点 / 并行调度 / 工作流库 | 检查器输入下拉只列**上游依赖链**（直连 + 第 N 跳）上的节点输出，下游与无关节点不再出现，成环连线直接拒绝（`core/board/graph.ts`）；组节点按几何容器维护成员（中心点在框内即组员，拖出即离开），组员随组框一起拖动，组节点永远在图层最下方；复制 / 粘贴 / 剪切 / 删除 / 禁用 / 旁路 / 重建 / 运行都对整组生效（画布剪贴板 + 组展开）；新增 `core/board/scheduler.ts`：输入 / 显示即时发布、云端 / 文本 API 完全并行（默认 4 路）、本地 GPU 单进程串行、ffmpeg CPU 任务并行（默认 2 路），显存 / 内存预算与「智能排序（解锁下游优先）」「智能显存分配」可在运行▾菜单开关；云端生成后端（`cloud_gen.rs`）从单任务改成计数式并发，纯 API 工作流可以真正并行；新增工作流库（daemon `workflow.rs` + 右侧面板）：默认工作流只读、用户工作流按 `historyKey` + 名称归到同一张卡并按版本追加，画布工具栏 / 文件菜单 / 工作流库三处都能保存，清空画布前自动存一份，库面板支持搜索 / 筛选 / 拖到画布 / 插入历史版本 / 改名 / 删除 |
| P16 输出分辨率控件 | 节点卡片与检查器的「宽 / 高」两个数字框合成一个「分辨率」下拉（`core/board/size.ts`）：本地图片按家族 16/32/64 对齐的像素档、本地视频用 AI 视频页同一套 360p/480p/720p × 横/竖/方、云端图片按服务分「只认比例（Gemini / Stability / 可灵 / MiniMax / OpenRouter）」「白名单（DALL·E-3 / GPT-image、SiliconFlow）」「任意宽高（BFL / 百炼 / 方舟）」三档、云端视频分画幅（Veo / 可灵 / Runway / Luma / fal）、固定三档（百炼 / SiliconFlow）、分辨率档（方舟 480p/720p/1080p、MiniMax 720P/1080P）；支持自定义的服务在「自定义…」里给「生成宽度 / 生成高度」两个字段（按模型对齐取整），Replicate / fal / MiniMax H3 这类接口不传尺寸的显示「由模型决定」；`cloud_gen.rs` 的 `CloudVideoRequest` 新增 `resolution` 透传档位，Runway 的 `ratio` 改用它接受的 1280:720 / 720:1280 / 960:960 三档；旧文档只有宽高时：像素对得上某一档就用它，对不上且允许自定义就保留原像素 |

已知限制（后续迭代）：

1. **画布改动暂不进会话广播**：`updateBoard` 只置 dirty、推进 revision，不产生 op 事件；浏览器端要等下一次 full 快照才能看到画布变化。
2. **`onChange` 运行模式未实现**：现有 `manual / always / repeat / none`，参数变化只标下游 `stale`。
3. ~~节点不支持拖拽改尺寸~~ → 已支持右下角拖拽缩放（提交时记一步画布撤销）。
4. **剧集界面**暂不支持"导出该分P"与视图密度切换。
4.1 **本地引擎仍是单进程**：`image_gen` / `video_gen` / `tts` / `asr` 的后端一次只接受一个任务，所以调度器的本地 GPU 泳道固定为 1；纯 API（云端生成 / 文本 LLM）分支可以完全并行，本地分支按显存预算排队。要真正并行本地推理，需要先把这些引擎改成多任务 + 带 requestId 的进度 / 取消通道。
5. **侧栏 AI 视频页**没有参考视频 UI：多模态参考目前只在画布节点里可用。
6. **两处待真机验证**：本地 `--ref-video` 依赖所装 sd.cpp 构建是否包含该参数（按上游 `docs/minimax_h3.md` 接线）；云端 H3 的 v2 请求（`content` 数组、`ratio: adaptive`、`768P`）需真实 key 跑一次确认字段与分辨率枚举。
7. **产物来源角标**：节点产物已自动入库，但 `MediaAsset` 还没有 `boardOrigin` 字段，素材库暂不能按"画布产出"筛选。
8. **停止不会中断已在途的文本流**：`llm_stream` 目前没有按 requestId 暴露取消通道，点「停止」只是清队列；已在生成的那一条会跑完再落盘。图片 / 视频 / 音频的停止走各自 store 的 cancel，行为不变。
9. **图像 / 视频 / 音频没有逐帧流式**：本地 sd.cpp 只暴露 step 回调、不暴露中间帧；云端图像 / 视频接口也是完成态返回。画布对这类节点展示 step / 百分比 / 耗时，而不是预览帧。
