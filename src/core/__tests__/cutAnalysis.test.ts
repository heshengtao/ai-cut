import { describe, expect, it } from "vitest";
import {
  buildParagraphs,
  detectFillers,
  detectPauses,
  mergeProposals,
  normalizeWord,
  totalDuration,
  withWordIds,
  wordIsCut,
} from "@/core/cutAnalysis";

/** 造一串词：`[文本, 起点, 终点]`。 */
function words(rows: [string, number, number][]) {
  return withWordIds(rows.map(([text, start, end]) => ({ text, start, end })));
}

describe("detectPauses", () => {
  it("1.4 秒停顿压缩到 0.3 秒，头尾各留一半", () => {
    const list = words([
      ["今天", 0, 0.5],
      ["我们", 1.9, 2.3],
    ]);
    const cuts = detectPauses(list);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].kind).toBe("pause");
    expect(cuts[0].srcStart).toBeCloseTo(0.65, 6);
    expect(cuts[0].srcEnd).toBeCloseTo(1.75, 6);
    expect(cuts[0].reason).toBe("1.4s → 0.3s");
  });

  it("句末保留得长一点", () => {
    const list = words([
      ["好的。", 0, 0.5],
      ["下一句", 2.0, 2.4],
    ]);
    const cuts = detectPauses(list);
    expect(cuts[0].srcStart).toBeCloseTo(0.7, 6);
    expect(cuts[0].srcEnd).toBeCloseTo(1.8, 6);
  });

  it("太短或太长的间隔都不算停顿", () => {
    expect(detectPauses(words([["a", 0, 0.5], ["b", 1.0, 1.2]]))).toHaveLength(0);
    expect(detectPauses(words([["a", 0, 0.5], ["b", 6.0, 6.2]]))).toHaveLength(0);
  });

  it("压缩后不足 0.15 秒就不剪", () => {
    const list = words([
      ["a", 0, 0.5],
      ["b", 1.1, 1.2],
    ]);
    // 间隔 0.6 秒不到阈值；调到 0.5 后保留 0.3，只剩 0.2 秒可剪。
    expect(detectPauses(list, { minPause: 0.5 })).toHaveLength(1);
    expect(detectPauses(list, { minPause: 0.5, keep: 0.9 })).toHaveLength(0);
  });
});

describe("detectFillers", () => {
  it("硬口癖直接命中", () => {
    const list = words([
      ["今天", 0, 0.4],
      ["嗯", 0.42, 0.6],
      ["我们", 0.62, 1.0],
    ]);
    const cuts = detectFillers(list);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].text).toBe("嗯");
    expect(cuts[0].srcStart).toBeCloseTo(0.42, 6);
  });

  it("软口癖没有停顿隔离时不剪", () => {
    const list = words([
      ["那个", 0, 0.3],
      ["东西", 0.32, 0.6],
    ]);
    expect(detectFillers(list)).toHaveLength(0);
  });

  it("软口癖被停顿隔开时剪掉", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["那个", 0.9, 1.15],
      ["开始", 1.7, 2.0],
    ]);
    const cuts = detectFillers(list);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].text).toBe("那个");
    expect(cuts[0].reason).toBe("口头禅");
  });

  it("句首紧跟停顿时也算口癖", () => {
    const list = words([
      ["那个", 0, 0.3],
      ["我们", 0.9, 1.3],
    ]);
    const cuts = detectFillers(list);
    expect(cuts[0].text).toBe("那个");
  });

  it("多词软口癖整段命中", () => {
    const list = words([
      ["you", 0, 0.2],
      ["know", 0.22, 0.4],
      ["this", 0.9, 1.2],
    ]);
    const cuts = detectFillers(list);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].text).toBe("youknow");
    expect(cuts[0].wordIds).toEqual(["w0", "w1"]);
  });

  it("关掉软口癖后只留硬口癖", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["那个", 0.9, 1.15],
      ["开始", 1.7, 2.0],
    ]);
    expect(detectFillers(list, { includeSoft: false })).toHaveLength(0);
  });
});

describe("mergeProposals", () => {
  it("重叠的只留第一条，已剪的不重复提", () => {
    const list = words([
      ["嗯", 0, 0.3],
      ["我们", 1.5, 1.9],
    ]);
    const merged = mergeProposals([detectFillers(list), detectPauses(list)]);
    expect(merged).toHaveLength(2);
    const again = mergeProposals([detectFillers(list), detectPauses(list)], [
      { srcStart: 0, srcEnd: 0.3 },
    ]);
    expect(again).toHaveLength(1);
    expect(totalDuration(again)).toBeGreaterThan(0);
  });

  it("按时间排序", () => {
    const merged = mergeProposals([
      [{ kind: "filler", srcStart: 5, srcEnd: 5.2, wordIds: [], text: "嗯", reason: "" }],
      [{ kind: "pause", srcStart: 1, srcEnd: 2, wordIds: [], text: "", reason: "" }],
    ]);
    expect(merged.map((cut) => cut.srcStart)).toEqual([1, 5]);
  });
});

describe("wordIsCut / buildParagraphs", () => {
  it("按词中点判断是否被剪", () => {
    const word = { start: 1, end: 2 };
    expect(wordIsCut(word, [{ srcStart: 1.4, srcEnd: 1.6 }])).toBe(true);
    expect(wordIsCut(word, [{ srcStart: 0, srcEnd: 1.1 }])).toBe(false);
  });

  it("长停顿与句末都会换段", () => {
    const list = words([
      ["你好。", 0, 0.5],
      ["我们", 1.6, 2.0],
      ["开始", 2.1, 2.5],
    ]);
    const paragraphs = buildParagraphs(list);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].map((word) => word.text)).toEqual(["你好。"]);
    expect(paragraphs[1].map((word) => word.text)).toEqual(["我们", "开始"]);
  });

  it("normalizeWord 去掉标点", () => {
    expect(normalizeWord("嗯，")).toBe("嗯");
    expect(normalizeWord("Um,")).toBe("um");
  });
});
