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

function append(store: ReturnType<typeof useProjectStore>, index: number) {
  const trackId = store.doc.tracks[0].id;
  return store.dispatch(
    (doc) =>
      addClip(
        doc,
        trackId,
        createClip({ assetId: "a1", trackId, start: index * 3, duration: 2 }),
      ),
  );
}

describe("operation history", () => {
  it("attributes human, built-in and external operations", () => {
    const store = useProjectStore();
    append(store);
    append(store);

    store.dispatch(
      (doc) => {
        const trackId = doc.tracks[0].id;
        return addClip(
          doc,
          trackId,
          createClip({ assetId: "a2", trackId, start: 20, duration: 1 }),
        );
      },
      { kind: "clip.add", actor: "agent", sessionId: "chat", label: "AI edit" },
    );
    store.dispatch(
      (doc) => {
        const trackId = doc.tracks[0].id;
        return addClip(
          doc,
          trackId,
          createClip({ assetId: "a3", trackId, start: 30, duration: 1 }),
        );
      },
      { kind: "clip.add", actor: "agent", sessionId: "mcp-session", label: "MCP edit" },
    );

    expect(store.history).toHaveLength(4);
    expect(store.history.map((entry) => entry.actor)).toEqual([
      "human",
      "human",
      "agent",
      "agent",
    ]);
    expect(store.history.map((entry) => entry.sessionId)).toEqual([
      undefined,
      undefined,
      "chat",
      "mcp-session",
    ]);
    expect(store.history[2].label).toBe("AI edit");
    expect(store.history.every((entry) => entry.applied)).toBe(true);
  });

  it("reverts to before a step and reapplies through another", () => {
    const store = useProjectStore();
    append(store);
    append(store);
    append(store);
    const ids = store.history.map((entry) => entry.id);

    expect(store.revertTo(ids[0])).toBe(true);
    expect(store.doc.tracks[0].clips).toHaveLength(0);
    expect(store.history.map((entry) => entry.applied)).toEqual([false, false, false]);

    expect(store.reapplyTo(ids[1])).toBe(true);
    expect(store.doc.tracks[0].clips).toHaveLength(2);
    expect(store.history.map((entry) => entry.applied)).toEqual([true, true, false]);

    expect(store.reapplyTo(ids[2])).toBe(true);
    expect(store.doc.tracks[0].clips).toHaveLength(3);
    expect(store.history.every((entry) => entry.applied)).toBe(true);
  });

  it("keeps one history entry per coalesced gesture with its metadata", () => {
    const store = useProjectStore();
    append(store);
    const clipId = store.doc.tracks[0].clips[0].id;
    const before = store.doc.tracks[0].clips[0].opacity;
    const key = `opacity:${clipId}`;

    store.dispatchCoalesced(
      (doc) => setClipOpacity(doc, clipId, 0.8),
      key,
      { kind: "clip.update", actor: "agent", sessionId: "chat", label: "Fade in" },
    );
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.4), key);
    store.endCoalesce();

    expect(store.history).toHaveLength(2);
    const step = store.history.at(-1)!;
    expect(step.label).toBe("Fade in");
    expect(step.actor).toBe("agent");
    expect(step.affected.clipIds).toEqual([clipId]);

    store.undo();
    expect(store.doc.tracks[0].clips[0].opacity).toBe(before);

    // 重做要回到手势结束时的最终值，而不是第一个中间值。
    store.redo();
    expect(store.doc.tracks[0].clips[0].opacity).toBe(0.4);
  });
});
