import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "@/core/board/adapters";
import { disposeAll, loadPluginModule, type PluginClientModule } from "../loader";

const invoked: { id: string; input: string }[] = [];
vi.mock("@/core/pluginHostApi", () => ({
  pluginHostInvoke: async (id: string, input: string) => {
    invoked.push({ id, input });
    return `echo: ${(JSON.parse(input) as { text: string }).text}`;
  },
}));

// @ts-ignore 示例是纯 JS
import example from "../../../../examples/plugin-echo/client.js";

afterEach(() => {
  disposeAll();
  invoked.length = 0;
});

const node = {
  id: "n1",
  type: "ext.echo.text",
  position: { x: 0, y: 0 },
  data: { params: {}, bindings: {} },
};

describe("example echo plugin", () => {
  it("forwards the input text to its host half", async () => {
    const module = example as PluginClientModule;
    loadPluginModule({ id: module.id, url: "examples/plugin-echo/client.js" }, module);

    const run = adapterFor("ext.echo.text")!;
    const result = await run({
      node,
      nodeId: "n1",
      signal: new AbortController().signal,
      io: {
        param: () => undefined,
        text: () => "hi",
        asset: () => null,
        refs: () => [],
        progress: () => {},
      },
    });

    expect(result.text).toBe("echo: hi");
    expect(invoked).toEqual([{ id: "@aicut/plugin-echo", input: '{"text":"hi"}' }]);
  });

  it("sends an empty string when the upstream is missing", async () => {
    const module = example as PluginClientModule;
    loadPluginModule({ id: module.id, url: "examples/plugin-echo/client.js" }, module);
    const run = adapterFor("ext.echo.text")!;
    const result = await run({
      node,
      nodeId: "n1",
      signal: new AbortController().signal,
      io: {
        param: () => undefined,
        text: () => null,
        asset: () => null,
        refs: () => [],
        progress: () => {},
      },
    });
    expect(result.text).toBe("echo: ");
  });
});
