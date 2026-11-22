/**
 * 循环节点：成对创建 / 成对删除；数组模式与次数模式下跑完整段循环。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
  extractAudioPreview: vi.fn(async () => ""),
  extractVideoTrack: vi.fn(async () => ""),
  fileDataUrl: vi.fn(async () => ""),
  importAssetAt: vi.fn(),
}));

import { runAdapter } from "@/composables/useBoardRun";
import { newProject } from "@/core/factory";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import type { BoardEdge, BoardNode } from "@/types/board";

function node(id: string, type: string, data: Partial<BoardNode["data"]> = {}, x = 0): BoardNode {
  return { id, type, position: { x, y: 0 }, data: { params: {}, bindings: {}, ...data } };
}

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("画布"), null);
  return useBoardStore();
}

function jsonInput(id: string, value: unknown): BoardNode {
  return node(id, "input.value", {
    params: { kind: "json", value: JSON.stringify(value) },
    values: { value, list: Array.isArray(value) ? value : [value] },
  });
}

function connect(board: ReturnType<typeof useBoardStore>, edges: BoardEdge[]): void {
  for (const edge of edges) board.connect(edge);
}

describe("循环节点", () => {
  it("添加循环开始会连体创建结束节点与配对线；删线两端一起消失", () => {
    const board = setup();
    board.addNode(node("s", "loop.start"));
    expect(board.nodes.map((item) => item.type).sort()).toEqual(["loop.end", "loop.start"]);
    const pair = board.edges.find((edge) => edge.kind === "pair");
    expect(pair).toBeTruthy();
    const end = board.nodes.find((item) => item.type === "loop.end")!;
    expect(board.nodes.find((item) => item.id === "s")?.data.pairId).toBe(end.data.pairId);

    board.removeEdges([pair!.id]);
    expect(board.nodes).toHaveLength(0);
    expect(board.edges).toHaveLength(0);
  });

  it("删除任一端，另一个与配对线一起消失", () => {
    const board = setup();
    board.addNode(node("s", "loop.start"));
    board.removeNodes(["s"]);
    expect(board.nodes).toHaveLength(0);
    expect(board.edges).toHaveLength(0);
  });

  it("数组模式：每一轮把当前项送进循环体，结束节点按槽位收集数组", async () => {
    const board = setup();
    const items = jsonInput("items", [10, 20, 30]);
    board.addNode(items);
    board.addNode(node("s", "loop.start", { params: { mode: "array" } }, 400));
    const end = board.nodes.find((item) => item.type === "loop.end")!;
    board.addNode(node("body", "display.value", {}, 900));
    connect(board, [
      { id: "e1", source: "items", sourcePort: "value", target: "s", targetPort: "items" },
      { id: "e2", source: "s", sourcePort: "item", target: "body", targetPort: "in" },
      { id: "e3", source: "body", sourcePort: "value", target: end.id, targetPort: "in1" },
    ]);

    const start = board.nodes.find((item) => item.id === "s")!;
    await runAdapter(start, "s");
    expect(board.nodes.find((item) => item.id === end.id)?.data.values?.out1).toEqual([
      10, 20, 30,
    ]);
  });

  it("次数模式：循环 N 次；接了数组就按数组前 N 项走，多槽位一一对应收集", async () => {
    const board = setup();
    const items = jsonInput("items", ["甲", "乙"]);
    board.addNode(items);
    board.addNode(node("s", "loop.start", { params: { mode: "count", count: 2 } }, 400));
    const end = board.nodes.find((item) => item.type === "loop.end")!;
    board.updateNodeData(end.id, { params: { slots: 2 } });
    board.addNode(node("byItem", "display.value", {}, 900));
    connect(board, [
      { id: "e0", source: "items", sourcePort: "value", target: "s", targetPort: "items" },
      { id: "e1", source: "s", sourcePort: "item", target: "byItem", targetPort: "in" },
      { id: "e2", source: "byItem", sourcePort: "value", target: end.id, targetPort: "in1" },
      // 槽位 2 直接收输入节点的整组数组（每个循环行都收一次）。
      { id: "e3", source: "items", sourcePort: "list", target: end.id, targetPort: "in2" },
    ]);

    const start = board.nodes.find((item) => item.id === "s")!;
    await runAdapter(start, "s");
    const values = board.nodes.find((item) => item.id === end.id)?.data.values;
    expect(values?.out1).toEqual(["甲", "乙"]);
    expect(values?.out2).toEqual([
      ["甲", "乙"],
      ["甲", "乙"],
    ]);
  });
});
