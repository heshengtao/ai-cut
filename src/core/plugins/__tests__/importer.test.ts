import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/tauri", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));
vi.mock("@/platform/env", () => ({
  apiBase: () => "/api/",
  isWebRuntime: () => true,
}));

import { pluginModuleUrl } from "../importer";

describe("plugin module url", () => {
  it("uses the asset protocol on desktop", () => {
    expect(
      pluginModuleUrl("/tmp/x/client.js", "@demo/x", "0.1.0-1", { desktop: true }),
    ).toBe("asset://localhost/%2Ftmp%2Fx%2Fclient.js");
  });

  it("uses the daemon route in the browser with rev and encoded id", () => {
    expect(
      pluginModuleUrl("/tmp/x/client.js", "@demo/x", "0.1.0-1", {
        desktop: false,
        base: "/api/",
      }),
    ).toBe("/api/plugins/%40demo%2Fx/client.js?rev=0.1.0-1");
  });

  it("falls back to the platform base when none is given", () => {
    expect(pluginModuleUrl("/tmp/x/client.js", "@demo/x", "2", { desktop: false })).toBe(
      "/api/plugins/%40demo%2Fx/client.js?rev=2",
    );
  });
});
