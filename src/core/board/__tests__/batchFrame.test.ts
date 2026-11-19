import { describe, expect, it } from "vitest";
import {
  BATCH_HEADER,
  BATCH_MIN_HEIGHT,
  batchFrameRect,
  clampBatchSize,
  insideBatchFrame,
} from "@/core/board/batchFrame";
import type { BoardNode } from "@/types/board";

function batch(x: number, y: number, width = 520, height = 420): BoardNode {
  return { id: "b", type: "batch", position: { x, y }, size: { width, height }, data: { params: {}, bindings: {} } };
}

function node(x: number, y: number, width = 240, height = 160): BoardNode {
  return { id: "n", type: "model.image", position: { x, y }, size: { width, height }, data: { params: {}, bindings: {} } };
}

describe("batch frame geometry", () => {
  it("容器框在头部下方，宽度与节点一致", () => {
    const frame = batchFrameRect(batch(100, 200));
    expect(frame).toEqual({ x: 100, y: 200 + BATCH_HEADER, width: 520, height: 420 - BATCH_HEADER });
  });

  it("按节点中心点判定成员", () => {
    const frame = batchFrameRect(batch(0, 0))!;
    expect(insideBatchFrame(node(20, BATCH_HEADER + 20), frame)).toBe(true);
    expect(insideBatchFrame(node(-200, 0), frame)).toBe(false);
    expect(insideBatchFrame(node(0, BATCH_HEADER + 400), frame)).toBe(false);
  });

  it("非迭代节点没有容器框", () => {
    expect(batchFrameRect(node(0, 0))).toBeNull();
  });

  it("尺寸有下限", () => {
    expect(clampBatchSize({ width: 100, height: 100 })).toEqual({
      width: 360,
      height: BATCH_MIN_HEIGHT,
    });
  });
});
