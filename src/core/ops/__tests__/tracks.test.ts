import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import {
  addTrack,
  addTrackAt,
  moveTrack,
  raiseTracks,
  removeTrack,
  renameTrack,
  setTrackFlag,
} from "@/core/ops/tracks";

describe("addTrack", () => {
  it("appends a track with an auto-incremented name", () => {
    const doc = addTrack(newProject());
    expect(doc.tracks).toHaveLength(1);
    expect(doc.tracks[0].name).toBe("轨道 1");
    const next = addTrack(doc);
    expect(next.tracks).toHaveLength(2);
    expect(next.tracks[1].name).toBe("轨道 2");
  });
});

describe("addTrackAt", () => {
  it("inserts a track at the requested index", () => {
    let doc = addTrack(addTrack(newProject()));
    doc = addTrackAt(doc, 1, "中间");
    expect(doc.tracks.map((t) => t.name)).toEqual(["轨道 1", "中间", "轨道 2"]);
  });

  it("clamps an out-of-range index", () => {
    const doc = addTrackAt(newProject(), 99);
    expect(doc.tracks).toHaveLength(1);
  });
});

describe("moveTrack", () => {
  it("reorders tracks and keeps their clips", () => {
    const doc = addTrack(addTrack(addTrack(newProject())));
    const [first, second, third] = doc.tracks;
    const next = moveTrack(doc, first.id, 2);
    expect(next.tracks.map((t) => t.id)).toEqual([second.id, third.id, first.id]);
  });

  it("clamps an out-of-range index and is a no-op at the same spot", () => {
    const doc = addTrack(addTrack(newProject()));
    const first = doc.tracks[0];
    const next = moveTrack(doc, first.id, 99);
    expect(next.tracks[1].id).toBe(first.id);
    expect(moveTrack(doc, first.id, 0)).toBe(doc);
    expect(moveTrack(doc, "missing", 1)).toBe(doc);
  });
});

describe("raiseTracks", () => {
  it("把指定轨道整体提到最上方，并保持给定顺序", () => {
    let doc = addTrack(addTrack(addTrack(newProject())));
    doc = addTrackAt(doc, doc.tracks.length, "字幕");
    const subtitle = doc.tracks[3];
    const second = doc.tracks[1];
    const next = raiseTracks(doc, [subtitle.id, second.id]);
    expect(next.tracks.map((track) => track.id)).toEqual([
      subtitle.id,
      second.id,
      doc.tracks[0].id,
      doc.tracks[2].id,
    ]);
  });

  it("已经是最上方时不产生新文档", () => {
    const doc = addTrack(addTrack(newProject()));
    expect(raiseTracks(doc, [doc.tracks[0].id, doc.tracks[1].id])).toBe(doc);
    expect(raiseTracks(doc, [])).toBe(doc);
    expect(raiseTracks(doc, ["missing"])).toBe(doc);
  });
});

describe("removeTrack", () => {
  it("removes the track and its clips", () => {
    const doc = addTrack(newProject());
    const next = removeTrack(doc, doc.tracks[0].id);
    expect(next.tracks).toHaveLength(0);
  });

  it("returns the same reference for an unknown id", () => {
    const doc = addTrack(newProject());
    expect(removeTrack(doc, "missing")).toBe(doc);
  });
});

describe("renameTrack", () => {
  it("renames a track and trims the input", () => {
    const doc = addTrack(newProject());
    const id = doc.tracks[0].id;
    const next = renameTrack(doc, id, "  字幕  ");
    expect(next.tracks[0].name).toBe("字幕");
    expect(renameTrack(doc, id, "   ")).toBe(doc);
    expect(renameTrack(doc, "missing", "字幕")).toBe(doc);
  });
});

describe("setTrackFlag", () => {
  it("toggles muted / visible / locked", () => {
    const doc = addTrack(newProject());
    const id = doc.tracks[0].id;
    const muted = setTrackFlag(doc, id, "muted", true);
    expect(muted.tracks[0].muted).toBe(true);
    const hidden = setTrackFlag(muted, id, "visible", false);
    expect(hidden.tracks[0].visible).toBe(false);
    const locked = setTrackFlag(hidden, id, "locked", true);
    expect(locked.tracks[0].locked).toBe(true);
    expect(setTrackFlag(locked, id, "locked", true)).toBe(locked);
  });
});
