/**
 * 工作流开始 / 结束成对创建、签名端口、嵌入子工作流的执行与递归检测。
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

/** 工作流库读取：测试里用内存里的快照表替换 daemon 调用。 */
const snapshots = new Map<string, { nodes: BoardNode[]; edges: BoardEdge[] }>();
vi.mock("@/core/board/library", () => ({
  readWorkflowRoot: vi.fn(async (id: string) => {
    const entry = snapshots.get(id);
    if (!entry) return null;
    return {
      version: {
        id,
        rootId: id,
        version: 1,
        name: id,
        description: "",
        tags: [],
        createdAt: 0,
        updatedAt: 0,
        nodeCount: entry.nodes.length,
        edgeCount: entry.edges.length,
      },
      nodes: entry.nodes,
      edges: entry.edges,
    };
  }),
  readWorkflow: vi.fn(),
  saveWorkflowToLibrary: vi.fn(),
  listWorkflowGroups: vi.fn(async () => []),
  deleteWorkflow: vi.fn(),
  renameWorkflow: vi.fn(),
  historyKeyFor: vi.fn(() => null),
}));

import { runAdapter, runWorkflowDoc } from "@/composables/useBoardRun";
import { readWorkflowRoot } from "@/core/board/library";
import { newProject } from "@/core/factory";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import {
  WORKFLOW_CALL_TYPE,
  WORKFLOW_END_TYPE,
  WORKFLOW_START_TYPE,
  normalizeSignature,
} from "@/core/board/workflowNodes";
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

describe("工作流节点", () => {
  beforeEach(() => {
    snapshots.clear();
  });

  it("添加工作流开始会连体创建结束节点、配对线，并带上默认签名", () => {
    const board = setup();
    board.addNode(node("s", WORKFLOW_START_TYPE));
    expect(board.nodes.map((item) => item.type).sort()).toEqual([
      "workflow.end",
      "workflow.start",
    ]);
    const end = board.nodes.find((item) => item.type === WORKFLOW_END_TYPE)!;
    const start = board.nodes.find((item) => item.id === "s")!;
    expect(start.data.pairId).toBe(end.data.pairId);
    const pair = board.edges.find((edge) => edge.kind === "pair")!;
    expect(pair).toBeTruthy();
    expect(normalizeSignature(start.data.signature)?.inputs).toHaveLength(1);
    expect(normalizeSignature(end.data.signature)?.outputs).toHaveLength(1);

    // 成对：删一端另一端跟着走
    board.removeNodes(["s"]);
    expect(board.nodes).toHaveLength(0);
    expect(board.edges).toHaveLength(0);
  });

  it("删签名行会剪掉那一路上游连线", () => {
    const board = setup();
    board.addNode(node("s", WORKFLOW_START_TYPE));
    const end = board.nodes.find((item) => item.type === WORKFLOW_END_TYPE)!;
    const start = board.nodes.find((item) => item.id === "s")!;
    const decl = normalizeSignature(end.data.signature)!.outputs[0]!;
    const source = node("t", "input.text", { params: { text: "hello" } });
    board.addNode(source);
    board.connect({
      id: "e1",
      source: "t",
      sourcePort: "text",
      target: end.id,
      targetPort: decl.id,
    });
    expect(board.edges).toHaveLength(2);

    board.removeSignatureRow(start.id, "inputs", normalizeSignature(start.data.signature)!.inputs[0]!.id);
    // 开始节点的签名行和结束节点输出行是两半，互不影响。
    expect(board.edges).toHaveLength(2);

    board.removeSignatureRow(end.id, "outputs", decl.id);
    expect(board.edges.filter((edge) => edge.kind !== "pair")).toHaveLength(0);
  });

  it("跑一张画布：开始输出 → 结束收集，结果按签名名字返回", async () => {
    setup();
    const start = node("s", WORKFLOW_START_TYPE, {
      signature: { inputs: [{ id: "in-a", name: "prompt", label: "提示词", type: "text", default: "你好" }], outputs: [] },
    });
    const end = node("e", WORKFLOW_END_TYPE, {
      signature: { inputs: [], outputs: [{ id: "out-a", name: "result", label: "结果", type: "text" }] },
    });
    const edges: BoardEdge[] = [
      { id: "x", source: "s", sourcePort: "in-a", target: "e", targetPort: "out-a" },
    ];
    const result = await runWorkflowDoc([start, end], edges, {});
    expect(result.outputs).toEqual({ result: "你好" });
  });

  it("嵌入子工作流：父画布通过 workflow.call 拿到子工作流的输出", async () => {
    const board = setup();
    snapshots.set("wf-child", {
      nodes: [
        node("cs", WORKFLOW_START_TYPE, {
          signature: { inputs: [{ id: "cin", name: "text", label: "Text", type: "text", default: "子" }], outputs: [] },
        }),
        node("ce", WORKFLOW_END_TYPE, {
          signature: { inputs: [], outputs: [{ id: "cout", name: "result", label: "Result", type: "text" }] },
        }),
      ],
      edges: [
        { id: "ce1", source: "cs", sourcePort: "cin", target: "ce", targetPort: "cout" },
      ],
    });
    const call = node("call", WORKFLOW_CALL_TYPE, {
      // 和检查器一样存 rootId（一张工作流卡），不是某个版本 id。
      params: { workflow: "wf-child", workflowName: "子工作流" },
      ports: {
        inputs: [{ id: "cin", type: "text", labelKey: "board.port.workflowInput", label: "Text" }],
        outputs: [{ id: "out-cout", type: "text", labelKey: "board.port.workflowOutput", label: "Result" }],
      },
    });
    board.addNode(call);
    const result = await runAdapter(board.nodes[0]!, "call");
    expect(result.values).toEqual({ "out-cout": "子" });
    // 运行时按 rootId 解析（回归：曾经直接拿 rootId 当版本 id 去读，报「找不到工作流」）。
    expect(readWorkflowRoot).toHaveBeenCalledWith("wf-child");
  });

  it("目标签名变了（端口快照对不上）会提示重新选择，而不是静默跑错", async () => {
    const board = setup();
    snapshots.set("wf-changed", {
      nodes: [
        node("cs", WORKFLOW_START_TYPE, {
          signature: { inputs: [{ id: "new-id", name: "text", label: "Text", type: "text", default: "" }], outputs: [] },
        }),
        node("ce", WORKFLOW_END_TYPE, {
          signature: { inputs: [], outputs: [{ id: "cout", name: "result", label: "Result", type: "text" }] },
        }),
      ],
      edges: [{ id: "e", source: "cs", sourcePort: "new-id", target: "ce", targetPort: "cout" }],
    });
    const call = node("call", WORKFLOW_CALL_TYPE, {
      params: { workflow: "wf-changed", workflowName: "改过签名的工作流" },
      ports: {
        inputs: [{ id: "old-id", type: "text", labelKey: "board.port.workflowInput", label: "Text" }],
        outputs: [{ id: "out-cout", type: "text", labelKey: "board.port.workflowOutput", label: "Result" }],
      },
    });
    board.addNode(call);
    await expect(runAdapter(board.nodes[0]!, "call")).rejects.toThrow(/签名/);
  });

  it("嵌入不存在的 / 成环的子工作流会明确报错", async () => {
    const board = setup();
    const missing = node("m", WORKFLOW_CALL_TYPE, { params: { workflow: "nope" } });
    await expect(runAdapter(missing, "m")).rejects.toThrow(/找不到工作流/);
    void board;

    board.setSource({ rootId: "self" });
    const self = node("loop", WORKFLOW_CALL_TYPE, { params: { workflow: "self" } });
    await expect(runAdapter(self, "loop")).rejects.toThrow(/成环/);
  });
});
