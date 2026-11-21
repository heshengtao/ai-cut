/** 读盘时归一化剧集图：坏数据降级成「派生链」，不抛错。 */
import type { SeriesEdge, SeriesGraphDoc } from "@/types/project";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSeriesGraph(value: unknown): SeriesGraphDoc | undefined {
  if (!isObject(value)) return undefined;

  const edges: SeriesEdge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.edges)) {
    for (const raw of value.edges) {
      if (!isObject(raw)) continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const from = typeof raw.from === "string" ? raw.from : "";
      const to = typeof raw.to === "string" ? raw.to : "";
      if (!id || !from || !to || seen.has(id)) continue;
      seen.add(id);
      const label = typeof raw.label === "string" ? raw.label : "";
      edges.push(label ? { id, from, to, label } : { id, from, to });
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  if (isObject(value.positions)) {
    for (const [id, point] of Object.entries(value.positions)) {
      if (!isObject(point) || !finite(point.x) || !finite(point.y)) continue;
      positions[id] = { x: point.x, y: point.y };
    }
  }

  return { custom: value.custom === true, edges, positions };
}
