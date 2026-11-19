import { describe, expect, it } from "vitest";
import { dispatchAdapter, registerAdapter } from "../adapters";

describe("adapter dispatch order", () => {
  it("routes a registered plugin type to the table", () => {
    registerAdapter("ext.demo.routed", async () => ({}));
    expect(dispatchAdapter("ext.demo.routed")).toBe("plugin");
  });

  it("routes a known builtin type to the legacy branch", () => {
    expect(dispatchAdapter("model.video")).toBe("builtin");
  });

  it("reports an unknown type as unknown", () => {
    expect(dispatchAdapter("ext.never.registered")).toBe("unknown");
  });
});
