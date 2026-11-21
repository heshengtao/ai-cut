/**
 * 画布 UI 文案：数据类型 / 发布标签必须翻译，插件类型回落到注册表 label。
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/i18n";
import { useBoardLabels } from "@/composables/useBoardLabels";
import { registerDataType, resetDataTypes } from "@/core/board/dataTypes";

const { typeLabel, tagLabel, canvasTitle } = useBoardLabels();

afterEach(() => {
  setLocale("en");
  resetDataTypes();
});

describe("画布文案", () => {
  it("内置数据类型有中文名，不把 board.type.* key 漏出来", () => {
    setLocale("zh");
    expect(typeLabel("text")).toBe("文本");
    expect(typeLabel("image")).toBe("图片");
    expect(typeLabel("integer")).toBe("整数");
    expect(typeLabel("json")).toBe("JSON");
    expect(typeLabel("any")).toBe("任意");
  });

  it("插件注册的类型没有翻译时回落到注册表 label", () => {
    setLocale("zh");
    const dispose = registerDataType("ext.demo", {
      id: "ext.demo.frame",
      label: "Frame",
      channels: ["inline"],
    });
    expect(typeLabel("ext.demo.frame")).toBe("Frame");
    dispose();
    // 卸载插件后工程里残留的未知类型不崩，也不显示 i18n key。
    expect(typeLabel("ext.demo.frame")).toBe("ext.demo.frame");
    expect(typeLabel("ext.demo.frame")).not.toContain("board.type.");
  });

  it("画布自动名跟着语言走，显式名字原样显示", () => {
    setLocale("zh");
    expect(canvasTitle({ title: "" }, 0)).toBe("画布 1");
    expect(canvasTitle({}, 1)).toBe("画布 2");
    expect(canvasTitle({ title: "主画布" }, 0)).toBe("主画布");
    // 历史数据里误存的 key 不能原样显示
    expect(canvasTitle({ title: "board.canvas.defaultTitle" }, 0)).toBe("画布 1");

    setLocale("en");
    expect(canvasTitle({ title: "" }, 0)).toBe("Canvas 1");
  });

  it("发布标签走库里的徽章文案，未知标签原样显示", () => {
    setLocale("zh");
    expect(tagLabel("workflow")).toBe("工作流");
    expect(tagLabel("subworkflow")).toBe("子工作流");
    expect(tagLabel("api")).toBe("API");
    expect(tagLabel("custom-tag")).toBe("custom-tag");

    setLocale("en");
    expect(tagLabel("subworkflow")).toBe("Sub-workflow");
    expect(tagLabel("api")).toBe("API");
  });
});
