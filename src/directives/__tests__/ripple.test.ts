import { describe, expect, it } from "vitest";
import { computeRippleGeometry, shouldSkipRipple } from "../ripple";

describe("Material Ripple geometry and guards", () => {
  it("computes corner-covering diameter from pointer origin", () => {
    const geom = computeRippleGeometry(
      { left: 100, top: 50, width: 120, height: 40 },
      110,
      70,
      false,
    );
    // Farthest corner is (120, 0) or (120, 40) from local (10, 20): hypot(110, 20)
    const expectedRadius = Math.hypot(110, 20);
    expect(geom.size).toBeCloseTo(expectedRadius * 2, 4);
    expect(geom.left).toBeCloseTo(10 - expectedRadius, 4);
    expect(geom.top).toBeCloseTo(20 - expectedRadius, 4);
  });

  it("centers ripple when centered mode is enabled", () => {
    const geom = computeRippleGeometry(
      { left: 0, top: 0, width: 40, height: 40 },
      2,
      2,
      true,
    );
    const expectedRadius = Math.hypot(20, 20);
    expect(geom.size).toBeCloseTo(expectedRadius * 2, 4);
    expect(geom.left).toBeCloseTo(20 - expectedRadius, 4);
    expect(geom.top).toBeCloseTo(20 - expectedRadius, 4);
  });

  it("skips ripple when disabled, aria-disabled, no-ripple, secondary button, or reduced motion", () => {
    const base = {
      disabled: false,
      ariaDisabled: false,
      noRipple: false,
      button: 0,
      reducedMotion: false,
    };
    expect(shouldSkipRipple(base)).toBe(false);
    expect(shouldSkipRipple({ ...base, disabled: true })).toBe(true);
    expect(shouldSkipRipple({ ...base, ariaDisabled: true })).toBe(true);
    expect(shouldSkipRipple({ ...base, noRipple: true })).toBe(true);
    expect(shouldSkipRipple({ ...base, button: 2 })).toBe(true);
    expect(shouldSkipRipple({ ...base, reducedMotion: true })).toBe(true);
  });
});
