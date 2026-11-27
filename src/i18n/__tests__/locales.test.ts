import { describe, expect, it } from "vitest";
import ar from "../ar";
import de from "../de";
import en from "../en";
import es from "../es";
import fr from "../fr";
import ja from "../ja";
import ko from "../ko";
import { LOCALES, localeInfo } from "../translate";
import ru from "../ru";
import zh from "../zh";
import zhTW from "../zh-TW";

/**
 * 词典一致性：任何一门语言缺词条 / 多词条 / 占位符对不上，都会在 `pnpm test` 里炸。
 *
 * 这一层只管「结构对得上」，不判断译文好坏；译文由 `pnpm i18n:check` 报告缺口、
 * 由 `scripts/i18n.mjs` 的翻译流程写入。
 */
const DICTS: Record<string, Record<string, string>> = {
  zh,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
  es,
  fr,
  de,
  ru,
  ar,
};

const SOURCE = en;
const keys = Object.keys(SOURCE);

/** 文案里的 `{name}` 占位（顺序无关）。 */
function placeholders(value: string): string {
  return [...value.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
}

describe("locale registry", () => {
  it("registers every supported locale exactly once", () => {
    const ids = LOCALES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(DICTS).sort());
  });

  it("has a dictionary for every locale and no stray one", () => {
    for (const locale of LOCALES) expect(DICTS[locale.id]).toBeTruthy();
  });

  it("marks Arabic as right-to-left and the rest left-to-right", () => {
    expect(localeInfo("ar").dir).toBe("rtl");
    for (const locale of LOCALES) {
      if (locale.id !== "ar") expect(localeInfo(locale.id).dir).toBe("ltr");
    }
  });

  it("gives every locale a native label and a README file", () => {
    for (const locale of LOCALES) {
      expect(locale.label.trim().length).toBeGreaterThan(0);
      expect(locale.english.trim().length).toBeGreaterThan(0);
      expect(locale.readme).toMatch(/^README.*\.md$/);
    }
  });
});

describe.each(Object.entries(DICTS))("%s dictionary", (locale, dict) => {
  it("mirrors the English key set, in the same order", () => {
    expect(Object.keys(dict)).toEqual(keys);
  });

  it("has no empty or key-shaped value", () => {
    const bad = keys.filter((key) => !dict[key]?.trim() || dict[key] === key);
    expect(bad).toEqual([]);
  });

  it("keeps the same {placeholders} as the source", () => {
    const bad = keys.filter(
      (key) => placeholders(dict[key] ?? "") !== placeholders(SOURCE[key]),
    );
    expect(bad).toEqual([]);
  });

  it(`is actually localized (${locale} differs from English for prose)`, () => {
    // 英文词典就是源语言，不需要跟自己比。
    if (locale === "en") return;
    // 允许专有名词 / 缩写 / 符号原样保留；只要求大多数普通文案确实被翻译。
    const prose = keys.filter((key) => {
      const value = SOURCE[key];
      return value.trim().length > 3 && /[a-z]{3}/i.test(value) && !/^[A-Z0-9 .+&-]+$/.test(value);
    });
    const translated = prose.filter((key) => dict[key] !== SOURCE[key]);
    expect(translated.length / prose.length).toBeGreaterThan(0.9);
  });
});
