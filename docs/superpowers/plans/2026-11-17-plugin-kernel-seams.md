# 插件内核接缝（M0）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何用户可见行为的前提下，把内核里九处「写死的扩展点」改成可注册、可注销的表，为后续插件运行时（M1–M4）铺好接缝。

**Architecture:** 每个接缝都是「一张 Map + 一个返回 disposer 的 register 函数 + 一个查询函数」。所有注册单元都遵循同一纪律：注册即可逆，注销后不留痕；重复注册硬报错并指出占用者。内置行为全部走「先查表、再走旧分支」的顺序，保证 M0 期间功能零变化。

**Tech Stack:** Vue 3 + TypeScript + Pinia + Vitest（前端）、Rust + rquickjs（daemon，本计划只动 `capabilities.rs`）。

**设计依据：** [`docs/superpowers/specs/2026-11-17-plugin-architecture-design.md`](../specs/2026-11-17-plugin-architecture-design.md)

## 计划系列

| 计划 | 里程碑 | 交付 |
| --- | --- | --- |
| **本篇** | M0 | 内核接缝（本文件），行为不变、测试全绿 |
| 待写 | M1 | 加载器与生命周期：`linked` 客户端半插件能出现节点/命令并禁用 |
| 待写 | M2 | 宿主半：QuickJS actor + `ctx.http/media/jobs/storage` |
| 待写 | M3 | 商店：索引抓取、安装事务、更新/卸载、安全模式 |
| 待写 | M4 | 第二批注入点 + 私有 H3 插件落地 |

## Global Constraints

- 不新增运行时依赖：本计划的改动只能用现有依赖（Vue 3 / Pinia / Vitest）。不引入新 npm 包。
- 内置行为零变化：M0 完成后，`pnpm build`、`pnpm test` 全绿，画布手测与改造前一致。
- 命名空间：插件节点类型必须以 `ext.` 前缀；插件服务名必须以 `plugin.` 前缀。违反即拒绝注册。
- 注册纪律：每个 register 函数都返回 `() => void` disposer；重复注册抛错，错误消息必须包含「已被谁占用」。
- i18n：内核新增文案必须同时加到 `src/i18n/zh.ts` 与 `src/i18n/en.ts`，key 按既有域前缀（`board.*` / `menu.*` / `caps.*`）。
- 提交粒度：每个任务一次 commit，消息用 `refactor(board):` / `feat(core):` 前缀。
- 测试命令：`pnpm test`（前端）、`cargo test --manifest-path crates/daemon/Cargo.toml`（Rust）。

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/core/board/adapters.ts` | 节点执行器注册表（按 `type` 查 `AdapterFn`） | 新建 |
| `src/core/board/liveRuns.ts` | 运行态内存表（进度/消息/开始时间），从 `useBoardRun` 抽出 | 新建 |
| `src/core/board/runSignals.ts` | 每节点 `AbortSignal` 管理 | 新建 |
| `src/core/commands.ts` | 命令表（id / 键位 / 生效条件 / 执行） | 新建 |
| `src/core/board/registry.ts` | 节点定义注册表 | 修改：加 `registerNodeDefinition`、`nodesByCategory` 守卫、`portsOf` 快照回退 |
| `src/core/board/scheduler.ts` | 泳道与资源估算 | 修改：`nodeCost` 先查 `definition.cost` |
| `src/core/board/schema.ts` | 画布文档归一化 | 修改：`normalizeNode` 保 `data.ports` |
| `src/types/board.ts` | 画布类型 | 修改：`BoardNodeDefinition.cost`、`BoardNodeData.ports` |
| `src/composables/useBoardRun.ts` | 画布执行 | 修改：分发查表、注入 `signal` 与 `io`、进度走 `liveRuns` |
| `src/core/shortcuts.ts` | 全局快捷键 | 修改：先查命令表 |
| `src/i18n/translate.ts` | 纯查表翻译 | 修改：插件词典注册 |
| `crates/daemon/src/capabilities.rs` | 能力表 | 修改：加 `plugin` 键 |
| `src/core/board/__tests__/adapters.test.ts` 等 | 测试 | 新建 |

---

### Task 1: 适配器注册表（K1）

**Files:**
- Create: `src/core/board/adapters.ts`
- Test: `src/core/board/__tests__/adapters.test.ts`

**Interfaces:**
- Produces:
  - `interface AdapterResult { paths?: string[]; pathByPort?: Record<string, string>; assetByPort?: Record<string, string>; assetId?: string; text?: string; reasoning?: string; kind?: AssetKind }`
  - `interface AdapterIO { param<T>(id: string): T | undefined; text(portId: string): string | null; asset(portId: string): { path: string; assetId: string } | null; refs(kind: AssetKind): string[]; progress(value: number, message?: string): void }`
  - `type AdapterFn = (input: { node: BoardNode; nodeId: string; signal: AbortSignal; io: AdapterIO }) => Promise<AdapterResult>`
  - `registerAdapter(type: string, fn: AdapterFn): () => void`
  - `adapterFor(type: string): AdapterFn | null`
  - `pluginNodeType(type: string): boolean`（`type.startsWith("ext.")`）
- Consumes: 无（本任务是叶子）

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/adapters.test.ts
import { describe, expect, it, vi } from "vitest";
import { adapterFor, pluginNodeType, registerAdapter } from "../adapters";
import type { BoardNode } from "@/types/board";

function node(type: string): BoardNode {
  return { id: "n1", type, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data: { params: {}, bindings: {} } };
}

describe("adapter registry", () => {
  it("registers and resolves an adapter", async () => {
    const fn = vi.fn(async () => ({ text: "ok" }));
    registerAdapter("ext.demo.hello", fn);
    expect(adapterFor("ext.demo.hello")).toBe(fn);
  });

  it("returns null after the disposer runs", () => {
    const dispose = registerAdapter("ext.demo.temp", async () => ({}));
    dispose();
    expect(adapterFor("ext.demo.temp")).toBeNull();
  });

  it("rejects a duplicate type and names the occupier", () => {
    registerAdapter("ext.demo.dup", async () => ({}));
    expect(() => registerAdapter("ext.demo.dup", async () => ({}))).toThrow(/ext\.demo\.dup/);
  });

  it("rejects the same type registered by a different owner", () => {
    const dispose = registerAdapter("ext.demo.owned", async () => ({}), "plugin-a");
    expect(() => registerAdapter("ext.demo.owned", async () => ({}), "plugin-b")).toThrow(/plugin-a/);
    dispose();
  });

  it("recognises plugin node types by the ext. prefix", () => {
    expect(pluginNodeType("ext.demo.hello")).toBe(true);
    expect(pluginNodeType("model.video")).toBe(false);
  });

  it("adapter receives node, signal and io", async () => {
    const seen: unknown[] = [];
    registerAdapter("ext.demo.ctx", async (input) => {
      seen.push(input.node.id, input.signal.aborted, typeof input.io.progress);
      return {};
    });
    const controller = new AbortController();
    await adapterFor("ext.demo.ctx")!({
      node: node("ext.demo.ctx"),
      nodeId: "n1",
      signal: controller.signal,
      io: { param: () => undefined, text: () => null, asset: () => null, refs: () => [], progress: () => {} },
    });
    expect(seen).toEqual(["n1", false, "function"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/adapters.test.ts`
Expected: FAIL —`Cannot find module '../adapters'`

- [ ] **Step 3: 写最小实现**

```ts
// src/core/board/adapters.ts
/**
 * 画布节点执行器注册表。
 *
 * 内置节点仍由 `useBoardRun` 的旧分支执行；插件节点通过这里注册。
 * 分发顺序是「先查表，再走内置」——M0 期间这样能保证内置行为零变化，
 * M1 起可以把内置分支逐个迁进同一张表。
 */
import type { BoardNode } from "@/types/board";
import type { AssetKind } from "@/types/project";

export interface AdapterResult {
  paths?: string[];
  pathByPort?: Record<string, string>;
  assetByPort?: Record<string, string>;
  assetId?: string;
  text?: string;
  reasoning?: string;
  kind?: AssetKind;
}

/** 插件适配器能用到的输入/输出能力（由宿主构造，插件不碰 store）。 */
export interface AdapterIO {
  param<T>(id: string): T | undefined;
  text(portId: string): string | null;
  asset(portId: string): { path: string; assetId: string } | null;
  refs(kind: AssetKind): string[];
  progress(value: number, message?: string): void;
}

export type AdapterFn = (input: {
  node: BoardNode;
  nodeId: string;
  signal: AbortSignal;
  io: AdapterIO;
}) => Promise<AdapterResult>;

interface Entry {
  fn: AdapterFn;
  owner: string;
}

const ADAPTERS = new Map<string, Entry>();

/** 注册一个节点执行器；返回 disposer。重复注册抛错并指出占用者。 */
export function registerAdapter(type: string, fn: AdapterFn, owner = "core"): () => void {
  const existing = ADAPTERS.get(type);
  if (existing) {
    throw new Error(`节点执行器 ${type} 已被 ${existing.owner} 注册，不能重复注册`);
  }
  ADAPTERS.set(type, { fn, owner });
  return () => {
    if (ADAPTERS.get(type)?.fn === fn) ADAPTERS.delete(type);
  };
}

export function adapterFor(type: string): AdapterFn | null {
  return ADAPTERS.get(type)?.fn ?? null;
}

/** 插件节点类型统一以 `ext.` 前缀命名。 */
export function pluginNodeType(type: string): boolean {
  return type.startsWith("ext.");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/board/__tests__/adapters.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 全量前端测试确认没影响**

Run: `pnpm test`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/core/board/adapters.ts src/core/board/__tests__/adapters.test.ts
git commit -m "feat(board): 节点执行器注册表（插件适配器接缝）"
```

---

### Task 2: 分发改查表（K1 落地）

**Files:**
- Modify: `src/composables/useBoardRun.ts`（`runAdapter` 入口，约 369 行；`AdapterResult` 定义约 58 行）
- Modify: `src/core/board/adapters.ts`（若无改动则跳过）
- Test: `src/core/board/__tests__/dispatch.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `adapterFor` / `pluginNodeType` / `AdapterIO`
- Produces: `dispatchAdapter(type: string): "plugin" | "builtin" | "unknown"`（纯函数，便于单测）

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/dispatch.test.ts
import { describe, expect, it } from "vitest";
import { dispatchAdapter, registerAdapter } from "../adapters";

describe("adapter dispatch order", () => {
  it("routes a registered plugin type to the table", () => {
    registerAdapter("ext.demo.routed", async () => ({}));
    expect(dispatchAdapter("ext.demo.routed")).toBe("plugin");
  });

  it("routes a known builtin type to the legacy branch", () => {
    expect(dispatchAdapter("model.video")).toBe("builtin");
  });

  it("reports an unknown type as unknown", () => {
    expect(dispatchAdapter("ext.never.registered")).toBe("unknown");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/dispatch.test.ts`
Expected: FAIL —`dispatchAdapter is not a function`

- [ ] **Step 3: 在 `adapters.ts` 追加分发判定**

```ts
/** 内置节点的类型白名单（M1 起逐项迁进注册表后收缩）。 */
const BUILTIN_TYPES = new Set([
  "input.image", "input.video", "input.audio", "input.text",
  "display.image", "display.video", "display.audio", "display.text",
  "model.image", "model.video", "model.tts", "model.asr",
  "model.text", "model.enhance", "model.separate", "model.demux",
  "group",
]);

/** 一个节点类型该走哪条执行路径。 */
export function dispatchAdapter(type: string): "plugin" | "builtin" | "unknown" {
  if (adapterFor(type)) return "plugin";
  if (BUILTIN_TYPES.has(type)) return "builtin";
  return "unknown";
}
```

- [ ] **Step 4: 让 `useBoardRun` 先查表**

把 `useBoardRun.ts:369` 的 `async function runAdapter(node, nodeId)` 签名改为带 `signal`，并在函数体最前面插入查表分支：

```ts
import { adapterFor, dispatchAdapter, type AdapterIO } from "@/core/board/adapters";

async function runAdapter(
  node: BoardNode,
  nodeId: string,
  signal: AbortSignal,
): Promise<AdapterResult> {
  const route = dispatchAdapter(node.type);
  if (route === "plugin") {
    const io: AdapterIO = {
      param: <T,>(id: string) => node.data.params[id] as T | undefined,
      text: (portId) => upstreamText(nodeId, portId),
      asset: (portId) => {
        const found = upstreamAsset(nodeId, portId);
        return found ? { path: found.path, assetId: found.assetId } : null;
      },
      refs: (kind) => collectRefs(nodeId, kind),
      progress: (value, message) => updateLiveRun(nodeId, { progress: value, message: message ?? null }),
    };
    return adapterFor(node.type)!({ node, nodeId, signal, io });
  }
  if (route === "unknown") throw new Error(`节点 ${node.type} 不支持运行`);
  // ↓ 以下保持原有 switch 不变
  const imageGen = useImageGenStore();
  // …
}
```

同时把 `AdapterResult` 的来源改为从 `@/core/board/adapters` re-export，删掉本文件里的重复定义：

```ts
import type { AdapterResult } from "@/core/board/adapters";
export type { AdapterResult };
```

`updateLiveRun` 由 Task 4 提供；本步先加一个临时内联版本，Task 4 会替换成 `liveRuns` 模块：

```ts
function updateLiveRun(nodeId: string, patch: { progress?: number; message?: string | null }): void {
  const live = liveRuns[nodeId];
  if (!live) return;
  if (patch.progress !== undefined) live.progress = patch.progress;
  if (patch.message !== undefined) live.message = patch.message;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run src/core/board/__tests__/dispatch.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 6: 跑构建与全量测试**

Run: `pnpm build && pnpm test`
Expected: 均通过（内置节点未改分支，行为不变）

- [ ] **Step 7: Commit**

```bash
git add src/core/board/adapters.ts src/core/board/__tests__/dispatch.test.ts src/composables/useBoardRun.ts
git commit -m "feat(board): 节点执行先查插件注册表，再走内置分支"
```

---

### Task 3: 节点定义注册表（K5）

**Files:**
- Modify: `src/core/board/registry.ts:131-147`（`BOARD_NODES` / `BY_TYPE` / `nodeDefinition`）、`:505-515`（`nodesByCategory`）
- Test: `src/core/board/__tests__/nodeRegistry.test.ts`

**Interfaces:**
- Consumes: `BoardNodeDefinition`（`src/types/board.ts:122`）
- Produces:
  - `registerNodeDefinition(definition: BoardNodeDefinition, owner?: string): () => void`
  - `nodeDefinition(type)` 行为不变（缺省返回 `null`）

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/nodeRegistry.test.ts
import { describe, expect, it } from "vitest";
import { nodeDefinition, nodesByCategory, registerNodeDefinition } from "../registry";
import type { BoardNodeDefinition } from "@/types/board";

const demo: BoardNodeDefinition = {
  type: "ext.demo.node",
  titleKey: "@demo.title",
  category: "model",
  order: 999,
  inputs: [],
  outputs: [{ id: "out", type: "text", labelKey: "@demo.port" }],
  params: [],
  defaultSize: { width: 320, height: 200 },
};

describe("node definition registry", () => {
  it("registers a plugin node and finds it by type", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(nodeDefinition("ext.demo.node")).toEqual(demo);
    dispose();
    expect(nodeDefinition("ext.demo.node")).toBeNull();
  });

  it("rejects a duplicate type and names the occupier", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(() => registerNodeDefinition(demo, "@other/plugin")).toThrow(/@demo\/plugin/);
    dispose();
  });

  it("rejects a plugin type without the ext. prefix", () => {
    expect(() =>
      registerNodeDefinition({ ...demo, type: "model.notnamespaced" }, "@demo/plugin"),
    ).toThrow(/ext\./);
  });

  it("skips unknown categories instead of throwing", () => {
    const dispose = registerNodeDefinition(
      { ...demo, type: "ext.demo.weird", category: "weird" as never },
      "@demo/plugin",
    );
    expect(() => nodesByCategory()).not.toThrow();
    expect(nodesByCategory().model.some((item) => item.type === "ext.demo.weird")).toBe(false);
    dispose();
  });

  it("includes a registered plugin node in its category", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(nodesByCategory().model.some((item) => item.type === "ext.demo.node")).toBe(true);
    dispose();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/nodeRegistry.test.ts`
Expected: FAIL —`registerNodeDefinition is not a function`

- [ ] **Step 3: 在 `registry.ts` 加注册函数**

在 `BY_TYPE` 定义之后插入：

```ts
/** 插件节点定义的所有者（type → plugin id），用于冲突报错与注销。 */
const NODE_OWNERS = new Map<string, string>();

/**
 * 注册一个节点定义（插件用）。
 *
 * 纪律：类型必须以 `ext.` 前缀、不能与已有类型重名、分类必须是内置四类之一。
 * 返回 disposer；注销后节点定义与菜单项一起消失。
 */
export function registerNodeDefinition(
  definition: BoardNodeDefinition,
  owner = "core",
): () => void {
  if (!definition.type.startsWith("ext.")) {
    throw new Error(`插件节点类型必须以 ext. 前缀：${definition.type}`);
  }
  if (!["input", "display", "model", "group"].includes(definition.category)) {
    throw new Error(`插件节点分类必须是内置四类之一：${definition.category}`);
  }
  const existing = NODE_OWNERS.get(definition.type);
  if (existing || BY_TYPE.has(definition.type)) {
    throw new Error(`节点类型 ${definition.type} 已被 ${existing ?? "内置节点"} 占用`);
  }
  NODE_OWNERS.set(definition.type, owner);
  BOARD_NODES.push(definition);
  BY_TYPE.set(definition.type, definition);
  return () => {
    if (NODE_OWNERS.get(definition.type) !== owner) return;
    NODE_OWNERS.delete(definition.type);
    BY_TYPE.delete(definition.type);
    const index = BOARD_NODES.indexOf(definition);
    if (index >= 0) BOARD_NODES.splice(index, 1);
  };
}
```

把 `nodesByCategory` 改成对未知分类安全：

```ts
export function nodesByCategory(): Record<string, BoardNodeDefinition[]> {
  const grouped: Record<string, BoardNodeDefinition[]> = {
    input: [],
    display: [],
    model: [],
    group: [],
  };
  for (const definition of BOARD_NODES) {
    // 未知分类不抛错：注册期已经拦过一次，这里只保护历史工程里的坏数据。
    (grouped[definition.category] ??= []).push(definition);
  }
  for (const list of Object.values(grouped)) list.sort((a, b) => a.order - b.order);
  return grouped;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/board/__tests__/nodeRegistry.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/core/board/registry.ts src/core/board/__tests__/nodeRegistry.test.ts
git commit -m "feat(board): 节点定义注册表（命名空间 + 冲突硬报错）"
```

---

### Task 4: 运行态内存表（K3 前置）

**Files:**
- Create: `src/core/board/liveRuns.ts`
- Modify: `src/composables/useBoardRun.ts:106,611,615,800,804,862,875,1110`
- Test: `src/core/board/__tests__/liveRuns.test.ts`

**Interfaces:**
- Produces:
  - `interface LiveRun { startedAt: number; progress: number | null; message: string | null; text: string; reasoning: string }`
  - `const liveRuns: Record<string, LiveRun>`（Vue `reactive`；`BoardNode.vue` 靠它响应式渲染进度）
  - `beginLiveRun(nodeId: string): LiveRun`
  - `updateLiveRun(nodeId: string, patch: Partial<Pick<LiveRun, "progress" | "message" | "text" | "reasoning">>): void`
  - `liveRun(nodeId: string): LiveRun | undefined`
  - `endLiveRun(nodeId: string): void`
  - `clearLiveRuns(): void`

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/liveRuns.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { beginLiveRun, clearLiveRuns, endLiveRun, liveRun, liveRuns, updateLiveRun } from "../liveRuns";

afterEach(() => clearLiveRuns());

describe("live runs", () => {
  it("begins a run with defaults", () => {
    const run = beginLiveRun("n1");
    expect(run.progress).toBeNull();
    expect(run.message).toBeNull();
    expect(run.text).toBe("");
    expect(liveRun("n1")).toBe(run);
  });

  it("exposes the same object through the reactive record", () => {
    beginLiveRun("n1");
    expect(liveRuns.n1).toBe(liveRun("n1"));
  });

  it("merges updates", () => {
    beginLiveRun("n1");
    updateLiveRun("n1", { progress: 0.5, message: "生成中" });
    expect(liveRun("n1")).toMatchObject({ progress: 0.5, message: "生成中" });
  });

  it("ignores updates for unknown nodes", () => {
    expect(() => updateLiveRun("missing", { progress: 1 })).not.toThrow();
  });

  it("clamps progress into 0..1", () => {
    beginLiveRun("n1");
    updateLiveRun("n1", { progress: 3 });
    expect(liveRun("n1")!.progress).toBe(1);
  });

  it("ends a run and drops the entry", () => {
    beginLiveRun("n1");
    endLiveRun("n1");
    expect(liveRun("n1")).toBeUndefined();
    expect(liveRuns.n1).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/liveRuns.test.ts`
Expected: FAIL —`Cannot find module '../liveRuns'`

- [ ] **Step 3: 写实现**

```ts
// src/core/board/liveRuns.ts
/**
 * 节点运行态内存表：进度 / 消息 / 流式文本。
 *
 * 从 `useBoardRun` 的模块级 `liveRuns` 抽出来，因为插件节点的进度要由
 * `AdapterIO.progress` 直接写进来，而那不是 composable 的职责。
 * 仍然用 `reactive`：`BoardNode.vue` 依赖它的响应式。
 */
import { reactive } from "vue";

export interface LiveRun {
  startedAt: number;
  progress: number | null;
  message: string | null;
  text: string;
  reasoning: string;
}

export const liveRuns = reactive<Record<string, LiveRun>>({});

export function beginLiveRun(nodeId: string): LiveRun {
  const run: LiveRun = {
    startedAt: Date.now(),
    progress: null,
    message: null,
    text: "",
    reasoning: "",
  };
  liveRuns[nodeId] = run;
  return run;
}

export function updateLiveRun(
  nodeId: string,
  patch: Partial<Pick<LiveRun, "progress" | "message" | "text" | "reasoning">>,
): void {
  const run = liveRuns[nodeId];
  if (!run) return;
  if (patch.progress !== undefined && patch.progress !== null) {
    run.progress = Math.min(1, Math.max(0, patch.progress));
  }
  if (patch.message !== undefined) run.message = patch.message;
  if (patch.text !== undefined) run.text = patch.text;
  if (patch.reasoning !== undefined) run.reasoning = patch.reasoning;
}

export function liveRun(nodeId: string): LiveRun | undefined {
  return liveRuns[nodeId];
}

export function endLiveRun(nodeId: string): void {
  delete liveRuns[nodeId];
}

export function clearLiveRuns(): void {
  for (const nodeId of Object.keys(liveRuns)) delete liveRuns[nodeId];
}
```

- [ ] **Step 4: 让 `useBoardRun` 改用它**

按下表逐点替换（行号以改造前的文件为准）：

| 位置 | 原代码 | 改成 |
| --- | --- | --- |
| `:106` | `const liveRuns = reactive<Record<string, LiveRun>>({});` 与本地 `interface LiveRun` | 删除，改为下方 import + re-export |
| `:611` `:615` `:804` `:862` | `const live = liveRuns[nodeId];` | `const live = liveRun(nodeId);` |
| `:800` | `liveRuns[nodeId] = { startedAt, progress: null, message: null, text: "", reasoning: "" };` | `const startedAt = Date.now(); beginLiveRun(nodeId);`（删掉原来的 `startedAt` 声明，避免重复） |
| `:875` | `delete liveRuns[nodeId];` | `endLiveRun(nodeId);` |
| `:1110` | 返回值里的 `liveRuns,` | 保持不变（下面是 import 进来的绑定） |
| Task 2 的临时 `updateLiveRun` | 本地函数 | 删除，`io.progress` 改调模块版本 |

```ts
import {
  beginLiveRun,
  endLiveRun,
  liveRun,
  liveRuns,
  updateLiveRun,
} from "@/core/board/liveRuns";

/** 兼容旧引用：`BoardNode.vue` 从这里拿响应式进度，M1 起可改为直接 import。 */
export { liveRuns };
```

`io.progress` 的实现改为：

```ts
      progress: (value, message) =>
        updateLiveRun(nodeId, { progress: value, message: message ?? null }),
```

- [ ] **Step 5: 跑测试并确认画布行为不变**

Run: `pnpm vitest run src/core/board/__tests__/liveRuns.test.ts && pnpm build`
Expected: 测试 PASS、构建通过

- [ ] **Step 6: Commit**

```bash
git add src/core/board/liveRuns.ts src/core/board/__tests__/liveRuns.test.ts src/composables/useBoardRun.ts
git commit -m "refactor(board): 运行态内存表抽成模块，供插件进度直写"
```

---

### Task 5: 每节点取消信号（K2）

**Files:**
- Create: `src/core/board/runSignals.ts`
- Modify: `src/composables/useBoardRun.ts:109`（`cancelled`）与 `:1087-1093`（`stop()`）、`:807`（调用 `runAdapter` 处）
- Test: `src/core/board/__tests__/runSignals.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `createRunSignals(): { begin(nodeId: string): AbortSignal; abort(nodeId: string): void; abortAll(): void; active(): string[]; end(nodeId: string): void }`

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/runSignals.test.ts
import { describe, expect, it } from "vitest";
import { createRunSignals } from "../runSignals";

describe("run signals", () => {
  it("aborts only the named node", () => {
    const signals = createRunSignals();
    const a = signals.begin("a");
    const b = signals.begin("b");
    signals.abort("a");
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
  });

  it("abortAll aborts every active node", () => {
    const signals = createRunSignals();
    const a = signals.begin("a");
    const b = signals.begin("b");
    signals.abortAll();
    expect(a.aborted && b.aborted).toBe(true);
  });

  it("lists active nodes and forgets ended ones", () => {
    const signals = createRunSignals();
    signals.begin("a");
    signals.begin("b");
    signals.end("a");
    expect(signals.active()).toEqual(["b"]);
  });

  it("re-beginning a node aborts the previous signal", () => {
    const signals = createRunSignals();
    const first = signals.begin("a");
    signals.begin("a");
    expect(first.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/runSignals.test.ts`
Expected: FAIL —`Cannot find module '../runSignals'`

- [ ] **Step 3: 写实现**

```ts
// src/core/board/runSignals.ts
/**
 * 每节点一个 AbortSignal。
 *
 * 原来全画布只有一个 `cancelled` 布尔：停一个节点会连带把并行分支的后续也停掉，
 * 而且已发出的请求无法中断。插件节点必须能真正取消，所以按节点发信号。
 */
export interface RunSignals {
  begin(nodeId: string): AbortSignal;
  abort(nodeId: string): void;
  abortAll(): void;
  active(): string[];
  end(nodeId: string): void;
}

export function createRunSignals(): RunSignals {
  const controllers = new Map<string, AbortController>();
  return {
    begin(nodeId) {
      controllers.get(nodeId)?.abort();
      const controller = new AbortController();
      controllers.set(nodeId, controller);
      return controller.signal;
    },
    abort(nodeId) {
      controllers.get(nodeId)?.abort();
      controllers.delete(nodeId);
    },
    abortAll() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
    active() {
      return [...controllers.keys()];
    },
    end(nodeId) {
      controllers.delete(nodeId);
    },
  };
}
```

- [ ] **Step 4: 接进 `useBoardRun`**

- 顶部：`const signals = createRunSignals();`（替换 `let cancelled = false;` 的取消职责，`cancelled` 保留给队列屏障）。
- `runOne` 开头：`const signal = signals.begin(nodeId);`，`runAdapter(node, nodeId, signal)`。
- `runOne` 的 `finally`：`signals.end(nodeId)`。
- `stop()`：`signals.abortAll();` 之后保持原有清队列逻辑。
- `pluginIO.asset` 不变；`io.progress` 现在能感知 aborted（适配器自己查 `signal.aborted`）。

- [ ] **Step 5: 跑测试与构建**

Run: `pnpm vitest run src/core/board/__tests__/runSignals.test.ts && pnpm build`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/core/board/runSignals.ts src/core/board/__tests__/runSignals.test.ts src/composables/useBoardRun.ts
git commit -m "feat(board): 每节点 AbortSignal，取消不再误伤并行分支"
```

---

### Task 6: 泳道与资源声明（K4）

**Files:**
- Modify: `src/types/board.ts:122-138`（`BoardNodeDefinition` 加 `cost`）
- Modify: `src/core/board/scheduler.ts:96-102`（`nodeCost` 先查定义）
- Test: `src/core/board/__tests__/schedulerCost.test.ts`

**Interfaces:**
- Consumes: `nodeDefinition`（Task 3 已保证能查到插件节点）
- Produces: `BoardNodeDefinition.cost?: { lane: "instant" | "api" | "gpu" | "cpu"; vramMb?: number; ramMb?: number }`

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/schedulerCost.test.ts
import { describe, expect, it } from "vitest";
import { nodeCost } from "../scheduler";
import { registerNodeDefinition } from "../registry";
import type { BoardNode } from "@/types/board";

function node(type: string): BoardNode {
  return { id: "n1", type, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data: { params: {}, bindings: {} } };
}

describe("nodeCost with plugin nodes", () => {
  it("uses the declared lane instead of falling back to gpu", () => {
    const dispose = registerNodeDefinition(
      {
        type: "ext.demo.api",
        titleKey: "@demo.api",
        category: "model",
        order: 999,
        inputs: [],
        outputs: [],
        params: [],
        defaultSize: { width: 320, height: 200 },
        cost: { lane: "api", ramMb: 64 },
      },
      "@demo/plugin",
    );
    expect(nodeCost(node("ext.demo.api"))).toEqual({ lane: "api", vramMb: 0, ramMb: 64 });
    dispose();
  });

  it("returns null for an unregistered plugin type", () => {
    expect(nodeCost(node("ext.never.registered"))).toBeNull();
  });

  it("keeps builtin lanes unchanged", () => {
    expect(nodeCost(node("model.text"))).toMatchObject({ lane: "api" });
    expect(nodeCost(node("input.text"))).toMatchObject({ lane: "instant" });
    expect(nodeCost(node("group"))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/schedulerCost.test.ts`
Expected: FAIL —`ext.demo.api` 得到 `{ lane: "gpu", … }`

- [ ] **Step 3: 改类型与实现**

`src/types/board.ts` 的 `BoardNodeDefinition` 增加：

```ts
  /** 调度声明：插件节点必须声明泳道，否则不参与运行。 */
  cost?: { lane: "instant" | "api" | "gpu" | "cpu"; vramMb?: number; ramMb?: number };
```

`src/core/board/scheduler.ts` 的 `nodeCost` 开头插入：

```ts
export function nodeCost(node: BoardNode): NodeCost | null {
  const type = node.type;
  if (type === "group") return null;
  // 插件节点（ext.*）只认自己声明的泳道；没声明就不跑，绝不默认进 gpu 泳道。
  if (type.startsWith("ext.")) {
    const declared = nodeDefinition(type)?.cost;
    if (!declared) return null;
    return {
      lane: declared.lane,
      vramMb: declared.vramMb ?? 0,
      ramMb: declared.ramMb ?? 64,
    };
  }
  if (type.startsWith("input.") || type.startsWith("display.")) {
```

顶部把 `nodeDefinition` 加进已有的 registry import（不要新起一行 import，避免两个来源）：

```ts
import { nodeDefinition, splitModelValue } from "./registry";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/board/__tests__/schedulerCost.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/types/board.ts src/core/board/scheduler.ts src/core/board/__tests__/schedulerCost.test.ts
git commit -m "feat(board): 插件节点声明泳道，未知类型不再默认进 gpu"
```

---

### Task 7: 端口快照（K7）

**Files:**
- Modify: `src/types/board.ts`（`BoardNodeData` 加 `ports?`）
- Modify: `src/core/board/schema.ts:64-140`（`normalizeNode` 保 `data.ports`）
- Modify: `src/core/board/registry.ts:414-422`（`portsOf` 回退快照）
- Test: `src/core/board/__tests__/portSnapshot.test.ts`

**Interfaces:**
- Consumes: `BoardPortSpec`（`src/types/board.ts:50`）
- Produces: `BoardNodeData.ports?: { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] }`

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/board/__tests__/portSnapshot.test.ts
import { describe, expect, it } from "vitest";
import { normalizeBoard } from "../schema";
import { portsOf } from "../registry";

const snapshot = {
  inputs: [{ id: "in", type: "image", labelKey: "@demo.in" }],
  outputs: [{ id: "out", type: "text", labelKey: "@demo.out" }],
};

describe("port snapshot for missing plugins", () => {
  it("restores ports for a node whose definition is gone", () => {
    const doc = normalizeBoard({
      nodes: [
        {
          id: "n1",
          type: "ext.gone.node",
          position: { x: 0, y: 0 },
          size: { width: 320, height: 200 },
          data: { params: {}, bindings: {}, ports: snapshot },
        },
      ],
      edges: [],
    });
    expect(doc.nodes[0]!.data.ports).toEqual(snapshot);
    expect(portsOf(doc.nodes[0]!).outputs).toEqual(snapshot.outputs);
  });

  // 注意：`portTypeOf` 的第一个参数收的是**节点 id**（schema.ts:199 传的是 `source`），
  // 不是节点类型。生产调用方目前都不传这个选项（serialize.ts:334 只传一个参数），
  // 所以「加载即丢线」并不是现实问题；快照真正解决的是「端口渲染不出来、连不上新线」。
  it("keeps an edge that only the snapshot can type", () => {
    const doc = normalizeBoard(
      {
        nodes: [
          {
            id: "n1",
            type: "ext.gone.node",
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 },
            data: { params: {}, bindings: {}, ports: snapshot },
          },
          {
            id: "n2",
            type: "input.image",
            position: { x: 400, y: 0 },
            size: { width: 320, height: 200 },
            data: { params: {}, bindings: {} },
          },
        ],
        edges: [{ id: "e1", source: "n1", sourcePort: "out", target: "n2", targetPort: "image" }],
      },
      (nodeId, portId, side) => {
        const known: Record<string, { inputs: typeof snapshot.inputs; outputs: typeof snapshot.outputs }> = {
          n1: snapshot,
          n2: {
            inputs: [{ id: "image", type: "image", labelKey: "board.port.image" }],
            outputs: [],
          },
        };
        const list = side === "out" ? known[nodeId]?.outputs : known[nodeId]?.inputs;
        return list?.find((port) => port.id === portId)?.type ?? null;
      },
    );
    expect(doc.edges).toHaveLength(1);
  });

  it("drops a malformed snapshot instead of trusting it", () => {
    const doc = normalizeBoard({
      nodes: [
        {
          id: "n1",
          type: "ext.gone.node",
          position: { x: 0, y: 0 },
          size: { width: 320, height: 200 },
          data: { params: {}, bindings: {}, ports: { inputs: "nope" } },
        },
      ],
      edges: [],
    });
    expect(doc.nodes[0]!.data.ports).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/board/__tests__/portSnapshot.test.ts`
Expected: FAIL —`data.ports` 为 `undefined`

- [ ] **Step 3: 加类型与归一化**

`src/types/board.ts` 的 `BoardNodeData` 增加：

```ts
  /**
   * 端口快照：插件节点在工程里存一份自己的端口定义。
   * 插件被卸载后仍能据此恢复端口与连线，不至于「节点还在、线全断了」。
   */
  ports?: { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] };
```

`src/core/board/schema.ts` 在 `normalizeNode` 里、`data` 初始化之后加：

```ts
  const ports = normalizePorts(rawData.ports);
  if (ports) data.ports = ports;
```

并新增：

```ts
/** 端口快照归一化：形状不对就整块丢掉，不猜。 */
function normalizePorts(
  raw: unknown,
): { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] } | undefined {
  if (!isObject(raw)) return undefined;
  const inputs = normalizePortList(raw.inputs);
  const outputs = normalizePortList(raw.outputs);
  if (inputs === null || outputs === null) return undefined;
  return { inputs, outputs };
}

function normalizePortList(raw: unknown): BoardPortSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const list: BoardPortSpec[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    if (typeof item.id !== "string" || !item.id) return null;
    if (!isPortType(item.type)) return null;
    if (typeof item.labelKey !== "string") return null;
    list.push({
      id: item.id,
      type: item.type,
      labelKey: item.labelKey,
      ...(typeof item.max === "number" ? { max: item.max } : {}),
    });
  }
  return list;
}
```

`src/core/board/registry.ts` 的 `portsOf` 改成：

```ts
export function portsOf(
  node: BoardNode,
  context?: BoardPortContext,
): { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] } {
  const definition = nodeDefinition(node.type);
  // 插件缺失时用工程里存的端口快照兜底，保住连线。
  if (!definition) {
    return node.data.ports ?? { inputs: [], outputs: [] };
  }
  …
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/board/__tests__/portSnapshot.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 让插件节点落盘时写入快照**

在 Task 3 的 `registerNodeDefinition` 注释里补充一行（实现保持不变），并在此任务给画布创建插件的路径留出契约：M1 创建插件节点时必须把 `data.ports = { inputs: definition.inputs, outputs: definition.outputs }`。本任务只在 `src/core/board/registry.ts` 顶部文档注释写明该契约：

```ts
/**
 * 插件节点创建时必须在 `data.ports` 写入端口快照（见 `BoardNodeData.ports`）。
 * 这样插件被卸载后，工程里的节点仍能恢复端口与连线。
 */
```

- [ ] **Step 6: Commit**

```bash
git add src/types/board.ts src/core/board/schema.ts src/core/board/registry.ts src/core/board/__tests__/portSnapshot.test.ts
git commit -m "feat(board): 插件节点端口快照，缺插件时保住连线"
```

---

### Task 8: 命令表（K9）

**Files:**
- Create: `src/core/commands.ts`
- Modify: `src/core/shortcuts.ts:30-145`（先查命令表，再走既有链）
- Test: `src/core/__tests__/commands.test.ts`

**Interfaces:**
- Produces:
  - `interface CommandSpec { id: string; titleKey: string; key?: string; when?: () => boolean; run: () => void | Promise<void>; owner?: string }`
  - `registerCommand(spec: CommandSpec): () => void`
  - `commands(): CommandSpec[]`
  - `commandFor(id: string): CommandSpec | null`
  - `runCommand(id: string): Promise<boolean>`
  - `matchShortcut(event: KeyboardEvent): CommandSpec | null`

- [ ] **Step 1: 写失败的测试**

```ts
// src/core/__tests__/commands.test.ts
import { describe, expect, it, vi } from "vitest";
import { commandFor, matchShortcut, registerCommand, runCommand } from "../commands";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("command table", () => {
  it("registers and looks up a command", () => {
    const run = vi.fn();
    registerCommand({ id: "demo.run", titleKey: "menu.demo", run });
    expect(commandFor("demo.run")?.titleKey).toBe("menu.demo");
  });

  it("rejects duplicate ids and names the occupier", () => {
    registerCommand({ id: "demo.dup", titleKey: "menu.demo", run: () => {}, owner: "@a" });
    expect(() =>
      registerCommand({ id: "demo.dup", titleKey: "menu.demo", run: () => {}, owner: "@b" }),
    ).toThrow(/@a/);
  });

  it("rejects a duplicate keybinding and names the occupier", () => {
    registerCommand({ id: "demo.k1", titleKey: "menu.demo", key: "mod+alt+k", run: () => {}, owner: "@a" });
    expect(() =>
      registerCommand({ id: "demo.k2", titleKey: "menu.demo", key: "mod+alt+k", run: () => {}, owner: "@b" }),
    ).toThrow(/@a/);
  });

  it("matches a shortcut from a KeyboardEvent", () => {
    registerCommand({ id: "demo.k3", titleKey: "menu.demo", key: "mod+alt+j", run: () => {} });
    expect(matchShortcut(key({ key: "j", metaKey: true, altKey: true }))?.id).toBe("demo.k3");
    expect(matchShortcut(key({ key: "j", altKey: true }))).toBeNull();
  });

  it("respects the when guard", async () => {
    const run = vi.fn();
    let allowed = false;
    registerCommand({ id: "demo.when", titleKey: "menu.demo", when: () => allowed, run });
    expect(await runCommand("demo.when")).toBe(false);
    allowed = true;
    expect(await runCommand("demo.when")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("drops everything on dispose", () => {
    const dispose = registerCommand({ id: "demo.drop", titleKey: "menu.demo", key: "mod+alt+d", run: () => {} });
    dispose();
    expect(commandFor("demo.drop")).toBeNull();
    expect(matchShortcut(key({ key: "d", metaKey: true, altKey: true }))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/__tests__/commands.test.ts`
Expected: FAIL —`Cannot find module '../commands'`

- [ ] **Step 3: 写实现**

```ts
// src/core/commands.ts
/**
 * 命令表：快捷键、右键菜单、未来的命令面板都从这里取。
 *
 * 为什么要有它：`shortcuts.ts` 原来是一个巨大的 `onKeyDown`，键位写死在分支里；
 * 插件要加命令就必须能注册。命令表是内核唯一需要新增的机制——其余扩展点
 * （节点 / 供应商 / 插槽）都由插件经 `ctx` 注册。
 */
export interface CommandSpec {
  /** 全局唯一：`<域>.<动作>`，插件命令必须以 `ext.<插件短 id>.` 开头。 */
  id: string;
  /** i18n key（插件命令可指向插件自己的词典）。 */
  titleKey: string;
  /** 键位描述：`mod+shift+k`；`mod` = ⌘ / Ctrl。 */
  key?: string;
  /** 生效条件；返回 false 时既不响应快捷键也不出现在菜单里。 */
  when?: () => boolean;
  run: () => void | Promise<void>;
  owner?: string;
}

interface Entry {
  spec: CommandSpec;
  owner: string;
}

const COMMANDS = new Map<string, Entry>();
const KEYS = new Map<string, string>();

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .sort()
    .join("+");
}

export function registerCommand(spec: CommandSpec): () => void {
  const owner = spec.owner ?? "core";
  const existing = COMMANDS.get(spec.id);
  if (existing) {
    throw new Error(`命令 ${spec.id} 已被 ${existing.owner} 注册，不能重复注册`);
  }
  const key = spec.key ? normalizeKey(spec.key) : null;
  if (key) {
    const holder = KEYS.get(key);
    if (holder && holder !== spec.id) {
      throw new Error(`键位 ${spec.key} 已被 ${COMMANDS.get(holder)?.owner ?? holder} 占用`);
    }
    KEYS.set(key, spec.id);
  }
  COMMANDS.set(spec.id, { spec, owner });
  return () => {
    if (COMMANDS.get(spec.id)?.spec !== spec) return;
    COMMANDS.delete(spec.id);
    if (key && KEYS.get(key) === spec.id) KEYS.delete(key);
  };
}

export function commands(): CommandSpec[] {
  return [...COMMANDS.values()]
    .filter((entry) => entry.spec.when?.() ?? true)
    .map((entry) => entry.spec);
}

export function commandFor(id: string): CommandSpec | null {
  return COMMANDS.get(id)?.spec ?? null;
}

export async function runCommand(id: string): Promise<boolean> {
  const spec = commandFor(id);
  if (!spec) return false;
  if (spec.when && !spec.when()) return false;
  await spec.run();
  return true;
}

/** 把一次 keydown 映射到命令；没有命中返回 null。 */
export function matchShortcut(event: KeyboardEvent): CommandSpec | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  const name = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(name.toLowerCase());
  const id = KEYS.get(parts.sort().join("+"));
  if (!id) return null;
  const spec = commandFor(id);
  if (!spec || (spec.when && !spec.when())) return null;
  return spec;
}
```

- [ ] **Step 4: 让 `shortcuts.ts` 先查命令表**

在 `onKeyDown` 的模态框/设置页早退之后、既有分支之前插入：

```ts
import { matchShortcut, runCommand } from "@/core/commands";

    // 插件命令与内核命令统一走命令表；命中即执行并结束。
    const matched = matchShortcut(event);
    if (matched) {
      event.preventDefault();
      void runCommand(matched.id);
      return;
    }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run src/core/__tests__/commands.test.ts && pnpm test`
Expected: PASS，且既有快捷键行为不变

- [ ] **Step 6: Commit**

```bash
git add src/core/commands.ts src/core/__tests__/commands.test.ts src/core/shortcuts.ts
git commit -m "feat(core): 命令表（快捷键/菜单/命令面板统一入口）"
```

---

### Task 9: 插件词典（K6）

**Files:**
- Modify: `src/i18n/translate.ts:39-47`（`t()` 加插件词典层）
- Test: `src/i18n/__tests__/pluginDict.test.ts`

**Interfaces:**
- Consumes: 现有 `Locale` / `FALLBACK`
- Produces:
  - `registerPluginMessages(pluginId: string, dicts: Partial<Record<Locale, Record<string, string>>>): () => void`
  - 查找顺序：当前语言 → 兜底语言 → 命中 `@<pluginId>.` 前缀的插件词典 → 原样返回 key

- [ ] **Step 1: 写失败的测试**

```ts
// src/i18n/__tests__/pluginDict.test.ts
import { describe, expect, it } from "vitest";
import { registerPluginMessages, setTranslateLocale, t } from "../translate";

describe("plugin message dictionaries", () => {
  it("resolves a namespaced key from the plugin dictionary", () => {
    const dispose = registerPluginMessages("demo", { zh: { title: "示例" }, en: { title: "Demo" } });
    setTranslateLocale("zh");
    expect(t("@demo.title")).toBe("示例");
    setTranslateLocale("en");
    expect(t("@demo.title")).toBe("Demo");
    dispose();
    setTranslateLocale("zh");
  });

  it("falls back to the default locale inside the plugin dictionary", () => {
    const dispose = registerPluginMessages("demo2", { en: { only: "Only" } });
    setTranslateLocale("zh");
    expect(t("@demo2.only")).toBe("Only");
    dispose();
  });

  it("returns the key itself after dispose", () => {
    const dispose = registerPluginMessages("demo3", { zh: { gone: "没了" } });
    setTranslateLocale("zh");
    expect(t("@demo3.gone")).toBe("没了");
    dispose();
    expect(t("@demo3.gone")).toBe("@demo3.gone");
  });

  it("keeps kernel keys untouched", () => {
    setTranslateLocale("zh");
    expect(t("board.node.inputImage")).not.toBe("board.node.inputImage");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/i18n/__tests__/pluginDict.test.ts`
Expected: FAIL —`registerPluginMessages is not a function`

- [ ] **Step 3: 写实现**

在 `translate.ts` 的 `MESSAGES` 之后加：

```ts
/** 插件词典：pluginId → 语言 → 文案。key 在插件侧的写法不带前缀。 */
const PLUGIN_MESSAGES = new Map<string, Partial<Record<Locale, Record<string, string>>>>();

export function registerPluginMessages(
  pluginId: string,
  dicts: Partial<Record<Locale, Record<string, string>>>,
): () => void {
  PLUGIN_MESSAGES.set(pluginId, dicts);
  return () => {
    if (PLUGIN_MESSAGES.get(pluginId) === dicts) PLUGIN_MESSAGES.delete(pluginId);
  };
}

/** `@id.key` → 插件词典里的 `key`；不是插件 key 返回 null。 */
function pluginMessage(key: string): string | null {
  if (!key.startsWith("@")) return null;
  const dot = key.indexOf(".");
  if (dot <= 1) return null;
  const pluginId = key.slice(1, dot);
  const inner = key.slice(dot + 1);
  const dicts = PLUGIN_MESSAGES.get(pluginId);
  if (!dicts) return null;
  return dicts[current]?.[inner] ?? dicts[FALLBACK]?.[inner] ?? null;
}
```

`t()` 改为：

```ts
export function t(key: string, vars?: Vars): string {
  const dict = MESSAGES[current] ?? MESSAGES[FALLBACK];
  let text = dict[key] ?? MESSAGES[FALLBACK][key] ?? pluginMessage(key) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/i18n/__tests__/pluginDict.test.ts && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/i18n/translate.ts src/i18n/__tests__/pluginDict.test.ts
git commit -m "feat(i18n): 插件词典层，@id.key 解析到插件自带文案"
```

---

### Task 10: 能力表加 `plugin` 键（K10）

**Files:**
- Modify: `crates/daemon/src/capabilities.rs:99-129`（HEADLESS 表）
- Test: `crates/daemon/src/capabilities.rs` 内的既有断言（`cargo test`）

**Interfaces:**
- Consumes: `Capability` / `ok()` / `HEADLESS`
- Produces: 能力 key `plugin`，桌面与 headless 均为 `ok`

- [ ] **Step 1: 写失败的测试**

在 `capabilities.rs` 的测试模块里加：

```rust
    #[test]
    fn plugin_capability_is_available_headless() {
        let cap = super::get("plugin").expect("plugin capability must be declared");
        assert_eq!(cap.state, super::State::Ok);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_capability_is_available_headless`
Expected: FAIL —— `plugin capability must be declared`

- [ ] **Step 3: 在 HEADLESS 表里声明**

在 `ok("ofx"),` 附近插入：

```rust
    // 插件宿主跑在 daemon 里（QuickJS），无头形态同样可用；客户端半只在有 UI 时加载。
    ok("plugin"),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml capabilities`
Expected: PASS（含既有的「非 Ok 必须有 reason」断言）

- [ ] **Step 5: 前端门控留位**

在 `src/platform/capabilities.ts` 的注释里补一行说明（不改逻辑）：

```ts
/**
 * 插件能力 key = `plugin`。无头形态下宿主半可用，客户端半只关不报错：
 * 无 UI 时 `ctx.slots/nodes` 为空表，插件仍可提供命令与服务。
 */
```

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/capabilities.rs src/platform/capabilities.ts
git commit -m "feat(caps): 声明 plugin 能力键"
```

---

## 与 spec 的偏差（已核对代码后修正）

| spec 条目 | 偏差 | 处理 |
| --- | --- | --- |
| K1「内置节点启动时注册进同一张表」 | 内置 17 个类型的 `switch` 有 300+ 行、依赖各 store，整段迁移风险远大于收益 | 本计划只做到：**分发先查表、再走内置**，并用 `BUILTIN_TYPES` 白名单兜底。内置迁移留到 M1/M4，届时逐个删除白名单项 |
| K3「进度走 `ctx.jobs.report()`」 | `ctx` 属于 M2；M0 阶段插件还没有 `ctx` | M0 先落 `liveRuns` 模块 + `AdapterIO.progress`；M2 把 `ctx.jobs` 接到同一张表上，调用方不变 |
| K7「未知节点保留但连线被丢」 | **描述不准确**：`normalizeBoard` 的 `portTypeOf` 参数在生产调用里都没传（`serialize.ts:334`、`stores/board.ts:141` 都是单参数），所以加载时连线不会被丢 | 快照的真实收益是「端口渲染不出来、无法继续连线」。本计划把 spec 的这句改为这一表述 |
| K8「新增 `/plugins/...` 资源路由」 | 路由要服务 `store/<id>/<version>/`，而 store 在 M1 才存在 | 移到 M1 计划，与加载器一起做 |

## 收尾验收（M0 完成条件）

- [ ] `pnpm test` 全绿（含新增 6 个测试文件）
- [ ] `pnpm build` 通过
- [ ] `cargo test --manifest-path crates/daemon/Cargo.toml` 全绿
- [ ] 手测画布：文生图、图生视频、文本、TTS、音频分离各跑一次，行为与改造前一致
- [ ] 手测快捷键：`⌘S` / `⌘Z` / `⌘C` / 空格 / `S` / `M` / 删除 / 方向键全部照旧
- [ ] `git log --oneline` 能看到 10 个独立 commit
