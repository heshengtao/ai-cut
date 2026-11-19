import { describe, expect, it } from "vitest";
import { isPairEdge, loopBodyIds, loopEndOf, normalizeItems, slotCount } from "@/core/board/loop";
import type { BoardEdge, BoardNode } from "@/types/board";

function node(id: string, type: string, pairId?: string): BoardNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {}, ...(pairId ? { pairId } : {}) },
  };
}

function edge(id: string, source: string, target: string, kind?: "pair"): BoardEdge {
  return { id, source, sourcePort: "out", target, targetPort: "in", ...(kind ? { kind } : {}) };
}

describe("loop helpers", () => {
  it("循环体从开始节点可达，且不跨过结束节点", () => {
    const nodes = [
      node("s", "loop.start", "p1"),
      node("a", "model.image"),
      node("b", "display.value"),
      node("e", "loop.end", "p1"),
      node("after", "display.value"),
    ];
    const edges = [
      edge("pair", "s", "e", "pair"),
      edge("1", "s", "a"),
      edge("2", "a", "b"),
      edge("3", "b", "e"),
      edge("4", "e", "after"),
    ];
    expect(loopBodyIds("s", nodes, edges)).toEqual(["a", "b"]);
    expect(loopEndOf(nodes[0]!, nodes)).toBe(nodes[3]);
  });

  it("配对线不参与数据流", () => {
    const edges = [edge("pair", "s", "e", "pair"), edge("1", "s", "a")];
    expect(edges.filter(isPairEdge)).toHaveLength(1);
    expect(loopBodyIds("s", [node("s", "loop.start"), node("a", "display.value"), node("e", "loop.end")], edges)).toEqual(["a"]);
  });

  it("数组 / 槽位归一化", () => {
    expect(normalizeItems([1, 2])).toEqual([1, 2]);
    expect(normalizeItems("x")).toEqual(["x"]);
    expect(normalizeItems(null)).toEqual([]);
    expect(slotCount(3)).toBe(3);
    expect(slotCount(99)).toBe(8);
    expect(slotCount("bad")).toBe(1);
  });
});
