import { describe, expect, it, vi } from "vitest";
import { adapterFor, paramReader, pluginNodeType, registerAdapter } from "../adapters";
import { registerNodeDefinition } from "../registry";
import type { BoardNode, BoardNodeDefinition } from "@/types/board";

function node(type: string): BoardNode {
  return {
    id: "n1",
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    data: { params: {}, bindings: {} },
  };
}

describe("adapter registry", () => {
  it("registers and resolves an adapter", async () => {
    const fn = vi.fn(async () => ({ text: "ok" }));
    registerAdapter("ext.demo.hello", fn);
    expect(adapterFor("ext.demo.hello")).toBe(fn);
  });

  it("returns null after the disposer runs", () => {
    const dispose = registerAdapter("ext.demo.temp", async () => ({}));
    dispose();
    expect(adapterFor("ext.demo.temp")).toBeNull();
  });

  it("rejects a duplicate type and names the occupier", () => {
    registerAdapter("ext.demo.dup", async () => ({}));
    expect(() => registerAdapter("ext.demo.dup", async () => ({}))).toThrow(/ext\.demo\.dup/);
  });

  it("rejects the same type registered by a different owner", () => {
    const dispose = registerAdapter("ext.demo.owned", async () => ({}), "plugin-a");
    expect(() => registerAdapter("ext.demo.owned", async () => ({}), "plugin-b")).toThrow(
      /plugin-a/,
    );
    dispose();
  });

  it("recognises plugin node types by the ext. prefix", () => {
    expect(pluginNodeType("ext.demo.hello")).toBe(true);
    expect(pluginNodeType("model.video")).toBe(false);
  });

  it("adapter receives node, signal and io", async () => {
    const seen: unknown[] = [];
    registerAdapter("ext.demo.ctx", async (input) => {
      seen.push(input.node.id, input.signal.aborted, typeof input.io.progress);
      return {};
    });
    const controller = new AbortController();
    await adapterFor("ext.demo.ctx")!({
      node: node("ext.demo.ctx"),
      nodeId: "n1",
      signal: controller.signal,
      io: {
        param: () => undefined,
        text: () => null,
        asset: () => null,
        refs: () => [],
        progress: () => {},
      },
    });
    expect(seen).toEqual(["n1", false, "function"]);
  });
});

describe("paramReader", () => {
  // 第三方插件节点的真实形态：参数控件带 `default`，`data.params` 只存用户改过的。
  const definition: BoardNodeDefinition = {
    type: "ext.demo.params",
    titleKey: "demo",
    category: "model",
    order: 1,
    inputs: [],
    outputs: [],
    params: [
      { id: "base", labelKey: "base", kind: "text", default: "https://www.runlive.top/mnmx" },
      { id: "duration", labelKey: "duration", kind: "number", default: 5 },
      { id: "key", labelKey: "key", kind: "text", default: "" },
    ],
    defaultSize: { width: 300, height: 200 },
    cost: { lane: "api", ramMb: 16 },
  };

  function withDefinition<T>(run: () => T): T {
    const dispose = registerNodeDefinition(definition, "@demo/params");
    try {
      return run();
    } finally {
      dispose();
    }
  }

  it("参数没落盘时回落到定义里的默认值（卡片显示什么，run 就拿到什么）", () => {
    withDefinition(() => {
      const read = paramReader(node("ext.demo.params"));
      expect(read("base")).toBe("https://www.runlive.top/mnmx");
      expect(read<number>("duration")).toBe(5);
      // 声明了默认值就能读到；没有声明过的 id 依旧是 undefined。
      expect(read("nope")).toBeUndefined();
    });
  });

  it("用户存过的值优先，包括主动清空的空串", () => {
    withDefinition(() => {
      const stored: BoardNode = {
        ...node("ext.demo.params"),
        data: { params: { base: "", key: "card-1" }, bindings: {} },
      };
      const read = paramReader(stored);
      expect(read("base")).toBe("");
      expect(read("key")).toBe("card-1");
      expect(read<number>("duration")).toBe(5);
    });
  });

  it("null 与未设置等价；插件被卸载（定义缺失）时不炸", () => {
    withDefinition(() => {
      const nulled: BoardNode = {
        ...node("ext.demo.params"),
        data: { params: { base: null }, bindings: {} },
      };
      expect(paramReader(nulled)("base")).toBe("https://www.runlive.top/mnmx");
    });
    expect(paramReader(node("ext.gone.type"))("base")).toBeUndefined();
  });
});
