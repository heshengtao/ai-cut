import { afterEach, describe, expect, it } from "vitest";
import { adapterFor } from "@/core/board/adapters";
import { nodeDefinition } from "@/core/board/registry";
import { commandFor } from "@/core/commandTable";
import { setTranslateLocale, t } from "@/i18n/translate";
import { disposeAll, loadPluginModule, type PluginClientModule } from "../loader";

// 仓内的示例插件：直接以源码形态被加载，证明「不需要构建也能跑」。
// @ts-ignore —— 示例是纯 JS，没有类型声明。
import example from "../../../../examples/plugin-hello/client.js";

afterEach(() => {
  disposeAll();
  setTranslateLocale("zh");
});

describe("bundled example plugin", () => {
  it("registers its node, command and messages", () => {
    const module = example as PluginClientModule;
    loadPluginModule({ id: module.id, url: "examples/plugin-hello/client.js" }, module);

    expect(nodeDefinition("ext.hello.greet")).not.toBeNull();
    expect(adapterFor("ext.hello.greet")).not.toBeNull();
    expect(commandFor("ext.hello.greet")).not.toBeNull();

    setTranslateLocale("zh");
    expect(t("@aicut/plugin-hello.name")).toBe("打招呼");
    setTranslateLocale("en");
    expect(t("@aicut/plugin-hello.name")).toBe("Hello");
  });

  it("runs the adapter and returns text", async () => {
    const module = example as PluginClientModule;
    loadPluginModule({ id: module.id, url: "examples/plugin-hello/client.js" }, module);
    const run = adapterFor("ext.hello.greet")!;
    const result = await run({
      node: {
        id: "n1",
        type: "ext.hello.greet",
        position: { x: 0, y: 0 },
        data: { params: { name: "AI Cut" }, bindings: {} },
      },
      nodeId: "n1",
      signal: new AbortController().signal,
      io: {
        param: (id: string) => (id === "name" ? "AI Cut" : undefined),
        text: () => null,
        asset: () => null,
        refs: () => [],
        progress: () => {},
      },
    });
    expect(result.text).toBe("hello AI Cut");
  });
});
