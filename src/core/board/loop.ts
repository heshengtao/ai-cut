/**
 * 循环节点（开始 / 结束成对）。
 *
 * - 两个节点用一根 `kind: "pair"` 的配对线相连：删线、删任一端，三者一起消失；
 * - 循环体 = 从开始节点输出**可达的下游**（遇到结束节点就停，不跨过去）；
 * - 配对线只表达配对，不参与数据流（解析上游、拓扑序都要跳过）。
 */
import type { BoardEdge, BoardNode } from "@/types/board";

export function isPairEdge(edge: BoardEdge): boolean {
  return edge.kind === "pair";
}

export function pairPartner(node: BoardNode, nodes: readonly BoardNode[]): BoardNode | null {
  if (!node.data.pairId) return null;
  return (
    nodes.find(
      (item) => item.id !== node.id && item.data.pairId === node.data.pairId,
    ) ?? null
  );
}

/** 循环体：从开始节点输出可达、且不跨过结束节点的所有下游节点 id。 */
export function loopBodyIds(
  startId: string,
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [startId];
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== id || isPairEdge(edge)) continue;
      if (seen.has(edge.target)) continue;
      const target = byId.get(edge.target);
      // 到结束节点为止：结束节点本身不算循环体，它下游也不属于这一轮。
      if (!target || target.type === "loop.end") continue;
      seen.add(edge.target);
      out.push(edge.target);
      queue.push(edge.target);
    }
  }
  return out;
}

/** 配对的结束节点。 */
export function loopEndOf(start: BoardNode, nodes: readonly BoardNode[]): BoardNode | null {
  const partner = pairPartner(start, nodes);
  return partner?.type === "loop.end" ? partner : null;
}

export function slotCount(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(8, Math.round(value)));
}

/** 循环输入宽松归一化：数组原样；空 → 0 次；其它按单项处理。 */
export function normalizeItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw === null || raw === undefined || raw === "") return [];
  return [raw];
}
