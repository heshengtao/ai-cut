import { describe, expect, it, vi } from "vitest";

const invoked: { cmd: string; args?: Record<string, unknown> }[] = [];
vi.mock("@/platform/tauri", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    if (cmd === "plugin_host_list") return { plugins: [] };
    return { plugins: [{ id: "@demo/x" }], plugin: { id: "@demo/x" } };
  },
  listen: async () => () => {},
}));

import {
  pluginHostInstallLocal,
  pluginHostList,
  pluginHostRemove,
  pluginHostSetEnabled,
} from "../pluginHostApi";

describe("plugin host api", () => {
  it("calls the list command without arguments", async () => {
    await pluginHostList();
    expect(invoked.at(-1)).toEqual({ cmd: "plugin_host_list", args: undefined });
  });

  it("passes the directory path when installing", async () => {
    await pluginHostInstallLocal("/tmp/plugin");
    expect(invoked.at(-1)).toEqual({
      cmd: "plugin_host_install_local",
      args: { path: "/tmp/plugin" },
    });
  });

  it("passes id and enabled when toggling", async () => {
    await pluginHostSetEnabled("@demo/x", false);
    expect(invoked.at(-1)).toEqual({
      cmd: "plugin_host_set_enabled",
      args: { id: "@demo/x", enabled: false },
    });
  });

  it("passes id when removing", async () => {
    await pluginHostRemove("@demo/x");
    expect(invoked.at(-1)).toEqual({ cmd: "plugin_host_remove", args: { id: "@demo/x" } });
  });
});
