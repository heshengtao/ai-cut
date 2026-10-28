import { describe, expect, it } from "vitest";
import type { CutScope } from "@/types/project";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addTrack } from "@/core/ops/tracks";
import { addClip, setClipText } from "@/core/ops/clips";
import { buildCutCues, placeCueTrack } from "@/core/cutSubtitles";

function scopeWith(overrides: Partial<CutScope> = {}): CutScope {
  const base: CutScope = {
    id: "s1",
    assetId: "a1",
    trackId: "t1",
    baseIn: 0,
    baseOut: 4,
    baseStart: 0,
    template: {
      id: "p1",
      assetId: "a1",
      trackId: "t1",
      start: 0,
      duration: 2,
      in: 0,
    },
    pieces: ["p1", "p2"],
    cuts: [],
  };
  return { ...base, ...overrides };
}

const pieces = [
  { id: "p1", assetId: "a1", trackId: "t1", start: 0, duration: 2, in: 0 },
  { id: "p2", assetId: "a1", trackId: "t1", start: 2, duration: 1.5, in: 2.5 },
];

describe("buildCutCues", () => {
  it("按停顿与句子归行，剪掉的词不进字幕", () => {
    const scope = scopeWith({
      cuts: [
        { id: "c1", srcStart: 2.0, srcEnd: 2.5, kind: "filler", text: "嗯", createdAt: 0 },
      ],
    });
    const words = [
      { text: "今天", start: 0, end: 0.3 },
      { text: "我们", start: 0.35, end: 0.7 },
      { text: "嗯", start: 2.1, end: 2.4 },
      { text: "开始", start: 2.6, end: 2.9 },
    ];
    const cues = buildCutCues(scope, words, pieces, 30);
    expect(cues.map((cue) => cue.text)).toEqual(["今天我们", "开始"]);
    // 剪掉 0.5 秒后，「开始」落在 2.1 秒。
    expect(cues[1].start).toBeCloseTo(2.1, 6);
  });

  it("长停顿换行，同一句不跨剪口", () => {
    const scope = scopeWith();
    const words = [
      { text: "第一句", start: 0, end: 0.9 },
      { text: "第二句", start: 2.0, end: 2.9 },
    ];
    const cues = buildCutCues(scope, words, pieces, 30);
    expect(cues).toHaveLength(2);
  });

  it("英文词之间补空格", () => {
    const scope = scopeWith();
    const words = [
      { text: "hello", start: 0, end: 0.3 },
      { text: "world", start: 0.35, end: 0.7 },
    ];
    const cues = buildCutCues(scope, words, pieces, 30);
    expect(cues[0].text).toBe("hello world");
  });

  it("没有词或没有片段时返回空", () => {
    expect(buildCutCues(scopeWith(), [], pieces, 30)).toEqual([]);
    expect(
      buildCutCues(scopeWith({ pieces: ["nope"] }), [{ text: "嗯", start: 0, end: 1 }], pieces, 30),
    ).toEqual([]);
  });
});

describe("placeCueTrack", () => {
  function setup() {
    let doc = newProject();
    doc = addTrack(doc, "口播");
    const trackId = doc.tracks[0].id;
    doc = addAsset(
      doc,
      createAsset({ id: "a1", name: "t.mp4", kind: "video", src: "/tmp/t.mp4", duration: 10 }),
    );
    doc = addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 10 }));
    return doc;
  }

  it("建一条字幕轨并放入条目", () => {
    const doc = setup();
    const next = placeCueTrack(
      doc,
      [
        { start: 0, end: 1, text: "第一句", key: "0-2" },
        { start: 1.2, end: 2, text: "第二句", key: "3-5" },
      ],
      "口播字幕",
    );
    const track = next.tracks.find((item) => item.name === "口播字幕");
    expect(track).toBeTruthy();
    expect(track?.clips).toHaveLength(2);
    expect(track?.clips[0].text).toBe("第一句");
  });

  it("同一句重铺时保留改过的文案，换句才重新生成", () => {
    const doc = setup();
    const first = placeCueTrack(doc, [{ start: 0, end: 1, text: "原来的", key: "0-2" }], "口播字幕");
    const track = first.tracks.find((item) => item.name === "口播字幕")!;
    const edited = setClipText(first, track.clips[0].id, "改过的"); 
    // 同一句（key 相同），时间整体后移：文案保留
    const shifted = placeCueTrack(edited, [{ start: 2, end: 3, text: "自动生成", key: "0-2" }], "口播字幕");
    const nextTrack = shifted.tracks.find((item) => item.name === "口播字幕")!;
    expect(nextTrack.clips[0].text).toBe("改过的");
    expect(nextTrack.clips[0].start).toBe(2);
    // 句子被切开（key 变了）：用新生成的文案
    const split = placeCueTrack(shifted, [{ start: 2, end: 3, text: "新句子", key: "0-1" }], "口播字幕");
    const splitTrack = split.tracks.find((item) => item.name === "口播字幕")!;
    expect(splitTrack.clips[0].text).toBe("新句子");
  });

  it("再次生成时替换同名轨，不叠加", () => {
    const doc = setup();
    const once = placeCueTrack(doc, [{ start: 0, end: 1, text: "第一句", key: "0-2" }], "口播字幕");
    const twice = placeCueTrack(once, [{ start: 0, end: 1, text: "新的", key: "3-5" }], "口播字幕");
    const tracks = twice.tracks.filter((item) => item.name === "口播字幕");
    expect(tracks).toHaveLength(1);
    expect(tracks[0].clips).toHaveLength(1);
    expect(tracks[0].clips[0].text).toBe("新的");
  });
});
