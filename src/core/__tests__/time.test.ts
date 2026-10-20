import { describe, expect, it } from "vitest";
import { formatTimecode, frameToSec, secToFrame, snapToFrame } from "@/core/time";

describe("secToFrame / frameToSec", () => {
  it("converts both ways at integer fps", () => {
    expect(secToFrame(1, 30)).toBe(30);
    expect(frameToSec(45, 30)).toBeCloseTo(1.5);
  });
});

describe("snapToFrame", () => {
  it("snaps to the nearest frame boundary", () => {
    expect(snapToFrame(1.004, 30)).toBeCloseTo(1.0);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(1.033333, 5);
  });

  it("is stable on already-snapped input", () => {
    const once = snapToFrame(2.5, 30);
    expect(snapToFrame(once, 30)).toBe(once);
  });
});

describe("formatTimecode", () => {
  it("formats as HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(12 + 8 / 30, 30)).toBe("00:00:12:08");
    expect(formatTimecode(3661.5, 30)).toBe("01:01:01:15");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimecode(-5, 30)).toBe("00:00:00:00");
  });
});
