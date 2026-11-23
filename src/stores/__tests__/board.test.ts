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
import { canvasApply } from "@/core/board/canvasApi";
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

  it("图片自适应尺寸不记撤销步，但仍写回工程", () => {
    const { project, board } = setup();
    board.addNode(node("n1"));
    const undoCount = board.undoStack.length;
    board.resizeNode("n1", { width: 380, height: 190 }, { record: false });
    expect(board.undoStack.length).toBe(undoCount);
    expect(board.nodes[0].size).toEqual({ width: 380, height: 190 });
    board.flush();
    expect(project.doc.board?.nodes[0].size).toEqual({ width: 380, height: 190 });
  });

  it("用户拖拽缩放仍然记一步撤销", () => {
    const { board } = setup();
    board.addNode(node("n1"));
    const undoCount = board.undoStack.length;
    board.resizeNode("n1", { width: 420, height: 210 });
    expect(board.undoStack.length).toBe(undoCount + 1);
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

  it("换模型会剪掉不存在的动态端口连线", () => {
    const { board } = setup();
    board.addNode({
      ...node("m"),
      type: "model.video",
      data: { params: { model: "local:minimax-h3-ref2va" }, bindings: {} },
    });
    board.addNode(node("img"));
    board.connect({
      id: "e",
      source: "img",
      sourcePort: "image",
      target: "m",
      targetPort: "refImage",
    });
    expect(board.edges).toHaveLength(1);
    // 换成纯文生视频：参考图端口不存在了，连线要剪掉。
    board.updateNodeData("m", { params: { model: "local:wan21-t2v" } });
    expect(board.edges).toHaveLength(0);
  });

  it("合并的多路输入端口按 max 接收多条连线", () => {
    const { board } = setup();
    board.addNode({
      ...node("m"),
      type: "model.video",
      data: { params: { model: "local:minimax-h3-ref2va" }, bindings: {} },
    });
    for (let index = 0; index < 10; index += 1) {
      board.addNode(node(`img${index}`));
      board.connect({
        id: `e${index}`,
        source: `img${index}`,
        sourcePort: "image",
        target: "m",
        targetPort: "refImage",
      });
    }
    // 9 张参考图是上限，第 10 条被拒绝。
    expect(board.edges).toHaveLength(9);
  });

  it("bindPort 按给定顺序重建多路输入", () => {
    const { board } = setup();
    board.addNode({
      ...node("m"),
      type: "model.video",
      data: { params: { model: "local:minimax-h3-ref2va" }, bindings: {} },
    });
    board.addNode(node("a"));
    board.addNode(node("b"));
    board.bindPort("m", "refImage", [
      { nodeId: "b", portId: "image" },
      { nodeId: "a", portId: "image" },
    ], 9);
    expect(board.edges.map((edge) => edge.source)).toEqual(["b", "a"]);
    board.bindPort("m", "refImage", [
      { nodeId: "a", portId: "image" },
      { nodeId: "b", portId: "image" },
    ], 9);
    expect(board.edges.map((edge) => edge.source)).toEqual(["a", "b"]);
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

  it("载入旧工程时把默认宽度收口到统一值，拖动过的宽度保留", () => {
    const { project } = setup();
    project.updateBoard({
      version: 1,
      nodes: [
        { ...node("wide"), type: "model.text", size: { width: 420, height: 300 } },
        { ...node("custom"), type: "input.image", size: { width: 512, height: 300 } },
        { ...node("image"), type: "display.image", size: { width: 400, height: 300 } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 1,
    });
    const board = useBoardStore();
    expect(board.nodes.find((item) => item.id === "wide")?.size).toEqual({
      width: 400,
      height: 300,
    });
    // 用户自己拖过的宽度不合任何旧默认值，保持不动。
    expect(board.nodes.find((item) => item.id === "custom")?.size).toEqual({
      width: 512,
      height: 300,
    });
    // 图片节点按比例缩放高度。
    expect(board.nodes.find((item) => item.id === "image")?.size).toEqual({
      width: 380,
      height: 285,
    });
  });

  it("重建节点：模型参数回默认、产物清空，标题保留且不运行", () => {
    const { board } = setup();
    board.addNode({
      ...node("m"),
      type: "model.text",
      size: { width: 400, height: 316 },
      data: {
        params: { temperature: 1.5, model: "fake::x" },
        bindings: {},
        title: "我的节点",
        outputText: "旧结果",
        outputReasoning: "旧思考",
        outputAssetId: "a",
        outputAssetIds: ["a"],
        status: "done",
        startedAt: 1,
        durationMs: 500,
      },
    });
    board.resetNode("m");
    const saved = board.nodes.find((item) => item.id === "m");
    expect(saved?.data.params).toEqual({});
    expect(saved?.data.title).toBe("我的节点");
    expect(saved?.data.outputText).toBeUndefined();
    expect(saved?.data.outputReasoning).toBeUndefined();
    expect(saved?.data.outputAssetIds).toBeUndefined();
    // 重建后的 data 就是新节点的形状：没有 status，界面按 idle 显示。
    expect(saved?.data.status).toBeUndefined();
    expect(saved?.data.outputOpen).toBeUndefined();
    expect(saved?.data.startedAt).toBeUndefined();
    expect(saved?.data.durationMs).toBeUndefined();
  });

  it("重建输入节点保留已选素材，只清运行结果", () => {
    const { board } = setup();
    board.addNode({
      ...node("i"),
      type: "input.image",
      data: {
        params: {},
        bindings: {},
        assetId: "img-1",
        assetIds: ["img-1"],
        stackIndex: 0,
        outputAssetId: "img-1",
        status: "done",
        durationMs: 12,
      },
    });
    board.resetNode("i");
    const saved = board.nodes.find((item) => item.id === "i");
    expect(saved?.data.assetId).toBe("img-1");
    expect(saved?.data.outputAssetId).toBeUndefined();
    expect(saved?.data.durationMs).toBeUndefined();
    expect(saved?.data.status).toBeUndefined();
  });

  it("复制节点不带走产物与输出卡折叠状态", () => {
    const { board } = setup();
    board.addNode({
      ...node("n1"),
      data: {
        params: {},
        bindings: {},
        outputAssetId: "a",
        outputAssetIds: ["a", "b"],
        outputText: "结果",
        outputOpen: false,
      },
    });
    board.duplicateNode("n1");
    const copy = board.nodes.find((item) => item.id !== "n1");
    expect(copy).toBeDefined();
    expect(copy?.data.outputAssetId).toBeUndefined();
    expect(copy?.data.outputAssetIds).toBeUndefined();
    expect(copy?.data.outputText).toBeUndefined();
    expect(copy?.data.outputOpen).toBeUndefined();
  });
});

describe("board store · 组节点与剪贴板", () => {
  function addNodes(board: ReturnType<typeof useBoardStore>) {
    board.addNode({ ...node("a"), position: { x: 0, y: 0 }, size: { width: 200, height: 100 } });
    board.addNode({ ...node("b"), position: { x: 240, y: 0 }, size: { width: 200, height: 100 } });
  }

  it("创建组后组员、复制、整组删除都按组处理", () => {
    const { board } = setup();
    addNodes(board);
    const groupId = board.createGroup(["a", "b"]);
    expect(groupId).toBeTruthy();
    const group = board.nodes.find((item) => item.id === groupId);
    expect(group?.data.children?.sort()).toEqual(["a", "b"]);

    board.duplicateNode(groupId!);
    expect(board.nodes).toHaveLength(6);
    const copyGroup = board.nodes.find(
      (item) => item.type === "group" && item.id !== groupId,
    );
    expect(copyGroup?.data.children).toHaveLength(2);
    // 副本的组员 id 是新生成的，且都能在画布上找到。
    for (const child of copyGroup?.data.children ?? []) {
      expect(board.nodes.some((item) => item.id === child)).toBe(true);
    }

    board.removeNodes([groupId!]);
    expect(board.nodes.map((item) => item.id)).not.toContain("a");
    expect(board.nodes.map((item) => item.id)).not.toContain("b");
    // 副本（组 + 两个组员）还在。
    expect(board.nodes).toHaveLength(3);
  });

  it("组节点的禁用 / 旁路 / 重建一起作用到组员", () => {
    const { board } = setup();
    board.addNode({
      ...node("m1"),
      type: "model.image",
      position: { x: 0, y: 0 },
      size: { width: 200, height: 100 },
      data: { params: { model: "local:sdxl" }, bindings: {}, outputAssetId: "x" },
    });
    board.addNode({
      ...node("m2"),
      type: "model.image",
      position: { x: 240, y: 0 },
      size: { width: 200, height: 100 },
      data: { params: { model: "local:sdxl" }, bindings: {} },
    });
    const groupId = board.createGroup(["m1", "m2"])!;

    board.setNodeFlags([groupId], { ignored: true });
    expect(board.nodes.filter((item) => item.data.ignored).map((item) => item.id).sort()).toEqual(
      [groupId, "m1", "m2"].sort(),
    );
    board.setNodeFlags([groupId], { ignored: false, bypassed: true });
    expect(board.nodes.filter((item) => item.data.bypassed)).toHaveLength(3);

    board.resetNode(groupId);
    expect(board.nodes.find((item) => item.id === "m1")?.data.params).toEqual({});
    expect(board.nodes.find((item) => item.id === "m1")?.data.outputAssetId).toBeUndefined();
  });

  it("多选批量重建只记一步撤销，组节点展开到组员", () => {
    const { board } = setup();
    board.addNode({
      ...node("m1"),
      type: "model.image",
      data: { params: { model: "local:sdxl" }, bindings: {}, outputAssetId: "x" },
    });
    board.addNode({
      ...node("m2"),
      type: "model.image",
      data: { params: { model: "local:sdxl" }, bindings: {}, outputAssetId: "y" },
    });
    const undoBefore = board.undoStack.length;
    board.resetNodes(["m1", "m2"]);
    expect(board.undoStack.length).toBe(undoBefore + 1);
    expect(board.nodes.find((item) => item.id === "m1")?.data.params).toEqual({});
    expect(board.nodes.find((item) => item.id === "m2")?.data.outputAssetId).toBeUndefined();
  });

  it("复制 / 剪切 / 粘贴保留片段内部连线并重新映射 id", () => {
    const { board } = setup();
    addNodes(board);
    board.connect({ id: "e1", source: "a", sourcePort: "image", target: "b", targetPort: "image" });
    const copied = board.copySelection(["a", "b"]);
    expect(copied).toBe(2);

    const pasted = board.pasteClipboard({ x: 40, y: 40 });
    expect(pasted).toHaveLength(2);
    const pastedEdges = board.edges.filter(
      (edge) => pasted.includes(edge.source) && pasted.includes(edge.target),
    );
    expect(pastedEdges).toHaveLength(1);
    expect(pastedEdges[0]?.source).not.toBe("a");

    board.select(["a", "b"]);
    board.cutSelection();
    expect(board.nodes).toHaveLength(2);
    expect(board.selection).toEqual([]);
  });

  it("多选复制（⌘D）会把选中的节点和它们之间的连线一起复制", () => {
    const { board } = setup();
    addNodes(board);
    board.connect({ id: "e1", source: "a", sourcePort: "image", target: "b", targetPort: "image" });
    const ids = board.duplicateSelection(["a", "b"]);
    expect(ids).toHaveLength(2);
    expect(
      board.edges.filter((edge) => ids.includes(edge.source) && ids.includes(edge.target)),
    ).toHaveLength(1);
  });

  it("按几何位置维护组员：拖出组框就离开、拖进组框就加入", () => {
    const { board } = setup();
    addNodes(board);
    const groupId = board.createGroup(["a", "b"])!;
    board.addNode({
      ...node("c"),
      position: { x: 900, y: 900 },
      size: { width: 200, height: 100 },
    });
    board.refreshGroupMembership(["c"]);
    expect(board.nodes.find((item) => item.id === groupId)?.data.children?.sort()).toEqual([
      "a",
      "b",
    ]);

    board.applyPositions({ c: { x: 20, y: 20 } });
    board.refreshGroupMembership(["c"]);
    expect(board.nodes.find((item) => item.id === groupId)?.data.children).toContain("c");

    board.applyPositions({ a: { x: 2000, y: 2000 } });
    board.refreshGroupMembership(["a"]);
    expect(board.nodes.find((item) => item.id === groupId)?.data.children).not.toContain("a");
  });

  it("工作流来源跟着文档保存与清空", () => {
    const { board, project } = setup();
    board.addNode(node("a"));
    board.setSource({ rootId: "root-1", name: "我的工作流", version: 2 });
    board.flush();
    expect(project.doc.board?.source).toEqual({
      rootId: "root-1",
      name: "我的工作流",
      version: 2,
    });
    board.clear();
    expect(board.source).toBeUndefined();
  });

  it("canvasApply 任一条不合法时一条都不落地（整组校验通过才动文档）", () => {
    const { board } = setup();
    board.addNode(node("a"));
    const before = board.nodes.length;
    expect(() =>
      canvasApply([
        {
          kind: "add_node",
          node: {
            id: "b",
            type: "input.text",
            position: { x: 0, y: 0 },
            data: { params: {}, bindings: {} },
          } as BoardNode,
        },
        {
          kind: "connect",
          edge: { id: "e1", source: "a", sourcePort: "image", target: "ghost", targetPort: "in" },
        },
      ]),
    ).toThrow(/连线接不上/);
    // 第一条合法操作也不能留下
    expect(board.nodes.map((item) => item.id)).toEqual(["a"]);
    expect(board.nodes.length).toBe(before);
  });

  it("canvasApply 一次调用只留一步撤销，且整组都落地", () => {
    const { board } = setup();
    const depth = board.undoStack.length;
    const applied = canvasApply([
      {
        kind: "add_node",
        node: {
          id: "v1",
          type: "display.video",
          position: { x: 0, y: 0 },
          data: { params: {}, bindings: {} },
        } as BoardNode,
      },
      {
        kind: "update_node",
        nodeId: "v1",
        patch: { data: { params: { command: "npx remotion render" } } },
      },
    ]);
    expect(applied.applied).toBe(2);
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0]!.data.params.command).toBe("npx remotion render");
    expect(board.undoStack.length).toBe(depth + 1);
    board.undo();
    expect(board.nodes).toHaveLength(0);
  });
});
