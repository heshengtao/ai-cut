import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_DATA_TYPES,
  channelsCompatible,
  dataTypeSpec,
  inlineDataTypeSpecs,
  isDataTypeId,
  listDataTypes,
  portsConnectable,
  registerDataType,
  resetDataTypes,
  typesCompatible,
} from "@/core/board/dataTypes";

describe("data types registry", () => {
  beforeEach(() => {
    resetDataTypes();
  });

  it("内置类型齐全，且 any 能接一切", () => {
    expect(CORE_DATA_TYPES.map((spec) => spec.id)).toContain("number");
    expect(CORE_DATA_TYPES.map((spec) => spec.id)).toContain("integer");
    expect(CORE_DATA_TYPES.map((spec) => spec.id)).toContain("json");
    expect(typesCompatible("any", "number")).toBe(true);
    expect(typesCompatible("number", "any")).toBe(true);
    expect(typesCompatible("number", "text")).toBe(false);
    expect(portsConnectable("image", "text")).toBe(false);
  });

  it("整数与浮点互相兼容，但仍是两个类型", () => {
    expect(typesCompatible("integer", "number")).toBe(true);
    expect(typesCompatible("number", "integer")).toBe(true);
    expect(portsConnectable("integer", "number")).toBe(true);
    expect(inlineDataTypeSpecs().map((spec) => spec.id)).toEqual(
      expect.arrayContaining(["integer", "number"]),
    );
  });

  it("通道决定「怎么搬」：文本可 inline 也可 blob，图片不吃 inline", () => {
    expect(channelsCompatible("text", "text")).toBe(true);
    // image 走 blob/stream，number 只要 inline：通道不通。
    expect(channelsCompatible("image", "number")).toBe(false);
    expect(channelsCompatible("image", "text")).toBe(true);
    expect(channelsCompatible("json", "text")).toBe(true);
  });

  it("插件可以注册新类型，并能出现在 inline 下拉里", () => {
    const dispose = registerDataType("@demo/plugin", {
      id: "embedding",
      label: "Embedding",
      channels: ["inline"],
      inline: "json",
      color: "#123456",
    });
    expect(listDataTypes().map((spec) => spec.id)).toContain("embedding");
    expect(inlineDataTypeSpecs().map((spec) => spec.id)).toContain("embedding");
    expect(dataTypeSpec("embedding").color).toBe("#123456");
    expect(dataTypeSpec("embedding").pluginId).toBe("@demo/plugin");
    dispose();
    expect(listDataTypes().map((spec) => spec.id)).not.toContain("embedding");
  });

  it("重复注册 / 覆盖内置类型会报错并指出占用者", () => {
    expect(() =>
      registerDataType("@demo/plugin", {
        id: "text",
        label: "Text",
        channels: ["inline"],
      }),
    ).toThrow(/内置类型/);
    registerDataType("@demo/plugin", { id: "custom", label: "C", channels: ["inline"] });
    expect(() =>
      registerDataType("@other/plugin", { id: "custom", label: "C", channels: ["inline"] }),
    ).toThrow(/@demo\/plugin/);
  });

  it("accepts 双向生效；未知类型兜底成能接能搬", () => {
    registerDataType("@demo/plugin", {
      id: "prompt",
      label: "Prompt",
      channels: ["inline"],
      accepts: ["text"],
    });
    expect(typesCompatible("prompt", "text")).toBe(true);
    expect(typesCompatible("text", "prompt")).toBe(true);
    expect(dataTypeSpec("ghost.type").channels).toEqual(["inline", "blob"]);
    expect(typesCompatible("ghost.type", "ghost.type")).toBe(true);
  });

  it("类型 id 必须是字母开头的短标识", () => {
    expect(isDataTypeId("number")).toBe(true);
    expect(isDataTypeId("ext.demo.seg")).toBe(true);
    expect(isDataTypeId("1abc")).toBe(false);
    expect(isDataTypeId("")).toBe(false);
    expect(isDataTypeId("x".repeat(60))).toBe(false);
    expect(isDataTypeId(42)).toBe(false);
  });
});
