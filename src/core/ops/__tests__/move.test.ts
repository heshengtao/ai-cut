import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import type { Clip } from "@/types/project";
import { addClip, moveClips } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

function clip(start: number, duration: number, trackId: string, assetId = "a1"): Clip {
  return createClip({ assetId, trackId, start, duration });
}

function fixture() {
  const base = addTrack(addTrack(newProject()));
  const v = base.tracks[0].id;
  const a = base.tracks[1].id;
  const left = clip(0, 2, v, "a1"); // [0,2)
  const mid = clip(3, 2, v, "a2"); // [3,5)
  const right = clip(6, 2, v, "a3"); // [6,8)
  let doc = addClip(base, v, left);
  doc = addClip(doc, v, mid);
  doc = addClip(doc, v, right);
  return { doc, v, a, left, mid, right };
}

function starts(doc: ReturnType<typeof newProject>, trackId: string): number[] {
  const track = doc.tracks.find((t) => t.id === trackId)!;
  return track.clips.map((c) => c.start);
}

describe("moveClips", () => {
  it("translates a clip within its track", () => {
    const { doc, v, mid } = fixture();
    const next = moveClips(doc, [mid.id], 1);
    expect(starts(next, v)).toEqual([0, 4, 6]);
  });

  it("clamps at zero", () => {
    const { doc, v, mid } = fixture();
    const next = moveClips(doc, [mid.id], -99);
    // 无法左移到负时间；会被左邻片段顶住
    expect(starts(next, v)[1]).toBeGreaterThanOrEqual(2);
  });

  it("pushes the dragged clip back against the blocking neighbour", () => {
    const { doc, v, left } = fixture();
    // 把 [0,2) 右移 2.5 → 落点 [2.5,4.5) 与 mid [3,5) 重叠。
    // 左顶到 mid 左缘：start = 3-2 = 1（位移 1.5）；右顶到 mid 右缘：start = 5（位移 2.5）。
    // 取更近的一侧 → start = 1，即最终 [1,3)，停在阻挡片段前。
    const next = moveClips(doc, [left.id], 2.5);
    expect(starts(next, v)).toEqual([1, 3, 6]);
  });

  it("pushes to the left edge when that is closer", () => {
    const { doc, v, right } = fixture();
    // 把 [6,8) 左移 1.5 → [4.5,6.5) 与 [3,5) 重叠；左顶到 5 只需 0.5，右顶到 3 需 1.5
    const next = moveClips(doc, [right.id], -1.5);
    expect(starts(next, v)).toContain(5);
  });

  it("moves clips to another track and stamps trackId", () => {
    const { doc, v, a, mid } = fixture();
    const next = moveClips(doc, [mid.id], 0, a);
    expect(next.tracks.find((t) => t.id === v)!.clips).toHaveLength(2);
    const audioClips = next.tracks.find((t) => t.id === a)!.clips;
    expect(audioClips).toHaveLength(1);
    expect(audioClips[0].trackId).toBe(a);
    expect(audioClips[0].start).toBe(3);
  });

  it("returns the same reference for a zero move with no track change", () => {
    const { doc, mid } = fixture();
    expect(moveClips(doc, [mid.id], 0)).toBe(doc);
  });

  it("returns the same reference for an unknown track id", () => {
    const { doc, mid } = fixture();
    expect(moveClips(doc, [mid.id], 1, "missing")).toBe(doc);
  });

  it("keeps relative offsets when moving a multi-selection", () => {
    const { doc, v, mid, right } = fixture();
    const next = moveClips(doc, [mid.id, right.id], 1);
    const byId = new Map(next.tracks.find((t) => t.id === v)!.clips.map((c) => [c.id, c.start]));
    expect(byId.get(mid.id)! - byId.get(right.id)!).toBe(-3);
  });
});
