/**
 * 画布依赖图的纯函数（不 import Vue / store）。
 *
 * 「输入下拉框只能选上游」这条规则靠 `ancestorIds` 实现：只有当前节点经连线
 * 能回溯到的节点（第 1 跳、第 2 跳……）才是合法的输入来源；下游和无关节点
 * 一律不出现，避免把线接成环或接出一个与运行链无关的孤立分支。
 */
export interface EdgeLike {
  source: string;
  target: string;
}

function pairs(edges: readonly EdgeLike[]): { source: string; target: string }[] {
  return edges.map((edge) => ({ source: edge.source, target: edge.target }));
}

/**
 * 某个节点的全部上游（祖先）节点 id，**包含**第 1 跳。
 *
 * 从当前节点沿连线反向 BFS：遇到已经访问过的节点就跳过，所以成环的画布也
 * 不会死循环。
 */
export function ancestorIds(nodeId: string, edges: readonly EdgeLike[]): Set<string> {
  const sources = new Map<string, string[]>();
  for (const edge of pairs(edges)) {
    const list = sources.get(edge.target) ?? [];
    list.push(edge.source);
    sources.set(edge.target, list);
  }
  const seen = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const source of sources.get(id) ?? []) {
        if (source === nodeId || seen.has(source)) continue;
        seen.add(source);
        next.push(source);
      }
    }
    frontier = next;
  }
  return seen;
}

/** 某个节点的全部下游（后代）节点 id。 */
export function descendantIds(nodeId: string, edges: readonly EdgeLike[]): Set<string> {
  const targets = new Map<string, string[]>();
  for (const edge of pairs(edges)) {
    const list = targets.get(edge.source) ?? [];
    list.push(edge.target);
    targets.set(edge.source, list);
  }
  const seen = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of targets.get(id) ?? []) {
        if (target === nodeId || seen.has(target)) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return seen;
}

/** 直接上游（第 1 跳）。 */
export function directSources(nodeId: string, edges: readonly EdgeLike[]): string[] {
  return [...new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))];
}

/**
 * 拓扑序（上游在前）。
 *
 * 有环时把剩下的按原顺序补在末尾：画布不该因为一条坏边整块不运行。
 */
export function topologicalOrder<T extends { id: string }>(
  nodes: readonly T[],
  edges: readonly EdgeLike[],
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of pairs(edges)) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    next.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const ordered: T[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) ordered.push(node);
    for (const target of next.get(id) ?? []) {
      const left = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, left);
      if (left === 0) queue.push(target);
    }
  }
  for (const node of nodes) if (!ordered.includes(node)) ordered.push(node);
  return ordered;
}

/**
 * 判断「新增 source → target 这条边」是否会形成环。
 *
 * 只有当 target 已经在 source 的上游（target → … → source）时才会成环；
 * `source` 已经是 `target` 的上游只是重复路径，不算环。
 */
export function wouldCreateCycle(
  edges: readonly EdgeLike[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  return ancestorIds(source, edges).has(target) || descendantIds(target, edges).has(source);
}
