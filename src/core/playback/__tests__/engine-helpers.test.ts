import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import { gainToVolume, mediaTimeFor } from "@/core/playback/engine";

describe("mediaTimeFor", () => {
  it("maps timeline time to media time through the clip's in-point", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 10, duration: 4, in: 2 });
    expect(mediaTimeFor(clip, 10)).toBeCloseTo(2);
    expect(mediaTimeFor(clip, 12)).toBeCloseTo(4);
    expect(mediaTimeFor(clip, 13.5)).toBeCloseTo(5.5);
  });
});

describe("gainToVolume", () => {
  it("treats undefined gain as 0 dB", () => {
    expect(gainToVolume(undefined)).toBeCloseTo(1);
  });

  it("converts dB to linear and clamps to 0..4", () => {
    expect(gainToVolume(0)).toBeCloseTo(1);
    expect(gainToVolume(-6)).toBeCloseTo(0.5012, 3);
    expect(gainToVolume(-60)).toBeLessThan(0.01);
    expect(gainToVolume(12)).toBeCloseTo(3.9811, 3); // +12 dB ≈ 4x，Web Audio 可以放大
  });
});
