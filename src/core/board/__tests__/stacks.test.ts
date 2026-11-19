import { describe, expect, it } from "vitest";
import { replaceCurrent, stackOf, stackPatch } from "@/core/board/stacks";
import type { BoardNode } from "@/types/board";

function node(type: string, data: Partial<BoardNode["data"]> = {}): BoardNode {
  return { id: "n", type, position: { x: 0, y: 0 }, data: { params: {}, bindings: {}, ...data } };
}

describe("input / display stacks", () => {
  it("媒体：assetIds 优先，旧工程回落到 assetId", () => {
    expect(stackOf(node("input.image", { assetIds: ["a", "b"], stackIndex: 1 }))).toEqual({
      items: ["a", "b"],
      index: 1,
    });
    expect(stackOf(node("input.video", { assetId: "v" }))).toEqual({ items: ["v"], index: 0 });
  });

  it("文本：items 优先，旧工程回落到 params.text", () => {
    expect(stackOf(node("input.text", { items: ["一", "二"], stackIndex: 1 }))).toEqual({
      items: ["一", "二"],
      index: 1,
    });
    expect(stackOf(node("input.text", { params: { text: "旧文本" } }))).toEqual({
      items: ["旧文本"],
      index: 0,
    });
  });

  it("值：params.value 回落；空值算空栈", () => {
    expect(stackOf(node("input.value", { params: { kind: "json", value: 7 } }))).toEqual({
      items: [7],
      index: 0,
    });
    expect(stackOf(node("input.value", { items: [], params: { value: "" } })).items).toEqual([]);
  });

  it("写回：媒体写 assetIds，文本 / 值写 items，下标被夹住", () => {
    const media = node("input.video", {});
    expect(stackPatch(media, ["a", "b"], 9)).toMatchObject({
      assetIds: ["a", "b"],
      stackIndex: 1,
      assetId: "b",
    });
    const text = node("input.text", {});
    expect(stackPatch(text, ["a"], 0)).toEqual({ items: ["a"], stackIndex: 0 });
  });

  it("编辑当前项只替换当前那一张", () => {
    const current = node("input.text", { items: ["a", "b"], stackIndex: 1 });
    expect(replaceCurrent(current, "B")).toEqual({ items: ["a", "B"], index: 1 });
    const empty = node("input.text", {});
    expect(replaceCurrent(empty, "x")).toEqual({ items: ["x"], index: 0 });
  });
});
