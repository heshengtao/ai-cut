import { describe, expect, it } from "vitest";
import { createTrack, newProject } from "@/core/factory";
import { placeVoiceover, type VoiceoverItem } from "@/core/voiceover";
import type { Project } from "@/types/project";

function build(names: string[] = []): Project {
  const base = newProject("voiceover-test");
  return { ...base, tracks: names.map((name) => createTrack(name)) };
}

function item(id: string, start: number, duration: number): VoiceoverItem {
  return { id, assetId: `asset-${id}`, start, duration };
}

function starts(doc: Project, trackName: string): number[] {
  const track = doc.tracks.find((candidate) => candidate.name === trackName);
  return track ? track.clips.map((clip) => clip.start) : [];
}

describe("placeVoiceover", () => {
  it("keeps every clip anchored to its text start", () => {
    const doc = placeVoiceover(build(), [item("a", 2, 1.5), item("b", 6, 2)], "朗读");
    expect(starts(doc, "朗读")).toEqual([2, 6]);
    expect(doc.tracks.every((track) => track.locked === false)).toBe(true);
  });

  it("reuses one track while audio does not overlap", () => {
    const doc = placeVoiceover(build(), [item("a", 0, 2), item("b", 2.5, 2)], "朗读");
    expect(doc.tracks).toHaveLength(1);
    expect(starts(doc, "朗读")).toEqual([0, 2.5]);
  });

  it("splits overlapping audio onto a new track instead of shifting it", () => {
    const doc = placeVoiceover(build(), [item("a", 0, 4), item("b", 3, 4)], "朗读");
    expect(doc.tracks).toHaveLength(2);
    expect(starts(doc, "朗读")).toEqual([0]);
    expect(starts(doc, "朗读 2")).toEqual([3]);
  });

  it("reuses an existing voiceover track when the span is free", () => {
    const base = build();
    const first = placeVoiceover(base, [item("a", 1, 2)], "朗读");
    const second = placeVoiceover(first, [item("b", 4, 2)], "朗读");
    expect(second.tracks).toHaveLength(1);
    expect(starts(second, "朗读")).toEqual([1, 4]);
  });

  it("reuses the matching track and ignores unrelated ones", () => {
    const base = build(["旁白", "朗读"]);
    base.tracks[0].clips.push({
      id: "existing",
      assetId: "asset-existing",
      trackId: base.tracks[0].id,
      start: 0,
      duration: 10,
      in: 0,
    });
    const doc = placeVoiceover(base, [item("a", 0, 2)], "朗读");
    expect(doc.tracks).toHaveLength(2);
    expect(starts(doc, "朗读")).toEqual([0]);
    expect(doc.tracks[0].clips).toHaveLength(1);
    expect(doc.tracks[1].clips).toHaveLength(1);
  });

  it("moves to a new track when the matching track is occupied", () => {
    const base = build(["朗读"]);
    base.tracks[0].clips.push({
      id: "existing",
      assetId: "asset-existing",
      trackId: base.tracks[0].id,
      start: 0,
      duration: 10,
      in: 0,
    });
    const doc = placeVoiceover(base, [item("a", 0, 2)], "朗读");
    expect(doc.tracks).toHaveLength(2);
    expect(starts(doc, "朗读 2")).toEqual([0]);
  });

  it("does not touch locked tracks", () => {
    const base = build(["朗读"]);
    base.tracks[0].locked = true;
    const doc = placeVoiceover(base, [item("a", 0, 2)], "朗读");
    expect(doc.tracks).toHaveLength(2);
    expect(starts(doc, "朗读 2")).toEqual([0]);
  });
});
