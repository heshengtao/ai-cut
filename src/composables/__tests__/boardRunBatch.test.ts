/**
 * 迭代节点：按行跑子工作流，发布 results / carry。
 *
 * 覆盖：并行 map（results 顺序 = 行序）、串行 fold（carry 串起来）、空列表。
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
import type { BoardNode, BoardEdge } from "@/types/board";

function node(id: string, type: string, data: Partial<BoardNode["data"]> = {}): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params: {}, bindings: {}, ...data } };
}

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("画布"), null);
  const board = useBoardStore();
  return board;
}

/** 上游已经跑过的输入节点：直接给它已发布的值（真实运行由 runOne 写回）。 */
function jsonInput(id: string, value: unknown): BoardNode {
  return node(id, "input.value", {
    params: { kind: "json", value: JSON.stringify(value) },
    values: { value },
  });
}

function wire(board: ReturnType<typeof useBoardStore>, edges: BoardEdge[], nodes: BoardNode[]): void {
  for (const item of nodes) board.addNode(item);
  for (const edge of edges) board.connect(edge);
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("迭代节点", () => {
  it("并行：每行跑一遍子工作流，按行序发布结果", async () => {
    const board = setup();
    const items = jsonInput("items", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    const batch = node("batch", "batch", {
      params: { mode: "parallel", concurrency: 2 },
      children: ["idx", "res"],
    });
    wire(
      board,
      [
        { id: "e1", source: "items", sourcePort: "value", target: "batch", targetPort: "items" },
        { id: "e2", source: "idx", sourcePort: "value", target: "res", targetPort: "value" },
      ],
      [items, node("idx", "var.index"), batch, node("res", "var.result")],
    );

    const result = await runAdapter(batch, "batch");
    expect(result.values?.results).toEqual([0, 1, 2]);
    expect(board.nodes.find((item) => item.id === "batch")?.data.rows).toEqual({
      "0": { status: "done" },
      "1": { status: "done" },
      "2": { status: "done" },
    });
  });

  it("串行：carry 把上一行的出口串到下一行", async () => {
    const board = setup();
    const items = jsonInput("items", [{}, {}, {}]);
    const carryIn = jsonInput("carryIn", 100);
    const batch = node("batch", "batch", {
      params: { mode: "serial" },
      children: ["carry", "idx", "res", "carryOut"],
    });
    wire(
      board,
      [
        { id: "e1", source: "items", sourcePort: "value", target: "batch", targetPort: "items" },
        { id: "e2", source: "carryIn", sourcePort: "value", target: "batch", targetPort: "carry" },
        { id: "e3", source: "carry", sourcePort: "value", target: "res", targetPort: "value" },
        { id: "e4", source: "idx", sourcePort: "value", target: "carryOut", targetPort: "value" },
      ],
      [
        items,
        carryIn,
        node("carry", "var.carry"),
        node("idx", "var.index"),
        batch,
        node("res", "var.result"),
        node("carryOut", "var.carryOut"),
      ],
    );

    const result = await runAdapter(batch, "batch");
    // 第一行拿到初始 carry，后面每行拿到上一行的 index。
    expect(result.values?.results).toEqual([100, 0, 1]);
    expect(result.values?.carry).toBe(2);
  });

  it("空列表：0 行，直接完成", async () => {
    const board = setup();
    const items = jsonInput("items", []);
    const batch = node("batch", "batch", { params: { mode: "parallel" }, children: [] });
    wire(
      board,
      [{ id: "e1", source: "items", sourcePort: "value", target: "batch", targetPort: "items" }],
      [items, batch],
    );
    const result = await runAdapter(batch, "batch");
    expect(result.values).toEqual({ results: [], carry: null });
  });
});
