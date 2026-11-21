import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addEpisode } from "@/core/ops/episodes";
import {
  autoLayout,
  CARD_HEIGHT,
  CARD_WIDTH,
  GAP_X,
  GAP_Y,
  ORIGIN,
  placements,
} from "@/core/series/layout";
import type { Project, SeriesEdge } from "@/types/project";

function threeEpisodes(): Project {
  return addEpisode(addEpisode(newProject("剧集"), "第二集"), "第三集");
}

function withEdges(doc: Project, edges: SeriesEdge[]): Project {
  return {
    ...doc,
    seriesGraph: { custom: true, edges, positions: {} },
  } as Project;
}

describe("autoLayout", () => {
  it("链式布局是一条水平直线", () => {
    const doc = threeEpisodes();
    const positions = autoLayout(doc);
    const xs = doc.episodes.map((episode) => positions.get(episode.id)!.x);
    const ys = doc.episodes.map((episode) => positions.get(episode.id)!.y);
    expect(xs).toEqual([
      ORIGIN,
      ORIGIN + CARD_WIDTH + GAP_X,
      ORIGIN + (CARD_WIDTH + GAP_X) * 2,
    ]);
    expect(new Set(ys).size).toBe(1);
  });

  it("分叉按 BFS 深度分层，同层纵向排列", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "a", from: first.id, to: second.id },
      { id: "b", from: first.id, to: third.id },
    ]);
    const positions = autoLayout(custom);
    expect(positions.get(second.id)!.x).toBe(positions.get(third.id)!.x);
    expect(
      Math.abs(positions.get(second.id)!.y - positions.get(third.id)!.y),
    ).toBe(CARD_HEIGHT + GAP_Y);
  });

  it("环不会死循环，每个分P 都有坐标", () => {
    const doc = addEpisode(newProject("循环"), "B");
    const [a, b] = doc.episodes;
    const custom = withEdges(doc, [
      { id: "ab", from: a.id, to: b.id },
      { id: "ba", from: b.id, to: a.id },
    ]);
    const positions = autoLayout(custom);
    expect(positions.size).toBe(2);
    expect(positions.get(a.id)).toBeDefined();
    expect(positions.get(b.id)).toBeDefined();
  });

  it("孤立分P 排到最右侧一列", () => {
    const doc = threeEpisodes();
    const [first, second, third] = doc.episodes;
    const custom = withEdges(doc, [{ id: "a", from: first.id, to: second.id }]);
    const positions = autoLayout(custom);
    expect(positions.get(third.id)!.x).toBeGreaterThan(positions.get(second.id)!.x);
  });
});

describe("placements", () => {
  it("手动坐标优先，其余走自动布局", () => {
    const doc = threeEpisodes();
    const [first, second] = doc.episodes;
    const manual = {
      ...doc,
      seriesGraph: {
        custom: false,
        edges: [],
        positions: { [second.id]: { x: 999, y: 555 } },
      },
    } as Project;
    const positions = placements(manual);
    expect(positions.get(second.id)).toEqual({ x: 999, y: 555 });
    expect(positions.get(first.id)!.x).toBe(ORIGIN);
  });

  it("坏坐标回落到自动布局", () => {
    const doc = threeEpisodes();
    const first = doc.episodes[0];
    const broken = {
      ...doc,
      seriesGraph: {
        custom: false,
        edges: [],
        positions: { [first.id]: { x: Number.NaN, y: 0 } },
      },
    } as Project;
    expect(placements(broken).get(first.id)).toEqual({ x: ORIGIN, y: ORIGIN });
  });
});
