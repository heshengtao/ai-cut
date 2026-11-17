import { describe, expect, it } from "vitest";

import {
  findLlmProvider,
  inferProviderId,
  llmProvidersByGroup,
  normalizeBaseUrl,
  providerAllowsEmptyKey,
  providerLabel,
  providerNote,
} from "@/core/llmProviders";

describe("llmProviders", () => {
  it("每个分组都有预置，且 id 唯一", () => {
    const groups = llmProvidersByGroup();
    expect(groups.length).toBeGreaterThan(2);
    const ids = groups.flatMap((entry) => entry.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("非本地端点都需要 Key，本地端点留空可用", () => {
    expect(providerAllowsEmptyKey(findLlmProvider("openai"))).toBe(false);
    expect(providerAllowsEmptyKey(findLlmProvider("ollama"))).toBe(true);
    expect(providerAllowsEmptyKey(findLlmProvider("custom"))).toBe(false);
  });

  it("未命中的 id 回退到自定义端点", () => {
    expect(findLlmProvider("nope")?.id).toBe("custom");
    expect(findLlmProvider("")?.id).toBeUndefined();
  });

  it("按端点地址反推供应商（含 /v1 与路径后缀）", () => {
    expect(inferProviderId("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferProviderId("https://api.deepseek.com/v1/chat/completions")).toBe("deepseek");
    expect(inferProviderId("https://api.openai.com/v1/")).toBe("openai");
    expect(inferProviderId("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(inferProviderId("https://example.com/v1")).toBe("custom");
    expect(inferProviderId("")).toBe("custom");
  });

  it("归一化端点：去掉尾部斜杠与误粘的接口路径", () => {
    expect(normalizeBaseUrl(" https://api.openai.com/v1/ ")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("https://api.openai.com/v1/models")).toBe("https://api.openai.com/v1");
  });

  it("显示名与说明优先中文", () => {
    const preset = findLlmProvider("dashscope");
    expect(providerLabel(preset, "zh-CN")).toBe("阿里云百炼");
    expect(providerLabel(preset, "en")).toBe("Alibaba Bailian");
    expect(providerNote(findLlmProvider("perplexity"), "en")).toBe("");
  });
});
