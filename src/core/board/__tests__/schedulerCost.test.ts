import { describe, expect, it } from "vitest";
import { nodeCost } from "../scheduler";
import { registerNodeDefinition } from "../registry";
import type { BoardNode } from "@/types/board";

function node(type: string): BoardNode {
  return {
    id: "n1",
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    data: { params: {}, bindings: {} },
  };
}

describe("nodeCost with plugin nodes", () => {
  it("uses the declared lane instead of falling back to gpu", () => {
    const dispose = registerNodeDefinition(
      {
        type: "ext.demo.api",
        titleKey: "@demo.api",
        category: "model",
        order: 999,
        inputs: [],
        outputs: [],
        params: [],
        defaultSize: { width: 320, height: 200 },
        cost: { lane: "api", ramMb: 64 },
      },
      "@demo/plugin",
    );
    expect(nodeCost(node("ext.demo.api"))).toEqual({ lane: "api", vramMb: 0, ramMb: 64 });
    dispose();
  });

  it("returns null for an unregistered plugin type", () => {
    expect(nodeCost(node("ext.never.registered"))).toBeNull();
  });

  it("keeps builtin lanes unchanged", () => {
    expect(nodeCost(node("model.text"))).toMatchObject({ lane: "api" });
    expect(nodeCost(node("input.text"))).toMatchObject({ lane: "instant" });
    expect(nodeCost(node("group"))).toBeNull();
  });
});
