import { describe, expect, it } from "vitest";

import { exportWorkflow, parseWorkflow } from "@/core/board/workflow";

const nodes = [
  {
    id: "n1",
    type: "model.text",
    position: { x: 10, y: 20 },
    data: { params: { model: "p::m" }, bindings: {}, bypassed: true },
  },
  {
    id: "n2",
    type: "display.text",
    position: { x: 300, y: 20 },
    data: { params: {}, bindings: {} },
  },
];
const edges = [
  { id: "e1", source: "n1", sourcePort: "text", target: "n2", targetPort: "text" },
];

describe("workflow 导入 / 导出", () => {
  it("导出后再解析：节点 / 连线 / 旁路都保留", () => {
    const parsed = parseWorkflow(exportWorkflow(nodes as never, edges as never));
    expect(parsed).not.toBeNull();
    expect(parsed!.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(parsed!.nodes[0].data.bypassed).toBe(true);
    expect(parsed!.edges).toHaveLength(1);
  });

  it("整份工程 JSON 也能当工作流导入", () => {
    const project = JSON.stringify({ board: { nodes, edges } });
    const parsed = parseWorkflow(project);
    expect(parsed?.nodes).toHaveLength(2);
  });

  it("不像工作流的 JSON 返回 null", () => {
    expect(parseWorkflow("not json")).toBeNull();
    expect(parseWorkflow(JSON.stringify({ hello: 1 }))).toBeNull();
    expect(parseWorkflow(JSON.stringify({ nodes: [], edges: [] }))).toBeNull();
  });
});
