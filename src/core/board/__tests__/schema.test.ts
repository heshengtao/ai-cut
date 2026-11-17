import { describe, expect, it } from "vitest";
import { normalizeBoard, portsCompatible } from "@/core/board/schema";
import type { BoardNode } from "@/types/board";

function node(id: string, type = "input.image"): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params: {}, bindings: {} } };
}

describe("normalizeBoard", () => {
  it("空 / 坏数据回落到空画布", () => {
    expect(normalizeBoard(null).nodes).toEqual([]);
    expect(normalizeBoard({ nodes: "nope" }).nodes).toEqual([]);
    expect(normalizeBoard({}).edges).toEqual([]);
  });

  it("丢掉坏节点，保留好节点", () => {
    const board = normalizeBoard({
      nodes: [node("a"), { id: "", type: "x" }, { id: "b" }, 42],
      edges: [],
    });
    expect(board.nodes.map((item) => item.id)).toEqual(["a"]);
  });

  it("丢掉悬空连线与自环", () => {
    const board = normalizeBoard({
      nodes: [node("a"), node("b")],
      edges: [
        { id: "e1", source: "a", sourcePort: "out", target: "b", targetPort: "in" },
        { id: "e2", source: "a", sourcePort: "out", target: "ghost", targetPort: "in" },
        { id: "e3", source: "a", sourcePort: "out", target: "a", targetPort: "in" },
        { id: "e4", source: "a", sourcePort: "out", target: "b", targetPort: 3 },
      ],
    });
    expect(board.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("组节点色调：合法值保留，非法值丢掉", () => {
    expect(
      normalizeBoard({ nodes: [{ ...node("g"), type: "group", data: { params: {}, bindings: {}, tone: "coral" } }] }).nodes[0]?.data.tone,
    ).toBe("coral");
    expect(
      normalizeBoard({ nodes: [{ ...node("g"), type: "group", data: { params: {}, bindings: {}, tone: "neon" } }] }).nodes[0]?.data.tone,
    ).toBeUndefined();
  });

  it("工作流来源：只保留合法字段，版本号夹到正整数", () => {
    const board = normalizeBoard({
      nodes: [],
      edges: [],
      source: { rootId: "r1", builtinId: "builtin.text-to-image", name: "工作流", version: 2.8 },
    });
    expect(board.source).toEqual({
      rootId: "r1",
      builtinId: "builtin.text-to-image",
      name: "工作流",
      version: 2,
    });
    expect(normalizeBoard({ nodes: [], edges: [], source: { rootId: 42 } }).source).toBeUndefined();
  });

  it("viewport 默认值与被夹紧的缩放", () => {
    expect(normalizeBoard({}).viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(normalizeBoard({ viewport: { x: 4, y: -2, zoom: 99 } }).viewport).toEqual({
      x: 4,
      y: -2,
      zoom: 2.2,
    });
  });

  it("图片牌堆：assetIds 过滤坏值，stackIndex 夹到非负", () => {
    const board = normalizeBoard({
      nodes: [
        {
          ...node("a"),
          data: {
            params: {},
            bindings: {},
            assetId: "img-1",
            assetIds: ["img-1", "", 42, "img-2"],
            stackIndex: -3,
          },
        },
      ],
    });
    expect(board.nodes[0].data.assetIds).toEqual(["img-1", "img-2"]);
    expect(board.nodes[0].data.stackIndex).toBe(0);
    expect(board.nodes[0].data.assetId).toBe("img-1");
  });

  it("模型产物列表：过滤坏值、去重，并把当前输出修正到列表里", () => {
    const board = normalizeBoard({
      nodes: [
        {
          ...node("a", "model.image"),
          data: {
            params: {},
            bindings: {},
            outputAssetId: "missing",
            outputAssetIds: ["out-1", "", 42, "out-2", "out-1"],
            outputOpen: false,
          },
        },
      ],
    });
    expect(board.nodes[0].data.outputAssetIds).toEqual(["out-1", "out-2"]);
    // 当前输出不在列表里 → 回落到第一张，避免下游指向不存在的素材。
    expect(board.nodes[0].data.outputAssetId).toBe("out-1");
    expect(board.nodes[0].data.outputOpen).toBe(false);
  });

  it("按端口发布的产物：只保留字符串键值", () => {
    const board = normalizeBoard({
      nodes: [
        {
          ...node("a", "model.separate"),
          data: {
            params: {},
            bindings: {},
            outputs: { stemVocals: "out-1", stemDrums: "", stemBass: 42, stemOther: "out-2" },
          },
        },
      ],
    });
    expect(board.nodes[0].data.outputs).toEqual({
      stemVocals: "out-1",
      stemOther: "out-2",
    });
  });

  it("文本思考过程 / 运行耗时也会归一化", () => {
    const board = normalizeBoard({
      nodes: [
        {
          ...node("a", "model.text"),
          data: {
            params: {},
            bindings: {},
            outputText: "答案",
            outputReasoning: "先想一想",
            startedAt: 1700000000000,
            durationMs: 1234.6,
          },
        },
      ],
    });
    expect(board.nodes[0].data.outputReasoning).toBe("先想一想");
    expect(board.nodes[0].data.startedAt).toBe(1700000000000);
    expect(board.nodes[0].data.durationMs).toBe(1234.6);
  });

  it("节点参数只保留可序列化的标量", () => {
    const board = normalizeBoard({
      nodes: [
        {
          ...node("a"),
          data: {
            params: { prompt: "hi", steps: 20, enabled: true, bad: { x: 1 }, missing: undefined },
            bindings: { prompt: { nodeId: "b", portId: "out" }, broken: { nodeId: 1 } },
          },
        },
      ],
    });
    expect(board.nodes[0].data.params).toEqual({ prompt: "hi", steps: 20, enabled: true });
    expect(board.nodes[0].data.bindings).toEqual({ prompt: { nodeId: "b", portId: "out" } });
  });
});

describe("portsCompatible", () => {
  it("同类型与 any 可连", () => {
    expect(portsCompatible("image", "image")).toBe(true);
    expect(portsCompatible("image", "any")).toBe(true);
    expect(portsCompatible("any", "audio")).toBe(true);
  });

  it("不同类型不可连", () => {
    expect(portsCompatible("image", "audio")).toBe(false);
    expect(portsCompatible("text", "video")).toBe(false);
  });
});
