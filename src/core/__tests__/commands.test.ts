import { describe, expect, it, vi } from "vitest";
import { commandFor, matchShortcut, registerCommand, runCommand } from "../commandTable";

// 测试环境是 node（没有 DOM），只关心这几个字段，用普通对象冒充 KeyboardEvent。
function key(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    metaKey: !!init.metaKey,
    ctrlKey: !!init.ctrlKey,
    shiftKey: !!init.shiftKey,
    altKey: !!init.altKey,
  } as unknown as KeyboardEvent;
}

describe("command table", () => {
  it("registers and looks up a command", () => {
    const run = vi.fn();
    registerCommand({ id: "demo.run", titleKey: "menu.demo", run });
    expect(commandFor("demo.run")?.titleKey).toBe("menu.demo");
  });

  it("rejects duplicate ids and names the occupier", () => {
    registerCommand({ id: "demo.dup", titleKey: "menu.demo", run: () => {}, owner: "@a" });
    expect(() =>
      registerCommand({ id: "demo.dup", titleKey: "menu.demo", run: () => {}, owner: "@b" }),
    ).toThrow(/@a/);
  });

  it("rejects a duplicate keybinding and names the occupier", () => {
    registerCommand({
      id: "demo.k1",
      titleKey: "menu.demo",
      key: "mod+alt+k",
      run: () => {},
      owner: "@a",
    });
    expect(() =>
      registerCommand({
        id: "demo.k2",
        titleKey: "menu.demo",
        key: "mod+alt+k",
        run: () => {},
        owner: "@b",
      }),
    ).toThrow(/@a/);
  });

  it("matches a shortcut from a KeyboardEvent", () => {
    registerCommand({ id: "demo.k3", titleKey: "menu.demo", key: "mod+alt+j", run: () => {} });
    expect(matchShortcut(key({ key: "j", metaKey: true, altKey: true }))?.id).toBe("demo.k3");
    expect(matchShortcut(key({ key: "j", altKey: true }))).toBeNull();
  });

  it("respects the when guard", async () => {
    const run = vi.fn();
    let allowed = false;
    registerCommand({ id: "demo.when", titleKey: "menu.demo", when: () => allowed, run });
    expect(await runCommand("demo.when")).toBe(false);
    allowed = true;
    expect(await runCommand("demo.when")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("drops everything on dispose", () => {
    const dispose = registerCommand({
      id: "demo.drop",
      titleKey: "menu.demo",
      key: "mod+alt+d",
      run: () => {},
    });
    dispose();
    expect(commandFor("demo.drop")).toBeNull();
    expect(matchShortcut(key({ key: "d", metaKey: true, altKey: true }))).toBeNull();
  });
});
