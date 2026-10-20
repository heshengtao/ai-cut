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
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

beforeEach(() => {
  setActivePinia(createPinia());
  useProjectStore().reset(addTrack(newProject()), null);
});

describe("dispatch", () => {
  it("applies the mutation, marks dirty and pushes history", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });

    const changed = store.dispatch((doc) => addClip(doc, trackId, clip));

    expect(changed).toBe(true);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    expect(store.dirty).toBe(true);
    expect(store.canUndo).toBe(true);
  });

  it("ignores a no-op mutation (same reference) and records no history", () => {
    const store = useProjectStore();
    const changed = store.dispatch((doc) => doc);
    expect(changed).toBe(false);
    expect(store.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
  });
});

describe("undo / redo", () => {
  it("round-trips a sequence of edits", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });

    store.dispatch((doc) => addClip(doc, trackId, clip));
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a2", trackId, start: 5, duration: 2 })));
    expect(store.doc.tracks[0].clips).toHaveLength(2);

    store.undo();
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    store.undo();
    expect(store.doc.tracks[0].clips).toHaveLength(0);
    expect(store.canUndo).toBe(false);

    store.redo();
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    store.redo();
    expect(store.doc.tracks[0].clips).toHaveLength(2);
    expect(store.canRedo).toBe(false);
  });

  it("drops the redo stack when a new edit lands after an undo", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 1 })));
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a2", trackId, start: 2, duration: 1 })));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a3", trackId, start: 9, duration: 1 })));
    expect(store.canRedo).toBe(false);
  });

  it("caps history at 100 entries", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    for (let i = 0; i < 130; i += 1) {
      const start = i * 2;
      store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: `a${i}`, trackId, start, duration: 1 })));
    }
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(100);
  });
});

describe("reset", () => {
  it("clears history and the dirty flag", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 1 })));
    store.reset(store.doc, "/tmp/x.json");
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.filePath).toBe("/tmp/x.json");
  });
});
