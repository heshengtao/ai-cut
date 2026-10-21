import { describe, expect, it } from "vitest";
import { regionsLabel, sourceKindLabel } from "@/utils/modelSource";

const t = (key: string): string => key;

describe("regionsLabel", () => {
  it("distinguishes dual and single-region models", () => {
    expect(regionsLabel(t, ["cn", "intl"])).toBe("models.sources.both");
    expect(regionsLabel(t, ["cn"])).toBe("models.sources.cn");
    expect(regionsLabel(t, ["intl"])).toBe("models.sources.intl");
  });
});

describe("sourceKindLabel", () => {
  it("prefers the explicit kind and falls back to the URL", () => {
    expect(sourceKindLabel(t, "mirror", null)).toBe("models.source.mirror");
    expect(sourceKindLabel(t, null, "https://modelscope.cn/x")).toBe(
      "models.source.modelscope",
    );
    expect(sourceKindLabel(t, null, "https://huggingface.co/x")).toBe(
      "models.source.huggingface",
    );
    expect(sourceKindLabel(t, null, "https://github.com/x")).toBe("models.source.github");
  });
});
