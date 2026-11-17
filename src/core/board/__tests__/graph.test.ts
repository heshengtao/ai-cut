import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  descendantIds,
  directSources,
  topologicalOrder,
  wouldCreateCycle,
} from "@/core/board/graph";

const edges = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "c", target: "d" },
  { source: "x", target: "y" },
];

describe("board graph", () => {
  it("输入候选只包含上游（直连 + 第 N 跳），不包含下游与无关节点", () => {
    expect([...ancestorIds("c", edges)].sort()).toEqual(["a", "b"]);
    expect([...ancestorIds("a", edges)]).toEqual([]);
    expect(ancestorIds("d", edges).has("x")).toBe(false);
    expect(directSources("c", edges)).toEqual(["b"]);
  });

  it("下游用来拦截成环", () => {
    expect([...descendantIds("a", edges)].sort()).toEqual(["b", "c", "d"]);
    expect(wouldCreateCycle(edges, "a", "d")).toBe(false);
    expect(wouldCreateCycle(edges, "d", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
  });

  it("已有连线本身不会被误判成环（Vue Flow 用它校验现有边）", () => {
    for (const edge of edges) {
      expect(wouldCreateCycle(edges, edge.source, edge.target)).toBe(false);
    }
  });

  it("环不会让 BFS 死循环", () => {
    const cyclic = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ];
    expect([...ancestorIds("a", cyclic)].sort()).toEqual(["b", "c"]);
    expect(topologicalOrder([{ id: "a" }, { id: "b" }, { id: "c" }], cyclic)).toHaveLength(3);
  });

  it("拓扑序上游在前", () => {
    const nodes = [{ id: "d" }, { id: "c" }, { id: "b" }, { id: "a" }];
    expect(topologicalOrder(nodes, edges).map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
  });
});
