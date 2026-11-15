import { describe, expect, it } from "vitest";
import { BOARD_NODES, isReferenceVideoModel, nodeDefinition, portOf, portsOf } from "@/core/board/registry";
import type { BoardNode } from "@/types/board";

function node(type: string, model?: string): BoardNode {
  return {
    id: "n",
    type,
    position: { x: 0, y: 0 },
    data: { params: model ? { model } : {}, bindings: {} },
  };
}

describe("registry", () => {
  it("注册了 4 输入 + 4 显示 + 7 模型", () => {
    expect(BOARD_NODES.filter((item) => item.category === "input")).toHaveLength(4);
    expect(BOARD_NODES.filter((item) => item.category === "display")).toHaveLength(4);
    expect(BOARD_NODES.filter((item) => item.category === "model")).toHaveLength(7);
    expect(nodeDefinition("model.video")).not.toBeNull();
    expect(nodeDefinition("nope")).toBeNull();
  });

  it("视频节点默认只有首帧 / 尾帧端口", () => {
    const ports = portsOf(node("model.video"));
    expect(ports.inputs.map((port) => port.id)).toEqual(["init", "end"]);
  });

  it("选本地 H3 Ref2VA 时换成 9 图 + 3 音频 + 3 视频", () => {
    const h3 = node("model.video", "local:minimax_h3_ref2va");
    expect(isReferenceVideoModel(h3)).toBe(true);
    const ports = portsOf(h3);
    expect(ports.inputs.filter((port) => port.type === "image")).toHaveLength(9);
    expect(ports.inputs.filter((port) => port.type === "audio")).toHaveLength(3);
    expect(ports.inputs.filter((port) => port.type === "video")).toHaveLength(3);
    expect(portOf(h3, "refImage9", "in")?.type).toBe("image");
    expect(portOf(h3, "refImage10", "in")).toBeNull();
  });

  it("云端视频服务也按多模态参考渲染端口", () => {
    expect(isReferenceVideoModel(node("model.video", "cloud:p1"))).toBe(true);
  });

  it("选了不相干模型时不做动态展开", () => {
    expect(isReferenceVideoModel(node("model.video", "local:wan21_t2v"))).toBe(false);
    expect(isReferenceVideoModel(node("model.video"))).toBe(false);
  });
});
