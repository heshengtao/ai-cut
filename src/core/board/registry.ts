/**
 * 画布节点注册表。
 *
 * 一种能力一个节点；模型节点不区分本地/云端，模型下拉在检查器里切。
 * 本阶段先落 4 个输入 + 4 个显示节点，模型节点在后续阶段补齐。
 */
import type { BoardNodeDefinition } from "@/types/board";

const IMAGE_OUT = [{ id: "image", type: "image", labelKey: "board.port.image" }] as const;
const IMAGE_IN = [{ id: "image", type: "image", labelKey: "board.port.image" }] as const;

/** 输入节点：把素材 / 文本送进画布。 */
const INPUT_IMAGE: BoardNodeDefinition = {
  type: "input.image",
  titleKey: "board.node.inputImage",
  category: "input",
  order: 10,
  inputs: [],
  outputs: [...IMAGE_OUT],
  params: [],
  defaultSize: { width: 240, height: 170 },
  assetKind: "image",
};

const INPUT_VIDEO: BoardNodeDefinition = {
  type: "input.video",
  titleKey: "board.node.inputVideo",
  category: "input",
  order: 11,
  inputs: [],
  outputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  params: [],
  defaultSize: { width: 250, height: 170 },
  assetKind: "video",
};

const INPUT_AUDIO: BoardNodeDefinition = {
  type: "input.audio",
  titleKey: "board.node.inputAudio",
  category: "input",
  order: 12,
  inputs: [],
  outputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  params: [],
  defaultSize: { width: 250, height: 120 },
  assetKind: "audio",
};

const INPUT_TEXT: BoardNodeDefinition = {
  type: "input.text",
  titleKey: "board.node.inputText",
  category: "input",
  order: 13,
  inputs: [],
  outputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  params: [{ id: "text", labelKey: "board.param.text", kind: "longtext", default: "" }],
  defaultSize: { width: 260, height: 180 },
};

/** 显示节点：只做中间展示，不消费下游。 */
const DISPLAY_IMAGE: BoardNodeDefinition = {
  type: "display.image",
  titleKey: "board.node.displayImage",
  category: "display",
  order: 30,
  inputs: [...IMAGE_IN],
  outputs: [],
  params: [],
  defaultSize: { width: 320, height: 230 },
  assetKind: "image",
};

const DISPLAY_VIDEO: BoardNodeDefinition = {
  type: "display.video",
  titleKey: "board.node.displayVideo",
  category: "display",
  order: 31,
  inputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  outputs: [],
  params: [],
  defaultSize: { width: 330, height: 240 },
  assetKind: "video",
};

const DISPLAY_AUDIO: BoardNodeDefinition = {
  type: "display.audio",
  titleKey: "board.node.displayAudio",
  category: "display",
  order: 32,
  inputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  outputs: [],
  params: [],
  defaultSize: { width: 330, height: 140 },
  assetKind: "audio",
};

const DISPLAY_TEXT: BoardNodeDefinition = {
  type: "display.text",
  titleKey: "board.node.displayText",
  category: "display",
  order: 33,
  inputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  outputs: [],
  params: [
    {
      id: "mode",
      labelKey: "board.param.textMode",
      kind: "select",
      default: "markdown",
      options: [
        { value: "markdown", labelKey: "board.textMode.markdown" },
        { value: "plain", labelKey: "board.textMode.plain" },
      ],
    },
  ],
  defaultSize: { width: 330, height: 220 },
};

export const BOARD_NODES: BoardNodeDefinition[] = [
  INPUT_IMAGE,
  INPUT_VIDEO,
  INPUT_AUDIO,
  INPUT_TEXT,
  DISPLAY_IMAGE,
  DISPLAY_VIDEO,
  DISPLAY_AUDIO,
  DISPLAY_TEXT,
];

const BY_TYPE = new Map(BOARD_NODES.map((definition) => [definition.type, definition]));

/** 按类型取定义；画布里的未知类型（旧版本 / 未来插件）返回 null。 */
export function nodeDefinition(type: string): BoardNodeDefinition | null {
  return BY_TYPE.get(type) ?? null;
}

/** 某个端口在定义里的声明（归一化校验用）。 */
export function portSpecOf(
  nodeType: string,
  portId: string,
  side: "in" | "out",
): BoardNodeDefinition["inputs"][number] | null {
  const definition = nodeDefinition(nodeType);
  if (!definition) return null;
  const ports = side === "in" ? definition.inputs : definition.outputs;
  return ports.find((port) => port.id === portId) ?? null;
}

/** 按分类分组的节点（添加菜单用）。 */
export function nodesByCategory(): Record<string, BoardNodeDefinition[]> {
  const grouped: Record<string, BoardNodeDefinition[]> = { input: [], display: [], model: [] };
  for (const definition of BOARD_NODES) grouped[definition.category].push(definition);
  for (const list of Object.values(grouped)) list.sort((a, b) => a.order - b.order);
  return grouped;
}

// ---------------------------------------------------------------------------
// 模型节点：一种能力一个节点，节点内下拉切本地 / 云端。
// ---------------------------------------------------------------------------

const MODEL_PARAM = (feature: string, capability?: string): BoardNodeDefinition["params"][number] => ({
  id: "model",
  labelKey: "board.param.model",
  kind: "select",
  model: { feature, capability },
});

const MODEL_IMAGE: BoardNodeDefinition = {
  type: "model.image",
  titleKey: "board.node.modelImage",
  category: "model",
  order: 50,
  inputs: [
    { id: "ref", type: "image", labelKey: "board.port.refImage" },
  ],
  outputs: [{ id: "image", type: "image", labelKey: "board.port.image" }],
  params: [
    MODEL_PARAM("image-gen", "t2i"),
    { id: "prompt", labelKey: "board.param.prompt", kind: "longtext", default: "" },
    { id: "negative", labelKey: "board.param.negative", kind: "text", default: "" },
    { id: "width", labelKey: "board.param.width", kind: "number", default: 1024, min: 256, max: 2048, step: 64 },
    { id: "height", labelKey: "board.param.height", kind: "number", default: 1024, min: 256, max: 2048, step: 64 },
    { id: "steps", labelKey: "board.param.steps", kind: "number", default: 20, min: 1, max: 60 },
    { id: "seed", labelKey: "board.param.seed", kind: "seed", default: -1 },
  ],
  defaultSize: { width: 280, height: 210 },
  liveOutput: true,
};

const MODEL_VIDEO: BoardNodeDefinition = {
  type: "model.video",
  titleKey: "board.node.modelVideo",
  category: "model",
  order: 51,
  inputs: [
    { id: "init", type: "image", labelKey: "board.port.firstFrame" },
    { id: "end", type: "image", labelKey: "board.port.lastFrame" },
    { id: "refImage", type: "image", labelKey: "board.port.refImage" },
    { id: "refAudio", type: "audio", labelKey: "board.port.refAudio" },
    { id: "refVideo", type: "video", labelKey: "board.port.refVideo" },
  ],
  outputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  params: [
    MODEL_PARAM("video-gen", "t2v"),
    { id: "prompt", labelKey: "board.param.prompt", kind: "longtext", default: "" },
    { id: "width", labelKey: "board.param.width", kind: "number", default: 832, min: 256, max: 1920, step: 32 },
    { id: "height", labelKey: "board.param.height", kind: "number", default: 480, min: 256, max: 1080, step: 32 },
    { id: "seconds", labelKey: "board.param.seconds", kind: "number", default: 5, min: 1, max: 30 },
    { id: "seed", labelKey: "board.param.seed", kind: "seed", default: -1 },
  ],
  defaultSize: { width: 290, height: 230 },
  liveOutput: true,
};

const MODEL_TTS: BoardNodeDefinition = {
  type: "model.tts",
  titleKey: "board.node.modelTts",
  category: "model",
  order: 52,
  inputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  outputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  params: [
    { id: "model", labelKey: "board.param.model", kind: "select", model: { feature: "tts" } },
    { id: "text", labelKey: "board.param.text", kind: "longtext", default: "" },
  ],
  defaultSize: { width: 280, height: 200 },
  liveOutput: true,
};

const MODEL_ASR: BoardNodeDefinition = {
  type: "model.asr",
  titleKey: "board.node.modelAsr",
  category: "model",
  order: 53,
  inputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  outputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  params: [
    { id: "model", labelKey: "board.param.model", kind: "select", model: { feature: "asr" } },
  ],
  defaultSize: { width: 270, height: 180 },
  liveOutput: true,
};

const MODEL_TEXT: BoardNodeDefinition = {
  type: "model.text",
  titleKey: "board.node.modelText",
  category: "model",
  order: 54,
  inputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  outputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  params: [
    { id: "prompt", labelKey: "board.param.prompt", kind: "longtext", default: "" },
    {
      id: "mode",
      labelKey: "board.param.textMode",
      kind: "select",
      default: "chat",
      options: [
        { value: "chat", labelKey: "board.textMode.chat" },
        { value: "template", labelKey: "board.textMode.template" },
      ],
    },
  ],
  defaultSize: { width: 290, height: 200 },
  liveOutput: true,
};

const MODEL_ENHANCE: BoardNodeDefinition = {
  type: "model.enhance",
  titleKey: "board.node.modelEnhance",
  category: "model",
  order: 55,
  inputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  outputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  params: [
    {
      id: "op",
      labelKey: "board.param.enhanceOp",
      kind: "select",
      default: "upscale",
      options: [
        { value: "upscale", labelKey: "board.enhance.upscale" },
        { value: "interpolate", labelKey: "board.enhance.interpolate" },
      ],
    },
    { id: "model", labelKey: "board.param.model", kind: "select", model: { feature: "superres" } },
    { id: "scale", labelKey: "board.param.scale", kind: "number", default: 2, min: 2, max: 4 },
    { id: "factor", labelKey: "board.param.factor", kind: "number", default: 2, min: 2, max: 4 },
  ],
  defaultSize: { width: 280, height: 210 },
  liveOutput: true,
};

const MODEL_SEPARATE: BoardNodeDefinition = {
  type: "model.separate",
  titleKey: "board.node.modelSeparate",
  category: "model",
  order: 56,
  inputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  outputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  params: [
    { id: "model", labelKey: "board.param.model", kind: "select", model: { feature: "separate" } },
  ],
  defaultSize: { width: 270, height: 180 },
  liveOutput: true,
};

BOARD_NODES.push(
  MODEL_IMAGE,
  MODEL_VIDEO,
  MODEL_TTS,
  MODEL_ASR,
  MODEL_TEXT,
  MODEL_ENHANCE,
  MODEL_SEPARATE,
);

for (const definition of BOARD_NODES) BY_TYPE.set(definition.type, definition);
