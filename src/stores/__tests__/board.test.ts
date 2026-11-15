import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
}));

import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { newProject } from "@/core/factory";
import type { BoardNode } from "@/types/board";

function node(id: string): BoardNode {
  return { id, type: "input.image", position: { x: 0, y: 0 }, data: { params: {}, bindings: {} } };
}

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("画布"), null);
  const board = useBoardStore();
  return { project, board };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("board store", () => {
  it("加节点后写回工程文档", () => {
    const { project, board } = setup();
    board.addNode(node("n1"));
    expect(board.nodes).toHaveLength(1);
    board.flush();
    expect(project.doc.board?.nodes.map((item) => item.id)).toEqual(["n1"]);
    expect(project.dirty).toBe(true);
  });

  it("撤销 / 重做", () => {
    const { board } = setup();
    board.addNode(node("n1"));
    expect(board.canUndo).toBe(true);
    expect(board.undo()).toBe(true);
    expect(board.nodes).toHaveLength(0);
    expect(board.canRedo).toBe(true);
    expect(board.redo()).toBe(true);
    expect(board.nodes.map((item) => item.id)).toEqual(["n1"]);
  });

  it("删除节点会连带删掉它的连线", () => {
    const { board } = setup();
    board.addNode(node("a"));
    board.addNode(node("b"));
    board.connect({ id: "e1", source: "a", sourcePort: "out", target: "b", targetPort: "in" });
    expect(board.edges).toHaveLength(1);
    board.removeNodes(["a"]);
    expect(board.edges).toHaveLength(0);
    expect(board.nodes.map((item) => item.id)).toEqual(["b"]);
  });

  it("同一个目标端口只保留一条连线", () => {
    const { board } = setup();
    board.addNode(node("a"));
    board.addNode(node("b"));
    board.addNode(node("c"));
    board.connect({ id: "e1", source: "a", sourcePort: "out", target: "c", targetPort: "in" });
    board.connect({ id: "e2", source: "b", sourcePort: "out", target: "c", targetPort: "in" });
    expect(board.edges).toHaveLength(1);
    expect(board.edges[0].source).toBe("b");
  });

  it("不存在的端点连不上", () => {
    const { board } = setup();
    board.addNode(node("a"));
    expect(
      board.connect({ id: "e", source: "a", sourcePort: "out", target: "ghost", targetPort: "in" }),
    ).toBe(false);
    expect(board.edges).toHaveLength(0);
  });

  it("打开工程时载入工程里的画布", () => {
    const { project } = setup();
    project.updateBoard({
      version: 1,
      nodes: [node("saved")],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1.5 },
      updatedAt: 1,
    });
    const board = useBoardStore();
    expect(board.nodes.map((item) => item.id)).toEqual(["saved"]);
    expect(board.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
  });

  it("换工程（reset）时重新载入，不把旧画布带过去", () => {
    const { board } = setup();
    board.addNode(node("old"));
    board.flush();
    const project = useProjectStore();
    project.reset(newProject("另一个"), null);
    expect(board.nodes).toHaveLength(0);
  });

  it("updateNodeData 写进节点参数", () => {
    const { board } = setup();
    board.addNode(node("n"));
    board.updateNodeData("n", { params: { prompt: "hello" }, status: "idle" });
    expect(board.nodes[0].data.params.prompt).toBe("hello");
    expect(board.nodes[0].data.status).toBe("idle");
  });
});
