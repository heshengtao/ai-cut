import { describe, expect, it } from "vitest";
import {
  batchChildIds,
  normalizeItems,
  putRowOutputs,
  scopedAssetId,
  scopedText,
  scopedValue,
  type RunScope,
} from "@/core/board/runScope";

function scope(carry: unknown = null): RunScope {
  return { row: { item: { shot: 1 }, index: 0, carry }, outputs: new Map() };
}

describe("run scope", () => {
  it("items 宽松归一化", () => {
    expect(normalizeItems([1, 2])).toEqual([1, 2]);
    expect(normalizeItems("x")).toEqual(["x"]);
    expect(normalizeItems(null)).toEqual([]);
    expect(normalizeItems("")).toEqual([]);
  });

  it("行内产物优先于画布上的最新产物", () => {
    const current = scope();
    expect(scopedText(current, "n1", "text")).toBeUndefined();
    putRowOutputs(current, "n1", { values: { text: "row" }, text: "row", assetByPort: {} });
    expect(scopedText(current, "n1", "text")).toBe("row");
    expect(scopedText(current, "n2", "text")).toBeUndefined();
    expect(scopedValue(current, "n1", "value")).toBe("row");
  });

  it("值 / 素材按端口取，单端口节点可省略端口名", () => {
    const current = scope();
    putRowOutputs(current, "v1", { values: { value: 42 }, assetByPort: {} });
    expect(scopedValue(current, "v1", "value")).toBe(42);
    putRowOutputs(current, "i1", { values: {}, assetByPort: { image: "asset-1" } });
    expect(scopedAssetId(current, "i1", "image")).toBe("asset-1");
    expect(scopedAssetId(current, "i1", "ghost")).toBe("asset-1");
  });

  it("成员 id 只保留非空字符串", () => {
    expect(batchChildIds({ params: {}, bindings: {}, children: ["a", "", "b"] })).toEqual([
      "a",
      "b",
    ]);
  });
});
