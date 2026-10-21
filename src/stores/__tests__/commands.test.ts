import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
}));

import type { Command, CommandKind } from "@/types/events";
import { EVENT_LOG_LIMIT, useProjectStore } from "@/stores/project";
import { createClip, newProject } from "@/core/factory";
import { addClip, addTrack, setClipOpacity } from "@/core/ops";

beforeEach(() => {
  setActivePinia(createPinia());
  useProjectStore().reset(addTrack(newProject()), null);
});

function command(
  baseRevision: number,
  kind: CommandKind,
  payload: unknown,
  actor: Command["actor"] = "agent",
): Command {
  return {
    id: crypto.randomUUID(),
    baseRevision,
    actor,
    kind,
    payload,
    label: kind,
    timestamp: Date.now(),
  };
}

describe("applyCommand", () => {
  it("applies a serializable command, bumps revision and records an event", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 1, duration: 2 });

    const result = store.applyCommand(
      command(store.revision, "clip.add", { trackId, clip }),
    );

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.revision).toBe(1);
    expect(store.revision).toBe(1);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    expect(store.opLog.at(-1)?.command.kind).toBe("clip.add");
    expect(store.opLog.at(-1)?.affected.clipIds).toEqual([clip.id]);
  });

  it("rejects a stale command without mutating the document", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });

    store.applyCommand(command(store.revision, "clip.add", { trackId, clip }));
    const revision = store.revision;
    const result = store.applyCommand(
      command(0, "clip.add", {
        trackId,
        clip: createClip({ assetId: "a2", trackId, start: 4, duration: 1 }),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(store.revision).toBe(revision);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    expect(store.opLog.at(-1)?.error).toBeTruthy();
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const events: string[] = [];
    const off = store.subscribe((event) => events.push(event.command.kind));

    store.applyCommand(command(store.revision, "track.add", { index: 1 }));
    expect(events).toEqual(["track.add"]);

    off();
    store.applyCommand(command(store.revision, "track.add", { index: 2 }));
    expect(events).toEqual(["track.add"]);
  });

  it("records a single event for a coalesced gesture", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    store.dispatch((doc) => addClip(doc, trackId, clip));

    const before = store.opLog.length;
    const key = `opacity:${clip.id}`;
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clip.id, 0.8), key);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clip.id, 0.6), key);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clip.id, 0.4), key);
    store.endCoalesce();

    expect(store.opLog.length).toBe(before + 1);
    expect(store.opLog.at(-1)?.affected.clipIds).toEqual([clip.id]);
    expect(store.doc.tracks[0].clips[0].opacity).toBe(0.4);
  });

  it("records undo and redo as events", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
    store.dispatch((doc) => addClip(doc, trackId, clip));

    store.undo();
    expect(store.opLog.at(-1)?.command.kind).toBe("history.undo");
    expect(store.doc.tracks[0].clips).toHaveLength(0);

    store.redo();
    expect(store.opLog.at(-1)?.command.kind).toBe("history.redo");
    expect(store.doc.tracks[0].clips).toHaveLength(1);
  });

  it("caps the in-memory event log", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    for (let i = 0; i < EVENT_LOG_LIMIT + 20; i += 1) {
      store.dispatch((doc) =>
        addClip(
          doc,
          trackId,
          createClip({ assetId: `a${i}`, trackId, start: i * 2, duration: 1 }),
        ),
      );
    }
    expect(store.opLog).toHaveLength(EVENT_LOG_LIMIT);
  });

  it("resets revision and the event log on project reset", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) =>
      addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 1 })),
    );

    store.reset(addTrack(newProject()), null);

    expect(store.revision).toBe(0);
    expect(store.opLog).toHaveLength(1);
    expect(store.opLog[0].command.kind).toBe("project.reset");
  });
});
