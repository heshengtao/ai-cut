/**
 * 剧集图：分P 之间的播放关系。
 *
 * 派生模式（默认）：按 `Episode.order` 把相邻分P 连成一条时间链，不落盘；
 * 自定义模式：`project.seriesGraph.edges` 是唯一真相。两种模式都通过
 * `seriesEdges()` 读取，界面与播放只认这个出口。
 */
import type { Episode, Project, SeriesEdge, SeriesOption } from "@/types/project";

/** 按 order 升序；order 相同时保持数组顺序。 */
export function orderedEpisodes(doc: Project): Episode[] {
  return doc.episodes
    .map((episode, index) => ({ episode, index }))
    .sort((a, b) => a.episode.order - b.episode.order || a.index - b.index)
    .map((item) => item.episode);
}

/** 默认时间链：相邻两集一条无选项边，id 稳定。 */
export function derivedChain(doc: Project): SeriesEdge[] {
  const episodes = orderedEpisodes(doc);
  const edges: SeriesEdge[] = [];
  for (let index = 0; index < episodes.length - 1; index += 1) {
    const from = episodes[index].id;
    const to = episodes[index + 1].id;
    edges.push({ id: `chain:${from}->${to}`, from, to });
  }
  return edges;
}

/** 是否还在「没动过连线」的派生状态。 */
export function isDerived(doc: Project): boolean {
  return doc.seriesGraph?.custom !== true;
}

/** 当前有效的边（悬空边在这里过滤）。custom 且 edges 为空时不回退派生链。 */
export function seriesEdges(doc: Project): SeriesEdge[] {
  if (isDerived(doc)) return derivedChain(doc);
  const known = new Set(doc.episodes.map((episode) => episode.id));
  return (doc.seriesGraph?.edges ?? []).filter(
    (edge) => known.has(edge.from) && known.has(edge.to),
  );
}

export function outgoing(doc: Project, episodeId: string): SeriesEdge[] {
  return seriesEdges(doc).filter((edge) => edge.from === episodeId);
}

export function incoming(doc: Project, episodeId: string): SeriesEdge[] {
  return seriesEdges(doc).filter((edge) => edge.to === episodeId);
}

/** 出边 → 播放选项（保持 edges 顺序）。 */
export function optionsOf(doc: Project, episodeId: string): SeriesOption[] {
  return outgoing(doc, episodeId).map((edge) => {
    const label = edge.label?.trim() ?? "";
    return { edgeId: edge.id, to: edge.to, label, unnamed: label.length === 0 };
  });
}

/** 本集播完之后该干什么。 */
export type SeriesStep =
  | { kind: "end" }
  | { kind: "auto"; to: string }
  | { kind: "choices"; options: SeriesOption[] }
  | { kind: "loop"; to: string };

/**
 * 播放判定：0 条出边结束；唯一无选项出边自动连播（目标已访问则是无选项的环）；
 * 其余（多条出边 / 唯一出边带文案）都当选项。
 */
export function stepOf(
  doc: Project,
  episodeId: string,
  visited: ReadonlySet<string>,
): SeriesStep {
  const edges = outgoing(doc, episodeId);
  if (edges.length === 0) return { kind: "end" };
  if (edges.length === 1 && (edges[0].label?.trim() ?? "") === "") {
    const to = edges[0].to;
    return visited.has(to) ? { kind: "loop", to } : { kind: "auto", to };
  }
  return { kind: "choices", options: optionsOf(doc, episodeId) };
}
