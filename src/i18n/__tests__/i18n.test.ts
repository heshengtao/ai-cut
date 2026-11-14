import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/i18n";

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
