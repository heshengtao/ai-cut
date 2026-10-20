import { describe, expect, it } from "vitest";
import { newProject, createClip } from "@/core/factory";
import { addTrack } from "@/core/ops";
import { parseProject, serializeProject } from "@/core/serialize";

describe("newProject", () => {
  it("creates a versioned project without tracks", () => {
    const p = newProject("测试");
    expect(p.version).toBe(1);
    expect(p.name).toBe("测试");
    expect(p.fps).toBe(30);
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.tracks).toEqual([]);
    expect(p.assets).toEqual([]);
  });

  it("gives every entity a distinct id", () => {
    let p = newProject();
    p = addTrack(p);
    p = addTrack(p);
    const ids = new Set(p.tracks.map((t) => t.id));
    expect(ids.size).toBe(2);
  });
});

describe("serialize / parse round trip", () => {
  it("preserves the document through JSON", () => {
    let p = newProject("往返");
    p = addTrack(p);
    const clip = createClip({ assetId: "a1", trackId: p.tracks[0].id, start: 1, duration: 2 });
    p.tracks[0].clips.push(clip);

    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
  });
});

describe("parseProject validation", () => {
  it("fills visible for old tracks and drops the legacy solo field", () => {
    const p = addTrack(newProject());
    const legacyTrack = { ...p.tracks[0], visible: undefined, solo: true };
    const parsed = parseProject(JSON.stringify({ ...p, tracks: [legacyTrack] }));
    expect(parsed.tracks[0].visible).toBe(true);
    expect("solo" in parsed.tracks[0]).toBe(false);
  });

  it("rejects a document with the wrong version", () => {
    expect(() => parseProject(JSON.stringify({ ...newProject(), version: 99 }))).toThrow(/version/i);
  });

  it("rejects non-object json", () => {
    expect(() => parseProject("[]")).toThrow();
  });

  it("rejects a track whose clips are missing", () => {
    const p = addTrack(newProject());
    const broken = JSON.stringify({ ...p, tracks: [{ ...p.tracks[0], clips: undefined }] });
    expect(() => parseProject(broken)).toThrow(/clips/i);
  });
});
