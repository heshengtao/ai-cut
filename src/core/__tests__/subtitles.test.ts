import { describe, expect, it } from "vitest";
import { mapCueToTimeline } from "@/core/subtitles";
import type { Clip } from "@/types/project";

function clip(patch: Partial<Clip>): Clip {
  return {
    id: "c1",
    assetId: "a1",
    trackId: "t1",
    start: 0,
    duration: 10,
    in: 0,
    ...patch,
  };
}

describe("mapCueToTimeline", () => {
  it("keeps asset time when there is no clip", () => {
    const mapped = mapCueToTimeline({ start: 1, end: 2, text: "hi" }, null, 30);
    expect(mapped).toMatchObject({ start: 1, duration: 1, text: "hi" });
  });

  it("offsets by the clip start and trims to the clip window", () => {
    const target = clip({ start: 5, in: 2, duration: 4 });
    const mapped = mapCueToTimeline({ start: 3, end: 4, text: "a" }, target, 30);
    expect(mapped).toMatchObject({ start: 6, duration: 1 });

    const outside = mapCueToTimeline({ start: 8, end: 9, text: "b" }, target, 30);
    expect(outside).toBeNull();
  });

  it("clamps cues that cross the clip boundary", () => {
    const target = clip({ start: 1, in: 5, duration: 2 });
    const mapped = mapCueToTimeline({ start: 4, end: 9, text: "a" }, target, 30);
    expect(mapped).not.toBeNull();
    expect(mapped!.start).toBeCloseTo(1, 3);
    expect(mapped!.duration).toBeCloseTo(2, 3);
  });

  it("drops sub-frame cues", () => {
    const mapped = mapCueToTimeline({ start: 1, end: 1.001, text: "a" }, null, 30);
    expect(mapped).toBeNull();
  });
});
