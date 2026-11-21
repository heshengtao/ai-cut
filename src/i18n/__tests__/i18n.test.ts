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
