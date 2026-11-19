import { describe, expect, it } from "vitest";
import {
  MEDIA_MAX_HEIGHT,
  MEDIA_MIN_HEIGHT,
  mediaHeight,
  mediaNodeSize,
  sameMediaSize,
} from "@/core/board/mediaFit";

describe("mediaFit", () => {
  it("按素材原始比例算高度，宽度不变", () => {
    expect(mediaNodeSize(380, 1920, 1080)).toEqual({ width: 380, height: 214 });
    expect(mediaNodeSize(380, 1080, 1920)).toEqual({ width: 380, height: 676 });
    expect(mediaNodeSize(380, 1000, 1000)).toEqual({ width: 380, height: 380 });
  });

  it("高度夹在 140–1200 之间（超宽 / 超长的素材都不撑坏画布）", () => {
    expect(mediaHeight(380, 8000, 200)).toBe(MEDIA_MIN_HEIGHT);
    expect(mediaHeight(380, 200, 8000)).toBe(MEDIA_MAX_HEIGHT);
  });

  it("读不到素材尺寸时用兜底比例", () => {
    expect(mediaHeight(380)).toBe(Math.round(380 * 0.66));
    expect(mediaHeight(380, null, null)).toBe(Math.round(380 * 0.66));
    expect(mediaHeight(380, 0, 1080)).toBe(Math.round(380 * 0.66));
  });

  it("宽度是浮点 / 极小时取整并保底 1px", () => {
    expect(mediaNodeSize(379.6, 1000, 500).width).toBe(380);
    expect(mediaNodeSize(0, 1000, 500).width).toBe(1);
  });

  it("尺寸基本一致时不写回（±2px 容差）", () => {
    expect(sameMediaSize({ width: 380, height: 214 }, { width: 380, height: 214 })).toBe(true);
    expect(sameMediaSize({ width: 380, height: 214 }, { width: 381, height: 216 })).toBe(true);
    expect(sameMediaSize({ width: 380, height: 214 }, { width: 380, height: 300 })).toBe(false);
    expect(sameMediaSize(undefined, { width: 380, height: 214 })).toBe(false);
  });
});
