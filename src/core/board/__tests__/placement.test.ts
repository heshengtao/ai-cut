import { describe, expect, it } from "vitest";
import {
  CONNECT_GAP,
  connectedNodePosition,
  findFreePosition,
  type BoardRect,
} from "@/core/board/placement";

const anchor: BoardRect = { x: 100, y: 100, width: 380, height: 300 };

function overlaps(a: BoardRect, b: BoardRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("connectedNodePosition", () => {
  it("从输出端拖出：新节点在锚点右侧，至少留一个 CONNECT_GAP", () => {
    const size = { width: 400, height: 260 };
    const position = connectedNodePosition({
      direction: "forward",
      anchor,
      size,
      // 松手点就在锚点右边 20px：按「中心对齐」会压住锚点，必须被推开。
      drop: { x: anchor.x + anchor.width + 20, y: 200 },
      nodes: [anchor],
    });
    expect(position.x).toBeGreaterThanOrEqual(anchor.x + anchor.width + CONNECT_GAP);
    // 纵向跟随松手点（以新节点中心对齐）。
    expect(position.y).toBe(200 - size.height / 2);
  });

  it("从输入端拖出：新节点在锚点左侧", () => {
    const size = { width: 360, height: 180 };
    const position = connectedNodePosition({
      direction: "backward",
      anchor,
      size,
      drop: { x: anchor.x - 20, y: 250 },
      nodes: [anchor],
    });
    expect(position.x).toBeLessThanOrEqual(anchor.x - size.width - CONNECT_GAP);
    expect(position.y).toBe(250 - size.height / 2);
  });

  it("和别的节点重叠时向下避让", () => {
    const size = { width: 400, height: 260 };
    const blocker: BoardRect = { x: 560, y: -200, width: 400, height: 660 };
    const position = connectedNodePosition({
      direction: "forward",
      anchor,
      size,
      drop: { x: 760, y: 200 },
      nodes: [anchor, blocker],
    });
    const placed = { ...position, ...size };
    expect(position.y).not.toBe(200 - size.height / 2);
    expect(overlaps(placed, blocker)).toBe(false);
    expect(overlaps(placed, anchor)).toBe(false);
  });

  it("按网格吸附", () => {
    const size = { width: 400, height: 260 };
    const position = connectedNodePosition({
      direction: "forward",
      anchor,
      size,
      drop: { x: 500, y: 200 },
      nodes: [anchor],
      snap: 22,
    });
    expect(position.x % 22).toBe(0);
    expect(position.y % 22).toBe(0);
    // 吸附只能把间距吸大，不能吸小。
    expect(position.x - (anchor.x + anchor.width)).toBeGreaterThanOrEqual(CONNECT_GAP);
  });
});

describe("findFreePosition", () => {
  it("没有碰撞时原样返回", () => {
    expect(findFreePosition([{ x: 0, y: 0, width: 100, height: 100 }], {
      x: 400,
      y: 0,
      width: 200,
      height: 200,
    })).toEqual({ x: 400, y: 0 });
  });

  it("一直重叠时换到右侧", () => {
    const wall: BoardRect = { x: 0, y: 0, width: 400, height: 4000 };
    const position = findFreePosition([wall], { x: 0, y: 0, width: 300, height: 200 });
    const placed = { ...position, width: 300, height: 200 };
    expect(overlaps(placed, wall)).toBe(false);
  });
});
