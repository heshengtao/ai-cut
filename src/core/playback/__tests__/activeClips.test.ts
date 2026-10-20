import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack, setTrackFlag } from "@/core/ops/tracks";
import { activeClipsAt, isAudible, isVisible, mainVideoClipAt, mainVideoTrack, projectDuration } from "@/core/playback/activeClips";

function fixture() {
  const base = addTrack(addTrack(newProject()));
  const v1 = base.tracks[0].id;
  const a1 = base.tracks[1].id;
  const c1 = createClip({ assetId: "a1", trackId: v1, start: 0, duration: 4 });
  const c2 = createClip({ assetId: "a2", trackId: v1, start: 6, duration: 2 });
  const music = createClip({ assetId: "a3", trackId: a1, start: 1, duration: 10 });
  let doc = {
    ...base,
    assets: [
      createAsset({ id: "a1", name: "1.mp4", kind: "video", src: "/1.mp4", duration: 20 }),
      createAsset({ id: "a2", name: "2.mp4", kind: "video", src: "/2.mp4", duration: 20 }),
      createAsset({ id: "a3", name: "m.mp3", kind: "audio", src: "/m.mp3", duration: 20 }),
    ],
  };
  doc = addClip(doc, v1, c1);
  doc = addClip(doc, v1, c2);
  doc = addClip(doc, a1, music);
  return { doc, v1, a1, c1, c2, music };
}

describe("activeClipsAt", () => {
  it("returns the covering clip per track", () => {
    const { doc, v1, a1, c1 } = fixture();
    const at1 = activeClipsAt(doc, 1);
    expect(at1.get(v1)!.id).toBe(c1.id);
    expect(at1.get(a1)!.assetId).toBe("a3");
  });

  it("treats the interval as half-open [start, start+duration)", () => {
    const { doc, v1, c1, c2 } = fixture();
    expect(activeClipsAt(doc, 0).get(v1)!.id).toBe(c1.id);
    expect(activeClipsAt(doc, 4).get(v1)).toBeNull(); // 恰好是 c1 的终点、c2 之前
    expect(activeClipsAt(doc, 6).get(v1)!.id).toBe(c2.id);
  });

  it("returns null for tracks with nothing under the playhead", () => {
    const { doc } = fixture();
    // t=11 恰好是所有片段终点（左闭右开），两条轨道都没有覆盖
    const map = activeClipsAt(doc, 11);
    expect([...map.values()].every((v) => v === null)).toBe(true);
  });
});

describe("mainVideoTrack", () => {
  it("picks the topmost visible video track", () => {
    const { doc, v1 } = fixture();
    expect(mainVideoTrack(doc)!.id).toBe(v1);
  });

  it("keeps the picture when the track is muted", () => {
    const { doc, v1 } = fixture();
    const muted = setTrackFlag(doc, v1, "muted", true);
    expect(mainVideoTrack(muted)!.id).toBe(v1);
  });

  it("skips tracks that are not visible", () => {
    const { doc, v1 } = fixture();
    const hidden = setTrackFlag(doc, v1, "visible", false);
    expect(mainVideoTrack(hidden)).toBeNull();
  });

  it("keeps mute and visibility independent", () => {
    const { doc, v1 } = fixture();
    const muted = setTrackFlag(doc, v1, "muted", true);
    expect(isAudible(muted.tracks[0])).toBe(false);
    expect(isVisible(muted.tracks[0])).toBe(true);

    const hidden = setTrackFlag(doc, v1, "visible", false);
    expect(isAudible(hidden.tracks[0])).toBe(true);
    expect(isVisible(hidden.tracks[0])).toBe(false);
  });
});

describe("mainVideoClipAt", () => {
  it("returns the covering clip on the main video track", () => {
    const { doc, c1 } = fixture();
    expect(mainVideoClipAt(doc, 2)!.clip.id).toBe(c1.id);
  });

  it("returns null when the main track has no coverage", () => {
    const { doc } = fixture();
    expect(mainVideoClipAt(doc, 5)).toBeNull();
  });
});

describe("projectDuration", () => {
  it("is the maximum clip end across all tracks", () => {
    const { doc } = fixture();
    expect(projectDuration(doc)).toBe(11); // 音频 [1,11)
  });

  it("is zero for an empty project", () => {
    expect(projectDuration(newProject())).toBe(0);
  });
});
