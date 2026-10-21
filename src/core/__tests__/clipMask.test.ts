import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import { clipMaskCss, normalizeClipMask } from "@/core/clipMask";

function clipWithMask(mask: Parameters<typeof normalizeClipMask>[0]) {
  const clip = createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 1 });
  clip.mask = normalizeClipMask(mask);
  return clip;
}

describe("clip mask", () => {
  it("normalizes out-of-range values", () => {
    const mask = normalizeClipMask({
      shape: "ellipse",
      x: -1,
      y: 2,
      width: 9,
      height: -1,
      feather: 9,
      angle: -30,
    });
    expect(mask.x).toBe(0);
    expect(mask.y).toBe(0.99);
    expect(mask.width).toBe(1);
    expect(mask.height).toBe(0.01);
    expect(mask.feather).toBe(0.5);
    expect(mask.angle).toBe(330);
  });

  it("uses inset for rectangles and ellipse clip-path", () => {
    expect(clipMaskCss(clipWithMask({ shape: "rect", x: 0.1, y: 0.2, width: 0.5, height: 0.4 })))
      .toMatchObject({ clipPath: "inset(20.00% 40.00% 40.00% 10.00%)" });
    expect(clipMaskCss(clipWithMask({ shape: "ellipse", x: 0, y: 0, width: 1, height: 1 })))
      .toMatchObject({ clipPath: "ellipse(50.00% 50.00% at 50.00% 50.00%)" });
  });

  it("builds a masked gradient for linear masks", () => {
    const css = clipMaskCss(
      clipWithMask({ shape: "linear", x: 0, y: 0, width: 1, height: 1, angle: 90, feather: 0.1 }),
    );
    expect(css?.maskImage).toContain("linear-gradient(90deg");
    expect(css?.maskSize).toBe("100.00% 100.00%");
  });
});
