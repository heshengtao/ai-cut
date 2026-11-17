import { describe, expect, it } from "vitest";
import { parseManifest } from "../manifest";

const good = {
  format: 1,
  id: "@demo/x",
  version: "0.1.0",
  client: "./client.js",
  engines: { aicut: ">=1.3.0" },
};

describe("plugin manifest", () => {
  it("accepts a valid manifest", () => {
    expect(parseManifest(good).id).toBe("@demo/x");
  });

  it("rejects unsupported format", () => {
    expect(() => parseManifest({ ...good, format: 2 })).toThrow(/format/);
  });

  it("rejects missing id", () => {
    expect(() => parseManifest({ ...good, id: "" })).toThrow(/id/);
  });

  it("rejects a manifest with neither half", () => {
    const { client: _client, ...rest } = good;
    expect(() => parseManifest(rest)).toThrow(/client/);
  });

  it("defaults inject and external to empty arrays", () => {
    const parsed = parseManifest(good);
    expect(parsed.inject).toEqual([]);
    expect(parsed.external).toEqual([]);
  });
});
