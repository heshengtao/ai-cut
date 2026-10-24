import { describe, expect, it } from "vitest";
import { changedSamples, parseSsimStats } from "@/core/export/ssim";
import { buildContactLayout } from "@/core/export/contactSheet";

const STATS = [
  "n:1 Y:0.990000 U:0.995000 V:0.995000 All:0.991000 (20.1)",
  "n:2 Y:0.900000 U:0.990000 V:0.990000 All:0.920000 (15.0)",
  "n:3 Y:0.999000 U:0.999000 V:0.999000 All:0.999000 (30.0)",
].join("\n");

describe("parseSsimStats", () => {
  it("parses All scores and maps frame numbers to timeline time", () => {
    const summary = parseSsimStats(STATS, 30, 10);
    expect(summary.samples).toBe(3);
    expect(summary.mean).toBeCloseTo((0.991 + 0.92 + 0.999) / 3, 6);
    expect(summary.min).toBe(0.92);
    expect(summary.frames[0]).toMatchObject({ frame: 1, time: 10, score: 0.991 });
    expect(summary.frames[1].time).toBeCloseTo(10 + 1 / 30, 6);
  });

  it("falls back to the Y channel and tolerates empty input", () => {
    expect(parseSsimStats("n:1 Y:0.5", 30).min).toBe(0.5);
    expect(parseSsimStats("", 30)).toMatchObject({ mean: 1, min: 1, samples: 0 });
  });
});

describe("changedSamples", () => {
  it("returns only frames below the threshold", () => {
    const summary = parseSsimStats(STATS, 30, 0);
    expect(changedSamples(summary, 0.98)).toEqual([
      { time: 1 / 30, score: 0.92 },
    ]);
  });
});

describe("buildContactLayout", () => {
  it("pads the last row and emits fixed xstack positions", () => {
    const layout = buildContactLayout(5, 3, 100, 50);
    expect(layout).toEqual({
      cols: 3,
      rows: 2,
      layout: "0_0|100_0|200_0|0_50|100_50|200_50",
    });
  });

  it("caps columns to the number of frames", () => {
    expect(buildContactLayout(2, 6, 100, 50)).toMatchObject({ cols: 2, rows: 1 });
  });
});
