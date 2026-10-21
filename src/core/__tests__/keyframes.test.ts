import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import {
  keyframeExpression,
  keyframeValue,
  normalizeKeyframes,
  opacityAt,
  resolveTransformAt,
} from "@/core/keyframes";

describe("keyframes", () => {
  it("normalizes, clamps and dedupes frames", () => {
    const frames = normalizeKeyframes(
      [
        { time: 2, value: 0.4 },
        { time: -1, value: 2 },
        { time: 2, value: 0.6 },
        { time: 9, value: 0.2 },
      ],
      4,
      "opacity",
    );
    expect(frames).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 0.6 },
      { time: 4, value: 0.2 },
    ]);
  });

  it("interpolates linearly and holds endpoints", () => {
    const frames = [
      { time: 0, value: 0 },
      { time: 2, value: 1 },
      { time: 4, value: 0 },
    ];
    expect(keyframeValue(frames, -1, 9)).toBe(0);
    expect(keyframeValue(frames, 1, 9)).toBeCloseTo(0.5);
    expect(keyframeValue(frames, 3, 9)).toBeCloseTo(0.5);
    expect(keyframeValue(frames, 9, 9)).toBe(0);
    expect(keyframeValue(undefined, 1, 0.7)).toBe(0.7);
  });

  it("resolves transform and opacity at local time", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 4 });
    clip.keyframes = {
      x: [
        { time: 0, value: 0 },
        { time: 2, value: 50 },
      ],
      opacity: [
        { time: 0, value: 0 },
        { time: 2, value: 1 },
      ],
    };
    expect(resolveTransformAt(clip, 1).x).toBeCloseTo(25);
    expect(opacityAt(clip, 1)).toBeCloseTo(0.5);
  });

  it("builds ffmpeg expressions", () => {
    const expr = keyframeExpression(
      [
        { time: 0, value: 0 },
        { time: 2, value: 10 },
      ],
      "t",
    );
    expect(expr).toContain("if(lt(t,2)");
    expect(expr).toContain("(t-0)/2");
    expect(keyframeExpression([{ time: 0, value: 1 }], "T")).toBe("1");
  });
});
