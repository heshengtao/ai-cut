import { describe, expect, it, vi } from "vitest";
import { adapterFor, pluginNodeType, registerAdapter } from "../adapters";
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
