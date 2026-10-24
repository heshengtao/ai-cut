import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset, addClip, addTrack } from "@/core/ops";

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  stamps: new Map<string, { size: number; mtimeMs: number }>(),
  renders: 0,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@/core/media", () => ({
  fileStamp: async (path: string) => {
    const stamp = state.stamps.get(path) ?? { size: 1, mtimeMs: 1 };
    return { exists: true, ...stamp };
  },
  pathExists: async (path: string) => state.files.has(path) || path.endsWith(".mp4"),
  readProjectFile: async (path: string) => {
    const text = state.files.get(path);
    if (text === undefined) throw new Error("missing");
    return text;
  },
  writeProjectFile: async (path: string, text: string) => {
    state.files.set(path, text);
  },
}));

vi.mock("@/core/export/segment", () => ({
  renderSegment: async (
    _project: unknown,
    options: { start: number; end: number; outputPath: string },
  ) => {
    state.renders += 1;
    state.files.set(options.outputPath, "mp4");
    return {
      path: options.outputPath,
      start: options.start,
      end: options.end,
      duration: options.end - options.start,
      width: 1920,
      height: 1080,
      warnings: [],
    };
  },
}));

import {
  canonicalJson,
  fingerprintRange,
  renderRange,
  renderStatus,
} from "@/core/render/cache";

function fixture() {
  const asset = createAsset({
    id: "a1",
    name: "a.mp4",
    kind: "video",
    src: "/media/a.mp4",
    duration: 10,
  });
  let doc = addAsset(newProject("cache"), asset);
  doc = addTrack(doc, "V1");
  const track = doc.tracks[0];
  doc = addClip(
    doc,
    track.id,
    createClip({ assetId: "a1", trackId: track.id, start: 0, duration: 4, in: 0 }),
  );
  return doc;
}

beforeEach(() => {
  state.files.clear();
  state.stamps.clear();
  state.renders = 0;
});

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });
});

describe("fingerprintRange", () => {
  it("is stable for identical content and changes with the asset stamp", async () => {
    const doc = fixture();
    const first = await fingerprintRange(doc, { start: 0, end: 2 });
    const second = await fingerprintRange(doc, { start: 0, end: 2 });
    expect(second.key).toBe(first.key);

    state.stamps.set("/media/a.mp4", { size: 2, mtimeMs: 2 });
    const changed = await fingerprintRange(doc, { start: 0, end: 2 });
    expect(changed.key).not.toBe(first.key);
  });

  it("changes when the clip content changes but not for markers", async () => {
    const doc = fixture();
    const first = await fingerprintRange(doc, { start: 0, end: 2 });
    const retimed = {
      ...doc,
      tracks: doc.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, duration: 3 })),
      })),
    };
    expect((await fingerprintRange(retimed, { start: 0, end: 2 })).key).not.toBe(first.key);

    const withMarker = {
      ...doc,
      markers: [
        { id: "m1", time: 1, name: "note", note: "不影响渲染" },
      ],
    };
    expect((await fingerprintRange(withMarker, { start: 0, end: 2 })).key).toBe(first.key);
  });
});

describe("renderRange / renderStatus", () => {
  it("renders once, then serves the cached file", async () => {
    const doc = fixture();
    const first = await renderRange(doc, { start: 0, end: 2 });
    expect(first.cached).toBe(false);
    expect(state.renders).toBe(1);

    const second = await renderRange(doc, { start: 0, end: 2 });
    expect(second.cached).toBe(true);
    expect(second.path).toBe(first.path);
    expect(state.renders).toBe(1);
  });

  it("reports no-cache, fresh and content-changed", async () => {
    const doc = fixture();
    const before = await renderStatus(doc, [{ id: "s1", start: 0, end: 2 }]);
    expect(before[0]).toMatchObject({ id: "s1", stale: true, reason: "no-cache" });

    await renderRange(doc, { start: 0, end: 2 });
    const fresh = await renderStatus(doc, [{ id: "s1", start: 0, end: 2 }]);
    expect(fresh[0]).toMatchObject({ stale: false, reason: "fresh" });

    state.stamps.set("/media/a.mp4", { size: 9, mtimeMs: 9 });
    const stale = await renderStatus(doc, [{ id: "s1", start: 0, end: 2 }]);
    expect(stale[0]).toMatchObject({ stale: true, reason: "content-changed" });
  });

  it("bypasses the cache when force is set", async () => {
    const doc = fixture();
    await renderRange(doc, { start: 0, end: 2 });
    const forced = await renderRange(doc, { start: 0, end: 2, force: true });
    expect(forced.cached).toBe(false);
    expect(state.renders).toBe(2);
  });
});
