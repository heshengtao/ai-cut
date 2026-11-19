import { describe, expect, it } from "vitest";
import { parseValueParam } from "@/composables/useBoardRun";

describe("value node parsing", () => {
  it("整数取整，浮点保留小数", () => {
    expect(parseValueParam("integer", "7")).toBe(7);
    expect(parseValueParam("integer", 7.8)).toBe(7);
    expect(parseValueParam("number", "7.25")).toBe(7.25);
    expect(parseValueParam("integer", "bad")).toBe(0);
  });

  it("布尔与 JSON 按各自的宽松规则解析", () => {
    expect(parseValueParam("boolean", "true")).toBe(true);
    expect(parseValueParam("boolean", 1)).toBe(true);
    expect(parseValueParam("boolean", "false")).toBe(false);
    expect(parseValueParam("json", '{"a":1}')).toEqual({ a: 1 });
    expect(parseValueParam("json", "{bad")).toBe("{bad");
  });
});
