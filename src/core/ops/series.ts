/**
 * 剧集图的编辑操作：连 / 断 / 改选项名 / 拖坐标 / 重建。
 *
 * 全部是不可变纯函数，经 `dispatch` 进撤销栈。第一次结构性编辑会把当前派生链
 * 原样落成真实边（`materializeGraph`），所以「加一条分支」不会让时间链消失；
 * 而拖动卡片只写坐标，不会把普通剧集变成自定义图。
 */
import { newEpisode } from "@/core/episodes";
import { derivedChain } from "@/core/series/graph";
import { withTouch } from "./internal";
import type { Episode, Project, SeriesEdge, SeriesGraphDoc } from "@/types/project";

/** 当前图落成可编辑数据。`changed` 表示这次发生了「派生 → 自定义」。 */
function editable(doc: Project): { graph: SeriesGraphDoc; changed: boolean } {
  const stored = doc.seriesGraph;
  if (stored?.custom) {
    return {
      graph: { custom: true, edges: stored.edges, positions: stored.positions },
      changed: false,
    };
  }
  return {
    graph: { custom: true, edges: derivedChain(doc), positions: stored?.positions ?? {} },
    changed: true,
  };
}

function withGraph(doc: Project, graph: SeriesGraphDoc): Project {
  return withTouch(doc, { seriesGraph: graph });
}

/** 派生链 → 自定义图（已经是自定义时原样返回）。 */
export function materializeGraph(doc: Project): Project {
  const { graph, changed } = editable(doc);
  return changed ? withGraph(doc, graph) : doc;
}

/** 连一条无选项的边；重复边 / 缺失分P 不生效。 */
export function connectEpisode(doc: Project, from: string, to: string): Project {
  const known = new Set(doc.episodes.map((episode) => episode.id));
  if (!known.has(from) || !known.has(to)) return doc;
  const { graph } = editable(doc);
  if (graph.edges.some((edge) => edge.from === from && edge.to === to)) return doc;
  const edge: SeriesEdge = { id: crypto.randomUUID(), from, to };
  return withGraph(doc, { ...graph, edges: [...graph.edges, edge] });
}

/** 删一条边（派生链上的 `chain:` 边同样可删）。 */
export function disconnectEpisodeEdge(doc: Project, edgeId: string): Project {
  const { graph } = editable(doc);
  const edges = graph.edges.filter((edge) => edge.id !== edgeId);
  if (edges.length === graph.edges.length) return doc;
  return withGraph(doc, { ...graph, edges });
}

/** 改选项名；空串 = 清掉文案（回到「无选项」）。 */
export function setEpisodeEdgeLabel(doc: Project, edgeId: string, label: string): Project {
  const { graph } = editable(doc);
  const trimmed = label.trim();
  const target = graph.edges.find((edge) => edge.id === edgeId);
  if (!target) return doc;
  if ((target.label ?? "") === trimmed) return doc;
  const edges = graph.edges.map((edge) => {
    if (edge.id !== edgeId) return edge;
    if (!trimmed) {
      const next = { ...edge };
      delete next.label;
      return next;
    }
    return { ...edge, label: trimmed };
  });
  return withGraph(doc, { ...graph, edges });
}

/** 拖动卡片：只写坐标，不改 custom。 */
export function moveSeriesCard(doc: Project, episodeId: string, x: number, y: number): Project {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return doc;
  if (!doc.episodes.some((episode) => episode.id === episodeId)) return doc;
  const stored = doc.seriesGraph;
  const positions = { ...(stored?.positions ?? {}) };
  const current = positions[episodeId];
  if (current && current.x === x && current.y === y) return doc;
  positions[episodeId] = { x, y };
  const graph: SeriesGraphDoc = {
    custom: stored?.custom === true,
    edges: stored?.edges ?? [],
    positions,
  };
  return withGraph(doc, graph);
}

/** 清空手动坐标，回到自动分层布局。 */
export function autoLayoutSeries(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored || Object.keys(stored.positions).length === 0) return doc;
  return withGraph(doc, { ...stored, positions: {} });
}

/** 按时间顺序重建：丢掉全部边与选项，回到派生链（坐标保留）。 */
export function resetSeriesGraph(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored || !stored.custom) return doc;
  return withGraph(doc, { custom: false, edges: [], positions: stored.positions });
}

/** 清掉悬空边与已删分P 的坐标；删分P 后调用。 */
export function pruneSeriesEdges(doc: Project): Project {
  const stored = doc.seriesGraph;
  if (!stored) return doc;
  const known = new Set(doc.episodes.map((episode) => episode.id));
  const edges = stored.edges.filter((edge) => known.has(edge.from) && known.has(edge.to));
  const positions: Record<string, { x: number; y: number }> = {};
  let droppedPosition = false;
  for (const [id, point] of Object.entries(stored.positions)) {
    if (!known.has(id)) {
      droppedPosition = true;
      continue;
    }
    positions[id] = point;
  }
  if (edges.length === stored.edges.length && !droppedPosition) return doc;
  return withGraph(doc, { ...stored, edges, positions });
}

/** 追加一个空白分P（不切换当前分P）。 */
function appendEpisode(doc: Project, name: string): { doc: Project; episode: Episode } {
  const order = doc.episodes.reduce((max, episode) => Math.max(max, episode.order), -1) + 1;
  const episode = newEpisode(name, order);
  return {
    doc: withTouch(doc, { episodes: [...doc.episodes, episode] }),
    episode,
  };
}

/**
 * 从一张卡片的连接点拖到空白处松手：新建分P，并按拖出的方向连起来。
 *
 * 先 materialize 当前派生链、**再**追加分P——顺序反过来的话，派生链会把新分P
 * 也算进时间顺序，凭空多出一条「上一集 → 新分P」的边，变成意外分叉。
 */
export function addConnectedEpisode(
  doc: Project,
  anchorId: string,
  direction: "source" | "target",
  name: string,
  position: { x: number; y: number },
): Project {
  if (!doc.episodes.some((episode) => episode.id === anchorId)) return doc;
  const base = materializeGraph(doc);
  const { doc: withEpisode, episode: created } = appendEpisode(base, name);
  const connected =
    direction === "source"
      ? connectEpisode(withEpisode, anchorId, created.id)
      : connectEpisode(withEpisode, created.id, anchorId);
  return moveSeriesCard(connected, created.id, position.x, position.y);
}
