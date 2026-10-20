/**
 * 媒体库 → 时间线的拖拽载荷。
 *
 * WebKit 在第一次 dragover 时可能拿不到 `DataTransfer.types` / `getData`，
 * 导致「第一次拖不进去」。这里在 dragstart 同步记一份内存载荷，时间线只依赖它。
 */
export type DragPayload =
  | { kind: "asset"; id: string }
  | { kind: "text"; id: string };

let current: DragPayload | null = null;

export function setDragPayload(payload: DragPayload): void {
  current = payload;
}

export function getDragPayload(): DragPayload | null {
  return current;
}

export function clearDragPayload(): void {
  current = null;
}
