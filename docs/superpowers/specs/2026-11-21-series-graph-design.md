# 剧集界面：平铺 / 连线两种形态 · 互动分支图 · 剧集播放模式

- 日期：2026-11-21
- 状态：**已实现**
- 目标形态：剧集界面用「平铺 / 连线」替换原「手动 / 时长」排序；连线是自由画布，分P 是卡片，
  卡片之间可连线、可在连线上写选项；普通剧集默认按制作时间顺序自动生成一根时间链；
  预览支持「单集播放 / 剧集播放」，剧集播放沿连线自动连播，遇到分叉浮出选项。
- 相关：`src/components/series/`、`src/core/series/`（新）、`src/core/ops/series.ts`（新）、
  `src/components/workspace/PreviewStage.vue`、`src/stores/layout.ts`、`src/types/project.ts`、
  `src/core/serialize.ts`、`src/i18n/{zh,en}.ts`
- 不在本设计范围：Rust / daemon 命令、session 协作协议、导出成片时按剧集图拼接、分P 级的画布或
  媒体归属（素材与画布仍工程级共享）、时间线上「按剧集播放预演」的离线渲染。

---

## 1. 问题与目标

现状（`SeriesView.vue`）：所有分P 平铺成网格，可按「手动顺序 / 时长」排序，单击卡片 = 切分P 并
回到预览。分P 之间**没有任何显式的先后关系**：`Episode.order` 只用于排序和展示，播放器每集播完
就停。互动游戏 / 互动电影需要的是分P 之间的有向关系（分支、循环、复用），而这层信息现在无处安放
（`Episode.transitions?` 只有类型预留，没有实现、没有界面、没有任何读写）。

目标：

1. 剧集界面两种形态：**平铺**（现有网格，去掉时长排序）与**连线**（自由画布 + 有向连线）。
2. 普通剧集**零配置**：没动过连线的工程，连线模式直接按 `order` 画一条从左到右的时间链，
   播放时就是自动连播。
3. 用户第一次加 / 删 / 改连线后，图转为**自定义并持久化**；提供「按时间顺序重建」退回默认链。
4. 连线可命名（= 选项文案），未命名在播放时显示「选项 1 / 选项 2」。
5. 分P 单击不再进预览：单击选中、**双击**进预览，或点卡片右下角**预览按钮**。
6. 预览控制条增加**播放模式**：单集播放（现状）/ 剧集播放（沿连线自动连播、遇分叉浮出选项）。

非目标：

- 不做框选、多选、成组、自动避让（重叠允许，提供「自动排列」）。
- 不在连线上做条件表达式 / 变量 / 计数（互动游戏常见的旗标系统），选项就是一条边。
- 不改时间线、素材库、导出、AI 相关的任何行为。
- 不把剧集图塞进 `BoardView`（见 §2 的取舍）。

---

## 2. 关键事实（实现前已核对）

| 事实 | 位置 | 影响 |
|---|---|---|
| `Episode.order` 由 `nextOrder()` 追加、`reindex()` 在移动/删除时重排为 0..n-1 | `core/ops/episodes.ts` | 派生时间链 = `order` 升序相邻相连 |
| `Episode.transitions?` 仅类型注释「预留，本阶段不实现」 | `types/project.ts:354` | 本设计改用工程级图，删除该字段避免两处真相 |
| `project.switchEpisode()` 会清空撤销栈 / 重做栈 | `stores/project.ts:741` | 剧集播放切集沿用此语义，不新造「临时分P」 |
| 投影 `tracks` / `markers` 是 `attachEpisodeView()` 定义的访问器；`patchProjectMeta()` 专门用于只改工程级字段 | `core/episodes.ts` | `seriesGraph` 是工程级字段，必须走 `patchProjectMeta` |
| `serializeProject()` 用 `{...doc}` 展开后只删 `tracks/markers/board` | `core/serialize.ts:19` | `seriesGraph` 自动写盘；读取端需补归一化 |
| 重命名/删除/排序等分P 结构改动走 `project.dispatch(mutate)`，不可变纯函数 | `core/ops/episodes.ts` | 边编辑同样走 `dispatch`，天然进撤销栈 |
| 预览引擎 `onEnded` 目前只把 `playback.playing` 置 false | `PreviewStage.vue:257` | 剧集播放的自动连播挂在这里 |
| `PreviewStage` 监听 `project.doc` → `engine.sync()` | `PreviewStage.vue:323` | 切集后无需手动重置引擎 |
| 控制条右下已有 `Md3Select`（画质 / 比例） | `PreviewStage.vue:2077+` | 播放模式直接复用同一控件与样式 |
| 布局偏好持久化在 `ai-cut-layout`，`Persisted` 接口 + `sanitize*` 兜底 | `stores/layout.ts` | 新增 `seriesPlayMode` 字段，默认 `single` |
| 前端只有纯逻辑测试（无 @vue/test-utils / jsdom） | `package.json` / `src/core/**/__tests__` | UI 逻辑尽量下沉到 `core/series/*` 纯函数再测 |
| `crates/daemon/assets/domain.js` 由 `src/core` 打包生成，CI diff | `AGENTS.md` | 动了 `core/ops` 需 `pnpm domain:golden` 并提交 golden |

**取舍（实现层修正）**：不复用 `BoardView`，但**复用它的画布库 `@vue-flow/core`**（项目已有依赖）。
画布节点自带端口签名、运行引擎、插件注册表、工作流库，剧集卡的语义（一集 → 多条选项边）与之不匹配，
复用 `BoardView` 会把工作流概念泄漏到剧集里，且任何工作流改动都会波及剧集界面。而 Vue Flow 本身只是
通用图渲染：平移 / 缩放 / `fitView` / Handle 拖线 / 自定义节点与边，剧集图画布直接用它，
`SeriesGraph.vue` 只负责「分P → nodes、连线 → edges」的映射与图编辑，不引入任何工作流概念。

---

## 3. 数据模型

`src/types/project.ts`：

```ts
/** 剧集图上的一条有向连线。`from` 播完 → 进入 `to`。 */
export interface SeriesEdge {
  id: string;
  from: string;          // episodeId
  to: string;            // episodeId
  /** 连线上的选项文案。空 / 缺省 = 无选项（唯一出边时自动连播；多条出边时显示「选项N」）。 */
  label?: string;
}

/** 工程级剧集图。缺省表示「按分P order 派生一条时间链」。 */
export interface SeriesGraphDoc {
  /** 用户编辑过连线后为 true；此后 edges 才是真相。 */
  custom: boolean;
  /** 只有 custom 时参与渲染；保持追加顺序（= 选项显示顺序）。 */
  edges: SeriesEdge[];
  /** 卡片在画布上的坐标（世界坐标）。缺省的分P 走自动布局。 */
  positions: Record<string, { x: number; y: number }>;
}
```

`Project` 增加 `seriesGraph?: SeriesGraphDoc`；删除 `Episode.transitions?`（没有任何读写方）。

不变量：

- `custom === false` 时 `edges` 可以为空或被忽略；`positions` **始终有效**（拖动卡片只改位置，
  不把图转成自定义——普通剧集拖一下卡片仍然保持自动时间链）。
- `edges` 里 `from` / `to` 必须指向存在的分P；读取时过滤失效边（自愈），写入时由 ops 保证。
- 同一对 `(from, to)` 不允许重复边（防止两个一模一样的选项）；`from === to`（自环）允许。

---

## 4. 图引擎（纯函数）

新目录 `src/core/series/`：

### 4.1 `graph.ts`

```ts
seriesEdges(doc): SeriesEdge[]        // custom ? 过滤后的存盘边 : 派生链
outgoing(doc, episodeId): SeriesEdge[]
incoming(doc, episodeId): SeriesEdge[]
isDerived(doc): boolean               // !custom（custom 但 edges 为空 = 一张孤立卡的图，不回退派生链）
materializeGraph(doc): Project        // 派生 → 自定义：把当前派生链写进 edges（见 §5）
```

派生链：把分P 按 `order` 升序遍历，相邻两集连一条无 label 的边，id 用稳定值
`chain:${from}->${to}`。这样同一份工程每次渲染的边 id 一致，选中态和动画不会闪。

`custom=true` 且 `edges=[]` 时**不回退**到派生链：用户删光了连线就是「没有任何前后关系」，
画布显示空图提示（§6.3），否则删掉最后一条边会导致整条时间链又冒出来。

```ts
/** 播放判定：本集播完之后该干什么。 */
type SeriesStep =
  | { kind: "end" }                                        // 没有有效出边
  | { kind: "auto"; to: string }                            // 唯一出边且无 label
  | { kind: "choices"; options: SeriesOption[] }            // 其余情况
  | { kind: "loop"; to: string };                           // 自动连播回到本轮回访过的分P
interface SeriesOption { edgeId: string; to: string; label: string; unnamed: boolean }
```

`stepOf(doc, episodeId, visited)` 的规则（`visited` = 本轮自动连播已经过的分P）：

1. 有效出边为 0 → `end`。
2. 有效出边 1 条且 `label` 为空 → 目标在 `visited` 里则 `loop`，否则 `auto`。
   目标在 `visited` 里说明是无选项的环（例如 A→B→A），自动连播会死循环，必须停。
3. 其余（≥2 条，或唯一出边带 label）→ `choices`。选项顺序 = edges 数组顺序；`label` 为空时
   `unnamed: true`，文案由 UI 用 `series.choice.unnamed` + 序号渲染（不落库）。
4. 手动点选项**不做 loop 判定**：互动剧故意让人绕回前面的分P。

`optionsOf(doc, episodeId)` 返回 `SeriesOption[]`，供界面角标与播放浮层共用。

### 4.2 `layout.ts`

```ts
autoLayout(doc, edges): Map<string, { x: number; y: number }>
placement(doc, episodeId): { x: number; y: number }   // positions 优先，否则 autoLayout
```

分层布局：

- 深度 = 从无入边节点（没有则取 order 最小的分P）出发的 BFS 层数；环上节点只访问一次，深度按首次到达。
- `x = 48 + depth * 300`，`y = 48 + (层内序号) * 196`；卡片尺寸 240×168（含缩略图）。
- 派生链退化为一条直线：每层只有一集，`y` 恒为 48 —— 就是「整个剧集一根线」。

新分P / 复制的分P 没有坐标时，放在当前图包围盒右侧一列，避免压住已有卡片。

### 4.3 `sanitize.ts`（或并入 `graph.ts`）

`normalizeSeriesGraph(value: unknown): SeriesGraphDoc | undefined`：

- 非对象 / 缺字段 → `undefined`（旧工程无此字段）。
- `custom` 非布尔 → `false`；`edges` 非数组 → `[]`；逐条校验 `id/from/to` 为非空字符串，
  `label` 非字符串则丢弃；重复 `id` 只保留第一条（选中态按 id 工作，重复 id 会让点击错乱）；
  `positions` 只保留 `{x,y}` 都是有限数的项。
- 不做「目标分P 是否存在」校验（工程解析先于分P 归一化没有意义），由 `seriesEdges()` 读取时过滤。

---

## 5. 操作层 `src/core/ops/series.ts`

全部是不可变纯函数，经 `project.dispatch()` 进撤销栈；`ops/index.ts` 导出。

```ts
materializeGraph(doc): Project                 // 派生链 → custom=true + 把当前链写进 edges
connectEpisode(doc, from, to): Project        // 先 materialize，追加无 label 边；重复边 / 缺失分P → 原样返回
disconnectEpisodeEdge(doc, edgeId): Project   // 先 materialize，再删边（派生链上的边也能删）
setEpisodeEdgeLabel(doc, edgeId, label): Project  // 先 materialize；trim；空串 = 清掉 label
moveSeriesCard(doc, episodeId, x, y): Project // 只写 positions，不改 custom
autoLayoutSeries(doc): Project                // 清空 positions → 回到自动布局
resetSeriesGraph(doc): Project                // custom=false、edges=[]（positions 保留）
pruneSeriesEdges(doc): Project                // 过滤悬空边（删除分P 后调用）
addConnectedEpisode(doc, anchorId, direction, name, position): Project
                                              // 拖线到空白：先把派生链落成边，再追加分P 并按方向连好
```

**派生 → 自定义的状态转换**（关键行为）：用户第一次做结构性编辑（连、断、改名）时，
先把**当前看得见的派生链原样落进 `edges`**，再应用这次编辑。这样「给 E1 加一条通往 E3 的分支」
不会让 E1→E2→E3 的时间链凭空消失，图上只是多了一条线；想回到纯时间链用「按时间顺序重建」。

`removeEpisode()`（`core/ops/episodes.ts`）在同一个 op 内调用 prune，保证「删分P + 删相关边」是
一个撤销步骤。`duplicateEpisode()` 不复制入 / 出边（副本是独立一集）。

边界：

- `from`/`to` 不在 `doc.episodes` 里 → 返回 `doc`（`dispatch` 见到 `next === before` 不入栈）。
- 只读模式：图编辑按钮禁用，ops 层不加只读判断（`project.dispatch` 已经拦）。
- 删除到只剩一个分P 时 `removeEpisode` 原样返回，行为不变。

---

## 6. 界面：剧集界面

### 6.1 顶部工具条

`SeriesView.vue`：

- 原 `series-sort`（手动 / 时长）换成 `SegmentedControl`：`平铺` / `连线`，状态存
  `layout.seriesMode`（持久化）——切到预览 / 画布再回来还是上次那个形态。
- 搜索框只在平铺模式显示；时长总计、分P 计数保持。
- 「新建分P」始终显示。

### 6.2 平铺（默认）

- 网格布局、封面、角标、工具按钮沿用现状；**去掉时长排序**。
- 拖拽换序保留（决定默认时间链）；拖拽只在平铺模式生效。
- 单击 = 选中（`aria-selected` + 描边），不再进预览；**双击** = `open(episode)`。
- 卡片右下角增加常驻「预览」按钮（`PlayIcon`），悬停工具条里排在改名之前；点击 = `open(episode)`。
- 自定义图里有 ≥2 条出边的卡片显示「N 个选项」小角标；没有入边且不是第一集的卡片显示「未接入」
  角标（帮助发现孤立分P）。
- 搜索无结果时沿用现有空态。

### 6.3 连线（自由画布）

新组件 `src/components/series/SeriesGraph.vue`（+ `SeriesGraphCard.vue`、`SeriesEdge.vue`），
画布用项目已有的 `@vue-flow/core`（与 `BoardView` 同一套库，但不共享任何工作流节点 / store）：

**视觉与交互对齐画布工作流**（`BoardView` / `BoardNode` / `BoardEdge` 的同一套观感）：

- 分P → Vue Flow node（`type: "seriesCard"`，坐标来自 `placements(doc)`），连线 → edge
  （`type: "seriesEdge"`）。平移 / 缩放 / `fitView` 交给库；**左下角小地图 + 缩放条**（圆点
  小地图、可拖可缩、百分比步进），**底部居中工具条**和画布工作流一致：拖动画面 / 框选两种鼠标
  模式、适应画布、按时间顺序重建（仅 `custom` 时可用）。自动排列放在右键空白菜单里。
- 卡片（`SeriesGraphCard`）：封面缩略（16:9，高 108）、名字、时长、当前分P 高亮；圆角 16，
  **选中框用贴圆角的描边环**（不是直角 outline）；左右 Handle 与画布节点同款：12px 圆点、
  主色 + 辉光、悬停 / 选中才显现，位置居中贴左右边。
  - **右上角交互工具栏**（悬停 / 选中出现，画布同款胶囊）：播放 / 编辑 / 重命名 / 复制 / 删除。
    播放 = **卡片内联播放**该集最早的一条视频片段（进度条画在封面底部，同一时刻只允许一张卡在播）；
    编辑 = 跳预览、不自动播放；重命名走浮动输入框。工具栏浮在**卡片外侧**，外层留 10px 内边距并
    下压 6px 与卡片重叠，鼠标从卡片移过去不会掉出 hover 区（单纯放外面会掉、塞进卡片又不符合
    画布风格）。内联播放只播视频，不是整条时间线的合成画面。
  - **右键菜单**复用画布的 `BoardMenu`：节点 = 预览 / 改名 / 创建副本 / 复制 / 剪切 / 粘贴 /
    删除；连线 = 改选项名 / 删除连线（**右键不直接弹出选项命名面板**，只出菜单）；空白 =
    新建分P / 粘贴 / 自动排列 / 适应视图。复制 / 剪切 / 粘贴走会话级剪贴板（`useSeriesClipboard`），
    粘贴在鼠标位置生成一个 id 全换新的分P。
  - `onNodeDragStop` 把移动后的坐标一次性写回 `positions`（一次拖动 = 一个撤销步骤）。
- 连线：
  - Handle 拖到另一张卡 → `@connect` → `connectEpisode`；**拖到空白处松手 → 自动新建一集**，
    从出边拖 = 接在源后面，从入边拖 = 接在目标前面（`addConnectedEpisode`）；轻点一下
    （位移 < 16px）不触发，避免误建。
  - 边画成画布同款：渐变主曲线 + 主色辉光 + 流动亮色虚线 + 两端圆点；带 label 的边在中间画胶囊
    （`EdgeLabelRenderer`）。拖线中的连接线也用主色虚线。
  - 点击边 = 选中（加粗 + 主色，选中态由组件自己的 `selectedEdgeId` 驱动，不依赖库的选择态）；
    选中后在中点附近浮出编辑面板（`findEdge` + `getViewport` 换算屏幕坐标，夹在视口内）：
    选项名输入框（回车提交 / 失焦提交，提交才产生一次撤销记录）、**确认按钮**、删除按钮、
    `来源 → 目标` 说明。
  - `Delete` / `Backspace` 删除选中边、`Escape` 取消选中——只在焦点不在输入框时响应
    （Vue Flow 的 `delete-key-code` 设为 `null`，由组件自己处理）。
  - 画布中间**不放任何提示文案**；空图就只是一张空白画布，操作入口在工具条与右键菜单里。
- 键盘与无障碍：卡片 / 边都是 `button` 语义或带 `role="button"` + `tabindex`；焦点样式不用颜色单独表达。
- 只读模式：隐藏新建 / 删除 / 编辑 / 重建，只允许平移缩放和预览。

视觉沿用 `src/assets/main.css` 的 token（`--md-*`、`--app-*`），不新增裸色值；卡片复用现有
`series-card` 的配色语汇（surface-container-low + outline-variant 边框）。

---

## 7. 预览：播放模式与选项

### 7.1 播放模式

- `stores/layout.ts` 新增 `seriesPlayMode: "single" | "series"`，持久化，默认 `single`。
- `PreviewStage.vue` 控制条右下（画质 / 比例同一排）加 `Md3Select`：`单集播放` / `剧集播放`。
- 说明文案（`title` / `hint`）：「单集：播完停在当前分P」「剧集：按连线自动进入下一集，遇分支显示选项」。

### 7.2 剧集播放

`useSeriesPlayback.ts`（composable，读写 `project` / `playback` / `layout`）：

- `onEnded(): "stop" | "advance" | "choices"`：仅当 `layout.seriesPlayMode === "series"` 时接管，
  否则返回 `"stop"`（PreviewStage 保持现状：`playback.playing = false`）。
  - `auto` → `visited.add(当前)`；`project.switchEpisode(to)`；`playback.setPlayhead(0)`；
    返回 `"advance"`。
  - `choices` → 返回 `"choices"`，`pending = { episodeId, options }`。
  - `end` → 返回 `"stop"`，`toast(series.playback.ended)`。
  - `loop` → 返回 `"stop"`，`toast(series.playback.loop)`（「剧集绕回了「X」，自动连播已停止」）。
- **引擎衔接**（必须显式处理）：自动连播时 `playback.playing` 一直是 `true`，一直为 true 就不触发
  `watch(playing)`，而引擎已经自然结束。所以 `PreviewStage` 在 `"advance"` 分支里切集后要同步调用
  `engine.sync()`（切集的 doc 变更也会触发，但这里显式保证），再 `engine.play()`；不能只依赖 watcher。
- `choose(edgeId)` → 切到 `to`、播放头归零、继续播、清空 `pending`；`visited` 继续累加（手动选择
  不做 loop 拦截）。同样由 PreviewStage 负责 `engine.sync()` + `engine.play()`。
- `resetRun()`：**只在按下播放、切换播放模式时**重置（清空 `pending`，`visited = {当前分P}`）。
  拖动播放头只清空选项浮层、**不重置 `visited`**——自动连播切集时也会 `setPlayhead(0)`，
  若按「播放头变化」重置，循环判定会永远看不到环。打开剧集界面别的分P 后按播放即自然重置。
- 切集复用 `project.switchEpisode`（清撤销栈的既有语义），不引入「临时预览分P」。只读工程下
  `switchEpisode` 返回 `false`，此时停在当前集结束（不弹选项、不给假象）。

### 7.3 选项浮层

新组件 `src/components/series/SeriesChoices.vue`，挂在 `.stage-viewport` 内（不受画面缩放影响，
全屏可见），底部居中：

- 半透明深色胶囊容器，标题「本集结束」+ 选项按钮列（一项一行，最多高度 40vh 滚动）。
- 未命名选项显示 `选项 1`、`选项 2`……；按钮副标显示目标分P 名。
- 点击任一项 = `choose(edgeId)`；不点也能继续拖播放头回看（拖动会清空浮层）。
- 浮层 `@pointerdown.stop`，避免点按钮时触发舞台的平移 / 选中；全屏与普通模式共用同一节点。
- 单集模式不渲染此浮层。

---

## 8. 序列化与协作

- `seriesGraph` 是普通工程字段：`serializeProject()` 的 `{...doc}` 自动带上；读取时
  `normalizeSeriesGraph()` 校验，坏数据降级为 `undefined`（= 派生链），不抛错。
- 不需要改 `delete wire.*` 的投影名单（它不是访问器投影）。
- 协作：`session_publish` 的 `full` 快照已经包含整个 doc，图编辑随普通文档改动同步；
  `affected` 协议不加新字段。两端同时编辑边时按「后写覆盖」合并（与当前 sessionMerge 语义一致）。
- 撤销：边 / 位置 / 重建都进本地撤销栈；切分P 清栈的行为不变。

---

## 9. 错误与边界

| 情况 | 行为 |
|---|---|
| 悬空边（目标分P 已删） | `seriesEdges()` 过滤，画布不渲染，播放视为无出边 |
| 无选项的环（A→B→A） | 允许画；自动连播到已访问分P 时停止并提示 |
| 自环（A→A） | 允许；自动连播判定为 loop，停止 |
| 重复边（同 from/to） | 拒绝创建；已有重复数据读取时保留（不静默删用户数据） |
| 分P 只剩一个 | 连接点拖动仍可自连；删除分P 的限制不变 |
| 只读工程 | 图编辑禁用，平移缩放与预览可用 |
| 空工程 / 单集 | 画布显示空态 / 单张卡；剧集播放播完即停 |
| 旧工程无 `seriesGraph` | 派生链，零迁移；每次读取生成的边 id 稳定 |
| 时长未知的分P | 卡片显示 `00:00`（沿用 `episodeDuration`） |
| 自动布局与手动坐标混合 | 手动坐标优先；「自动排列」清空全部手动坐标 |

---

## 10. i18n（zh / en 同步新增）

```
series.view.tile / series.view.graph
series.preview
series.select
series.branchCount            "{count} 个选项"
series.orphan                 未接入
series.graph.empty            还没有连线
series.graph.emptyHint        从卡片右侧的连接点拖到另一张分P，建立播放顺序
series.graph.fit              适应视图
series.graph.autoLayout       自动排列
series.graph.rebuild          按时间顺序重建
series.graph.rebuildTitle     重建剧集连线
series.graph.rebuildMessage   这会删掉所有手动连线和选项，按分P 的当前顺序生成一条时间链。
series.graph.rebuildDone      已按时间顺序重建
series.edge.label             选项名
series.edge.labelPlaceholder  选项 {index}
series.edge.delete            删除连线
series.edge.route             "{from} → {to}"
series.choice.unnamed         选项 {index}
series.playback.ended         剧集结束
series.playback.loop          剧集绕回了「{name}」，自动连播已停止
preview.playMode              播放模式
preview.playMode.single       单集播放
preview.playMode.series       剧集播放
preview.playMode.hint         单集：播完停在本集。剧集：沿连线自动进入下一集，遇分支显示选项。
```

删除不再使用的 `series.sortManual` / `series.sortDuration` / `series.sort`（`series.timeline` 已在
工作区中被移除）。`src/i18n/__tests__` 的双语守卫与插件字典测试必须继续通过。

---

## 11. 测试计划

纯逻辑（vitest，无 DOM）：

1. `src/core/series/__tests__/graph.test.ts`
   - 派生链：3 集 → 2 条边、按 order、无 label、id 稳定；乱序 order 也正确。
   - `custom=true` 用存盘边；悬空边过滤；自环 / 多入边保留。
   - `optionsOf`：顺序、未命名标记、label 透传。
   - `stepOf`：0 边 → end；1 无 label → auto；1 带 label → choices；2 条 → choices；
     目标已访问 → loop；目标已删除 → end。
2. `src/core/series/__tests__/layout.test.ts`
   - 链式布局一条直线；分支分层（BFS 深度）；环不死循环；手动坐标优先。
3. `src/core/ops/__tests__/series.test.ts`
   - `materializeGraph`：派生链落成 `custom=true` 的边、id 保持 `chain:` 前缀、重复调用不变。
   - connect：在派生图上连一条新边后**原有时间链仍在**；置 `custom`、追加、拒绝重复 / 缺失分P；
     不修改 `tracks` 投影。
   - disconnect：派生链上的边（`chain:` id）也能删，删完其余链保留；删光后 `edges=[]` 且不回退派生链。
   - setLabel（trim、空串清除）/ moveCard（不改 custom）/ autoLayoutSeries / resetSeriesGraph。
   - `removeEpisode` 联动删边；`duplicateEpisode` 不复制边。
   - 序列化往返：`serializeProject` → `parseProject` 保留 `seriesGraph`；坏数据降级。

验证命令：

```bash
pnpm test
pnpm build
pnpm domain:golden      # 改了 src/core/ops，需重建 daemon 的 domain.js + golden
cargo test --manifest-path crates/daemon/Cargo.toml
```

（本次不改 Rust 源码；`cargo test --lib` 不需要。golden 若因打包顺序变化产生 diff，一并提交。）

---

## 12. 实施顺序

1. 类型 + `normalizeSeriesGraph` + `core/series/graph.ts` / `layout.ts` + 单测（不碰 UI）。
2. `core/ops/series.ts` + `removeEpisode` 联动 + 单测 + 序列化测试。
3. `SeriesView.vue` 拆分：`SeriesTile`（现网格，去掉排序、加双击/预览按钮/角标）+ 平铺/连线切换。
4. `SeriesGraph.vue` / `SeriesGraphCard.vue`：视口、卡片、连线创建、边选中面板、工具栏。
5. `useSeriesPlayback` + `SeriesChoices.vue` + 预览控制条播放模式 + layout 持久化。
6. i18n 双语、`pnpm test` / `pnpm build` / `domain:golden` 全绿。

---

## 13. 明确不做

- 不做自动保存剧集视口（每次进入适应视图）。
- 不做连线的曲线手工调整、不做边上的条件 / 变量 / 跳转次数。
- 不做「剧集播放」的连续无缝预加载（切集重新 sync 引擎，允许短暂黑帧）。
- 不改导出流程（导出的仍是当前分P 的时间线）。
- 不改 `Episode` 的序列化版本号（字段可选，向后兼容）。
