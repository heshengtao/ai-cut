import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUT_OPTIONS,
  addFilterWord,
  normalizeCutOptions,
  removeFilterWord,
  restoreFilterWords,
} from "@/core/cutOptions";

describe("normalizeCutOptions", () => {
  it("缺字段回落到默认值", () => {
    expect(normalizeCutOptions({})).toEqual(DEFAULT_CUT_OPTIONS);
  });

  it("数值夹到合法区间", () => {
    const options = normalizeCutOptions({ minPause: 99, keep: -1, trimPad: 5 });
    expect(options.minPause).toBe(3);
    expect(options.keep).toBe(0);
    expect(options.trimPad).toBe(0.5);
  });

  it("过滤词去空白、去重、丢掉非字符串", () => {
    const options = normalizeCutOptions({
      custom: [" 嗯 ", "嗯", 3 as never, ""],
      disabled: ["那个", "那个", null as never],
    });
    expect(options.custom).toEqual(["嗯"]);
    expect(options.disabled).toEqual(["那个"]);
  });

  it("坏 JSON 不会把开关重置成奇怪的值", () => {
    const options = normalizeCutOptions({ includeSoft: "no" as never, minPause: NaN });
    expect(options.includeSoft).toBe(true);
    expect(options.minPause).toBe(DEFAULT_CUT_OPTIONS.minPause);
  });
});

describe("过滤词编辑", () => {
  it("添加自定义词：去重、去空白", () => {
    const base = { ...DEFAULT_CUT_OPTIONS };
    expect(addFilterWord(base, "   ")).toBe(base);
    const added = addFilterWord(base, " 啊就 ");
    expect(added.custom).toEqual(["啊就"]);
    expect(addFilterWord(added, "啊就")).toBe(added);
  });

  it("重新添加被移除的默认词会恢复它，而不是变成自定义词", () => {
    const base = { ...DEFAULT_CUT_OPTIONS, disabled: ["那个"] };
    const restored = addFilterWord(base, " 那个 ");
    expect(restored.custom).toEqual([]);
    expect(restored.disabled).toEqual([]);
  });

  it("移除自定义词只删自定义，不移入默认禁用", () => {
    const base = { ...DEFAULT_CUT_OPTIONS, custom: ["啊就"] };
    const removed = removeFilterWord(base, "啊就");
    expect(removed.custom).toEqual([]);
    expect(removed.disabled).toEqual([]);
  });

  it("移除默认词会记进禁用列表，重复移除幂等", () => {
    const base = { ...DEFAULT_CUT_OPTIONS, disabled: [] };
    const once = removeFilterWord(base, "那个");
    expect(once.disabled).toEqual(["那个"]);
    expect(removeFilterWord(once, "那个")).toBe(once);
  });

  it("恢复默认过滤词会清空自定义与禁用", () => {
    const base = { ...DEFAULT_CUT_OPTIONS, custom: ["啊就"], disabled: ["那个"] };
    expect(restoreFilterWords(base)).toEqual({ ...base, custom: [], disabled: [] });
  });
});
