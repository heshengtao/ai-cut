/**
 * 画布 / 工作流的动态文案守卫：
 * - `workflowProblems()` 抛出的每一个 messageKey 都必须在 zh / en 里存在；
 * - 画布标题这类「自动名」不能把语言写进文档，必须按当前语言渲染。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import zh from "@/i18n/zh";
import en from "@/i18n/en";

const ROOT = process.cwd();

function workflowProblemKeys(): string[] {
  const source = readFileSync(join(ROOT, "src/core/board/workflowNodes.ts"), "utf8");
  return [...new Set([...source.matchAll(/"board\.canvas\.problem\.[a-zA-Z]+"/g)].map((m) => m[0].slice(1, -1)))];
}

describe("工作流文案", () => {
  it("校验问题的 messageKey 两种语言都有", () => {
    const keys = workflowProblemKeys();
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const key of keys) {
      expect(zh[key as keyof typeof zh], `zh: ${key}`).toBeTruthy();
      expect(en[key as keyof typeof en], `en: ${key}`).toBeTruthy();
    }
  });

  it("签名行的序号文案两种语言都有", () => {
    for (const key of ["board.workflow.inIndex", "board.workflow.outIndex"]) {
      expect(zh[key as keyof typeof zh], `zh: ${key}`).toBeTruthy();
      expect(en[key as keyof typeof en], `en: ${key}`).toBeTruthy();
    }
  });
});
