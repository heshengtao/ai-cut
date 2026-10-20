import { describe, expect, it } from "vitest";
import { peakBetween } from "@/core/waveform";

describe("peakBetween", () => {
  it("samples the bucket range that covers the requested window", () => {
    const peaks = [0, 20, 80, 40, 100, 10];
    expect(peakBetween(peaks, 6, 0, 1)).toBe(0);
    expect(peakBetween(peaks, 6, 1, 2)).toBe(20);
    expect(peakBetween(peaks, 6, 2, 3)).toBe(80);
    expect(peakBetween(peaks, 6, 0, 6)).toBe(100);
  });

  it("clamps the window to the source duration", () => {
    expect(peakBetween([10, 90], 2, -5, 1)).toBe(10);
    expect(peakBetween([10, 90], 2, 1, 99)).toBe(90);
  });

  it("returns zero for empty or invalid input", () => {
    expect(peakBetween([], 10, 0, 1)).toBe(0);
    expect(peakBetween([10], 0, 0, 1)).toBe(0);
    expect(peakBetween([10], 1, 1, 1)).toBe(0);
  });
});
