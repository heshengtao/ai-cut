import { describe, expect, it } from "vitest";
import { registerPluginMessages, setTranslateLocale, t } from "../translate";

describe("plugin message dictionaries", () => {
  it("resolves a namespaced key from the plugin dictionary", () => {
    const dispose = registerPluginMessages("demo", { zh: { title: "示例" }, en: { title: "Demo" } });
    setTranslateLocale("zh");
    expect(t("@demo.title")).toBe("示例");
    setTranslateLocale("en");
    expect(t("@demo.title")).toBe("Demo");
    dispose();
    setTranslateLocale("zh");
  });

  it("falls back to the default locale inside the plugin dictionary", () => {
    const dispose = registerPluginMessages("demo2", { en: { only: "Only" } });
    setTranslateLocale("zh");
    expect(t("@demo2.only")).toBe("Only");
    dispose();
  });

  it("returns the key itself after dispose", () => {
    const dispose = registerPluginMessages("demo3", { zh: { gone: "没了" } });
    setTranslateLocale("zh");
    expect(t("@demo3.gone")).toBe("没了");
    dispose();
    expect(t("@demo3.gone")).toBe("@demo3.gone");
  });

  it("keeps kernel keys untouched", () => {
    setTranslateLocale("zh");
    expect(t("board.node.inputImage")).not.toBe("board.node.inputImage");
  });
});
