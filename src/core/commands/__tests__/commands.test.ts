import { describe, expect, it } from "vitest";
import type { Command, CommandKind } from "@/types/events";
import type { Project } from "@/types/project";
import { addAsset, addTrack } from "@/core/ops";
import { createAsset, createClip, newProject } from "@/core/factory";
import { applyCommandToDoc, applyCommandsToDoc, diffAffected } from "@/core/commands";

function cmd(kind: CommandKind, payload: unknown): Command {
  return {
    id: crypto.randomUUID(),
    baseRevision: 0,
    actor: "agent",
    kind,
    payload,
    label: kind,
    timestamp: Date.now(),
  };
}

function fixture(): { doc: Project; trackId: string } {
  const asset = createAsset({
    id: "a1",
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 20,
  });
  const doc = addAsset(addTrack(newProject()), asset);
  return { doc, trackId: doc.tracks[0].id };
}

describe("applyCommandToDoc", () => {
  it("adds a clip and reports the affected range", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 2, duration: 3 });
    const result = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip }));

    expect(result.doc.tracks[0].clips).toHaveLength(1);
    expect(result.affected.clipIds).toEqual([clip.id]);
    expect(result.affected.range).toEqual([2, 5]);
    expect(doc.tracks[0].clips).toHaveLength(0);
  });

  it("updates a clip without touching other clips", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;
    const result = applyCommandToDoc(
      withClip,
      cmd("clip.update", { clipId: clip.id, patch: { opacity: 0.4 } }),
    );

    expect(result.doc.tracks[0].clips[0].opacity).toBe(0.4);
    expect(result.affected.clipIds).toEqual([clip.id]);
  });

  it("removes clips and keeps the removed id in affected", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 1, duration: 2 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;
    const result = applyCommandToDoc(
      withClip,
      cmd("clip.remove", { clipIds: [clip.id] }),
    );

    expect(result.doc.tracks[0].clips).toHaveLength(0);
    expect(result.affected.clipIds).toEqual([clip.id]);
    expect(result.affected.range).toEqual([1, 3]);
  });

  it("adds a track at an explicit index", () => {
    const { doc } = fixture();
    const result = applyCommandToDoc(doc, cmd("track.add", { index: 0 }));

    expect(result.doc.tracks).toHaveLength(2);
    expect(result.affected.trackIds).toContain(result.doc.tracks[0].id);
  });

  it("renames a track through track.update", () => {
    const { doc, trackId } = fixture();
    const result = applyCommandToDoc(
      doc,
      cmd("track.update", { trackId, patch: { name: "配音" } }),
    );
    expect(result.doc.tracks[0].name).toBe("配音");
  });

  it("updates track flags", () => {
    const { doc, trackId } = fixture();
    const result = applyCommandToDoc(
      doc,
      cmd("track.update", { trackId, patch: { muted: true, visible: false } }),
    );

    expect(result.doc.tracks[0].muted).toBe(true);
    expect(result.doc.tracks[0].visible).toBe(false);
    expect(result.affected.trackIds).toContain(trackId);
  });

  it("adds and updates assets", () => {
    const { doc } = fixture();
    const asset = createAsset({
      name: "a.mp4",
      kind: "video",
      src: "/tmp/a.mp4",
      duration: 4,
    });
    const added = applyCommandToDoc(doc, cmd("asset.add", { asset })).doc;
    const updated = applyCommandToDoc(
      added,
      cmd("asset.update", { assetId: asset.id, patch: { duration: 6 } }),
    ).doc;

    expect(updated.assets.find((item) => item.id === asset.id)?.duration).toBe(6);
  });

  it("renames the project", () => {
    const { doc } = fixture();
    const result = applyCommandToDoc(doc, cmd("project.rename", { name: "New name" }));
    expect(result.doc.name).toBe("New name");
  });

  it("updates project output settings", () => {
    const { doc } = fixture();
    const result = applyCommandToDoc(
      doc,
      cmd("project.output", { width: 1080, height: 1920, fps: 60 }),
    );
    expect(result.doc.width).toBe(1080);
    expect(result.doc.height).toBe(1920);
    expect(result.doc.fps).toBe(60);
  });

  it("rejects an empty project output payload", () => {
    const { doc } = fixture();
    expect(() => applyCommandToDoc(doc, cmd("project.output", {}))).toThrow();
  });

  it("rejects unknown kinds and invalid payloads", () => {
    const { doc } = fixture();
    expect(() =>
      applyCommandToDoc(doc, cmd("nope" as CommandKind, {})),
    ).toThrow();
    expect(() => applyCommandToDoc(doc, cmd("clip.add", { trackId: 1 }))).toThrow();
  });

  it("adds a named track", () => {
    const { doc } = fixture();
    const result = applyCommandToDoc(doc, cmd("track.add", { index: 0, name: "字幕" }));
    expect(result.doc.tracks[0].name).toBe("字幕");
  });

  it("rejects unknown assets and clips beyond the source range", () => {
    const { doc, trackId } = fixture();
    const unknown = createClip({ assetId: "missing", trackId, start: 0, duration: 1 });
    expect(() =>
      applyCommandToDoc(doc, cmd("clip.add", { trackId, clip: unknown })),
    ).toThrow(/未知素材/);

    const tooLong = createClip({ assetId: "a1", trackId, start: 0, duration: 25 });
    expect(() =>
      applyCommandToDoc(doc, cmd("clip.add", { trackId, clip: tooLong })),
    ).toThrow(/超出素材范围/);
  });

  it("rejects an overlapping clip.update", () => {
    const { doc, trackId } = fixture();
    const first = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    const second = createClip({ assetId: "a1", trackId, start: 2, duration: 2 });
    const withFirst = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip: first })).doc;
    const withBoth = applyCommandToDoc(
      withFirst,
      cmd("clip.add", { trackId, clip: second }),
    ).doc;

    expect(() =>
      applyCommandToDoc(
        withBoth,
        cmd("clip.update", { clipId: first.id, patch: { start: 1 } }),
      ),
    ).toThrow();
  });

  it("appends to the end of a track", () => {
    const { doc, trackId } = fixture();
    const first = applyCommandToDoc(
      doc,
      cmd("clip.append", { assetId: "a1", trackId, duration: 2 }),
    ).doc;
    const second = applyCommandToDoc(
      first,
      cmd("clip.append", { assetId: "a1", trackId, duration: 3 }),
    ).doc;

    const clips = second.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[1].start).toBe(2);
  });

  it("creates a named track when appending to an empty project", () => {
    const asset = createAsset({
      id: "a1",
      name: "a.mp4",
      kind: "video",
      src: "/tmp/a.mp4",
      duration: 8,
    });
    const doc = addAsset(newProject(), asset);
    const result = applyCommandToDoc(
      doc,
      cmd("clip.append", { assetId: "a1", trackName: "主画面" }),
    );

    expect(result.doc.tracks).toHaveLength(1);
    expect(result.doc.tracks[0].name).toBe("主画面");
    expect(result.doc.tracks[0].clips[0].duration).toBe(8);
  });

  it("adjusts clip color through the command layer", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;

    const result = applyCommandToDoc(
      withClip,
      cmd("clip.color", {
        clipId: clip.id,
        patch: { brightness: 0.2, saturation: 0.8 },
      }),
    );
    expect(result.doc.tracks[0].clips[0].color).toMatchObject({
      brightness: 0.2,
      saturation: 0.8,
      contrast: 1,
    });
  });

  it("sets and removes a clip mask", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;

    const masked = applyCommandToDoc(
      withClip,
      cmd("clip.mask", {
        clipId: clip.id,
        mask: { shape: "ellipse", x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      }),
    ).doc;
    expect(masked.tracks[0].clips[0].mask).toMatchObject({ shape: "ellipse", x: 0.2 });

    const cleared = applyCommandToDoc(
      masked,
      cmd("clip.mask", { clipId: clip.id, mask: null }),
    ).doc;
    expect(cleared.tracks[0].clips[0].mask).toBeUndefined();
  });

  it("sets and removes clip transitions", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;

    const transitioned = applyCommandToDoc(
      withClip,
      cmd("clip.transition", {
        clipId: clip.id,
        edge: "in",
        transition: { type: "slide", duration: 0.8, direction: "right" },
      }),
    ).doc;
    expect(transitioned.tracks[0].clips[0].transitionIn).toEqual({
      type: "slide",
      duration: 0.8,
      direction: "right",
    });

    const cleared = applyCommandToDoc(
      transitioned,
      cmd("clip.transition", { clipId: clip.id, edge: "in", transition: null }),
    ).doc;
    expect(cleared.tracks[0].clips[0].transitionIn).toBeUndefined();
  });

  it("sets and clears clip keyframes", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;

    const keyed = applyCommandToDoc(
      withClip,
      cmd("clip.keyframes", {
        clipId: clip.id,
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 1 },
        ],
      }),
    ).doc;
    expect(keyed.tracks[0].clips[0].keyframes?.opacity).toHaveLength(2);

    const cleared = applyCommandToDoc(
      keyed,
      cmd("clip.keyframes", {
        clipId: clip.id,
        property: "opacity",
        keyframes: null,
      }),
    ).doc;
    expect(cleared.tracks[0].clips[0].keyframes).toBeUndefined();
  });

  it("changes clip speed through the command layer", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4, in: 1 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;

    const result = applyCommandToDoc(
      withClip,
      cmd("clip.speed", { clipId: clip.id, speed: 2 }),
    );
    const updated = result.doc.tracks[0].clips[0];
    expect(updated.speed).toBe(2);
    expect(updated.duration).toBeCloseTo(2);
  });

  it("rejects a clip whose source span exceeds the asset", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({
      assetId: "a1",
      trackId,
      start: 0,
      duration: 15,
      in: 0,
      speed: 2,
    });
    expect(() =>
      applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })),
    ).toThrow(/超出素材范围/);
  });

  it("duplicates clips with an offset", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    const withClip = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;
    const result = applyCommandToDoc(
      withClip,
      cmd("clip.duplicate", { clipIds: [clip.id], offset: 3 }),
    );

    const clips = result.doc.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[1].start).toBe(3);
    expect(clips[1].id).not.toBe(clip.id);
  });

  it("imports subtitles and splits overlapping cues into tracks", () => {
    const { doc } = fixture();
    const result = applyCommandToDoc(
      doc,
      cmd("subtitle.import", {
        trackName: "字幕",
        entries: [
          { start: 0, end: 2, text: "A" },
          { start: 1, end: 3, text: "B" },
          { start: 4, end: 5, text: "C" },
        ],
      }),
    );

    const subtitleTracks = result.doc.tracks.filter((track) =>
      track.name.startsWith("字幕"),
    );
    expect(subtitleTracks).toHaveLength(2);
    expect(subtitleTracks.flatMap((track) => track.clips)).toHaveLength(3);
    expect(result.affected.trackIds).toHaveLength(2);
  });

  it("ripple deletes and closes the gap on the same track", () => {
    const { doc, trackId } = fixture();
    const first = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    const second = createClip({ assetId: "a1", trackId, start: 2, duration: 2 });
    const third = createClip({ assetId: "a1", trackId, start: 4, duration: 2 });
    let next = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip: first })).doc;
    next = applyCommandToDoc(next, cmd("clip.add", { trackId, clip: second })).doc;
    next = applyCommandToDoc(next, cmd("clip.add", { trackId, clip: third })).doc;

    const result = applyCommandToDoc(
      next,
      cmd("clip.ripple_delete", { clipIds: [second.id] }),
    );
    const clips = result.doc.tracks[0].clips;
    expect(clips.map((clip) => clip.id)).toEqual([first.id, third.id]);
    expect(clips[1].start).toBe(2);
  });
});

describe("applyCommandsToDoc", () => {
  it("applies a batch and merges affected ids", () => {
    const { doc, trackId } = fixture();
    const first = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });
    const second = createClip({ assetId: "a1", trackId, start: 2, duration: 1 });

    const result = applyCommandsToDoc(doc, [
      cmd("clip.add", { trackId, clip: first }),
      cmd("clip.add", { trackId, clip: second }),
    ]);

    expect(result.doc.tracks[0].clips).toHaveLength(2);
    expect([...result.affected.clipIds].sort()).toEqual([first.id, second.id].sort());
  });

  it("leaves the original document untouched when a later command fails", () => {
    const { doc, trackId } = fixture();
    const good = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });
    const bad = createClip({ assetId: "missing", trackId, start: 2, duration: 1 });

    expect(() =>
      applyCommandsToDoc(doc, [
        cmd("clip.add", { trackId, clip: good }),
        cmd("clip.add", { trackId, clip: bad }),
      ]),
    ).toThrow(/未知素材/);
    expect(doc.tracks[0].clips).toHaveLength(0);
  });
});

describe("diffAffected", () => {
  it("returns empty for the same document", () => {
    const { doc } = fixture();
    expect(diffAffected(doc, doc)).toEqual({ clipIds: [], trackIds: [], assetIds: [] });
  });

  it("detects added tracks and clips", () => {
    const { doc, trackId } = fixture();
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });
    const next = applyCommandToDoc(doc, cmd("clip.add", { trackId, clip })).doc;
    const affected = diffAffected(doc, next);

    expect(affected.trackIds).toContain(trackId);
    expect(affected.clipIds).toEqual([clip.id]);
  });
});
