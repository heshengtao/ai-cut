import { describe, expect, it } from "vitest";
import {
  BOARD_NODES,
  isReferenceVideoModel,
  nodeDefinition,
  paramValue,
  portOf,
  portsOf,
  publishedAssetIds,
  visibleParams,
} from "@/core/board/registry";
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
  it("注册了 4 输入 + 4 显示 + 8 模型", () => {
    expect(BOARD_NODES.filter((item) => item.category === "input")).toHaveLength(4);
    expect(BOARD_NODES.filter((item) => item.category === "display")).toHaveLength(4);
    expect(BOARD_NODES.filter((item) => item.category === "model")).toHaveLength(8);
    expect(nodeDefinition("model.video")).not.toBeNull();
    expect(nodeDefinition("nope")).toBeNull();
  });

  it("视频节点默认有提示词 / 反向提示词 + 首帧 / 尾帧端口", () => {
    const ports = portsOf(node("model.video"));
    expect(ports.inputs.map((port) => port.id)).toEqual([
      "prompt",
      "negative",
      "init",
      "end",
    ]);
  });

  it("选本地 H3 Ref2VA 时同类型合并成 9 图 / 3 音频 / 3 视频三个端口", () => {
    const h3 = node("model.video", "local:minimax_h3_ref2va");
    expect(isReferenceVideoModel(h3)).toBe(true);
    const ports = portsOf(h3);
    expect(ports.inputs.map((port) => port.id)).toEqual([
      "prompt",
      "negative",
      "refImage",
      "refAudio",
      "refVideo",
    ]);
    expect(ports.inputs.slice(2).map((port) => port.max)).toEqual([9, 3, 3]);
    expect(portOf(h3, "refImage", "in")?.type).toBe("image");
    expect(portOf(h3, "refImage9", "in")).toBeNull();
  });

  it("本地视频按家族给首帧 / 尾帧 / 无帧输入", () => {
    const families: Record<string, string> = {
      "minimax-h3": "minimax_h3",
      "wan22-ti2v": "wan22_ti2v",
      "wan21-t2v": "wan21_t2v",
      "ltx-2.5": "ltx_25",
    };
    const context = { modelFamily: (id: string) => families[id] ?? null };
    expect(portsOf(node("model.video", "local:minimax-h3"), context).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
      "end",
    ]);
    expect(portsOf(node("model.video", "local:wan22-ti2v"), context).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
    ]);
    expect(portsOf(node("model.video", "local:wan21-t2v"), context).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
    ]);
    expect(portsOf(node("model.video", "local:ltx-2.5"), context).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
      "end",
    ]);
    // 家族还没加载：沿用静态首帧 / 尾帧。
    expect(portsOf(node("model.video", "local:minimax-h3")).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
      "end",
    ]);
  });

  it("云端视频只给 MiniMax 展开多模态参考端口", () => {
    const context = { cloudKind: (id: string) => (id === "mm" ? "minimax" : "openai") };
    expect(isReferenceVideoModel(node("model.video", "cloud:mm"), context)).toBe(true);
    expect(isReferenceVideoModel(node("model.video", "cloud:other"), context)).toBe(false);
    expect(isReferenceVideoModel(node("model.video", "cloud:unloaded"))).toBe(false);
  });

  it("云端视频没有图生视频能力时不摆首尾帧端口", () => {
    const t2vOnly = {
      cloudKind: () => "openai",
      cloudCapabilities: () => ["t2v"],
    };
    const full = {
      cloudKind: () => "openai",
      cloudCapabilities: () => ["t2v", "i2v"],
    };
    expect(portsOf(node("model.video", "cloud:p1"), t2vOnly).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
    ]);
    // 云端非 MiniMax 服务只有首帧（没有尾帧接口）。
    expect(portsOf(node("model.video", "cloud:p1"), full).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
    ]);
    // 能力还没加载：沿用静态首帧 / 尾帧，加载后再收窄。
    expect(portsOf(node("model.video", "cloud:p1")).inputs.map((p) => p.id)).toEqual([
      "prompt",
      "negative",
      "init",
      "end",
    ]);
  });

  it("图像节点按云端服务能力展开多图参考（本地固定一张）", () => {
    const gemini = { cloudKind: () => "gemini" };
    const local = node("model.image", "local:qwen-image-edit");
    expect(portsOf(local).inputs.map((port) => port.id)).toEqual(["prompt", "negative", "ref"]);
    expect(portsOf(local, gemini).inputs.map((port) => port.id)).toEqual([
      "prompt",
      "negative",
      "ref",
    ]);
    const cloud = node("model.image", "cloud:p1");
    expect(portsOf(cloud).inputs.map((port) => port.id)).toEqual(["prompt", "negative", "ref"]);
    // 多图服务仍然只有一个 `ref` 端口，max 就是能接的张数（检查器里多选）。
    expect(portsOf(cloud, gemini).inputs.map((port) => port.id)).toEqual([
      "prompt",
      "negative",
      "ref",
    ]);
    expect(portsOf(cloud, gemini).inputs.find((port) => port.id === "ref")?.max).toBe(8);
    // 没有图生图能力的服务：不出现参考图端口。
    const t2iOnly = {
      cloudKind: () => "gemini",
      cloudCapabilities: () => ["t2i"],
      cloudImageRefs: () => 0,
    };
    expect(portsOf(cloud, t2iOnly).inputs.map((port) => port.id)).toEqual([
      "prompt",
      "negative",
    ]);
  });

  it("本地声音克隆 TTS 多出参考音频 / 参考文本端口", () => {
    const families: Record<string, string> = {
      "zipvoice": "zipvoice",
      "moss": "moss_tts_nano",
      "other": "whisper",
    };
    const context = { modelFamily: (id: string) => families[id] ?? null };
    expect(portsOf(node("model.tts", "local:zipvoice"), context).inputs.map((p) => p.id)).toEqual([
      "text",
      "refAudio",
      "refText",
    ]);
    expect(portsOf(node("model.tts", "local:other"), context).inputs.map((p) => p.id)).toEqual([
      "text",
    ]);
    // 云端 TTS 用服务音色，不接参考音频。
    expect(portsOf(node("model.tts", "cloud:x"), context).inputs.map((p) => p.id)).toEqual([
      "text",
    ]);
  });

  it("音频分离按模型家族展开 2 / 4 / 6 条音轨输出", () => {
    const htdemucs = node("model.separate", "local:htdemucs-ort-v1");
    const six = node("model.separate", "local:htdemucs-6s");
    const uvr = node("model.separate", "local:uvr-mdx-voc-ft");
    const families: Record<string, string> = {
      "htdemucs-ort-v1": "htdemucs",
      "htdemucs-6s": "htdemucs6s",
      "uvr-mdx-voc-ft": "uvr",
    };
    const context = { modelFamily: (id: string) => families[id] ?? null };
    expect(portsOf(htdemucs, context).outputs.map((port) => port.id)).toEqual([
      "stemVocals",
      "stemDrums",
      "stemBass",
      "stemOther",
    ]);
    expect(portsOf(six, context).outputs).toHaveLength(6);
    expect(portsOf(uvr, context).outputs.map((port) => port.id)).toEqual([
      "stemVocals",
      "stemAccompaniment",
    ]);
    // 模型家族还没加载：保留单音轨兜底端口。
    expect(portsOf(six).outputs.map((port) => port.id)).toEqual(["audio"]);
  });

  it("视频音频分离：一进两出（视频透传 + 音频）", () => {
    const definition = nodeDefinition("model.demux")!;
    expect(definition.inputs.map((port) => port.id)).toEqual(["video"]);
    expect(definition.outputs.map((port) => port.type)).toEqual(["video", "audio"]);
  });

  it("选了不相干模型时不做动态展开", () => {
    expect(isReferenceVideoModel(node("model.video", "local:wan21_t2v"))).toBe(false);
    expect(isReferenceVideoModel(node("model.video"))).toBe(false);
  });

  it("文本生成节点：常用参数在卡片上，流式 / 思考 / topP 只在检查器", () => {
    const definition = nodeDefinition("model.text");
    expect(definition).not.toBeNull();
    const ids = definition!.params.map((param) => param.id);
    // 提示词只从上游 text 输入来，节点上没有 prompt 字段。
    expect(ids).toEqual([
      "model",
      "system",
      "temperature",
      "maxTokens",
      "stream",
      "reasoning",
      "topP",
    ]);
    const cardIds = definition!.params
      .filter((param) => !param.inspectorOnly)
      .map((param) => param.id);
    expect(cardIds).toEqual(["model", "system", "temperature", "maxTokens"]);
    // 多模态：文本提示词 + 可选图片 / 视频。
    expect(definition!.inputs.map((port) => port.id)).toEqual(["text", "image", "video"]);
    // 模型下拉来自「设置 → 文本生成」的供应商列表，不是本地 / 云端模型表。
    expect(definition!.params.find((param) => param.id === "model")?.llm).toBe(true);
    expect(ids).not.toContain("mode");
    expect(ids).not.toContain("textMode");
  });

  it("图片 / 视频节点用「分辨率」参数替代宽高两项", () => {
    for (const type of ["model.image", "model.video"]) {
      const definition = nodeDefinition(type);
      expect(definition).not.toBeNull();
      const ids = definition!.params.map((param) => param.id);
      expect(ids).toContain("size");
      expect(ids).not.toContain("width");
      expect(ids).not.toContain("height");
      const size = definition!.params.find((param) => param.id === "size");
      expect(size?.kind).toBe("size");
      expect(size?.hintKey).toBe("board.param.sizeHint");
      expect(typeof size?.default).toBe("string");
    }
  });

  it("节点宽度按分类统一", () => {
    for (const definition of BOARD_NODES) {
      if (definition.category === "group") continue;
      expect(definition.defaultSize.width).toBe(
        definition.category === "model" ? 400 : 380,
      );
    }
  });

  it("显示节点把输入原样透传到输出", () => {
    for (const type of ["display.image", "display.video", "display.audio", "display.text"]) {
      const definition = nodeDefinition(type);
      expect(definition).not.toBeNull();
      expect(definition!.inputs).toHaveLength(1);
      expect(definition!.outputs).toHaveLength(1);
      expect(definition!.outputs[0].type).toBe(type.split(".")[1]);
    }
  });

  it("组节点：没有端口、不参与运行", () => {
    const definition = nodeDefinition("group");
    expect(definition).not.toBeNull();
    expect(definition!.category).toBe("group");
    expect(definition!.inputs).toHaveLength(0);
    expect(definition!.outputs).toHaveLength(0);
  });

  it("文本显示节点：默认 Markdown，可切纯文本", () => {
    const definition = nodeDefinition("display.text");
    expect(definition).not.toBeNull();
    const mode = definition!.params.find((param) => param.id === "mode");
    expect(mode?.kind).toBe("select");
    expect(mode?.default).toBe("markdown");
    expect(mode?.options?.map((option) => option.value)).toEqual(["markdown", "plain"]);
  });

  it("画面增强：模型参数随处理方式切换", () => {
    const definition = nodeDefinition("model.enhance")!;
    const upscale = visibleParams(definition, { op: "upscale" }).map((param) => param.id);
    const interpolate = visibleParams(definition, { op: "interpolate" }).map((param) => param.id);
    expect(upscale).toEqual(["op", "upscaleModel", "scale"]);
    expect(interpolate).toEqual(["op", "interpModel", "factor"]);
    // 新节点还没有 params 时按默认值（超分）判断。
    expect(visibleParams(definition, {}).map((param) => param.id)).toEqual([
      "op",
      "upscaleModel",
      "scale",
    ]);
  });

  it("publishedAssetIds：单端口返回整摞，当前发布那张一定在里面", () => {
    const stacked: BoardNode = {
      id: "n",
      type: "model.image",
      position: { x: 0, y: 0 },
      data: {
        params: {},
        bindings: {},
        outputAssetIds: ["a1", "a2", "a3"],
        outputAssetId: "a2",
      },
    };
    expect(publishedAssetIds(stacked, "image")).toEqual(["a1", "a2", "a3"]);
    // 旧文档只有 outputAssetId：也当成一摞（一张）。
    const single: BoardNode = {
      ...stacked,
      data: { params: {}, bindings: {}, outputAssetId: "a9" },
    };
    expect(publishedAssetIds(single, "image")).toEqual(["a9"]);
    // 列表里没有当前发布那张：补到最前面，不能让它丢。
    const drifted: BoardNode = {
      ...stacked,
      data: {
        params: {},
        bindings: {},
        outputAssetIds: ["a1", "a2"],
        outputAssetId: "a3",
      },
    };
    expect(publishedAssetIds(drifted, "image")).toEqual(["a3", "a1", "a2"]);
  });

  it("paramValue：没落盘 / 存成 null 都回落到定义默认值，存过的值（含空串）优先", () => {
    const definition = nodeDefinition("display.text")!;
    expect(paramValue(definition, {}, "mode")).toBe("markdown");
    expect(paramValue(definition, { mode: null }, "mode")).toBe("markdown");
    expect(paramValue(definition, { mode: "" }, "mode")).toBe("");
    expect(paramValue(definition, { mode: "plain" }, "mode")).toBe("plain");
    expect(paramValue(definition, undefined, "mode")).toBe("markdown");
    expect(paramValue(definition, {}, "nope")).toBeUndefined();
    expect(paramValue(null, {}, "mode")).toBeUndefined();
  });
});
