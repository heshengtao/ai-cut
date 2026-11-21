/**
 * 剧集卡片坐标。
 *
 * 自动布局按图的有向深度分层：根（没有入边）在最左，BFS 每下一层右移一列；
 * 环 / 孤立分P 作为新的根排到最右一列。派生时间链因此退化成一条水平直线。
 * `positions` 里手动拖过的坐标优先。
 */
import type { Project } from "@/types/project";
import { orderedEpisodes, seriesEdges } from "./graph";

/** 卡片尺寸（与 `SeriesGraphCard.vue` 的 CSS 保持一致）。 */
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 168;
export const GAP_X = 64;
export const GAP_Y = 36;
export const ORIGIN = 48;

export interface SeriesPosition {
  x: number;
  y: number;
}

/** 纯自动布局：每个分P 都能拿到坐标（环、孤立节点也不例外）。 */
export function autoLayout(doc: Project): Map<string, SeriesPosition> {
  const episodes = orderedEpisodes(doc);
  const edges = seriesEdges(doc);
  const next = new Map<string, string[]>();
  const linked = new Set<string>();
  const indegree = new Map<string, number>(episodes.map((episode) => [episode.id, 0]));

  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    linked.add(edge.from);
    linked.add(edge.to);
  }

  const depth = new Map<string, number>();
  const bfs = (start: string, startDepth: number): void => {
    if (depth.has(start)) return;
    const queue: { id: string; depth: number }[] = [{ id: start, depth: startDepth }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (depth.has(current.id)) continue;
      depth.set(current.id, current.depth);
      for (const to of next.get(current.id) ?? []) {
        if (!depth.has(to)) queue.push({ id: to, depth: current.depth + 1 });
      }
    }
  };

  // 根：有入有出的图里没有入边的节点；完全孤立的分P 不算根（要排到最右边）。
  for (const episode of episodes) {
    if (linked.has(episode.id) && (indegree.get(episode.id) ?? 0) === 0) {
      bfs(episode.id, 0);
    }
  }
  if (depth.size < episodes.length) {
    let base = depth.size > 0 ? Math.max(...depth.values()) + 1 : 0;
    for (const episode of episodes) {
      if (depth.has(episode.id)) continue;
      if (linked.has(episode.id)) {
        bfs(episode.id, base);
        base = Math.max(...depth.values()) + 1;
      } else {
        depth.set(episode.id, base);
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const episode of episodes) {
    const layer = depth.get(episode.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), episode.id]);
  }

  const positions = new Map<string, SeriesPosition>();
  for (const [layer, ids] of layers) {
    ids.forEach((id, row) => {
      positions.set(id, {
        x: ORIGIN + layer * (CARD_WIDTH + GAP_X),
        y: ORIGIN + row * (CARD_HEIGHT + GAP_Y),
      });
    });
  }
  return positions;
}

/** 实际坐标：手动坐标优先，缺失 / 非法时回落到自动布局。 */
export function placements(doc: Project): Map<string, SeriesPosition> {
  const auto = autoLayout(doc);
  const manual = doc.seriesGraph?.positions ?? {};
  const result = new Map<string, SeriesPosition>();
  for (const episode of doc.episodes) {
    const saved = manual[episode.id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      result.set(episode.id, { x: saved.x, y: saved.y });
    } else {
      result.set(episode.id, auto.get(episode.id) ?? { x: ORIGIN, y: ORIGIN });
    }
  }
  return result;
}
