/**
 * 默认工作流（内置、只读、不落盘）。
 *
 * 每个模板只描述节点和连线；插入画布时由 `board.insertWorkflow` 重新生成 id。
 * 文案走 i18n（`board.library.builtin.*`），所以这里只存 key。
 */
import { nodeDefinition } from "@/core/board/registry";
import type { BoardEdge, BoardNode, BoardNodeData } from "@/types/board";

export interface BuiltinWorkflow {
  /** 稳定 id：`builtin.<slug>`，保存从它改出来的工作流时记进 `origin`。 */
  id: string;
  nameKey: string;
  descriptionKey: string;
  nodes: () => BoardNode[];
  edges: () => BoardEdge[];
}

function sizeOf(type: string): { width: number; height: number } {
  const definition = nodeDefinition(type);
  return definition?.defaultSize ?? { width: 340, height: 200 };
}

function makeNode(
  id: string,
  type: string,
  x: number,
  y: number,
  data: Partial<BoardNodeData> = {},
): BoardNode {
  const size = sizeOf(type);
  return {
    id,
    type,
    position: { x, y },
    size: { ...size },
    data: { params: {}, bindings: {}, ...data },
  };
}

function makeEdge(
  id: string,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
): BoardEdge {
  return { id, source, sourcePort, target, targetPort };
}

/** 文生图：文本 → 图像生成 → 图片显示。 */
const TEXT_TO_IMAGE: BuiltinWorkflow = {
  id: "builtin.text-to-image",
  nameKey: "board.library.builtin.textToImage",
  descriptionKey: "board.library.builtin.textToImageHint",
  nodes: () => [
    makeNode("t1", "input.text", 0, 40),
    makeNode("m1", "model.image", 500, 0),
    makeNode("d1", "display.image", 1000, 0),
  ],
  edges: () => [
    makeEdge("e1", "t1", "text", "m1", "prompt"),
    makeEdge("e2", "m1", "image", "d1", "image"),
  ],
};

/** 图生图：一张参考图 + 指令 → 图像生成 → 图片显示。 */
const IMAGE_EDIT: BuiltinWorkflow = {
  id: "builtin.image-edit",
  nameKey: "board.library.builtin.imageEdit",
  descriptionKey: "board.library.builtin.imageEditHint",
  nodes: () => [
    makeNode("i1", "input.image", 0, 0),
    makeNode("t1", "input.text", 0, 360),
    makeNode("m1", "model.image", 500, 40),
    makeNode("d1", "display.image", 1000, 40),
  ],
  edges: () => [
    makeEdge("e1", "i1", "image", "m1", "ref"),
    makeEdge("e2", "t1", "text", "m1", "prompt"),
    makeEdge("e3", "m1", "image", "d1", "image"),
  ],
};

/** 图生视频：首帧 + 提示词 → 视频生成 → 视频显示。 */
const IMAGE_TO_VIDEO: BuiltinWorkflow = {
  id: "builtin.image-to-video",
  nameKey: "board.library.builtin.imageToVideo",
  descriptionKey: "board.library.builtin.imageToVideoHint",
  nodes: () => [
    makeNode("i1", "input.image", 0, 0),
    makeNode("t1", "input.text", 0, 360),
    makeNode("m1", "model.video", 500, 40),
    makeNode("d1", "display.video", 1000, 40),
  ],
  edges: () => [
    makeEdge("e1", "i1", "image", "m1", "init"),
    makeEdge("e2", "t1", "text", "m1", "prompt"),
    makeEdge("e3", "m1", "video", "d1", "video"),
  ],
};

/** 文本改写：文本 → 文本生成 → 文本显示。 */
const TEXT_REVISE: BuiltinWorkflow = {
  id: "builtin.text-revise",
  nameKey: "board.library.builtin.textRevise",
  descriptionKey: "board.library.builtin.textReviseHint",
  nodes: () => [
    makeNode("t1", "input.text", 0, 40),
    makeNode("m1", "model.text", 500, 0),
    makeNode("d1", "display.text", 1000, 0),
  ],
  edges: () => [
    makeEdge("e1", "t1", "text", "m1", "text"),
    makeEdge("e2", "m1", "text", "d1", "text"),
  ],
};

export const BUILTIN_WORKFLOWS: BuiltinWorkflow[] = [
  TEXT_TO_IMAGE,
  IMAGE_EDIT,
  IMAGE_TO_VIDEO,
  TEXT_REVISE,
];

export function builtinWorkflow(id: string): BuiltinWorkflow | null {
  return BUILTIN_WORKFLOWS.find((item) => item.id === id) ?? null;
}
