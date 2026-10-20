import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addClip, trimClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

/** 一个 10 秒素材、单个片段 [2,6)（即 in=1, duration=4）。 */
function fixture(withNeighbours = false) {
  const base = addTrack(newProject());
  const v = base.tracks[0].id;
  const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 10 });
  const target = createClip({ assetId: asset.id, trackId: v, start: 2, duration: 4, in: 1 });
  let doc = addAsset(base, asset);
  doc = addClip(doc, v, target);
  if (withNeighbours) {
    doc = addClip(doc, v, createClip({ assetId: asset.id, trackId: v, start: 0, duration: 2, in: 0 }));
    doc = addClip(doc, v, createClip({ assetId: asset.id, trackId: v, start: 6, duration: 2, in: 0 }));
  }
  return { doc, v, target: target.id, assetId: asset.id };
}

function clipById(doc: ReturnType<typeof newProject>, id: string) {
  for (const t of doc.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error("clip not found");
}

describe("trimClip — start edge", () => {
  it("moves the start later, shortening duration and advancing in-point", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 3);
    const c = clipById(next, target);
    expect(c.start).toBeCloseTo(3);
    expect(c.duration).toBeCloseTo(3);
    expect(c.in).toBeCloseTo(2);
  });

  it("moves the start earlier, limited by the in-point (in >= 0)", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 0.5);
    const c = clipById(next, target);
    expect(c.in).toBeGreaterThanOrEqual(0);
    expect(c.start).toBeCloseTo(1); // 最多回退 in=1 秒
    expect(c.duration).toBeCloseTo(5);
  });

  it("refuses to swallow the previous neighbour", () => {
    const { doc, target } = fixture(true);
    const next = trimClip(doc, target, "start", 0);
    const c = clipById(next, target);
    expect(c.start).toBeGreaterThanOrEqual(2); // 左邻 [0,2) 挡住
    expect(c.start).toBeCloseTo(2);
  });

  it("never shrinks below one frame", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 999);
    const c = clipById(next, target);
    expect(c.duration).toBeCloseTo(1 / 30, 6);
  });

  it("cannot extend a full-length source clip beyond its media", () => {
    const base = addTrack(newProject());
    const v = base.tracks[0].id;
    const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 10 });
    const clip = createClip({ assetId: asset.id, trackId: v, start: 0, duration: 10, in: 0 });
    let doc = addAsset(base, asset);
    doc = addClip(doc, v, clip);
    // 左右都到头了：裁剪不应改变任何东西。
    expect(trimClip(doc, clip.id, "start", -5)).toBe(doc);
    expect(trimClip(doc, clip.id, "end", 999)).toBe(doc);
  });
});

describe("trimClip — end edge", () => {
  it("extends the end, limited by the source duration", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "end", 999);
    const c = clipById(next, target);
    expect(c.in + c.duration).toBeCloseTo(10);
  });

  it("shortens the end", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "end", 4);
    expect(clipById(next, target).duration).toBeCloseTo(2);
  });

  it("refuses to swallow the next neighbour", () => {
    const { doc, target } = fixture(true);
    const next = trimClip(doc, target, "end", 99);
    expect(clipById(next, target).start + clipById(next, target).duration).toBeCloseTo(6);
  });

  it("allows images to extend beyond their (zero) duration", () => {
    const base = addTrack(newProject());
    const v = base.tracks[0].id;
    const image = createAsset({ name: "p.png", kind: "image", src: "/p.png", duration: 0 });
    const clip = createClip({ assetId: image.id, trackId: v, start: 0, duration: 3 });
    let doc = addAsset(base, image);
    doc = addClip(doc, v, clip);
    const next = trimClip(doc, clip.id, "end", 30);
    expect(clipById(next, clip.id).duration).toBeCloseTo(30);
  });

  it("allows images to extend to the left without moving the in-point", () => {
    const base = addTrack(newProject());
    const v = base.tracks[0].id;
    const image = createAsset({ name: "p.png", kind: "image", src: "/p.png", duration: 0 });
    const clip = createClip({ assetId: image.id, trackId: v, start: 5, duration: 3 });
    let doc = addAsset(base, image);
    doc = addClip(doc, v, clip);
    const next = trimClip(doc, clip.id, "start", 2);
    const c = clipById(next, clip.id);
    expect(c.start).toBeCloseTo(2);
    expect(c.duration).toBeCloseTo(6);
    expect(c.in).toBe(0);
  });
});

describe("trimClip — no-ops", () => {
  it("returns the same reference when the edge does not move", () => {
    const { doc, target } = fixture();
    expect(trimClip(doc, target, "start", 2)).toBe(doc);
    expect(trimClip(doc, target, "end", 6)).toBe(doc);
  });

  it("returns the same reference for an unknown clip", () => {
    const { doc } = fixture();
    expect(trimClip(doc, "nope", "end", 5)).toBe(doc);
  });
});
