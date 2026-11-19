/**
 * 画布节点执行：依赖调度 + 运行模式 + 产物自动入素材库。
 *
 * 复用现有的每一套 AI 能力（图像 / 视频 / TTS / ASR / 增强 / 分离 / 文本），
 * 节点只是把"参数 + 上游产物"翻译成对应 store / API 的调用。
 *
 * 调度按 `core/board/scheduler.ts` 的泳道模型：输入 / 显示即时发布，纯 API 节点
 * （云端生成、文本 LLM）完全并行，本地 GPU 节点默认串行（daemon 的本地引擎是
 * 单进程的），ffmpeg 这类 CPU 任务可与 GPU 并行。「智能排序」优先跑关键路径，
 * 「智能显存分配」在预算内放行本地任务。
 */
import { computed, reactive, ref } from "vue";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { useImageGenStore } from "@/stores/imageGen";
import { useVideoGenStore } from "@/stores/videoGen";
import { useTtsStore } from "@/stores/tts";
import { useAsrStore } from "@/stores/asr";
import { useVideoAiStore } from "@/stores/videoAi";
import { useAudioAiStore } from "@/stores/audioAi";
import { useCloudGenStore } from "@/stores/cloudGen";
import { cloudGenImage, cloudGenVideo } from "@/core/cloudGenApi";
import {
  adapterFor,
  dispatchAdapter,
  paramReader,
  type AdapterIO,
  type AdapterResult,
} from "@/core/board/adapters";
import {
  beginLiveRun,
  endLiveRun,
  liveRun,
  liveRuns,
  updateLiveRun,
} from "@/core/board/liveRuns";
import { createRunSignals } from "@/core/board/runSignals";
import { nodeOwner } from "@/core/board/registry";
import { pluginHostCancel } from "@/core/pluginHostApi";

/**
 * 运行中的实时状态（文本流 / 进度 / 开始时间）。
 *
 * 不写进节点文档：每个 token / 每个 step 都落盘会把画布写爆；节点卡片直接读
 * 这份内存状态（`core/board/liveRuns`），运行结束再把最终产物写回 `data`。
 */
export { liveRuns };
import { addAsset } from "@/core/ops";
import {
  DEFAULT_RUN_LIMITS,
  nodeCost,
  planStarts,
  summarizeRun,
  type NodeCost,
  type RunLimits,
} from "@/core/board/scheduler";
import {
  isReferenceVideoModel,
  portsOf,
  publishedAssetId,
  publishedAssetIds,
  splitModelValue,
  stemPortId,
} from "@/core/board/registry";
import { boardPortContext as portContext } from "@/composables/useBoardPortContext";
import { boardSizeSpecFor } from "@/composables/useBoardSize";
import { boardSizePixels, boardSizeTier } from "@/core/board/size";
import {
  extractAudioPreview,
  extractVideoTrack,
  fileDataUrl,
  importAssetAt,
} from "@/core/media";
import { topologicalOrder } from "@/core/board/graph";
import { llmChat, llmChatStream } from "@/core/agentApi";
import { t } from "@/i18n";
import { splitLlmValue } from "@/composables/useBoardLlm";
import type { BoardEdge, BoardNode, BoardRunMode } from "@/types/board";
import type { LlmChatMessage, LlmContentPart } from "@/types/agent";
import type { AssetKind } from "@/types/project";

export type { BoardRunMode } from "@/types/board";


/** 待跑队列（还没开始的节点 id）。工具栏的计数器显示它。 */
const queue = ref<string[]>([]);
/** 是否还有任务在跑 / 排队（HUD / 工具栏用）。 */
const running = ref(false);
/** 正在运行的节点 → 资源占用（调度器据此分配显存 / 泳道）。 */
const active = reactive<Record<string, NodeCost>>({});
/** 已跑完的节点（本次 runAll 的依赖判断用）。 */
let doneNodes = new Set<string>();
/** 运行环境：显存 / 内存预算与各泳道并行度。 */
const limits = ref<RunLimits>({ ...DEFAULT_RUN_LIMITS });
/** 智能排序：关键路径优先。 */
const smartOrder = ref(true);
/** 智能显存分配：本地并行任务按预算放行（默认引擎单进程，GPU 泳道仍为 1）。 */
const smartMemory = ref(true);
/** 本次运行按泳道汇总（运行面板 / 工具栏提示用）。 */
const plan = ref<ReturnType<typeof summarizeRun> | null>(null);
/** 每节点取消信号：并行时停一个节点不再误伤别的分支。 */
const signals = createRunSignals();
const mode = ref<BoardRunMode>("manual");
const repeatCount = ref(1);
let cancelled = false;
/** 「重复 N 次」按节点计数：并行时不能用全局计数器。 */
const repeatRuns: Record<string, number> = {};

function paramsOf(node: BoardNode): Record<string, unknown> {
  return node.data.params ?? {};
}

function textParam(node: BoardNode, id: string): string {
  const value = paramsOf(node)[id];
  return typeof value === "string" ? value : "";
}

function numberParam(node: BoardNode, id: string, fallback: number): number {
  const value = paramsOf(node)[id];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 沿连线找到**真正产出**的那个节点 + 那个输出端口。
 *
 * 旁路语义就落在这里：被旁路的节点自己不执行，下游要它输出时，就顺着它
 * **同类型的输入**继续往上找；它没有同类型输入，就当输入为空（返回 null）。
 * 这样把中间某个节点旁路掉，链路仍然按原样往下跑。
 */
interface UpstreamRef {
  node: BoardNode;
  portId: string;
}

function resolveUpstream(
  targetNodeId: string,
  targetPortId: string,
  wanted: "text" | "image" | "video" | "audio" | "any",
  seen: Set<string> = new Set(),
): UpstreamRef | null {
  const board = useBoardStore();
  const edge = board.edges.find(
    (item) => item.target === targetNodeId && item.targetPort === targetPortId,
  );
  return edge ? resolveFromEdge(edge, wanted, seen) : null;
}

/** 从一条连线往上找真正产出素材的节点（多路输入逐条解析）。 */
function resolveFromEdge(
  edge: BoardEdge,
  wanted: "text" | "image" | "video" | "audio" | "any",
  seen: Set<string> = new Set(),
): UpstreamRef | null {
  const board = useBoardStore();
  const context = portContext();
  const key = `${edge.target}:${edge.targetPort}:${edge.id}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = board.nodes.find((item) => item.id === edge.source);
  if (!source) return null;
  // 显示节点是「透传」的：下游直接拿它上游已经发布的值，不必等它自己先跑一遍
  // （和 ai-board 的 display 节点跟随实时输入一致）。
  if (source.type.startsWith("display.")) {
    const sourcePorts = portsOf(source, context);
    const input = sourcePorts.inputs.find(
      (port) => wanted === "any" || port.type === wanted || port.type === "any",
    );
    if (input) {
      const next = resolveUpstream(
        source.id,
        input.id,
        input.type === "any" ? wanted : (input.type as typeof wanted),
        seen,
      );
      if (next) return next;
    }
    return { node: source, portId: sourcePorts.outputs[0]?.id ?? edge.sourcePort };
  }
  if (!source.data.bypassed) return { node: source, portId: edge.sourcePort };
  // 旁路：优先沿用同类型的、真的接了线的输入；没有就返回空。
  const inputs = portsOf(source, context).inputs.filter(
    (port) => wanted === "any" || port.type === wanted || port.type === "any",
  );
  const connected = inputs.filter((port) =>
    board.edges.some((item) => item.target === source.id && item.targetPort === port.id),
  );
  for (const port of [...connected, ...inputs]) {
    const next = resolveUpstream(
      source.id,
      port.id,
      port.type === "any" ? wanted : (port.type as typeof wanted),
      seen,
    );
    if (next) return next;
  }
  return null;
}

/**
 * 上游已经**发布**的文本输出。
 *
 * 只读 `outputText`，不读输入节点的参数草案：画布是显式执行的，上游没有运行
 * 之前下游不应该拿到任何东西（否则改一个字就自动推进整条链）。
 */
function upstreamText(nodeId: string, portId: string): string | null {
  const source = resolveUpstream(nodeId, portId, "text");
  return source ? (source.node.data.outputText ?? null) : null;
}

/** 上游已经**发布**的素材输出（按端口取；单端口节点仍读 `outputAssetId`）。 */
function upstreamAsset(
  nodeId: string,
  portId: string,
): { path: string; duration: number; assetId: string } | null {
  const board = useBoardStore();
  const project = useProjectStore();
  const context = portContext();
  const target = board.nodes.find((item) => item.id === nodeId);
  const targetPort = target
    ? portsOf(target, context).inputs.find((port) => port.id === portId)
    : null;
  const source = resolveUpstream(
    nodeId,
    portId,
    (targetPort?.type as "image" | "video" | "audio" | undefined) ?? "any",
  );
  if (!source) return null;
  const assetId = publishedAssetId(source.node, source.portId, context);
  if (!assetId) return null;
  const asset = project.doc.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  return { path: asset.src, duration: asset.duration, assetId };
}

/**
 * 上游已经**发布**的整摞素材（按端口取；`primary` 是上游当前对外发布的那张）。
 *
 * 图片显示节点用整摞做多图牌堆，单张节点只用 `primary`——两者语义都从
 * `publishedAssetIds` 来，不会出现「显示节点只拿到第一张」的割裂。
 */
function upstreamAssets(
  nodeId: string,
  portId: string,
): { ids: string[]; primary?: string } {
  const board = useBoardStore();
  const project = useProjectStore();
  const context = portContext();
  const target = board.nodes.find((item) => item.id === nodeId);
  const targetPort = target
    ? portsOf(target, context).inputs.find((port) => port.id === portId)
    : null;
  const source = resolveUpstream(
    nodeId,
    portId,
    (targetPort?.type as "image" | "video" | "audio" | undefined) ?? "any",
  );
  if (!source) return { ids: [] };
  const primary = publishedAssetId(source.node, source.portId, context);
  const ids = publishedAssetIds(source.node, source.portId, context).filter((id) =>
    project.doc.assets.some((asset) => asset.id === id),
  );
  return { ids, primary: primary && ids.includes(primary) ? primary : ids[0] };
}

/**
 * 收集某个类型的所有上游参考（按检查器里排好的顺序）。
 *
 * 同类型多路输入合并成一个端口后，一个端口可能挂着多条连线；这里逐条
 * 沿连线解析（旁路 / 显示节点透传都算），失败或没连的直接跳过。
 */
function collectRefs(nodeId: string, kind: "image" | "audio" | "video"): string[] {
  const board = useBoardStore();
  const project = useProjectStore();
  const context = portContext();
  const target = board.nodes.find((item) => item.id === nodeId);
  if (!target) return [];
  const portIds = new Set(
    portsOf(target, context)
      .inputs
      // 只收「参考输入」端口：首帧 / 尾帧这类单路端口由上游单独读取，
      // 不能混进 refImages（否则后端会同时收到首帧 + 参考图而报错）。
      .filter(
        (port) =>
          port.type === kind && ((port.max ?? 1) > 1 || port.id.startsWith("ref")),
      )
      .map((port) => port.id),
  );
  if (portIds.size === 0) return [];
  const paths: string[] = [];
  for (const edge of board.edges) {
    if (edge.target !== nodeId || !portIds.has(edge.targetPort)) continue;
    const ref = resolveFromEdge(edge, kind);
    if (!ref) continue;
    const assetId = publishedAssetId(ref.node, ref.portId, context);
    const asset = assetId ? project.doc.assets.find((item) => item.id === assetId) : null;
    if (asset) paths.push(asset.src);
  }
  return paths;
}

/** 图像节点的参考图（一个 `ref` 端口可接多张，顺序就是检查器里的顺序）。 */
function collectImageRefs(nodeId: string): string[] {
  return collectRefs(nodeId, "image");
}

/** `local:<id>` / `cloud:<id>`（端口展开与运行共用同一套解析）。 */
function splitModel(value: unknown): { kind: "local" | "cloud"; id: string } | null {
  return splitModelValue(value);
}



/** 让对应能力的进度事件先订阅上，否则本地 / 云端任务跑起来也收不到进度。 */
function ensureProgressWatches(node: BoardNode): void {
  const model = splitModel(paramsOf(node).model);
  switch (node.type) {
    case "model.image":
    case "model.video":
      useImageGenStore().watch();
      useVideoGenStore().watch();
      useCloudGenStore().watch();
      break;
    case "model.tts":
      useTtsStore().watch();
      break;
    case "model.asr":
      useAsrStore().watch();
      break;
    case "model.enhance":
      useVideoAiStore().watch();
      break;
    case "model.separate":
      useAudioAiStore().watch();
      break;
    default:
      if (model?.kind === "cloud") useCloudGenStore().watch();
      break;
  }
}

/** 当前节点的进度说明（步数 / 云端 message），附件卡等待态直接显示。 */
function liveProgressMessage(node: BoardNode): string | null {
  const model = splitModel(paramsOf(node).model);
  switch (node.type) {
    case "model.image": {
      // 云端任务可以并行：全局进度事件分不清是哪一条，别把别的节点进度写到自己头上。
      if (model?.kind === "cloud") return null;
      const progress = useImageGenStore().progress;
      if (!progress) return null;
      if (progress.step && progress.totalSteps) return `${progress.step} / ${progress.totalSteps}`;
      return progress.message ?? null;
    }
    case "model.video": {
      if (model?.kind === "cloud") return null;
      const progress = useVideoGenStore().progress;
      if (!progress) return null;
      if (progress.step && progress.totalSteps) return `${progress.step} / ${progress.totalSteps}`;
      return progress.message ?? null;
    }
    case "model.tts":
      return useTtsStore().message;
    case "model.asr":
      return useAsrStore().message;
    case "model.enhance":
      return useVideoAiStore().message;
    case "model.separate":
      return useAudioAiStore().message;
    default:
      return null;
  }
}

/** 当前节点的 0..100 进度（本地 sd.cpp / 云端轮询 / TTS / ASR 各有一套）。 */
function liveProgressPct(node: BoardNode): number | null {
  const model = splitModel(paramsOf(node).model);
  switch (node.type) {
    case "model.image":
      return model?.kind === "cloud" ? null : useImageGenStore().progressPct;
    case "model.video":
      return model?.kind === "cloud" ? null : useVideoGenStore().progressPct;
    case "model.tts":
      return useTtsStore().progressPct;
    case "model.asr":
      return useAsrStore().progressPct;
    case "model.enhance":
      return useVideoAiStore().progressPct;
    case "model.separate":
      return useAudioAiStore().progressPct;
    default:
      return null;
  }
}

/** 单个节点的适配器：把画布参数翻译成现有 API 的调用。（导出给单测。） */
export async function runAdapter(
  node: BoardNode,
  nodeId: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<AdapterResult> {
  const route = dispatchAdapter(node.type);
  if (route === "plugin") {
    const readParam = paramReader(node);
    const io: AdapterIO = {
      // 只读 `data.params` 的话，没被用户改过的参数就是 `undefined`——卡片上明明
      // 显示着定义里的默认值（插件作者也因此以为 `io.param` 拿得到），要回落。
      param: <T,>(id: string) => readParam<T>(id),
      text: (portId) => upstreamText(nodeId, portId),
      asset: (portId) => {
        const found = upstreamAsset(nodeId, portId);
        return found ? { path: found.path, assetId: found.assetId } : null;
      },
      refs: (kind) => collectRefs(nodeId, kind),
      progress: (value, message) =>
        updateLiveRun(nodeId, { progress: value, message: message ?? null }),
    };
    // 宿主半的 `run()` 是同步的，前端 abort 不会让它自己停下来：停止运行时要显式
    // 通知 daemon 取消（`ctx.cancelled()` 变 true），否则它会一直跑到服务端结束。
    const owner = nodeOwner(node.type);
    const onAbort = (): void => {
      if (owner) void pluginHostCancel(owner).catch(() => {});
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await adapterFor(node.type)!({ node, nodeId, signal, io });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  if (route === "unknown") throw new Error(`节点 ${node.type} 不支持运行`);
  const imageGen = useImageGenStore();
  const videoGen = useVideoGenStore();
  const tts = useTtsStore();
  const asr = useAsrStore();
  const videoAi = useVideoAiStore();
  const audioAi = useAudioAiStore();
  const model = splitModel(paramsOf(node).model);

  switch (node.type) {
    case "input.image": {
      const project = useProjectStore();
      const ids = node.data.assetIds ?? (node.data.assetId ? [node.data.assetId] : []);
      const index = Math.min(Math.max(0, node.data.stackIndex ?? 0), Math.max(0, ids.length - 1));
      const asset = ids.length > 0
        ? project.doc.assets.find((item) => item.id === ids[index])
        : undefined;
      if (!asset) throw new Error("图片输入还没有选择图片");
      return { assetId: asset.id, kind: "image" };
    }

    case "input.video":
    case "input.audio": {
      const project = useProjectStore();
      const asset = node.data.assetId
        ? project.doc.assets.find((item) => item.id === node.data.assetId)
        : undefined;
      if (!asset) throw new Error(node.type === "input.video" ? "视频输入还没有选择视频" : "音频输入还没有选择音频");
      return { assetId: asset.id, kind: asset.kind };
    }

    case "input.text":
      return { text: textParam(node, "text") };

    case "display.image": {
      // 上游一次出多张时整摞都接过来：卡片按「牌堆」叠放，`assetId` 是当前发布那张。
      const upstream = upstreamAssets(node.id, "image");
      if (upstream.ids.length === 0) throw new Error("缺少上游素材：先连接并运行上游节点");
      return { assets: upstream.ids, assetId: upstream.primary, kind: "image" };
    }

    case "display.video":
    case "display.audio": {
      const port = node.type.slice("display.".length);
      const input = upstreamAsset(node.id, port);
      if (!input) throw new Error("缺少上游素材：先连接并运行上游节点");
      return { assetId: input.assetId, kind: port as AssetKind };
    }

    case "display.text": {
      const text = upstreamText(node.id, "text");
      if (text === null) throw new Error("缺少上游文本：先连接并运行上游节点");
      return { text };
    }

    case "model.image": {
      // 文本与参考图都是可选的：只要有一个就能跑（文生图 / 图生图 / 指令改图）。
      // `prompt` / `negative` 既可以在节点上直接写，也可以从检查器连文本输入；
      // 连线优先（和 ai-board 的「端口覆盖参数」一致）。
      const promptInput = (upstreamText(node.id, "prompt") ?? textParam(node, "prompt")).trim();
      const refs = collectImageRefs(node.id);
      if (!promptInput && refs.length === 0) {
        throw new Error(t("board.node.imageNeedsInput"));
      }
      // 纯参考图模式（空提示词）给一句中性指令，多数云端接口不接受空 prompt。
      const prompt = promptInput || t("board.node.defaultEditPrompt");
      // 输出尺寸：节点上选的是「分辨率」档（本地家族对齐 / 云端白名单 / 比例），
      // 这里统一换算成接口要的像素宽高。
      const sizeSpec = boardSizeSpecFor(node);
      const { width, height } = boardSizePixels(sizeSpec, node.data.params);
      const negative =
        (upstreamText(node.id, "negative") ?? textParam(node, "negative")).trim() || undefined;
      // 一次出多张：输出附件卡会把它们收在同一张卡里，可以来回切换。
      const count = Math.min(4, Math.max(1, Math.round(numberParam(node, "count", 1))));
      const paths: string[] = [];
      for (let index = 0; index < count; index += 1) {
        if (model?.kind === "cloud") {
          // 直接走 API（不经过单例 store）：多个云端节点可以真正同时跑。
          const result = await cloudGenImage({
            providerId: model.id,
            mode: refs.length > 0 ? "edit" : "draw",
            prompt,
            negativePrompt: negative,
            width,
            height,
            initImage: refs[0],
            // 云端多图服务：第一张是原图，其余作为额外参考。
            refImages: refs.slice(1),
            seed: numberParam(node, "seed", -1),
          });
          paths.push(result.path);
          continue;
        }
        if (!model) throw new Error("未选择模型");
        const result = await imageGen.start({
          modelId: model.id,
          prompt,
          negativePrompt: negative,
          width,
          height,
          steps: numberParam(node, "steps", 20),
          seed: numberParam(node, "seed", -1),
          cfgScale: 7,
          initImage: refs[0],
        });
        if (!result) throw new Error(imageGen.error ?? "图像生成失败");
        paths.push(result.path);
      }
      return { paths, kind: "image" };
    }

    case "model.video": {
      // 提示词 / 反向提示词：检查器连了文本输入就用上游，否则用节点上的参数。
      const prompt = (upstreamText(node.id, "prompt") ?? textParam(node, "prompt")).trim();
      if (!prompt) throw new Error("提示词为空");
      const negative =
        (upstreamText(node.id, "negative") ?? textParam(node, "negative")).trim() || undefined;
      const sizeSpec = boardSizeSpecFor(node);
      const { width, height } = boardSizePixels(sizeSpec, node.data.params);
      // 只认分辨率档的服务（方舟 / MiniMax）额外把档位带上；比例由宽高换算。
      const resolution = boardSizeTier(sizeSpec, node.data.params) ?? undefined;
      const seconds = numberParam(node, "seconds", 5);
      const init = upstreamAsset(node.id, "init");
      const end = upstreamAsset(node.id, "end");
      // H3 Ref2VA：9 图 + 3 音频 + 3 视频按端口顺序收集（对应提示词的 <Picture N>）。
      const reference = isReferenceVideoModel(node, portContext());
      const refImages = collectRefs(node.id, "image");
      const refAudios = collectRefs(node.id, "audio");
      const refVideos = collectRefs(node.id, "video");
      if (reference && init) {
        throw new Error("参考模型不能同时接首帧：改用参考图端口");
      }
      if (model?.kind === "cloud") {
        // 同上：云端视频也直接调 API，避免被单例 store 串行化。
        const result = await cloudGenVideo({
          providerId: model.id,
          prompt,
          negativePrompt: negative,
          width,
          height,
          seconds,
          resolution,
          initImage: init?.path,
          refImages,
          refAudios,
          refVideos,
        });
        return { paths: [result.path], kind: "video" };
      }
      if (!model) throw new Error("未选择模型");
      const result = await videoGen.start({
        modelId: model.id,
        prompt,
        width,
        height,
        seconds,
        steps: 6,
        seed: numberParam(node, "seed", -1),
        cfgScale: 1,
        flowShift: 12,
        initImage: init?.path ?? null,
        endImage: end?.path ?? null,
        refImages,
        refAudios,
        refVideos,
      });
      if (!result) throw new Error(videoGen.error ?? "视频生成失败");
      return { paths: [result.path], kind: "video" };
    }

    case "model.tts": {
      const text = upstreamText(node.id, "text") ?? textParam(node, "text");
      if (!text.trim()) throw new Error("文本为空");
      if (!model) throw new Error("未选择模型");
      const items = [{ id: "board", text }];
      // 本地声音克隆模型：参考音频 + 参考文本（云端 TTS 用服务自己的音色 id）。
      const referenceAudio = model.kind === "cloud" ? null : upstreamAsset(node.id, "refAudio");
      const referenceText = model.kind === "cloud" ? null : upstreamText(node.id, "refText");
      const audios =
        model.kind === "cloud"
          ? await tts.synthesizeCloud(model.id, items, null)
          : await tts.synthesize(
              model.id,
              items,
              null,
              referenceAudio?.path ?? null,
              referenceText,
            );
      const path = audios[0]?.path;
      if (!path) throw new Error("语音合成失败");
      return { paths: [path], kind: "audio" };
    }

    case "model.asr": {
      const input = upstreamAsset(node.id, "audio");
      if (!input) throw new Error("缺少音频输入");
      if (!model) throw new Error("未选择模型");
      const cues = await asr.generate(
        input.path,
        model.kind === "cloud" ? `cloud:${model.id}` : model.id,
      );
      const text = cues.map((cue) => cue.text).join("\n");
      return { text };
    }

    case "model.text": {
      const system = textParam(node, "system").trim();
      // 文本提示词是主输入；图片 / 视频可选（多模态模型直接用 content parts）。
      const content = (upstreamText(node.id, "text") ?? "").trim();
      const image = upstreamAsset(node.id, "image");
      const video = upstreamAsset(node.id, "video");
      if (!content && !image && !video) {
        throw new Error("缺少输入：把文本、图片或视频接到对应端口再运行");
      }
      const temperature = numberParam(node, "temperature", 0.7);
      const maxTokens = Math.max(0, Math.round(numberParam(node, "maxTokens", 0)));
      const topP = Math.min(1, Math.max(0, numberParam(node, "topP", 1)));
      const reasoningEffort = textParam(node, "reasoning") || "off";
      const stream = paramsOf(node).stream !== false;
      // 节点里存的是 `<providerId>::<model>`；留空则用第一家启用的供应商。
      const selected = splitLlmValue(textParam(node, "model").trim());

      const parts: LlmContentPart[] = [];
      if (content) parts.push({ type: "text", text: content });
      if (image) {
        parts.push({ type: "image_url", image_url: { url: await fileDataUrl(image.path) } });
      }
      if (video) {
        parts.push({ type: "video_url", video_url: { url: await fileDataUrl(video.path) } });
      }
      const userContent: string | LlmContentPart[] =
        parts.length === 1 && parts[0].type === "text" ? content : parts;
      const messages: LlmChatMessage[] = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: userContent },
      ];

      const reply = stream
        ? await llmChatStream({
            requestId: crypto.randomUUID(),
            provider: selected?.provider ?? "",
            model: selected?.model ?? "",
            messages,
            temperature,
            maxTokens: maxTokens || undefined,
            topP,
            reasoningEffort,
            onDelta: (delta) => {
              const live = liveRun(nodeId);
              if (live) live.text += delta;
            },
            onReasoning: (delta) => {
              const live = liveRun(nodeId);
              if (live) live.reasoning += delta;
            },
          })
        : await llmChat(
            selected?.provider ?? "",
            selected?.model ?? "",
            messages,
            temperature,
            maxTokens || undefined,
            topP,
            reasoningEffort,
          );
      if (!reply.text.trim() && !reply.reasoning.trim()) {
        throw new Error("文本模型没有返回内容");
      }
      return { text: reply.text, reasoning: reply.reasoning };
    }

    case "model.enhance": {
      const input = upstreamAsset(node.id, "video");
      if (!input) throw new Error("缺少视频输入");
      const project = useProjectStore();
      const fps = project.doc.fps || 30;
      const op = paramsOf(node).op === "interpolate" ? "interpolate" : "upscale";
      // 超分与插帧各有一套模型，按当前处理方式取对应的那一个。
      const modelId =
        typeof paramsOf(node)[op === "interpolate" ? "interpModel" : "upscaleModel"] === "string"
          ? String(paramsOf(node)[op === "interpolate" ? "interpModel" : "upscaleModel"])
          : "";
      const picked = modelId.split(":");
      const opModel =
        picked.length >= 2 && picked[0] === "local" ? { kind: "local" as const, id: picked.slice(1).join(":") } : null;
      if (!opModel) throw new Error(op === "interpolate" ? "未选择插帧模型" : "未选择超分模型");
      const result =
        op === "interpolate"
          ? await videoAi.interpolate(
              input.path,
              0,
              input.duration,
              fps,
              opModel.id,
              numberParam(node, "factor", 2),
            )
          : await videoAi.upscale(
              input.path,
              0,
              input.duration,
              fps,
              opModel.id,
              numberParam(node, "scale", 2),
            );
      if (!result?.path) throw new Error("画面增强失败");
      return { paths: [result.path], kind: "video" };
    }

    case "model.separate": {
      const input = upstreamAsset(node.id, "audio");
      if (!input) throw new Error("缺少音频输入");
      if (!model) throw new Error("未选择模型");
      const stems = await audioAi.separate(input.path, 0, input.duration, model.id);
      if (stems.length === 0) throw new Error("音频分离没有产出");
      // 每条分轨按名字发到对应端口（vocal / drums / bass / other / guitar / piano）；
      // 端口还没展开（模型家族未知）时退化成按顺序发给现有端口。
      const outputs = portsOf(node, portContext()).outputs;
      const used = new Set<string>();
      const pathByPort: Record<string, string> = {};
      for (const stem of stems) {
        const preferred = stemPortId(stem.name);
        const port =
          outputs.find((item) => item.id === preferred && !used.has(item.id)) ??
          outputs.find((item) => !used.has(item.id));
        if (!port) continue;
        used.add(port.id);
        pathByPort[port.id] = stem.path;
      }
      if (Object.keys(pathByPort).length === 0) throw new Error("音频分离没有产出");
      return { pathByPort };
    }

    case "model.demux": {
      const input = upstreamAsset(node.id, "video");
      if (!input) throw new Error("缺少视频输入");
      // 视频去掉音轨（画面直拷，不重新编码），音频抽成独立音轨。
      const video = await extractVideoTrack(input.path, input.assetId);
      const audio = await extractAudioPreview(input.path, input.assetId);
      if (!video || !audio) throw new Error("这个视频没有可分离的音轨");
      return {
        pathByPort: { video, audio },
      };
    }

    default:
      throw new Error(`节点 ${node.type} 不支持运行`);
  }
}

/** 产物入库：生成文件 → 素材 → 返回全部素材 id（保持产物顺序）。 */
async function registerPaths(paths: string[]): Promise<string[]> {
  const project = useProjectStore();
  const ids: string[] = [];
  for (const path of paths) {
    const asset = await importAssetAt(path);
    project.dispatch((doc) => addAsset(doc, asset));
    ids.push(asset.id);
  }
  return ids;
}

interface RegisteredOutputs {
  /** 端口 id → 素材 id。 */
  byPort: Record<string, string>;
  /** 本次的主产物（第一次生成的 / 透传的素材）。 */
  primary?: string;
  /** 本次生成的全部产物（一张端口多张图时都在这里）。 */
  imported: string[];
}

/**
 * 把适配器的产物整理成 `端口 id → 素材 id`。
 *
 * 同一个路径只入库一次：一次出多张（`paths`）、多端口（`pathByPort`）、
 * 以及透传已有素材（`assetByPort`）可以混在一起。
 */
async function registerOutputs(result: AdapterResult): Promise<RegisteredOutputs> {
  const byPort: Record<string, string> = { ...(result.assetByPort ?? {}) };
  const paths = [
    ...new Set([...(result.paths ?? []), ...Object.values(result.pathByPort ?? {})]),
  ];
  const imported = paths.length > 0 ? await registerPaths(paths) : [];
  const byPath = new Map(paths.map((path, index) => [path, imported[index]!]));
  for (const [portId, path] of Object.entries(result.pathByPort ?? {})) {
    const id = byPath.get(path);
    if (id) byPort[portId] = id;
  }
  // 透传整摞（`assets`）时没有 `assetId` 也能发布：第一张就是当前发布那张。
  const primary =
    result.assetId ??
    result.assets?.[0] ??
    (result.paths?.[0] ? byPath.get(result.paths[0]) : undefined);
  return { byPort, primary, imported };
}

/** 禁用的祖先：整条下游这次都不跑（和「旁路」不同，旁路只摘掉自己）。 */
function blockedByDisabled(nodeId: string): boolean {
  const board = useBoardStore();
  const seen = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of board.edges) {
        if (edge.target !== id || seen.has(edge.source)) continue;
        seen.add(edge.source);
        const source = board.nodes.find((node) => node.id === edge.source);
        if (source?.data.ignored) return true;
        next.push(edge.source);
      }
    }
    frontier = next;
  }
  return false;
}

/** 组节点只是框，不参与运行。 */
function isRunnableNode(node: BoardNode): boolean {
  if (node.type === "group") return false;
  if (node.data.ignored || node.data.bypassed) return false;
  return !blockedByDisabled(node.id);
}

/** 输出附件卡最多保留多少个产物（重复运行累积时防止无限膨胀）。 */
const MAX_OUTPUTS = 12;

async function runOne(nodeId: string): Promise<boolean> {
  const board = useBoardStore();
  const node = board.nodes.find((item) => item.id === nodeId);
  if (!node) return false;
  // 旁路 / 禁用：这次跳过（旁路的下游会绕开它，禁用会连下游一起不跑）。
  if (node.data.bypassed || node.data.ignored) {
    board.setNodeRuntime(nodeId, { status: "skipped" });
    return true;
  }
  if (blockedByDisabled(nodeId)) {
    board.setNodeRuntime(nodeId, { status: "skipped" });
    return true;
  }

  const startedAt = Date.now();
  const signal = signals.begin(nodeId);
  beginLiveRun(nodeId);
  ensureProgressWatches(node);
  // 进度事件是异步推送的：轮询 store 里的 progressPct，节流写进内存 live 状态。
  const progressTimer = setInterval(() => {
    const live = liveRun(nodeId);
    if (!live) return;
    const pct = liveProgressPct(node);
    if (pct !== null && pct !== undefined) live.progress = Math.min(1, Math.max(0, pct / 100));
    live.message = liveProgressMessage(node);
  }, 180);
  board.setNodeRuntime(nodeId, {
    status: "running",
    progress: undefined,
    error: undefined,
    startedAt,
    durationMs: undefined,
  });
  try {
    const result = await runAdapter(node, nodeId, signal);
    const { byPort, primary, imported } = await registerOutputs(result);
    const outputs = byPort;
    const outputPorts = portsOf(node, portContext()).outputs;
    const firstPort = outputPorts[0]?.id ?? "out";
    // 单端口节点：一次出多张时全部进附件卡，第一张作为「当前发布」那一张。
    if (!outputs[firstPort]) {
      const fallback = primary ?? imported[0];
      if (fallback) outputs[firstPort] = fallback;
    }
    // 重复 N 次是「再抽一次」：把历次结果攒在同一张输出卡里，方便来回切换对比。
    // 普通运行只发布这一次的产物；多端口节点按端口顺序排列。
    const previous =
      mode.value === "repeat"
        ? board.nodes.find((item) => item.id === nodeId)?.data.outputAssetIds ?? []
        : [];
    const current =
      // 透传节点（图片显示）把上游整摞一起发布，卡片才能按牌堆叠放。
      result.assets && result.assets.length > 0
        ? result.assets
        : outputPorts.length > 1
          ? outputPorts.map((port) => outputs[port.id]).filter((id): id is string => Boolean(id))
          : imported.length > 0
            ? imported
            : primary
              ? [primary]
              : [];
    const all = [...new Set([...previous, ...current])].slice(-MAX_OUTPUTS);
    const outputAssetId = outputs[firstPort] ?? imported[0] ?? previous[0];
    const kept = Object.fromEntries(
      Object.entries(outputs).filter(([, id]) => Boolean(id)),
    ) as Record<string, string>;
    board.setNodeRuntime(nodeId, {
      status: "done",
      progress: undefined,
      error: undefined,
      durationMs: Date.now() - startedAt,
      outputs: Object.keys(kept).length > 0 ? kept : undefined,
      ...(all.length > 0 && outputAssetId
        ? { outputAssetIds: all, outputAssetId }
        : {}),
      ...(result.text !== undefined
        ? { outputText: result.text, outputReasoning: result.reasoning ?? "" }
        : {}),
    });
    return true;
  } catch (error) {
    const live = liveRun(nodeId);
    board.setNodeRuntime(nodeId, {
      status: "error",
      progress: undefined,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      // 流到一半失败也把已经拿到的内容留下，至少能看到部分回答。
      ...(live?.text ? { outputText: live.text } : {}),
      ...(live?.reasoning ? { outputReasoning: live.reasoning } : {}),
    });
    return false;
  } finally {
    clearInterval(progressTimer);
    endLiveRun(nodeId);
    signals.end(nodeId);
  }
}

/** 直接下游 + 它们的下游（BFS，不含自己）。 */
function descendantsOf(nodeId: string): string[] {
  const board = useBoardStore();
  const seen = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of board.edges) {
        if (edge.source !== id || seen.has(edge.target)) continue;
        seen.add(edge.target);
        next.push(edge.target);
      }
    }
    frontier = next;
  }
  return [...seen];
}

function refreshRunning(): void {
  running.value = queue.value.length > 0 || Object.keys(active).length > 0;
}

/** 一个节点跑完：更新依赖状态、处理「自动重跑 / 重复 N 次」，再继续调度。 */
function settle(nodeId: string, ok: boolean): void {
  delete active[nodeId];
  doneNodes.add(nodeId);
  const board = useBoardStore();
  if (ok && !cancelled && mode.value === "always") {
    for (const id of descendantsOf(nodeId)) {
      const node = board.nodes.find((item) => item.id === id);
      if (node && isRunnableNode(node)) enqueue(id);
    }
  }
  const generated = board.nodes.find((node) => node.id === nodeId)?.type.startsWith("model.");
  if (ok && generated && mode.value === "repeat" && !cancelled) {
    const runs = (repeatRuns[nodeId] ?? 0) + 1;
    if (runs < repeatCount.value) {
      repeatRuns[nodeId] = runs;
      enqueue(nodeId);
    } else {
      delete repeatRuns[nodeId];
    }
  }
  if (queue.value.length === 0 && Object.keys(active).length === 0) {
    for (const id of Object.keys(repeatRuns)) delete repeatRuns[id];
    plan.value = null;
  }
  refreshRunning();
  pump();
}

/** 启动一个节点（资源占用先记上，调度器才能把后面的节点排进同一拍）。 */
function startNode(nodeId: string): void {
  const board = useBoardStore();
  const node = board.nodes.find((item) => item.id === nodeId);
  if (!node) {
    settle(nodeId, false);
    return;
  }
  active[nodeId] = nodeCost(node) ?? { lane: "instant", vramMb: 0, ramMb: 0 };
  void runOne(nodeId)
    .then((ok) => settle(nodeId, ok))
    .catch(() => settle(nodeId, false));
}

/**
 * 调度一拍：按依赖 + 泳道容量 + 显存预算选出能开始的节点。
 *
 * 纯函数 `planStarts` 负责决策；这里只负责把任务真正发出去。同一拍可以启动多个
 * 节点（例如 4 条纯 API 分支），本地 GPU 受泳道容量限制一次只放一个。
 */
function pump(): void {
  if (cancelled) {
    refreshRunning();
    return;
  }
  const board = useBoardStore();
  const starts = planStarts({
    pending: queue.value,
    active: Object.entries(active).map(([id, cost]) => ({ id, cost })),
    done: doneNodes,
    nodes: board.nodes,
    edges: board.edges,
    limits: limits.value,
    smartOrder: smartOrder.value,
    smartMemory: smartMemory.value,
  });
  if (starts.length === 0) {
    // 成环 / 上游被跳过：没有任何任务在跑时也要推进一个，避免整个画布卡死。
    if (Object.keys(active).length === 0 && queue.value.length > 0) {
      const [first, ...rest] = queue.value;
      queue.value = rest;
      startNode(first!);
    } else {
      refreshRunning();
    }
    return;
  }
  const picked = new Set(starts);
  queue.value = queue.value.filter((id) => !picked.has(id));
  for (const id of starts) startNode(id);
  refreshRunning();
}

function enqueue(nodeId: string): void {
  const board = useBoardStore();
  const node = board.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === "group") return;
  // 禁用的节点 / 被禁用上游挡住的节点：标成「已跳过」，不进队列。
  if (node.data.ignored || blockedByDisabled(nodeId)) {
    board.setNodeRuntime(nodeId, { status: "skipped" });
    return;
  }
  if (queue.value.includes(nodeId) || active[nodeId]) return;
  // 重复运行 / 自动重跑：同一个节点再次入队时，不能还被「这次已经跑过」挡住。
  doneNodes.delete(nodeId);
  queue.value = [...queue.value, nodeId];
  pump();
}

/** 这次能跑的节点（排除组、禁用、旁路、以及被禁用上游挡住的）。 */
const runnable = computed(() => useBoardStore().nodes.filter(isRunnableNode));

function enqueueBatch(ids: string[]): void {
  const board = useBoardStore();
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  for (const id of ids) {
    const node = nodes.get(id);
    if (!node || node.type === "group") continue;
    if (node.data.ignored || blockedByDisabled(id)) {
      board.setNodeRuntime(id, { status: "skipped" });
      continue;
    }
    if (!queue.value.includes(id) && !active[id]) queue.value = [...queue.value, id];
  }
  plan.value = summarizeRun(
    board.nodes.filter((node) => queue.value.includes(node.id) || active[node.id]),
    board.edges,
    limits.value,
  );
  pump();
}

function clearSkipStatuses(): void {
  const board = useBoardStore();
  for (const node of board.nodes) {
    if (node.data.status === "skipped") board.setNodeRuntime(node.id, { status: "idle" });
  }
}

export function useBoardRun() {
  const board = useBoardStore();

  function runNode(nodeId: string): void {
    enqueue(nodeId);
  }

  /** 重建节点：回到默认初始状态（不运行）；真正重跑用「运行此节点」。 */
  function rebuild(nodeId: string): void {
    board.resetNode(nodeId);
  }

  /**
   * 运行选中节点（选中组 = 运行整组）。
   *
   * 只把选中的节点排进队列；没选中的上游视为「已经发布过」，不强制重跑。
   * 依赖顺序仍然由调度器保证。
   */
  function runSelection(): void {
    if (board.selection.length === 0) {
      runAll();
      return;
    }
    const selected = new Set(board.expandGroups(board.selection));
    const nodes = topologicalOrder(board.nodes, board.edges).filter((node) =>
      selected.has(node.id),
    );
    cancelled = false;
    doneNodes = new Set();
    queue.value = [];
    for (const id of Object.keys(repeatRuns)) delete repeatRuns[id];
    clearSkipStatuses();
    enqueueBatch(nodes.filter(isRunnableNode).map((node) => node.id));
    for (const node of nodes) {
      if (!isRunnableNode(node)) board.setNodeRuntime(node.id, { status: "skipped" });
    }
  }

  /**
   * 「运行」按钮：整个工作流按依赖排序后交给调度器。
   *
   * 独立分支会并行跑：纯 API 节点完全并行，本地 GPU 节点按显存预算排队。
   */
  function runAll(): void {
    const order = topologicalOrder(board.nodes, board.edges);
    cancelled = false;
    doneNodes = new Set();
    queue.value = [];
    for (const id of Object.keys(repeatRuns)) delete repeatRuns[id];
    clearSkipStatuses();
    enqueueBatch(order.filter(isRunnableNode).map((node) => node.id));
    for (const node of order) {
      if (node.type === "group") continue;
      if (!isRunnableNode(node)) board.setNodeRuntime(node.id, { status: "skipped" });
    }
  }

  function stop(): void {
    cancelled = true;
    signals.abortAll();
    queue.value = [];
    plan.value = null;
    for (const id of Object.keys(repeatRuns)) delete repeatRuns[id];
    running.value = false;
  }

  function reset(): void {
    cancelled = false;
  }

  return {
    queue,
    running,
    active,
    plan,
    limits,
    smartOrder,
    smartMemory,
    mode,
    repeatCount,
    executable: runnable,
    liveRuns,
    rebuild: (nodeId: string) => {
      cancelled = false;
      rebuild(nodeId);
    },
    runNode: (nodeId: string) => {
      cancelled = false;
      runNode(nodeId);
    },
    runSelection: () => {
      cancelled = false;
      runSelection();
    },
    runAll: () => {
      cancelled = false;
      runAll();
    },
    stop,
    reset,
  };
}
