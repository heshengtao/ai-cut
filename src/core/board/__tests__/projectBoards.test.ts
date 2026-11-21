/**
 * 多画布：工程文档里的 `boards` 真相、`board` 访问器、新建 / 切换 / 删除 / 改名，
 * 以及「打开工程 / 保存工程」的往返。
 */
import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  activeCanvas,
  attachBoardView,
  createCanvas,
  deleteCanvas,
  duplicateCanvas,
  renameCanvas,
  replaceCanvasDoc,
} from "@/core/board/projectBoards";
import { emptyBoard } from "@/core/board/schema";
import { newProject } from "@/core/factory";
import { parseProject, serializeProject } from "@/core/serialize";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import type { BoardDoc } from "@/types/board";
import type { Project } from "@/types/project";

function boardWith(nodes: BoardDoc["nodes"]): BoardDoc {
  return { ...emptyBoard(), nodes, updatedAt: 1 };
}

describe("工程画布视图", () => {
  it("老工程只有 board 时迁移成一张画布，并挂上访问器", () => {
    const project = newProject("老工程");
    delete project.boards;
    project.activeBoardId = undefined;
    const doc = {
      ...project,
      board: boardWith([
        { id: "n1", type: "input.text", position: { x: 0, y: 0 }, data: { params: {}, bindings: {} } },
      ]),
    } as Project;
    const attached = attachBoardView(doc);
    expect(attached.boards).toHaveLength(1);
    // 默认标题不落语言（「画布 N」由 UI 按当前语言渲染）。
    expect(attached.boards![0]!.title).toBe("");
    expect(attached.boards![0]!.doc.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(attached.board?.nodes.map((node) => node.id)).toEqual(["n1"]);
    // 写盘只落 boards 一份（活动画布的 board 投影被 serializeProject 剔除）。
    const wire = JSON.parse(serializeProject(attached)) as Record<string, unknown>;
    expect(wire.board).toBeUndefined();
    expect(Array.isArray(wire.boards)).toBe(true);
  });

  it("历史数据里把 i18n key 存成标题的画布，载入时修成自动名", () => {
    const base = attachBoardView(newProject("工程"));
    const canvas = base.boards![0]!;
    const leaked = attachBoardView({
      ...base,
      boards: [{ ...canvas, title: "board.canvas.defaultTitle" }],
    });
    expect(leaked.boards![0]!.title).toBe("");
    // 正常名字不动
    const named = attachBoardView({
      ...leaked,
      boards: [{ ...leaked.boards![0]!, title: "主画布" }],
    });
    expect(named.boards![0]!.title).toBe("主画布");
  });

  it("新建 / 切换 / 删除 / 改名 / 复制", () => {
    const base = attachBoardView(newProject("工程"));
    const first = activeCanvas(base)!;
    const two = createCanvas(base, "第二张");
    expect(two.boards).toHaveLength(2);
    expect(two.activeBoardId).not.toBe(first.id);
    expect(activeCanvas(two)!.title).toBe("第二张");

    // 清空名字 = 回到自动名
    expect(renameCanvas(two, first.id, "  ").boards!.find((c) => c.id === first.id)!.title).toBe("");

    const renamed = renameCanvas(two, first.id, "主画布");
    expect(activeCanvas(renamed)!.title).toBe("第二张");
    expect(renamed.boards!.find((canvas) => canvas.id === first.id)!.title).toBe("主画布");

    const copy = duplicateCanvas(two, first.id);
    expect(copy.boards).toHaveLength(3);

    const deletedActive = deleteCanvas(copy, copy.activeBoardId!);
    expect(deletedActive.boards).toHaveLength(2);
    expect(deletedActive.activeBoardId).not.toBe(copy.activeBoardId);

    const one = deleteCanvas(deleteCanvas(deletedActive, deletedActive.activeBoardId!), first.id);
    expect(one.boards).toHaveLength(1);
    // 最后一张不能删
    expect(deleteCanvas(one, one.activeBoardId!)).toBe(one);
  });

  it("`{ ...doc, board }` 这种补丁会写回活动画布", () => {
    const base = attachBoardView(newProject("工程"));
    const patched = attachBoardView({
      ...base,
      board: boardWith([
        { id: "x", type: "display.text", position: { x: 1, y: 2 }, data: { params: {}, bindings: {} } },
      ]),
    });
    expect(patched.board?.nodes[0]!.id).toBe("x");
    expect(patched.boards).toHaveLength(1);
  });

  it("保存 / 打开工程时多画布与活动画布都能往返", () => {
    const base = createCanvas(attachBoardView(newProject("工程")), "第二张");
    const activeId = base.activeBoardId!;
    const withNodes = replaceCanvasDoc(base, activeId, boardWith([
      { id: "a", type: "input.text", position: { x: 5, y: 6 }, data: { params: { text: "hi" }, bindings: {} } },
    ]));
    const reopened = parseProject(serializeProject(withNodes));
    expect(reopened.boards).toHaveLength(2);
    expect(reopened.activeBoardId).toBe(activeId);
    expect(reopened.board?.nodes[0]!.id).toBe("a");
  });
});

describe("画布 store 切换", () => {
  it("新建 / 切换画布时活动文档跟着换", () => {
    setActivePinia(createPinia());
    const project = useProjectStore();
    project.reset(newProject("工程"), null);
    const board = useBoardStore();

    board.addNode({
      id: "keep",
      type: "input.text",
      position: { x: 0, y: 0 },
      data: { params: { text: "第一张" }, bindings: {} },
    });
    board.flush();
    const firstId = board.activeCanvasId;

    board.newCanvas("第二张");
    expect(board.canvases).toHaveLength(2);
    expect(board.nodes).toHaveLength(0);

    board.addNode({
      id: "second",
      type: "input.text",
      position: { x: 0, y: 0 },
      data: { params: {}, bindings: {} },
    });
    board.flush();

    board.openCanvas(firstId);
    expect(board.nodes.map((node) => node.id)).toEqual(["keep"]);

    board.removeCanvas(board.activeCanvasId);
    expect(board.canvases).toHaveLength(1);
    expect(board.nodes.map((node) => node.id)).toEqual(["second"]);
  });
});
