# 剧集界面：平铺 / 连线 · 互动分支图 · 剧集播放 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把剧集界面改成「平铺 / 连线」两种形态：连线是 Vue Flow 自由画布，分P 是卡片，卡片之间可连线、连线上可写选项；普通剧集默认按 `order` 派生一条时间链；预览增加「单集 / 剧集」播放模式，剧集模式沿连线自动连播、遇分叉浮出选项。

**Architecture:** 图数据放工程级 `doc.seriesGraph`（`custom` + `edges` + `positions`）。`custom: false` 时边由 `Episode.order` 派生、不落盘；首次结构性编辑（连 / 断 / 改选项名）先用 `materializeGraph()` 把派生链落成真实边再应用编辑。读取与播放判定全部集中在 `src/core/series/graph.ts` 的纯函数里。剧集画布用项目已有的 `@vue-flow/core`（与 `BoardView` 同一个库，但不共享节点 / store / 端口概念），只做「分P → nodes、边 → edges」的映射。播放状态在 `useSeriesPlayback.ts`，只由 `PreviewStage` 的 `onEnded` 驱动。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Pinia + Vue Flow 1.48 + Vitest。无新依赖。

**Spec:** [`docs/superpowers/specs/2026-11-21-series-graph-design.md`](../specs/2026-11-21-series-graph-design.md)

## Global Constraints

- **工作树有大量与本任务无关的未提交改动**（工作流 / MCP / 画布相关）。每一步提交都只 `git add` 本任务列出的文件，**永远不要** `git add -A` / `git add .`；不要修改列出的文件以外的内容。
- TypeScript strict；Vue 3 `<script setup lang="ts">`；所有注释与界面文案用中文（英文文案只进 `src/i18n/en.ts`）。
- 所有 op 是不可变纯函数，返回同一引用表示「无变化」；界面通过 `project.dispatch()` 提交。工程级字段用 `patchProjectMeta()` 或 `withTouch()` 折返，禁止裸 `{ ...doc }` 后直接返回。
- 每个新增 i18n key 必须同时加到 `src/i18n/zh.ts` 与 `src/i18n/en.ts`。
- CSS 只用 `src/assets/main.css` 已定义的 token（`--md-*`、`--app-*`、`--ab-*`），不新增裸色值；`@vue-flow` 的类名保持库默认。
- 不加依赖；不改 Rust 源码、不新增 Tauri 命令、不改 session 协议。
- 每个任务结束跑对应命令：纯逻辑任务 `pnpm test`，UI 任务 `pnpm test && pnpm build`。`pnpm build` = `vue-tsc --noEmit` + vite build，必须零错误。
- 提交信息前缀：`feat(series):` / `fix(series):` / `test(series):` / `docs(series):`。

## 开工前：工作树是脏的

当前工作树里有一批**与本任务无关**的未提交改动（工作流 / MCP / 画布节点，涉及 `AGENTS.md`、
`src/types/project.ts`、`src/i18n/{zh,en}.ts`、`src/core/serialize.ts`、`src/components/series/SeriesView.vue`
等本计划要改的文件）。开始 Task 1 前先跑：

```bash
git status --short
git diff --stat
```

然后问用户怎么处理，二选一：

1. **用户先自己提交 / 暂存那批改动**（推荐）——之后本计划的每个提交只包含剧集图工作；
2. 用户明确同意「把现有改动一起带进剧集图的提交」——照做，但在最终汇报里说明这些提交混入了先前工作。

不要自己 `git stash` / `git checkout --` / `git reset` 去清工作树：那会毁掉用户未提交的活。

---

### Task 1: 剧集图类型 + 纯图引擎（派生链 / 选项 / 播放判定）

**Files:**
- Modify: `src/types/project.ts`（`Episode` 前插入 `SeriesEdge` / `SeriesGraphDoc` / `SeriesOption`；`Project` 加字段；删 `Episode.transitions`）
- Create: `src/core/series/graph.ts`
- Test: `src/core/series/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: `Project` / `Episode` / `SeriesEdge` / `SeriesOption`。
- Produces:
  - `orderedEpisodes(doc: Project): Episode[]`
  - `derivedChain(doc: Project): SeriesEdge[]`
  - `isDerived(doc: Project): boolean`
  - `seriesEdges(doc: Project): SeriesEdge[]`
  - `outgoing(doc: Project, episodeId: string): SeriesEdge[]`
  - `incoming(doc: Project, episodeId: string): SeriesEdge[]`
  - `optionsOf(doc: Project, episodeId: string): SeriesOption[]`
  - `stepOf(doc: Project, episodeId: string, visited: ReadonlySet<string>): SeriesStep`
  - `type SeriesStep = { kind: "end" } | { kind: "auto"; to: string } | { kind: "choices"; options: SeriesOption[] } | { kind: "loop"; to: string }`

- [ ] **Step 1: 改类型**

在 `src/types/project.ts` 的 `/** 一个分P：工程内的一条独立时间线。 */` 之前插入：

```ts
/** 剧集图上的一条有向连线：`from` 播完 → 进入 `to`。 */
export interface SeriesEdge {
  id: string;
  /** 源分P id。 */
  from: string;
  /** 目标分P id。 */
  to: string;
  /** 连线上的选项文案；空 / 缺省 = 无选项（唯一出边自动连播，多条出边时显示「选项N」）。 */
  label?: string;
}

/** 工程级剧集图。缺省表示「按分P order 派生一条时间链」。 */
export interface SeriesGraphDoc {
  /** 用户编辑过连线后为 true；此后 `edges` 才是真相。 */
  custom: boolean;
  /** 只有 custom 时参与渲染；保持追加顺序（= 选项显示顺序）。 */
  edges: SeriesEdge[];
  /** 卡片在画布上的世界坐标；缺省的分P 走自动布局。 */
  positions: Record<string, { x: number; y: number }>;
}

/** 播放时一个可点的选项（由出边投影出来，不落库）。 */
export interface SeriesOption {
  edgeId: string;
  to: string;
  /** 已 trim 的文案；未命名时为空串。 */
  label: string;
  /** 没有文案：界面显示「选项 {index}」。 */
  unnamed: boolean;
}
```

删除 `Episode` 里的这两个字段：

```ts
  /** 互动分支预留：本阶段只保留字段，不实现。 */
  transitions?: { choice: string; toEpisodeId: string }[];
```

在 `Project` 的 `activeBoardId?: string;` 之后加：

```ts
  /** 剧集图：分P 之间的播放关系。缺省 = 按 order 派生时间链。 */
  seriesGraph?: SeriesGraphDoc;
```

- [ ] **Step 2: 写失败测试**

新建 `src/core/series/__tests__/graph.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode } from "@/core/ops/episodes";
import {
  derivedChain,
  incoming,
  isDerived,
  optionsOf,
  orderedEpisodes,
  seriesEdges,
  stepOf,
} from "@/core/series/graph";
import type { Project, SeriesEdge } from "@/types/project";

/** 三集：分P 1 / 第二集 / 第三集。 */
function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

/** 直接挂一张自定义图（只测纯图函数，不经过 ops）。 */
function withEdges(doc: Project, edges: SeriesEdge[]): Project {
  return {
    ...doc,
    seriesGraph: { custom: true, edges, positions: {} },
  } as Project;
}

describe("orderedEpisodes / derivedChain", () => {
  it("按 order 排序，忽略数组顺序", () => {
    const doc = threeEpisodes();
    const [a, b, c] = doc.episodes;
    const shuffled = {
      ...doc,
      episodes: [
        { ...c, order: 0 },
        { ...a, order: 1 },
        { ...b, order: 2 },
      ],
    } as Project;
    expect(orderedEpisodes(shuffled).map((episode) => episode.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
  });

  it("派生链是相邻两集一条无选项边，id 稳定", () => {
    const doc = threeEpisodes();
    const edges = derivedChain(doc);
    expect(edges).toHaveLength(2);
    expect(edges[0].from).toBe(doc.episodes[0].id);
    expect(edges[0].to).toBe(doc.episodes[1].id);
    expect(edges[0].label).toBeUndefined();
    expect(edges[0].id).toBe(`chain:${doc.episodes[0].id}->${doc.episodes[1].id}`);
    expect(derivedChain(doc)).toEqual(edges);
  });

  it("单集没有边", () => {
    expect(derivedChain(newProject())).toEqual([]);
  });
});

describe("seriesEdges / isDerived", () => {
  it("默认派生；custom 后改用存盘边", () => {
    const doc = threeEpisodes();
    expect(isDerived(doc)).toBe(true);
    expect(seriesEdges(doc)).toHaveLength(2);

    const custom = withEdges(doc, [
      { id: "e1", from: doc.episodes[0].id, to: doc.episodes[2].id },
    ]);
    expect(isDerived(custom)).toBe(false);
    expect(seriesEdges(custom).map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("custom 且 edges 为空时不回退派生链", () => {
    const doc = withEdges(threeEpisodes(), []);
    expect(seriesEdges(doc)).toEqual([]);
  });

  it("悬空边（目标分P 已不存在）被过滤", () => {
    const doc = threeEpisodes();
    const custom = withEdges(doc, [
      { id: "ok", from: doc.episodes[0].id, to: doc.episodes[1].id },
      { id: "bad", from: doc.episodes[0].id, to: "gone" },
    ]);
    expect(seriesEdges(custom).map((edge) => edge.id)).toEqual(["ok"]);
  });
});

describe("outgoing / incoming / optionsOf", () => {
  it("多出边按数组顺序变成选项，未命名标记正确", () => {
    const doc = threeEpisodes();
    const custom = withEdges(doc, [
      { id: "a", from: doc.episodes[0].id, to: doc.episodes[1].id },
      { id: "b", from: doc.episodes[0].id, to: doc.episodes[2].id, label: "  逃 " },
      { id: "c", from: doc.episodes[0].id, to: doc.episodes[1].id },
    ]);
    expect(optionsOf(custom, doc.episodes[0].id)).toEqual([
      { edgeId: "a", to: doc.episodes[1].id, label: "", unnamed: true },
      { edgeId: "b", to: doc.episodes[2].id, label: "逃", unnamed: false },
      { edgeId: "c", to: doc.episodes[1].id, label: "", unnamed: true },
    ]);
    expect(incoming(custom, doc.episodes[1].id).map((edge) => edge.id)).toEqual(["a", "c"]);
  });
});

describe("stepOf", () => {
  it("没有出边 → end", () => {
    const doc = newProject();
    expect(stepOf(doc, doc.episodes[0].id, new Set())).toEqual({ kind: "end" });
  });

  it("唯一无选项出边 → auto；目标已访问 → loop", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    expect(stepOf(doc, first.id, new Set())).toEqual({ kind: "auto", to: second.id });
    expect(stepOf(doc, first.id, new Set([second.id]))).toEqual({ kind: "loop", to: second.id });
  });

  it("唯一出边带选项 → choices", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id, label: "继续" },
    ]);
    expect(stepOf(custom, first.id, new Set())).toEqual({
      kind: "choices",
      options: [{ edgeId: "a", to: second.id, label: "继续", unnamed: false }],
    });
  });

  it("两条出边 → choices（即使目标已访问也不拦）", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id },
      { id: "b", from: first.id, to: third.id },
    ]);
    const step = stepOf(custom, first.id, new Set([second.id, third.id]));
    expect(step.kind).toBe("choices");
  });

  it("自环无选项 → loop", () => {
    const doc = newProject();
    const id = doc.episodes[0].id;
    const custom = withEdges(doc, [{ id: "self", from: id, to: id }]);
    expect(stepOf(custom, id, new Set([id]))).toEqual({ kind: "loop", to: id });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test src/core/series/__tests__/graph.test.ts`
Expected: FAIL —— `Failed to resolve import "@/core/series/graph"`。

- [ ] **Step 4: 实现 `src/core/series/graph.ts`**

```ts
/**
 * 剧集图：分P 之间的播放关系。
 *
 * 派生模式（默认）：按 `Episode.order` 把相邻分P 连成一条时间链，不落盘；
 * 自定义模式：`project.seriesGraph.edges` 是唯一真相。两种模式都通过
 * `seriesEdges()` 读取，界面与播放只认这个出口。
 */
import type { Episode, Project, SeriesEdge, SeriesOption } from "@/types/project";

/** 按 order 升序；order 相同时保持数组顺序。 */
export function orderedEpisodes(doc: Project): Episode[] {
  return doc.episodes
    .map((episode, index) => ({ episode, index }))
    .sort((a, b) => a.episode.order - b.episode.order || a.index - b.index)
    .map((item) => item.episode);
}

/** 默认时间链：相邻两集一条无选项边，id 稳定。 */
export function derivedChain(doc: Project): SeriesEdge[] {
  const episodes = orderedEpisodes(doc);
  const edges: SeriesEdge[] = [];
  for (let index = 0; index < episodes.length - 1; index += 1) {
    const from = episodes[index].id;
    const to = episodes[index + 1].id;
    edges.push({ id: `chain:${from}->${to}`, from, to });
  }
  return edges;
}

/** 是否还在「没动过连线」的派生状态。 */
export function isDerived(doc: Project): boolean {
  return doc.seriesGraph?.custom !== true;
}

/** 当前有效的边（悬空边在这里过滤）。custom 且 edges 为空时不回退派生链。 */
export function seriesEdges(doc: Project): SeriesEdge[] {
  if (isDerived(doc)) return derivedChain(doc);
  const known = new Set(doc.episodes.map((episode) => episode.id));
  return (doc.seriesGraph?.edges ?? []).filter(
    (edge) => known.has(edge.from) && known.has(edge.to),
  );
}

export function outgoing(doc: Project, episodeId: string): SeriesEdge[] {
  return seriesEdges(doc).filter((edge) => edge.from === episodeId);
}

export function incoming(doc: Project, episodeId: string): SeriesEdge[] {
  return seriesEdges(doc).filter((edge) => edge.to === episodeId);
}

/** 出边 → 播放选项（保持 edges 顺序）。 */
export function optionsOf(doc: Project, episodeId: string): SeriesOption[] {
  return outgoing(doc, episodeId).map((edge) => {
    const label = edge.label?.trim() ?? "";
    return { edgeId: edge.id, to: edge.to, label, unnamed: label.length === 0 };
  });
}

/** 本集播完之后该干什么。 */
export type SeriesStep =
  | { kind: "end" }
  | { kind: "auto"; to: string }
  | { kind: "choices"; options: SeriesOption[] }
  | { kind: "loop"; to: string };

/**
 * 播放判定：0 条出边结束；唯一无选项出边自动连播（目标已访问则是无选项的环）；
 * 其余（多条出边 / 唯一出边带文案）都当选项。
 */
export function stepOf(
  doc: Project,
  episodeId: string,
  visited: ReadonlySet<string>,
): SeriesStep {
  const edges = outgoing(doc, episodeId);
  if (edges.length === 0) return { kind: "end" };
  if (edges.length === 1 && (edges[0].label?.trim() ?? "") === "") {
    const to = edges[0].to;
    return visited.has(to) ? { kind: "loop", to } : { kind: "auto", to };
  }
  return { kind: "choices", options: optionsOf(doc, episodeId) };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test src/core/series/__tests__/graph.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 6: 提交**

```bash
git add src/types/project.ts src/core/series/graph.ts src/core/series/__tests__/graph.test.ts
git commit -m "feat(series): 剧集图类型与纯图引擎（派生链 / 选项 / 播放判定）"
```

---

### Task 2: 自动分层布局

**Files:**
- Create: `src/core/series/layout.ts`
- Test: `src/core/series/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `orderedEpisodes` / `seriesEdges`（Task 1）。
- Produces:
  - 常量 `CARD_WIDTH = 240`、`CARD_HEIGHT = 168`、`GAP_X = 64`、`GAP_Y = 36`、`ORIGIN = 48`
  - `type SeriesPosition = { x: number; y: number }`
  - `autoLayout(doc: Project): Map<string, SeriesPosition>`
  - `placements(doc: Project): Map<string, SeriesPosition>`

- [ ] **Step 1: 写失败测试**

新建 `src/core/series/__tests__/layout.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode } from "@/core/ops/episodes";
import {
  autoLayout,
  CARD_HEIGHT,
  CARD_WIDTH,
  GAP_X,
  GAP_Y,
  ORIGIN,
  placements,
} from "@/core/series/layout";
import type { Project, SeriesEdge } from "@/types/project";

function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

function withEdges(doc: Project, edges: SeriesEdge[]): Project {
  return {
    ...doc,
    seriesGraph: { custom: true, edges, positions: {} },
  } as Project;
}

describe("autoLayout", () => {
  it("链式布局是一条水平直线", () => {
    const doc = threeEpisodes();
    const positions = autoLayout(doc);
    const xs = doc.episodes.map((episode) => positions.get(episode.id)!.x);
    const ys = doc.episodes.map((episode) => positions.get(episode.id)!.y);
    expect(xs).toEqual([
      ORIGIN,
      ORIGIN + CARD_WIDTH + GAP_X,
      ORIGIN + (CARD_WIDTH + GAP_X) * 2,
    ]);
    expect(new Set(ys).size).toBe(1);
  });

  it("分叉按 BFS 深度分层，同层纵向排列", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id },
      { id: "b", from: first.id, to: third.id },
    ]);
    const positions = autoLayout(custom);
    expect(positions.get(second.id)!.x).toBe(positions.get(third.id)!.x);
    expect(
      Math.abs(positions.get(second.id)!.y - positions.get(third.id)!.y),
    ).toBe(CARD_HEIGHT + GAP_Y);
  });

  it("环不会死循环，每个分P 都有坐标", () => {
    const doc = addEpisode(newProject("循环"), "B");
    const [a, b] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "ab", from: a.id, to: b.id },
      { id: "ba", from: b.id, to: a.id },
    ]);
    const positions = autoLayout(custom);
    expect(positions.size).toBe(2);
    expect(positions.get(a.id)).toBeDefined();
    expect(positions.get(b.id)).toBeDefined();
  });

  it("孤立分P 排到最右侧一列", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [{ id: "a", from: first.id, to: second.id }]);
    const positions = autoLayout(custom);
    expect(positions.get(third.id)!.x).toBeGreaterThan(positions.get(second.id)!.x);
  });
});

describe("placements", () => {
  it("手动坐标优先，其余走自动布局", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const manual = {
      ...doc,
      seriesGraph: {
        custom: false,
        edges: [],
        positions: { [second.id]: { x: 999, y: 555 } },
      },
    } as Project;
    const positions = placements(manual);
    expect(positions.get(second.id)).toEqual({ x: 999, y: 555 });
    expect(positions.get(first.id)!.x).toBe(ORIGIN);
  });

  it("坏坐标回落到自动布局", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0];
    const broken = {
      ...doc,
      seriesGraph: {
        custom: false,
        edges: [],
        positions: { [first.id]: { x: Number.NaN, y: 0 } },
      },
    } as Project;
    expect(placements(broken).get(first.id)).toEqual({ x: ORIGIN, y: ORIGIN });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/series/__tests__/layout.test.ts`
Expected: FAIL —— 找不到 `@/core/series/layout`。

- [ ] **Step 3: 实现 `src/core/series/layout.ts`**

```ts
/**
 * 剧集卡片坐标。
 *
 * 自动布局按图的有向深度分层：根（没有入边）在最左，BFS 每下一层右移一列；
 * 环 / 孤立分P 作为新的根排到最右一列。派生时间链因此退化成一条水平直线。
 * `positions` 里手动拖过的坐标优先。
 */
import type { Project } from "@/types/project";
import { orderedEpisodes, seriesEdges } from "./graph";

/** 卡片尺寸（与 `SeriesGraphCard.vue` 的 CSS 保持一致）。 */
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 168;
export const GAP_X = 64;
export const GAP_Y = 36;
export const ORIGIN = 48;

export interface SeriesPosition {
  x: number;
  y: number;
}

/** 纯自动布局：每个分P 都能拿到坐标（环、孤立节点也不例外）。 */
export function autoLayout(doc: Project): Map<string, SeriesPosition> {
  const episodes = orderedEpisodes(doc);
  const edges = seriesEdges(doc);
  const next = new Map<string, string[]>();
  const linked = new Set<string>();
  const indegree = new Map<string, number>(episodes.map((episode) => [episode.id, 0]));

  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    linked.add(edge.from);
    linked.add(edge.to);
  }

  const depth = new Map<string, number>();
  const bfs = (start: string, startDepth: number): void => {
    if (depth.has(start)) return;
    const queue: { id: string; depth: number }[] = [{ id: start, depth: startDepth }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (depth.has(current.id)) continue;
      depth.set(current.id, current.depth);
      for (const to of next.get(current.id) ?? []) {
        if (!depth.has(to)) queue.push({ id: to, depth: current.depth + 1 });
      }
    }
  };

  // 根：有入有出的图里没有入边的节点；完全孤立的分P 不算根（要排到最右边）。
  for (const episode of episodes) {
    if (linked.has(episode.id) && (indegree.get(episode.id) ?? 0) === 0) {
      bfs(episode.id, 0);
    }
  }
  if (depth.size < episodes.length) {
    let base = depth.size > 0 ? Math.max(...depth.values()) + 1 : 0;
    for (const episode of episodes) {
      if (depth.has(episode.id)) continue;
      if (linked.has(episode.id)) {
        bfs(episode.id, base);
        base = Math.max(...depth.values()) + 1;
      } else {
        depth.set(episode.id, base);
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const episode of episodes) {
    const layer = depth.get(episode.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), episode.id]);
  }

  const positions = new Map<string, SeriesPosition>();
  for (const [layer, ids] of layers) {
    ids.forEach((id, row) => {
      positions.set(id, {
        x: ORIGIN + layer * (CARD_WIDTH + GAP_X),
        y: ORIGIN + row * (CARD_HEIGHT + GAP_Y),
      });
    });
  }
  return positions;
}

/** 实际坐标：手动坐标优先，缺失 / 非法时回落到自动布局。 */
export function placements(doc: Project): Map<string, SeriesPosition> {
  const auto = autoLayout(doc);
  const manual = doc.seriesGraph?.positions ?? {};
  const result = new Map<string, SeriesPosition>();
  for (const episode of doc.episodes) {
    const saved = manual[episode.id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      result.set(episode.id, { x: saved.x, y: saved.y });
    } else {
      result.set(episode.id, auto.get(episode.id) ?? { x: ORIGIN, y: ORIGIN });
    }
  }
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/series/__tests__/layout.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/series/layout.ts src/core/series/__tests__/layout.test.ts
git commit -m "feat(series): 剧集卡片自动分层布局"
```

---

### Task 3: 读盘归一化 + 序列化往返

**Files:**
- Create: `src/core/series/sanitize.ts`
- Modify: `src/core/serialize.ts`（`normalizeProject()` 里挂上归一化）
- Test: `src/core/series/__tests__/sanitize.test.ts`、`src/core/__tests__/serialize.test.ts`（追加一个 describe）

**Interfaces:**
- Consumes: `SeriesGraphDoc`（Task 1）。
- Produces: `normalizeSeriesGraph(value: unknown): SeriesGraphDoc | undefined`

- [ ] **Step 1: 写失败测试**

新建 `src/core/series/__tests__/sanitize.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { normalizeSeriesGraph } from "@/core/series/sanitize";

describe("normalizeSeriesGraph", () => {
  it("缺字段 / 非对象 → undefined", () => {
    expect(normalizeSeriesGraph(undefined)).toBeUndefined();
    expect(normalizeSeriesGraph(null)).toBeUndefined();
    expect(normalizeSeriesGraph("x")).toBeUndefined();
    expect(normalizeSeriesGraph(1)).toBeUndefined();
  });

  it("custom 非布尔按 false；坏边丢弃；label 只留非空字符串", () => {
    const graph = normalizeSeriesGraph({
      custom: "yes",
      edges: [
        { id: "a", from: "e1", to: "e2", label: "继续" },
        { id: "", from: "e1", to: "e2" },
        { id: "b", from: "e1" },
        { id: "c", from: "e1", to: "e2", label: 42 },
        { id: "d", from: "e1", to: "e2", label: "" },
        "x",
      ],
      positions: {},
    });
    expect(graph).toEqual({
      custom: false,
      edges: [
        { id: "a", from: "e1", to: "e2", label: "继续" },
        { id: "c", from: "e1", to: "e2" },
        { id: "d", from: "e1", to: "e2" },
      ],
      positions: {},
    });
  });

  it("重复 id 只保留第一条", () => {
    const graph = normalizeSeriesGraph({
      custom: true,
      edges: [
        { id: "same", from: "e1", to: "e2" },
        { id: "same", from: "e1", to: "e3" },
      ],
      positions: {},
    });
    expect(graph?.edges).toHaveLength(1);
    expect(graph?.edges[0].to).toBe("e2");
  });

  it("坐标只留有限数", () => {
    const graph = normalizeSeriesGraph({
      custom: true,
      edges: [],
      positions: {
        a: { x: 1, y: 2 },
        b: { x: "1", y: 2 },
        c: { x: Number.POSITIVE_INFINITY, y: 0 },
        d: null,
      },
    });
    expect(graph?.positions).toEqual({ a: { x: 1, y: 2 } });
  });
});
```

在 `src/core/__tests__/serialize.test.ts` 末尾追加（该文件已有 `newProject` / `parseProject` / `serializeProject` 导入）：

```ts
describe("剧集图往返", () => {
  it("写盘保留 seriesGraph，读盘归一化后仍是自定义图", () => {
    const base = newProject("剧集图");
    const doc = addEpisode(addEpisode(base, "第二集"), "第三集");
    const [first, second, third] = doc.episodes;
    const withGraph = {
      ...doc,
      seriesGraph: {
        custom: true,
        edges: [
          { id: "a", from: first.id, to: second.id },
          { id: "b", from: first.id, to: third.id, label: "逃" },
        ],
        positions: { [first.id]: { x: 12, y: 34 } },
      },
    } as Project;

    const json = serializeProject(withGraph);
    expect(json).toContain('"seriesGraph"');

    const parsed = parseProject(json);
    expect(parsed.seriesGraph).toEqual(withGraph.seriesGraph);
  });

  it("坏数据的剧集图降级，不影响其余字段", () => {
    const base = newProject("坏图");
    const raw = JSON.parse(serializeProject(base)) as Record<string, unknown>;
    raw.seriesGraph = { custom: "yes", edges: [{ id: "x" }], positions: { a: { x: "bad", y: 1 } } };
    const parsed = parseProject(JSON.stringify(raw));
    expect(parsed.seriesGraph).toEqual({ custom: false, edges: [], positions: {} });
    expect(parsed.name).toBe("坏图");
  });

  it("旧工程没有 seriesGraph 也能读", () => {
    const parsed = parseProject(serializeProject(newProject("旧工程")));
    expect(parsed.seriesGraph).toBeUndefined();
  });
});
```

同时在测试文件顶部补导入（若尚未存在）：

```ts
import { addEpisode } from "@/core/ops/episodes";
import type { Project } from "@/types/project";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/series/__tests__/sanitize.test.ts src/core/__tests__/serialize.test.ts`
Expected: FAIL —— 找不到 `@/core/series/sanitize`；剧集图往返断言失败。

- [ ] **Step 3: 实现 `src/core/series/sanitize.ts`**

```ts
/** 读盘时归一化剧集图：坏数据降级成「派生链」，不抛错。 */
import type { SeriesEdge, SeriesGraphDoc } from "@/types/project";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSeriesGraph(value: unknown): SeriesGraphDoc | undefined {
  if (!isObject(value)) return undefined;

  const edges: SeriesEdge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.edges)) {
    for (const raw of value.edges) {
      if (!isObject(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const from = typeof raw.from === "string" ? raw.from : "";
      const to = typeof raw.to === "string" ? raw.to : "";
      if (!id || !from || !to || seen.has(id)) continue;
      seen.add(id);
      const label = typeof raw.label === "string" ? raw.label : "";
      edges.push(label ? { id, from, to, label } : { id, from, to });
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  if (isObject(value.positions)) {
    for (const [id, point] of Object.entries(value.positions)) {
      if (!isObject(point) || !finite(point.x) || !finite(point.y)) continue;
      positions[id] = { x: point.x, y: point.y };
    }
  }

  return { custom: value.custom === true, edges, positions };
}
```

- [ ] **Step 4: 在 `normalizeProject()` 里挂上**

`src/core/serialize.ts` 顶部加导入：

```ts
import { normalizeSeriesGraph } from "@/core/series/sanitize";
```

在 `normalizeProject()` 里，`const board = ...` 之后、`return patchProjectMeta(...)` 之前加：

```ts
  const seriesGraph = normalizeSeriesGraph(
    (doc as unknown as { seriesGraph?: unknown }).seriesGraph,
  );
```

并把返回改为（在原有两个可选字段前插入）：

```ts
  return patchProjectMeta(doc, {
    ...(seriesGraph ? { seriesGraph } : {}),
    cutScopes,
    ...(boards ? { boards } : {}),
    ...(board ? { board } : {}),
  });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test src/core/series/__tests__/sanitize.test.ts src/core/__tests__/serialize.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/series/sanitize.ts src/core/series/__tests__/sanitize.test.ts src/core/serialize.ts src/core/__tests__/serialize.test.ts
git commit -m "feat(series): 剧集图读盘归一化与序列化往返"
```

---

### Task 4: 图编辑操作（连 / 断 / 选项名 / 坐标 / 重建 / 清理）

**Files:**
- Create: `src/core/ops/series.ts`
- Modify: `src/core/ops/index.ts`（加一行导出）
- Modify: `src/core/ops/episodes.ts`（`removeEpisode` 收尾清理悬空边）
- Test: `src/core/ops/__tests__/series.test.ts`、`src/core/ops/__tests__/episodes.test.ts`（追加用例）

**Interfaces:**
- Consumes: `derivedChain`（Task 1）、`withTouch`（`ops/internal`）。
- Produces:
  - `materializeGraph(doc: Project): Project`
  - `connectEpisode(doc: Project, from: string, to: string): Project`
  - `disconnectEpisodeEdge(doc: Project, edgeId: string): Project`
  - `setEpisodeEdgeLabel(doc: Project, edgeId: string, label: string): Project`
  - `moveSeriesCard(doc: Project, episodeId: string, x: number, y: number): Project`
  - `autoLayoutSeries(doc: Project): Project`
  - `resetSeriesGraph(doc: Project): Project`
  - `pruneSeriesEdges(doc: Project): Project`

- [ ] **Step 1: 写失败测试**

新建 `src/core/ops/__tests__/series.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode, duplicateEpisode, removeEpisode } from "@/core/ops/episodes";
import {
  autoLayoutSeries,
  connectEpisode,
  disconnectEpisodeEdge,
  materializeGraph,
  moveSeriesCard,
  pruneSeriesEdges,
  resetSeriesGraph,
  setEpisodeEdgeLabel,
} from "@/core/ops/series";
import { derivedChain, isDerived, seriesEdges, stepOf } from "@/core/series/graph";
import type { Project } from "@/types/project";

function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

describe("materializeGraph", () => {
  it("派生链落成 custom 边，id 保持 chain: 前缀", () => {
    const doc = threeEpisodes();
    const next = materializeGraph(doc);
    expect(isDerived(next)).toBe(false);
    expect(next.seriesGraph?.edges).toEqual(derivedChain(doc));
    expect(next.tracks).toBe(next.episodes[0].tracks);
  });

  it("已经是自定义图时原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    expect(materializeGraph(doc)).toBe(doc);
  });
});

describe("connectEpisode", () => {
  it("在派生图上连新边：原有时间链仍在，再追加一条", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const next = connectEpisode(doc, first.id, third.id);
    expect(isDerived(next)).toBe(false);
    const edges = seriesEdges(next);
    expect(edges).toHaveLength(3);
    expect(edges.slice(0, 2)).toEqual(derivedChain(doc));
    expect(edges[2].from).toBe(first.id);
    expect(edges[2].to).toBe(third.id);
    expect(edges[2].label).toBeUndefined();
    expect(stepOf(next, first.id, new Set()).kind).toBe("choices");
  });

  it("拒绝重复边与不存在的分P", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    expect(connectEpisode(doc, first.id, second.id)).toBe(doc);
    expect(connectEpisode(doc, first.id, "gone")).toBe(doc);
    const custom = connectEpisode(doc, first.id, doc.episodes[2].id);
    expect(connectEpisode(custom, first.id, doc.episodes[2].id)).toBe(custom);
  });

  it("自环允许", () => {
    const doc = newProject();
    const id = doc.episodes[0].id;
    const next = connectEpisode(doc, id, id);
    expect(seriesEdges(next)).toHaveLength(1);
    expect(seriesEdges(next)[0].from).toBe(id);
    expect(seriesEdges(next)[0].to).toBe(id);
  });
});

describe("disconnectEpisodeEdge", () => {
  it("派生链上的边也能删，其余链保留", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc);
    const next = disconnectEpisodeEdge(doc, chain[0].id);
    expect(seriesEdges(next)).toEqual([chain[1]]);
  });

  it("删光后 custom 仍为 true，不回退派生链", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc);
    const one = disconnectEpisodeEdge(doc, chain[0].id);
    const empty = disconnectEpisodeEdge(one, chain[1].id);
    expect(empty.seriesGraph?.custom).toBe(true);
    expect(seriesEdges(empty)).toEqual([]);
  });

  it("找不到的边原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    expect(disconnectEpisodeEdge(doc, "nope")).toBe(doc);
  });
});

describe("setEpisodeEdgeLabel", () => {
  it("派生链上的边加选项 → 该出边变成选项", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const chain = derivedChain(doc)[0];
    const next = setEpisodeEdgeLabel(doc, chain.id, "  继续  ");
    expect(seriesEdges(next)[0].label).toBe("继续");
    expect(stepOf(next, first.id, new Set())).toEqual({
      kind: "choices",
      options: [{ edgeId: chain.id, to: second.id, label: "继续", unnamed: false }],
    });
  });

  it("空串清掉选项名", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc)[0];
    const withLabel = setEpisodeEdgeLabel(doc, chain.id, "继续");
    const cleared = setEpisodeEdgeLabel(withLabel, chain.id, "   ");
    expect(seriesEdges(cleared)[0].label).toBeUndefined();
  });

  it("文案没变时原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    const chain = derivedChain(doc)[0];
    expect(setEpisodeEdgeLabel(doc, chain.id, "")).toBe(doc);
    expect(setEpisodeEdgeLabel(doc, "nope", "x")).toBe(doc);
  });
});

describe("moveSeriesCard / autoLayoutSeries", () => {
  it("只写坐标，不改 custom", () => {
    const doc = threeEpisodes();
    const target = doc.episodes[0].id;
    const next = moveSeriesCard(doc, target, 10, 20);
    expect(isDerived(next)).toBe(true);
    expect(next.seriesGraph?.positions[target]).toEqual({ x: 10, y: 20 });
    expect(next.tracks).toBe(next.episodes[0].tracks);
  });

  it("坐标非法或没变时不生效", () => {
    const doc = threeEpisodes();
    const target = doc.episodes[0].id;
    expect(moveSeriesCard(doc, target, Number.NaN, 0)).toBe(doc);
    expect(moveSeriesCard(doc, "gone", 1, 2)).toBe(doc);
    const moved = moveSeriesCard(doc, target, 10, 20);
    expect(moveSeriesCard(moved, target, 10, 20)).toBe(moved);
  });

  it("自动排列清空全部手动坐标", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0].id;
    const moved = moveSeriesCard(doc, first, 10, 20);
    const next = autoLayoutSeries(moved);
    expect(next.seriesGraph?.positions).toEqual({});
    expect(autoLayoutSeries(next)).toBe(next);
  });
});

describe("resetSeriesGraph / pruneSeriesEdges", () => {
  it("重建回到派生链，坐标保留", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0].id;
    const custom = moveSeriesCard(
      connectEpisode(doc, first, doc.episodes[2].id),
      first,
      99,
      88,
    );
    const reset = resetSeriesGraph(custom);
    expect(isDerived(reset)).toBe(true);
    expect(reset.seriesGraph?.positions[first]).toEqual({ x: 99, y: 88 });
    expect(seriesEdges(reset)).toEqual(derivedChain(doc));
  });

  it("prune 清掉悬空边与已删分P 的坐标", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const moved = moveSeriesCard(doc, first.id, 5, 6);
    const broken = {
      ...moved,
      episodes: [first, third],
      seriesGraph: {
        custom: true,
        edges: [
          { id: "keep", from: first.id, to: third.id },
          { id: "drop", from: second.id, to: third.id },
        ],
        positions: moved.seriesGraph!.positions,
      },
    } as Project;
    const next = pruneSeriesEdges(broken);
    expect(next.seriesGraph?.edges.map((edge) => edge.id)).toEqual(["keep"]);
    expect(next.seriesGraph?.positions[first.id]).toEqual({ x: 5, y: 6 });
  });

  it("没有图时 prune 原样返回", () => {
    const doc = newProject();
    expect(pruneSeriesEdges(doc)).toBe(doc);
  });
});

describe("分P 结构改动与图联动", () => {
  it("删除中间分P 会删掉相关边", () => {
    const base = materializeGraph(threeEpisodes());
    const [first, second, third] = base.episodes;
    const positioned = moveSeriesCard(base, second.id, 10, 20);
    const next = removeEpisode(positioned, second.id);
    expect(next.episodes.map((episode) => episode.id)).toEqual([first.id, third.id]);
    expect(next.seriesGraph?.edges).toEqual([]);
    expect(next.seriesGraph?.positions[second.id]).toBeUndefined();
  });

  it("复制分P 不复制入 / 出边", () => {
    const doc = materializeGraph(threeEpisodes());
    const first = doc.episodes[0];
    const next = duplicateEpisode(doc, first.id, "副本");
    const copy = next.episodes.find((episode) => episode.name === "副本")!;
    expect(seriesEdges(next).some((edge) => edge.from === copy.id)).toBe(false);
    expect(seriesEdges(next).some((edge) => edge.to === copy.id)).toBe(false);
  });
});
```

在 `src/core/ops/__tests__/episodes.test.ts` 末尾追加：

```ts
describe("removeEpisode 与剧集图", () => {
  it("删分P 同时删掉指向它的连线", () => {
    const doc = addEpisode(addEpisode(newProject("图"), "第二集"), "第三集");
    const [first, second, third] = doc.episodes;
    const withEdge = connectEpisode(doc, first.id, third.id);
    expect(withEdge.seriesGraph?.edges).toHaveLength(3);
    const next = removeEpisode(withEdge, second.id);
    expect(next.seriesGraph?.edges).toHaveLength(1);
    expect(next.seriesGraph?.edges[0].from).toBe(first.id);
    expect(next.seriesGraph?.edges[0].to).toBe(third.id);
  });
});
```

并在该文件顶部补导入：

```ts
import { connectEpisode } from "@/core/ops/series";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/ops/__tests__/series.test.ts src/core/ops/__tests__/episodes.test.ts`
Expected: FAIL —— 找不到 `@/core/ops/series`。

- [ ] **Step 3: 实现 `src/core/ops/series.ts`**

```ts
/**
 * 剧集图的编辑操作：连 / 断 / 改选项名 / 拖坐标 / 重建。
 *
 * 全部是不可变纯函数，经 `dispatch` 进撤销栈。第一次结构性编辑会把当前派生链
 * 原样落成真实边（`materializeGraph`），所以「加一条分支」不会让时间链消失；
 * 而拖动卡片只写坐标，不会把普通剧集变成自定义图。
 */
import { derivedChain } from "@/core/series/graph";
import { withTouch } from "./internal";
import type { Project, SeriesEdge, SeriesGraphDoc } from "@/types/project";

/** 当前图落成可编辑数据。`changed` 表示这次发生了「派生 → 自定义」。 */
function editable(doc: Project): { graph: SeriesGraphDoc; changed: boolean } {
  const stored = doc.seriesGraph;
  if (stored?.custom) {
    return {
      graph: { custom: true, edges: stored.edges, positions: stored.positions },
      changed: false,
    };
  }
  return {
    graph: { custom: true, edges: derivedChain(doc), positions: stored?.positions ?? {} },
    changed: true,
  };
}

function withGraph(doc: Project, graph: SeriesGraphDoc): Project {
  return withTouch(doc, { seriesGraph: graph });
}

/** 派生链 → 自定义图（已经是自定义时原样返回）。 */
export function materializeGraph(doc: Project): Project {
  const { graph, changed } = editable(doc);
  return changed ? withGraph(doc, graph) : doc;
}

/** 连一条无选项的边；重复边 / 缺失分P 不生效。 */
export function connectEpisode(doc: Project, from: string, to: string): Project {
  const known = new Set(doc.episodes.map((episode) => episode.id));
  if (!known.has(from) || !known.has(to)) return doc;
  const { graph } = editable(doc);
  if (graph.edges.some((edge) => edge.from === from && edge.to === to)) return doc;
  const edge: SeriesEdge = { id: crypto.randomUUID(), from, to };
  return withGraph(doc, { ...graph, edges: [...graph.edges, edge] });
}

/** 删一条边（派生链上的 `chain:` 边同样可删）。 */
export function disconnectEpisodeEdge(doc: Project, edgeId: string): Project {
  const { graph } = editable(doc);
  const edges = graph.edges.filter((edge) => edge.id !== edgeId);
  if (edges.length === graph.edges.length) return doc;
  return withGraph(doc, { ...graph, edges });
}

/** 改选项名；空串 = 清掉文案（回到「无选项」）。 */
export function setEpisodeEdgeLabel(doc: Project, edgeId: string, label: string): Project {
  const { graph } = editable(doc);
  const trimmed = label.trim();
  const target = graph.edges.find((edge) => edge.id === edgeId);
  if (!target) return doc;
  if ((target.label ?? "") === trimmed) return doc;
  const edges = graph.edges.map((edge) => {
    if (edge.id !== edgeId) return edge;
    if (!trimmed) {
      const next = { ...edge };
      delete next.label;
      return next;
    }
    return { ...edge, label: trimmed };
  });
  return withGraph(doc, { ...graph, edges });
}

/** 拖动卡片：只写坐标，不改 custom。 */
export function moveSeriesCard(doc: Project, episodeId: string, x: number, y: number): Project {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return doc;
  if (!doc.episodes.some((episode) => episode.id === episodeId)) return doc;
  const stored = doc.seriesGraph;
  const positions = { ...(stored?.positions ?? {}) };
  const current = positions[episodeId];
  if (current && current.x === x && current.y === y) return doc;
  positions[episodeId] = { x, y };
  const graph: SeriesGraphDoc = {
    custom: stored?.custom === true,
    edges: stored?.edges ?? [],
    positions,
  };
  return withGraph(doc, graph);
}

/** 清空手动坐标，回到自动分层布局。 */
export function autoLayoutSeries(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored || Object.keys(stored.positions).length === 0) return doc;
  return withGraph(doc, { ...stored, positions: {} });
}

/** 按时间顺序重建：丢掉全部边与选项，回到派生链（坐标保留）。 */
export function resetSeriesGraph(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored || !stored.custom) return doc;
  return withGraph(doc, { custom: false, edges: [], positions: stored.positions });
}

/** 清掉悬空边与已删分P 的坐标；删分P 后调用。 */
export function pruneSeriesEdges(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored) return doc;
  const known = new Set(doc.episodes.map((episode) => episode.id));
  const edges = stored.edges.filter((edge) => known.has(edge.from) && known.has(edge.to));
  const positions: Record<string, { x: number; y: number }> = {};
  let droppedPosition = false;
  for (const [id, point] of Object.entries(stored.positions)) {
    if (!known.has(id)) {
      droppedPosition = true;
      continue;
    }
    positions[id] = point;
  }
  if (edges.length === stored.edges.length && !droppedPosition) return doc;
  return withGraph(doc, { ...stored, edges, positions });
}
```

- [ ] **Step 4: 导出并接上删分P 清理**

`src/core/ops/index.ts` 在 `export * from "./episodes";` 之后加：

```ts
export * from "./series";
```

`src/core/ops/episodes.ts` 顶部加：

```ts
import { pruneSeriesEdges } from "./series";
```

改 `removeEpisode()`：把两处 `return withTouch(...)` / `return patchProjectMeta(...)` 换成先算 `next` 再清理：

```ts
export function removeEpisode(doc: Project, episodeId: string): Project {
  if (doc.episodes.length <= 1) return doc;
  const index = doc.episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return doc;
  const episodes = reindex(doc.episodes.filter((episode) => episode.id !== episodeId));
  const next =
    doc.activeEpisodeId !== episodeId
      ? (withTouch(doc, { episodes }) as Project)
      : patchProjectMeta(doc, {
          episodes,
          activeEpisodeId: episodes[Math.min(index, episodes.length - 1)].id,
        });
  return pruneSeriesEdges(next);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test src/core/ops/__tests__/series.test.ts src/core/ops/__tests__/episodes.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/ops/series.ts src/core/ops/index.ts src/core/ops/episodes.ts src/core/ops/__tests__/series.test.ts src/core/ops/__tests__/episodes.test.ts
git commit -m "feat(series): 剧集图编辑操作与删分P 清理"
```

---

### Task 5: 剧集界面：平铺卡片组件 + 平铺 / 连线切换

**Files:**
- Create: `src/composables/useEpisodeOpen.ts`
- Create: `src/components/series/SeriesTile.vue`
- Modify: `src/components/series/SeriesView.vue`
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

**Interfaces:**
- Consumes: `outgoing` / `incoming` / `isDerived`（Task 1）。
- Produces:
  - `useEpisodeOpen(): (episodeId: string) => void`
  - `SeriesTile` props：`episode`、`active`、`selected`、`dragging`、`dropBefore`、`draggable`、`branchCount`、`orphan`、`canRemove`；emits：`open` / `select` / `rename(name)` / `duplicate` / `remove` / `dragstart` / `dragover` / `drop` / `dragend`。
  - `SeriesView` 暴露给 Task 6 的挂载点：`<SeriesGraph v-else @open="open" />`（组件在 Task 6 创建，本任务先不引用）。

- [ ] **Step 1: 新建 `src/composables/useEpisodeOpen.ts`**

```ts
/** 进入某个分P 的预览：切分P + 播放头归零 + 回到预览界面。 */
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useViewStore } from "@/stores/view";

export function useEpisodeOpen(): (episodeId: string) => void {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const view = useViewStore();

  return (episodeId: string): void => {
    if (episodeId !== project.doc.activeEpisodeId) project.switchEpisode(episodeId);
    playback.setPlayhead(0);
    view.setView("preview");
  };
}
```

- [ ] **Step 2: 新建 `src/components/series/SeriesTile.vue`**

```vue
<script setup lang="ts">
/**
 * 剧集平铺卡片：封面、名字、统计与悬浮工具。
 *
 * 单击只是选中，**双击**或右下角「预览」按钮才进预览；拖拽换序仍决定默认时间链。
 */
import { computed, nextTick, ref } from "vue";
import {
  CheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlayIcon,
  QueueListIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { episodeDuration } from "@/core/ops/episodes";
import { assetThumbnailUrl } from "@/core/thumbnails";
import type { Episode } from "@/types/project";

const props = defineProps<{
  episode: Episode;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  dropBefore: boolean;
  draggable: boolean;
  branchCount: number;
  orphan: boolean;
  canRemove: boolean;
}>();

const emit = defineEmits<{
  (e: "open"): void;
  (e: "select"): void;
  (e: "rename", name: string): void;
  (e: "duplicate"): void;
  (e: "remove"): void;
  (e: "dragstart", event: DragEvent): void;
  (e: "dragover", event: DragEvent): void;
  (e: "drop", event: DragEvent): void;
  (e: "dragend"): void;
}>();

const i18n = useI18n();
const project = useProjectStore();

const renaming = ref(false);
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
const duration = computed(() => episodeDuration(props.episode));

/** 封面：第一条有缩略图的片段所属素材。 */
const cover = computed<string | null>(() => {
  for (const track of props.episode.tracks) {
    for (const clip of track.clips) {
      const asset = project.doc.assets.find((item) => item.id === clip.assetId);
      const url = asset ? assetThumbnailUrl(asset) : null;
      if (url) return url;
    }
  }
  return null;
});

const clipCount = computed(() =>
  props.episode.tracks.reduce((sum, track) => sum + track.clips.length, 0),
);

/** 卡片上的时长：mm:ss（超过一小时带小时）。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function startRename(): void {
  renaming.value = true;
  renameDraft.value = props.episode.name;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function commitRename(): void {
  if (!renaming.value) return;
  renaming.value = false;
  emit("rename", renameDraft.value);
}
</script>

<template>
  <article
    class="series-card"
    :class="{
      current: active,
      selected,
      dragging,
      'drop-before': dropBefore,
    }"
    :draggable="draggable"
    :aria-current="active ? 'true' : undefined"
    @click="emit('select')"
    @dblclick="emit('open')"
    @dragstart="emit('dragstart', $event)"
    @dragover="emit('dragover', $event)"
    @drop="emit('drop', $event)"
    @dragend="emit('dragend')"
  >
    <div class="series-cover">
      <img v-if="cover" :src="cover" :alt="episode.name" loading="lazy" draggable="false" />
      <div v-else class="series-cover-empty" aria-hidden="true">
        <QueueListIcon />
      </div>
      <span v-if="active" class="series-badge">
        <CheckIcon />
        {{ i18n.t("series.current") }}
      </span>
      <span class="series-time">{{ clock(duration) }}</span>
      <span v-if="branchCount > 1" class="series-branch">
        {{ i18n.t("series.branchCount", { count: branchCount }) }}
      </span>
      <span v-else-if="orphan" class="series-branch">{{ i18n.t("series.orphan") }}</span>
      <button
        type="button"
        class="series-preview"
        :title="i18n.t('series.preview')"
        :aria-label="i18n.t('series.preview')"
        @click.stop="emit('open')"
      >
        <PlayIcon />
      </button>
    </div>

    <div class="series-meta">
      <div class="series-name-row">
        <input
          v-if="renaming"
          ref="renameInput"
          v-model="renameDraft"
          class="series-rename"
          type="text"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = false"
          @blur="commitRename"
        />
        <h3 v-else class="series-name" :title="episode.name">{{ episode.name }}</h3>
      </div>
      <p class="series-stats">
        <span>{{ i18n.t("series.tracks", { count: episode.tracks.length }) }}</span>
        <span class="series-dot" aria-hidden="true">·</span>
        <span>{{ i18n.t("series.clips", { count: clipCount }) }}</span>
      </p>

      <div class="series-tools">
        <button
          type="button"
          :title="i18n.t('common.rename')"
          :aria-label="i18n.t('common.rename')"
          @click.stop="startRename"
        >
          <PencilSquareIcon />
        </button>
        <button
          type="button"
          :title="i18n.t('series.duplicate')"
          :aria-label="i18n.t('series.duplicate')"
          @click.stop="emit('duplicate')"
        >
          <DocumentDuplicateIcon />
        </button>
        <button
          type="button"
          class="danger"
          :title="i18n.t('common.delete')"
          :aria-label="i18n.t('common.delete')"
          :disabled="!canRemove"
          @click.stop="emit('remove')"
        >
          <TrashIcon />
        </button>
        <span class="series-clock">
          <ClockIcon />
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* 卡片本体：从 SeriesView.vue 原样搬来（视觉不变）。 */
.series-card {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.series-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.12);
  border-color: rgb(var(--md-primary) / 0.45);
}
.series-card.current {
  border-color: rgb(var(--md-primary));
}
.series-card.selected {
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.55);
}
.series-card.dragging {
  opacity: 0.55;
}
.series-card.drop-before::before {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  top: -7px;
  height: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.series-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-color: rgb(var(--md-surface-container-highest));
}
.series-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.series-cover-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgb(var(--md-on-surface-variant) / 0.5);
}
.series-cover-empty :deep(svg) {
  width: 26px;
  height: 26px;
}
.series-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary) / 0.92);
}
.series-badge :deep(svg) {
  width: 12px;
  height: 12px;
}
.series-time {
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background-color: rgb(0 0 0 / 0.55);
}
/* 右下角常驻的预览按钮：不用悬停也能看见、能点。 */
.series-preview {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.92);
  color: rgb(var(--md-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.series-preview:hover {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.series-preview :deep(svg) {
  width: 15px;
  height: 15px;
}
.series-branch {
  position: absolute;
  left: 8px;
  bottom: 8px;
  height: 18px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 10px;
  line-height: 18px;
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container) / 0.92);
}
.series-meta {
  padding: 9px 10px 8px;
}
.series-name-row {
  min-height: 20px;
}
.series-name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-rename {
  width: 100%;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-primary));
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
.series-stats {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.series-dot {
  margin: 0 4px;
}
.series-tools {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.95);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.series-card:hover .series-tools,
.series-card:focus-within .series-tools {
  opacity: 1;
}
.series-tools button {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.series-tools button:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.series-tools button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.series-tools button.danger:hover {
  color: rgb(var(--md-error));
}
.series-tools button :deep(svg) {
  width: 14px;
  height: 14px;
}
.series-clock {
  display: none;
}
</style>
```

- [ ] **Step 3: 重写 `SeriesView.vue`**

脚本 `<script setup>` 全量替换为：

```vue
<script setup lang="ts">
/**
 * 剧集界面：工程内所有分P 的总览。
 *
 * 两种形态：平铺（网格，拖拽换序仍决定默认时间链）与连线（自由画布，见 SeriesGraph）。
 * 平铺下单击选中、双击 / 右下预览按钮进入预览。
 */
import { computed, ref } from "vue";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  QueueListIcon,
} from "@heroicons/vue/24/outline";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import SeriesTile from "./SeriesTile.vue";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { useEpisodeOpen } from "@/composables/useEpisodeOpen";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import {
  addEpisode,
  duplicateEpisode,
  episodeDuration,
  moveEpisode,
  removeEpisode,
  renameEpisode,
} from "@/core/ops";
import { incoming, isDerived, outgoing } from "@/core/series/graph";
import type { Episode } from "@/types/project";

type SeriesMode = "tile" | "graph";

const i18n = useI18n();
const project = useProjectStore();
const openEpisode = useEpisodeOpen();

const mode = ref<SeriesMode>("tile");
const query = ref("");
const selectedId = ref<string | null>(null);
const draggingId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);

const episodes = computed(() => project.doc.episodes);
const activeId = computed(() => project.doc.activeEpisodeId);

const modes = computed(() => [
  { value: "tile", label: i18n.t("series.view.tile") },
  { value: "graph", label: i18n.t("series.view.graph") },
]);

const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text
    ? episodes.value.filter((episode) => episode.name.toLowerCase().includes(text))
    : [...episodes.value];
});

/** 卡片上的时长：mm:ss（超过一小时带小时）。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function defaultEpisodeName(): string {
  return i18n.t("series.newEpisodeName", { index: episodes.value.length + 1 });
}

function setMode(value: string): void {
  mode.value = value === "graph" ? "graph" : "tile";
}

function open(episode: Episode): void {
  openEpisode(episode.id);
}

function createEpisode(): void {
  project.dispatch((doc) => addEpisode(doc, defaultEpisodeName()));
}

function duplicate(episode: Episode): void {
  project.dispatch((doc) =>
    duplicateEpisode(doc, episode.id, i18n.t("series.duplicateSuffix", { name: episode.name })),
  );
}

function rename(episode: Episode, name: string): void {
  project.dispatch((doc) => renameEpisode(doc, episode.id, name));
}

async function remove(episode: Episode): Promise<void> {
  if (episodes.value.length <= 1) {
    toast(i18n.t("series.keepLast"), "info");
    return;
  }
  const accepted = await confirm({
    title: i18n.t("series.deleteTitle"),
    message: i18n.t("series.deleteMessage", { name: episode.name }),
    confirmText: i18n.t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;
  project.dispatch((doc) => removeEpisode(doc, episode.id));
}

/** 出边数：≥2 说明这一集有分叉。 */
function branchCount(episode: Episode): number {
  return outgoing(project.doc, episode.id).length;
}

/** 自定义图里既没有入边也没有出边的孤立分P。 */
function orphan(episode: Episode): boolean {
  if (isDerived(project.doc) || episodes.value.length <= 1) return false;
  return (
    incoming(project.doc, episode.id).length === 0 &&
    outgoing(project.doc, episode.id).length === 0
  );
}

function onDragStart(episode: Episode, event: DragEvent): void {
  if (mode.value !== "tile") return;
  draggingId.value = episode.id;
  event.dataTransfer?.setData("text/plain", episode.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(index: number, event: DragEvent): void {
  if (!draggingId.value || mode.value !== "tile") return;
  event.preventDefault();
  dropIndex.value = index;
}

function onDrop(index: number, event: DragEvent): void {
  event.preventDefault();
  const id = draggingId.value;
  draggingId.value = null;
  dropIndex.value = null;
  if (!id) return;
  project.dispatch((doc) => moveEpisode(doc, id, index));
}

function onDragEnd(): void {
  draggingId.value = null;
  dropIndex.value = null;
}

const totalDuration = computed(() =>
  episodes.value.reduce((sum, episode) => sum + episodeDuration(episode), 0),
);
</script>
```

模板替换 `series-actions` 里的排序按钮与网格：

```vue
        <label v-if="mode === 'tile'" class="series-search">
          <MagnifyingGlassIcon class="series-search-icon" />
          <input
            v-model="query"
            type="search"
            :placeholder="i18n.t('series.search')"
            :aria-label="i18n.t('series.search')"
          />
        </label>
        <SegmentedControl
          :model-value="mode"
          :options="modes"
          :aria-label="i18n.t('series.viewMode')"
          size="sm"
          @update:model-value="setMode"
        />
        <button class="series-new" type="button" @click="createEpisode">
          <PlusIcon class="series-new-icon" />
          <span>{{ i18n.t("series.newEpisode") }}</span>
        </button>
```

网格部分（`<div v-else class="series-grid">` 整块）替换为下面这一组（搜索空态只在平铺模式生效）：

```vue
    <div v-else-if="mode === 'tile' && visible.length === 0" class="series-empty">
      <p class="series-empty-title">{{ i18n.t("series.emptySearch") }}</p>
    </div>

    <div v-else-if="mode === 'tile'" class="series-grid">
      <SeriesTile
        v-for="(episode, index) in visible"
        :key="episode.id"
        :episode="episode"
        :active="episode.id === activeId"
        :selected="selectedId === episode.id"
        :dragging="draggingId === episode.id"
        :drop-before="dropIndex === index"
        :draggable="true"
        :branch-count="branchCount(episode)"
        :orphan="orphan(episode)"
        :can-remove="episodes.length > 1"
        @select="selectedId = episode.id"
        @open="open(episode)"
        @rename="(name) => rename(episode, name)"
        @duplicate="duplicate(episode)"
        @remove="remove(episode)"
        @dragstart="onDragStart(episode, $event)"
        @dragover="onDragOver(index, $event)"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      />
    </div>
```

同时删掉原来那条 `v-else-if="visible.length === 0"` 的空态块（上面的片段已经带了平铺版）。

（连线画布的分支在 Task 6 加。）

样式：删掉 `.series-sort`、`.series-sort button`、`.series-sort button.on` 三条规则（排序按钮已移除），
以及所有卡片相关规则（`.series-card`、`.series-cover`、`.series-cover-empty`、`.series-badge`、`.series-time`、
`.series-meta`、`.series-name-row`、`.series-name`、`.series-rename`、`.series-stats`、`.series-dot`、
`.series-tools*`、`.series-clock`）、`.series-preview`、`.series-branch` ——它们都搬进了 `SeriesTile.vue`。
保留 `.series-view`、`.series-head`、`.series-title*`、`.series-count`、`.series-duration`、`.series-actions`、
`.series-search*`、`.series-new*`、`.series-empty*`、`.series-grid`。

- [ ] **Step 4: i18n 中英同步**

`src/i18n/zh.ts`：把

```ts
  "series.sort": "排序",
  "series.sortManual": "手动",
  "series.sortDuration": "时长",
```

替换为：

```ts
  "series.viewMode": "显示方式",
  "series.view.tile": "平铺",
  "series.view.graph": "连线",
  "series.preview": "预览",
  "series.branchCount": "{count} 个选项",
  "series.orphan": "未接入",
```

`src/i18n/en.ts` 同样替换：

```ts
  "series.viewMode": "View",
  "series.view.tile": "Tiles",
  "series.view.graph": "Flow",
  "series.preview": "Preview",
  "series.branchCount": "{count} choices",
  "series.orphan": "Not linked",
```

- [ ] **Step 5: 类型检查 + 测试**

Run: `pnpm test && pnpm build`
Expected: 测试全绿；`vue-tsc` 零错误；vite build 成功。

- [ ] **Step 6: 提交**

```bash
git add src/composables/useEpisodeOpen.ts src/components/series/SeriesTile.vue src/components/series/SeriesView.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(series): 平铺卡片拆分、显示方式切换与双击预览"
```

---

### Task 6: 连线画布（Vue Flow）

**Files:**
- Create: `src/components/series/SeriesGraphCard.vue`
- Create: `src/components/series/SeriesEdge.vue`
- Create: `src/components/series/SeriesGraph.vue`
- Modify: `src/components/series/SeriesView.vue`（挂载 `<SeriesGraph>`）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`（画布 / 连线 / 面板文案）

**Interfaces:**
- Consumes: `seriesEdges`（Task 1）、`CARD_WIDTH` / `placements`（Task 2）、`connectEpisode` / `disconnectEpisodeEdge` / `setEpisodeEdgeLabel` / `moveSeriesCard` / `autoLayoutSeries` / `resetSeriesGraph`（Task 4）、`useEpisodeOpen`（Task 5）、`confirm` / `toast`。
- Produces: `SeriesGraph` emit `open(episodeId: string)`；Vue Flow 类型名固定为 `seriesCard` / `seriesEdge`。

- [ ] **Step 1: 新建 `src/components/series/SeriesGraphCard.vue`**

```vue
<script setup lang="ts">
/**
 * 连线画布上的一张分P 卡片。
 *
 * 左右各一个 Handle：左边接入、右边拖出下一步。节点拖拽与双击由 SeriesGraph 统一处理，
 * 卡片只负责展示与「预览」按钮。
 */
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { PlayIcon, QueueListIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { useEpisodeOpen } from "@/composables/useEpisodeOpen";
import { episodeDuration } from "@/core/ops/episodes";
import { assetThumbnailUrl } from "@/core/thumbnails";

const props = defineProps<{
  id?: string;
  data?: { episodeId?: string };
}>();

const i18n = useI18n();
const project = useProjectStore();
const openEpisode = useEpisodeOpen();

const episode = computed(
  () => project.doc.episodes.find((item) => item.id === props.data?.episodeId) ?? null,
);

const cover = computed<string | null>(() => {
  const target = episode.value;
  if (!target) return null;
  for (const track of target.tracks) {
    for (const clip of track.clips) {
      const asset = project.doc.assets.find((item) => item.id === clip.assetId);
      const url = asset ? assetThumbnailUrl(asset) : null;
      if (url) return url;
    }
  }
  return null;
});

const clipCount = computed(() =>
  episode.value
    ? episode.value.tracks.reduce((sum, track) => sum + track.clips.length, 0)
    : 0,
);

const duration = computed(() => (episode.value ? episodeDuration(episode.value) : 0));

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function open(): void {
  if (episode.value) openEpisode(episode.value.id);
}
</script>

<template>
  <article
    class="series-node"
    :class="{ current: episode?.id === project.doc.activeEpisodeId }"
  >
    <Handle id="in" type="target" :position="Position.Left" class="series-handle series-handle-in" />
    <Handle id="out" type="source" :position="Position.Right" class="series-handle series-handle-out" />

    <div class="series-node-cover">
      <img v-if="cover" :src="cover" :alt="episode?.name ?? ''" loading="lazy" draggable="false" />
      <div v-else class="series-node-cover-empty" aria-hidden="true">
        <QueueListIcon />
      </div>
      <span class="series-node-time">{{ clock(duration) }}</span>
    </div>

    <div class="series-node-meta">
      <h3 :title="episode?.name">{{ episode?.name }}</h3>
      <p>{{ i18n.t("series.clips", { count: clipCount }) }}</p>
    </div>

    <button
      type="button"
      class="series-node-preview nodrag"
      :title="i18n.t('series.preview')"
      :aria-label="i18n.t('series.preview')"
      @click.stop="open"
    >
      <PlayIcon />
    </button>
  </article>
</template>

<style scoped>
.series-node {
  position: relative;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  color: rgb(var(--md-on-surface));
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.series-node.current {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-primary) / 0.5);
}
/* Vue Flow 给选中节点加的类名（库默认），这里只强调描边。 */
:global(.vue-flow__node.selected) .series-node {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.45);
}
.series-node-cover {
  position: relative;
  height: 108px;
  background-color: rgb(var(--md-surface-container-highest));
}
.series-node-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.series-node-cover-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgb(var(--md-on-surface-variant) / 0.5);
}
.series-node-cover-empty :deep(svg) {
  width: 22px;
  height: 22px;
}
.series-node-time {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background-color: rgb(0 0 0 / 0.55);
}
.series-node-meta {
  padding: 7px 9px 8px;
}
.series-node-meta h3 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-node-meta p {
  margin: 2px 0 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.series-node-preview {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.95);
  color: rgb(var(--md-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
}
.series-node-preview:hover {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.series-node-preview :deep(svg) {
  width: 14px;
  height: 14px;
}
.series-handle {
  width: 10px;
  height: 10px;
  border: 2px solid rgb(var(--md-surface));
  background-color: rgb(var(--md-primary));
}
.series-handle-in {
  left: -6px;
}
.series-handle-out {
  right: -6px;
}
</style>
```

- [ ] **Step 2: 新建 `src/components/series/SeriesEdge.vue`**

```vue
<script setup lang="ts">
/**
 * 剧集连线：一条有向贝塞尔曲线；有选项名时在中间显示胶囊。
 *
 * 选中态由 SeriesGraph 通过 `data.active` 传进来（不依赖 Vue Flow 内部的 selected，
 * 因为边数组是随工程文档重建的）。
 */
import { computed } from "vue";
import { EdgeLabelRenderer, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const label = computed(() => {
  const value = (props.data as { label?: string } | undefined)?.label;
  return value ?? "";
});

const active = computed(() =>
  Boolean((props.data as { active?: boolean } | undefined)?.active),
);

const path = computed(() => {
  const gap = Math.abs(props.targetX - props.sourceX);
  const distance = Math.max(40, Math.min(160, gap * 0.55));
  return `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + distance} ${props.sourceY}, ${props.targetX - distance} ${props.targetY}, ${props.targetX} ${props.targetY}`;
});

const labelX = computed(() => (props.sourceX + props.targetX) / 2);
const labelY = computed(() => (props.sourceY + props.targetY) / 2);
</script>

<template>
  <g class="series-edge" :data-active="active ? 'true' : undefined">
    <path class="series-edge-line" :d="path" />
    <path class="series-edge-hit" :d="path" />
  </g>
  <EdgeLabelRenderer v-if="label">
    <div
      class="series-edge-label"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
    >
      {{ label }}
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.series-edge-line {
  fill: none;
  stroke: rgb(var(--md-outline) / 0.85);
  stroke-width: 1.6;
  stroke-linecap: round;
  transition: stroke 0.14s ease, stroke-width 0.14s ease;
}
.series-edge[data-active="true"] .series-edge-line {
  stroke: rgb(var(--md-primary));
  stroke-width: 2.6;
}
.series-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: pointer;
}
.series-edge-label {
  position: absolute;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container) / 0.95);
  pointer-events: none;
}
</style>
```

- [ ] **Step 3: 新建 `src/components/series/SeriesGraph.vue`**

```vue
<script setup lang="ts">
/**
 * 剧集连线画布。
 *
 * 用 Vue Flow 渲染（与 BoardView 同一个画布库，但不共享节点 / store / 端口概念）：
 * 分P 是节点、播放关系是边，全部由 `project.doc` 派生；用户拖卡片 / 连线 / 改选项名
 * 后写回工程。读取一律走 `core/series/graph`，布局走 `core/series/layout`。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Background } from "@vue-flow/background";
import {
  ConnectionMode,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseEvent,
} from "@vue-flow/core";
import {
  ArrowsPointingOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { CARD_WIDTH, placements } from "@/core/series/layout";
import { orderedEpisodes, seriesEdges } from "@/core/series/graph";
import {
  autoLayoutSeries,
  connectEpisode,
  disconnectEpisodeEdge,
  moveSeriesCard,
  resetSeriesGraph,
  setEpisodeEdgeLabel,
} from "@/core/ops";
import SeriesGraphCard from "./SeriesGraphCard.vue";
import SeriesEdge from "./SeriesEdge.vue";

const emit = defineEmits<{ (e: "open", episodeId: string): void }>();

const nodeTypes = { seriesCard: SeriesGraphCard };
const edgeTypes = { seriesEdge: SeriesEdge };

const i18n = useI18n();
const project = useProjectStore();

const {
  fitView,
  findEdge,
  zoomIn,
  zoomOut,
  onViewportChange,
  onNodeDragStop,
  onNodesInitialized,
  onEdgeClick,
  onPaneClick,
} = useVueFlow();

const rootEl = ref<HTMLElement | null>(null);
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const selectedEdgeId = ref<string | null>(null);
const labelDraft = ref("");
const liveZoom = ref(1);
const viewport = ref({ x: 0, y: 0, zoom: 1 });

const zoomPercent = computed(() => Math.round(liveZoom.value * 100));
const hasEdges = computed(() => seriesEdges(project.doc).length > 0);

const selectedEdge = computed(
  () => flowEdges.value.find((edge) => edge.id === selectedEdgeId.value) ?? null,
);

const selectedRoute = computed(() => {
  const edge = selectedEdge.value;
  if (!edge) return "";
  const nameOf = (id: string) =>
    project.doc.episodes.find((episode) => episode.id === id)?.name ?? "?";
  return i18n.t("series.edge.route", { from: nameOf(edge.source), to: nameOf(edge.target) });
});

/** 编辑面板定位：边中点 → 屏幕坐标，再夹在画布范围内。 */
const panelStyle = computed<Record<string, string>>(() => {
  const id = selectedEdgeId.value;
  const root = rootEl.value;
  // 读一下 selectedEdge：节点被拖动后 edges 会重建，这里要跟着重新定位。
  void selectedEdge.value;
  const edge = id ? findEdge(id) : null;
  if (!root || !edge) return { display: "none" };
  const zoom = viewport.value.zoom || 1;
  const midX = ((edge.sourceX + edge.targetX) / 2) * zoom + viewport.value.x;
  const midY = ((edge.sourceY + edge.targetY) / 2) * zoom + viewport.value.y;
  const x = Math.min(Math.max(midX, 150), Math.max(150, root.clientWidth - 150));
  const y = Math.min(Math.max(midY + 14, 90), Math.max(90, root.clientHeight - 130));
  return { left: `${x}px`, top: `${y}px` };
});

function syncNodes(): void {
  const existing = new Map(flowNodes.value.map((node) => [node.id, node]));
  const positions = placements(project.doc);
  flowNodes.value = orderedEpisodes(project.doc).map((episode) => {
    const current = existing.get(episode.id);
    const position = positions.get(episode.id) ?? { x: 0, y: 0 };
    if (current) return { ...current, position };
    return {
      id: episode.id,
      type: "seriesCard",
      position,
      style: { width: `${CARD_WIDTH}px` },
      data: { episodeId: episode.id },
    } satisfies Node;
  });
}

function syncEdges(): void {
  flowEdges.value = seriesEdges(project.doc).map((edge) => ({
    id: edge.id,
    type: "seriesEdge",
    source: edge.from,
    sourceHandle: "out",
    target: edge.to,
    targetHandle: "in",
    data: { label: edge.label ?? "", active: edge.id === selectedEdgeId.value },
  }));
}

watch(
  () => project.doc,
  () => {
    syncNodes();
    syncEdges();
  },
  { immediate: true },
);
watch(selectedEdgeId, () => {
  const edge = selectedEdgeId.value
    ? seriesEdges(project.doc).find((item) => item.id === selectedEdgeId.value)
    : null;
  labelDraft.value = edge?.label ?? "";
  syncEdges();
});

function fitAll(): void {
  void fitView({ padding: 0.25, maxZoom: 1 });
}

/** 第一次量完节点尺寸后适应视图；之后加节点不再抢视口。 */
let fitted = false;
onNodesInitialized(() => {
  if (fitted) return;
  fitted = true;
  fitAll();
});

function onConnect(connection: Connection): void {
  if (project.readOnly) return;
  project.dispatch((doc) => connectEpisode(doc, connection.source, connection.target));
}

function onNodeDoubleClick({ node }: NodeMouseEvent): void {
  emit("open", node.id);
}

onNodeDragStop((event) => {
  if (project.readOnly) return;
  const moves = event.nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
  }));
  project.dispatch((doc) =>
    moves.reduce((acc, move) => moveSeriesCard(acc, move.id, move.x, move.y), doc),
  );
});

onEdgeClick(({ edge }) => {
  selectedEdgeId.value = edge.id;
});

onPaneClick(() => {
  selectedEdgeId.value = null;
});

onViewportChange((transform) => {
  viewport.value = transform;
  liveZoom.value = transform.zoom;
});

function commitLabel(): void {
  const id = selectedEdgeId.value;
  if (!id || project.readOnly) return;
  project.dispatch((doc) => setEpisodeEdgeLabel(doc, id, labelDraft.value));
}

function removeEdge(): void {
  const id = selectedEdgeId.value;
  if (!id || project.readOnly) return;
  selectedEdgeId.value = null;
  project.dispatch((doc) => disconnectEpisodeEdge(doc, id));
}

function doAutoLayout(): void {
  if (project.readOnly) return;
  project.dispatch((doc) => autoLayoutSeries(doc));
  fitAll();
}

async function rebuild(): Promise<void> {
  if (project.readOnly) return;
  const accepted = await confirm({
    title: i18n.t("series.graph.rebuildTitle"),
    message: i18n.t("series.graph.rebuildMessage"),
    confirmText: i18n.t("series.graph.rebuild"),
    destructive: true,
  });
  if (!accepted) return;
  project.dispatch((doc) => resetSeriesGraph(doc));
  toast(i18n.t("series.graph.rebuildDone"));
  fitAll();
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  if (event.key === "Escape") {
    selectedEdgeId.value = null;
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedEdgeId.value &&
    !event.metaKey &&
    !event.ctrlKey &&
    !project.readOnly
  ) {
    event.preventDefault();
    removeEdge();
  }
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <section ref="rootEl" class="series-graph" data-view="series-graph">
    <VueFlow
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :min-zoom="0.25"
      :max-zoom="2"
      :pan-on-scroll="true"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      :nodes-draggable="!project.readOnly"
      :nodes-connectable="!project.readOnly"
      :edges-selectable="!project.readOnly"
      :connection-mode="ConnectionMode.Loose"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      @connect="onConnect"
      @node-double-click="onNodeDoubleClick"
    >
      <Background
        id="series-grid"
        :gap="22"
        :size="1"
        pattern-color="var(--ab-dot-minor)"
        bg-color="transparent"
      />
    </VueFlow>

    <div class="graph-toolbar" role="toolbar" :aria-label="i18n.t('series.graph.fit')">
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.zoomOut')"
        :aria-label="i18n.t('series.graph.zoomOut')"
        @click="zoomOut({ duration: 120 })"
      >
        <MagnifyingGlassMinusIcon />
      </button>
      <button class="graph-zoom tabular" type="button" :title="i18n.t('series.graph.fit')" @click="fitAll">
        {{ zoomPercent }}%
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.zoomIn')"
        :aria-label="i18n.t('series.graph.zoomIn')"
        @click="zoomIn({ duration: 120 })"
      >
        <MagnifyingGlassPlusIcon />
      </button>
      <span class="graph-sep" aria-hidden="true" />
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.fit')"
        :aria-label="i18n.t('series.graph.fit')"
        @click="fitAll"
      >
        <ArrowsPointingOutIcon />
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.autoLayout')"
        :aria-label="i18n.t('series.graph.autoLayout')"
        :disabled="project.readOnly"
        @click="doAutoLayout"
      >
        <span class="graph-tool-text">{{ i18n.t("series.graph.autoLayout") }}</span>
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.rebuild')"
        :aria-label="i18n.t('series.graph.rebuild')"
        :disabled="project.readOnly || !project.doc.seriesGraph?.custom"
        @click="rebuild"
      >
        <span class="graph-tool-text">{{ i18n.t("series.graph.rebuild") }}</span>
      </button>
    </div>

    <div v-if="!hasEdges" class="graph-hint">
      <p class="graph-hint-title">{{ i18n.t("series.graph.empty") }}</p>
      <p class="graph-hint-text">{{ i18n.t("series.graph.emptyHint") }}</p>
    </div>

    <form
      v-if="selectedEdge && !project.readOnly"
      class="edge-panel"
      :style="panelStyle"
      @submit.prevent="commitLabel"
      @pointerdown.stop
    >
      <p class="edge-route">{{ selectedRoute }}</p>
      <div class="edge-row">
        <input
          v-model="labelDraft"
          class="edge-input"
          type="text"
          :placeholder="i18n.t('series.edge.labelPlaceholder', { index: 1 })"
          :aria-label="i18n.t('series.edge.label')"
          @keydown.esc.prevent="selectedEdgeId = null"
          @blur="commitLabel"
        />
        <button
          class="edge-delete"
          type="button"
          :title="i18n.t('series.edge.delete')"
          :aria-label="i18n.t('series.edge.delete')"
          @mousedown.prevent
          @click="removeEdge"
        >
          <TrashIcon />
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.series-graph {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* 圆点底色：和画布同一套视觉，但不引入 .ab-canvas 的整套节点配色。 */
  --ab-dot-minor: rgb(var(--md-outline) / 0.45);
  background-color: var(--app-bg);
}
.series-graph :deep(.vue-flow) {
  background: transparent;
}
.series-graph :deep(.vue-flow__node) {
  border: 0;
  background: transparent;
  padding: 0;
}
.graph-toolbar {
  position: absolute;
  left: 14px;
  top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.92);
  box-shadow: var(--md-elevation-1);
  z-index: 4;
}
.graph-tool {
  height: 26px;
  min-width: 26px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  cursor: pointer;
}
.graph-tool:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.graph-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.graph-tool :deep(svg) {
  width: 15px;
  height: 15px;
}
.graph-tool-text {
  white-space: nowrap;
}
.graph-zoom {
  min-width: 44px;
  height: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.graph-zoom:hover {
  color: rgb(var(--md-on-surface));
}
.graph-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background-color: rgb(var(--md-outline-variant) / 0.8);
}
.graph-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
.graph-hint-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.graph-hint-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.edge-panel {
  position: absolute;
  z-index: 5;
  width: 260px;
  padding: 8px;
  border-radius: 12px;
  transform: translate(-50%, 0);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-2);
}
.edge-route {
  margin: 0 0 6px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edge-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.edge-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
.edge-input:focus {
  border-color: rgb(var(--md-primary));
}
.edge-delete {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.edge-delete:hover {
  color: rgb(var(--md-error));
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
}
.edge-delete :deep(svg) {
  width: 15px;
  height: 15px;
}
</style>
```

- [ ] **Step 4: 在 `SeriesView.vue` 挂载**

导入：

```ts
import SeriesGraph from "./SeriesGraph.vue";
```

把 Task 5 的 `<div v-else-if="mode === 'tile'" class="series-grid">` 之前的空态判断保持，网格块之后加：

```vue
    <SeriesGraph v-else @open="openEpisode" />
```

（`openEpisode` 已在 Task 5 里由 `useEpisodeOpen()` 拿到。）

- [ ] **Step 5: i18n 补齐（中英）**

`src/i18n/zh.ts` 在 `series.orphan` 之后加：

```ts
  "series.graph.empty": "还没有连线",
  "series.graph.emptyHint": "从卡片右侧的圆点拖到另一张分P，建立播放顺序",
  "series.graph.fit": "适应视图",
  "series.graph.autoLayout": "自动排列",
  "series.graph.rebuild": "按时间顺序重建",
  "series.graph.rebuildTitle": "重建剧集连线",
  "series.graph.rebuildMessage": "这会删掉所有手动连线和选项，按分P 的当前顺序生成一条时间链。",
  "series.graph.rebuildDone": "已按时间顺序重建",
  "series.graph.zoomIn": "放大",
  "series.graph.zoomOut": "缩小",
  "series.edge.label": "选项名",
  "series.edge.labelPlaceholder": "选项 {index}",
  "series.edge.delete": "删除连线",
  "series.edge.route": "{from} → {to}",
```

`src/i18n/en.ts` 对应位置加：

```ts
  "series.graph.empty": "No connections yet",
  "series.graph.emptyHint": "Drag from a card's right handle onto another part to set the play order",
  "series.graph.fit": "Fit view",
  "series.graph.autoLayout": "Auto layout",
  "series.graph.rebuild": "Rebuild in time order",
  "series.graph.rebuildTitle": "Rebuild episode flow",
  "series.graph.rebuildMessage": "This removes every manual connection and choice, and generates a single time-ordered chain from the current part order.",
  "series.graph.rebuildDone": "Rebuilt in time order",
  "series.graph.zoomIn": "Zoom in",
  "series.graph.zoomOut": "Zoom out",
  "series.edge.label": "Choice label",
  "series.edge.labelPlaceholder": "Choice {index}",
  "series.edge.delete": "Delete connection",
  "series.edge.route": "{from} → {to}",
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `pnpm test && pnpm build`
Expected: 全绿，`vue-tsc` 零错误。

- [ ] **Step 7: 提交**

```bash
git add src/components/series/SeriesGraphCard.vue src/components/series/SeriesEdge.vue src/components/series/SeriesGraph.vue src/components/series/SeriesView.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(series): 连线画布（分P 卡片、连线、选项编辑、自动排列）"
```

---

### Task 7: 剧集播放（自动连播 / 分支选项浮层 / 播放模式）

**Files:**
- Create: `src/composables/useSeriesPlayback.ts`
- Create: `src/components/series/SeriesChoices.vue`
- Modify: `src/stores/layout.ts`（`seriesPlayMode` 持久化）
- Modify: `src/components/workspace/PreviewStage.vue`（控制条播放模式、`onEnded`、选项浮层）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

**Interfaces:**
- Consumes: `stepOf`（Task 1）、`SeriesOption`（Task 1）、`useProjectStore.switchEpisode`、`usePlaybackStore`。
- Produces:
  - `useSeriesPlayback(): { pending: Ref<PendingChoices | null>; resetRun(): void; onUserSeek(): void; onEnded(): "stop" | "advance" | "choices"; choose(edgeId: string): boolean }`
  - `layout.seriesPlayMode: "single" | "series"`、`layout.setSeriesPlayMode(mode)`
  - `SeriesChoices` props `options: SeriesOption[]`，emit `choose(edgeId: string)`

- [ ] **Step 1: layout store 增加播放模式**

`src/stores/layout.ts`：

类型定义区（`PreviewQuality` 之后）加：

```ts
/** 预览播放模式：单集播完即停 / 沿剧集连线连播。 */
export type SeriesPlayMode = "single" | "series";
```

`Persisted` 接口加字段：

```ts
  seriesPlayMode: SeriesPlayMode;
```

`useLayoutStore` 里 `previewQuality` 之后加：

```ts
  const seriesPlayMode = ref<SeriesPlayMode>(
    saved.seriesPlayMode === "series" ? "series" : "single",
  );
```

`clampPanes()` 之后加：

```ts
  /** 切换预览播放模式（单集 / 剧集）。 */
  function setSeriesPlayMode(mode: SeriesPlayMode): void {
    seriesPlayMode.value = mode === "series" ? "series" : "single";
  }
```

持久化 `watch` 的依赖数组里加 `seriesPlayMode`，写入对象里加 `seriesPlayMode: seriesPlayMode.value,`；`return` 里加 `seriesPlayMode,` 与 `setSeriesPlayMode,`。

- [ ] **Step 2: 新建 `src/composables/useSeriesPlayback.ts`**

```ts
/**
 * 剧集播放：沿连线自动连播、分叉时给出选项、无选项的环就停下。
 *
 * `visited` 只在「按下播放」与「切换播放模式」时重置——自动连播切集也会 `setPlayhead(0)`，
 * 若按播放头变化重置，循环判定永远看不到环。
 */
import { ref } from "vue";
import { stepOf } from "@/core/series/graph";
import { useI18n } from "@/i18n";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { toast } from "./useToast";
import type { SeriesOption } from "@/types/project";

interface PendingChoices {
  episodeId: string;
  options: SeriesOption[];
}

/** 本集播完、等待用户点选项。 */
const pending = ref<PendingChoices | null>(null);
/** 本轮自动连播已经过的分P（含起点）。 */
let visited = new Set<string>();

export function useSeriesPlayback() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const layout = useLayoutStore();
  const i18n = useI18n();

  function nameOf(id: string): string {
    return project.doc.episodes.find((episode) => episode.id === id)?.name ?? "";
  }

  /** 开始新一轮：清空选项浮层，访问记录只剩当前分P。 */
  function resetRun(): void {
    pending.value = null;
    visited = new Set([project.doc.activeEpisodeId]);
  }

  /** 用户拖动播放头：只清掉选项浮层，不动访问记录。 */
  function onUserSeek(): void {
    pending.value = null;
  }

  function onEnded(): "stop" | "advance" | "choices" {
    if (layout.seriesPlayMode !== "series") return "stop";
    const from = project.doc.activeEpisodeId;
    const step = stepOf(project.doc, from, visited);
    if (step.kind === "auto") {
      if (!project.switchEpisode(step.to)) return "stop";
      visited.add(from);
      visited.add(step.to);
      playback.setPlayhead(0);
      return "advance";
    }
    if (step.kind === "choices") {
      pending.value = { episodeId: from, options: step.options };
      return "choices";
    }
    if (step.kind === "loop") {
      toast(i18n.t("series.playback.loop", { name: nameOf(step.to) }));
      return "stop";
    }
    toast(i18n.t("series.playback.ended"));
    return "stop";
  }

  /** 点选项：切到目标分P 并继续播（手动选择不做循环拦截）。 */
  function choose(edgeId: string): boolean {
    const option = pending.value?.options.find((item) => item.edgeId === edgeId);
    if (!option) return false;
    const switched = project.switchEpisode(option.to);
    pending.value = null;
    if (!switched) return false;
    visited.add(project.doc.activeEpisodeId);
    playback.setPlayhead(0);
    return true;
  }

  return { pending, resetRun, onUserSeek, onEnded, choose };
}
```

- [ ] **Step 3: 新建 `src/components/series/SeriesChoices.vue`**

```vue
<script setup lang="ts">
/** 剧集播放到分叉结尾时的选项浮层（叠在预览画面底部）。 */
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import type { SeriesOption } from "@/types/project";

const props = defineProps<{ options: SeriesOption[] }>();
const emit = defineEmits<{ (e: "choose", edgeId: string): void }>();

const i18n = useI18n();
const project = useProjectStore();

function nameOf(id: string): string {
  return project.doc.episodes.find((episode) => episode.id === id)?.name ?? "";
}

function labelOf(option: SeriesOption, index: number): string {
  return option.unnamed
    ? i18n.t("series.choice.unnamed", { index: index + 1 })
    : option.label;
}
</script>

<template>
  <div
    class="series-choices"
    role="group"
    :aria-label="i18n.t('series.choices.title')"
    @pointerdown.stop
    @click.stop
  >
    <p class="series-choices-title">{{ i18n.t("series.choices.title") }}</p>
    <div class="series-choices-list">
      <button
        v-for="(option, index) in props.options"
        :key="option.edgeId"
        type="button"
        class="series-choice"
        @click="emit('choose', option.edgeId)"
      >
        <span class="series-choice-label">{{ labelOf(option, index) }}</span>
        <span class="series-choice-target">{{ nameOf(option.to) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.series-choices {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 6;
  width: min(420px, calc(100% - 32px));
  max-height: 46%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container-high) / 0.96);
  box-shadow: var(--md-elevation-2);
  backdrop-filter: blur(10px);
}
.series-choices-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-variant));
  text-align: center;
}
.series-choices-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.series-choice {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  border-radius: 10px;
  background-color: rgb(var(--md-surface-container-low));
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.series-choice:hover {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.08);
}
.series-choice-label {
  font-weight: 600;
}
.series-choice-target {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

- [ ] **Step 4: 接进 `PreviewStage.vue`**

脚本导入区加：

```ts
import SeriesChoices from "@/components/series/SeriesChoices.vue";
import { useSeriesPlayback } from "@/composables/useSeriesPlayback";
```

在 `const i18n = useI18n();` 附近（`layout` / `playback` 已存在之后）加：

```ts
const series = useSeriesPlayback();
const seriesPending = series.pending;
```

`onEnded` 替换为：

```ts
      onEnded: () => {
        const outcome = series.onEnded();
        if (outcome === "advance") {
          engine?.sync();
          engine?.seek(0);
          engine?.play();
          return;
        }
        playback.playing = false;
      },
```

`togglePlay()` 改为：

```ts
function togglePlay(): void {
  const next = !playback.playing;
  if (next) series.resetRun();
  playback.playing = next;
  // 在用户手势内直接驱动引擎，确保 WebView 的自动播放策略不会拦截音频。
  if (next) engine?.play();
  else engine?.pause();
}
```

播放头 watcher 里，在 `engine.seek(seconds)` 之前加一行：

```ts
    series.onUserSeek();
```

播放状态 watcher 换成（末尾的全局空格快捷键也会走到这里：重新播放 = 放弃本次选项浮层）：

```ts
watch(
  () => playback.playing,
  (playing) => {
    if (playing) series.onUserSeek();
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  },
);
```

`onMounted` 里（`engine.sync()` 之后）加：

```ts
    series.resetRun();
```

新增 watcher（放在其它 watch 附近）：

```ts
watch(
  () => layout.seriesPlayMode,
  () => series.resetRun(),
);
```

新增选项回调：

```ts
function chooseSeriesOption(edgeId: string): void {
  if (!series.choose(edgeId)) return;
  engine?.sync();
  engine?.seek(0);
  engine?.play();
  playback.playing = true;
}
```

`PLAY_MODES` 常量放到其它 `QUALITIES` 附近：

```ts
const PLAY_MODES = computed<SelectOption[]>(() => [
  {
    id: "single",
    label: i18n.t("preview.playMode.single"),
    hint: i18n.t("preview.playMode.singleHint"),
  },
  {
    id: "series",
    label: i18n.t("preview.playMode.series"),
    hint: i18n.t("preview.playMode.seriesHint"),
  },
]);
```

播放模式 setter 放到 `setQuality` 附近：

```ts
function setPlayMode(value: string): void {
  layout.setSeriesPlayMode(value === "series" ? "series" : "single");
}
```

模板：在 `.stage-viewport` 内、`</div>`（视口关闭）之前加：

```vue
      <SeriesChoices
        v-if="seriesPending"
        :options="seriesPending.options"
        @choose="chooseSeriesOption"
      />
```

控制条：在 `aspect-select` 的 `Md3Select` 之后加：

```vue
        <Md3Select
          class="footer-select play-mode-select"
          compact
          :model-value="layout.seriesPlayMode"
          :options="PLAY_MODES"
          :label="i18n.t('preview.playMode')"
          @update:model-value="setPlayMode"
        />
```

- [ ] **Step 5: i18n 补齐（中英）**

`src/i18n/zh.ts` 在 `series.edge.route` 之后加：

```ts
  "series.choice.unnamed": "选项 {index}",
  "series.choices.title": "本集结束，选择接下来播放",
  "series.playback.ended": "剧集结束",
  "series.playback.loop": "剧集绕回了「{name}」，自动连播已停止",
```

在 `preview.aspect` 相关键附近加：

```ts
  "preview.playMode": "播放模式",
  "preview.playMode.single": "单集播放",
  "preview.playMode.series": "剧集播放",
  "preview.playMode.singleHint": "播完停在当前分P",
  "preview.playMode.seriesHint": "沿连线自动进入下一集，遇分支显示选项",
```

`src/i18n/en.ts` 对应位置加：

```ts
  "series.choice.unnamed": "Choice {index}",
  "series.choices.title": "This part ended — what plays next?",
  "series.playback.ended": "The series ended",
  "series.playback.loop": "The flow looped back to “{name}”; autoplay stopped",
```

```ts
  "preview.playMode": "Play mode",
  "preview.playMode.single": "Single part",
  "preview.playMode.series": "Series",
  "preview.playMode.singleHint": "Stop at the end of this part",
  "preview.playMode.seriesHint": "Follow the connections into the next part; branches show choices",
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `pnpm test && pnpm build`
Expected: 全绿，`vue-tsc` 零错误。

- [ ] **Step 7: 提交**

```bash
git add src/composables/useSeriesPlayback.ts src/components/series/SeriesChoices.vue src/stores/layout.ts src/components/workspace/PreviewStage.vue src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(series): 剧集播放模式、自动连播与分支选项浮层"
```

---

### Task 8: 全量验证 + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-21-series-graph-design.md`（状态改「已实现」）
- Modify: `AGENTS.md`（新增「Series graph」一节）
- Modify（由脚本生成）: `crates/daemon/assets/domain.js`、`crates/daemon/tests/fixtures/expected.json`

- [ ] **Step 1: 跑全部前端测试与构建**

```bash
pnpm test
pnpm build
```

Expected: 全部通过；build 成功。

- [ ] **Step 2: 重建 headless domain golden 并跑 daemon 测试**

```bash
pnpm domain:golden
cargo test --manifest-path crates/daemon/Cargo.toml
```

Expected: golden 生成成功；cargo 测试通过。`domain.js` / `expected.json` 若有 diff，说明改了 `src/core` 的打包内容，属于预期，随本任务提交。

- [ ] **Step 3: 更新 spec 状态**

`docs/superpowers/specs/2026-11-21-series-graph-design.md` 顶部：

```md
- 状态：**已实现**
```

- [ ] **Step 4: AGENTS.md 增加小节**

在 `## Canvas node UX (mandatory)` 之前插入：

```md
## Series graph (剧集图)

- 分P 之间的播放关系是**工程级**的 `doc.seriesGraph`（`edges` + 卡片 `positions`），不是 `Episode` 字段。
  `custom: false` 表示「按 `Episode.order` 派生一条时间链」，此时不存边；首次连 / 断 / 改选项名时
  `materializeGraph()` 先把当前派生链落成真实边，再应用本次编辑——所以派生链上的边也能直接删，
  而「加一条分支」不会让时间链消失。
- 读取一律走 `core/series/graph.ts` 的 `seriesEdges()` / `outgoing()` / `optionsOf()` / `stepOf()`：
  悬空边在这里过滤，播放判定（自动 / 选项 / 结束 / 循环）也只有这一处。不要在组件里自己遍历
  `seriesGraph.edges`。
- 连线画布用 `@vue-flow/core`（与 `BoardView` 同一个库），但**不共享**任何工作流节点、store 或端口概念；
  `SeriesGraph.vue` 只做「分P → nodes、边 → edges」的映射。卡片坐标走 `core/series/layout.ts`，
  手动坐标优先、缺省自动分层布局。
- 拖动卡片只写 `positions`，**不**把图转成自定义；只有增删边 / 改选项名才 `custom: true`。
- 剧集播放的 `visited` 只在按下播放和切换播放模式时重置：自动连播切集也会 `setPlayhead(0)`，
  按播放头变化重置就永远检测不到无选项的环。
```

- [ ] **Step 5: 提交**

先确认 `AGENTS.md` 的 diff 只有本任务新增的那一节：

```bash
git diff AGENTS.md
```

若里面还有先前未提交的无关改动，**不要**提交 `AGENTS.md`（把它留在工作区，在最终汇报里说明），只提交其余三个文件：

```bash
git add docs/superpowers/specs/2026-11-21-series-graph-design.md crates/daemon/assets/domain.js crates/daemon/tests/fixtures/expected.json
git commit -m "docs(series): 记录剧集图约定并重建 domain golden"
```

若是干净的新增，则按下面一起提交：

```bash
git add AGENTS.md docs/superpowers/specs/2026-11-21-series-graph-design.md crates/daemon/assets/domain.js crates/daemon/tests/fixtures/expected.json
git commit -m "docs(series): 记录剧集图约定并重建 domain golden"
```

- [ ] **Step 6: 收尾自检**

逐条确认（有任一条不满足就回到对应任务修）：

- [ ] 剧集界面顶部是「平铺 / 连线」，没有「手动 / 时长」。
- [ ] 平铺：单击只选中，双击与右下预览按钮进预览；拖拽仍能换序；时长排序已不存在。
- [ ] 连线：默认派生链是一条水平直线；拖动卡片后坐标保存；再次进入仍是拖过的位置。
- [ ] 连线：从右侧圆点拖到另一张卡建线；派生链上的线也能点选、删除。
- [ ] 点线 → 浮动面板能改选项名（回车 / 失焦生效）、能删除；未命名显示「选项N」。
- [ ] 「自动排列」清空手动坐标；「按时间顺序重建」确认后回到单链。
- [ ] 删分P 后，指向它的连线与坐标一起消失，没有悬空边。
- [ ] 预览控制条有「单集播放 / 剧集播放」；单集行为与改动前一致。
- [ ] 剧集播放：无分叉自动连播下一集；有分叉 / 有选项时画面底部浮出选项；选完继续播。
- [ ] 无选项的环会停下并提示，不会无限连播。
- [ ] 只读模式下能看、能平移缩放、能预览，但改不了图。
- [ ] 中英文案齐全；`pnpm test` / `pnpm build` / daemon 测试全绿。

---

## 覆盖对照（spec → task）

| spec 章节 | 实现任务 |
|---|---|
| §3 数据模型 | Task 1 |
| §4.1 图引擎（派生链 / 选项 / stepOf） | Task 1 |
| §4.2 布局 | Task 2 |
| §4.3 读盘归一化 | Task 3 |
| §5 操作层（含 materialize / 删分P 清理） | Task 4 |
| §6.1 / 6.2 平铺与切换 | Task 5 |
| §6.3 连线画布 | Task 6 |
| §7.1 播放模式 / §7.2 剧集播放 / §7.3 选项浮层 | Task 7 |
| §8 序列化与协作 | Task 3（序列化）、Task 4（撤销语义） |
| §9 错误与边界 | Task 1（悬空边）、Task 4（清理）、Task 7（只读 / 循环） |
| §10 i18n | Task 5 / 6 / 7 各自补齐 |
| §11 测试计划 | Task 1–4 单测；Task 5–8 每步 `pnpm test && pnpm build` |
| §12 实施顺序 | 任务顺序一致 |
| §13 不做 | 计划里没有对应任务 |
