import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@/types/project";
import { createClip, newProject } from "@/core/factory";
import { addClip, removeClips, updateClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import {
  clearClipClipboard,
  clipboardCount,
  copyClipsToClipboard,
  pasteClips,
  pasteFromClipboard,
} from "@/core/clipClipboard";

function setup(): { doc: Project; top: string; bottom: string } {
  let doc = newProject();
  doc = addTrack(doc, "上");
  doc = addTrack(doc, "下");
  const top = doc.tracks[0].id;
  const bottom = doc.tracks[1].id;
  doc = addClip(doc, top, createClip({ assetId: "a1", trackId: top, start: 1, duration: 2 }));
  doc = addClip(doc, bottom, createClip({ assetId: "a2", trackId: bottom, start: 4, duration: 3 }));
  return { doc, top, bottom };
}

beforeEach(() => clearClipClipboard());

describe("copy / paste", () => {
  it("复制时记录相对轨道与相对时间，粘贴保持组内偏移", () => {
    const { doc, top, bottom } = setup();
    const first = doc.tracks[0].clips[0];
    const second = doc.tracks[1].clips[0];

    expect(copyClipsToClipboard(doc, [first.id, second.id])).toBe(2);
    expect(clipboardCount.value).toBe(2);

    const pasted = pasteFromClipboard(doc, 10);
    expect(pasted.ids).toHaveLength(2);

    const pastedTop = pasted.doc.tracks.find((track) => track.id === top)!.clips;
    const pastedBottom = pasted.doc.tracks.find((track) => track.id === bottom)!.clips;
    // 原来差 3 秒，粘贴后仍然差 3 秒。
    expect(pastedTop[1].start).toBeCloseTo(10, 6);
    expect(pastedBottom[1].start).toBeCloseTo(13, 6);
  });

  it("剪贴板存的是快照，之后改工程不影响粘贴结果", () => {
    const { doc } = setup();
    const clip = doc.tracks[0].clips[0];
    copyClipsToClipboard(doc, [clip.id]);

    const modified = updateClip(doc, clip.id, { start: 6 });
    const pasted = pasteFromClipboard(modified, 0);
    const placed = pasted.doc.tracks[0].clips.find((item) => pasted.ids.includes(item.id))!;
    expect(placed.start).toBeCloseTo(0, 6);
  });

  it("落点被占用时向右顺延，不产生重叠", () => {
    const { doc, top } = setup();
    const clip = doc.tracks[0].clips[0];
    copyClipsToClipboard(doc, [clip.id]);
    // 复制后把原片段换成一条 0–5 秒的占位片段，粘贴 0 秒处必须顺延到 5 秒。
    const moved = removeClips(doc, [clip.id]);
    const busy = addClip(
      moved,
      top,
      createClip({ assetId: "a3", trackId: top, start: 0, duration: 5 }),
    );

    const pasted = pasteFromClipboard(busy, 0);
    const placed = pasted.doc.tracks[0].clips.find((item) => pasted.ids.includes(item.id))!;
    expect(placed.start).toBeCloseTo(5, 6);
  });

  it("原轨道被删掉时夹到最后一条轨道，锁定轨道则换一条", () => {
    const { doc } = setup();
    const clip = doc.tracks[1].clips[0];
    copyClipsToClipboard(doc, [clip.id]);

    const onlyTop: Project = { ...doc, tracks: [doc.tracks[0]] };
    const pasted = pasteFromClipboard(onlyTop, 20);
    expect(pasted.doc.tracks[0].clips.some((item) => pasted.ids.includes(item.id))).toBe(true);

    const locked: Project = {
      ...doc,
      tracks: doc.tracks.map((track, index) => (index === 1 ? { ...track, locked: true } : track)),
    };
    const fallback = pasteFromClipboard(locked, 30);
    expect(fallback.doc.tracks[0].clips.some((item) => fallback.ids.includes(item.id))).toBe(true);
  });

  it("空剪贴板不产生改动", () => {
    const { doc } = setup();
    const result = pasteClips(doc, [], 5);
    expect(result.doc).toBe(doc);
    expect(result.ids).toEqual([]);
  });
});
