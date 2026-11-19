import { afterEach, describe, expect, it } from "vitest";
import { h } from "vue";
import { clearControls, controlFor, registerControl } from "../controls";
import { clearPanes, paneFor, pluginPanes, registerPane } from "../panes";

afterEach(() => {
  clearControls();
  clearPanes();
});

describe("parameter controls", () => {
  it("registers and resolves a control component", () => {
    const component = h("input");
    const dispose = registerControl("@demo/x", { id: "ext.demo.control", component });
    expect(controlFor("ext.demo.control")).toBe(component);
    dispose();
    expect(controlFor("ext.demo.control")).toBeNull();
  });

  it("rejects a duplicate id and names the occupier", () => {
    const component = h("input");
    registerControl("@demo/a", { id: "ext.demo.dup", component });
    expect(() => registerControl("@demo/b", { id: "ext.demo.dup", component })).toThrow(/@demo\/a/);
  });
});

describe("plugin panes", () => {
  it("registers a pane and clears it on dispose", () => {
    const component = h("div");
    const dispose = registerPane("@demo/x", {
      id: "ext.demo.pane",
      titleKey: "@demo/title",
      component,
    });
    expect(pluginPanes()).toHaveLength(1);
    expect(paneFor("ext.demo.pane")?.titleKey).toBe("@demo/title");
    dispose();
    expect(pluginPanes()).toHaveLength(0);
  });

  it("rejects a duplicate pane id", () => {
    const component = h("div");
    registerPane("@demo/a", { id: "ext.demo.pane", titleKey: "x", component });
    expect(() =>
      registerPane("@demo/b", { id: "ext.demo.pane", titleKey: "x", component }),
    ).toThrow(/@demo\/a/);
  });
});
