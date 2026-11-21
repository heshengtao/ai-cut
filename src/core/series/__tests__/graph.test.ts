import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode } from "@/core/ops/episodes";
import {
  derivedChain,
  incoming,
  isDerived,
  optionsOf,
  orderedEpisodes,
  seriesEdges,
  stepOf,
} from "@/core/series/graph";
import type { Project, SeriesEdge } from "@/types/project";

/** 三集：分P 1 / 第二集 / 第三集。 */
function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

/** 直接挂一张自定义图（只测纯图函数，不经过 ops）。 */
function withEdges(doc: Project, edges: SeriesEdge[]): Project {
  return {
    ...doc,
    seriesGraph: { custom: true, edges, positions: {} },
  } as Project;
}

describe("orderedEpisodes / derivedChain", () => {
  it("按 order 排序，忽略数组顺序", () => {
    const doc = threeEpisodes();
    const [a, b, c] = doc.episodes;
    const shuffled = {
      ...doc,
      episodes: [
        { ...c, order: 0 },
        { ...a, order: 1 },
        { ...b, order: 2 },
      ],
    } as Project;
    expect(orderedEpisodes(shuffled).map((episode) => episode.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
  });

  it("派生链是相邻两集一条无选项边，id 稳定", () => {
    const doc = threeEpisodes();
    const edges = derivedChain(doc);
    expect(edges).toHaveLength(2);
    expect(edges[0].from).toBe(doc.episodes[0].id);
    expect(edges[0].to).toBe(doc.episodes[1].id);
    expect(edges[0].label).toBeUndefined();
    expect(edges[0].id).toBe(`chain:${doc.episodes[0].id}->${doc.episodes[1].id}`);
    expect(derivedChain(doc)).toEqual(edges);
  });

  it("单集没有边", () => {
    expect(derivedChain(newProject())).toEqual([]);
  });
});

describe("seriesEdges / isDerived", () => {
  it("默认派生；custom 后改用存盘边", () => {
    const doc = threeEpisodes();
    expect(isDerived(doc)).toBe(true);
    expect(seriesEdges(doc)).toHaveLength(2);

    const custom = withEdges(doc, [
      { id: "e1", from: doc.episodes[0].id, to: doc.episodes[2].id },
    ]);
    expect(isDerived(custom)).toBe(false);
    expect(seriesEdges(custom).map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("custom 且 edges 为空时不回退派生链", () => {
    const doc = withEdges(threeEpisodes(), []);
    expect(seriesEdges(doc)).toEqual([]);
  });

  it("悬空边（目标分P 已不存在）被过滤", () => {
    const doc = threeEpisodes();
    const custom = withEdges(doc, [
      { id: "ok", from: doc.episodes[0].id, to: doc.episodes[1].id },
      { id: "bad", from: doc.episodes[0].id, to: "gone" },
    ]);
    expect(seriesEdges(custom).map((edge) => edge.id)).toEqual(["ok"]);
  });
});

describe("outgoing / incoming / optionsOf", () => {
  it("多出边按数组顺序变成选项，未命名标记正确", () => {
    const doc = threeEpisodes();
    const custom = withEdges(doc, [
      { id: "a", from: doc.episodes[0].id, to: doc.episodes[1].id },
      { id: "b", from: doc.episodes[0].id, to: doc.episodes[2].id, label: "  逃 " },
      { id: "c", from: doc.episodes[0].id, to: doc.episodes[1].id },
    ]);
    expect(optionsOf(custom, doc.episodes[0].id)).toEqual([
      { edgeId: "a", to: doc.episodes[1].id, label: "", unnamed: true },
      { edgeId: "b", to: doc.episodes[2].id, label: "逃", unnamed: false },
      { edgeId: "c", to: doc.episodes[1].id, label: "", unnamed: true },
    ]);
    expect(incoming(custom, doc.episodes[1].id).map((edge) => edge.id)).toEqual(["a", "c"]);
  });
});

describe("stepOf", () => {
  it("没有出边 → end", () => {
    const doc = newProject();
    expect(stepOf(doc, doc.episodes[0].id, new Set())).toEqual({ kind: "end" });
  });

  it("唯一无选项出边 → auto；目标已访问 → loop", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    expect(stepOf(doc, first.id, new Set())).toEqual({ kind: "auto", to: second.id });
    expect(stepOf(doc, first.id, new Set([second.id]))).toEqual({ kind: "loop", to: second.id });
  });

  it("唯一出边带选项 → choices", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id, label: "继续" },
    ]);
    expect(stepOf(custom, first.id, new Set())).toEqual({
      kind: "choices",
      options: [{ edgeId: "a", to: second.id, label: "继续", unnamed: false }],
    });
  });

  it("两条出边 → choices（即使目标已访问也不拦）", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id },
      { id: "b", from: first.id, to: third.id },
    ]);
    const step = stepOf(custom, first.id, new Set([second.id, third.id]));
    expect(step.kind).toBe("choices");
  });

  it("自环无选项 → loop", () => {
    const doc = newProject();
    const id = doc.episodes[0].id;
    const custom = withEdges(doc, [{ id: "self", from: id, to: id }]);
    expect(stepOf(custom, id, new Set([id]))).toEqual({ kind: "loop", to: id });
  });
});
