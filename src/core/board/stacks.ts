/**
 * 输入 / 显示节点的多值栈。
 *
 * 五类输入与显示都可以放多个同类型的值：图片 / 视频 / 音频用素材 id（`assetIds`），
 * 文本 / 值用 `items`。`stackIndex` 是当前显示的那一个；旧工程没有数组字段时，
 * 回落到 `assetId` / `params.text` / `params.value`。
 */
import type { BoardNode, BoardNodeData } from "@/types/board";

export interface Stack {
  /** 这一摞值（素材 id / 文本 / JSON 值）。 */
  items: unknown[];
  /** 当前展示的下标（永远落在 [0, items.length-1]，空栈为 0）。 */
  index: number;
}

export type StackKind = "image" | "video" | "audio" | "text" | "value";

export function stackKindOf(node: BoardNode): StackKind {
  const type = node.type;
  if (type.startsWith("input.")) return type.slice(6) as StackKind;
  if (type.startsWith("display.")) return type.slice(8) as StackKind;
  return "value";
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(index)));
}

export function stackOf(node: BoardNode): Stack {
  const kind = stackKindOf(node);
  const data = node.data;
  if (kind === "image" || kind === "video" || kind === "audio") {
    const items =
      data.assetIds ??
      (typeof data.assetId === "string" && data.assetId ? [data.assetId] : []);
    return { items, index: clampIndex(data.stackIndex ?? 0, items.length) };
  }
  const raw = Array.isArray(data.items) ? data.items : [];
  if (raw.length > 0) {
    return { items: raw, index: clampIndex(data.stackIndex ?? 0, raw.length) };
  }
  if (kind === "text") {
    const text = typeof data.params.text === "string" ? data.params.text : "";
    return text ? { items: [text], index: 0 } : { items: [], index: 0 };
  }
  const value = data.params.value;
  return value === undefined || value === null || value === ""
    ? { items: [], index: 0 }
    : { items: [value], index: 0 };
}

export function currentOf(node: BoardNode): unknown {
  const stack = stackOf(node);
  return stack.items[stack.index] ?? null;
}

/** 写回一摞值（媒体写 `assetIds`，文本 / 值写 `items`，并同步旧的单值字段）。 */
export function stackPatch(
  node: BoardNode,
  items: unknown[],
  index: number,
): Partial<BoardNodeData> {
  const kind = stackKindOf(node);
  const nextIndex = clampIndex(index, items.length);
  if (kind === "image" || kind === "video" || kind === "audio") {
    const ids = items.filter((item): item is string => typeof item === "string" && Boolean(item));
    return {
      assetIds: ids,
      stackIndex: nextIndex,
      ...(ids[nextIndex] ? { assetId: ids[nextIndex] } : { assetId: undefined }),
    };
  }
  return { items, stackIndex: nextIndex };
}

/** 替换当前项（文本 / 值节点编辑时用）。 */
export function replaceCurrent(
  node: BoardNode,
  value: unknown,
): { items: unknown[]; index: number } {
  const stack = stackOf(node);
  const items = [...stack.items];
  if (items.length === 0) items.push(value);
  else items[stack.index] = value;
  return { items, index: stack.index };
}
