import { describe, expect, it } from "vitest";
import {
  availableLanguages,
  languageLabel,
  languagesOf,
  matchesLanguage,
  MIN_FONTS,
  primaryLanguageLabel,
} from "@/core/fontLanguages";
import type { FontSourceSummary } from "@/core/fontsApi";

function font(id: string, subsets: string[], category = "sans-serif"): FontSourceSummary {
  return { id, family: id, subsets, weights: [400], styles: ["normal"], category };
}

function many(count: number, subsets: string[]): FontSourceSummary[] {
  return Array.from({ length: count }, (_, index) => font(`f${index}`, subsets));
}

describe("availableLanguages", () => {
  it("only offers languages with enough fonts", () => {
    const fonts = [...many(MIN_FONTS, ["latin"]), font("rare", ["tifinagh"])];
    const ids = availableLanguages(fonts).map((language) => language.id);
    expect(ids).toContain("latin");
    expect(ids).not.toContain("tifinagh");
  });

  it("adds subsets the code does not know about yet", () => {
    const fonts = many(MIN_FONTS, ["new-script"]);
    const ids = availableLanguages(fonts).map((language) => language.id);
    expect(ids).toContain("new-script");
    const extra = availableLanguages(fonts).find((language) => language.id === "new-script");
    expect(languageLabel(extra!)).toBe("new-script");
  });

  it("orders common scripts first", () => {
    const fonts = [...many(MIN_FONTS, ["latin"]), ...many(MIN_FONTS, ["arabic"])];
    const ids = availableLanguages(fonts).map((language) => language.id);
    expect(ids.indexOf("latin")).toBeLessThan(ids.indexOf("arabic"));
  });
});

describe("matchesLanguage", () => {
  const fonts = [
    font("a", ["latin", "latin-ext"]),
    font("b", ["chinese-simplified", "latin"]),
    font("c", ["arabic"]),
  ];
  const languages = availableLanguages(fonts);

  it("matches grouped subsets", () => {
    expect(matchesLanguage(fonts[0]!, "latin", languages)).toBe(true);
    expect(matchesLanguage(fonts[2]!, "latin", languages)).toBe(false);
  });

  it("matches a language that covers several subsets", () => {
    const zh = matchesLanguage(fonts[1]!, "chinese-simplified", languages);
    expect(zh).toBe(true);
    expect(matchesLanguage(fonts[0]!, "chinese-simplified", languages)).toBe(false);
  });

  it("treats unknown ids as raw subset ids", () => {
    expect(matchesLanguage(font("x", ["math"]), "math", languages)).toBe(true);
    expect(matchesLanguage(font("x", ["latin"]), "math", languages)).toBe(false);
  });

  it("does not filter with all", () => {
    expect(matchesLanguage(fonts[0]!, "all", languages)).toBe(true);
  });
});

describe("language labels", () => {
  it("lists every matched language of a font", () => {
    const ids = languagesOf(font("a", ["latin", "japanese"])).map((language) => language.id);
    expect(ids).toEqual(["latin", "japanese"]);
  });

  it("prefers a non-Latin label for row hints", () => {
    expect(primaryLanguageLabel(font("a", ["latin", "japanese"]))).toBe("日文");
    expect(primaryLanguageLabel(font("b", ["latin"]))).toBe("拉丁文字");
    expect(primaryLanguageLabel(font("c", []))).toBe("");
  });
});
