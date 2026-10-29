import { describe, expect, it } from "vitest";
import {
  buildParagraphs,
  defaultFillerWords,
  detectFillers,
  detectPauses,
  mergeProposals,
  normalizeWord,
  padCutRange,
  padFillerCuts,
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

  it("中文逐字词表也能命中多字软口癖", () => {
    const list = words([
      ["嗯", 0, 0.2],
      ["那", 1.1, 1.35],
      ["个", 1.35, 1.6],
      ["大", 1.8, 2.1],
    ]);
    const cuts = detectFillers(list);
    const soft = cuts.find((cut) => cut.kind === "filler" && cut.text === "那个");
    expect(soft).toBeTruthy();
    expect(soft?.srcStart).toBeCloseTo(1.1, 6);
    expect(soft?.wordIds).toEqual(["w1", "w2"]);
  });

  it("自定义过滤词按字匹配，不需要停顿隔离", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["啊", 0.4, 0.6],
      ["就", 0.6, 0.8],
      ["这样", 0.8, 1.2],
    ]);
    // 「啊就」在词表里是「啊」「就」两个字，按自定义词逐字拼起来匹配。
    const cuts = detectFillers(list, { custom: ["啊就"] });
    expect(cuts).toHaveLength(1);
    expect(cuts[0].srcStart).toBeCloseTo(0.4, 6);
    expect(cuts[0].wordIds).toEqual(["w1", "w2"]);
  });

  it("关掉软口癖后只留硬口癖", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["那个", 0.9, 1.15],
      ["开始", 1.7, 2.0],
    ]);
    expect(detectFillers(list, { includeSoft: false })).toHaveLength(0);
  });

  it("从默认词表里移除的语气词不再命中", () => {
    const list = words([
      ["今天", 0, 0.4],
      ["嗯", 0.42, 0.6],
      ["我们", 0.62, 1.0],
    ]);
    expect(detectFillers(list, { disabled: ["嗯"] })).toHaveLength(0);
  });

  it("从默认词表里移除的软口癖也不再命中", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["那个", 0.9, 1.15],
      ["开始", 1.7, 2.0],
    ]);
    expect(detectFillers(list, { disabled: ["那个"] })).toHaveLength(0);
  });

  it("英文自定义过滤词按整词匹配，不需要停顿隔离", () => {
    const list = words([
      ["I", 0, 0.15],
      ["mean", 0.15, 0.35],
      ["this", 0.4, 0.7],
    ]);
    const cuts = detectFillers(list, { custom: ["I mean"] });
    expect(cuts).toHaveLength(1);
    expect(cuts[0].srcStart).toBeCloseTo(0, 6);
    expect(cuts[0].srcEnd).toBeCloseTo(0.35, 6);
  });
});

describe("defaultFillerWords", () => {
  it("默认过滤词覆盖中英文的语气词与口头禅", () => {
    const defaults = defaultFillerWords();
    expect(defaults.hard).toContain("嗯");
    expect(defaults.hard).toContain("um");
    expect(defaults.soft).toContain("那个");
    expect(defaults.soft).toContain("you know");
  });
});

describe("padFillerCuts", () => {
  it("口癖剪口向两侧静音扩展，不越过相邻字", () => {
    const list = words([
      ["我们", 0, 0.6],
      ["嗯", 0.9, 1.1],
      ["开始", 1.5, 1.9],
    ]);
    const cuts = padFillerCuts(detectFillers(list), list, { pad: 0.15, guard: 0.02 });
    expect(cuts).toHaveLength(1);
    expect(cuts[0].srcStart).toBeCloseTo(0.75, 6);
    expect(cuts[0].srcEnd).toBeCloseTo(1.25, 6);
  });

  it("相邻字挨得近时只扩展到安全间隔", () => {
    const list = words([
      ["我们", 0, 0.44],
      ["嗯", 0.5, 0.6],
      ["开始", 0.7, 0.9],
    ]);
    const cuts = padFillerCuts(detectFillers(list), list, { pad: 0.2, guard: 0.02 });
    expect(cuts[0].srcStart).toBeCloseTo(0.46, 6);
    expect(cuts[0].srcEnd).toBeCloseTo(0.68, 6);
  });

  it("停顿剪口不扩展，保留设置里的呼吸时间", () => {
    const list = words([
      ["今天", 0, 0.5],
      ["我们", 1.9, 2.3],
    ]);
    const pauses = detectPauses(list);
    const padded = padFillerCuts(pauses, list, { pad: 0.2 });
    expect(padded[0].srcStart).toBeCloseTo(0.65, 6);
    expect(padded[0].srcEnd).toBeCloseTo(1.75, 6);
  });

  it("相邻的两个口癖向中间扩展，不留缝", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["嗯", 0.6, 0.7],
      ["呃", 0.71, 0.82],
      ["开始", 1.2, 1.6],
    ]);
    const cuts = padFillerCuts(detectFillers(list), list, { pad: 0.1, guard: 0.02 });
    expect(cuts).toHaveLength(2);
    expect(cuts[0].srcEnd).toBeCloseTo(0.7, 6);
    expect(cuts[1].srcStart).toBeCloseTo(0.71, 6);
    // 只隔 10ms：合并时并成一条，不会在中间留下没剪到的气口。
    const merged = mergeProposals([cuts]);
    expect(merged).toHaveLength(1);
    expect(merged[0].srcStart).toBeCloseTo(0.5, 6);
    expect(merged[0].srcEnd).toBeCloseTo(0.92, 6);
  });
});

describe("padCutRange", () => {
  it("手动剪口同样向两侧静音扩展", () => {
    const list = words([
      ["我们", 0, 0.4],
      ["嗯", 0.8, 1.0],
      ["开始", 1.4, 1.8],
    ]);
    const padded = padCutRange(list, 0.8, 1.0, { pad: 0.1, guard: 0.02 });
    expect(padded.start).toBeCloseTo(0.7, 6);
    expect(padded.end).toBeCloseTo(1.1, 6);
  });

  it("没有相邻词时只按扩展时长", () => {
    const list = words([["嗯", 0.5, 0.7]]);
    const padded = padCutRange(list, 0.5, 0.7, { pad: 0.1 });
    expect(padded.start).toBeCloseTo(0.4, 6);
    expect(padded.end).toBeCloseTo(0.8, 6);
  });
});

describe("mergeProposals", () => {
  it("口癖与停顿不重叠，已剪过的不重复提", () => {
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

  it("扩张后重叠的口癖合并成一条，不会丢掉后半段", () => {
    const merged = mergeProposals([
      [
        { kind: "filler", srcStart: 0.9, srcEnd: 1.3, wordIds: ["w1"], text: "嗯", reason: "" },
        { kind: "filler", srcStart: 1.15, srcEnd: 1.55, wordIds: ["w2"], text: "呃", reason: "" },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].srcStart).toBeCloseTo(0.9, 6);
    expect(merged[0].srcEnd).toBeCloseTo(1.55, 6);
    expect(merged[0].text).toContain("嗯");
    expect(merged[0].text).toContain("呃");
  });

  it("停顿与口癖重叠时优先保留口癖，停顿只留没被吃掉的部分", () => {
    const merged = mergeProposals([
      [
        { kind: "pause", srcStart: 0.65, srcEnd: 1.35, wordIds: ["w0", "w1"], text: "", reason: "" },
        { kind: "filler", srcStart: 1.2, srcEnd: 1.7, wordIds: ["w1"], text: "嗯", reason: "" },
      ],
    ]);
    const filler = merged.find((cut) => cut.kind === "filler");
    const pause = merged.find((cut) => cut.kind === "pause");
    expect(filler?.srcStart).toBeCloseTo(1.2, 6);
    expect(pause?.srcEnd).toBeCloseTo(1.2, 6);
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        expect(
          merged[i].srcEnd <= merged[j].srcStart || merged[j].srcEnd <= merged[i].srcStart,
        ).toBe(true);
      }
    }
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
