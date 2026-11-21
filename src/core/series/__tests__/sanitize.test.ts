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
