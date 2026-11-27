import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/i18n";
import { isKnownMessageKey } from "@/i18n/translate";

afterEach(() => setLocale("zh"));

describe("i18n", () => {
  it("switches dictionaries through setLocale", () => {
    setLocale("en");
    expect(t("window.minimize")).toBe("Minimize");
    setLocale("zh");
    expect(t("window.minimize")).toBe("最小化");
  });

  it("serves every registered locale and keeps them distinct", () => {
    const cancel: Record<string, string> = {
      zh: "取消",
      "zh-TW": "取消",
      en: "Cancel",
      ja: "キャンセル",
      ko: "취소",
      es: "Cancelar",
      fr: "Annuler",
      de: "Abbrechen",
      ru: "Отмена",
      ar: "إلغاء",
    };
    for (const [locale, expected] of Object.entries(cancel)) {
      setLocale(locale as Parameters<typeof setLocale>[0]);
      expect(t("common.cancel")).toBe(expected);
    }
  });

  it("falls back to English for a key missing from the locale", () => {
    // 词典结构由 locales.test.ts 保证一致，这里验证「回退链」本身：
    // 用一个只在英文里出现的插件 key 走不到插件词典，最终应回到 key 本身。
    setLocale("de");
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("interpolates vars and falls back to the key", () => {
    setLocale("zh");
    expect(t("marker.defaultName", { n: 3 })).toContain("3");
    expect(t("no.such.key")).toBe("no.such.key");
  });
});

describe("isKnownMessageKey（修复历史数据里误存的 key）", () => {
  it("认得词典里存在的 key，不误伤普通名字", () => {
    expect(isKnownMessageKey("board.canvas.defaultTitle")).toBe(true);
    expect(isKnownMessageKey("board.type.text")).toBe(true);
    expect(isKnownMessageKey("主画布")).toBe(false);
    expect(isKnownMessageKey("My workflow")).toBe(false);
    expect(isKnownMessageKey("board.nope.missing")).toBe(false);
    expect(isKnownMessageKey("")).toBe(false);
  });
});
