# 画布：显示节点单输入 · 全媒体多素材牌堆 · 素材行检查器

- 日期：2026-11-22
- 状态：**待实现**
- 目标形态：显示节点一进（可多选、单张/数组通吃）一出（当前项 + 整组）· 图片/视频/音频输入都能放多份 · 卡片用同一套牌堆与翻页 · 检查器素材统一成「一行一个」
- 相关：`src/core/board/registry.ts`、`src/core/board/schema.ts`、`src/composables/useBoardRun.ts`、`src/components/board/BoardNode.vue`、`src/components/workspace/panes/BoardInspectorPane.vue`
- 不在本设计范围：模型节点输出附件卡（已有牌堆）、跨分P 视口记忆、插件节点的端口形态

---

## 1. 问题与现状

用户实测反馈四条，逐条对到代码：

| 现象 | 根因 |
| --- | --- |
| 「显示节点两个输入都必须有值，否则报少输入」 | 显示节点有 `image`/`video`/… + `list` 两个输入（`registry.ts:58/123-190/243`）。把「图片输入节点」接到 `image` 端口时，`bundlePickScoped`（`useBoardRun.ts:~300`）只从 `values` 取值，而输入节点的素材存在 `outputAssetId` 上 → 返回 null → `display.image` 报「缺少上游素材」。只有接 `list`（数组）才通。`json → image` 本身不可连（`schema.ts` 的 `portsConnectable`），所以「单张 + 数组」必须用两个端口才能都覆盖。 |
| 视频 / 音频输入不能放多份 | 所有导入入口对非图片都是替换：`BoardNode.onNodeDrop` / `pickFiles` / `onLibraryPick`（`BoardNode.vue:583/636/707`）与检查器同名函数都写 `assetIds: undefined`；素材库对话框 `:multiple` 只对图片开（`BoardNode.vue:2163`、检查器 `:multiple="isImageNode"`）。 |
| 视频 / 音频卡片没有牌堆、翻不到后面 | `display.video/audio` 运行只发布当前一张（`useBoardRun.ts:786-800`），`runOne` 因此把 `outputAssetIds` 写成 1 项；卡片视频 / 音频模板没有 `.art-deck` / `n/m` 胶囊（只有图片有，`BoardNode.vue:1570-1610`）。 |
| 图片输入的检查器 UI 和其他输入节点不一致 | 图片走 `asset-strip` 缩略图条（`BoardInspectorPane.vue:~1490`），视频 / 音频走单行 `inspector-media`；两套视觉。 |

另外两条上游限制：

- 显示节点的 `image` 输出对下游拿不到整摞：`publishedAssetIds`（`registry.ts:846`）遇到多输出端口节点就退回单张，而显示节点有两个输出端口。
- `MAX_OUTPUTS = 12`（`useBoardRun.ts:1442`）对「很多个上游 × 每个很多张」偏小。

## 2. 端口模型

### 2.1 显示节点：一个输入

五个内置显示节点统一改成一个输入端口：

```ts
// labelKey 各用各的：display.image → board.port.image，video/audio/text/value 同理
const displayInput = (labelKey: string): BoardPortSpec =>
  ({ id: "in", type: "any", labelKey, max: 8 });
```

- `type: "any"` 是必须的：只有 `any` 能同时接受 `image`（单张）与 `json`（数组）以及其它类型，且继续保持「显示节点不锁类型」。
- `max: 8`：检查器里是多选 + 排序（和 H3 参考图同一套控件），每个来源可以是上游的单值输出，也可以是整组数组输出。
- 输出不变：当前项（`image` / `video` / `audio` / `text` / `value`）+ 整组数组（`list`）。「输入是单张还是数组」与「输出要当前还是整组」分别由输入连线、输出连线决定。
- `display.value` 现在在 `portsOf` 里特判（`registry.ts:775`），同步改成单输入。

### 2.2 迁移（旧工程）

`normalizeBoard`（`schema.ts:274`）加载 / 保存都会跑，在这里做一次性改写：

```ts
const LEGACY_DISPLAY_TYPES = new Set([
  "display.image", "display.video", "display.audio", "display.text", "display.value",
]);
// edge.target 是内置显示节点且 targetPort ∈ { image, video, audio, text, value, list }
//   → targetPort = "in"
```

- 因为 `max` 变成 8，原来「image + list」两条线都保留，不会丢线；运行时会合并、去重。
- 同一个 (source, sourcePort) 被写成两条重复边时合并成一条（幂等）。
- 只动内置五类显示节点，插件自定义的 `display.*` 不碰。
- `normalizeBoard` 的 `portTypeOf` 回调在迁移之后才判定，避免旧端口被当成悬空边丢掉。

### 2.3 不变量

- 卡片仍然只有一进一出两个 `Handle`（`docs/canvas-node-design.md` 第 1 条）。
- 输出端点仍然发布所有值（第 3 条）。**唯一例外**：显示节点的输入按「上游整摞」读，而不是按 `edge.sourcePort` 单路读——见 3.1，写进设计约束文档。

## 3. 运行链路

### 3.1 统一读取：`upstreamStackScoped(nodeId, portId, scope)`

`useBoardRun.ts` 新增（替代显示分支里 `readValue(list)` + `readAssets(image)` 的两套写法）：

```ts
function upstreamStackScoped(nodeId, portId, scope): unknown[]
```

- 取 `scope.edges.filter(target === nodeId && targetPort === portId)`，**按边顺序**遍历；
- 每条边走 `resolveFromEdge(edge, "any", …)`：旁路、显示节点透传、循环结束的槽位都沿用现有语义；
- 每个来源按下面的顺序取「整摞」：
  1. 来源节点 `data.values.list` 是数组（输入 / 显示 / 值 / 循环节点的整组输出）→ 直接用；
  2. 媒体来源：`publishedAssetIds(source, edge.sourcePort)`（模型节点一次出 4 张走这条）；
  3. 文本来源：`outputText`；
  4. 其它：`publishedValue(source, edge.sourcePort)`，数组则展开；
- 媒体只保留工程里仍存在的素材 id；最后按出现顺序去重，**保留前 `MAX_OUTPUTS` 个**（第一摞在前，顺序稳定）。

> 例外说明：第 1 步优先于 `edge.sourcePort`。显示节点的职责是「把上游这摞东西展示出来」，
> 具体要单张还是整组由它的**输出**连线决定；输入侧再按端口区分会把「一个输入」又拆回两个。
> 该例外记录在 `docs/canvas-node-design.md`。

### 3.2 显示节点适配器

| 节点 | 现在 | 改成 |
| --- | --- | --- |
| `display.image` | 先读 `list` 值，再读 `image` 素材 | `items = upstreamStackScoped(id, "in")`；`index` 取旧 `outputAssetId` 在新数组里的位置（没有就夹取 `stackIndex`）；返回 `{ assets: items, assetId: items[index], kind: "image", values: { list: items } }` |
| `display.video` / `display.audio` | 只发布当前项 | 同上，并**补 `assets: items`**，让 `outputAssetIds` 是整摞 |
| `display.text` | 先读 `list` 值，再读 `text` | 同上，`index = stackIndex`；返回 `{ text: items[index] ?? "", values: { list: items } }` |
| `display.value` | 先读 `list` 值，再读 `value` | 同上，`index = stackIndex`；返回 `{ values: { value: items[index] ?? null, list: items }, …(文本时带 text) }` |

空结果仍然报「缺少上游素材 / 缺少上游文本」，不发布空图。

### 3.3 运行发布

- `runOne` 已有 `result.assets` → `outputAssetIds` 的路径（`useBoardRun.ts:1500`），display.video/audio 补上 `assets` 即生效。
- `MAX_OUTPUTS` 12 → 24：只存素材 id，成本可忽略；「很多个」不再被截断。
- `input.image/video/audio` 共用同一个分支（已按 `assetIds` + `stackIndex`），无需改运行逻辑。

## 4. 卡片（`BoardNode.vue`）

### 4.1 当前项

- `stack`：媒体输入节点用 `assetIds`，显示节点用 `outputAssetIds`（把现有 `inputStack` 判断从「图片」放宽到所有媒体类型）。
- `primary`：输入节点一律 `stack[stackIndex]`（现在只有图片这样）；显示节点仍是 `outputAssetId`。
- `stackIndex`：输入 = `data.stackIndex`；显示 = `outputAssetId` 的下标（不变）。

### 4.2 牌堆

- 图片卡片：保持 `.art-deck` + `n/m` 胶囊（右下）。
- 视频卡片：加 `.art-deck`（纸片用视频封面 `assetThumbnailUrl`）+ `n/m` 胶囊（右上，避开播放条）；缺 `thumb` 的视频在牌堆出现时懒调 `ensureThumbnail` → `project.setAssetThumbnail`（派生数据，不进撤销）。
- 音频卡片：只加 `n/m` 胶囊（右上），不做纸叠（没有画面）。
- 胶囊点击 `stepStack(1)`：输入节点写 `stackIndex + assetId`；显示节点 `selectOutput` 换发布项（下游标过期，语义不变）。
- 媒体卡片不再渲染通用 `StackBar`（避免两个翻页器）；文本 / 值继续用。

### 4.3 导入入口（全部改成追加）

- 文件选择、拖放文件、素材库拖放、素材库对话框：`image` / `video` / `audio` 一律 append 到 `assetIds` 并切到新素材。
- `BoardMediaPicker` 的 `:multiple` 对三种媒体都开。

## 5. 检查器（`BoardInspectorPane.vue`）

### 5.1 素材区：一行一个

替换图片专用的 `asset-strip`，媒体输入与显示节点共用一套：

```
[缩略图 40×40] 名称                        [当前]  [×]
               1920 × 1080 · image
...
[ 选择本地文件 ]  [ 从素材库选择 ]
```

- 缩略图：图片用原图，视频用 `assetThumbnailUrl`，音频用音符图标；缺封面视频同样懒补。
- 「当前」标记只在多份时出现；点击行切换当前项（输入：`stackIndex + assetId`；显示：`outputAssetId`）。
- 删除按钮只对输入节点出现；显示节点只读，底部提示「展示上游发布的 N 个素材」。
- 数量文案统一成「N 个素材」：改写现有 `board.inspect.stackCount` 的文案（`zh` / `en` 同步），不新增 key。

### 5.2 输入区

- 显示节点只剩一行「`图片/视频/…` · 任意 · n/8」，走现成的多选下拉 + 排序行（和 H3 参考图一致）。
- 显示节点的下拉候选只列语义匹配的输出：媒体显示 = 对应媒体类型 + `json`（整组）+ `any`；文本显示 = `text` + `json` + `any`；值显示不筛。其余节点沿用现有规则。

## 6. i18n

`src/i18n/zh.ts` / `en.ts` 同步新增（或改写）：

- `board.inspect.displayInputHint`：「可接单个或数组；接多个上游时按顺序合成牌堆」
- `board.inspect.assetCount`：「{count} 个素材」
- `board.node.nextMedia`：「下一个」
- 改写 `board.inspect.mediaHint`：图片 / 视频 / 音频都可以堆多份，素材库可多选。
- 删除 / 保留 `board.inspect.addImages` 按实现（若不再引用则删除，两个语言文件一起）。

## 7. 测试

| 文件 | 覆盖 |
| --- | --- |
| `src/core/board/__tests__/valueNodes.test.ts` | 显示节点输入变成单个 `in`（any），输出仍是当前 + 整组 |
| `src/core/board/__tests__/connect.test.ts` | 拖线候选里显示节点的输入端口 id 改成 `in` |
| `src/core/board/__tests__/schema.test.ts` | 旧边 `image` / `list` → `in`；重复来源去重；插件 `display.*` 不被改写；幂等 |
| `src/composables/__tests__/boardRunDisplayStack.test.ts` | 多上游合并（单张 + 数组）、去重、顺序；视频显示发布整摞；`sourcePort` 选单张也能拿到整组 |
| `src/composables/__tests__/boardRunStacks.test.ts` | 文本 / 值显示走单输入；数组按下标取当前 |
| `src/stores/__tests__/board.test.ts` | 单端口 `max > 1` 的 `connect` / `bindPort` 行为（已有，补显示节点用例） |

另外：`normalizeBoard` 被 `core/serialize.ts` 引用，进了 headless domain 引擎；迁移逻辑落地后要按
`AGENTS.md` 跑 `pnpm domain:golden` 重建 `crates/daemon/assets/domain.js` 与 golden，并提交生成物。

## 8. 风险与取舍

- **显示节点输入不按 `sourcePort` 取**：牺牲了「精确挑上游某一路输出」，换来「一个输入 + 单张/数组通吃」。需要单路的用户可以在上游加一个值节点，或在显示节点的**输出**侧选。
- **旧工程两条线合并**：如果用户当时同一上游同时接了 `image` 和 `list`，迁移后会保留两条边（`max: 8`），运行时按顺序合并并去重，不会重复出图。
- **视频牌堆要补封面**：首次出现会触发 ffmpeg 抽帧；失败时纸片退化为纯色卡面，不影响主画面。
- **`MAX_OUTPUTS` 24**：输出附件卡缩略图变多，但仍是 id 列表；超过 24 的一摞会被截断（保留最近的）。
- **不迁移检查器里的手写绑定**：输入绑定来自边，迁移边即完成。

## 9. 验收清单

- [ ] 显示节点检查器只有一个输入行，接一个上游（单张）就能跑；接数组输出能出整摞；接多个上游按顺序合并。
- [ ] 图片 / 视频 / 音频输入都能一次导入 / 拖入多份，素材库多选追加而不是替换。
- [ ] 三种媒体卡片都有 `n/m` 胶囊，图片 / 视频有纸叠；点胶囊能翻到任意一张，显示节点翻牌后下游标过期。
- [ ] 显示节点的 `当前` 输出与 `整组` 输出都能被下游正确消费。
- [ ] 旧工程（`image` / `list` 两个输入都接过）打开后连线都在，运行结果与迁移前一致或更完整。
- [ ] `pnpm test` / `pnpm build` 通过。
