import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
}));

import { useProjectStore } from "@/stores/project";
import { attachEpisodeView, newEpisode } from "@/core/episodes";
import { createClip, newProject } from "@/core/factory";
import { addAsset, addTrack } from "@/core/ops";
import type { MediaAsset, Project } from "@/types/project";

beforeEach(() => {
  setActivePinia(createPinia());
});

/** 建一份带两个分P 的工程并重置进 store。 */
function setupTwoEpisodes() {
  const base = newProject("两集");
  const second = newEpisode("分P 2", 1);
  const doc = attachEpisodeView({
    ...base,
    episodes: [...base.episodes, second],
  } as Project);
  const store = useProjectStore();
  store.reset(doc, null);
  return { store, firstId: doc.episodes[0].id, secondId: second.id };
}

describe("switchEpisode", () => {
  it("切分P 后 tracks 指向目标分P 并清空撤销栈", () => {
    const { store, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    expect(store.canUndo).toBe(true);
    expect(store.doc.tracks).toHaveLength(1);

    expect(store.switchEpisode(secondId)).toBe(true);
    expect(store.doc.activeEpisodeId).toBe(secondId);
    expect(store.doc.tracks).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  it("切回原分P 时之前的轨道还在，且投影仍可用", () => {
    const { store, firstId, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    store.switchEpisode(secondId);
    store.switchEpisode(firstId);
    expect(store.doc.tracks).toHaveLength(1);
    expect(store.doc.tracks[0].clips).toEqual([]);
  });

  it("未知分P 或当前分P 返回 false，文档不变", () => {
    const { store } = setupTwoEpisodes();
    const before = store.doc;
    expect(store.switchEpisode("nope")).toBe(false);
    expect(store.switchEpisode(store.doc.activeEpisodeId)).toBe(false);
    expect(store.doc).toBe(before);
  });
});

describe("分P 之间共享的数据", () => {
  it("素材是工程级的：切分P 后仍在", () => {
    const { store, secondId } = setupTwoEpisodes();
    store.dispatch((doc) =>
      addAsset(doc, {
        id: "a1",
        kind: "video",
        src: "/tmp/a.mp4",
        name: "a.mp4",
        duration: 2,
      } as unknown as MediaAsset),
    );
    store.switchEpisode(secondId);
    expect(store.doc.assets.map((asset) => asset.id)).toEqual(["a1"]);
  });

  it("剪辑只落在当前分P，不影响另一集", () => {
    const { store, firstId, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => {
      const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });
      return {
        ...doc,
        tracks: doc.tracks.map((track) =>
          track.id === trackId ? { ...track, clips: [...track.clips, clip] } : track,
        ),
      } as Project;
    });
    store.switchEpisode(secondId);
    expect(store.doc.tracks).toHaveLength(0);
    store.switchEpisode(firstId);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
  });
});
