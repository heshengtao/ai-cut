import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import {
  clipColorCss,
  clipColorFilters,
  normalizeClipColor,
} from "@/core/clipColor";

describe("clip color", () => {
  it("normalizes defaults and clamps ranges", () => {
    expect(normalizeClipColor(undefined)).toEqual({
      brightness: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
    });
    expect(normalizeClipColor({ brightness: 9, contrast: -1, saturation: 9 })).toMatchObject({
      brightness: 1,
      contrast: 0,
      saturation: 3,
    });
  });

  it("returns no CSS filter for default values", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 1 });
    expect(clipColorCss(clip)).toBeUndefined();
    expect(clipColorFilters(clip)).toEqual([]);
  });

  it("builds preview CSS and export filters", () => {
    const clip = createClip({
      assetId: "a1",
      trackId: "t1",
      start: 0,
      duration: 1,
    });
    clip.color = { brightness: 0.2, contrast: 1.1, saturation: 0.8, temperature: 0.5, tint: -0.2 };

    const css = clipColorCss(clip);
    expect(css).toContain("brightness(1.200)");
    expect(css).toContain("contrast(1.100)");
    expect(css).toContain("saturate(0.800)");

    const filters = clipColorFilters(clip);
    expect(filters[0]).toContain("eq=brightness=0.2000:contrast=1.1000:saturation=0.8000");
    expect(filters[1]).toContain("colorbalance=");
  });
});
