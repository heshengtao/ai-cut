import { describe, expect, it } from "vitest";
import type { Project, Track } from "@/types/project";
import { createAsset, createClip, createTrack, newProject } from "@/core/factory";
import { IMPORTED_IMAGE_SECONDS, insertImportedAssets } from "@/core/importInsert";

function asset(kind: "video" | "audio" | "image", duration: number, name = kind) {
  return createAsset({ name, kind, src: `C:/media/${name}.mp4`, duration });
}

/** 一条轨道上已有某个片段的工程，用来验证「导入不覆盖已有内容」。 */
function docWithClip(locked = false): { doc: Project; track: Track } {
  const track: Track = { ...createTrack(), locked };
  const clip = createClip({
    assetId: "existing",
    trackId: track.id,
    start: 0,
    duration: 10,
  });
  track.clips = [clip];
  return { doc: { ...newProject(), tracks: [track] }, track };
}

describe("insertImportedAssets", () => {
  it("puts the first imported clip at the playhead and creates a track", () => {
    const video = asset("video", 12, "a");
    const { doc, clipIds } = insertImportedAssets(newProject(), [video], 0);

    expect(doc.tracks).toHaveLength(1);
    expect(doc.tracks[0].clips).toHaveLength(1);
    expect(clipIds).toHaveLength(1);
    expect(clipIds[0]).toBe(doc.tracks[0].clips[0].id);
    expect(doc.tracks[0].clips[0]).toMatchObject({
      assetId: video.id,
      start: 0,
      duration: 12,
    });
  });

  it("lays several assets end to end without overlapping", () => {
    const first = asset("video", 4, "first");
    const second = asset("video", 6, "second");
    const { doc } = insertImportedAssets(newProject(), [first, second], 0);

    expect(doc.tracks[0].clips.map((clip) => [clip.start, clip.duration])).toEqual([
      [0, 4],
      [4, 6],
    ]);
  });

  it("gives images the same fixed duration as the library insert", () => {
    const image = asset("image", 0, "still");
    const { doc } = insertImportedAssets(newProject(), [image], 0);

    expect(doc.tracks[0].clips[0].duration).toBe(IMPORTED_IMAGE_SECONDS);
  });

  it("starts at the playhead but never overlaps an existing clip", () => {
    const { doc: base, track } = docWithClip();
    const video = asset("video", 5, "a");
    const { doc } = insertImportedAssets(base, [video], 0);

    expect(doc.tracks[0].id).toBe(track.id);
    expect(doc.tracks[0].clips.map((clip) => clip.start)).toEqual([0, 10]);
  });

  it("adds a fresh track when every existing track is locked", () => {
    const { doc: base } = docWithClip(true);
    const video = asset("video", 5, "a");
    const { doc, clipIds } = insertImportedAssets(base, [video], 0);

    expect(doc.tracks).toHaveLength(2);
    expect(doc.tracks[0].clips).toHaveLength(1);
    expect(doc.tracks[1].clips).toHaveLength(1);
    expect(clipIds).toHaveLength(1);
  });

  it("skips assets whose duration is unknown", () => {
    const base = newProject();
    const broken = asset("video", 0, "broken");
    const { doc, clipIds } = insertImportedAssets(base, [broken], 0);

    expect(clipIds).toHaveLength(0);
    expect(doc).toBe(base);
  });
});
