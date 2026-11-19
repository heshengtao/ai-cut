import { beforeEach, describe, expect, it } from "vitest";
import { nodeDefinition, portsOf, valueKindOf } from "@/core/board/registry";
import { normalizeBoard } from "@/core/board/schema";
import { registerDataType, resetDataTypes } from "@/core/board/dataTypes";
import type { BoardNode } from "@/types/board";

function valueNode(id: string, type: string, params: Record<string, unknown> = {}): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params, bindings: {} } };
}

describe("value nodes", () => {
  beforeEach(() => {
    resetDataTypes();
  });

  it("两个值节点都注册在册，且默认类型不同", () => {
    expect(nodeDefinition("input.value")).toBeTruthy();
    expect(nodeDefinition("display.value")).toBeTruthy();
    expect(valueKindOf(valueNode("a", "input.value"))).toBe("number");
    expect(valueKindOf(valueNode("b", "display.value"))).toBe("text");
  });

  it("端口类型跟着 params.kind 变", () => {
    const json = portsOf(valueNode("a", "input.value", { kind: "json" }));
    expect(json.outputs).toEqual([
      { id: "value", type: "json", labelKey: "board.port.value" },
    ]);
    expect(json.inputs).toEqual([]);

    const display = portsOf(valueNode("b", "display.value", { kind: "boolean" }));
    expect(display.inputs).toEqual([
      { id: "value", type: "boolean", labelKey: "board.port.value" },
    ]);
    expect(display.outputs).toEqual([
      { id: "value", type: "boolean", labelKey: "board.port.value" },
    ]);
  });

  it("插件注册的类型可以直接当值节点类型用", () => {
    registerDataType("@demo/plugin", {
      id: "embedding",
      label: "Embedding",
      channels: ["inline"],
      inline: "json",
    });
    const ports = portsOf(valueNode("a", "input.value", { kind: "embedding" }));
    expect(ports.outputs[0]?.type).toBe("embedding");
  });
});

describe("normalizeBoard: 值产物与开放类型", () => {
  it("保留 values 里的 JSON 值，丢掉函数 / 非法键", () => {
    const board = normalizeBoard({
      nodes: [
        {
          id: "v1",
          type: "input.value",
          position: { x: 0, y: 0 },
          data: {
            params: { kind: "json" },
            bindings: {},
            values: {
              value: { a: 1, b: [true, "x"] },
              "坏键": 1,
              fn: () => 1,
            },
          },
        },
      ],
      edges: [],
    });
    expect(board.nodes[0]?.data.values).toEqual({ value: { a: 1, b: [true, "x"] } });
  });

  it("超过上限的值整块丢掉（大对象该走 blob 引用）", () => {
    const huge = "x".repeat(70 * 1024);
    const board = normalizeBoard({
      nodes: [
        {
          id: "v1",
          type: "input.value",
          position: { x: 0, y: 0 },
          data: { params: {}, bindings: {}, values: { value: huge } },
        },
      ],
      edges: [],
    });
    expect(board.nodes[0]?.data.values).toBeUndefined();
  });

  it("插件端口快照里的自定义类型不被丢掉", () => {
    const board = normalizeBoard({
      nodes: [
        {
          id: "p1",
          type: "ext.demo.node",
          position: { x: 0, y: 0 },
          data: {
            params: {},
            bindings: {},
            ports: {
              inputs: [{ id: "in", type: "embedding", labelKey: "x.in" }],
              outputs: [{ id: "out", type: "embedding", labelKey: "x.out" }],
            },
          },
        },
      ],
      edges: [],
    });
    expect(board.nodes[0]?.data.ports?.outputs[0]?.type).toBe("embedding");
  });
});
