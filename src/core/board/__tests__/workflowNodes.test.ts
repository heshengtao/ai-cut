/**
 * 工作流开始 / 结束 / 嵌入节点的签名语义：
 * 端口生成（含插件类型）、成对校验、发布前的图校验。
 */
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_CALL_TYPE,
  WORKFLOW_END_TYPE,
  WORKFLOW_START_TYPE,
  callPorts,
  canvasWorkflow,
  declKey,
  endInputs,
  endOutputs,
  normalizeSignature,
  startPorts,
  isFrameNode,
  workflowProblems,
} from "@/core/board/workflowNodes";
import { registerDataType, resetDataTypes } from "@/core/board/dataTypes";
import type { BoardEdge, BoardNode, WorkflowSignature } from "@/types/board";

function node(
  id: string,
  type: string,
  data: Partial<BoardNode["data"]> = {},
): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params: {}, bindings: {}, ...data } };
}

function signature(inputs: WorkflowSignature["inputs"], outputs: WorkflowSignature["outputs"] = []): WorkflowSignature {
  return { inputs, outputs };
}

const decl = (
  id: string,
  name: string,
  type = "text",
  extra: Partial<WorkflowSignature["inputs"][number]> = {},
) => ({ id, name, label: name, type, ...extra });

describe("工作流签名", () => {
  it("开始节点把每个声明输入发布成一个端口，结束节点收集输出", () => {
    const start = node("s", WORKFLOW_START_TYPE, {
      signature: signature([decl("in-a", "prompt"), decl("in-b", "seed", "integer")]),
    });
    expect(startPorts(start).map((port) => [port.id, port.type, port.label])).toEqual([
      ["in-a", "text", "prompt"],
      ["in-b", "integer", "seed"],
    ]);

    const end = node("e", WORKFLOW_END_TYPE, {
      signature: signature([], [decl("out-r", "result", "image")]),
    });
    expect(endInputs(end).map((port) => port.id)).toEqual(["out-r"]);
    expect(endOutputs(end).map((port) => [port.id, port.type])).toEqual([["out-out-r", "image"]]);
  });

  it("归一化丢掉坏行并补齐名字；id 稳定不变", () => {
    const raw = normalizeSignature({
      inputs: [
        { id: "in-1", type: "text", label: "提示词" },
        { id: "", type: "nope", name: "" },
        null,
        { id: "in-3", type: "image", name: "参考图", required: true },
      ],
      outputs: [{ id: "out-1", type: "json", name: "结果" }],
    });
    expect(raw?.inputs).toHaveLength(3);
    expect(raw?.inputs[0]).toMatchObject({ id: "in-1", name: "提示词", label: "提示词" });
    expect(raw?.inputs[0]!.type).toBe("text");
    // 未注册但 id 合法的类型原样保留（插件暂时卸载时工程仍然能加载）：
    // 类型注册表只校验 id 形状，连线时再做兼容回落。
    expect(raw?.inputs[1]!.type).toBe("nope");
    expect(raw?.inputs[2]).toMatchObject({ id: "in-3", required: true });
    expect(raw?.outputs[0]!.id).toBe("out-1");
  });

  it("插件注册的类型与内置类型平等出现（调用端口按签名生成）", () => {
    resetDataTypes();
    const dispose = registerDataType("ext.demo", {
      id: "ext.demo.frame",
      label: "Frame",
      channels: ["inline"],
    });
    const ports = callPorts({
      inputs: [decl("in-x", "frame", "ext.demo.frame")],
      outputs: [decl("out-y", "picked", "ext.demo.frame")],
    });
    expect(ports.inputs[0]!.type).toBe("ext.demo.frame");
    expect(ports.outputs[0]!.type).toBe("ext.demo.frame");
    dispose();
    resetDataTypes();
  });

  it("canvasWorkflow 合并开始输入与结束输出", () => {
    const start = node("s", WORKFLOW_START_TYPE, {
      signature: signature([decl("in-a", "prompt")]),
    });
    const end = node("e", WORKFLOW_END_TYPE, {
      signature: signature([], [decl("out-r", "result", "image")]),
    });
    const workflow = canvasWorkflow([start, end]);
    expect(workflow.start?.id).toBe("s");
    expect(workflow.end?.id).toBe("e");
    expect(workflow.signature.inputs.map(declKey)).toEqual(["prompt"]);
    expect(workflow.signature.outputs.map(declKey)).toEqual(["result"]);
  });
});

describe("组框与工作流节点", () => {
  it("只有 group 节点本身是组框；工作流节点属于 group 分类但会发布输出", () => {
    expect(isFrameNode({ type: "group" })).toBe(true);
    expect(isFrameNode({ type: WORKFLOW_START_TYPE })).toBe(false);
    expect(isFrameNode({ type: WORKFLOW_CALL_TYPE })).toBe(false);
  });
});

describe("画布能否发布", () => {
  it("缺开始 / 结束、名字重复、必填输出没接线都报出来", () => {
    // 一对都没搭：只报一条「缺少子工作流节点」。
    const empty = workflowProblems([], []);
    expect(empty.map((item) => item.code)).toEqual(["missingWorkflowNodes"]);

    // 只缺一半时仍然报具体的那一个。
    const onlyStart = node("s", WORKFLOW_START_TYPE, { pairId: "p1", signature: signature([]) });
    expect(workflowProblems([onlyStart], []).map((item) => item.code)).toEqual(["missingEnd"]);

    const start = node("s", WORKFLOW_START_TYPE, {
      pairId: "p1",
      signature: signature([decl("in-a", "x"), decl("in-b", "x")]),
    });
    const end = node("e", WORKFLOW_END_TYPE, {
      pairId: "p1",
      signature: signature([], [decl("out-a", "y", "text", { required: true })]),
    });
    const codes = workflowProblems([start, end], []).map((item) => item.code);
    expect(codes).toContain("inputNameDuplicate");
    expect(codes).toContain("outputUnbound");
    expect(codes).not.toContain("missingStart");
  });

  it("成对、名字唯一、输出接了线、无环 → 没有 problems", () => {
    const start = node("s", WORKFLOW_START_TYPE, {
      pairId: "p1",
      signature: signature([decl("in-a", "prompt")]),
    });
    const end = node("e", WORKFLOW_END_TYPE, {
      pairId: "p1",
      signature: signature([], [decl("out-a", "result", "text", { required: true })]),
    });
    const edge: BoardEdge = {
      id: "e1",
      source: "s",
      sourcePort: "in-a",
      target: "e",
      targetPort: "out-a",
    };
    expect(workflowProblems([start, end], [edge])).toEqual([]);
  });

  it("工作流开始 / 结束必须成对（pairId 不一致算坏）", () => {
    const start = node("s", WORKFLOW_START_TYPE, { pairId: "p1", signature: signature([]) });
    const end = node("e", WORKFLOW_END_TYPE, { pairId: "p2", signature: signature([]) });
    expect(workflowProblems([start, end], []).map((item) => item.code)).toContain("pairBroken");
  });

  it("环会被拦下", () => {
    const a = node("a", "display.text");
    const b = node("b", "display.text");
    const edges: BoardEdge[] = [
      { id: "1", source: "a", sourcePort: "text", target: "b", targetPort: "text" },
      { id: "2", source: "b", sourcePort: "text", target: "a", targetPort: "text" },
    ];
    expect(workflowProblems([a, b], edges).map((item) => item.code)).toContain("cycle");
  });
});
