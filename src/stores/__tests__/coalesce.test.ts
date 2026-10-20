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
import { createClip, newProject } from "@/core/factory";
import { addClip, setClipOpacity } from "@/core/ops";
import { addTrack } from "@/core/ops/tracks";

beforeEach(() => {
  setActivePinia(createPinia());
  useProjectStore().reset(addTrack(newProject()), null);
});

function setup() {
  const store = useProjectStore();
  const trackId = store.doc.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
  store.dispatch((doc) => addClip(doc, trackId, clip));
  return { store, clipId: clip.id };
}

describe("dispatchCoalesced", () => {
  it("records a single history entry for a run of same-key updates", () => {
    const { store, clipId } = setup();
    const before = store.doc.tracks[0].clips[0].opacity;

    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.8), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.6), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.4), `opacity:${clipId}`);

    expect(store.doc.tracks[0].clips[0].opacity).toBeCloseTo(0.4);
    // 一次撤销应回到拖动之前，而不是回退一格
    store.undo();
    expect(store.doc.tracks[0].clips[0].opacity).toBe(before);
    // 合并只记了一步，因此还剩 setup 里的 addClip 可撤销
    expect(store.canUndo).toBe(true);
  });

  it("starts a new history entry when the key changes", () => {
    const { store, clipId } = setup();
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `gain:${clipId}`);
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(2);
  });

  it("ends coalescing after a plain dispatch", () => {
    const { store, clipId } = setup();
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `opacity:${clipId}`);
    store.dispatch((doc) => setClipOpacity(doc, clipId, 0.2));
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(3); // addClip + 两次不透明度修改
  });
});
