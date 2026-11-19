import { describe, expect, it } from "vitest";
import { normalizeBoard } from "../schema";
import { portsOf } from "../registry";

const snapshot = {
  inputs: [{ id: "in", type: "image" as const, labelKey: "@demo.in" }],
  outputs: [{ id: "out", type: "text" as const, labelKey: "@demo.out" }],
};

describe("port snapshot for missing plugins", () => {
  it("restores ports for a node whose definition is gone", () => {
    const doc = normalizeBoard({
      nodes: [
        {
          id: "n1",
          type: "ext.gone.node",
          position: { x: 0, y: 0 },
          size: { width: 320, height: 200 },
          data: { params: {}, bindings: {}, ports: snapshot },
        },
      ],
      edges: [],
    });
    expect(doc.nodes[0]!.data.ports).toEqual(snapshot);
    expect(portsOf(doc.nodes[0]!).outputs).toEqual(snapshot.outputs);
  });

  // 注意：`portTypeOf` 的第一个参数收的是**节点 id**（schema.ts 传的是 `source`），
  // 不是节点类型。生产调用方目前都不传这个选项（serialize.ts 只传一个参数），
  // 所以「加载即丢线」并不是现实问题；快照真正解决的是「端口渲染不出来、连不上新线」。
  it("keeps an edge that only the snapshot can type", () => {
    const doc = normalizeBoard(
      {
        nodes: [
          {
            id: "n1",
            type: "ext.gone.node",
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 },
            data: { params: {}, bindings: {}, ports: snapshot },
          },
          {
            id: "n2",
            type: "input.image",
            position: { x: 400, y: 0 },
            size: { width: 320, height: 200 },
            data: { params: {}, bindings: {} },
          },
        ],
        edges: [{ id: "e1", source: "n1", sourcePort: "out", target: "n2", targetPort: "image" }],
      },
      (nodeId, portId, side) => {
        const known: Record<
          string,
          { inputList: typeof snapshot.inputs; outputList: typeof snapshot.outputs }
        > = {
          n1: { inputList: snapshot.inputs, outputList: snapshot.outputs },
          n2: {
            inputList: [{ id: "image", type: "image" as const, labelKey: "board.port.image" }],
            outputList: [],
          },
        };
        const list = side === "out" ? known[nodeId]?.outputList : known[nodeId]?.inputList;
        return list?.find((port) => port.id === portId)?.type ?? null;
      },
    );
    expect(doc.edges).toHaveLength(1);
  });

  it("drops a malformed snapshot instead of trusting it", () => {
    const doc = normalizeBoard({
      nodes: [
        {
          id: "n1",
          type: "ext.gone.node",
          position: { x: 0, y: 0 },
          size: { width: 320, height: 200 },
          data: { params: {}, bindings: {}, ports: { inputs: "nope" } },
        },
      ],
      edges: [],
    });
    expect(doc.nodes[0]!.data.ports).toBeUndefined();
  });
});
