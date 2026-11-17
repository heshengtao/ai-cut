/**
 * 画布节点注册表。
 *
 * 一种能力一个节点；模型节点不区分本地/云端，模型下拉在检查器里切。
 * 本阶段先落 4 个输入 + 4 个显示节点，模型节点在后续阶段补齐。
 */
import type { BoardNode, BoardNodeDefinition, BoardPortSpec } from "@/types/board";

/** 输入 / 显示节点统一宽度。 */
export const MEDIA_WIDTH = 380;
/** 模型节点统一宽度（比输入 / 显示略宽，参数控件排得下）。 */
export const MODEL_WIDTH = 400;

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
  defaultSize: { width: MEDIA_WIDTH, height: 300 },
  lockAspectRatio: true,
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
  defaultSize: { width: MEDIA_WIDTH, height: 260 },
  lockAspectRatio: true,
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
  defaultSize: { width: MEDIA_WIDTH, height: 180 },
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
  defaultSize: { width: MEDIA_WIDTH, height: 200 },
};

/** 显示节点：只做中间展示，不消费下游。 */
const DISPLAY_IMAGE: BoardNodeDefinition = {
  type: "display.image",
  titleKey: "board.node.displayImage",
  category: "display",
  order: 30,
  inputs: [...IMAGE_IN],
  // 显示节点也把输入原样发布到输出（和 ai-board 的 display 节点一致），
  // 下游可以继续接模型 / 显示，不需要再单独复制一个输入节点。
  outputs: [...IMAGE_OUT],
  params: [],
  defaultSize: { width: MEDIA_WIDTH, height: 300 },
  lockAspectRatio: true,
  assetKind: "image",
};

const DISPLAY_VIDEO: BoardNodeDefinition = {
  type: "display.video",
  titleKey: "board.node.displayVideo",
  category: "display",
  order: 31,
  inputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  outputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  params: [],
  defaultSize: { width: MEDIA_WIDTH, height: 260 },
  lockAspectRatio: true,
  assetKind: "video",
};

const DISPLAY_AUDIO: BoardNodeDefinition = {
  type: "display.audio",
  titleKey: "board.node.displayAudio",
  category: "display",
  order: 32,
  inputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  outputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  params: [],
  defaultSize: { width: MEDIA_WIDTH, height: 180 },
  assetKind: "audio",
};

const DISPLAY_TEXT: BoardNodeDefinition = {
  type: "display.text",
  titleKey: "board.node.displayText",
  category: "display",
  order: 33,
  inputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  outputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  // 文本显示默认 Markdown，可切纯文本（两种都用同一份发布文本）。
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
  defaultSize: { width: MEDIA_WIDTH, height: 200 },
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

/**
 * 动态端口的查询上下文。
 *
 * 注册表是纯函数（domain 引擎也会打包它），拿不到 Pinia store；界面上把
 * 「云端服务 id → 服务类型」「本地模型 id → 家族」两个查询回调传进来，
 * 端口就能按当前选的模型展开。回调缺省时退回「单参考图 / 单音轨」的安全形态。
 */
export interface BoardPortContext {
  cloudKind?: (providerId: string) => string | null;
  modelFamily?: (modelId: string) => string | null;
  /** 云端图像服务能接几张参考图（没有图生图能力的服务返回 0，不展开端口）。 */
  cloudImageRefs?: (providerId: string) => number;
  /** 云端服务的实际能力；`null` = 还没加载（按完整能力渲染，加载后再收窄）。 */
  cloudCapabilities?: (providerId: string) => string[] | null;
  /** 云端视频服务当前配置的模型名（判断是不是 H3 多模态参考）。 */
  cloudVideoModel?: (providerId: string) => string | null;
}

/** 本地 / 云端模型值：`local:<id>` / `cloud:<id>`（文本模型是 `<供应商>::<模型>`，不在此列）。 */
export function splitModelValue(value: unknown): { kind: "local" | "cloud"; id: string } | null {
  if (typeof value !== "string" || !value.includes(":")) return null;
  const [kind, ...rest] = value.split(":");
  if ((kind !== "local" && kind !== "cloud") || rest.length === 0) return null;
  return { kind, id: rest.join(":") };
}

/** 同类型多路输入合并成一个端口：H3 的 9 图 / 3 音频 / 3 视频。 */
const REF_IMAGE: BoardPortSpec = {
  id: "refImage",
  type: "image",
  labelKey: "board.port.refImage",
  max: 9,
};
const REF_AUDIO: BoardPortSpec = {
  id: "refAudio",
  type: "audio",
  labelKey: "board.port.refAudio",
  max: 3,
};
const REF_VIDEO: BoardPortSpec = {
  id: "refVideo",
  type: "video",
  labelKey: "board.port.refVideo",
  max: 3,
};

/** 首帧 / 尾帧（单张）。 */
const FRAME_INIT: BoardPortSpec = {
  id: "init",
  type: "image",
  labelKey: "board.port.firstFrame",
};
const FRAME_END: BoardPortSpec = {
  id: "end",
  type: "image",
  labelKey: "board.port.lastFrame",
};

/** 提示词 / 反向提示词：语义不同，永远是两个独立输入（max 1）。 */
const PROMPT_IN: BoardPortSpec = {
  id: "prompt",
  type: "text",
  labelKey: "board.port.prompt",
};
const NEGATIVE_IN: BoardPortSpec = {
  id: "negative",
  type: "text",
  labelKey: "board.port.negative",
};

/**
 * 云端图像服务最多能接几张参考图（和 `crates/daemon/src/cloud_gen.rs` 的
 * 多图实现一一对应）。1 = 只支持单张原图。
 */
const CLOUD_IMAGE_REFS: Record<string, number> = {
  openai: 4,
  gemini: 8,
  openrouter: 8,
  siliconflow: 4,
  ark: 10,
  dashscope: 3,
  bfl: 4,
  stability: 1,
  replicate: 1,
  fal: 1,
  kling: 1,
  minimax: 1,
  luma: 1,
  runway: 1,
};

/** 本地图像模型只支持一张参考图（sd.cpp 的 `-r` / `--init-img` 只收一张）。 */
const LOCAL_IMAGE_REFS = 1;

/** 云端图像服务的参考图上限（`cloud_gen.rs` 的多图实现与之对应）。 */
export function cloudImageRefLimit(kind: string | null): number {
  return kind ? CLOUD_IMAGE_REFS[kind] ?? 1 : 1;
}

/**
 * 这个图像节点能接几张参考图。
 *
 * 本地模型固定 1 张；云端按服务类型（`openai` / `gemini` …）给不同的上限。
 * 服务类型还没加载时按 1 张渲染，加载完自动展开。
 */
export function imageRefCount(node: BoardNode, context?: BoardPortContext): number {
  const model = splitModelValue(node.data.params.model);
  if (!model) return 1;
  if (model.kind === "local") return LOCAL_IMAGE_REFS;
  if (context?.cloudImageRefs) return Math.max(0, context.cloudImageRefs(model.id));
  const kind = context?.cloudKind?.(model.id) ?? null;
  return Math.max(1, kind ? cloudImageRefLimit(kind) : 1);
}

/** 图像参考图端口（一张都没有时整个端口不出现）。 */
function imageInputPorts(count: number): BoardPortSpec[] {
  if (count <= 0) return [];
  return [{ id: "ref", type: "image", labelKey: "board.port.refImage", max: count }];
}

/**
 * 视频节点的输入端口：按模型家族 / 云端能力给「首帧、尾帧、多模态参考」。
 *
 * 和 `crates/daemon/src/video_gen.rs` 的 `VideoSpec` 一一对应：
 * - Ref2VA：9 图 / 3 音频 / 3 视频；
 * - FLF2VA（MiniMax-H3、LTX）：首帧 + 尾帧；
 * - TI2V（Wan2.2）：只要首帧；
 * - 纯 T2V（Wan2.1 / Wan2.2-A14B / Hunyuan）：没有帧输入；
 * - 云端：MiniMax 走 Ref2VA；其它服务按是否支持 i2v 决定有没有首帧。
 *
 * 返回 `null` 表示模型信息还没加载，调用方沿用静态端口（首帧 / 尾帧）。
 */
export function videoInputsFor(
  node: BoardNode,
  context?: BoardPortContext,
): BoardPortSpec[] | null {
  const model = splitModelValue(node.data.params.model);
  if (!model) return null;
  if (model.kind === "cloud") {
    const kind = context?.cloudKind?.(model.id) ?? null;
    const videoModel = context?.cloudVideoModel?.(model.id) ?? null;
    // 只有 MiniMax 的 H3 模型支持 9 图 / 3 音频 / 3 视频参考。
    if (kind === "minimax" && (videoModel === null || /h3/i.test(videoModel))) {
      return [REF_IMAGE, REF_AUDIO, REF_VIDEO];
    }
    const capabilities = context?.cloudCapabilities?.(model.id);
    if (!capabilities) return null;
    return capabilities.includes("i2v") ? [FRAME_INIT] : [];
  }
  // 本地 Ref2VA 即使模型家族表还没加载，也能从 id 直接认出来。
  if (/h3.*ref2va|ref2va/i.test(model.id)) return [REF_IMAGE, REF_AUDIO, REF_VIDEO];
  const family = context?.modelFamily?.(model.id) ?? null;
  if (!family) return null;
  switch (family) {
    case "minimax_h3_ref2va":
      return [REF_IMAGE, REF_AUDIO, REF_VIDEO];
    case "minimax_h3":
    case "ltx_23":
    case "ltx_25":
      return [FRAME_INIT, FRAME_END];
    case "wan22_ti2v":
      return [FRAME_INIT];
    default:
      return [];
  }
}

/** 视频节点选的是不是多模态参考模型（H3 Ref2VA / 云端 MiniMax）。 */
export function isReferenceVideoModel(node: BoardNode, context?: BoardPortContext): boolean {
  const model = splitModelValue(node.data.params.model);
  // 本地模型即使家族表还没加载，也能从 id 认出来。
  if (model?.kind === "local" && /h3.*ref2va|ref2va/i.test(model.id)) return true;
  return videoInputsFor(node, context)?.some((port) => port.max !== undefined) ?? false;
}

/** 本地 TTS 家族里支持「参考音色」（声音克隆）的模型。 */
const CLONE_TTS_FAMILIES = new Set(["moss_tts_nano", "zipvoice"]);

/**
 * TTS 节点的输入：文本必填；本地声音克隆模型再加参考音频 + 参考文本。
 * 云端 TTS 用服务自己的音色 id，不接参考音频。
 */
export function ttsInputsFor(
  node: BoardNode,
  context?: BoardPortContext,
): BoardPortSpec[] | null {
  const model = splitModelValue(node.data.params.model);
  if (!model) return null;
  if (model.kind === "cloud") return [{ id: "text", type: "text", labelKey: "board.port.text" }];
  const family = context?.modelFamily?.(model.id) ?? null;
  if (!family) return null;
  const inputs: BoardPortSpec[] = [{ id: "text", type: "text", labelKey: "board.port.text" }];
  if (CLONE_TTS_FAMILIES.has(family)) {
    inputs.push(
      { id: "refAudio", type: "audio", labelKey: "board.port.refAudio" },
      { id: "refText", type: "text", labelKey: "board.port.refText" },
    );
  }
  return inputs;
}

/**
 * 音频分离模型的分轨（顺序 = 后端写文件的顺序）。
 *
 * UVR 只出人声 / 伴奏两条；HTDemucs 四条；6s 六条。
 */
const STEM_ORDER = ["vocals", "drums", "bass", "other", "guitar", "piano", "accompaniment"];

const STEM_LABELS: Record<string, string> = {
  vocals: "board.port.stemVocals",
  drums: "board.port.stemDrums",
  bass: "board.port.stemBass",
  other: "board.port.stemOther",
  guitar: "board.port.stemGuitar",
  piano: "board.port.stemPiano",
  accompaniment: "board.port.stemAccompaniment",
};

/** 模型家族 → 分轨名（顺序与后端一致，展示时按 STEM_ORDER 排）。 */
export function stemsForFamily(family: string | null | undefined): string[] {
  switch (family) {
    case "htdemucs":
      return ["drums", "bass", "other", "vocals"];
    case "htdemucs6s":
      return ["drums", "bass", "other", "vocals", "guitar", "piano"];
    case "uvr":
      return ["vocals", "accompaniment"];
    default:
      return [];
  }
}

/** 分轨名 → 端口 id（`stemVocals` 之类）。 */
export function stemPortId(stem: string): string {
  return `stem${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
}

/** 分轨端口：人声排在最前，方便「提取人声」这种最常用的连线。 */
function stemPorts(stems: string[]): BoardPortSpec[] {
  const ordered = [...stems].sort(
    (a, b) => (STEM_ORDER.indexOf(a) + 1 || 99) - (STEM_ORDER.indexOf(b) + 1 || 99),
  );
  return ordered.map((stem) => ({
    id: stemPortId(stem),
    type: "audio" as const,
    labelKey: STEM_LABELS[stem] ?? "board.port.audio",
  }));
}

/**
 * 节点实际渲染的端口。
 *
 * - 视频 + H3：换成 9 图 / 3 音频 / 3 视频；
 * - 图像：本地 1 张参考图，云端按服务能力展开多图；
 * - 音频分离：按模型家族展开 2 / 4 / 6 条音轨输出。
 */
export function portsOf(
  node: BoardNode,
  context?: BoardPortContext,
): { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] } {
  const definition = nodeDefinition(node.type);
  if (!definition) return { inputs: [], outputs: [] };
  if (definition.type === "model.video") {
    const dynamic = videoInputsFor(node, context) ?? [FRAME_INIT, FRAME_END];
    return { inputs: [PROMPT_IN, NEGATIVE_IN, ...dynamic], outputs: definition.outputs };
  }
  if (definition.type === "model.image") {
    return {
      inputs: [PROMPT_IN, NEGATIVE_IN, ...imageInputPorts(imageRefCount(node, context))],
      outputs: definition.outputs,
    };
  }
  if (definition.type === "model.tts") {
    const inputs = ttsInputsFor(node, context);
    return { inputs: inputs ?? definition.inputs, outputs: definition.outputs };
  }
  if (definition.type === "model.separate") {
    const model = splitModelValue(node.data.params.model);
    const family = model?.kind === "local" ? context?.modelFamily?.(model.id) ?? null : null;
    const stems = stemsForFamily(family);
    if (stems.length > 0) {
      return { inputs: definition.inputs, outputs: stemPorts(stems) };
    }
  }
  return { inputs: definition.inputs, outputs: definition.outputs };
}

/** 某个端口在**这个节点实例**上的声明（动态端口也算，连线校验用）。 */
export function portOf(
  node: BoardNode,
  portId: string,
  side: "in" | "out",
  context?: BoardPortContext,
): BoardPortSpec | null {
  const ports = portsOf(node, context);
  const list = side === "in" ? ports.inputs : ports.outputs;
  return list.find((port) => port.id === portId) ?? null;
}

/** 节点对外发布的产物 id（多端口节点按端口取，单端口节点沿用 `outputAssetId`）。 */
export function publishedAssetId(
  node: BoardNode,
  portId: string,
  context?: BoardPortContext,
): string | undefined {
  const ports = portsOf(node, context).outputs;
  // 单端口节点：附件卡里切换「当前发布」就是改 outputAssetId（旧语义不变）。
  if (ports.length <= 1) return node.data.outputAssetId;
  // 多端口节点：各端口有各自的产物，不能拿当前预览的那一个冒充别的端口。
  const direct = node.data.outputs?.[portId];
  if (direct) return direct;
  // 旧工程里「音频分离」只画过一个 audio 端口：连线还挂在它上面时按第一路（人声）发布。
  if (portId === "audio" && node.type === "model.separate") {
    return node.data.outputs?.[ports[0]?.id ?? ""] ?? node.data.outputAssetId;
  }
  // 端口已经被换掉（例如 H3 → 普通视频模型）：给第一路兜底，至少不断链。
  if (!ports.some((port) => port.id === portId)) {
    return node.data.outputs?.[ports[0]?.id ?? ""];
  }
  return undefined;
}

/**
 * 当前要渲染的参数：按 `visibleWhen` 过滤掉不该出现的项
 * （例如「画面增强」选插帧时只显示插帧模型与倍数）。
 */
export function visibleParams(
  definition: BoardNodeDefinition | null | undefined,
  values: Record<string, unknown>,
): BoardNodeDefinition["params"] {
  if (!definition) return [];
  // 参数还没落进 `data.params`（新节点）时，要拿定义里的默认值来判断可见性。
  const valueOf = (id: string): unknown => {
    const stored = values[id];
    if (stored !== undefined) return stored;
    return definition.params.find((spec) => spec.id === id)?.default;
  };
  return definition.params.filter((spec) => {
    if (!spec.visibleWhen) return true;
    return String(valueOf(spec.visibleWhen.param) ?? "") === String(spec.visibleWhen.equals);
  });
}

/** 按分类分组的节点（添加菜单用）。 */
export function nodesByCategory(): Record<string, BoardNodeDefinition[]> {
  const grouped: Record<string, BoardNodeDefinition[]> = {
    input: [],
    display: [],
    model: [],
    group: [],
  };
  for (const definition of BOARD_NODES) grouped[definition.category].push(definition);
  for (const list of Object.values(grouped)) list.sort((a, b) => a.order - b.order);
  return grouped;
}

// ---------------------------------------------------------------------------
// 模型节点：一种能力一个节点，节点内下拉切本地 / 云端。
//
// 默认尺寸是「卡片上的控件刚好占满」量出来的（34px 的 MD3 控件 + 标签 + 8px 间距），
// 不是拍脑袋的值：高度贴着内容走，下方不留大片空白。改参数后重新量一遍再改这里。
// ---------------------------------------------------------------------------

const MODEL_PARAM = (
  feature: string,
  capability?: string,
  cloud?: "tts" | "asr",
): BoardNodeDefinition["params"][number] => ({
  id: "model",
  labelKey: "board.param.model",
  kind: "select",
  model: { feature, capability, cloud },
});

const MODEL_IMAGE: BoardNodeDefinition = {
  type: "model.image",
  titleKey: "board.node.modelImage",
  category: "model",
  order: 50,
  inputs: [
    PROMPT_IN,
    NEGATIVE_IN,
    { id: "ref", type: "image", labelKey: "board.port.refImage" },
  ],
  outputs: [{ id: "image", type: "image", labelKey: "board.port.image" }],
  params: [
    MODEL_PARAM("image-gen", "t2i"),
    {
      id: "prompt",
      labelKey: "board.param.prompt",
      kind: "longtext",
      default: "",
      hintKey: "board.param.promptOptionalHint",
    },
    {
      id: "negative",
      labelKey: "board.param.negative",
      kind: "text",
      default: "",
      hintKey: "board.param.negativeOptionalHint",
    },
    {
      id: "size",
      labelKey: "board.param.size",
      kind: "size",
      // 选项按当前模型算（本地家族 / 云端服务）；这里只是「没选模型时」的缺省档。
      default: "1024x1024",
      hintKey: "board.param.sizeHint",
    },
    { id: "steps", labelKey: "board.param.steps", kind: "number", default: 20, min: 1, max: 60 },
    { id: "seed", labelKey: "board.param.seed", kind: "seed", default: -1 },
    {
      id: "count",
      labelKey: "board.param.count",
      kind: "number",
      default: 1,
      min: 1,
      max: 4,
      step: 1,
      inspectorOnly: true,
      hintKey: "board.param.countHint",
    },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 440 },
  liveOutput: true,
};

const MODEL_VIDEO: BoardNodeDefinition = {
  type: "model.video",
  titleKey: "board.node.modelVideo",
  category: "model",
  order: 51,
  inputs: [
    PROMPT_IN,
    NEGATIVE_IN,
    { id: "init", type: "image", labelKey: "board.port.firstFrame" },
    { id: "end", type: "image", labelKey: "board.port.lastFrame" },
  ],
  outputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  params: [
    MODEL_PARAM("video-gen", "t2v"),
    { id: "prompt", labelKey: "board.param.prompt", kind: "longtext", default: "" },
    // 负向提示词：云端服务支持；本地模型的负向词按家族内置（这里不影响本地）。
    {
      id: "negative",
      labelKey: "board.param.negative",
      kind: "text",
      default: "",
      inspectorOnly: true,
      hintKey: "board.param.negativeVideoHint",
    },
    {
      id: "size",
      labelKey: "board.param.size",
      kind: "size",
      default: "480p-16:9",
      hintKey: "board.param.sizeHint",
    },
    { id: "seconds", labelKey: "board.param.seconds", kind: "number", default: 5, min: 1, max: 30 },
    { id: "seed", labelKey: "board.param.seed", kind: "seed", default: -1 },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 378 },
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
    // 本地模型 + 云端 TTS 服务（设置 → 语音合成 里配的那些）一起列。
    MODEL_PARAM("tts", undefined, "tts"),
    { id: "text", labelKey: "board.param.text", kind: "longtext", default: "" },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 252 },
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
    // 本地模型 + 云端 ASR 服务（设置 → 语音识别 里配的那些）一起列。
    MODEL_PARAM("asr", undefined, "asr"),
  ],
  defaultSize: { width: MODEL_WIDTH, height: 166 },
  liveOutput: true,
};

/**
 * 文本生成：设置里配的供应商 + 节点自己的主要参数。
 *
 * 和 ai-board 的 `official.llm` 一样，参数分成两层：**模型 / 系统提示词 / 提示词 /
 * 温度 / 最大 token** 是节点自己的属性（卡片和检查器都能改），端点与 Key 留在设置里。
 * 输出固定按 Markdown 渲染，不再有「渲染方式」下拉。
 *
 * 输入除文本提示词外，还可以选接图片 / 视频（多模态模型直接吃 content parts）；
 * 输出拆成「内容」和「思考」两段，流式时边生成边显示。
 */
const MODEL_TEXT: BoardNodeDefinition = {
  type: "model.text",
  titleKey: "board.node.modelText",
  category: "model",
  order: 54,
  // 文本提示词是主输入；图片 / 视频是可选的多模态参考。
  inputs: [
    { id: "text", type: "text", labelKey: "board.param.prompt" },
    { id: "image", type: "image", labelKey: "board.port.refImage" },
    { id: "video", type: "video", labelKey: "board.port.refVideo" },
  ],
  outputs: [{ id: "text", type: "text", labelKey: "board.port.text" }],
  params: [
    { id: "model", labelKey: "board.param.textModel", kind: "select", llm: true, default: "" },
    {
      id: "system",
      labelKey: "board.param.systemPrompt",
      kind: "longtext",
      default: "",
      placeholderKey: "board.param.systemPromptPlaceholder",
    },
    {
      id: "temperature",
      labelKey: "board.param.temperature",
      kind: "number",
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      id: "maxTokens",
      labelKey: "board.param.maxTokens",
      kind: "number",
      default: 0,
      min: 0,
      max: 65536,
      step: 256,
    },
    // 高级项：卡片上不渲染，只在检查器里出现（对齐 ai-board 的 LlmInspector）。
    {
      id: "stream",
      labelKey: "board.param.stream",
      kind: "toggle",
      default: true,
      inspectorOnly: true,
      hintKey: "board.param.streamHint",
    },
    {
      id: "reasoning",
      labelKey: "board.param.reasoning",
      kind: "select",
      default: "off",
      inspectorOnly: true,
      hintKey: "board.param.reasoningHint",
      options: [
        { value: "off", labelKey: "board.reasoning.off" },
        { value: "low", labelKey: "board.reasoning.low" },
        { value: "medium", labelKey: "board.reasoning.medium" },
        { value: "high", labelKey: "board.reasoning.high" },
      ],
    },
    {
      id: "topP",
      labelKey: "board.param.topP",
      kind: "number",
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      inspectorOnly: true,
      hintKey: "board.param.topPHint",
    },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 316 },
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
    // 超分 / 插帧是两套模型，模型下拉随「处理方式」切换（隐藏的那个不渲染）。
    {
      id: "upscaleModel",
      labelKey: "board.param.model",
      kind: "select",
      model: { feature: "superres" },
      visibleWhen: { param: "op", equals: "upscale" },
    },
    {
      id: "interpModel",
      labelKey: "board.param.model",
      kind: "select",
      model: { feature: "interpolate" },
      visibleWhen: { param: "op", equals: "interpolate" },
    },
    {
      id: "scale",
      labelKey: "board.param.scale",
      kind: "number",
      default: 2,
      min: 2,
      max: 4,
      visibleWhen: { param: "op", equals: "upscale" },
    },
    {
      id: "factor",
      labelKey: "board.param.factor",
      kind: "number",
      default: 2,
      min: 2,
      max: 4,
      visibleWhen: { param: "op", equals: "interpolate" },
    },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 280 },
  liveOutput: true,
};

const MODEL_SEPARATE: BoardNodeDefinition = {
  type: "model.separate",
  titleKey: "board.node.modelSeparate",
  category: "model",
  order: 56,
  inputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  // 具体几条音轨看模型家族（2 / 4 / 6）；模型还没加载时先按单条渲染。
  outputs: [{ id: "audio", type: "audio", labelKey: "board.port.audio" }],
  params: [
    { id: "model", labelKey: "board.param.model", kind: "select", model: { feature: "separate" } },
  ],
  defaultSize: { width: MODEL_WIDTH, height: 166 },
  liveOutput: true,
};

/**
 * 视频音频分离：把一个视频拆成「视频」和「音频」两路输出。
 *
 * 不是 AI 节点：视频输出去掉音轨（画面直拷、不重新编码），音频用 ffmpeg 抽成
 * 一条独立音轨。下游可以只接视频，也可以把音频接去语音识别 / 音源分离。
 */
const MODEL_DEMUX: BoardNodeDefinition = {
  type: "model.demux",
  titleKey: "board.node.modelDemux",
  category: "model",
  order: 57,
  inputs: [{ id: "video", type: "video", labelKey: "board.port.video" }],
  outputs: [
    { id: "video", type: "video", labelKey: "board.port.video" },
    { id: "audio", type: "audio", labelKey: "board.port.audio" },
  ],
  params: [],
  defaultSize: { width: MODEL_WIDTH, height: 166 },
  liveOutput: true,
};

/**
 * 组节点：没有端口、不参与运行，只是把若干节点框在一起，方便整组复制 / 删除 /
 * 禁用 / 旁路。成员 id 存在 `data.children` 里，组成员移动时框会自动贴合。
 */
const GROUP: BoardNodeDefinition = {
  type: "group",
  titleKey: "board.node.group",
  category: "group",
  order: 60,
  inputs: [],
  outputs: [],
  params: [],
  defaultSize: { width: 460, height: 320 },
};

BOARD_NODES.push(
  MODEL_IMAGE,
  MODEL_VIDEO,
  MODEL_TTS,
  MODEL_ASR,
  MODEL_TEXT,
  MODEL_ENHANCE,
  MODEL_SEPARATE,
  MODEL_DEMUX,
  GROUP,
);

for (const definition of BOARD_NODES) BY_TYPE.set(definition.type, definition);
