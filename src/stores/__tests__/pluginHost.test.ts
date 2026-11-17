import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => {
  const dispose = vi.fn();
  return {
    dispose,
    list: vi.fn(),
    setEnabled: vi.fn(),
    remove: vi.fn(),
    installLocal: vi.fn(),
    startHost: vi.fn(async () => {}),
    stopHost: vi.fn(async () => []),
    loadPluginModule: vi.fn(() => ({ id: "@demo/x", dispose })),
  };
});

vi.mock("@/core/pluginHostApi", () => ({
  pluginHostList: () => mocks.list(),
  pluginHostSetEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
  pluginHostRemove: (...args: unknown[]) => mocks.remove(...args),
  pluginHostInstallLocal: (...args: unknown[]) => mocks.installLocal(...args),
  pluginHostStart: (...args: unknown[]) => mocks.startHost(...args),
  pluginHostStop: (...args: unknown[]) => mocks.stopHost(...args),
  onPluginHostProgress: vi.fn(),
}));

vi.mock("@/core/plugins/loader", () => ({
  loadPluginModule: (...args: unknown[]) => mocks.loadPluginModule(...args),
}));

import { usePluginHostStore } from "../pluginHost";
import type { PluginStatus } from "@/types/pluginHost";

const enabled: PluginStatus = {
  id: "@demo/x",
  version: "0.1.0",
  kind: "linked",
  enabled: true,
  dir: "/tmp/x",
  client: "/tmp/x/client.js",
  hostFile: null,
  rev: "0.1.0-1",
  compatible: true,
  lastError: null,
};

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.list.mockReset();
  mocks.setEnabled.mockReset();
  mocks.remove.mockReset();
  mocks.installLocal.mockReset();
  mocks.startHost.mockClear();
  mocks.stopHost.mockClear();
  mocks.dispose.mockReset();
  mocks.loadPluginModule.mockClear();
});

describe("plugin host store", () => {
  it("refreshes the list from the daemon", async () => {
    mocks.list.mockResolvedValue([enabled]);
    const store = usePluginHostStore();
    await store.refresh();
    expect(store.plugins).toHaveLength(1);
  });

  it("loads enabled plugins through the injected importer", async () => {
    mocks.list.mockResolvedValue([enabled]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    expect(mocks.loadPluginModule).toHaveBeenCalledOnce();
  });

  it("skips incompatible plugins and records why", async () => {
    mocks.list.mockResolvedValue([
      { ...enabled, compatible: false, lastError: "需要 AI Cut 1.3.0" },
    ]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async () => ({ id: "@demo/x", apply() {} }));
    expect(mocks.loadPluginModule).not.toHaveBeenCalled();
    expect(store.failed[0]).toContain("1.3.0");
  });

  it("records a failure and keeps going when one plugin throws", async () => {
    mocks.list.mockResolvedValue([enabled]);
    mocks.loadPluginModule.mockImplementationOnce(() => {
      throw new Error("apply 炸了");
    });
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    expect(store.failed.join(" ")).toContain("apply 炸了");
  });

  it("disposes a plugin when it is disabled", async () => {
    mocks.list.mockResolvedValue([enabled]);
    mocks.setEnabled.mockResolvedValue([{ ...enabled, enabled: false }]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    await store.setEnabled("@demo/x", false);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(store.plugins[0]!.enabled).toBe(false);
  });

  it("starts the host half when the plugin has one", async () => {
    mocks.list.mockResolvedValue([{ ...enabled, hostFile: "/tmp/x/host.js" }]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    expect(mocks.startHost).toHaveBeenCalledWith("@demo/x");
  });

  it("stops the host half when the plugin is disabled", async () => {
    mocks.list.mockResolvedValue([enabled]);
    mocks.setEnabled.mockResolvedValue([{ ...enabled, enabled: false }]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    await store.setEnabled("@demo/x", false);
    expect(mocks.stopHost).toHaveBeenCalledWith("@demo/x");
  });

  it("disposes a plugin when it is removed", async () => {
    mocks.list.mockResolvedValue([enabled]);
    mocks.remove.mockResolvedValue([]);
    const store = usePluginHostStore();
    await store.refresh();
    await store.loadEnabled(async (entry) => ({ id: entry.id, apply() {} }));
    await store.remove("@demo/x");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(store.plugins).toHaveLength(0);
  });
});
