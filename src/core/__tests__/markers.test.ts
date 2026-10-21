import { describe, expect, it } from "vitest";
import type { Command, CommandKind } from "@/types/events";
import type { Project } from "@/types/project";
import { createAsset, createMarker, newProject } from "@/core/factory";
import { addAsset, addMarker, addTrack, removeMarker, updateMarker } from "@/core/ops";
import { applyCommandToDoc } from "@/core/commands";
import { markers, overview } from "@/core/projectView";

function cmd(kind: CommandKind, payload: unknown): Command {
  return {
    id: crypto.randomUUID(),
    baseRevision: 0,
    actor: "agent",
    kind,
    payload,
    label: kind,
    timestamp: Date.now(),
  };
}

function fixture(): Project {
  const asset = createAsset({
    id: "a1",
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 20,
  });
  return addAsset(addTrack(newProject("demo")), asset);
}

describe("marker ops", () => {
  it("adds, sorts, updates and removes markers", () => {
    let doc = newProject();
    doc = addMarker(doc, createMarker({ time: 5, name: "结尾" }));
    doc = addMarker(doc, createMarker({ time: 1, name: "开场" }));
    expect(doc.markers.map((marker) => marker.name)).toEqual(["开场", "结尾"]);

    const id = doc.markers[1].id;
    doc = updateMarker(doc, id, { time: 0.5, name: "钩子", color: "#ff0000" });
    expect(doc.markers[0]).toMatchObject({ id, time: 0.5, name: "钩子", color: "#ff0000" });

    doc = removeMarker(doc, id);
    expect(doc.markers).toHaveLength(1);
  });
});

describe("marker commands", () => {
  it("adds and updates markers through the command layer", () => {
    let doc = fixture();
    const added = applyCommandToDoc(
      doc,
      cmd("marker.add", { time: 3, name: "转折", color: "#00ff00" }),
    );
    doc = added.doc;
    expect(doc.markers).toHaveLength(1);
    expect(added.affected.trackIds).toEqual([]);
    const marker = doc.markers[0];

    const updated = applyCommandToDoc(
      doc,
      cmd("marker.update", { markerId: marker.id, patch: { name: "新名字", time: 4 } }),
    );
    expect(updated.doc.markers[0]).toMatchObject({ time: 4, name: "新名字" });

    const removed = applyCommandToDoc(
      updated.doc,
      cmd("marker.remove", { markerId: marker.id }),
    );
    expect(removed.doc.markers).toEqual([]);
  });
});

describe("marker views", () => {
  it("reports marker count and filters by time", () => {
    let doc = fixture();
    doc = addMarker(doc, createMarker({ time: 1, name: "A" }));
    doc = addMarker(doc, createMarker({ time: 5, name: "B" }));

    expect(overview(doc, 1).project.markerCount).toBe(2);
    expect(markers(doc, 1, { from: 2, to: 6 }).markers.map((marker) => marker.name)).toEqual([
      "B",
    ]);
  });
});
