import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip, splitClips } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

function fixture() {
  const base = addTrack(newProject());
  const v = base.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId: v, start: 1, duration: 4, in: 0.5 });
  const doc = addClip(base, v, clip);
  return { doc, v, clipId: clip.id };
}

describe("splitClips", () => {
  it("splits into two contiguous halves that preserve the source range", () => {
    const { doc, v, clipId } = fixture();
    const next = splitClips(doc, [clipId], 3);
    const clips = next.tracks.find((t) => t.id === v)!.clips;
    expect(clips).toHaveLength(2);

    const [left, right] = clips;
    expect(left.start).toBeCloseTo(1);
    expect(left.duration).toBeCloseTo(2);
    expect(left.in).toBeCloseTo(0.5);
    expect(right.start).toBeCloseTo(3);
    expect(right.duration).toBeCloseTo(2);
    expect(right.in).toBeCloseTo(2.5);
    expect(right.id).not.toBe(left.id);
  });

  it("snaps the split point to the frame grid", () => {
    const { doc, clipId } = fixture();
    const next = splitClips(doc, [clipId], 3.02); // 30fps → 吸附到 3.0333…
    const clips = next.tracks[0].clips;
    expect(clips[0].start + clips[0].duration).toBeCloseTo(3.033333, 5);
    expect(clips[1].start).toBeCloseTo(3.033333, 5);
  });

  it("ignores a split point on or outside the clip boundary", () => {
    const { doc, v, clipId } = fixture();
    expect(splitClips(doc, [clipId], 1)).toBe(doc); // 恰在起点
    expect(splitClips(doc, [clipId], 5)).toBe(doc); // 恰在终点
    expect(splitClips(doc, [clipId], 0)).toBe(doc); // 片段之外
    const after = splitClips(doc, [clipId], 3);
    expect(after.tracks.find((t) => t.id === v)!.clips).toHaveLength(2);
  });

  it("only splits the listed clips", () => {
    const { doc, v, clipId } = fixture();
    const other = createClip({ assetId: "a2", trackId: v, start: 10, duration: 4 });
    const withOther = addClip(doc, v, other);
    const next = splitClips(withOther, [clipId], 3);
    const clips = next.tracks.find((t) => t.id === v)!.clips;
    expect(clips.filter((c) => c.assetId === "a2")).toHaveLength(1);
    expect(clips.filter((c) => c.assetId === "a1")).toHaveLength(2);
  });

  it("returns the same reference for an unknown clip id", () => {
    const { doc } = fixture();
    expect(splitClips(doc, ["nope"], 3)).toBe(doc);
  });
});
