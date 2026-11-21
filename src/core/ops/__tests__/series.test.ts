import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode, duplicateEpisode, removeEpisode } from "@/core/ops/episodes";
import {
  autoLayoutSeries,
  connectEpisode,
  disconnectEpisodeEdge,
  materializeGraph,
  moveSeriesCard,
  pruneSeriesEdges,
  resetSeriesGraph,
  setEpisodeEdgeLabel,
} from "@/core/ops/series";
import { derivedChain, isDerived, seriesEdges, stepOf } from "@/core/series/graph";
import type { Project } from "@/types/project";

function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

describe("materializeGraph", () => {
  it("派生链落成 custom 边，id 保持 chain: 前缀", () => {
    const doc = threeEpisodes();
    const next = materializeGraph(doc);
    expect(isDerived(next)).toBe(false);
    expect(next.seriesGraph?.edges).toEqual(derivedChain(doc));
    expect(next.tracks).toBe(next.episodes[0].tracks);
  });

  it("已经是自定义图时原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    expect(materializeGraph(doc)).toBe(doc);
  });
});

describe("connectEpisode", () => {
  it("在派生图上连新边：原有时间链仍在，再追加一条", () => {
    const doc = threeEpisodes();
    const [first, , third] = doc.episodes;
    const next = connectEpisode(doc, first.id, third.id);
    expect(isDerived(next)).toBe(false);
    const edges = seriesEdges(next);
    expect(edges).toHaveLength(3);
    expect(edges.slice(0, 2)).toEqual(derivedChain(doc));
    expect(edges[2].from).toBe(first.id);
    expect(edges[2].to).toBe(third.id);
    expect(edges[2].label).toBeUndefined();
    expect(stepOf(next, first.id, new Set()).kind).toBe("choices");
  });

  it("拒绝重复边与不存在的分P", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    expect(connectEpisode(doc, first.id, second.id)).toBe(doc);
    expect(connectEpisode(doc, first.id, "gone")).toBe(doc);
    const custom = connectEpisode(doc, first.id, doc.episodes[2].id);
    expect(connectEpisode(custom, first.id, doc.episodes[2].id)).toBe(custom);
  });

  it("自环允许", () => {
    const doc = newProject();
    const id = doc.episodes[0].id;
    const next = connectEpisode(doc, id, id);
    expect(seriesEdges(next)).toHaveLength(1);
    expect(seriesEdges(next)[0].from).toBe(id);
    expect(seriesEdges(next)[0].to).toBe(id);
  });
});

describe("disconnectEpisodeEdge", () => {
  it("派生链上的边也能删，其余链保留", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc);
    const next = disconnectEpisodeEdge(doc, chain[0].id);
    expect(seriesEdges(next)).toEqual([chain[1]]);
  });

  it("删光后 custom 仍为 true，不回退派生链", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc);
    const one = disconnectEpisodeEdge(doc, chain[0].id);
    const empty = disconnectEpisodeEdge(one, chain[1].id);
    expect(empty.seriesGraph?.custom).toBe(true);
    expect(seriesEdges(empty)).toEqual([]);
  });

  it("找不到的边原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    expect(disconnectEpisodeEdge(doc, "nope")).toBe(doc);
  });
});

describe("setEpisodeEdgeLabel", () => {
  it("派生链上的边加选项 → 该出边变成选项", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const chain = derivedChain(doc)[0];
    const next = setEpisodeEdgeLabel(doc, chain.id, "  继续  ");
    expect(seriesEdges(next)[0].label).toBe("继续");
    expect(stepOf(next, first.id, new Set())).toEqual({
      kind: "choices",
      options: [{ edgeId: chain.id, to: second.id, label: "继续", unnamed: false }],
    });
  });

  it("空串清掉选项名", () => {
    const doc = threeEpisodes();
    const chain = derivedChain(doc)[0];
    const withLabel = setEpisodeEdgeLabel(doc, chain.id, "继续");
    const cleared = setEpisodeEdgeLabel(withLabel, chain.id, "   ");
    expect(seriesEdges(cleared)[0].label).toBeUndefined();
  });

  it("文案没变时原样返回", () => {
    const doc = materializeGraph(threeEpisodes());
    const chain = derivedChain(doc)[0];
    expect(setEpisodeEdgeLabel(doc, chain.id, "")).toBe(doc);
    expect(setEpisodeEdgeLabel(doc, "nope", "x")).toBe(doc);
  });
});

describe("moveSeriesCard / autoLayoutSeries", () => {
  it("只写坐标，不改 custom", () => {
    const doc = threeEpisodes();
    const target = doc.episodes[0].id;
    const next = moveSeriesCard(doc, target, 10, 20);
    expect(isDerived(next)).toBe(true);
    expect(next.seriesGraph?.positions[target]).toEqual({ x: 10, y: 20 });
    expect(next.tracks).toBe(next.episodes[0].tracks);
  });

  it("坐标非法或没变时不生效", () => {
    const doc = threeEpisodes();
    const target = doc.episodes[0].id;
    expect(moveSeriesCard(doc, target, Number.NaN, 0)).toBe(doc);
    expect(moveSeriesCard(doc, "gone", 1, 2)).toBe(doc);
    const moved = moveSeriesCard(doc, target, 10, 20);
    expect(moveSeriesCard(moved, target, 10, 20)).toBe(moved);
  });

  it("自动排列清空全部手动坐标", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0].id;
    const moved = moveSeriesCard(doc, first, 10, 20);
    const next = autoLayoutSeries(moved);
    expect(next.seriesGraph?.positions).toEqual({});
    expect(autoLayoutSeries(next)).toBe(next);
  });
});

describe("resetSeriesGraph / pruneSeriesEdges", () => {
  it("重建回到派生链，坐标保留", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0].id;
    const custom = moveSeriesCard(
      connectEpisode(doc, first, doc.episodes[2].id),
      first,
      99,
      88,
    );
    const reset = resetSeriesGraph(custom);
    expect(isDerived(reset)).toBe(true);
    expect(reset.seriesGraph?.positions[first]).toEqual({ x: 99, y: 88 });
    expect(seriesEdges(reset)).toEqual(derivedChain(doc));
  });

  it("prune 清掉悬空边与已删分P 的坐标", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const moved = moveSeriesCard(doc, first.id, 5, 6);
    const broken = {
      ...moved,
      episodes: [first, third],
      seriesGraph: {
        custom: true,
        edges: [
          { id: "keep", from: first.id, to: third.id },
          { id: "drop", from: second.id, to: third.id },
        ],
        positions: moved.seriesGraph!.positions,
      },
    } as Project;
    const next = pruneSeriesEdges(broken);
    expect(next.seriesGraph?.edges.map((edge) => edge.id)).toEqual(["keep"]);
    expect(next.seriesGraph?.positions[first.id]).toEqual({ x: 5, y: 6 });
  });

  it("没有图时 prune 原样返回", () => {
    const doc = newProject();
    expect(pruneSeriesEdges(doc)).toBe(doc);
  });
});

describe("分P 结构改动与图联动", () => {
  it("删除中间分P 会删掉相关边", () => {
    const base = materializeGraph(threeEpisodes());
    const [first, second, third] = base.episodes;
    const positioned = moveSeriesCard(base, second.id, 10, 20);
    const next = removeEpisode(positioned, second.id);
    expect(next.episodes.map((episode) => episode.id)).toEqual([first.id, third.id]);
    expect(next.seriesGraph?.edges).toEqual([]);
    expect(next.seriesGraph?.positions[second.id]).toBeUndefined();
  });

  it("复制分P 不复制入 / 出边", () => {
    const doc = materializeGraph(threeEpisodes());
    const first = doc.episodes[0];
    const next = duplicateEpisode(doc, first.id, "副本");
    const copy = next.episodes.find((episode) => episode.name === "副本")!;
    expect(seriesEdges(next).some((edge) => edge.from === copy.id)).toBe(false);
    expect(seriesEdges(next).some((edge) => edge.to === copy.id)).toBe(false);
  });
});
