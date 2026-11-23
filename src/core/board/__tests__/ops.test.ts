/**
 * 画布纯操作：成对节点、组、端口上限、原子操作组。
 *
 * 这些语义同时被桌面画布 store 和无头领域引擎使用，所以测试只依赖纯函数——
 * 不建 Pinia、不碰 Vue。
 */
import { describe, expect, it } from "vitest";
import {
  applyCanvasOps,
  applyOpsToBoard,
  connectEdges,
  expandRemoval,
  inputCap,
  pairNodesFor,
  sanitizeNode,
  type CanvasOp,
} from "@/core/board/ops";
import { emptyBoard } from "@/core/board/schema";
import { WORKFLOW_END_TYPE, WORKFLOW_START_TYPE } from "@/core/board/workflowNodes";
import { attachBoardView } from "@/core/board/projectBoards";
import { newProject } from "@/core/factory";
import type { BoardDoc, BoardEdge, BoardNode } from "@/types/board";
import type { Project } from "@/types/project";

function node(
  id: string,
  type: string,
  extra: Partial<BoardNode> = {},
): BoardNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {} },
    ...extra,
  };
}

function edge(id: string, from: string, target: string, targetPort = "in"): BoardEdge {
  return {
    id,
    source: from,
    sourcePort: "image",
    target,
    targetPort,
  };
}

function board(nodes: BoardNode[], edges: BoardEdge[] = []): BoardDoc {
  return { ...emptyBoard(), nodes, edges, updatedAt: 1 };
}

function ids(doc: BoardDoc): string[] {
  return doc.nodes.map((item) => item.id).sort();
}

describe("成对节点", () => {
  it("工作流开始节点落地时带结束节点与配对线", () => {
    const paired = pairNodesFor(node("w1", WORKFLOW_START_TYPE));
    expect(paired).not.toBeNull();
    expect(paired!.nodes).toHaveLength(2);
    const [start, end] = paired!.nodes;
    expect(end!.type).toBe(WORKFLOW_END_TYPE);
    expect(start!.data.pairId).toBe(end!.data.pairId);
    expect(start!.data.signature?.inputs).toHaveLength(1);
    expect(paired!.edge.kind).toBe("pair");
    expect(paired!.edge.target).toBe(end!.id);
  });

  it("普通节点不成对", () => {
    expect(pairNodesFor(node("t1", "input.text"))).toBeNull();
  });

  it("删一端连另一端一起删，配对线一起消失", () => {
    const paired = pairNodesFor(node("w1", WORKFLOW_START_TYPE))!;
    const doc = board(paired.nodes, [paired.edge]);
    const endId = paired.nodes[1]!.id;
    const wanted = expandRemoval(doc.nodes, ["w1"]);
    expect(wanted.has(endId)).toBe(true);
    const next = applyOpsToBoard(doc, [{ kind: "remove_node", nodeIds: ["w1"] }]);
    expect(next.nodes).toHaveLength(0);
    expect(next.edges).toHaveLength(0);
  });
});

describe("组", () => {
  it("删组连组员一起删，并从别的组里摘掉成员", () => {
    const doc = board([
      node("g1", "group", { data: { params: {}, bindings: {}, children: ["a", "b"] } }),
      node("g2", "group", { data: { params: {}, bindings: {}, children: ["b", "c"] } }),
      node("a", "input.text"),
      node("b", "input.text"),
      node("c", "input.text"),
    ]);
    const next = applyOpsToBoard(doc, [{ kind: "remove_node", nodeIds: ["g1"] }]);
    expect(ids(next)).toEqual(["c", "g2"]);
    expect(next.nodes.find((item) => item.id === "g2")!.data.children).toEqual(["c"]);
  });
});

describe("连线", () => {
  it("单输入端口后来的连线替换原来的上游", () => {
    const nodes = [node("a", "input.text"), node("b", "input.text"), node("m", "model.text")];
    const first = connectEdges(nodes, [], edge("e1", "a", "m", "text"))!;
    const second = connectEdges(nodes, first, edge("e2", "b", "m", "text"))!;
    expect(second.map((item) => item.id)).toEqual(["e2"]);
  });

  it("显示节点的牌堆口按上限追加，重复上游被拒", () => {
    const nodes = [node("a", "input.image"), node("d", "display.image")];
    let edges: BoardEdge[] = [];
    for (let index = 0; index < 8; index += 1) {
      const next = connectEdges(nodes, edges, {
        ...edge(`e${index}`, "a", "d", "in"),
        id: `e${index}`,
      });
      if (index === 0) {
        expect(next).not.toBeNull();
        edges = next!;
        continue;
      }
      // 同一个上游重复接同一个端口：拒绝（否则牌堆会出现两张一样的图）。
      expect(next).toBeNull();
    }
    expect(edges).toHaveLength(1);
  });

  it("牌堆能达到上限 8", () => {
    const nodes = [
      node("d", "display.image"),
      ...Array.from({ length: 9 }, (_, index) => node(`i${index}`, "input.image")),
    ];
    let edges: BoardEdge[] = [];
    for (let index = 0; index < 9; index += 1) {
      const next = connectEdges(nodes, edges, edge(`e${index}`, `i${index}`, "d", "in"));
      if (index < 8) {
        expect(next).not.toBeNull();
        edges = next!;
      } else {
        expect(next).toBeNull();
      }
    }
    expect(edges).toHaveLength(8);
    expect(inputCap(nodes[0]!, "in")).toBe(8);
  });

  it("自连和悬空端点的连线接不上", () => {
    const nodes = [node("a", "input.text")];
    expect(connectEdges(nodes, [], edge("e1", "a", "a", "text"))).toBeNull();
    expect(connectEdges(nodes, [], edge("e2", "a", "missing", "text"))).toBeNull();
  });

  it("disconnect 只删指定连线", () => {
    const doc = board(
      [node("a", "input.text"), node("b", "input.text"), node("m", "model.text"), node("n", "model.text")],
      [edge("e1", "a", "m", "text"), edge("e2", "b", "n", "text")],
    );
    const next = applyOpsToBoard(doc, [{ kind: "disconnect", edgeIds: ["e1"] }]);
    expect(next.edges.map((item) => item.id)).toEqual(["e2"]);
  });
});

describe("节点更新", () => {
  it("patch 合并 data，溯源用的标量 params 原样保留", () => {
    const doc = board([node("v", "display.video")]);
    const next = applyOpsToBoard(doc, [
      {
        kind: "update_node",
        nodeId: "v",
        patch: {
          data: {
            assetId: "asset-1",
            params: { entry: "scenes/hero.tsx", command: "npx remotion render", fps: 30 },
          },
        },
      },
    ]);
    const target = next.nodes[0]!;
    expect(target.data.assetId).toBe("asset-1");
    expect(target.data.params).toMatchObject({ command: "npx remotion render", fps: 30 });
  });

  it("未知节点报错，不会静默跳过", () => {
    expect(() =>
      applyOpsToBoard(board([]), [{ kind: "update_node", nodeId: "nope", patch: {} }]),
    ).toThrow(/节点不存在/);
  });
});

describe("整组操作", () => {
  it("add + connect + update 一次调用全部落地", () => {
    const ops: CanvasOp[] = [
      { kind: "add_node", node: node("i1", "input.image") },
      { kind: "add_node", node: node("d1", "display.image", { position: { x: 600, y: 0 } }) },
      { kind: "connect", edge: edge("e1", "i1", "d1", "in") },
      { kind: "update_node", nodeId: "d1", patch: { data: { assetId: "asset-1" } } },
    ];
    const next = applyOpsToBoard(emptyBoard(), ops);
    expect(ids(next)).toEqual(["d1", "i1"]);
    expect(next.edges).toHaveLength(1);
    expect(next.nodes.find((item) => item.id === "d1")!.data.assetId).toBe("asset-1");
  });

  it("某一条失败时整组不落地（纯函数抛错，不返回半成品）", () => {
    expect(() =>
      applyOpsToBoard(emptyBoard(), [
        { kind: "add_node", node: node("i1", "input.text") },
        { kind: "connect", edge: edge("e1", "i1", "missing", "text") },
      ]),
    ).toThrow(/连线接不上/);
  });

  it("load 归一化并丢掉悬空连线", () => {
    const next = applyOpsToBoard(emptyBoard(), [
      {
        kind: "load",
        nodes: [node("a", "input.text")],
        edges: [edge("e1", "a", "ghost", "text")],
      },
    ]);
    expect(ids(next)).toEqual(["a"]);
    expect(next.edges).toHaveLength(0);
  });

  it("clear 清空节点 / 连线 / 来源", () => {
    const doc = {
      ...board([node("a", "input.text")], [edge("e1", "a", "b", "text")]),
      source: { name: "来自工作流" },
    };
    const next = applyOpsToBoard(doc, [{ kind: "clear" }]);
    expect(next.nodes).toHaveLength(0);
    expect(next.edges).toHaveLength(0);
    expect(next.source).toBeUndefined();
  });

  it("未知操作直接报错", () => {
    expect(() =>
      applyOpsToBoard(emptyBoard(), [{ kind: "explode" } as unknown as CanvasOp]),
    ).toThrow(/未知的画布操作/);
  });

  it("坏节点数据被拒绝", () => {
    expect(() => sanitizeNode({ id: "x" })).toThrow(/节点数据无效/);
  });
});

describe("工程层", () => {
  it("给了 canvasId 时先切过去再改那张画布", () => {
    const base = attachBoardView(newProject("工程")) as Project;
    const second = {
      id: "canvas-b",
      title: "第二张",
      doc: emptyBoard(),
    };
    const project = attachBoardView({
      ...base,
      boards: [...(base.boards ?? []), second],
    } as Project);
    const result = applyCanvasOps(
      project,
      [{ kind: "add_node", node: node("d1", "display.video") }],
      "canvas-b",
    );
    expect(result.canvasId).toBe("canvas-b");
    expect(result.project.activeBoardId).toBe("canvas-b");
    const target = result.project.boards!.find((item) => item.id === "canvas-b")!;
    expect(target.doc.nodes.map((item) => item.id)).toEqual(["d1"]);
    // 第一张画布不受影响
    const first = result.project.boards![0]!;
    expect(first.doc.nodes).toHaveLength(0);
  });

  it("画布不存在时报错", () => {
    const project = attachBoardView(newProject("工程")) as Project;
    expect(() => applyCanvasOps(project, [], "canvas-nope")).toThrow(/画布不存在/);
  });
});
