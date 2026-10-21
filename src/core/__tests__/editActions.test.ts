import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
}));

import type { MediaAsset } from "@/types/project";
import { createClip, newProject } from "@/core/factory";
import { addAsset, addClip, addTrack } from "@/core/ops";
import { useProjectStore } from "@/stores/project";
import { extractAudio } from "@/core/editActions";

const asset: MediaAsset = {
  id: "asset-video",
  name: "shot.mp4",
  kind: "video",
  src: "/tmp/shot.mp4",
  duration: 10,
  hasAudio: true,
  addedAt: 0,
};

function setup() {
  const track = addTrack(newProject());
  let doc = addAsset(track, asset);
  const trackId = doc.tracks[0].id;
  const clip = createClip({
    assetId: asset.id,
    trackId,
    start: 2,
    duration: 4,
    in: 1,
  });
  doc = addClip(doc, trackId, clip);
  useProjectStore().reset(doc, null);
  return { clip, trackId };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("extractAudio", () => {
  it("mutes the video clip and puts an audioOnly clip on a new track below", () => {
    const { clip, trackId } = setup();

    const result = extractAudio({ clipId: clip.id, trackName: "声音" });
    const doc = useProjectStore().doc;

    expect(doc.tracks).toHaveLength(2);
    const source = doc.tracks[0];
    expect(source.id).toBe(trackId);
    expect(source.clips[0].muted).toBe(true);

    const audioTrack = doc.tracks[1];
    expect(audioTrack.name).toBe("声音");
    expect(result.track?.id).toBe(audioTrack.id);
    expect(audioTrack.clips).toHaveLength(1);

    const audio = audioTrack.clips[0];
    expect(audio.audioOnly).toBe(true);
    expect(audio.assetId).toBe(asset.id);
    expect(audio.start).toBe(2);
    expect(audio.duration).toBe(4);
    expect(audio.in).toBe(1);
    expect(result.audioClipId).toBe(audio.id);
    expect(result.mutedSource).toBe(true);
  });

  it("rejects a text clip", () => {
    const track = addTrack(newProject());
    const trackId = track.tracks[0].id;
    const text = createClip({
      assetId: "",
      trackId,
      start: 0,
      duration: 2,
      text: "标题",
    });
    useProjectStore().reset(addClip(track, trackId, text), null);

    expect(() => extractAudio({ clipId: text.id })).toThrow(/没有关联素材/);
  });
});
