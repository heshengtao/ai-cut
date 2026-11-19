import { describe, expect, it } from "vitest";
import { computed } from "vue";
import {
  BOARD_NODES,
  boardRegistryRevision,
  nodeDefinition,
  nodesByCategory,
  registerNodeDefinition,
} from "../registry";
import type { BoardNodeDefinition } from "@/types/board";
import zh from "@/i18n/zh";
import zh from "@/i18n/zh";

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

describe("node registry i18n", () => {
  it("内置节点的标题 / 端口 / 参数文案都有中文（新增节点别漏翻译）", () => {
    for (const definition of BOARD_NODES) {
      expect(zh[definition.titleKey], definition.type).toBeTruthy();
      if (definition.menuTitleKey) {
        expect(zh[definition.menuTitleKey], definition.type).toBeTruthy();
      }
      for (const port of [...definition.inputs, ...definition.outputs]) {
        expect(zh[port.labelKey], `${definition.type}.${port.id}`).toBeTruthy();
      }
      for (const param of definition.params) {
        expect(zh[param.labelKey], `${definition.type}.${param.id}`).toBeTruthy();
        for (const option of param.options ?? []) {
          expect(zh[option.labelKey], `${definition.type}.${param.id}.${option.value}`).toBeTruthy();
        }
      }
    }
  });
});

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

  it("注册 / 注销会让版本号变化，读它的 computed 跟着重新取定义", () => {
    // 真实事故：插件是启动后异步装的，晚于画布挂载时 `ext.*` 节点查不到定义，
    // 卡片渲染成空白（直到某次偶然的重渲染才恢复）。画布读版本号就是为了这个。
    const before = boardRegistryRevision();
    const definition = computed(() => {
      void boardRegistryRevision();
      return nodeDefinition(demo.type);
    });
    expect(definition.value).toBeNull();

    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(boardRegistryRevision()).toBe(before + 1);
    expect(definition.value).toEqual(demo);

    dispose();
    expect(boardRegistryRevision()).toBe(before + 2);
    expect(definition.value).toBeNull();
  });

  it("includes a registered plugin node in its category", () => {
    const dispose = registerNodeDefinition(demo, "@demo/plugin");
    expect(nodesByCategory().model.some((item) => item.type === "ext.demo.node")).toBe(true);
    dispose();
  });
});
