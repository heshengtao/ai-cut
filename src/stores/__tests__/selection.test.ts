import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "@/stores/selection";
import { usePlaybackStore } from "@/stores/playback";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("selection", () => {
  it("replaces the selection by default", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("b");
    expect(s.selectedClipIds).toEqual(["b"]);
    expect(s.isSelected("a")).toBe(false);
    expect(s.isSelected("b")).toBe(true);
  });

  it("adds to the selection when additive", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("b", true);
    expect(s.selectedClipIds).toEqual(["a", "b"]);
  });

  it("does not duplicate an additive re-select", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("a", true);
    expect(s.selectedClipIds).toEqual(["a"]);
  });

  it("toggles membership", () => {
    const s = useSelectionStore();
    s.toggle("a");
    expect(s.selectedClipIds).toEqual(["a"]);
    s.toggle("a");
    expect(s.selectedClipIds).toEqual([]);
  });

  it("clears the selection", () => {
    const s = useSelectionStore();
    s.selectMany(["a", "b"]);
    s.clear();
    expect(s.selectedClipIds).toEqual([]);
  });
});

describe("playback", () => {
  it("clamps the playhead to >= 0", () => {
    const p = usePlaybackStore();
    p.setPlayhead(-3);
    expect(p.playhead).toBe(0);
    p.setPlayhead(12.5);
    expect(p.playhead).toBe(12.5);
  });

  it("clamps zoom into a sane range", () => {
    const p = usePlaybackStore();
    p.setZoom(0);
    expect(p.zoom).toBeGreaterThan(0);
    p.setZoom(1e6);
    expect(p.zoom).toBeLessThanOrEqual(400);
  });
});
