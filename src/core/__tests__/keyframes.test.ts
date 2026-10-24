import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import {
  keyframeExpression,
  keyframeValue,
  keyframeValuesAt,
  normalizeKeyframes,
  opacityAt,
  resolveTransformAt,
  upsertKeyframe,
} from "@/core/keyframes";

const BASE = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0 };

function clipFixture() {
  return createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 4 });
}

describe("keyframes", () => {
  it("normalizes, fills defaults, clamps and dedupes frames", () => {
    const frames = normalizeKeyframes(
      [
        { time: 2, opacity: 0.4, scale: 2 },
        { time: -1, opacity: 2 },
        { time: 2, opacity: 0.6 },
        { time: 9, opacity: 0.2 },
      ],
      4,
      BASE,
    );
    expect(frames).toEqual([
      { time: 0, opacity: 1, x: 0, y: 0, scale: 1, rotation: 0 },
      { time: 2, opacity: 0.6, x: 0, y: 0, scale: 1, rotation: 0 },
      { time: 4, opacity: 0.2, x: 0, y: 0, scale: 1, rotation: 0 },
    ]);
  });

  it("interpolates linearly and holds endpoints", () => {
    const frames = normalizeKeyframes(
      [
        { time: 0, opacity: 0 },
        { time: 2, opacity: 1 },
        { time: 4, opacity: 0 },
      ],
      4,
      BASE,
    );
    expect(keyframeValue(frames, "opacity", -1, 9)).toBe(0);
    expect(keyframeValue(frames, "opacity", 1, 9)).toBeCloseTo(0.5);
    expect(keyframeValue(frames, "opacity", 3, 9)).toBeCloseTo(0.5);
    expect(keyframeValue(frames, "opacity", 9, 9)).toBe(0);
    expect(keyframeValue(undefined, "opacity", 1, 0.7)).toBe(0.7);
  });

  it("resolves transform and opacity at local time", () => {
    const clip = clipFixture();
    clip.keyframes = normalizeKeyframes(
      [
        { time: 0, opacity: 0, x: 0 },
        { time: 2, opacity: 1, x: 50 },
      ],
      4,
      BASE,
    );
    expect(resolveTransformAt(clip, 1).x).toBeCloseTo(25);
    expect(opacityAt(clip, 1)).toBeCloseTo(0.5);
  });

  it("captures every animatable parameter in one keyframe", () => {
    const clip = clipFixture();
    clip.opacity = 0.8;
    clip.transform = { x: 10, y: -20, scale: 1.5, rotation: 30 };

    const frames = upsertKeyframe(clip, 1.5);
    expect(frames).toEqual([
      { time: 1.5, opacity: 0.8, x: 10, y: -20, scale: 1.5, rotation: 30 },
    ]);
    expect(keyframeValuesAt(clip, 1.5)).toEqual({
      opacity: 0.8,
      x: 10,
      y: -20,
      scale: 1.5,
      rotation: 30,
    });

    clip.keyframes = normalizeKeyframes(frames, 4, BASE);
    const patched = upsertKeyframe(clip, 1.5, { scale: 2 });
    expect(patched).toHaveLength(1);
    expect(patched[0]).toMatchObject({ time: 1.5, scale: 2, opacity: 0.8 });
  });

  it("builds ffmpeg expressions", () => {
    const frames = normalizeKeyframes(
      [
        { time: 0, x: 0 },
        { time: 2, x: 10 },
      ],
      2,
      BASE,
    );
    const expr = keyframeExpression(frames, "x", "t");
    expect(expr).toContain("if(lt(t,2)");
    expect(expr).toContain("(t-0)/2");
    expect(
      keyframeExpression(
        normalizeKeyframes([{ time: 0, opacity: 1 }], 2, BASE),
        "opacity",
        "T",
      ),
    ).toBe("1");
  });
});
