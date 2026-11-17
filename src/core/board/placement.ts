/**
 * 拖线建节点时的落点计算（纯函数，无 Vue / store 依赖）。
 *
 * 对齐 ai-board 的 `addNodeConnected`：
 * - 从输出端拖出 → 新节点放在锚点**右侧**，横向至少留 `CONNECT_GAP`；
 * - 从输入端拖出 → 新节点放在锚点**左侧**，同样至少留 `CONNECT_GAP`；
 * - 再用 `findFreePosition` 往下 / 往右挪，避免和已有节点叠在一起。
 *
 * 纵向仍然尊重松手位置：用户拖到哪里，就在那一行附近落点（只是横向至少隔开
 * 一个间距），这样比「永远和锚点顶部对齐」更符合直觉。
 */

/** 新节点与锚点之间至少保留的横向间距（画布单位，对齐 ai-board 的 80）。 */
export const CONNECT_GAP = 80;
/** 避让时节点之间留的呼吸间距。 */
const COLLISION_GAP = 24;
/** 每避让一次往下挪多少。 */
const COLLISION_STEP = 48;
/** 最多避让多少次（8 次换一列）。 */
const COLLISION_ATTEMPTS = 40;

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 向下 / 向右找一个不和已有节点重叠的位置（和 ai-board 的 `findFreePosition` 同算法）。 */
export function findFreePosition(nodes: BoardRect[], rect: BoardRect): { x: number; y: number } {
  let x = Math.round(rect.x);
  let y = Math.round(rect.y);
  for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt += 1) {
    const overlaps = nodes.some(
      (node) =>
        x < node.x + node.width + COLLISION_GAP &&
        x + rect.width + COLLISION_GAP > node.x &&
        y < node.y + node.height + COLLISION_GAP &&
        y + rect.height + COLLISION_GAP > node.y,
    );
    if (!overlaps) break;
    y += COLLISION_STEP;
    if (attempt > 0 && attempt % 8 === 0) x += rect.width + COLLISION_GAP;
  }
  return { x, y };
}

/** 把坐标吸到画布网格（`snap` 为 1 表示不吸）。 */
function snapTo(value: number, snap: number): number {
  if (snap <= 1) return Math.round(value);
  return Math.round(value / snap) * snap;
}

/** 向前（右侧）吸附：取网格上不小于 value 的那一条，避免把间距吸小。 */
function snapUp(value: number, snap: number): number {
  if (snap <= 1) return Math.round(value);
  return Math.ceil(value / snap) * snap;
}

/** 向后（左侧）吸附：取网格上不大于 value 的那一条。 */
function snapDown(value: number, snap: number): number {
  if (snap <= 1) return Math.round(value);
  return Math.floor(value / snap) * snap;
}

/**
 * 拖线松手后新节点的位置。
 *
 * `drop` 是松手点的画布坐标；新节点以它为中心，但横向不会越过
 * 「锚点 + 间距」这条线，所以不会压在原节点上。
 */
export function connectedNodePosition(args: {
  direction: "forward" | "backward";
  anchor: BoardRect;
  size: Size;
  drop: { x: number; y: number };
  nodes: BoardRect[];
  /** 网格吸附步长；默认 1（不吸）。 */
  snap?: number;
}): { x: number; y: number } {
  const { direction, anchor, size, drop, nodes } = args;
  const snap = args.snap ?? 1;
  const centered = drop.x - size.width / 2;
  // 横向至少留出 CONNECT_GAP；吸附时向**外**取整，不会把间距吸小。
  const minX = anchor.x + anchor.width + CONNECT_GAP;
  const maxX = anchor.x - size.width - CONNECT_GAP;
  const x =
    direction === "forward"
      ? Math.max(snapUp(Math.max(centered, minX), snap), minX)
      : Math.min(snapDown(Math.min(centered, maxX), snap), maxX);
  const y = snapTo(drop.y - size.height / 2, snap);
  return findFreePosition(nodes, {
    x,
    y,
    width: size.width,
    height: size.height,
  });
}
