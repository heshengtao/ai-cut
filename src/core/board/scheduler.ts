/**
 * 画布运行的调度器（纯函数）。
 *
 * 目标：一条工作流不该被无关分支拖慢，纯 API 的工作流可以完全并行；本地模型
 * 受显存 / 内存约束，按预算排队。
 *
 * 三条泳道：
 * - `instant`：输入 / 显示节点，只是把已有素材发布出去，立刻执行；
 * - `api`：云端生成、文本 LLM、云端 TTS / ASR —— 不占本机显存，可完全并行
 *   （默认上限 4，避免被服务商限流）；
 * - `gpu`：本地 sd.cpp / ONNX 模型。daemon 的本地引擎是单进程的，所以默认
 *   一次只跑一个；`vramMb` / `ramMb` 仍然参与预算（把上限调大时可以在预算内
 *   并行，超出就排队）；
 * - `cpu`：ffmpeg 这类本地 CPU 任务（视频音频分离），与 GPU 任务互不抢占，
 *   可以并行（默认 2）。
 *
 * 「智能排序」按「解锁多少下游」优先：先跑卡在关键路径上的节点，分支多时
 * 整体完成更早；关掉就按画布顺序。
 */
import { nodeDefinition, splitModelValue } from "./registry";
import type { BoardNode } from "@/types/board";

export type RunLane = "instant" | "api" | "gpu" | "cpu";

export interface NodeCost {
  lane: RunLane;
  /** 估算的显存占用（MB）；API / CPU 为 0。 */
  vramMb: number;
  /** 估算的内存占用（MB）。 */
  ramMb: number;
}

/** 调度预算。`gpu` 是同时运行的本地任务数（默认 1，引擎单进程）。 */
export interface RunLimits {
  api: number;
  gpu: number;
  cpu: number;
  vramMb: number;
  ramMb: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  api: 4,
  gpu: 1,
  cpu: 2,
  vramMb: 16 * 1024,
  ramMb: 32 * 1024,
};

/** 本地模型家族的粗略显存峰值（MB）。没登记的按节点类型兜底。 */
const MODEL_VRAM: Record<string, number> = {
  sd15: 5 * 1024,
  sdxl: 9 * 1024,
  z_image_turbo: 7 * 1024,
  flux1_schnell: 12 * 1024,
  flux1_kontext: 12 * 1024,
  qwen_image: 16 * 1024,
  qwen_image_edit: 16 * 1024,
  minimax_h3: 18 * 1024,
  minimax_h3_ref2va: 24 * 1024,
  wan21_t2v: 16 * 1024,
  wan22_ti2v: 16 * 1024,
  wan22_t2v_a14b: 24 * 1024,
  hunyuan_video_15: 20 * 1024,
  ltx_23: 12 * 1024,
  ltx_25: 12 * 1024,
  htdemucs: 6 * 1024,
  htdemucs6s: 4 * 1024,
  uvr: 4 * 1024,
  rife: 4 * 1024,
  real_esrgan_general: 6 * 1024,
  real_esrgan_x4plus: 6 * 1024,
  moss_tts_nano: 4 * 1024,
  whisper: 3 * 1024,
  paraformer: 3 * 1024,
};

function vramForLocal(type: string, modelId: string | null): number {
  if (modelId && MODEL_VRAM[modelId]) return MODEL_VRAM[modelId]!;
  switch (type) {
    case "model.image":
      return 9 * 1024;
    case "model.video":
      return 16 * 1024;
    case "model.enhance":
      return 6 * 1024;
    case "model.separate":
      return 5 * 1024;
    case "model.tts":
      return 4 * 1024;
    case "model.asr":
      return 3 * 1024;
    default:
      return 4 * 1024;
  }
}

/** 节点运行时的泳道与资源估算；组 / 未知节点返回 null（不参与运行）。 */
export function nodeCost(node: BoardNode): NodeCost | null {
  const type = node.type;
  if (type === "group") return null;
  // 插件节点（ext.*）只认自己声明的泳道；没声明就不跑，绝不默认进 gpu 泳道。
  if (type.startsWith("ext.")) {
    const declared = nodeDefinition(type)?.cost;
    if (!declared) return null;
    return {
      lane: declared.lane,
      vramMb: declared.vramMb ?? 0,
      ramMb: declared.ramMb ?? 64,
    };
  }
  if (type.startsWith("input.") || type.startsWith("display.")) {
    return { lane: "instant", vramMb: 0, ramMb: 16 };
  }
  if (type === "model.demux") {
    return { lane: "cpu", vramMb: 0, ramMb: 512 };
  }
  if (type === "model.text") {
    return { lane: "api", vramMb: 0, ramMb: 64 };
  }
  const model = splitModelValue(node.data.params.model);
  if (model?.kind === "cloud") {
    return { lane: "api", vramMb: 0, ramMb: 64 };
  }
  const localId = model?.kind === "local" ? model.id : null;
  return {
    lane: "gpu",
    vramMb: vramForLocal(type, localId),
    ramMb: vramForLocal(type, localId) / 2,
  };
}

/** 一次运行里已排定的节点。 */
export interface ScheduledNode {
  id: string;
  cost: NodeCost;
}

export interface PlanArgs {
  /** 还没开始的节点（按画布顺序）。 */
  pending: readonly string[];
  /** 正在运行的节点与资源占用。 */
  active: readonly ScheduledNode[];
  /** 这次运行里已经跑完的节点。 */
  done: ReadonlySet<string>;
  nodes: readonly BoardNode[];
  edges: readonly { source: string; target: string }[];
  limits: RunLimits;
  /** 智能排序：按解锁的下游数量优先。 */
  smartOrder?: boolean;
  /** 智能显存分配：同时运行的本地任务按显存 / 内存预算放行。 */
  smartMemory?: boolean;
}

/**
 * 依赖展开：旁路节点自己不运行，但下游仍然依赖它上游的产物。
 *
 * 不展开的话，`a → b(旁路) → c` 在 runAll 里会让 c 和 a 同一拍启动，c 拿到
 * 的是 a 上一次的旧输出。展开后 c 会等 a 跑完。
 */
function expandedSources(
  nodeId: string,
  edges: readonly { source: string; target: string }[],
  byId: ReadonlyMap<string, BoardNode>,
): string[] {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const edge of edges) {
      if (edge.target !== id || out.has(edge.source)) continue;
      out.add(edge.source);
      const source = byId.get(edge.source);
      if (source?.data.bypassed) walk(edge.source);
    }
  };
  walk(nodeId);
  return [...out];
}

/** 某个待跑节点要解锁多少下游（只数这次还在排队的）。 */
function unlockScore(
  id: string,
  pending: ReadonlySet<string>,
  edges: readonly { source: string; target: string }[],
): number {
  let score = 0;
  const seen = new Set<string>();
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const edge of edges) {
        if (edge.source !== source || seen.has(edge.target)) continue;
        seen.add(edge.target);
        if (pending.has(edge.target)) score += 1;
        next.push(edge.target);
      }
    }
    frontier = next;
  }
  return score;
}

const LANE_ORDER: Record<RunLane, number> = { instant: 0, api: 1, cpu: 2, gpu: 3 };

/**
 * 算出这一拍可以启动的节点。
 *
 * 已经启动的节点不会再返回；资源按 `active` 加上本次已选中的节点累加，所以
 * 调用方可以一次拿到一批（例如 4 个 API 节点），不用一个一个问。
 */
export function planStarts(args: PlanArgs): string[] {
  const { pending, active, done, nodes, edges, limits } = args;
  const smartOrder = args.smartOrder ?? true;
  const smartMemory = args.smartMemory ?? true;
  if (pending.length === 0) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pendingSet = new Set(pending);
  const scheduled = new Set([...pending, ...active.map((item) => item.id)]);
  const runningByLane: Record<RunLane, number> = { instant: 0, api: 0, cpu: 0, gpu: 0 };
  let vram = 0;
  let ram = 0;
  for (const item of active) {
    runningByLane[item.cost.lane] += 1;
    vram += item.cost.vramMb;
    ram += item.cost.ramMb;
  }
  const order = new Map(nodes.map((node, index) => [node.id, index]));

  const ready = pending.filter((id) => {
    const node = byId.get(id);
    if (!node) return true;
    return expandedSources(id, edges, byId).every(
      (source) => !scheduled.has(source) || done.has(source),
    );
  });
  if (ready.length === 0) return [];

  const scored = ready.map((id) => {
    const node = byId.get(id);
    const cost = node ? nodeCost(node) : null;
    return {
      id,
      cost: cost ?? { lane: "instant" as const, vramMb: 0, ramMb: 0 },
      score: smartOrder ? unlockScore(id, pendingSet, edges) : 0,
      index: order.get(id) ?? 0,
    };
  });
  scored.sort((a, b) => {
    if (smartOrder && a.score !== b.score) return b.score - a.score;
    if (a.cost.lane !== b.cost.lane) {
      return LANE_ORDER[a.cost.lane] - LANE_ORDER[b.cost.lane];
    }
    return a.index - b.index;
  });

  const picked: string[] = [];
  for (const item of scored) {
    const lane = item.cost.lane;
    const laneLimit =
      lane === "instant" ? Number.POSITIVE_INFINITY : limits[lane];
    if (lane !== "instant" && runningByLane[lane] >= laneLimit) continue;
    if (smartMemory) {
      if (vram + item.cost.vramMb > limits.vramMb) continue;
      if (ram + item.cost.ramMb > limits.ramMb) continue;
    }
    picked.push(item.id);
    if (lane !== "instant") runningByLane[lane] += 1;
    vram += item.cost.vramMb;
    ram += item.cost.ramMb;
  }
  return picked;
}

/** 这次运行会用到哪些泳道 / 峰值显存估算（运行前的摘要，UI 提示用）。 */
export function summarizeRun(
  nodes: readonly BoardNode[],
  _edges: readonly { source: string; target: string }[],
  _limits: RunLimits = DEFAULT_RUN_LIMITS,
): { lanes: Record<RunLane, number>; vramMb: number; ramMb: number; peakVramMb: number } {
  const lanes: Record<RunLane, number> = { instant: 0, api: 0, cpu: 0, gpu: 0 };
  let vramMb = 0;
  let ramMb = 0;
  let peak = 0;
  // 粗略估计：同一条链上的本地任务不会同时跑，按类型相加即可。
  for (const node of nodes) {
    const cost = nodeCost(node);
    if (!cost) continue;
    lanes[cost.lane] += 1;
    vramMb += cost.vramMb;
    ramMb += cost.ramMb;
    peak = Math.max(peak, cost.vramMb);
  }
  return { lanes, vramMb, ramMb, peakVramMb: peak };
}

/** 泳道的展示文案 key（工具栏 / 运行面板用）。 */
export function laneLabelKey(lane: RunLane): string {
  return `board.lane.${lane}`;
}
