import { describe, expect, it } from "vitest";
import { BOARD_NODES, nodeDefinition, nodesByCategory, registerNodeDefinition } from "../registry";
import type { BoardNodeDefinition } from "@/types/board";

const demo: BoardNodeDefinition = {
  type: "ext.demo.node",
  titleKey: "@demo.title",
  category: "model",
  order: 999,
  inputs: [],
  outputs: [{ id: "out", type: "text", labelKey: "@demo.port" }],
  params: [],
  defaultSize: { width: 320, height: 200 },
};

describe("node definition registry", () => {
  it("registers a plugin node and finds it by type", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(nodeDefinition("ext.demo.node")).toEqual(demo);
    dispose();
    expect(nodeDefinition("ext.demo.node")).toBeNull();
  });

  it("rejects a duplicate type and names the occupier", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(() => registerNodeDefinition(demo, "@other/plugin")).toThrow(/@demo\/plugin/);
    dispose();
  });

  it("rejects a plugin type without the ext. prefix", () => {
    expect(() =>
      registerNodeDefinition({ ...demo, type: "model.notnamespaced" }, "@demo/plugin"),
    ).toThrow(/ext\./);
  });

  it("rejects an unknown category at registration", () => {
    expect(() =>
      registerNodeDefinition({ ...demo, type: "ext.demo.weird", category: "weird" as never },
        "@demo/plugin"),
    ).toThrow(/分类/);
  });

  it("skips unknown categories from historical data instead of throwing", () => {
    // 模拟旧版本 / 未来版本写进菜单的坏数据：绕过注册函数直接进数组。
    const rogue: BoardNodeDefinition = { ...demo, type: "ext.demo.rogue", category: "weird" as never };
    BOARD_NODES.push(rogue);
    expect(() => nodesByCategory()).not.toThrow();
    expect(Object.values(nodesByCategory()).flat().some((item) => item.type === "ext.demo.rogue")).toBe(false);
    BOARD_NODES.splice(BOARD_NODES.indexOf(rogue), 1);
  });

  it("includes a registered plugin node in its category", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(nodesByCategory().model.some((item) => item.type === "ext.demo.node")).toBe(true);
    dispose();
  });
});
