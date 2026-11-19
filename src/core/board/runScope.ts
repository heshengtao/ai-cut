/**
 * 迭代（batch）节点的行作用域。
 *
 * 一行 = 一次子工作流运行。子节点的产物不进 `node.data`（否则两行并行时会互相覆盖），
 * 而是记在行作用域里；解析上游时先查作用域，查不到再回落到画布上已发布的产物。
 */
import type { BoardNodeData } from "@/types/board";

export interface RowContext {
  /** 这一行的输入项（`items[i]`）。 */
  item: unknown;
  /** 行序号（从 0 开始）。 */
  index: number;
  /** 串行模式的循环变量：上一行的 `var.carryOut`，第一行是 batch 的初始 carry。 */
  carry: unknown;
}

export interface RowOutputs {
  /** 文本产物（`result.text`）。 */
  text?: string;
  /** 值产物：端口 id → 值。 */
  values: Record<string, unknown>;
  /** 素材产物：端口 id → 素材 id。 */
  assetByPort: Record<string, string>;
}

export interface RunScope {
  row: RowContext;
  /** 这一行里已跑完的节点：`nodeId → 产物`。 */
  outputs: Map<string, RowOutputs>;
}

function slice(scope: RunScope | undefined, nodeId: string): RowOutputs | undefined {
  return scope?.outputs.get(nodeId);
}

/** 作用域里的文本；`undefined` = 这一行没有该节点的产物（回落到画布）。 */
export function scopedText(
  scope: RunScope | undefined,
  nodeId: string,
  portId: string,
): string | null | undefined {
  const found = slice(scope, nodeId);
  if (!found) return undefined;
  const value = found.values[portId];
  if (typeof value === "string") return value;
  return found.text ?? null;
}

/** 作用域里的值；`undefined` = 没有产物。 */
export function scopedValue(
  scope: RunScope | undefined,
  nodeId: string,
  portId: string,
): unknown {
  const found = slice(scope, nodeId);
  if (!found) return undefined;
  if (portId in found.values) return found.values[portId];
  // 单端口节点：取值产物里的第一个。
  const keys = Object.keys(found.values);
  return keys.length === 1 ? found.values[keys[0]!] : undefined;
}

/** 作用域里的素材 id；`undefined` = 没有产物。 */
export function scopedAssetId(
  scope: RunScope | undefined,
  nodeId: string,
  portId: string,
): string | null | undefined {
  const found = slice(scope, nodeId);
  if (!found) return undefined;
  return found.assetByPort[portId] ?? Object.values(found.assetByPort)[0] ?? null;
}

/** 把一次子节点运行的结果收进行作用域。 */
export function putRowOutputs(
  scope: RunScope,
  nodeId: string,
  outputs: RowOutputs,
): void {
  scope.outputs.set(nodeId, outputs);
}

/** `items` 宽松归一化：数组原样；非数组按「单行」处理；空 → 0 行。 */
export function normalizeItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw === null || raw === undefined || raw === "") return [];
  return [raw];
}

/** 从一个 batch 节点上取子工作流成员（只保留真实存在的节点 id）。 */
export function batchChildIds(node: BoardNodeData): string[] {
  return (node.children ?? []).filter((id): id is string => typeof id === "string" && Boolean(id));
}
