# 画布节点：素材尺寸自适应 · 多图牌堆 · 首次进入自动适应画布

- 日期：2026-11-18
- 状态：**已实现**
- 目标形态：视频 / 图片卡按素材原始比例自适应高度 · 图片显示节点支持多图牌堆 · 重启后第一次进入画布自动居中
- 相关：`src/core/board/mediaFit.ts`（新）、`BoardNode.vue`、`BoardView.vue`、`useBoardRun.ts`、`core/board/registry.ts`
- 不在本设计范围：模型节点输出附件卡的视觉改造（已有牌堆）、视频显示节点的多视频牌堆、跨分P 视口记忆

---

## 1. 问题与目标

画布上的素材卡（图片 / 视频）是「卡片外缘就是作品本身」的 art-card，卡片与画面必须同形，
否则 `object-fit: contain` 会留黑边。现状有三处不齐：

1. **视频完全没有适配**：`onVideoMeta` 只取时长，视频卡永远停在默认高度（260），
   竖屏视频被压成一条、超宽视频留大片黑边。
2. **显示节点跟不上产物**：图片显示节点靠 `<img>` 的 `@load` 兜底，运行产出落地后
   要等图片解码才改高度；ffprobe 读不到宽高（部分容器）时更不会动。
3. **显示节点只有一张图**：模型节点一次出 4 张时，显示节点只发布 `outputAssetId` 那一张，
   输入节点有牌堆、显示节点没有，卡片视觉不一致。

另外，重启后进入画布沿用上次保存的视口——换了分辨率 / 窗口尺寸后工作流可能落在屏幕外。

目标：

1. 视频卡与图片卡**同一套**适配：宽度不变，高度按素材原始比例，140–1200 夹取。
2. 适配由**素材元数据**驱动（不等媒体加载），`@load` / `@loadedmetadata` 只作兜底。
3. 图片显示节点接住上游**整摞**产物，按牌堆叠放，胶囊切换「当前发布」那张。
4. 本进程第一次进入画布时自动 `fitView`，之后不再打扰。

非目标：

- 不改模型节点输出附件卡（`node-output-deck` 已经是牌堆）。
- 不做视频 / 音频的多份牌堆（一个节点仍只发布一份）。
- 不改手动「适应画布」按钮的行为。

---

## 2. 关键事实（实现前已核对）

| 事实 | 结论 |
| --- | --- |
| `BoardNode.mediaHeight()` 与 `BoardView.fitNodeToAsset()` 各写了一遍「宽度不变、按比例、140–1200」 | 提成纯函数 `core/board/mediaFit.ts`，两处共用 |
| `MediaAsset.width/height` 由 `probe_media`（ffprobe）写入，图片 / 视频都有 | 适配可以完全由元数据驱动，不必等媒体加载 |
| `input.image` 已有牌堆：`assetIds` + `stackIndex` + `.art-deck` + `n / m` 胶囊 | 显示节点复用同一套视觉，只换数据源 |
| 单端口节点的产物整摞存在 `outputAssetIds`，当前发布是 `outputAssetId` | 显示节点读它做牌堆；`publishedAssetIds` 是唯一取法 |
| 多端口节点（分离 / 解复用）各端口只有一张 | `publishedAssetIds` 对多端口退回「按端口取一张」 |
| `resolveUpstream` 让显示节点「透传」：下游直接读它上游已发布的值 | 牌堆也要顺着这条解析，不能只认直接上游 |
| Vue Flow 1.48 提供 `onNodesInitialized`（全部节点测量完成才触发） | 首次 `fitView` 挂在它上面，空画布 / 未测量时不会 fit 到错位置 |
| `BoardView` 在切视图时会卸载重建（`StageView` 的 `v-else-if`） | 「第一次」必须记在**模块级**变量，不能放组件内 |

---

## 3. 素材尺寸自适应

新增 `src/core/board/mediaFit.ts`（纯函数，无 Vue / store 依赖）：

```ts
export const MEDIA_MIN_HEIGHT = 140;
export const MEDIA_MAX_HEIGHT = 1200;

export function mediaHeight(width, naturalWidth?, naturalHeight?): number
export function mediaNodeSize(width, naturalWidth?, naturalHeight?): { width; height }
export function sameMediaSize(current, next, tolerance = 2): boolean
```

规则：

- **宽度不变**（沿用节点当前宽度 / 定义里的默认宽度），只改高度；
- 高度 = `round(width * naturalHeight / naturalWidth)`，夹在 140–1200；
- 读不到素材尺寸时用兜底比例 0.66（接近 3:2）；
- ±2px 内视为一致，不写回（图片 `@load`、元数据 watch、用户拖拽三者互相不打架）。

三个触发点：

| 触发点 | 位置 | 说明 |
| --- | --- | --- |
| 素材元数据变化 | `BoardNode` 的 `watch([primary.id, primary.width, primary.height, nodeWidth])` | 拖入 / 选择 / **运行产出**落地立刻适配，显示节点靠这条 |
| 图片解码完成 | `<img @load>` | ffprobe 读不到宽高时兜底（SVG / HEIC） |
| 视频元数据 | `<video @loadedmetadata>` → `videoWidth/videoHeight` | 同上；`imageUrl ?? mediaSrc` 作为去重 key |

`BoardView.fitNodeToAsset()`（拖素材到空白处新建节点）改用 `mediaNodeSize`，删掉重复的夹取。

写入走 `board.resizeNode(..., { record: false })`：这是渲染的自然结果，不进撤销栈，
但仍会排写回工程。

---

## 4. 图片显示节点多图牌堆

### 4.1 运行链路

- `AdapterResult` 新增 `assets?: string[]`：**已入库**素材 id 的整摞（不入库、不复制文件）。
- `display.image` 的运行分支改为收集上游整摞：

```ts
const upstream = upstreamAssets(node.id, "image");   // { ids, primary }
return { assets: upstream.ids, assetId: upstream.primary, kind: "image" };
```

- `upstreamAssets()` 顺着 `resolveUpstream` 解析（显示节点透传、旁路都算），
  用 `publishedAssetIds()` 取整摞、`publishedAssetId()` 取当前发布那张，并过滤掉已删除的素材。
- `runOne` 发布时优先用 `result.assets` 作为 `outputAssetIds`，`outputAssetId` 仍由
  `outputs[firstPort]`（= `registerOutputs` 的 `primary` = `result.assetId`）决定。

### 4.2 `publishedAssetIds`（registry）

```ts
publishedAssetIds(node, portId, context): string[]
```

- 单端口：`outputAssetIds` 去重；`outputAssetId` 不在列表里就补到最前（旧文档只有单张）；
- 多端口：退回 `publishedAssetId` 的单张语义。

### 4.3 卡片渲染

`BoardNode` 把牌堆拆成两个来源，只在取「当前张」时分开：

| | 输入节点 | 显示节点 |
| --- | --- | --- |
| 数据 | `data.assetIds` | `data.outputAssetIds` |
| 当前张 | `data.stackIndex` | `data.outputAssetId` 的下标 |
| 切换 | 写 `stackIndex` + `assetId` | 写 `outputAssetId`（= 换发布，下游标记过期） |

- 纸叠 `.art-deck` / `.art-deck-sheet` 与 `n / m` 胶囊**复用输入节点那套样式**，
  胶囊的显示条件从「输入节点且有 2 张以上」放宽为「有 2 张以上」。
- 追加 / 删除素材（`pickFiles` / 拖放 / 素材库）仍然只对输入节点生效，
  走独立的 `inputStack`，不会被显示节点的产物污染。

---

## 5. 重启后首次进入画布自动适应

`BoardView` 模块级标记 + Vue Flow 的 `onNodesInitialized`：

```ts
let fittedOnEnter = false;

function fitOnFirstEnter(): void {
  if (fittedOnEnter) return;
  if (board.nodes.length === 0) return;   // 空画布不 fit，等节点到了再说
  fittedOnEnter = true;
  void fitView({ padding: 0.2, duration: 260 }).then((done) => {
    if (!done) return;
    const viewport = getViewport();
    board.setViewport(viewport);   // 写回工程，下次打开不跳
    liveZoom.value = viewport.zoom; // 右上角百分比同步
  });
}

onNodesInitialized(fitOnFirstEnter);
```

- **模块级**而不是组件级：切到预览台再切回画布会重新挂载，但只有重启后第一次要自动居中；
- 等 `onNodesInitialized`（尺寸测量完成）再 fit：空画布 / 未测量时 `fitView` 的包围盒是错的；
- 画布为空时**不置位**，节点后来加载完成再 fit；
- 手动「适应画布」按钮、`addNode` 里「只有一个节点时 fit」的行为都不变。

---

## 6. 测试

| 文件 | 覆盖 |
| --- | --- |
| `src/core/board/__tests__/mediaFit.test.ts` | 比例换算、140/1200 夹取、无元数据兜底、取整、±2px 容差 |
| `src/core/board/__tests__/registry.test.ts` | `publishedAssetIds`：整摞 / 单张兜底 / 当前发布不在列表时补最前 |
| `src/composables/__tests__/boardRunDisplayStack.test.ts` | 图片显示节点运行发布整摞、旧文档单张、无上游报错 |

---

## 7. 风险与取舍

- **适配会覆盖用户手动高度**：图片 / 视频节点本身 `lockAspectRatio`，拖拽只改宽度、
  高度由比例算，所以自动适配与手动缩放结果一致；±2px 容差避免抖动。
- **首次 fit 与媒体加载的先后**：工程里已经存了正确的节点尺寸，重启时不会再有尺寸变化，
  fit 的包围盒是准的；只有「旧文档里尺寸还是默认值」这种极端情况会有轻微偏移，
  用户手动点一次「适应画布」即可。
- **显示节点翻牌会标记下游过期**：与模型节点切换产物语义一致（用户已确认此取舍）。

---

## 8. 后续修复（同一天反馈的两个回归）

### 8.1 文本显示节点拖不动

`.node-text-display` 整张卡是 `nodrag nowheel`，而 `.node-label` 是 `pointer-events: none`，
所以文本显示节点**没有任何可拖动的地方**（P15–P16 加 `nodrag` 时引入）。

取舍：显示节点是「阅读面」，但拖动是画布的核心交互。最终选择**整张卡可拖**：

- 去掉 `.node-text-display` / `.node-markdown` / `.node-text-plain` 上的 `nodrag`，
  保留容器上的 `nowheel`（滚轮仍然滚卡片，不缩放画布）；
- 卡片加 `user-select: none`：拖拽时不会变成「拖到一半在选字」；
- 代价是不能在显示卡上划词复制，所以悬停控制里补了一个「复制全部文本」按钮
  （`copyDisplayText` → `textPreview`）；模型节点输出附件卡仍是 `nodrag`，可以在那里划词。

输入文本节点的 `<textarea>` 必须保留 `nodrag`（要打字），拖动走卡片 12px 边框 + 页脚。

### 8.2 重启后第三方节点不可见

根因：`nodeDefinition()` 读的是普通 Map，**不是响应式的**。插件是 `App.vue` 里
`refresh().then(loadEnabled)` 异步装的，晚于画布挂载；此时 `ext.*` 节点查不到定义，
`BoardNode` 的 `v-if="node && definition"` 整张卡不渲染，而 `computed` 又不会因为
插件注册而失效——只有等到某次偶然让节点对象换了引用（加节点 / 连线 / 切视图重挂载）
才恢复。

修复：

1. `core/board/registry.ts` 增加 `boardRegistryRevision()`（`shallowRef` 计数器），
   `registerNodeDefinition` 与它的 disposer 各 +1；
2. 所有「读定义」的 `computed` 读一次版本号：`BoardNode` 的 `definition` / `ports`、
   `BoardInspectorPane` 的 `definition`、`BoardView` 的「添加节点」分组 `groups`；
3. `BoardView` `watch(boardRegistryRevision, syncNodes)`：插件节点创建时没存 `size`，
   尺寸来自 `defaultSize`，定义晚到要再同步一次；
4. 定义确实缺失（插件被禁用 / 加载失败）时不再渲染空白：`.node-unknown` 占位卡
   写明「节点定义缺失」+ 节点类型，端口走 `data.ports` 快照，节点仍可选中 / 移动 / 删除，
   插件恢复后自动变成正常卡片。

回归测试：`nodeRegistry.test.ts` 用 `computed` 复刻组件里的读法，断言注册后拿到定义、
注销后回到 `null`（不读版本号的话这个 computed 永远缓存 `null`）。
