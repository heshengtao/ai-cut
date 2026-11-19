import { afterEach, describe, expect, it } from "vitest";
import { adapterFor } from "@/core/board/adapters";
import { nodeDefinition } from "@/core/board/registry";
import { commandFor } from "@/core/commandTable";
import { disposeAll, loadPluginModule, loadedPluginIds, type PluginClientModule } from "../loader";

const def = {
  type: "ext.demo.hello",
  titleKey: "@demo.hello",
  category: "model" as const,
  order: 999,
  inputs: [],
  outputs: [{ id: "out", type: "text" as const, labelKey: "@demo.out" }],
  params: [],
  defaultSize: { width: 300, height: 180 },
  cost: { lane: "api" as const },
};

function plugin(): PluginClientModule {
  return {
    id: "@demo/x",
    apply(ctx) {
      ctx.nodes.register(def, async () => ({ text: "hi" }));
      ctx.commands.register({ id: "ext.demo.run", titleKey: "@demo.cmd", run: () => {} });
      ctx.i18n.register({ zh: { hello: "你好" }, en: { hello: "Hello" } });
    },
  };
}

afterEach(() => disposeAll());

describe("plugin loader", () => {
  it("registers nodes, adapters, commands and messages", () => {
    const loaded = loadPluginModule({ id: "@demo/x", url: "memory:" }, plugin());
    expect(nodeDefinition("ext.demo.hello")).not.toBeNull();
    expect(adapterFor("ext.demo.hello")).not.toBeNull();
    expect(commandFor("ext.demo.run")).not.toBeNull();
    expect(loadedPluginIds()).toEqual(["@demo/x"]);
    loaded.dispose();
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
    expect(adapterFor("ext.demo.hello")).toBeNull();
    expect(commandFor("ext.demo.run")).toBeNull();
  });

  it("rejects a module whose id does not match the entry", () => {
    expect(() => loadPluginModule({ id: "@demo/y", url: "memory:" }, plugin())).toThrow(/@demo\/x/);
  });

  it("rolls back half-applied registrations when apply throws", () => {
    const broken: PluginClientModule = {
      id: "@demo/broken",
      apply(ctx) {
        ctx.nodes.register(def, async () => ({}));
        throw new Error("boom");
      },
    };
    expect(() => loadPluginModule({ id: "@demo/broken", url: "memory:" }, broken)).toThrow(/boom/);
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
    expect(adapterFor("ext.demo.hello")).toBeNull();
  });

  it("disposeAll clears every loaded plugin", () => {
    loadPluginModule({ id: "@demo/x", url: "memory:" }, plugin());
    disposeAll();
    expect(nodeDefinition("ext.demo.hello")).toBeNull();
    expect(loadedPluginIds()).toEqual([]);
  });
});
