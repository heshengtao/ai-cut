import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset, relinkAsset, removeAsset, updateAsset } from "@/core/ops/assets";
import { addTrack } from "@/core/ops/tracks";

function projectWithVideo() {
  const doc = addTrack(newProject());
  const asset = createAsset({
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 10,
    hasAudio: true,
  });
  const trackId = doc.tracks[0].id;
  const clip = createClip({ assetId: asset.id, trackId, start: 0, duration: 4 });
  const withAsset = addAsset(doc, asset);
  const withClip = {
    ...withAsset,
    tracks: withAsset.tracks.map((t) => (t.id === trackId ? { ...t, clips: [clip] } : t)),
  };
  return { doc: withClip, asset, trackId, clip };
}

describe("addAsset", () => {
  it("appends the asset and returns a new document", () => {
    const doc = newProject();
    const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 5 });
    const next = addAsset(doc, asset);
    expect(next.assets).toHaveLength(1);
    expect(next).not.toBe(doc);
    expect(doc.assets).toHaveLength(0);
  });

  it("is a no-op (same reference) when the id already exists", () => {
    const doc = newProject();
    const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 5 });
    const once = addAsset(doc, asset);
    expect(addAsset(once, asset)).toBe(once);
  });
});

describe("removeAsset", () => {
  it("removes the asset and every clip that referenced it", () => {
    const { doc, asset } = projectWithVideo();
    const next = removeAsset(doc, asset.id);
    expect(next.assets).toHaveLength(0);
    expect(next.tracks[0].clips).toHaveLength(0);
  });

  it("returns the same reference for an unknown id", () => {
    const { doc } = projectWithVideo();
    expect(removeAsset(doc, "nope")).toBe(doc);
  });
});

describe("updateAsset", () => {
  it("merges the patch and bumps updatedAt", () => {
    const { doc, asset } = projectWithVideo();
    const next = updateAsset(doc, asset.id, { thumb: "x.png", wave: [1, 2, 3] });
    expect(next.assets[0].thumb).toBe("x.png");
    expect(next.assets[0].wave).toEqual([1, 2, 3]);
    expect(next.updatedAt).toBeGreaterThanOrEqual(doc.updatedAt);
  });
});

describe("relinkAsset", () => {
  it("sets the new src and clears the offline flag", () => {
    const { doc, asset } = projectWithVideo();
    const offline = updateAsset(doc, asset.id, { offline: true });
    const next = relinkAsset(offline, asset.id, "/new/path.mp4");
    expect(next.assets[0].src).toBe("/new/path.mp4");
    expect(next.assets[0].offline).toBe(false);
  });
});
