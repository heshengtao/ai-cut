/**
 * 迭代节点的「子工作流容器框」几何。
 *
 * 迭代节点是一张卡片（头部放参数 / 进度）+ 一个向下延伸的容器框。卡片高度 =
 * 头部高度；容器框占节点剩余高度。子节点只要中心点落在框里就属于这个迭代
 * （和组一样的视觉容器语义），这样拖进拖出即可增删成员。
 */
import type { BoardNode } from "@/types/board";

/** 头部（卡片）高度：够放标题、状态、进度和那一排参数。 */
export const BATCH_HEADER = 78;
/** 容器框四周留白：子节点落在留白里也算成员，拖进来不会被弹出去。 */
export const BATCH_PAD = 18;
/** 容器框的最小高度（再小就没有编辑空间了）。 */
export const BATCH_MIN_HEIGHT = BATCH_HEADER + 160;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 迭代节点的默认尺寸。 */
export const BATCH_SIZE = { width: 520, height: 420 };

export function batchFrameRect(node: BoardNode): Rect | null {
  if (node.type !== "batch") return null;
  const width = node.size?.width ?? BATCH_SIZE.width;
  const height = node.size?.height ?? BATCH_SIZE.height;
  return {
    x: node.position.x,
    y: node.position.y + BATCH_HEADER,
    width,
    height: Math.max(BATCH_PAD * 2, height - BATCH_HEADER),
  };
}

/** 节点中心点是否落在容器框里（按中心判定，和组一致）。 */
export function insideBatchFrame(node: BoardNode, frame: Rect): boolean {
  const width = node.size?.width ?? 240;
  const height = node.size?.height ?? 160;
  const cx = node.position.x + width / 2;
  const cy = node.position.y + height / 2;
  return (
    cx >= frame.x &&
    cx <= frame.x + frame.width &&
    cy >= frame.y &&
    cy <= frame.y + frame.height
  );
}

/** 迭代节点的最小尺寸（头部 + 一块能放节点的框）。 */
export function clampBatchSize(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(360, Math.round(size.width)),
    height: Math.max(BATCH_MIN_HEIGHT, Math.round(size.height)),
  };
}
