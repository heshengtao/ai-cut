/**
 * 画布节点执行：串行队列 + 运行模式 + 产物自动入素材库。
 *
 * 复用现有的每一套 AI 能力（图像 / 视频 / TTS / ASR / 增强 / 分离 / 文本），
 * 节点只是把"参数 + 上游产物"翻译成对应 store 的调用。
 *
 * 本地 GPU 一次只能跑一个任务，所以队列是全局串行的；云端也排在同一条队里，
 * 取消语义因此只需要一个开关。
 */
import { computed, ref } from "vue";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { useImageGenStore } from "@/stores/imageGen";
import { useVideoGenStore } from "@/stores/videoGen";
import { useTtsStore } from "@/stores/tts";
import { useAsrStore } from "@/stores/asr";
import { useVideoAiStore } from "@/stores/videoAi";
import { useAudioAiStore } from "@/stores/audioAi";
import { useCloudGenStore } from "@/stores/cloudGen";
import { addAsset } from "@/core/ops";
import { importAssetAt } from "@/core/media";
import { agentConfig } from "@/core/agentApi";
import type { BoardNode, BoardRunMode } from "@/types/board";
import type { AssetKind } from "@/types/project";

export type { BoardRunMode } from "@/types/board";

interface AdapterResult {
  /** 产物路径（会自动入库）。 */
  paths?: string[];
  /** 文本产物（不入库）。 */
  text?: string;
  /** 产物素材类型。 */
  kind?: AssetKind;
}

const queue = ref<string[]>([]);
const running = ref(false);
const mode = ref<BoardRunMode>("manual");
const repeatCount = ref(1);
let cancelled = false;
let repeatDone = 0;

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

/** 从上游连线取一个输入：返回素材路径或文本。 */
function upstreamText(nodeId: string, portId: string): string | null {
  const board = useBoardStore();
  const edge = board.edges.find((item) => item.target === nodeId && item.targetPort === portId);
  if (!edge) return null;
  const source = board.nodes.find((item) => item.id === edge.source);
  if (!source) return null;
  if (source.data.outputText) return source.data.outputText;
  const text = paramsOf(source).text;
  return typeof text === "string" ? text : null;
}

/** 从上游连线取一个素材路径。 */
function upstreamAsset(nodeId: string, portId: string): { path: string; duration: number } | null {
  const board = useBoardStore();
  const project = useProjectStore();
  const edge = board.edges.find((item) => item.target === nodeId && item.targetPort === portId);
  if (!edge) return null;
  const source = board.nodes.find((item) => item.id === edge.source);
  if (!source) return null;
  const assetId = source.data.outputAssetId ?? source.data.assetId;
  if (!assetId) return null;
  const asset = project.doc.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  return { path: asset.src, duration: asset.duration };
}

/** 收集形如 `refImage3` 的多路输入，按序号排序（对应提示词里的 `<Picture N>`）。 */
function collectRefs(nodeId: string, kind: "image" | "audio" | "video"): string[] {
  const board = useBoardStore();
  const project = useProjectStore();
  const prefix = `ref${kind[0].toUpperCase()}${kind.slice(1)}`;
  const edges = board.edges
    .filter((edge) => edge.target === nodeId && edge.targetPort.startsWith(prefix))
    .sort((a, b) => {
      const na = Number(a.targetPort.slice(prefix.length)) || 0;
      const nb = Number(b.targetPort.slice(prefix.length)) || 0;
      return na - nb;
    });
  const paths: string[] = [];
  for (const edge of edges) {
    const source = board.nodes.find((item) => item.id === edge.source);
    const assetId = source?.data.outputAssetId ?? source?.data.assetId;
    const asset = assetId ? project.doc.assets.find((item) => item.id === assetId) : null;
    if (asset) paths.push(asset.src);
  }
  return paths;
}

/** `local:<id>` / `cloud:<id>`。 */
function splitModel(value: unknown): { kind: "local" | "cloud"; id: string } | null {
  if (typeof value !== "string" || !value.includes(":")) return null;
  const [kind, ...rest] = value.split(":");
  if ((kind !== "local" && kind !== "cloud") || rest.length === 0) return null;
  return { kind, id: rest.join(":") };
}

/** 单个节点的适配器：把画布参数翻译成现有 API 的调用。 */
async function runAdapter(node: BoardNode): Promise<AdapterResult> {
  const imageGen = useImageGenStore();
  const videoGen = useVideoGenStore();
  const tts = useTtsStore();
  const asr = useAsrStore();
  const videoAi = useVideoAiStore();
  const audioAi = useAudioAiStore();
  const cloudGen = useCloudGenStore();
  const model = splitModel(paramsOf(node).model);

  switch (node.type) {
    case "model.image": {
      const prompt = textParam(node, "prompt");
      if (!prompt.trim()) throw new Error("提示词为空");
      const width = numberParam(node, "width", 1024);
      const height = numberParam(node, "height", 1024);
      const ref = upstreamAsset(node.id, "ref");
      if (model?.kind === "cloud") {
        const result = await cloudGen.startImage({
          providerId: model.id,
          mode: ref ? "edit" : "draw",
          prompt,
          negativePrompt: textParam(node, "negative") || undefined,
          width,
          height,
          initImage: ref?.path,
          seed: numberParam(node, "seed", -1),
        });
        if (!result) throw new Error(cloudGen.error ?? "云端图像生成失败");
        return { paths: [result.path], kind: "image" };
      }
      if (!model) throw new Error("未选择模型");
      const result = await imageGen.start({
        modelId: model.id,
        prompt,
        negativePrompt: textParam(node, "negative") || undefined,
        width,
        height,
        steps: numberParam(node, "steps", 20),
        seed: numberParam(node, "seed", -1),
        cfgScale: 7,
        initImage: ref?.path,
      });
      if (!result) throw new Error(imageGen.error ?? "图像生成失败");
      return { paths: [result.path], kind: "image" };
    }

    case "model.video": {
      const prompt = textParam(node, "prompt");
      const width = numberParam(node, "width", 832);
      const height = numberParam(node, "height", 480);
      const seconds = numberParam(node, "seconds", 5);
      const init = upstreamAsset(node.id, "init");
      const end = upstreamAsset(node.id, "end");
      const refImages = collectRefs(node.id, "image");
      const refAudios = collectRefs(node.id, "audio");
      const refVideos = collectRefs(node.id, "video");
      if (model?.kind === "cloud") {
        const result = await cloudGen.startVideo({
          providerId: model.id,
          prompt,
          width,
          height,
          seconds,
          initImage: init?.path,
          refImages,
          refAudios,
          refVideos,
        });
        if (!result) throw new Error(cloudGen.error ?? "云端视频生成失败");
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
      const audios =
        model.kind === "cloud"
          ? await tts.synthesizeCloud(model.id, items, null)
          : await tts.synthesize(model.id, items, null, null, null);
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
      const prompt = textParam(node, "prompt");
      const upstream = upstreamText(node.id, "text") ?? "";
      if (paramsOf(node).mode === "template") {
        return { text: `${prompt}${prompt && upstream ? "\n\n" : ""}${upstream}` };
      }
      const config = await agentConfig();
      if (!config.base_url || !config.api_key) throw new Error("未配置文本模型（设置 → 集成）");
      const response = await fetch(`${config.base_url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.api_key}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            ...(prompt ? [{ role: "system", content: prompt }] : []),
            { role: "user", content: upstream || prompt },
          ],
        }),
      });
      if (!response.ok) throw new Error(`文本模型请求失败：HTTP ${response.status}`);
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("文本模型没有返回内容");
      return { text };
    }

    case "model.enhance": {
      const input = upstreamAsset(node.id, "video");
      if (!input) throw new Error("缺少视频输入");
      if (!model) throw new Error("未选择模型");
      const project = useProjectStore();
      const fps = project.doc.fps || 30;
      const op = paramsOf(node).op === "interpolate" ? "interpolate" : "upscale";
      const result =
        op === "interpolate"
          ? await videoAi.interpolate(
              input.path,
              0,
              input.duration,
              fps,
              model.id,
              numberParam(node, "factor", 2),
            )
          : await videoAi.upscale(
              input.path,
              0,
              input.duration,
              fps,
              model.id,
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
      const paths = stems.map((stem) => stem.path).filter(Boolean);
      if (paths.length === 0) throw new Error("音频分离没有产出");
      return { paths, kind: "audio" };
    }

    default:
      throw new Error(`节点 ${node.type} 不支持运行`);
  }
}

/** 产物入库：生成文件 → 素材 → 记到节点输出。 */
async function registerOutputs(result: AdapterResult): Promise<string | undefined> {
  const project = useProjectStore();
  const ids: string[] = [];
  for (const path of result.paths ?? []) {
    const asset = await importAssetAt(path);
    project.dispatch((doc) => addAsset(doc, asset));
    ids.push(asset.id);
  }
  return ids[0];
}

async function runOne(nodeId: string): Promise<boolean> {
  const board = useBoardStore();
  const node = board.nodes.find((item) => item.id === nodeId);
  if (!node) return false;
  if (node.data.ignored) {
    board.setNodeRuntime(nodeId, { status: "idle" });
    return true;
  }

  board.setNodeRuntime(nodeId, { status: "running", progress: undefined, error: undefined });
  try {
    const result = await runAdapter(node);
    const outputAssetId = await registerOutputs(result);
    board.setNodeRuntime(nodeId, {
      status: "done",
      progress: undefined,
      error: undefined,
      ...(outputAssetId ? { outputAssetId } : {}),
      ...(result.text ? { outputText: result.text } : {}),
    });
    return true;
  } catch (error) {
    board.setNodeRuntime(nodeId, {
      status: "error",
      progress: undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function drain(): Promise<void> {
  if (running.value) return;
  running.value = true;
  try {
    while (queue.value.length > 0 && !cancelled) {
      const [next, ...rest] = queue.value;
      queue.value = rest;
      const ok = await runOne(next);
      if (ok && mode.value === "always" && !cancelled) {
        queue.value = [...queue.value, next];
      }
      if (ok && mode.value === "repeat" && !cancelled) {
        repeatDone += 1;
        if (repeatDone < repeatCount.value) queue.value = [...queue.value, next];
        else repeatDone = 0;
      }
    }
  } finally {
    running.value = false;
    if (queue.value.length === 0) repeatDone = 0;
  }
}

function enqueue(nodeId: string): void {
  if (mode.value === "none") {
    const board = useBoardStore();
    board.setNodeRuntime(nodeId, { status: "stale" });
    return;
  }
  if (queue.value.includes(nodeId)) return;
  queue.value = [...queue.value, nodeId];
  void drain();
}

/** 可运行时：模型节点 + 未被禁用。 */
const runnable = computed(() => useBoardStore().nodes.filter((node) => node.type.startsWith("model.")));

export function useBoardRun() {
  const board = useBoardStore();

  function runNode(nodeId: string): void {
    enqueue(nodeId);
  }

  function runSelection(): void {
    if (board.selection.length > 0) {
      for (const id of board.selection) enqueue(id);
      return;
    }
    runAll();
  }

  function runAll(): void {
    for (const node of runnable.value) {
      if (!node.data.ignored) enqueue(node.id);
    }
  }

  function stop(): void {
    cancelled = true;
    queue.value = [];
    running.value = false;
  }

  function reset(): void {
    cancelled = false;
  }

  return {
    queue,
    running,
    mode,
    repeatCount,
    executable: runnable,
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
