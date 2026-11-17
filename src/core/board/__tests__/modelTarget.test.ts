import { describe, expect, it } from "vitest";
import { modelBackend, modelTarget } from "@/core/board/modelTarget";
import type { BoardNode } from "@/types/board";

function node(type: string, params: Record<string, unknown> = {}): BoardNode {
  return {
    id: "n",
    type,
    position: { x: 0, y: 0 },
    data: { params, bindings: {} },
  };
}

describe("modelTarget", () => {
  it("文本节点的模型参数是 llm 那一份", () => {
    expect(modelTarget(node("model.text"))).toEqual({ paramId: "model", text: true });
  });

  it("画面增强按处理方式在超分 / 插帧之间切换", () => {
    expect(modelTarget(node("model.enhance")).paramId).toBe("upscaleModel");
    expect(modelTarget(node("model.enhance", { op: "upscale" })).paramId).toBe("upscaleModel");
    expect(modelTarget(node("model.enhance", { op: "interpolate" })).paramId).toBe("interpModel");
  });

  it("其它模型节点读 model，视频音频分离没有模型参数", () => {
    for (const type of [
      "model.image",
      "model.video",
      "model.tts",
      "model.asr",
      "model.separate",
    ]) {
      expect(modelTarget(node(type)).paramId).toBe("model");
    }
    expect(modelTarget(node("model.demux")).paramId).toBeNull();
    expect(modelBackend(node("model.demux"), "local:x")).toBe("none");
  });
});

describe("modelBackend", () => {
  it("文本节点有兜底模型就算已配置，没有才报未配置", () => {
    expect(modelBackend(node("model.text"), "")).toBe("unconfigured");
    expect(modelBackend(node("model.text"), "default::deepseek-chat")).toBe("text");
  });

  it("本地 / 云端按 model 值区分，空值算未配置", () => {
    expect(modelBackend(node("model.image"), "")).toBe("unconfigured");
    expect(modelBackend(node("model.image"), "local:sdxl")).toBe("local");
    expect(modelBackend(node("model.image"), "cloud:gemini")).toBe("cloud");
  });

  it("画面增强选了模型就显示本地模型，而不是未选择", () => {
    const enhance = node("model.enhance", { op: "interpolate", interpModel: "local:rife" });
    expect(modelBackend(enhance, "local:rife")).toBe("local");
  });
});
