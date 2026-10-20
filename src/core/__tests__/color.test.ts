import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex, rgbToHex } from "@/core/color";

describe("color conversion", () => {
  it("normalizes short and long hex values", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("FF8000")).toBe("#ff8000");
    expect(normalizeHex("not-a-color")).toBeNull();
  });

  it("round-trips hex → HSV → hex", () => {
    for (const hex of ["#000000", "#ffffff", "#6750a4", "#b3261e", "#386a20"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("formats RGB with clamped channels", () => {
    expect(rgbToHex(300, -20, 128)).toBe("#ff0080");
  });
});
