import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset, addClip, addTrackAt } from "@/core/ops";
import {
  assetsPage,
  clipDetail,
  findClips,
  focusContext,
  overview,
  trackPage,
} from "@/core/projectView";

function fixture() {
  let doc = addTrackAt(newProject("demo"), 0, "字幕");
  doc = addAsset(
    doc,
    createAsset({
      id: "a1",
      name: "clip.mp4",
      kind: "video",
      src: "/tmp/clip.mp4",
      duration: 10,
    }),
  );
  const trackId = doc.tracks[0].id;
  const text = createClip({ assetId: "", trackId, start: 0, duration: 2, text: "你好世界" });
  const video = createClip({ assetId: "a1", trackId, start: 2, duration: 3, in: 1 });
  doc = addClip(doc, trackId, text);
  doc = addClip(doc, trackId, video);
  return { doc, trackId, text, video };
}

describe("progressive project views", () => {
  it("returns an overview without clips or asset details", () => {
    const { doc } = fixture();
    const view = overview(doc, 4);

    expect(view.revision).toBe(4);
    expect(view.project.duration).toBe(5);
    expect(view.project.trackCount).toBe(1);
    expect(view.project.assetCount).toBe(1);
    expect(view.project.assetsByKind.video).toBe(1);
    expect(view.tracks[0]).toMatchObject({
      index: 1,
      name: "字幕",
      clipCount: 2,
      start: 0,
      end: 5,
    });
    expect(JSON.stringify(view)).not.toContain("你好世界");
  });

  it("pages a track by id or 1-based index", () => {
    const { doc, trackId } = fixture();
    const byId = trackPage(doc, 5, trackId, 0, 1);
    const byIndex = trackPage(doc, 5, 1, 0, 1);

    expect(byId?.clips).toHaveLength(1);
    expect(byId?.hasMore).toBe(true);
    expect(byId?.nextOffset).toBe(1);
    expect(byIndex?.track.id).toBe(trackId);
    expect(trackPage(doc, 5, 99, 0, 40)).toBeNull();
  });

  it("returns one clip with its asset and neighbours", () => {
    const { doc, text, video } = fixture();
    const detail = clipDetail(doc, 6, text.id);

    expect(detail?.clip.id).toBe(text.id);
    expect(detail?.track.name).toBe("字幕");
    expect(detail?.asset).toBeNull();
    expect(detail?.neighbors.previous).toBeNull();
    expect(detail?.neighbors.next?.id).toBe(video.id);
  });

  it("finds clips by text, kind and time range", () => {
    const { doc, text, video } = fixture();

    expect(findClips(doc, 7, { text: "世界" })?.clips.map((clip) => clip.id)).toEqual([
      text.id,
    ]);
    expect(findClips(doc, 7, { kind: "video" })?.clips.map((clip) => clip.id)).toEqual([
      video.id,
    ]);
    expect(findClips(doc, 7, { from: 1, to: 2.5 })?.total).toBe(2);
    expect(findClips(doc, 7, { trackId: 1, limit: 1 })?.hasMore).toBe(true);
    expect(findClips(doc, 7, { trackId: 99 })).toBeNull();
  });

  it("pages assets with filters", () => {
    const { doc } = fixture();
    const all = assetsPage(doc, 8, {});
    const named = assetsPage(doc, 8, { name: "clip" });

    expect(all.total).toBe(1);
    expect(all.assets[0]).toMatchObject({ id: "a1", kind: "video" });
    expect(named.assets).toHaveLength(1);
    expect(assetsPage(doc, 8, { kind: "audio" }).total).toBe(0);
  });

  it("reports the user's focus from playhead and selection", () => {
    const { doc, trackId, text } = fixture();
    const view = focusContext(doc, 9, {
      playhead: 1.25,
      playing: false,
      selectedClipIds: [text.id],
      activeTrackId: trackId,
    });

    expect(view.playhead).toBe(1.25);
    expect(view.activeTrack?.id).toBe(trackId);
    expect(view.selectedClips.map((clip) => clip.id)).toEqual([text.id]);
  });
});
