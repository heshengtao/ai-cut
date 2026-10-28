import { describe, expect, it } from "vitest";
import type { Project } from "@/types/project";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addTrack } from "@/core/ops/tracks";
import { addClip } from "@/core/ops/clips";
import {
  allCuts,
  applyCuts,
  clearScope,
  cutSourceRange,
  keptSpans,
  removeCut,
  scopeOfClip,
  updateCutRange,
} from "@/core/cuts";

/** 一条 10 秒的口播素材 + 一条字幕轨，便于检查跨轨联动。 */
function setup() {
  let doc = newProject();
  doc = addTrack(doc, "口播");
  doc = addTrack(doc, "字幕");
  const videoTrack = doc.tracks[0].id;
  const textTrack = doc.tracks[1].id;
  doc = addAsset(
    doc,
    createAsset({
      id: "a1",
      name: "talk.mp4",
      kind: "video",
      src: "/tmp/talk.mp4",
      duration: 10,
    }),
  );
  const main = createClip({ assetId: "a1", trackId: videoTrack, start: 0, duration: 10 });
  const subtitle = createClip({
    assetId: "",
    trackId: textTrack,
    start: 6,
    duration: 2,
    text: "后半句",
  });
  doc = addClip(doc, videoTrack, main);
  doc = addClip(doc, textTrack, subtitle);
  return { doc, videoTrack, textTrack, main, subtitle };
}

function mainClips(doc: Project, trackId: string) {
  return doc.tracks.find((track) => track.id === trackId)!.clips;
}

describe("cutSourceRange", () => {
  it("剪掉中段后把素材切成两段，后面的片段左移", () => {
    const { doc, videoTrack, textTrack, main } = setup();
    const next = cutSourceRange(doc, main.id, 2, 3, "filler", "嗯");

    const pieces = mainClips(next, videoTrack);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].start).toBe(0);
    expect(pieces[0].duration).toBeCloseTo(2, 6);
    expect(pieces[0].in).toBe(0);
    expect(pieces[1].start).toBeCloseTo(2, 6);
    expect(pieces[1].duration).toBeCloseTo(7, 6);
    expect(pieces[1].in).toBeCloseTo(3, 6);

    // 字幕片段整体左移 1 秒，仍然对齐后面的内容。
    const subtitles = mainClips(next, textTrack);
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].start).toBeCloseTo(5, 6);
    expect(subtitles[0].text).toBe("后半句");
  });

  it("剪开头时不留空片段", () => {
    const { doc, videoTrack, main } = setup();
    const next = cutSourceRange(doc, main.id, 0, 1.5, "pause", "");
    const pieces = mainClips(next, videoTrack);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].start).toBe(0);
    expect(pieces[0].in).toBeCloseTo(1.5, 6);
    expect(pieces[0].duration).toBeCloseTo(8.5, 6);
  });

  it("跨剪口的字幕不拆成两段，只压短", () => {
    const { doc, videoTrack, textTrack, main } = setup();
    const straddle = createClip({
      assetId: "",
      trackId: textTrack,
      start: 1,
      duration: 3,
      text: "这一句跨过了剪口",
    });
    let next = addClip(doc, textTrack, straddle);
    next = cutSourceRange(next, main.id, 2, 3, "pause", "");

    const subtitles = mainClips(next, textTrack).filter((clip) => clip.text?.includes("跨过"));
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].start).toBeCloseTo(1, 6);
    expect(subtitles[0].duration).toBeCloseTo(2, 6);
    expect(mainClips(next, videoTrack)).toHaveLength(2);
  });

  it("重复剪同一段是幂等的", () => {
    const { doc, videoTrack, main } = setup();
    const once = cutSourceRange(doc, main.id, 2, 3, "filler", "嗯");
    const twice = cutSourceRange(once, main.id, 2, 3, "filler", "嗯");
    expect(twice).toBe(once);
    expect(allCuts(twice)).toHaveLength(1);
    expect(mainClips(twice, videoTrack)).toHaveLength(2);
  });

  it("相邻的两刀会合并成一条剪口", () => {
    const { doc, main } = setup();
    let next = cutSourceRange(doc, main.id, 2, 3, "filler", "嗯");
    next = cutSourceRange(next, main.id, 3.01, 4, "filler", "呃");
    expect(allCuts(next)).toHaveLength(1);
  });
});

describe("removeCut", () => {
  it("还原后片段与其它轨道回到剪之前", () => {
    const { doc, videoTrack, textTrack, main, subtitle } = setup();
    const cut = cutSourceRange(doc, main.id, 2, 3, "filler", "嗯");
    const scope = scopeOfClip(cut, main.id)!;
    const restored = removeCut(cut, scope.id, scope.cuts[0].id);

    const pieces = mainClips(restored, videoTrack);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].start).toBe(0);
    expect(pieces[0].duration).toBeCloseTo(10, 6);
    expect(pieces[0].in).toBe(0);

    const subtitles = mainClips(restored, textTrack);
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].start).toBeCloseTo(subtitle.start, 6);
    expect(restored.cutScopes?.[0].cuts).toHaveLength(0);
  });

  it("多刀可以任意顺序还原", () => {
    const { doc, videoTrack, main } = setup();
    let next = cutSourceRange(doc, main.id, 1, 2, "filler", "嗯");
    next = cutSourceRange(next, main.id, 4, 5, "pause", "");
    next = cutSourceRange(next, main.id, 7, 8, "filler", "呃");
    const scope = scopeOfClip(next, main.id)!;
    expect(scope.cuts).toHaveLength(3);

    // 还原中间那一刀。
    const middle = scope.cuts[1];
    const restored = removeCut(next, scope.id, middle.id);
    const pieces = mainClips(restored, videoTrack);
    const total = pieces.reduce((sum, clip) => sum + clip.duration, 0);
    expect(total).toBeCloseTo(8, 6);
    // 三段的素材范围仍然连续、不重叠。
    const spans = pieces
      .slice()
      .sort((a, b) => a.in - b.in)
      .map((clip) => [clip.in, clip.in + clip.duration] as const);
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index][0]).toBeGreaterThanOrEqual(spans[index - 1][1] - 1e-6);
    }
  });
});

describe("updateCutRange", () => {
  it("改剪口范围后总时长跟着变", () => {
    const { doc, videoTrack, main } = setup();
    const cut = cutSourceRange(doc, main.id, 2, 3, "pause", "");
    const scope = scopeOfClip(cut, main.id)!;
    const wider = updateCutRange(cut, scope.id, scope.cuts[0].id, 2, 4);
    const total = mainClips(wider, videoTrack).reduce((sum, clip) => sum + clip.duration, 0);
    expect(total).toBeCloseTo(8, 6);
  });

  it("范围没变时不动文档", () => {
    const { doc, main } = setup();
    const cut = cutSourceRange(doc, main.id, 2, 3, "pause", "");
    const scope = scopeOfClip(cut, main.id)!;
    expect(updateCutRange(cut, scope.id, scope.cuts[0].id, 2, 3)).toBe(cut);
  });
});

describe("clearScope", () => {
  it("全部还原", () => {
    const { doc, main } = setup();
    let next = cutSourceRange(doc, main.id, 1, 2, "filler", "嗯");
    next = cutSourceRange(next, main.id, 4, 5, "pause", "");
    const scope = scopeOfClip(next, main.id)!;
    const cleared = clearScope(next, scope.id);
    expect(allCuts(cleared)).toHaveLength(0);
  });
});

describe("keptSpans", () => {
  it("按剪口切分素材区间", () => {
    const cuts = [
      { id: "1", kind: "filler" as const, srcStart: 2, srcEnd: 3, text: "", createdAt: 0 },
      { id: "2", kind: "filler" as const, srcStart: 5, srcEnd: 6, text: "", createdAt: 0 },
    ];
    expect(keptSpans(0, 10, cuts)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 10 },
    ]);
  });

  it("剪口超出范围时按边界夹紧", () => {
    const cuts = [
      { id: "1", kind: "filler" as const, srcStart: -1, srcEnd: 2, text: "", createdAt: 0 },
      { id: "2", kind: "filler" as const, srcStart: 8, srcEnd: 20, text: "", createdAt: 0 },
    ];
    expect(keptSpans(0, 10, cuts)).toEqual([{ start: 2, end: 8 }]);
  });
});

describe("applyCuts", () => {
  it("一次加多条剪口，总时长与逐条剪一致", () => {
    const { doc, videoTrack, main } = setup();
    const batch = applyCuts(doc, main.id, [
      { kind: "filler", srcStart: 1, srcEnd: 2, text: "嗯" },
      { kind: "pause", srcStart: 4, srcEnd: 5, text: "" },
      { kind: "filler", srcStart: 7, srcEnd: 7.5, text: "呃" },
    ]);
    let step = cutSourceRange(doc, main.id, 1, 2, "filler", "嗯");
    step = cutSourceRange(step, main.id, 4, 5, "pause", "");
    step = cutSourceRange(step, main.id, 7, 7.5, "filler", "呃");

    const sum = (next: Project) =>
      mainClips(next, videoTrack).reduce((total, clip) => total + clip.duration, 0);
    expect(sum(batch)).toBeCloseTo(sum(step), 6);
    expect(batch.cutScopes?.[0].cuts).toHaveLength(3);
  });

  it("把词表存进剪口组，重新打开工程还能逐字审查", () => {
    const { doc, main } = setup();
    const words = [
      { text: "你", start: 0, end: 0.3 },
      { text: "好", start: 0.3, end: 0.6 },
    ];
    const next = applyCuts(doc, main.id, [{ kind: "filler", srcStart: 0.1, srcEnd: 0.2, text: "" }], words, true);
    expect(next.cutScopes?.[0].words).toEqual(words);
    expect(next.cutScopes?.[0].timed).toBe(true);
  });

  it("与已有剪口重叠的提案会被跳过", () => {
    const { doc, main } = setup();
    const first = cutSourceRange(doc, main.id, 2, 3, "filler", "嗯");
    const second = applyCuts(first, main.id, [
      { kind: "pause", srcStart: 2, srcEnd: 3, text: "" },
      { kind: "filler", srcStart: 5, srcEnd: 5.5, text: "呃" },
    ]);
    expect(second.cutScopes?.[0].cuts).toHaveLength(2);
  });
});

describe("多刀之后的时间线", () => {
  it("片段首尾相接、不重复、不重叠", () => {
    const { doc, videoTrack, main } = setup();
    let next = cutSourceRange(doc, main.id, 1, 2, "filler", "嗯");
    next = cutSourceRange(next, main.id, 4, 5, "pause", "");
    next = cutSourceRange(next, main.id, 7, 8, "filler", "呃");
    const pieces = mainClips(next, videoTrack);
    expect(pieces).toHaveLength(4);
    for (let index = 1; index < pieces.length; index += 1) {
      const previous = pieces[index - 1];
      expect(pieces[index].start).toBeCloseTo(previous.start + previous.duration, 6);
    }
    const total = pieces.reduce((sum, clip) => sum + clip.duration, 0);
    expect(total).toBeCloseTo(7, 6);
  });
});
