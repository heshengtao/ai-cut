import { describe, expect, it } from "vitest";
import {
  ASR_SETTINGS_ACTION,
  buildAsrOptions,
  parseAsrModelId,
} from "@/core/asrSources";

describe("parseAsrModelId", () => {
  it("recognizes the settings action", () => {
    expect(parseAsrModelId(ASR_SETTINGS_ACTION)).toEqual({ kind: "action" });
  });

  it("splits the cloud prefix", () => {
    expect(parseAsrModelId("cloud:abc")).toEqual({ kind: "cloud", id: "abc" });
  });

  it("keeps local model ids", () => {
    expect(parseAsrModelId("sherpa-paraformer")).toEqual({
      kind: "local",
      id: "sherpa-paraformer",
    });
  });

  it("ignores empty ids", () => {
    expect(parseAsrModelId(null)).toBeNull();
    expect(parseAsrModelId("")).toBeNull();
  });
});

describe("buildAsrOptions", () => {
  it("puts the settings action first", () => {
    const rows = [
      { id: "a", label: "本地 A", group: "本地模型" },
      { id: "cloud:b", label: "云端 B", group: "云端识别" },
    ];
    const options = buildAsrOptions(rows, { label: "配置…", hint: "添加云 API" });
    expect(options[0]).toMatchObject({ id: ASR_SETTINGS_ACTION, action: true });
    expect(options[0]?.label).toBe("配置…");
    expect(options.map((option) => option.id)).toEqual([
      ASR_SETTINGS_ACTION,
      "a",
      "cloud:b",
    ]);
  });
});
