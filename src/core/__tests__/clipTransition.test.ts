import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import {
  clipFadeFilters,
  normalizeClipTransition,
  transitionState,
} from "@/core/clipTransition";

describe("clip transition", () => {
  it("normalizes duration and slide direction", () => {
    expect(normalizeClipTransition({ type: "fade", duration: 99 }, 4)).toEqual({
      type: "fade",
      duration: 4,
    });
    expect(normalizeClipTransition({ type: "slide", duration: 1 }, 4)).toEqual({
      type: "slide",
      duration: 1,
      direction: "left",
    });
    expect(normalizeClipTransition({ type: "fade", duration: 0 }, 4)).toBeNull();
    expect(normalizeClipTransition(null, 4)).toBeNull();
  });

  it("computes fade and slide states from local time", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 4 });
    clip.transitionIn = { type: "fade", duration: 1 };
    clip.transitionOut = { type: "fade", duration: 2 };

    expect(transitionState(clip, 0).opacity).toBe(0);
    expect(transitionState(clip, 0.5).opacity).toBeCloseTo(0.5);
    expect(transitionState(clip, 2).opacity).toBe(1);
    expect(transitionState(clip, 3).opacity).toBeCloseTo(0.5);

    clip.transitionIn = { type: "slide", duration: 1, direction: "left" };
    expect(transitionState(clip, 0).offsetX).toBeLessThan(0);
    expect(transitionState(clip, 1).offsetX).toBe(0);
  });

  it("builds ffmpeg alpha fades", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 0, duration: 4 });
    clip.transitionIn = { type: "fade", duration: 0.5 };
    clip.transitionOut = { type: "fade", duration: 1 };
    expect(clipFadeFilters(clip)).toEqual([
      "fade=t=in:st=0:d=0.5:alpha=1",
      "fade=t=out:st=3:d=1:alpha=1",
    ]);
  });
});
