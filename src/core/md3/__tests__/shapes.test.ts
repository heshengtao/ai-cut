import { describe, expect, it } from "vitest";
import {
  buildMorphPolygonPath,
  buildWavyProgressPaths,
  sampleMorphLoaderPath,
} from "../shapes";

describe("M3 Expressive SVG shape generators", () => {
  it("builds a closed quadratic-bezier morph polygon path", () => {
    const path = buildMorphPolygonPath(8, 20, 15.5, 0);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith(" Z")).toBe(true);
    expect(path).toContain(" Q ");
  });

  it("samples morph loader path across time without NaN", () => {
    for (const t of [0, 0.4, 1.15, 2.3, 4.6]) {
      const d = sampleMorphLoaderPath(t);
      expect(d).not.toContain("NaN");
      expect(d.endsWith(" Z")).toBe(true);
    }
  });

  it("clamps wavy progress paths cleanly at 0%, 50%, and 100%", () => {
    const zero = buildWavyProgressPaths({ width: 200, height: 14, progress: 0, phase: 0 });
    expect(zero.activePath).toBe("");
    expect(zero.inactivePath).toMatch(/^M /);

    const half = buildWavyProgressPaths({ width: 200, height: 14, progress: 0.5, phase: 1.2 });
    expect(half.activePath).toMatch(/^M /);
    expect(half.inactivePath).toMatch(/^M /);

    const full = buildWavyProgressPaths({ width: 200, height: 14, progress: 1, phase: 0 });
    expect(full.activePath).toMatch(/^M /);
    expect(full.inactivePath).toBe("");
  });
});
