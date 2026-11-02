import { describe, expect, it } from "vitest";
import type { SubtitleEntry } from "@/core/subtitleFile";
import { createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import { insertCueTrack, placeSubtitleCues, uniqueCueTrackName } from "@/core/subtitleTrack";

const cues: SubtitleEntry[] = [
  { start: 0, end: 1, text: "第一句" },
  { start: 1.2, end: 2, text: "第二句" },
];

describe("字幕轨层级", () => {
  it("新建字幕轨插到最上方", () => {
    let doc = newProject();
    doc = addTrack(doc, "视频");
    doc = addTrack(doc, "音频");

    const next = insertCueTrack(doc, cues, "字幕");
    expect(next.tracks[0].name).toBe("字幕");
    expect(next.tracks[0].clips).toHaveLength(2);
    expect(next.tracks.map((track) => track.name)).toEqual(["字幕", "视频", "音频"]);
  });

  it("同名字幕轨已存在时新建 `字幕 2`，并同样放在最上方", () => {
    let doc = newProject();
    doc = addTrack(doc, "字幕");
    doc = addTrack(doc, "视频");

    const next = insertCueTrack(doc, cues, "字幕");
    expect(next.tracks[0].name).toBe("字幕 2");
    expect(uniqueCueTrackName(next, "字幕")).toBe("字幕 3");
  });

  it("导入字幕复用旧轨时，把旧轨提回最上方", () => {
    let doc = newProject();
    doc = addTrack(doc, "视频");
    doc = addTrack(doc, "字幕");
    const videoTrack = doc.tracks[0].id;
    doc = addClip(
      doc,
      videoTrack,
      createClip({ assetId: "a1", trackId: videoTrack, start: 0, duration: 10 }),
    );
    // 字幕轨原本在底部（例如被拖下去过）。
    expect(doc.tracks[1].name).toBe("字幕");

    const next = placeSubtitleCues(doc, [{ start: 3, end: 4, text: "补一句" }], "字幕");
    expect(next.tracks[0].name).toBe("字幕");
    expect(next.tracks[0].clips.at(-1)?.text).toBe("补一句");
    expect(next.tracks[1].name).toBe("视频");
  });

  it("重叠条目自动拆到第二条字幕轨，且两条都在视频轨之上", () => {
    let doc = newProject();
    doc = addTrack(doc, "视频");
    const next = placeSubtitleCues(
      doc,
      [
        { start: 0, end: 2, text: "甲" },
        { start: 1, end: 3, text: "乙" },
      ],
      "字幕",
    );
    const names = next.tracks.map((track) => track.name);
    expect(names).toEqual(["字幕 2", "字幕", "视频"]);
  });
});
