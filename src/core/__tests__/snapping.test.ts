import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import { snapEdge, snapMove, snapTargets } from "@/core/snapping";

function fixture() {
  const base = addTrack(newProject());
  const v = base.tracks[0].id;
  const anchor = createClip({ assetId: "a1", trackId: v, start: 10, duration: 4 }); // 边：10 / 14
  const moving = createClip({ assetId: "a2", trackId: v, start: 0, duration: 2 });
  let doc = addClip(base, v, anchor);
  doc = addClip(doc, v, moving);
  return { doc, anchor, moving, playhead: 20 };
}

describe("snapTargets", () => {
  it("collects zero, the playhead and every non-moving clip edge", () => {
    const { doc, moving, playhead } = fixture();
    const targets = snapTargets(doc, new Set([moving.id]), playhead);
    expect(targets).toContain(0);
    expect(targets).toContain(playhead);
    expect(targets).toContain(10);
    expect(targets).toContain(14);
    expect(targets).not.toContain(0 + 2); // 被拖动片段的终点不算候选
  });
});

describe("snapMove", () => {
  it("snaps the group's start onto a nearby clip edge", () => {
    const { doc, moving, playhead } = fixture();
    // 想移动到 9.9 → 距锚点起点 10 只有 0.1，阈值内应吸附
    const result = snapMove(doc, new Set([moving.id]), 9.9, 0.3, playhead);
    expect(result.delta).toBeCloseTo(10);
    expect(result.guide).toBe(10);
  });

  it("snaps the group's end onto a nearby edge", () => {
    const { doc, moving, playhead } = fixture();
    // 位移 8 → 片段变 [8,10)，终点正好贴锚点起点 10
    const result = snapMove(doc, new Set([moving.id]), 8.04, 0.3, playhead);
    expect(result.delta).toBeCloseTo(8);
  });

  it("leaves the delta untouched outside the threshold", () => {
    const { doc, moving, playhead } = fixture();
    const result = snapMove(doc, new Set([moving.id]), 5, 0.3, playhead);
    expect(result.delta).toBeCloseTo(5);
    expect(result.guide).toBeNull();
  });

  it("returns the raw delta when nothing is moving", () => {
    const { doc, playhead } = fixture();
    expect(snapMove(doc, new Set(), 3, 0.3, playhead)).toEqual({ delta: 3, guide: null });
  });
});

describe("snapEdge", () => {
  it("snaps a trim edge onto a neighbour's edge", () => {
    const { doc, moving, playhead } = fixture();
    const result = snapEdge(doc, moving.id, 9.95, 0.3, playhead);
    expect(result.time).toBeCloseTo(10);
    expect(result.guide).toBe(10);
  });

  it("excludes the clip being trimmed from the candidates", () => {
    const { doc, moving, playhead } = fixture();
    // 被裁剪片段自己的终点是 2，2 只来自它自己，因此不应被吸过去
    const result = snapEdge(doc, moving.id, 2.05, 0.3, playhead);
    expect(result.guide).not.toBe(2);
  });
});
