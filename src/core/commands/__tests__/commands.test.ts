import { describe, expect, it } from "vitest";
import type { Command, CommandKind } from "@/types/events";
import type { Project } from "@/types/project";
import { addTrack } from "@/core/ops";
import { createAsset, createClip, newProject } from "@/core/factory";
import { applyCommandToDoc, diffAffected } from "@/core/commands";

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
  const doc = addTrack(newProject());
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

    expect(updated.assets[0].duration).toBe(6);
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
