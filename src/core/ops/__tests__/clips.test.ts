import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import type { Project } from "@/types/project";
import { addClip, removeClips, updateClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

/** 两条轨道上各放片段，并返回它们的 id。 */
function fixture(): { doc: Project; vTrack: string; aTrack: string; c1: string; c2: string } {
  const base = addTrack(addTrack(newProject()));
  const vTrack = base.tracks[0].id;
  const aTrack = base.tracks[1].id;
  const clip1 = createClip({ assetId: "a1", trackId: vTrack, start: 2, duration: 3 });
  const clip2 = createClip({ assetId: "a2", trackId: vTrack, start: 0, duration: 1 });
  let doc = addClip(base, vTrack, clip1);
  doc = addClip(doc, vTrack, clip2);
  return { doc, vTrack, aTrack, c1: clip1.id, c2: clip2.id };
}

describe("addClip", () => {
  it("inserts clips sorted by start", () => {
    const { doc, vTrack, c1, c2 } = fixture();
    const order = doc.tracks[0].clips.map((c) => c.id);
    expect(order).toEqual([c2, c1]);
    expect(doc.tracks[0].id).toBe(vTrack);
    expect(doc.tracks[0].clips).toHaveLength(2);
  });

  it("stamps the clip's trackId to the target track", () => {
    const base = addTrack(newProject());
    const trackId = base.tracks[0].id;
    const clip = { ...createClip({ assetId: "a1", trackId: "wrong", start: 0, duration: 1 }) };
    const doc = addClip(base, trackId, clip);
    expect(doc.tracks[0].clips[0].trackId).toBe(trackId);
  });

  it("is a no-op for an unknown track", () => {
    const base = newProject();
    const clip = createClip({ assetId: "a1", trackId: "x", start: 0, duration: 1 });
    expect(addClip(base, "missing", clip)).toBe(base);
  });
});

describe("removeClips", () => {
  it("removes across multiple tracks", () => {
    const { doc, vTrack, aTrack, c1 } = fixture();
    const audio = createClip({ assetId: "a3", trackId: aTrack, start: 0, duration: 5 });
    const withAudio = addClip(doc, aTrack, audio);
    const next = removeClips(withAudio, [c1, audio.id]);
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[1].clips).toHaveLength(0);
    expect(next.tracks[0].clips[0].id).not.toBe(c1);
    expect(vTrack).toBe(doc.tracks[0].id);
  });

  it("returns the same reference for an empty list or unknown ids", () => {
    const { doc } = fixture();
    expect(removeClips(doc, [])).toBe(doc);
    expect(removeClips(doc, ["nope"])).toBe(doc);
  });
});

describe("updateClip", () => {
  it("patches only the target clip, leaving the document immutable", () => {
    const { doc, c1 } = fixture();
    const next = updateClip(doc, c1, { opacity: 0.5, gain: -3 });
    const found = next.tracks[0].clips.find((c) => c.id === c1)!;
    expect(found.opacity).toBe(0.5);
    expect(found.gain).toBe(-3);
    expect(doc.tracks[0].clips.find((c) => c.id === c1)!.opacity).toBeUndefined();
  });

  it("is a no-op for an unknown clip", () => {
    const { doc } = fixture();
    expect(updateClip(doc, "nope", { opacity: 0.5 })).toBe(doc);
  });
});
