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
