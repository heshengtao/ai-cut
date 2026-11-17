import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_LIMITS,
  nodeCost,
  planStarts,
  summarizeRun,
  type RunLimits,
} from "@/core/board/scheduler";
import type { BoardNode } from "@/types/board";

function node(
  id: string,
  type = "model.image",
  params: Record<string, unknown> = { model: "cloud:openai" },
): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params, bindings: {} } };
}

function edge(source: string, target: string): { source: string; target: string } {
  return { source, target };
}

const LIMITS: RunLimits = { ...DEFAULT_RUN_LIMITS };

function starts(args: {
  pending: string[];
  nodes: BoardNode[];
  edges?: { source: string; target: string }[];
  active?: { id: string; cost: ReturnType<typeof nodeCost> }[];
  done?: string[];
  limits?: Partial<RunLimits>;
  smartOrder?: boolean;
}): string[] {
  const nodes = args.nodes;
  return planStarts({
    pending: args.pending,
    active: (args.active ?? []).filter(
      (item): item is { id: string; cost: NonNullable<ReturnType<typeof nodeCost>> } =>
        item.cost !== null,
    ),
    done: new Set(args.done ?? []),
    nodes,
    edges: args.edges ?? [],
    limits: { ...LIMITS, ...args.limits },
    smartOrder: args.smartOrder ?? true,
  });
}

describe("board scheduler", () => {
  it("纯 API 节点可以完全并行（到并发上限为止）", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => node(id));
    expect(starts({ pending: ["a", "b", "c", "d"], nodes })).toEqual(["a", "b", "c", "d"]);
    const active = ["a", "b", "c", "d"].map((id) => ({ id, cost: nodeCost(node(id))! }));
    expect(starts({ pending: ["e"], nodes, active, limits: { api: 4 } })).toEqual([]);
    expect(starts({ pending: ["e"], nodes, active: [], limits: { api: 4 } })).toEqual(["e"]);
  });

  it("本地 GPU 默认串行，一次只放一个", () => {
    const nodes = [node("a", "model.image", { model: "local:sdxl" }), node("b", "model.image", { model: "local:sdxl" })];
    expect(starts({ pending: ["a", "b"], nodes })).toEqual(["a"]);
    const active = [{ id: "a", cost: nodeCost(nodes[0]!)! }];
    expect(starts({ pending: ["b"], nodes, active })).toEqual([]);
  });

  it("显存预算不够时不会同时放两个本地任务", () => {
    const nodes = [
      node("a", "model.image", { model: "local:sdxl" }),
      node("b", "model.image", { model: "local:sdxl" }),
    ];
    expect(starts({ pending: ["a", "b"], nodes, limits: { gpu: 2, vramMb: 10000 } })).toHaveLength(1);
    expect(starts({ pending: ["a"], nodes, limits: { gpu: 2, vramMb: 40000 } })).toEqual(["a"]);
  });

  it("有依赖的节点要等上游跑完", () => {
    const nodes = [node("a", "input.text", {}), node("b")];
    const edges = [edge("a", "b")];
    expect(starts({ pending: ["a", "b"], nodes, edges })).toEqual(["a"]);
    expect(starts({ pending: ["b"], nodes, edges, done: ["a"] })).toEqual(["b"]);
  });

  it("旁路节点不运行，但下游仍要等它的上游跑完", () => {
    const nodes = [
      node("a", "input.text", {}),
      { ...node("b"), data: { params: {}, bindings: {}, bypassed: true } },
      node("c"),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    // b 不在队列里；c 的依赖要穿透 b 落到 a 上。
    expect(starts({ pending: ["a", "c"], nodes, edges, done: [] })).toEqual(["a"]);
    expect(starts({ pending: ["c"], nodes, edges, done: ["a"] })).toEqual(["c"]);
  });

  it("输入 / 显示这类即时节点不占并发名额", () => {
    const nodes = [
      node("a", "input.text", {}),
      node("b", "input.image", {}),
      node("c", "display.text", {}),
    ];
    expect(starts({ pending: ["a", "b", "c"], nodes, limits: { api: 1, gpu: 1, cpu: 1 } })).toHaveLength(3);
  });

  it("智能排序优先跑能解锁更多下游的节点", () => {
    const nodes = [node("safe"), node("root"), node("shared"), node("leaf1"), node("leaf2")];
    const edges = [edge("root", "shared"), edge("shared", "leaf1"), edge("shared", "leaf2")];
    // root 排在最前，但它解锁 3 个下游；safe 无关。智能排序应先把 root 排进这一拍。
    const pending = ["safe", "root", "shared", "leaf1", "leaf2"];
    expect(starts({ pending, nodes, edges, limits: { api: 2 } })).toEqual(["root", "safe"]);
    expect(starts({ pending, nodes, edges, limits: { api: 2 }, smartOrder: false })).toEqual([
      "safe",
      "root",
    ]);
  });

  it("汇总泳道与峰值显存", () => {
    const nodes = [
      node("a", "input.text", {}),
      node("b", "model.text", {}),
      node("c", "model.image", { model: "local:sdxl" }),
      node("d", "model.demux", {}),
    ];
    const summary = summarizeRun(nodes, []);
    expect(summary.lanes).toEqual({ instant: 1, api: 1, cpu: 1, gpu: 1 });
    expect(summary.peakVramMb).toBe(9 * 1024);
  });

  it("无模型参数的本地节点按类型兜底估显存", () => {
    expect(nodeCost(node("a", "model.video", {}))?.vramMb).toBe(16 * 1024);
    expect(nodeCost(node("a", "group", {}))).toBeNull();
    expect(nodeCost(node("a", "input.image", {}))?.lane).toBe("instant");
  });
});
