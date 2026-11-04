import { describe, expect, it } from "vitest";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import {
  capabilitySummary,
  effectiveCapabilities,
  providersForCapability,
  sourceIdFor,
  splitSourceId,
  supportsCapability,
} from "@/utils/cloudGen";

const presets: CloudGenPreset[] = [
  {
    kind: "openai",
    name: "OpenAI",
    group: "official",
    baseUrl: "https://api.openai.com/v1",
    imageModel: "gpt-image-1",
    editModel: "gpt-image-1",
    videoModel: "",
    capabilities: ["t2i", "i2i"],
  },
  {
    kind: "ark",
    name: "火山方舟",
    group: "official",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    imageModel: "doubao-seedream-4-0-250828",
    editModel: "doubao-seedream-4-0-250828",
    videoModel: "doubao-seedance-1-0-pro-250528",
    capabilities: ["t2i", "i2i", "t2v", "i2v"],
  },
];

function provider(patch: Partial<CloudGenProvider>): CloudGenProvider {
  return {
    id: "p1",
    name: "服务",
    kind: "openai",
    enabled: true,
    base_url: "",
    api_key: "",
    api_secret: "",
    group_id: "",
    image_model: "",
    edit_model: "",
    video_model: "",
    capabilities: [],
    ...patch,
  };
}

describe("cloudGen capability helpers", () => {
  it("falls back to the preset capabilities when none are stored", () => {
    expect(effectiveCapabilities(provider({ kind: "openai" }), presets)).toEqual([
      "t2i",
      "i2i",
    ]);
  });

  it("uses the explicit capabilities when the user toggled them", () => {
    const item = provider({ kind: "ark", capabilities: ["t2v"] });
    expect(effectiveCapabilities(item, presets)).toEqual(["t2v"]);
    expect(supportsCapability(item, "t2v", presets)).toBe(true);
    expect(supportsCapability(item, "t2i", presets)).toBe(false);
  });

  it("only lists enabled providers that support the requested capability", () => {
    const list = [
      provider({ id: "a", kind: "openai" }),
      provider({ id: "b", kind: "ark" }),
      provider({ id: "c", kind: "ark", enabled: false }),
    ];
    expect(providersForCapability(list, "t2v", presets).map((item) => item.id)).toEqual([
      "b",
    ]);
    expect(providersForCapability(list, "t2i", presets).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("cloudGen source ids", () => {
  it("round-trips local and cloud ids", () => {
    expect(splitSourceId(sourceIdFor("local", "z-image-turbo"))).toEqual({
      kind: "local",
      id: "z-image-turbo",
    });
    expect(splitSourceId(sourceIdFor("cloud", "svc-1"))).toEqual({
      kind: "cloud",
      id: "svc-1",
    });
  });

  it("rejects unknown or empty ids", () => {
    expect(splitSourceId(null)).toBeNull();
    expect(splitSourceId("")).toBeNull();
    expect(splitSourceId("cloud:")).toBeNull();
    expect(splitSourceId("z-image-turbo")).toBeNull();
  });
});

describe("capabilitySummary", () => {
  const labels = {
    t2i: "文生图",
    i2i: "图生图",
    t2v: "视频",
    i2v: "视频",
    video: "视频",
  } as const;

  it("summarizes image and video capabilities once", () => {
    expect(capabilitySummary(["t2i", "i2i", "t2v", "i2v"], labels)).toBe(
      "文生图 · 图生图 · 视频",
    );
    expect(capabilitySummary(["i2v"], labels)).toBe("视频");
    expect(capabilitySummary([], labels)).toBe("");
  });
});
