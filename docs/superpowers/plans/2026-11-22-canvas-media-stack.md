# 画布：显示节点单输入与全媒体多素材牌堆 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 显示节点合并成一个可多选、单张/数组通吃的输入；图片/视频/音频输入都能堆多份；卡片统一牌堆+翻页；检查器素材统一成一行一个。

**Architecture:** 端口层把五个显示节点的两个输入合为一个 `any` 端口（`max: 8`），旧端口在 `normalizeBoard` 里迁移；运行层新增 `upstreamStackScoped` 把「多上游 × 单值/数组」统一读成一摞；卡片层复用同一套 `assetIds` / `outputAssetIds` + `.art-deck` + `n/m` 胶囊；检查器复用同一套素材行组件化模板。

**Tech Stack:** TypeScript、Vue 3 `<script setup>`、Pinia、Vitest、Vue Flow。

设计文档：`docs/superpowers/specs/2026-11-22-canvas-media-stack-design.md`

## Global Constraints

- 卡片上永远只有一进一出两个 `Handle`；逻辑端口只在检查器里表达（`docs/canvas-node-design.md` 第 1、2 条）。
- 显示节点输出保持「当前项 + 整组」两路，不新增输出锚点。
- 显示节点输入**按上游整摞读**（spec 记录的例外），不按 `edge.sourcePort` 单路读。
- 所有 i18n 必须 `zh.ts` / `en.ts` 成对修改。
- 不新增 npm 依赖。
- 每个任务结束前跑对应测试；全部完成后跑 `pnpm test`、`pnpm build`、`pnpm domain:golden`。
- 提交信息用 `feat(canvas):` / `fix(canvas):` / `test(canvas):` / `docs(canvas):` 前缀。

---

### Task 1: 显示节点单输入端口 + 旧工程迁移

**Files:**
- Modify: `src/core/board/registry.ts`（`IMAGE_IN` / DISPLAY_* 定义 / `portsOf` 的 display.value 分支）
- Modify: `src/types/board.ts`（`BoardNodeDefinition.acceptTypes`）
- Modify: `src/core/board/schema.ts`（`acceptsInputType`、`normalizeBoard` 迁移）
- Modify: `src/core/board/connect.ts`（forward 候选按 `acceptTypes` 过滤）
- Modify: `src/components/board/BoardView.vue`（`targetPortOf` 按 `acceptTypes` 过滤）
- Test: `src/core/board/__tests__/registry.test.ts`、`valueNodes.test.ts`、`connect.test.ts`、`schema.test.ts`

**Interfaces:**
- Produces: `portsOf(display.*).inputs === [{ id: "in", type: "any", labelKey, max: 8 }]`
- Produces: `acceptsInputType(definition, port, from): boolean`（`@/core/board/schema`）
- Produces: 旧边 `targetPort ∈ {image,video,audio,text,value,list}` → `"in"`，`normalizeBoard` 幂等

- [ ] **Step 1: 改测试（先红）**

`src/core/board/__tests__/registry.test.ts` 里把「显示节点把输入原样透传到输出」整体替换为：

```ts
it("显示节点只有一个输入，输出仍是当前项 + 整组", () => {
  for (const type of ["display.image", "display.video", "display.audio", "display.text"]) {
    const definition = nodeDefinition(type);
    expect(definition).not.toBeNull();
    expect(definition!.inputs).toEqual([
      { id: "in", type: "any", labelKey: `board.port.${type.split(".")[1]}`, max: 8 },
    ]);
    expect(definition!.outputs.map((port) => port.id)).toEqual([type.split(".")[1], "list"]);
    expect(definition!.outputs[0].type).toBe(type.split(".")[1]);
  }
});
```

`src/core/board/__tests__/valueNodes.test.ts` 里 `display.inputs` 的期望改成：

```ts
expect(display.inputs).toEqual([
  { id: "in", type: "any", labelKey: "board.port.value", max: 8 },
]);
```

`src/core/board/__tests__/connect.test.ts` 第一例里 `candidates[0].port.id` 的期望改成 `"in"`：

```ts
expect(candidates[0].port.id).toBe("in");
```

`src/core/board/__tests__/schema.test.ts` 末尾追加：

```ts
describe("normalizeBoard: 显示节点输入端口迁移", () => {
  const nodes = [
    { id: "src", type: "input.image", position: { x: 0, y: 0 }, data: { params: {}, bindings: {} } },
    { id: "d", type: "display.image", position: { x: 300, y: 0 }, data: { params: {}, bindings: {} } },
  ];

  it("image / list 两条旧边都改写为 in，且都保留", () => {
    const board = normalizeBoard({
      nodes,
      edges: [
        { id: "e1", source: "src", sourcePort: "image", target: "d", targetPort: "image" },
        { id: "e2", source: "src", sourcePort: "list", target: "d", targetPort: "list" },
      ],
    });
    expect(board.edges.map((edge) => edge.targetPort)).toEqual(["in", "in"]);
    expect(board.edges).toHaveLength(2);
  });

  it("迁移幂等，且不碰插件自定义的 display.* 节点", () => {
    const raw = {
      nodes: [
        ...nodes,
        { id: "p", type: "display.custom", position: { x: 0, y: 300 }, data: { params: {}, bindings: {} } },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "image", target: "d", targetPort: "image" },
        { id: "e2", source: "src", sourcePort: "image", target: "p", targetPort: "list" },
      ],
    };
    const once = normalizeBoard(raw);
    expect(once.edges.find((edge) => edge.target === "p")?.targetPort).toBe("list");
    expect(normalizeBoard(once).edges).toEqual(once.edges);
  });

  it("同一 (source, sourcePort) 重复的旧边只留一条", () => {
    const board = normalizeBoard({
      nodes,
      edges: [
        { id: "e1", source: "src", sourcePort: "image", target: "d", targetPort: "image" },
        { id: "e2", source: "src", sourcePort: "image", target: "d", targetPort: "list" },
      ],
    });
    expect(board.edges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run src/core/board/__tests__/registry.test.ts src/core/board/__tests__/valueNodes.test.ts src/core/board/__tests__/connect.test.ts src/core/board/__tests__/schema.test.ts
```

Expected: FAIL（显示节点仍是 `image + list`、边没有迁移）。

- [ ] **Step 3: 改 registry：一个输入口**

`src/core/board/registry.ts`：

1. 删掉 `IMAGE_IN`（只被 `DISPLAY_IMAGE` 用），把 `LIST_IN` 保留给其它地方（`VIDEO_IN` 之类没有单独常量的话不用动）。
2. 在 `MEDIA_WIDTH` 附近新增：

```ts
/**
 * 显示节点的唯一输入口。
 *
 * 类型必须是 `any`：只有它能同时接受单张素材（`image`）和数组（`json`）——
 * `json → image` 按类型判定不可连。`max` 让检查器里可以多选多个上游，
 * 运行时按连线顺序拼成一个牌堆。
 */
function displayInput(labelKey: string): BoardPortSpec {
  return { id: "in", type: "any", labelKey, max: 8 };
}
```

3. 五个显示节点的 `inputs` 分别改成：

```ts
inputs: [displayInput("board.port.image")],   // DISPLAY_IMAGE
inputs: [displayInput("board.port.video")],   // DISPLAY_VIDEO
inputs: [displayInput("board.port.audio")],   // DISPLAY_AUDIO
inputs: [displayInput("board.port.text")],    // DISPLAY_TEXT
inputs: [displayInput("board.port.value")],   // DISPLAY_VALUE
```

4. `portsOf` 的 `display.value` 分支改成：

```ts
if (definition.type === "display.value") {
  // 显示节点不锁类型：一个 `in` 吃单值或整组，输出仍是当前值 + 整组。
  const out: BoardPortSpec = { id: "value", type: "any", labelKey: "board.port.value" };
  return { inputs: [displayInput("board.port.value")], outputs: [out, LIST_OUT] };
}
```

5. 给五个显示节点定义加 UI 过滤字段（Task 1 的 `acceptTypes`）：

```ts
// DISPLAY_IMAGE
acceptTypes: ["image", "json"],
// DISPLAY_VIDEO
acceptTypes: ["video", "json"],
// DISPLAY_AUDIO
acceptTypes: ["audio", "json"],
// DISPLAY_TEXT
acceptTypes: ["text", "json"],
// DISPLAY_VALUE 不填 = 全部
```

- [ ] **Step 4: 改类型 + 兼容判定**

`src/types/board.ts` 的 `BoardNodeDefinition` 里加：

```ts
/**
 * UI 层允许接进来的类型（端口本身仍是 `any`）。
 *
 * 显示节点的输入要能同时吃单值和数组，所以端口类型只能是 `any`；但拖线菜单
 * 和检查器下拉仍应只列语义匹配的上游。留空 = 不筛（值显示节点）。
 */
acceptTypes?: BoardPortType[];
```

`src/core/board/schema.ts` 在 `portsCompatible` 上面加：

```ts
/** 某个定义的这个输入端口能否接 `from`（端口类型 + 定义上的语义白名单）。 */
export function acceptsInputType(
  definition: BoardNodeDefinition | null | undefined,
  port: BoardPortSpec,
  from: BoardPortType,
): boolean {
  if (!portsConnectable(from, port.type)) return false;
  if (!definition?.acceptTypes || from === "any") return true;
  return definition.acceptTypes.includes(from);
}
```

`schema.ts` 顶部 type import 补 `BoardNodeDefinition`。

`src/core/board/connect.ts`：

```ts
import { acceptsInputType, portsCompatible } from "./schema";
// forward 分支
const port = definition.inputs.find((input) =>
  acceptsInputType(definition, input, anchorPort.type),
);
```

`src/components/board/BoardView.vue` 的 `targetPortOf`：

```ts
function targetPortOf(node: BoardNode, sourceType: BoardPortType): BoardPortSpec | null {
  const definition = nodeDefinition(node.type);
  const candidates = portsOf(node, portContext.value).inputs.filter((port) =>
    definition
      ? acceptsInputType(definition, port, sourceType)
      : portsCompatible(sourceType, port.type),
  );
  // …以下不动
}
```

`BoardView.vue` 顶部 import 补 `acceptsInputType`（从 `@/core/board/schema`）。

- [ ] **Step 5: 迁移旧边**

`src/core/board/schema.ts` 在 `normalizeBoard` 里、构建 `edges` 之前加：

```ts
/** 旧版显示节点的输入端口：全部并进 `in`。 */
const LEGACY_DISPLAY_PORTS = new Set(["image", "video", "audio", "text", "value", "list"]);
const BUILTIN_DISPLAY_TYPES = new Set([
  "display.image",
  "display.video",
  "display.audio",
  "display.text",
  "display.value",
]);
```

循环里把 `targetPort` 改成可改写的局部量：

```ts
const typeById = new Map(nodes.map((node) => [node.id, node.type]));
// …
for (const item of raw.edges) {
  // …id / source / target / sourcePort 校验后：
  const targetType = typeById.get(target);
  const targetPort =
    targetType && BUILTIN_DISPLAY_TYPES.has(targetType) && LEGACY_DISPLAY_PORTS.has(item.targetPort as string)
      ? "in"
      : item.targetPort;
  // …targetPort 类型校验、portTypeOf 用 targetPort
  const key = `${source}:${sourcePort}->${target}:${targetPort}`;
  if (edgeKeys.has(key)) continue;
  edgeKeys.add(key);
  edges.push({ id, source, sourcePort, target, targetPort, ...(kind ? { kind } : {}) });
}
```

注意：`portTypeOf` 那一段必须用**迁移后的** `targetPort`，否则旧端口会被当成悬空边丢掉。

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm exec vitest run src/core/board/__tests__/registry.test.ts src/core/board/__tests__/valueNodes.test.ts src/core/board/__tests__/connect.test.ts src/core/board/__tests__/schema.test.ts
```

Expected: PASS。

- [ ] **Step 7: 全量测试，找出被端口改名波及的用例**

```bash
pnpm test
```

Expected: 可能还有 `nodeRegistry.test.ts` / `portSnapshot.test.ts` 之类断言旧端口；逐个改成 `in` 或加迁移说明后重跑，直到全绿。

- [ ] **Step 8: 提交**

```bash
git add -A src/core/board src/types/board.ts src/components/board/BoardView.vue
git commit -m "feat(canvas): 显示节点合并为单个输入端口并迁移旧工程"
```

---

### Task 2: 运行链路统一读「整摞」

**Files:**
- Modify: `src/composables/useBoardRun.ts`
- Test: `src/composables/__tests__/boardRunDisplayStack.test.ts`、`boardRunStacks.test.ts`

**Interfaces:**
- Produces: `upstreamStackScoped(nodeId, portId, kind: "media" | "text" | "value", scope): unknown[]`
- Consumes: `publishedAssetIds` / `publishedAssetId` / `publishedValue` / `resolveFromEdge`（现有）
- Produces: `display.*` 适配器发布 `assets`（媒体）/ `values.list`（全部）

- [ ] **Step 1: 改测试（先红）**

`src/composables/__tests__/boardRunDisplayStack.test.ts`：

1. `wire()` 的 `targetPort` 改 `"in"`。
2. 追加多上游 / 视频两个用例：

```ts
it("多个上游合并成一个牌堆：按检查器顺序拼接并去重", async () => {
  const { board } = setup();
  const model: BoardNode = {
    id: "model",
    type: "model.image",
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {}, outputAssetIds: ["a1", "a2"], outputAssetId: "a1" },
  };
  const input: BoardNode = {
    id: "input",
    type: "input.image",
    position: { x: 0, y: 200 },
    data: {
      params: {},
      bindings: {},
      assetIds: ["a2", "a3"],
      stackIndex: 0,
      assetId: "a2",
      values: { list: ["a2", "a3"] },
    },
  };
  const display: BoardNode = {
    id: "display",
    type: "display.image",
    position: { x: 400, y: 0 },
    data: { params: {}, bindings: {} },
  };
  board.addNode(model);
  board.addNode(input);
  board.addNode(display);
  board.connect({ id: "e1", source: "model", sourcePort: "image", target: "display", targetPort: "in" });
  board.connect({ id: "e2", source: "input", sourcePort: "list", target: "display", targetPort: "in" });

  await expect(runAdapter(display, "display")).resolves.toEqual({
    assets: ["a1", "a2", "a3"],
    assetId: "a1",
    kind: "image",
    values: { list: ["a1", "a2", "a3"] },
  });
});

it("视频显示节点也发布整摞，并保持上次发布那张", async () => {
  const { board, project } = setup();
  for (const id of ["v1", "v2"]) {
    project.dispatch((doc) => addAsset(doc, image(id, "video")));
  }
  const model: BoardNode = {
    id: "model",
    type: "model.video",
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {}, outputAssetIds: ["v1", "v2"], outputAssetId: "v2" },
  };
  const display: BoardNode = {
    id: "display",
    type: "display.video",
    position: { x: 400, y: 0 },
    data: { params: {}, bindings: {}, outputAssetId: "v2" },
  };
  board.addNode(model);
  board.addNode(display);
  board.connect({ id: "e1", source: "model", sourcePort: "video", target: "display", targetPort: "in" });

  await expect(runAdapter(display, "display")).resolves.toMatchObject({
    assets: ["v1", "v2"],
    assetId: "v2",
    kind: "video",
  });
});
```

> `setup()` 里的测试素材帮助函数 `image(id)` 需要支持第二个参数：`kind` 默认 `"image"`，
> 改成 `function image(id: string, kind: MediaAsset["kind"] = "image")` 并写进 `kind` 字段；
> 视频素材给 `duration: 1`。

`src/composables/__tests__/boardRunStacks.test.ts` 里「显示节点吃数组」那条把 `targetPort` 改成 `"in"`，期望不变：

```ts
board.connect({
  id: "e1",
  source: "src",
  sourcePort: "value",
  target: "d",
  targetPort: "in",
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run src/composables/__tests__/boardRunDisplayStack.test.ts src/composables/__tests__/boardRunStacks.test.ts
```

Expected: FAIL（显示节点读的是硬编码 `list` / `image` 端口，多上游拿不到）。

- [ ] **Step 3: 写 `upstreamStackScoped`**

`src/composables/useBoardRun.ts` 在 `upstreamAssetsScoped` 的位置（约 471 行）整体替换为：

```ts
/** 显示节点读取的类型：媒体 / 文本 / 值。 */
type StackKind = "media" | "text" | "value";

/** 显示节点当前项：优先保持上次发布的那一项，其次按 `stackIndex` 夹取。 */
function displayIndex(node: BoardNode, items: unknown[]): number {
  const previous = node.data.outputAssetId;
  const at = previous ? items.indexOf(previous) : -1;
  if (at >= 0) return at;
  return Math.min(Math.max(0, node.data.stackIndex ?? 0), Math.max(0, items.length - 1));
}

/**
 * 显示节点的输入 = 上游发布的**整摞**（单值也算 1 项）。
 *
 * 同一端口可以接多个上游（`max > 1`）：按连线顺序拼接、去重。
 * 显示节点是透传的：自己没跑过就继续往上读它的输入（入口也可以有多个）。
 */
function upstreamStackScoped(
  nodeId: string,
  portId: string,
  kind: StackKind,
  scope: RunScope = globalRunScope(),
): unknown[] {
  const context = portContext();
  const project = useProjectStore();
  const items: unknown[] = [];
  const seen = new Set<string>();
  const emit = (value: unknown): void => {
    if (kind === "value") {
      items.push(value);
      return;
    }
    if (Array.isArray(value)) items.push(...value.flat(1));
    else if (value !== null && value !== undefined) items.push(value);
  };
  const emitList = (list: unknown[]): void => {
    if (kind === "value") items.push(...list);
    else items.push(...list.flat(1));
  };
  const fromEdge = (edge: BoardEdge): void => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    const source = scope.nodes.find((node) => node.id === edge.source);
    if (!source) return;
    if (source.type.startsWith("display.")) {
      const own = source.data.values?.list;
      if (Array.isArray(own) && own.length > 0) {
        emitList(own);
        return;
      }
      for (const inner of scope.edges) {
        if (inner.target === source.id) fromEdge(inner);
      }
      return;
    }
    const ref = resolveFromEdge(edge, "any", new Set(), scope);
    if (!ref) return;
    // 输入 / 显示 / 值节点的整组输出：一摞值就是它，优先于单路端口。
    const list = ref.node.data.values?.list;
    if (Array.isArray(list) && list.length > 0) {
      emitList(list);
      return;
    }
    if (kind === "media") {
      const ids = publishedAssetIds(ref.node, ref.portId, context);
      if (ids.length > 0) {
        emit(ids);
        return;
      }
      const single = publishedAssetId(ref.node, ref.portId, context);
      if (single) emit(single);
      return;
    }
    const value = publishedValue(ref.node, ref.portId);
    if (value !== null && value !== undefined) {
      emit(value);
      return;
    }
    const text = ref.node.data.outputText;
    if (typeof text === "string" && text) emit(text);
  };
  for (const edge of scope.edges) {
    if (edge.target === nodeId && edge.targetPort === portId) fromEdge(edge);
  }
  const kept =
    kind === "media"
      ? items.filter(
          (id): id is string =>
            typeof id === "string" &&
            project.doc.assets.some((asset) => asset.id === id),
        )
      : items;
  return [...new Set(kept)].slice(0, MAX_OUTPUTS);
}
```

- [ ] **Step 4: 改四个显示分支**

`runAdapter` 里把 `case "display.image"` / `display.video|audio` / `display.text` / `display.value` 换成：

```ts
case "display.image": {
  const ids = upstreamStackScoped(node.id, "in", "media", scope).filter(
    (item): item is string => typeof item === "string",
  );
  if (ids.length === 0) throw new Error("缺少上游素材：先连接并运行上游节点");
  const index = displayIndex(node, ids);
  return { assets: ids, assetId: ids[index], kind: "image", values: { list: ids } };
}

case "display.video":
case "display.audio": {
  const port = node.type.slice("display.".length) as AssetKind;
  const ids = upstreamStackScoped(node.id, "in", "media", scope).filter(
    (item): item is string => typeof item === "string",
  );
  if (ids.length === 0) throw new Error("缺少上游素材：先连接并运行上游节点");
  const index = displayIndex(node, ids);
  return { assets: ids, assetId: ids[index], kind: port, values: { list: ids } };
}

case "display.text": {
  const items = upstreamStackScoped(node.id, "in", "text", scope);
  const texts = items.filter((item): item is string => typeof item === "string");
  if (texts.length === 0) throw new Error("缺少上游文本：先连接并运行上游节点");
  const index = displayIndex(node, texts);
  return { text: texts[index] ?? "", values: { list: texts } };
}

case "display.value": {
  const items = upstreamStackScoped(node.id, "in", "value", scope);
  const index = displayIndex(node, items);
  const value = items[index] ?? null;
  return typeof value === "string"
    ? { values: { value, list: items }, text: value }
    : { values: { value, list: items } };
}
```

同时：

- 删除只有显示节点在用的 `upstreamAssetsScoped` 与 `readAssets` 包装（`const readAssets = …` 那一行）。
- `const MAX_OUTPUTS = 12;` 改成 `const MAX_OUTPUTS = 24;`，注释补一句「显示节点会把多个上游合成一摞」。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm exec vitest run src/composables/__tests__/boardRunDisplayStack.test.ts src/composables/__tests__/boardRunStacks.test.ts
```

Expected: PASS。

- [ ] **Step 6: 全量测试**

```bash
pnpm test
```

Expected: PASS（若 `boardRunLoop` / `boardRunWorkflow` 里有显示节点用例，按新端口改）。

- [ ] **Step 7: 提交**

```bash
git add src/composables/useBoardRun.ts src/composables/__tests__
git commit -m "feat(canvas): 显示节点按上游整摞读取，单输入支持多上游与数组"
```

---

### Task 3: 牌堆追加 helper + 输入节点多素材

**Files:**
- Modify: `src/core/board/stacks.ts`
- Modify: `src/components/board/BoardNode.vue`
- Test: `src/core/board/__tests__/stacks.test.ts`

**Interfaces:**
- Produces: `appendStackPatch(node: BoardNode, added: string[], current?: string): Partial<BoardNodeData>`
- Consumes: 现有 `stackOf` / `stackPatch`

- [ ] **Step 1: 写失败测试**

`src/core/board/__tests__/stacks.test.ts` 追加：

```ts
it("appendStackPatch：追加素材并把当前项切到第一张新素材", () => {
  const stack = node("input.video", { assetIds: ["a"], stackIndex: 0, assetId: "a" });
  expect(appendStackPatch(stack, ["b", "c"])).toEqual({
    assetIds: ["a", "b", "c"],
    stackIndex: 1,
    assetId: "b",
  });
});

it("appendStackPatch：没有新素材时不动数据", () => {
  expect(appendStackPatch(node("input.audio", { assetId: "x" }), [])).toEqual({});
});
```

顶部 import 补 `appendStackPatch`。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run src/core/board/__tests__/stacks.test.ts
```

Expected: FAIL（`appendStackPatch` 未导出）。

- [ ] **Step 3: 实现 helper**

`src/core/board/stacks.ts` 追加：

```ts
/**
 * 追加若干素材到牌堆末尾，并把当前项切到第一张新素材。
 *
 * 图片 / 视频 / 音频输入共用：导入、拖放、素材库都走这里，不再「图片追加、
 * 其它替换」。
 */
export function appendStackPatch(
  node: BoardNode,
  added: string[],
  current?: string,
): Partial<BoardNodeData> {
  if (added.length === 0) return {};
  const stack = stackOf(node);
  const existing = stack.items.filter(
    (item): item is string => typeof item === "string" && Boolean(item),
  );
  const ids = [...existing, ...added];
  const index = existing.length;
  return {
    assetIds: ids,
    stackIndex: index,
    assetId: current && ids.includes(current) ? current : ids[index],
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm exec vitest run src/core/board/__tests__/stacks.test.ts
```

Expected: PASS。

- [ ] **Step 5: `BoardNode.vue`：媒体栈覆盖三种类型**

1. `inputStack` 改名为 `mediaStack` 并同时服务显示节点（替换现有 `stack` 计算）：

```ts
/** 卡片上叠着的那一摞：输入节点 = 我选的，显示节点 = 上游发布的。 */
const stack = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids = isDisplay.value
    ? current.data.outputAssetIds ??
      (current.data.outputAssetId ? [current.data.outputAssetId] : [])
    : current.data.assetIds ??
      (current.data.assetId ? [current.data.assetId] : []);
  return ids.map((id) => assetById(id)).filter((asset): asset is MediaAsset => asset !== null);
});
```

2. `primary` 改成（输入媒体一律取牌堆当前项）：

```ts
const primary = computed<MediaAsset | null>(() => {
  const current = node.value;
  if (!current) return null;
  if (isDisplay.value) return assetById(current.data.outputAssetId) ?? stack.value[0] ?? null;
  if (mediaKind.value) return stack.value[stackIndex.value] ?? null;
  return assetById(current.data.outputAssetId ?? current.data.assetId);
});
```

3. `showStackBar` 对媒体关闭：

```ts
const showStackBar = computed(() => {
  const current = node.value;
  if (!current) return false;
  if (!current.type.startsWith("input.") && !current.type.startsWith("display.")) return false;
  // 图片 / 视频 / 音频用自己的牌堆胶囊，不再挂第二个翻页器。
  if (mediaKind.value) return false;
  return stackCount.value > 0 || current.type.startsWith("input.");
});
```

4. 导入全部改追加（`pickFiles`、`onNodeDrop`、`onLibraryPick` 三处）：

```ts
const patch = appendStackPatch(current, imported.map((item) => item.id));
board.updateNodeData(current.id, patch);
```

素材库拖放处：

```ts
const patch = appendStackPatch(current, [dragged.id]);
board.updateNodeData(current.id, patch);
```

5. `BoardMediaPicker` 改成三种媒体都多选：

```vue
:multiple="mediaKind !== null"
```

6. 视频 / 音频卡片加牌堆 + 胶囊。视频模板里在 `.media-video` 前插入：

```vue
<div v-if="deck.length > 0" class="art-deck" aria-hidden="true">
  <div
    v-for="(sheet, index) in deck"
    :key="sheet.id"
    class="art-deck-sheet"
    :style="deckStyle(sheet, index)"
  />
</div>
```

视频与音频在空态 `div` 之前、卡片末尾各加一个胶囊（视频/音频放右上，避开播放条；音频没有纸叠）：

```vue
<button
  v-if="stack.length > 1 && primary"
  class="art-stack-pill art-stack-pill-top nodrag"
  type="button"
  :title="i18n.t('board.node.nextMedia')"
  :aria-label="i18n.t('board.node.nextMedia')"
  @pointerdown.stop
  @click.stop="stepStack(1)"
>
  <span>{{ stackIndex + 1 }}</span>
  <span class="art-stack-sep">/</span>
  <span>{{ stack.length }}</span>
</button>
```

CSS 追加：

```css
.art-stack-pill-top {
  top: 11px;
  bottom: auto;
}
```

7. 视频封面懒补（`BoardNode.vue` script）：

```ts
import { ensureThumbnail } from "@/core/thumbnails";
// …
watch(
  () => stack.value.map((asset) => `${asset.id}:${asset.thumb ?? ""}`).join(","),
  () => {
    for (const asset of stack.value.slice(0, 4)) {
      if (asset.kind !== "video" || asset.thumb) continue;
      void ensureThumbnail(asset, (thumb) => project.setAssetThumbnail(asset.id, thumb));
    }
  },
  { immediate: true },
);
```

- [ ] **Step 6: 类型检查 + CSS token 守卫**

```bash
pnpm exec vue-tsc --noEmit -p tsconfig.json
pnpm exec vitest run src/components/board/__tests__/cssTokens.test.ts
```

Expected: 都通过。

- [ ] **Step 7: 提交**

```bash
git add src/core/board/stacks.ts src/core/board/__tests__/stacks.test.ts src/components/board/BoardNode.vue
git commit -m "feat(canvas): 图片/视频/音频输入都支持多素材牌堆与翻页"
```

---

### Task 4: 检查器素材行 + 多选输入 + i18n

**Files:**
- Modify: `src/components/workspace/panes/BoardInspectorPane.vue`
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

**Interfaces:**
- Consumes: `appendStackPatch`（Task 3）、`acceptsInputType`（Task 1）
- Produces: 媒体输入 / 显示节点共用「一行一个素材」的只读 / 可删列表

- [ ] **Step 1: i18n（先加 key，模板随后引用）**

`src/i18n/zh.ts`：

```ts
"board.node.nextMedia": "下一个",
"board.inspect.currentAsset": "当前",
"board.inspect.displayStackHint": "展示上游发布的 {count} 个素材",
"board.inspect.stackCount": "{count} 个素材",
"board.inspect.mediaHint": "从本地选择，或直接从素材库添加；素材可以堆多份、素材库可多选。",
```

`src/i18n/en.ts`：

```ts
"board.node.nextMedia": "Next",
"board.inspect.currentAsset": "Current",
"board.inspect.displayStackHint": "Showing {count} assets published upstream",
"board.inspect.stackCount": "{count} assets",
"board.inspect.mediaHint": "Pick a local file or add straight from the library; assets can stack and the library supports multi-select.",
```

删除两处 `board.inspect.addImages`（zh / en），不再引用。

- [ ] **Step 2: 检查器计算属性**

`BoardInspectorPane.vue`：

1. `stack` 同时服务输入与显示：

```ts
const stack = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids = isDisplayNode.value
    ? current.data.outputAssetIds ??
      (current.data.outputAssetId ? [current.data.outputAssetId] : [])
    : current.data.assetIds ??
      (current.data.assetId ? [current.data.assetId] : []);
  return ids
    .map((id) => project.doc.assets.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset));
});
```

2. `asset` 改成媒体输入一律取牌堆当前项：

```ts
const asset = computed(() => {
  const current = node.value;
  if (!current) return null;
  if (isDisplayNode.value) return displayAsset.value;
  if (mediaKind.value) return stack.value[stackIndex.value] ?? null;
  const id = current.data.assetId ?? current.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
```

3. `showInStack` 支持显示节点（点行 = 换发布）：

```ts
function showInStack(index: number): void {
  const current = node.value;
  const item = stack.value[index];
  if (!current || !item) return;
  if (isDisplayNode.value) {
    board.updateNodeData(current.id, { stackIndex: index, outputAssetId: item.id });
    return;
  }
  board.updateNodeData(current.id, { stackIndex: index, assetId: item.id });
}
```

4. `pickFiles` / `onPickerPick` 全部改追加（`appendToStack` 换成 helper）：

```ts
const patch = appendStackPatch(current, [assetId]);
```

素材库：

```ts
const patch = appendStackPatch(current, picked);
```

5. `bindingOptions` 按 `acceptTypes` 过滤：

```ts
function bindingOptions(port: BoardPortSpec): SelectOption[] {
  const definition = node.value ? nodeDefinition(node.value.type) : null;
  const compatible = upstreamOutputs.value.filter((item) =>
    acceptsInputType(definition, port, item.type),
  );
  return [
    { id: "", label: i18n.t("board.inspect.unconnected") },
    ...compatible.map((item) => ({ id: `${item.nodeId}:${item.portId}`, label: item.label })),
  ];
}
```

同时把 `UpstreamOutput.type` 从 `string` 改成 `BoardPortType`（`upstreamOutputs` 里 push 的就是端口类型，不用强转）。

顶部 import 补 `acceptsInputType`（`@/core/board/schema`）与 `appendStackPatch`（`@/core/board/stacks`）。

- [ ] **Step 3: 模板：素材区改成行列表**

把 `<!-- 素材 -->` 里「图片 `asset-strip` / 非图片单行 / 显示节点只读」三段整体替换为：

```vue
<template v-if="mediaKind">
  <div class="inspector-media-block">
    <div v-if="stack.length > 0" class="asset-rows">
      <div
        v-for="(item, index) in stack"
        :key="item.id"
        class="asset-row"
        :data-active="index === stackIndex ? 'true' : 'false'"
      >
        <button class="asset-row-main" type="button" :title="item.name" @click="showInStack(index)">
          <span class="asset-row-thumb">
            <img
              v-if="item.kind !== 'audio' && assetThumbnailUrl(item)"
              :src="assetThumbnailUrl(item)!"
              :alt="item.name"
            />
            <component :is="item.kind === 'audio' ? MusicalNoteIcon : PhotoIcon" v-else />
          </span>
          <span class="asset-row-copy">
            <strong>{{ item.name }}</strong>
            <span>{{ mediaMeta(item) }}</span>
          </span>
          <span v-if="stack.length > 1 && index === stackIndex" class="asset-row-current">
            {{ i18n.t("board.inspect.currentAsset") }}
          </span>
        </button>
        <button
          v-if="!isDisplayNode"
          class="asset-row-remove"
          type="button"
          :aria-label="i18n.t('common.remove')"
          @click.stop="removeFromStack(item.id)"
        >
          <XMarkIcon />
        </button>
      </div>
    </div>

    <p v-if="stack.length === 0" class="inspector-hint">
      {{ i18n.t("board.inspect.noMedia") }}
    </p>
    <p v-else-if="isDisplayNode" class="inspector-hint">
      {{ i18n.t("board.inspect.displayStackHint", { count: stack.length }) }}
    </p>

    <div v-if="!isDisplayNode" class="inspector-inline-actions">
      <button class="md-button" data-variant="outlined" type="button" @click="pickFiles">
        <FolderOpenIcon />
        {{ i18n.t("board.inspect.pickFile") }}
      </button>
      <button class="md-button" data-variant="outlined" type="button" @click="pickerOpen = true">
        <PhotoIcon />
        {{ i18n.t("board.inspect.pickAsset") }}
      </button>
    </div>
    <p v-if="!isDisplayNode" class="inspector-hint">{{ i18n.t("board.inspect.mediaHint") }}</p>
  </div>
</template>
```

`BoardMediaPicker` 的 `:multiple` 改成 `"mediaKind !== null"`。

- [ ] **Step 4: 样式替换**

删掉 `.asset-strip` / `.asset-thumb*` 相关规则，换成：

```css
.asset-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background: rgb(var(--md-surface-container-low) / 0.6);
  padding: 4px 6px 4px 4px;
}
.asset-row[data-active="true"] {
  border-color: rgb(var(--md-primary) / 0.7);
  background: rgb(var(--md-primary-container) / 0.28);
}
.asset-row-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  color: inherit;
  padding: 0;
}
.asset-row-thumb {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: rgb(var(--md-surface-container) / 0.9);
  color: rgb(var(--md-on-surface-variant));
}
.asset-row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.asset-row-thumb svg {
  width: 18px;
  height: 18px;
}
.asset-row-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.asset-row-copy strong {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-row-copy span {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 9px;
  color: rgb(var(--md-on-surface-variant));
}
.asset-row-current {
  flex: none;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgb(var(--md-primary) / 0.18);
  color: rgb(var(--md-primary));
}
.asset-row-remove {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
}
.asset-row-remove:hover {
  background: rgb(var(--md-error) / 0.16);
  color: rgb(var(--md-error));
}
.asset-row-remove svg {
  width: 13px;
  height: 13px;
}
```

- [ ] **Step 5: 检查器里的显示节点输入行**

显示节点只有一个输入，走现成的多选分支即可；确认 `inputCapacity` / `bindings` 文案正确、`bindingOptions` 过滤后不再出现第二个「整组」行。删除模板里 `isImageNode` 专用的素材提示（`aspectHint` 那段可保留给输入节点）。

- [ ] **Step 6: 类型检查 + 全量构建**

```bash
pnpm exec vue-tsc --noEmit -p tsconfig.json
pnpm exec vitest run src/components/board/__tests__/cssTokens.test.ts
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/workspace/panes/BoardInspectorPane.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(canvas): 检查器素材统一成行列表，显示节点单输入多选"
```

---

### Task 5: 文档、golden 与全量验收

**Files:**
- Modify: `docs/canvas-node-design.md`（记录显示节点输入例外）
- Regenerate: `crates/daemon/assets/domain.js` 与 golden 产物（`pnpm domain:golden`）
- Verify: `pnpm test`、`pnpm build`

- [ ] **Step 1: 记录例外**

`docs/canvas-node-design.md` 第 3 条末尾追加：

```md
例外（2026-11-22）：显示节点（`display.*`）的输入是**复合端口**——一个 `in` 端口
可接多个上游，并优先读取上游发布的整组数组。因此显示节点的读取不按
`edge.sourcePort` 单路取；要挑单张还是整组，改在显示节点的**输出**连线里选。
```

- [ ] **Step 2: 重建 domain golden**

```bash
pnpm domain:golden
git status --short crates/daemon/assets/domain.js crates/daemon/tests/fixtures/expected.json
```

Expected: `domain.js` 与 golden 产物有变更（`normalizeBoard` 的迁移逻辑进了引擎），一并提交。

- [ ] **Step 3: 全量测试与构建**

```bash
pnpm test
pnpm build
```

Expected: 全绿；`vue-tsc` 无错误。

- [ ] **Step 4: 手动验收（画布）**

在 `pnpm tauri dev` 里逐条走 spec 第 9 节验收清单，确认：

- 显示节点只接一个图片输入节点即可运行，不再报「缺少上游素材」；
- 图片 / 视频 / 音频输入一次导入多份，卡片右上 `n/m` 能翻到任意一张；
- 显示节点接多个上游时按检查器顺序合成牌堆；
- 旧工程打开后两条旧连线都在。

- [ ] **Step 5: 提交**

```bash
git add docs/canvas-node-design.md crates/daemon/assets/domain.js crates/daemon/tests/fixtures/expected.json
git commit -m "docs(canvas): 记录显示节点复合输入例外并重建 domain golden"
```

---

## Self-Review

- **Spec 覆盖**：端口合并 + 迁移（Task 1）；统一整摞读取 / 视频音频发布整摞 / `MAX_OUTPUTS`（Task 2）；牌堆 helper + 三种媒体多素材 / 纸叠 / 胶囊 / 懒封面（Task 3）；检查器素材行 / 多选输入 / i18n（Task 4）；文档 / golden / 验收（Task 5）。
- **占位符**：无 TBD / TODO；每个代码步骤都给了可落地的片段。
- **命名一致性**：`upstreamStackScoped`、`displayIndex`、`appendStackPatch`、`acceptsInputType`、`MAX_OUTPUTS` 在任务间保持一致。
- **已知取舍**：`acceptTypes` 只影响 UI（拖线候选 / 检查器下拉 / 连接校验），不改 `portsCompatible` 的全局语义，避免影响插件与模型节点。
