<script setup lang="ts">
/**
 * 画布节点卡片：照 ai-board 的插件节点结构复刻。
 *
 * 结构：卡片上方是浮动 label（图标 + 标题 + 类型 + 状态），卡片本身是
 * **无内边距的内容舞台**——图片 / 视频铺满整张卡，文字直接写在卡上。
 *
 * 图片输入完全对齐 ai-board 的 art-card：卡片外缘就是作品本身，没有标题条、
 * 没有底部文件条；空态是一块内缩的虚线投放区，多图以「牌堆」露在卡片右侧和
 * 下方，右下角是 `1 / 3` 的循环切换胶囊。图片 `object-fit: contain`，加载后
 * 按原始比例把节点高度改到和图片一致（`mediaHeight`），所以卡与图永远同形。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import { useI18n } from "@/i18n";
import { controlFor } from "@/core/plugins/controls";
import {
  boardRegistryRevision,
  imageRefCount,
  isReferenceVideoModel,
  nodeDefinition,
  portsOf,
  splitModelValue,
  stemsForFamily,
  visibleParams,
} from "@/core/board/registry";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { useBoardRun } from "@/composables/useBoardRun";
import { assetThumbnailUrl, ensureThumbnail } from "@/core/thumbnails";
import { fileUrl, importAssetAt, kindFromPath, pickMediaFiles } from "@/core/media";
import { uploadLocalFile } from "@/platform/files";
import { addAsset } from "@/core/ops";
import { toast } from "@/composables/useToast";
import StackBar from "./StackBar.vue";
import {
  appendStackPatch,
  replaceCurrent,
  stackKindOf,
  stackOf,
  stackPatch,
} from "@/core/board/stacks";
import { nodeIcon } from "./nodeIcons";
import { signatureOf } from "@/core/board/workflowNodes";
import { useBoardLabels } from "@/composables/useBoardLabels";
import BoardMediaPicker from "./BoardMediaPicker.vue";
import BoardSizeControl from "./BoardSizeControl.vue";
import BoardVideoPlayer from "./BoardVideoPlayer.vue";
import { getDragPayload } from "@/core/dragPayload";
import {
  ArrowPathIcon,
  ClipboardIcon,
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  EyeIcon,
  EyeSlashIcon,
  FilmIcon,
  LinkIcon,
  MusicalNoteIcon,
  PauseIcon,
  PhotoIcon,
  PlayIcon,
  SpeakerWaveIcon,
  Square3Stack3DIcon,
  StopIcon,
  TrashIcon,
  VideoCameraIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { useLayoutStore, type SettingsSection } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { providersForNodeCapability } from "@/utils/cloudGen";
import {
  boardCloudAsrProviders,
  boardCloudPresets,
  boardCloudProviders,
  boardCloudTtsProviders,
} from "@/composables/useBoardCloudOptions";
import { useBoardPortContext } from "@/composables/useBoardPortContext";
import { modelBackend, modelTarget } from "@/core/board/modelTarget";
import { mediaNodeSize, sameMediaSize } from "@/core/board/mediaFit";
import { LLM_VALUE_SEP, useBoardLlm } from "@/composables/useBoardLlm";
import { renderMarkdown } from "@/utils/markdown";
import { copyText as copyToClipboard } from "@/utils/clipboard";
import type { BoardNode, BoardParamSpec } from "@/types/board";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { CloudAsrProvider, CloudTtsProvider } from "@/types/models";
import type { ModelFeature } from "@/types/models";
import type { AssetKind, MediaAsset } from "@/types/project";

const props = defineProps<{
  /** Vue Flow 会把自己的节点 id 作为 `id` 传进来。 */
  id?: string;
  /** 我们自己的节点数据（`data.nodeId`）。 */
  data?: { nodeId?: string };
  selected?: boolean;
}>();

const i18n = useI18n();
const board = useBoardStore();
const { typeLabel } = useBoardLabels();
const { updateNode, getViewport } = useVueFlow();
const project = useProjectStore();
const run = useBoardRun();
const layout = useLayoutStore();
const models = useModelsStore();

const cardEl = ref<HTMLElement | null>(null);
const resizing = ref(false);
/** 当前图片加载失败（不会再把 img 渲染出来）。 */
const imageFailed = ref(false);
/** 已经按哪一张图 / 哪个宽度适配过，避免 load 与 resize 互相触发。 */
const fittedKey = ref("");
/** 文件拖到卡片上时的高亮（ai-board 的 `data-drop`）。 */
const dropActive = ref(false);
/** 素材库选择对话框。 */
const libraryOpen = ref(false);

const nodeId = computed(() => props.data?.nodeId ?? props.id ?? "");
const node = computed<BoardNode | undefined>(() => board.nodes.find((item) => item.id === nodeId.value));
const definition = computed(() => {
  // 读一次注册表版本：插件注册 / 卸载后要重新取定义（定义表本身不是响应式的）。
  void boardRegistryRevision();
  return node.value ? nodeDefinition(node.value.type) : null;
});
/** 动态端口（H3 参考 / 多图 / 分轨）的上下文。 */
const portContext = useBoardPortContext();
const ports = computed(() => {
  void boardRegistryRevision();
  return node.value ? portsOf(node.value, portContext.value) : { inputs: [], outputs: [] };
});

const title = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (current.data.title) return current.data.title;
  return definition.value ? i18n.t(definition.value.titleKey) : current.type;
});

/** image / video / audio / text / model —— 决定卡片渲染哪种内容舞台。 */
const kind = computed(() => {
  const current = node.value;
  if (!current) return "model";
  if (current.type === "group") return "group";
  if (current.type.startsWith("model.")) return "model";
  return definition.value?.assetKind ?? (current.type.includes("text") ? "text" : "model");
});

function assetById(id: string | undefined): MediaAsset | null {
  if (!id) return null;
  return project.doc.assets.find((item) => item.id === id) ?? null;
}

/** 组节点色调：默认薰衣草色，检查器可切换。 */
const groupTone = computed(() => node.value?.data.tone ?? "lavender");

/** 卡片能接收的素材类型（只有媒体输入节点）。 */
const mediaKind = computed<AssetKind | null>(() =>
  kind.value === "image" || kind.value === "video" || kind.value === "audio"
    ? (kind.value as AssetKind)
    : null,
);

const isDisplay = computed(() => definition.value?.category === "display");

/**
 * 卡片上叠着的那一摞。
 *
 * - 输入节点：用户自己选的多份（`assetIds`，图片 / 视频 / 音频都支持）；
 * - 显示节点：上游发布的整摞（`outputAssetIds`，当前发布那张是
 *   `outputAssetId`，不一定排第一）。
 *
 * 两边的纸叠 / 胶囊是同一套视觉，所以这里合成一个列表，只在取「当前张」时分开。
 */
const stack = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids = isDisplay.value
    ? current.data.outputAssetIds ??
      (current.data.outputAssetId ? [current.data.outputAssetId] : [])
    : current.data.assetIds ??
      (current.data.assetId ? [current.data.assetId] : []);
  return ids.map((id) => assetById(id)).filter((asset): asset is MediaAsset => asset !== null);
});

const nodeWidth = computed(
  () => node.value?.size?.width ?? definition.value?.defaultSize.width ?? 240,
);
const compact = computed(() => nodeWidth.value < 300);

/** 牌堆当前展示的下标：输入节点是用户翻到的那张，显示节点是「当前发布」那张。 */
const stackIndex = computed(() => {
  const total = stack.value.length;
  if (total === 0) return 0;
  if (isDisplay.value) {
    const active = node.value?.data.outputAssetId;
    const index = active ? stack.value.findIndex((asset) => asset.id === active) : -1;
    return index >= 0 ? index : 0;
  }
  return Math.min(Math.max(0, node.value?.data.stackIndex ?? 0), total - 1);
});

/** 显示节点是否已经连上上游：有连线时文案从"去连一个"变成"等运行"。 */
const upstreamConnected = computed(() => {
  const current = node.value;
  if (!current) return false;
  return board.edges.some((edge) => edge.target === current.id);
});

/**
 * 卡片内容。
 *
 * 输入节点显示"我选的素材"；显示节点只显示"我上次运行发布的输出"，
 * 不再实时追上游——否则上游一改就自动推进，正是要避免的 bug。
 */
const primary = computed<MediaAsset | null>(() => {
  const current = node.value;
  if (!current) return null;
  if (isDisplay.value) return assetById(current.data.outputAssetId) ?? stack.value[0] ?? null;
  // 输入媒体一律取牌堆当前项：图片 / 视频 / 音频共用一套翻页。
  if (mediaKind.value) return stack.value[stackIndex.value] ?? null;
  return assetById(current.data.outputAssetId ?? current.data.assetId);
});

const imageUrl = computed(() => (primary.value ? assetThumbnailUrl(primary.value) : null));
const empty = computed(() => primary.value === null);

/** 牌堆里除当前张以外的图（最多 3 张）作为背后的"纸叠"。 */
const deck = computed(() =>
  stack.value.filter((_, index) => index !== stackIndex.value).slice(0, 3),
);

/** 视频纸叠要封面：缺 `thumb` 的视频懒补一张（派生数据，不进撤销栈）。 */
watch(
  () => stack.value.map((asset) => `${asset.id}:${asset.thumb ?? ""}`).join(","),
  () => {
    for (const asset of stack.value.slice(0, 4)) {
      if (asset.kind !== "video" || asset.thumb) continue;
      void ensureThumbnail(asset, (thumb) => project.setAssetThumbnail(asset.id, thumb));
    }
  },
  { immediate: true },
);


const status = computed(() => node.value?.data.status ?? "idle");
/** 运行中的实时状态（文本流 / 进度 / 开始时间），运行结束会落回节点数据。 */
const live = computed(() => run.liveRuns[nodeId.value]);
/** 实时进度 0..1；null = 不确定进度（转圈环）。 */
const progress = computed<number | null>(() => live.value?.progress ?? node.value?.data.progress ?? null);
const error = computed(() => node.value?.data.error ?? null);
const ignored = computed(() => node.value?.data.ignored === true);
const bypassed = computed(() => node.value?.data.bypassed === true);
const groupMembers = computed(() => node.value?.data.children ?? []);

/* ------------------------------------------------------------------ *
 * 运行计时：运行中每 200ms 刷新一次 elapsed，结束后用落盘的 durationMs。
 * ------------------------------------------------------------------ */
const now = ref(Date.now());
let runtimeTick = 0;
function stopRuntimeTick(): void {
  if (runtimeTick) {
    window.clearInterval(runtimeTick);
    runtimeTick = 0;
  }
}
watch(
  status,
  (next) => {
    if (next === "running") {
      now.value = Date.now();
      if (!runtimeTick) runtimeTick = window.setInterval(() => (now.value = Date.now()), 200);
      return;
    }
    stopRuntimeTick();
  },
  { immediate: true },
);
onUnmounted(stopRuntimeTick);

const runtimeMs = computed<number | null>(() => {
  const current = node.value;
  if (!current) return null;
  if (status.value === "running") {
    const startedAt = live.value?.startedAt ?? current.data.startedAt;
    return startedAt ? Math.max(0, now.value - startedAt) : null;
  }
  return current.data.durationMs ?? null;
});

function formatDuration(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

const runtimeLabel = computed(() =>
  runtimeMs.value === null ? "" : formatDuration(runtimeMs.value),
);
/** 运行中把百分比也带上：`42% · 1.2s`。 */
const runtimeText = computed(() => {
  if (status.value === "running") {
    return progress.value === null
      ? runtimeLabel.value
      : `${Math.round(progress.value * 100)}% · ${runtimeLabel.value}`;
  }
  return runtimeLabel.value;
});

/** 上游文本生成节点正在流式输出的内容：显示节点跟着它实时刷新。 */
const upstreamLiveText = computed(() => {
  const current = node.value;
  if (!current || !isDisplay.value) return "";
  const edge = board.edges.find(
    (item) => item.target === current.id && item.targetPort === "text",
  );
  return edge ? run.liveRuns[edge.source]?.text ?? "" : "";
});

/** 当前节点的多值栈（文本 / 值 / 视频 / 音频；图片有自己的牌堆 UI）。 */
const stackInfo = computed(() =>
  node.value ? stackOf(node.value) : { items: [] as unknown[], index: 0 },
);
const stackCount = computed(() => stackInfo.value.items.length);
const stackPos = computed(() => stackInfo.value.index);
const stackKind = computed(() => (node.value ? stackKindOf(node.value) : "value"));
/** 画布上的牌堆胶囊：图片已有自己的牌堆，这里只给文本 / 值 / 视频 / 音频。 */
const showStackBar = computed(() => {
  const current = node.value;
  if (!current) return false;
  if (!current.type.startsWith("input.") && !current.type.startsWith("display.")) return false;
  // 图片 / 视频 / 音频有自己的牌堆胶囊，不再挂第二个翻页器。
  if (mediaKind.value) return false;
  return stackCount.value > 0 || current.type.startsWith("input.");
});
const stackEditable = computed(() => node.value?.type.startsWith("input.") ?? false);

const textPreview = computed(() => {
  const current = node.value;
  if (!current) return "";
  const stackItem = stackInfo.value.items[stackInfo.value.index];
  if (typeof stackItem === "string" && stackItem) return stackItem;
  // 显示节点优先显示上游的实时流；上游没在跑时读运行发布的文本。
  // 输入节点显示自己正在编辑的内容。
  if (isDisplay.value) return upstreamLiveText.value || current.data.outputText || "";
  const text = current.data.params.text;
  if (typeof text === "string" && text) return text;
  return current.data.outputText ?? "";
});

/** 文本显示节点：Markdown / 纯文本（默认 Markdown）。 */
const textMode = computed(() =>
  node.value?.data.params.mode === "plain" ? "plain" : "markdown",
);

/** 文本输出一律按 Markdown 渲染（marked + DOMPurify，和智能体消息同一套）。 */
const textHtml = computed(() => renderMarkdown(textPreview.value));

/* ------------------------------------------------------------------ *
 * 输出附件卡（对齐 ai-board 的 node-output-dock）
 *
 * 模型节点的产物不再塞进卡片主体，而是挂在卡片**下方**：卡片本身还是
 * 参数表单，产物单独一张附件卡，可以收起；多个产物在附件卡里切换。
 * ------------------------------------------------------------------ */

/** 模型节点：只有模型节点有输出附件卡（输入 / 显示节点的内容就是卡片本身）。 */
const isModel = computed(() => definition.value?.category === "model");

/** 值节点：一张安静的表面，编辑器 / 值本身占满整张卡（没有参数行、没有标签）。 */
const isValueNode = computed(
  () => node.value?.type === "display.value" || node.value?.type === "input.value",
);
const isValueDisplay = computed(() => node.value?.type === "display.value");
const valueSpec = computed(() => definition.value?.params.find((spec) => spec.id === "value"));
const valuePreviewRaw = computed<unknown>(() => {
  const item = stackInfo.value.items[stackInfo.value.index];
  if (isValueDisplay.value && stackCount.value > 0) return item ?? null;
  return node.value?.data.values?.value ?? null;
});
/** 显示节点不锁类型：按实际值的形状决定怎么渲染。 */
const valuePreviewKind = computed(() => {
  const raw = valuePreviewRaw.value;
  if (typeof raw === "number") return "number";
  if (typeof raw === "boolean") return "boolean";
  if (raw !== null && typeof raw === "object") return "json";
  return "text";
});
const valuePreviewEmpty = computed(() => {
  const raw = valuePreviewRaw.value;
  return raw === null || raw === undefined || raw === "";
});
const valuePreviewText = computed(() => {
  const raw = valuePreviewRaw.value;
  if (raw !== null && typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  if (typeof raw === "boolean") {
    return raw ? i18n.t("board.value.true") : i18n.t("board.value.false");
  }
  return String(raw ?? "");
});

/** 本次运行发布的全部产物（没有 `outputAssetIds` 的旧文档退回单个输出）。 */
const outputAssets = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids =
    current.data.outputAssetIds ??
    (current.data.outputAssetId ? [current.data.outputAssetId] : []);
  return ids
    .map((id) => assetById(id))
    .filter((asset): asset is MediaAsset => asset !== null);
});

/** 当前对外发布的产物：`outputAssetId` 指向它，下游连线读的也是它。 */
const activeOutput = computed<MediaAsset | null>(() => {
  const current = node.value;
  if (!current) return null;
  const hit = current.data.outputAssetId
    ? outputAssets.value.find((asset) => asset.id === current.data.outputAssetId)
    : null;
  return hit ?? outputAssets.value[0] ?? null;
});

const activeOutputIndex = computed(() =>
  Math.max(0, outputAssets.value.findIndex((asset) => asset.id === activeOutput.value?.id)),
);

/** 输出端口类型：模型节点还没有产物时，也按它显示「等待 / 思考」的附件卡。 */
const outputPortType = computed(() => ports.value.outputs[0]?.type ?? null);

/** 模型节点发布的文本结果（优先显示流式中的实时内容）。 */
const textOutput = computed(() =>
  isModel.value ? live.value?.text || node.value?.data.outputText || "" : "",
);
/** 推理模型拆出来的「思考过程」；和正文分两个 tab。 */
const reasoningOutput = computed(() =>
  isModel.value ? (live.value?.reasoning || node.value?.data.outputReasoning || "").trim() : "",
);
const textOutputHtml = computed(() => renderMarkdown(textOutput.value));
const isTextModel = computed(() => isModel.value && outputPortType.value === "text");
/** 思考过程只有文本生成节点有；ASR 之类的「文本输出」不显示思考 tab。 */
const supportsReasoning = computed(() => node.value?.type === "model.text");

/** 附件卡正文的类型；`null` = 还没有任何产物，不渲染附件卡。 */
const outputKind = computed<AssetKind | "text" | null>(() => {
  if (!isModel.value) return null;
  if (textOutput.value || reasoningOutput.value) return "text";
  if (activeOutput.value) return activeOutput.value.kind;
  if (status.value === "running" && outputPortType.value) {
    return outputPortType.value === "text" ? "text" : (outputPortType.value as AssetKind);
  }
  return null;
});
const hasOutputDock = computed(() => outputKind.value !== null);

/** 输出附件卡的「内容 / 思考」tab。用户点过之后就不再自动切换。 */
const dockTab = ref<"text" | "reasoning">("text");
const dockTabPinned = ref(false);
const showReasoningTab = computed(
  () =>
    supportsReasoning.value &&
    (reasoningOutput.value.length > 0 || status.value === "running"),
);
watch(
  () => [reasoningOutput.value.length, textOutput.value.length] as const,
  ([reasoning, text]) => {
    if (dockTabPinned.value) return;
    dockTab.value = reasoning > 0 && text === 0 ? "reasoning" : "text";
  },
);
function selectDockTab(tab: "text" | "reasoning"): void {
  dockTabPinned.value = true;
  dockTab.value = tab;
}
/** 用户收起过就是 false；新文档 / 老文档默认展开。 */
const outputOpen = computed(() => node.value?.data.outputOpen !== false);
const outputMediaSrc = computed(() => (activeOutput.value ? fileUrl(activeOutput.value.src) : ""));
/** 产物缩略图：视频附件同样先用它垫住首帧，避免生成完就显示一块黑。 */
const outputPoster = computed(() =>
  activeOutput.value ? assetThumbnailUrl(activeOutput.value) : null,
);

/** 附件卡底部的一行元信息：图片 / 视频给尺寸，音频给时长。 */
const outputMeta = computed(() => {
  const asset = activeOutput.value;
  if (!asset) return "";
  if (asset.kind === "image" || asset.kind === "video") {
    return asset.width && asset.height ? `${asset.width} × ${asset.height}` : "";
  }
  return asset.duration > 0 ? clockText(asset.duration) : "";
});

function setDockOpen(open: boolean): void {
  const current = node.value;
  if (!current) return;
  if ((current.data.outputOpen !== false) === open) return;
  board.setNodeRuntime(current.id, { outputOpen: open });
}

/** 点缩略图切换「当前发布」的产物；下游会被标记为过期，等显式运行。 */
function selectOutput(asset: MediaAsset): void {
  const current = node.value;
  if (!current || current.data.outputAssetId === asset.id) return;
  board.updateNodeData(current.id, { outputAssetId: asset.id });
}

// 开始运行 / 新产物落地时自动展开；用户手动收起后，下一次运行前不再强行打开。
watch(status, (next) => {
  if (next === "running") setDockOpen(true);
});
watch(
  () => [outputAssets.value.length, textOutput.value.length, reasoningOutput.value.length] as const,
  ([assets, text, reasoning], previous) => {
    const [prevAssets = 0, prevText = 0, prevReasoning = 0] = previous ?? [];
    if (assets > prevAssets || text > prevText || reasoning > prevReasoning) setDockOpen(true);
  },
);


/** 牌堆纸片：与 ai-board 的 ImageDeck 完全相同的位移 / 旋转 / 层级。 */
function deckStyle(sheet: MediaAsset, index: number): Record<string, string> {
  return {
    backgroundImage: `url("${assetThumbnailUrl(sheet) ?? ""}")`,
    transform: `translate(${14 + index * 9}px, ${8 + index * 6}px) rotate(${1.6 + index * 1.5}deg)`,
    zIndex: String(-1 - index),
  };
}

/**
 * 把节点高度改成素材的原始比例（宽度不变，140–1200 夹取）。
 *
 * 三个触发点共用：素材元数据一换（`watch(primary)`）、图片 `@load`、视频
 * `@loadedmetadata`。同一个「素材 + 宽度」只适配一次，免得和用户手动缩放打架；
 * 也不记撤销步——这是渲染的自然结果。
 */
function fitMedia(naturalWidth: number, naturalHeight: number, key: string): void {
  const current = node.value;
  if (!current || !naturalWidth || !naturalHeight) return;
  const width = nodeWidth.value;
  const next = mediaNodeSize(width, naturalWidth, naturalHeight);
  const stamp = `${key}:${width}`;
  if (fittedKey.value === stamp) return;
  fittedKey.value = stamp;
  if (sameMediaSize(current.size, next)) return;
  board.resizeNode(current.id, next, { record: false });
  // 同一拍里连续两次改节点尺寸时，Vue Flow 的 `v-model:nodes` 回写会被它的
  // pauseModel 丢掉（画布 store 已经是新尺寸、卡片却还是旧尺寸）。这里像手动
  // 缩放一样直接改 flow node，卡片当场跟上素材比例。
  updateNode(current.id, {
    style: { width: `${next.width}px`, height: `${next.height}px` },
  } as never);
}

function onImageLoad(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  if (image.naturalWidth > 0) {
    fitMedia(image.naturalWidth, image.naturalHeight, imageUrl.value ?? "");
  }
}

watch(imageUrl, () => {
  imageFailed.value = false;
  fittedKey.value = "";
});

/** 切换牌堆（循环）：输入节点换「我选的这张」，显示节点换「对外发布的这张」。 */
function stepStack(delta: number): void {
  const current = node.value;
  if (!current || stack.value.length < 2) return;
  const total = stack.value.length;
  const next = (stackIndex.value + delta + total) % total;
  const target = stack.value[next];
  if (!target) return;
  // 显示节点翻牌就是换发布的产物：下游标记过期，等显式运行（和模型节点切换产物一致）。
  if (isDisplay.value) {
    selectOutput(target);
    return;
  }
  board.updateNodeData(current.id, { stackIndex: next, assetId: target.id });
}


/** 空态 / 媒体条上的"选择文件"：图片支持多选。 */
async function pickFiles(): Promise<void> {
  const current = node.value;
  if (!current) return;
  const files = await pickMediaFiles();
  if (files.length === 0) return;
  const imported: MediaAsset[] = [];
  for (const path of files) {
    try {
      imported.push(await importAssetAt(path));
    } catch (error) {
      toast(String(error), "error");
    }
  }
  if (imported.length === 0) return;
  for (const asset of imported) project.dispatch((doc) => addAsset(doc, asset));
  board.updateNodeData(current.id, appendStackPatch(current, imported.map((asset) => asset.id)));
  fitAsset(imported[0]);
}

/** 这个节点是否接收文件拖放（只有媒体输入节点；显示节点让事件冒泡）。 */
function acceptsDrop(): boolean {
  return definition.value?.category === "input" && mediaKind.value !== null;
}

/** 正在拖拽的素材库素材（内存载荷，Safari 的 dragover 读不到 dataTransfer）。 */
function draggedAsset(): MediaAsset | null {
  const payload = getDragPayload();
  if (payload?.kind !== "asset") return null;
  return assetById(payload.id);
}

function onNodeDragOver(event: DragEvent): void {
  if (!acceptsDrop()) return;
  const asset = draggedAsset();
  if (asset && asset.kind !== mediaKind.value) return; // 让画布去建对应类型的输入节点
  event.preventDefault();
  event.stopPropagation();
  dropActive.value = true;
}

function onNodeDragLeave(event: DragEvent): void {
  if (!acceptsDrop()) return;
  event.stopPropagation();
  dropActive.value = false;
}

/** 把素材 / 文件拖到卡片上：直接追加 / 替换为这个节点的素材（ai-board 的 DropShell）。 */
async function onNodeDrop(event: DragEvent): Promise<void> {
  if (!acceptsDrop()) return;
  const current = node.value;
  const expected = kind.value;
  if (!current) return;

  // 素材库内部拖拽：不重新导入，直接把已有素材挂到节点上。
  const dragged = draggedAsset();
  if (dragged && dragged.kind !== expected) {
    // 类型不符：把 drop 让给画布，在指针处建一个对应类型的输入节点。
    dropActive.value = false;
    return;
  }
  if (dragged) {
    event.preventDefault();
    event.stopPropagation();
    dropActive.value = false;
    board.updateNodeData(current.id, appendStackPatch(current, [dragged.id]));
    fitAsset(dragged);
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  dropActive.value = false;
  const imported: MediaAsset[] = [];
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    try {
      const direct = (file as File & { path?: string }).path;
      const path = direct || (await uploadLocalFile(file));
      if (kindFromPath(path) !== expected) {
        toast(i18n.t("error.unsupportedType", { name: file.name }), "error");
        continue;
      }
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      imported.push(asset);
    } catch (error) {
      toast(String(error), "error");
    }
  }
  if (imported.length === 0) return;
  board.updateNodeData(current.id, appendStackPatch(current, imported.map((item) => item.id)));
  fitAsset(imported[0]);
}

/** 打开素材库选择对话框（视频 / 音频单选，图片可多选）。 */
function openLibrary(): void {
  if (!acceptsDrop()) return;
  libraryOpen.value = true;
}

/** 从素材库选中后：图片追加到牌堆，视频 / 音频替换当前素材。 */
function onLibraryPick(ids: string[]): void {
  const current = node.value;
  if (!current) return;
  const picked = ids
    .map((id) => assetById(id))
    .filter((item): item is MediaAsset => item !== null && item.kind === kind.value);
  if (picked.length === 0) return;
  board.updateNodeData(current.id, appendStackPatch(current, picked.map((item) => item.id)));
  fitAsset(picked[0]);
}

/**
 * 按素材元数据先定一次尺寸（图片 / 视频通用）。
 *
 * 运行产出、拖入、素材库选中都会走这里，所以**不用等 `<img>` / `<video>` 加载完**
 * 卡片就已经是素材的比例；ffprobe 读不到宽高时由 `@load` / `@loadedmetadata` 兜底。
 */
function fitAsset(asset: MediaAsset): void {
  if (!asset.width || !asset.height) return;
  fitMedia(asset.width, asset.height, assetThumbnailUrl(asset) ?? asset.src);
}

/** 素材一换（输入 / 拖入 / 运行产出）就适配一次：显示节点也靠这条跟上产物尺寸。 */
watch(
  [
    () => primary.value?.id,
    () => primary.value?.width,
    () => primary.value?.height,
    nodeWidth,
  ],
  () => {
    if (kind.value !== "image" && kind.value !== "video") return;
    const asset = primary.value;
    if (asset) fitAsset(asset);
  },
  { immediate: true },
);

function runNode(): void {
  const current = node.value;
  if (!current) return;
  // 组节点的「运行」= 组员各自入队（调度器负责依赖与资源）。
  if (current.type === "group") {
    for (const id of board.expandGroups([current.id])) run.runNode(id);
    return;
  }
  run.runNode(current.id);
}

/** 重建节点：先清掉旧产物 / 文本 / 思考过程，再从头跑。 */
function rebuildNode(): void {
  if (node.value) run.rebuild(node.value.id);
}

function toggleIgnored(): void {
  const current = node.value;
  if (!current) return;
  if (current.type === "group") {
    board.setGroupFlag(current.id, { ignored: !current.data.ignored });
    return;
  }
  board.updateNodeData(current.id, { ignored: !current.data.ignored });
}

/** 旁路：只跳过这一个节点，下游改用它同类型的输入（禁用会连下游一起停）。 */
function toggleBypassed(): void {
  const current = node.value;
  if (!current) return;
  if (current.type === "group") {
    board.setGroupFlag(current.id, { bypassed: !current.data.bypassed });
    return;
  }
  board.updateNodeData(current.id, { bypassed: !current.data.bypassed });
}

function duplicate(): void {
  if (node.value) board.duplicateNode(node.value.id);
}

function remove(): void {
  if (node.value) board.removeNodes([node.value.id]);
}

/**
 * 🔻 右下角缩放。
 *
 * 尺寸必须写进 Vue Flow 自己的节点对象（`updateNode`），不能直接改外层 DOM 的
 * `style.width`：Vue Flow 会在 ResizeObserver 回调里用 `node.style` 重新 patch 一次，
 * 手写的宽度会被立刻覆盖回原值，于是拖动时卡片在「新尺寸 / 旧尺寸」之间来回跳。
 *
 * 拖动期间每帧只提交一次（rAF 合并 pointermove），松手才写回 store 并记一步撤销。
 *
 * 两个必须注意的点（「点一下松手节点就变小」就是这里来的）：
 * 1. **以逻辑尺寸为基准**，不要用 `getBoundingClientRect()`——画布有缩放，
 *    取整后的屏幕尺寸会比逻辑尺寸小 1px，每次点击都把它写回去，节点就越点越小；
 * 2. **没真的拖动就不要写回 store**：按下即松手只当作点击，不产生 resize。
 */
function onResizeStart(event: PointerEvent): void {
  const wrapper = cardEl.value?.closest(".vue-flow__node") as HTMLElement | null;
  const current = node.value;
  if (!wrapper || !current) return;
  event.preventDefault();
  event.stopPropagation();
  const defaults = definition.value?.defaultSize;
  const startWidth = current.size?.width ?? defaults?.width ?? 240;
  const startHeight = current.size?.height ?? defaults?.height ?? 200;
  // 指针位移是屏幕像素，节点尺寸是画布单位，缩放后两者差一个 zoom。
  const zoom = getViewport().zoom || 1;
  const startX = event.clientX;
  const startY = event.clientY;
  resizing.value = true;
  // 图片 / 视频节点锁定原始比例（ai-board 的 `lockAspectRatio`）：只让宽度
  // 跟随指针，高度按素材比例算，这样用户缩放时卡片不会把图裁掉。
  const ratio =
    definition.value?.lockAspectRatio === true
      ? (primary.value?.height ?? startHeight) / (primary.value?.width ?? Math.max(1, startWidth))
      : 0;

  /** 拖动超过这个距离才认为用户真的在缩放（避免手抖原地变成 resize）。 */
  const THRESHOLD = 2;
  let moved = false;
  let pending: { width: number; height: number } | null = null;
  let latest: { width: number; height: number } = { width: startWidth, height: startHeight };
  let frame = 0;
  const flush = (): void => {
    frame = 0;
    if (!pending) return;
    latest = pending;
    pending = null;
    updateNode(
      current.id,
      { style: { width: `${latest.width}px`, height: `${latest.height}px` } } as never,
    );
  };
  const onMove = (move: PointerEvent): void => {
    const dx = (move.clientX - startX) / zoom;
    const dy = (move.clientY - startY) / zoom;
    if (!moved) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      moved = true;
    }
    const width = Math.max(150, Math.round(startWidth + dx));
    const height =
      ratio > 0
        ? Math.min(1200, Math.max(96, Math.round(width * ratio)))
        : Math.max(96, Math.round(startHeight + dy));
    pending = { width, height };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const finish = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    resizing.value = false;
    // 只是点了一下：不写回 store，也不记撤销。
    if (!moved) {
      pending = null;
      return;
    }
    flush();
    if (node.value) board.resizeNode(node.value.id, latest);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  // 指针在窗口外松开 / 被系统打断时也要收尾，否则卡片会停在拖到一半的尺寸上。
  window.addEventListener("pointercancel", finish);
}

/* ------------------------------------------------------------------ *
 * ai-board card details: text editing, media transport, model form.
 *
 * 视频的播放条 / 首帧 / 静音 / 全屏都在 `BoardVideoPlayer` 里：显示节点的整卡
 * 和模型节点的输出附件卡共用同一个组件，两处的 UI 才不会各走一套。
 * ------------------------------------------------------------------ */
const audioEl = ref<HTMLAudioElement | null>(null);
const audioPlaying = ref(false);
const audioTime = ref(0);
const audioDuration = ref(0);

const mediaSrc = computed(() => (primary.value ? fileUrl(primary.value.src) : ""));
const statusLabel = computed(() => {
  // 文本模型流式时细分「思考中 / 流式输出」，其它节点统一「运行中」。
  if (status.value === "running") {
    if (isTextModel.value) {
      return textOutput.value
        ? i18n.t("board.status.streaming")
        : i18n.t("board.status.thinking");
    }
    if (node.value?.type === "model.asr" || node.value?.type === "model.enhance" || node.value?.type === "model.separate") {
      return i18n.t("board.status.processing");
    }
    if (node.value?.type.startsWith("model.")) return i18n.t("board.status.generating");
    return i18n.t("board.status.running");
  }
  return i18n.t(`board.status.${status.value}`);
});

/** 文本输入节点正在编辑的内容。 */
const textValue = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (current.type === "input.text") {
    const item = stackInfo.value.items[stackInfo.value.index];
    return typeof item === "string" ? item : "";
  }
  const text = current.data.params.text;
  return typeof text === "string" ? text : "";
});

function patchParams(patch: Record<string, unknown>): void {
  const current = node.value;
  if (!current) return;
  board.updateNodeData(current.id, { params: { ...current.data.params, ...patch } });
}

function setText(event: Event): void {
  const current = node.value;
  const next = (event.target as HTMLTextAreaElement).value;
  if (current?.type === "input.text") {
    const replaced = replaceCurrent(current, next);
    board.updateNodeData(current.id, {
      ...stackPatch(current, replaced.items, replaced.index),
      params: { ...current.data.params, text: replaced.items[replaced.index] ?? "" },
    });
    return;
  }
  patchParams({ text: next });
}

function clearText(): void {
  const current = node.value;
  if (current?.type === "input.text") {
    const replaced = replaceCurrent(current, "");
    board.updateNodeData(current.id, {
      ...stackPatch(current, replaced.items, replaced.index),
      params: { ...current.data.params, text: "" },
    });
    return;
  }
  patchParams({ text: "" });
}

/** 牌堆操作：切换 / 追加 / 删除当前项。 */
function shiftStack(delta: number): void {
  const current = node.value;
  if (!current || stackCount.value < 2) return;
  const next = (stackPos.value + delta + stackCount.value) % stackCount.value;
  board.updateNodeData(current.id, stackPatch(current, stackInfo.value.items, next));
}

function addStackItem(): void {
  const current = node.value;
  if (!current) return;
  if (stackKind.value === "image" || stackKind.value === "video" || stackKind.value === "audio") {
    void pickFiles();
    return;
  }
  const kind = stackKind.value;
  const seed = kind === "text" ? "" : 0;
  const items = [...stackInfo.value.items, seed];
  board.updateNodeData(current.id, stackPatch(current, items, items.length - 1));
}

function removeStackItem(): void {
  const current = node.value;
  if (!current || stackCount.value === 0) return;
  const items = stackInfo.value.items.filter((_, index) => index !== stackPos.value);
  board.updateNodeData(
    current.id,
    stackPatch(current, items, Math.max(0, Math.min(items.length - 1, stackPos.value))),
  );
}

async function copyTextValue(): Promise<void> {
  await copyToClipboard(textValue.value);
  toast(i18n.t("board.node.textCopied"));
}

/** 文本显示卡整张都是拖动面（选不中文字），所以复制收进悬停控制里。 */
async function copyDisplayText(): Promise<void> {
  await copyToClipboard(textPreview.value);
  toast(i18n.t("board.node.textCopied"));
}

function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** 播放器报上来的元数据：视频卡和图片卡同一套适配，宽度不变、高度按画面比例。 */
function onVideoMeta(meta: { width: number; height: number }): void {
  if (meta.width > 0 && meta.height > 0) {
    fitMedia(meta.width, meta.height, imageUrl.value ?? mediaSrc.value);
  }
}

const audioProgress = computed(() =>
  audioDuration.value > 0 ? Math.min(1, audioTime.value / audioDuration.value) : 0,
);

/** 音频波形：按素材 id 生成一组稳定的柱高，播放时按进度点亮。 */
const audioBars = computed<number[]>(() => {
  const seedSource = primary.value?.id ?? nodeId.value;
  let seed = 7;
  for (let index = 0; index < seedSource.length; index++) {
    seed = (seed * 31 + seedSource.charCodeAt(index)) % 2147483647;
  }
  return Array.from({ length: 56 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 20 + (seed % 80);
  });
});

function onAudioMeta(): void {
  const el = audioEl.value;
  if (el && Number.isFinite(el.duration)) audioDuration.value = el.duration;
}

function onAudioTime(): void {
  const el = audioEl.value;
  if (el) audioTime.value = el.currentTime;
}

function toggleAudio(): void {
  const el = audioEl.value;
  if (!el) return;
  if (el.paused) void el.play().catch(() => undefined);
  else el.pause();
}

function seekAudio(event: MouseEvent): void {
  const el = audioEl.value;
  if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
  el.currentTime = ratio * el.duration;
  audioTime.value = el.currentTime;
}

/* ---------- 模型节点的表单 ---------- */

const cloudProviders = ref<CloudGenProvider[]>([]);
const cloudPresets = ref<CloudGenPreset[]>([]);
/** 语音合成 / 语音识别有各自的云端配置，不在 cloud_gen 里。 */
const cloudTts = ref<CloudTtsProvider[]>([]);
const cloudAsr = ref<CloudAsrProvider[]>([]);

const allParams = computed(() =>
  visibleParams(definition.value, node.value?.data.params ?? {}),
);
/** 卡片上只渲染常用参数；流式 / 思考强度 / topP 等只在检查器里出现。 */
const modelParams = computed(() => allParams.value.filter((spec) => !spec.inspectorOnly));

// ---- 工作流节点卡片（签名只读预览，增删在画布检查器） ----
const isWorkflowNode = computed(() => {
  const type = node.value?.type ?? "";
  return type === "workflow.start" || type === "workflow.end" || type === "workflow.call";
});
const isWorkflowCall = computed(() => node.value?.type === "workflow.call");
const callTargetName = computed(() => String(node.value?.data.params.workflowName ?? ""));
const workflowSignature = computed(() =>
  node.value ? signatureOf(node.value) : { inputs: [], outputs: [] },
);
const workflowRows = computed(() => {
  const current = node.value;
  if (!current) return [];
  const decls =
    current.type === "workflow.start"
      ? workflowSignature.value.inputs
      : workflowSignature.value.outputs;
  return decls.map((decl) => {
    const bound =
      current.type === "workflow.end"
        ? board.edges.some((edge) => edge.target === current.id && edge.targetPort === decl.id)
        : true;
    return {
      id: decl.id,
      label: (decl.label || decl.name || decl.id).trim(),
      type: decl.type,
      bound,
    };
  });
});
/** 嵌入节点跑完之后，把拿到的签名输出列在卡片上（结果不放卡片主体以外）。 */
const callOutputs = computed(() => {
  const current = node.value;
  if (!current || current.type !== "workflow.call") return [];
  const decls = current.data.signature?.outputs ?? [];
  const values = current.data.values ?? {};
  return decls
    .filter((decl) => values[`out-${decl.id}`] !== undefined && values[`out-${decl.id}`] !== null)
    .map((decl) => ({
      id: decl.id,
      label: (decl.label || decl.name || decl.id).trim(),
      type: decl.type,
    }));
});

const workflowSubtitle = computed(() => {
  const count = workflowRows.value.length;
  if (isWorkflowCall.value) return i18n.t("board.node.workflowCall");
  return count > 0
    ? i18n.t("board.canvas.signatureSummary", {
        inputs: workflowSignature.value.inputs.length,
        outputs: workflowSignature.value.outputs.length,
      })
    : i18n.t("board.canvas.signatureNone");
});
const workflowFoot = computed(() =>
  node.value?.type === "workflow.start"
    ? i18n.t("board.inspect.workflowInputs")
    : node.value?.type === "workflow.end"
      ? i18n.t("board.inspect.workflowOutputs")
      : i18n.t("board.inspect.workflowTarget"),
);
const needsCloud = computed(() => allParams.value.some((spec) => Boolean(spec.model?.capability)));
const needsCloudTts = computed(() => allParams.value.some((spec) => spec.model?.cloud === "tts"));
const needsCloudAsr = computed(() => allParams.value.some((spec) => spec.model?.cloud === "asr"));
/** 文本生成节点：模型下拉来自「设置 → 文本生成」的供应商列表。 */
const needsLlm = computed(() => allParams.value.some((spec) => spec.llm));
const llm = useBoardLlm();

onMounted(async () => {
  if (needsLlm.value) void llm.ensure();
  if (needsCloudTts.value) cloudTts.value = await boardCloudTtsProviders();
  if (needsCloudAsr.value) cloudAsr.value = await boardCloudAsrProviders();
  if (!needsCloud.value) return;
  const [providers, presets] = await Promise.all([boardCloudProviders(), boardCloudPresets()]);
  cloudProviders.value = providers;
  cloudPresets.value = presets;
});

function paramValue(spec: BoardParamSpec): string {
  const current = node.value?.data.params[spec.id];
  const raw =
    current === undefined || current === null
      ? spec.default === undefined
        ? ""
        : String(spec.default)
      : String(current);
  // 文本模型没单独选时，展示第一家启用供应商的默认模型（运行也用它）。
  if (!raw && spec.llm) return llm.fallback.value?.id ?? "";
  return raw;
}

/** 参数的原始值（不转字符串）：值节点编辑器要拿 number / boolean 本身。 */
function paramRaw(spec: BoardParamSpec): unknown {
  const current = node.value;
  if (current?.type === "input.value" && spec.id === "value" && stackCount.value > 0) {
    return stackInfo.value.items[stackInfo.value.index] ?? spec.default;
  }
  const stored = current?.data.params[spec.id];
  return stored === undefined || stored === null ? spec.default : stored;
}

/** 值输入编辑当前那一张：多值时写 items，否则写参数。 */
function setValueParam(spec: BoardParamSpec, value: unknown): void {
  const current = node.value;
  if (current?.type === "input.value" && stackCount.value > 0) {
    const replaced = replaceCurrent(current, value);
    board.updateNodeData(current.id, {
      ...stackPatch(current, replaced.items, replaced.index),
      params: { ...current.data.params, [spec.id]: value },
    });
    return;
  }
  setParam(spec, value);
}

function paramBool(spec: BoardParamSpec): boolean {
  const current = node.value?.data.params[spec.id];
  return typeof current === "boolean" ? current : spec.default === true;
}

function paramNumber(spec: BoardParamSpec): number {
  const value = Number(paramValue(spec));
  return Number.isFinite(value) ? value : 0;
}

function setParam(spec: BoardParamSpec, value: unknown): void {
  patchParams({ [spec.id]: value });
}

/**
 * 模型下拉：**供应商名做分组标题，下面跟着它家的模型**；本地引擎单独一组。
 * 搜索框由 Md3Select 放在菜单最上面（选项多时自动出现）。
 */
/** 这个参数对应的设置分区：模型下拉开头放一个「配置云端 API」快捷项。 */
function settingsSectionOf(spec: BoardParamSpec): SettingsSection | null {
  if (spec.llm) return "text";
  if (spec.model?.cloud) return spec.model.cloud;
  if (spec.model?.capability) return "gen";
  return null;
}

function openParamSettings(spec: BoardParamSpec): void {
  layout.openSettings(settingsSectionOf(spec) ?? "gen");
}

function paramOptions(spec: BoardParamSpec): SelectOption[] {
  const options = buildParamOptions(spec);
  if (!settingsSectionOf(spec)) return options;
  return [
    {
      id: "__open_settings",
      label: i18n.t("board.inspect.modelSettings"),
      hint: i18n.t("board.inspect.modelSettingsHint"),
      action: true,
    },
    ...options,
  ];
}

function buildParamOptions(spec: BoardParamSpec): SelectOption[] {
  const localGroup = i18n.t("board.inspect.localGroup");
  if (spec.llm) {
    // 文本生成：每家文本供应商一组。
    const current = paramValue(spec);
    const items = llm.options.value;
    const list =
      current && !items.some((item) => item.id === current)
        ? [
            {
              id: current,
              label: current.split(LLM_VALUE_SEP).slice(1).join(LLM_VALUE_SEP),
              group: current.split(LLM_VALUE_SEP)[0] ?? "",
            },
            ...items,
          ]
        : items.slice();
    if (!list.length) {
      return [{ id: "", label: i18n.t("board.node.llmUnconfigured") }];
    }
    return list.map((item) => ({
      id: item.id,
      label: item.label,
      group: "group" in item ? (item as { group?: string }).group : undefined,
    }));
  }
  if (spec.model) {
    const options: SelectOption[] = [];
    for (const model of models.ofFeature(spec.model.feature as ModelFeature)) {
      options.push({
        id: `local:${model.id}`,
        label: model.installed ? model.name : `${model.name} · ${i18n.t("board.inspect.missing")}`,
        group: localGroup,
      });
    }
    if (spec.model.capability) {
      for (const provider of providersForNodeCapability(
        cloudProviders.value,
        spec.model.capability as never,
        cloudPresets.value,
      )) {
        options.push({
          id: `cloud:${provider.id}`,
          label: cloudModelLabel(provider, spec.model.capability) || provider.name,
          group: provider.name,
        });
      }
    }
    // 语音合成 / 语音识别：云端服务来自各自的设置页，和本地模型并列。
    if (spec.model.cloud === "tts") {
      for (const provider of cloudTts.value) {
        if (!provider.enabled) continue;
        options.push({
          id: `cloud:${provider.id}`,
          label: provider.model || provider.name,
          group: provider.name,
        });
      }
    }
    if (spec.model.cloud === "asr") {
      for (const provider of cloudAsr.value) {
        if (!provider.enabled) continue;
        options.push({
          id: `cloud:${provider.id}`,
          label: provider.model || provider.name,
          group: provider.name,
        });
      }
    }
    return options;
  }
  return (spec.options ?? []).map((option) => ({
    id: option.value,
    label: i18n.t(option.labelKey),
  }));
}

/** 云端生成服务在某个能力下用的模型名（能力不同，模型字段也不同）。 */
function cloudModelLabel(provider: CloudGenProvider, capability?: string): string {
  if (capability === "i2i") return provider.edit_model || provider.image_model;
  if (capability === "t2v" || capability === "i2v") return provider.video_model;
  return provider.image_model;
}

/**
 * 节点实际会用到的模型值。
 *
 * 文本节点的模型留空时，下拉框、副标题、左下角标签和运行都必须用同一个
 * 兜底（`paramValue` 已经做了），否则就会出现「卡片上明明显示了模型，
 * 左下角却说未配置」——那就是以前 `params.model` 直接取值的老毛病。
 */
function effectiveModel(current: BoardNode): string {
  const { paramId } = modelTarget(current);
  if (!paramId) return "";
  const spec = allParams.value.find((item) => item.id === paramId);
  return spec ? paramValue(spec) : "";
}

/**
 * 文本节点是不是真的没有可用模型。
 *
 * 配置还没拉到时 `fallback` 也是空的，这时候不能先报「未配置」，
 * 否则每张文本卡在挂载瞬间都会闪一下错误提示。
 */
const textModelMissing = computed(() => {
  const current = node.value;
  if (!current || !modelTarget(current).text) return false;
  return llm.loaded.value && !effectiveModel(current);
});

/** 卡片头部副标题：模型节点显示当前选中的模型 + 它当前的参考 / 分轨能力。 */
const modelSubtitle = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (current.type === "model.demux") return i18n.t("board.node.demuxSubtitle");
  const target = modelTarget(current);
  const value = effectiveModel(current);
  let base = "";
  if (target.text) {
    if (!value) base = textModelMissing.value ? i18n.t("board.node.llmUnconfigured") : "";
    else {
      const option = llm.options.value.find((item) => item.id === value);
      base = option ? `${option.label} · ${option.group}` : value.split(LLM_VALUE_SEP).join(" · ");
    }
  } else {
    const spec = allParams.value.find((item) => item.id === target.paramId);
    if (!spec) base = i18n.t("board.node.modelLocal");
    else if (!value) base = i18n.t("board.node.noModel");
    else {
      const option = paramOptions(spec).find((item) => item.id === value);
      const [kind, id] = value.split(":");
      base = option?.label ?? (kind === "cloud" ? i18n.t("board.inspect.cloud", { name: id }) : id);
    }
  }
  // 能力角标：H3 的 9 图 / 3 音频 / 3 视频、分离的音轨数、图像模型的多图参考数。
  if (current.type === "model.video" && isReferenceVideoModel(current, portContext.value)) {
    base += ` · ${i18n.t("board.node.refSummary")}`;
  }
  if (current.type === "model.separate") {
    const model = splitModelValue(effectiveModel(current));
    const stems = stemsForFamily(
      model?.kind === "local" ? models.byId(model.id)?.family ?? null : null,
    );
    if (stems.length > 0) base += ` · ${i18n.t("board.node.stemSummary", { count: stems.length })}`;
  }
  if (current.type === "model.image") {
    const count = imageRefCount(current, portContext.value);
    if (count > 1) base += ` · ${i18n.t("board.node.multiRefSummary", { count })}`;
  }
  return base;
});

/**
 * 卡片底部左侧：后端类型（本地模型 / 云端服务 / 文本模型），
 * 只有**真的没有可用模型**时才显示「未选择 / 未配置」。
 */
const modelFoot = computed(() => {
  const current = node.value;
  if (!current) return "";
  switch (modelBackend(current, effectiveModel(current))) {
    case "text":
      return i18n.t("board.node.modelTextKind");
    case "local":
      return i18n.t("board.node.modelLocal");
    case "cloud":
      return i18n.t("board.node.modelCloud");
    case "unconfigured":
      // 文本节点缺的是「供应商」（去设置里加），其它节点缺的是「这个节点上的模型」。
      if (modelTarget(current).text) {
        return textModelMissing.value
          ? i18n.t("board.node.llmUnconfigured")
          : i18n.t("board.node.modelTextKind");
      }
      return i18n.t("board.node.noModel");
    default:
      return i18n.t("board.node.localProcess");
  }
});

/** 多图输出：除当前图以外的纸片（最多 3 张）。 */
const outputDeck = computed(() =>
  outputAssets.value
    .filter((_, index) => index !== activeOutputIndex.value)
    .slice(0, 3),
);

/** 输出附件里的多图牌堆纸片（和输入图片卡同一套位移 / 旋转）。 */
function outputDeckStyle(sheet: MediaAsset, index: number): Record<string, string> {
  return {
    backgroundImage: `url("${assetThumbnailUrl(sheet) ?? ""}")`,
    transform: `translate(${12 + index * 8}px, ${7 + index * 5}px) rotate(${1.4 + index * 1.4}deg)`,
    zIndex: String(-1 - index),
  };
}

/** 产物对应的输出端口名（多音轨 / 视频音频分离的缩略图提示）。 */
function outputLabel(asset: MediaAsset): string {
  const outputs = node.value?.data.outputs ?? {};
  const portId = Object.keys(outputs).find((key) => outputs[key] === asset.id);
  const port = ports.value.outputs.find((item) => item.id === portId);
  return port ? port.label?.trim() || i18n.t(port.labelKey) : asset.name;
}

/** 点一下当前图：切到牌堆里的下一张（和图片显示节点一致）。 */
function cycleOutput(): void {
  if (outputAssets.value.length <= 1) return;
  const next = outputAssets.value[(activeOutputIndex.value + 1) % outputAssets.value.length];
  if (next) selectOutput(next);
}

</script>

<template>
  <div
    v-if="node"
    ref="cardEl"
    class="board-node"
    :data-kind="definition ? kind : 'unknown'"
    :data-node-type="node.type"
    :data-category="definition?.category ?? 'unknown'"
    :data-selected="selected ? 'true' : 'false'"
    :data-empty="empty ? 'true' : 'false'"
    :data-status="status"
    :data-compact="compact ? 'true' : 'false'"
    :class="{ ignored, bypassed, resizing }"
    @dragover="onNodeDragOver"
    @dragleave="onNodeDragLeave"
    @drop="onNodeDrop"
  >
    <!-- 卡片上方浮动标签：图标 + 标题 + 类型 + 状态 -->
    <div class="node-label">
      <span class="node-label-mark">
        <component :is="nodeIcon(node.type)" />
      </span>
      <span class="node-label-title">{{ title }}</span>
      <span class="node-label-type">{{ node.type }}</span>
      <span class="node-label-status" :data-state="status" :title="statusLabel" />
      <span
        v-if="runtimeText"
        class="node-label-runtime"
        :data-state="status"
        :title="`${statusLabel} · ${runtimeText}`"
      >
        {{ runtimeText }}
      </span>
      <span v-if="ignored" class="node-label-flag">{{ i18n.t("board.ctx.ignore") }}</span>
      <span v-else-if="bypassed" class="node-label-flag bypass">{{ i18n.t("board.ctx.bypass") }}</span>
      <span v-if="kind === 'group'" class="node-label-flag group">
        {{ i18n.t("board.group.count", { count: groupMembers.length }) }}
      </span>
    </div>

    <!-- 悬停控制：与 ai-board 一样贴在标签右侧 -->
    <div class="node-hover-controls nodrag" @pointerdown.stop @click.stop>
      <button
        v-if="definition && kind !== 'group'"
        type="button"
        data-kind="rebuild"
        :title="i18n.t('board.ctx.rebuildHint')"
        :aria-label="i18n.t('board.ctx.rebuild')"
        :disabled="status === 'running'"
        @click="rebuildNode"
      >
        <ArrowPathIcon />
      </button>
      <button
        v-if="definition && kind !== 'group'"
        type="button"
        :data-kind="status === 'running' ? 'stop' : 'run'"
        :title="status === 'running' ? i18n.t('board.run.stop') : i18n.t('board.ctx.run')"
        @click="status === 'running' ? run.stop() : runNode()"
      >
        <component :is="status === 'running' ? StopIcon : PlayIcon" />
      </button>
      <button
        v-if="isDisplay && kind === 'text' && textPreview"
        type="button"
        data-kind="copy"
        :title="i18n.t('board.node.copyOutputText')"
        :aria-label="i18n.t('board.node.copyOutputText')"
        @click="copyDisplayText"
      >
        <ClipboardIcon />
      </button>
      <button type="button" data-kind="duplicate" :title="i18n.t('board.ctx.duplicate')" @click="duplicate">
        <DocumentDuplicateIcon />
      </button>
      <button
        type="button"
        data-kind="bypass"
        :data-active="bypassed ? 'true' : 'false'"
        :title="bypassed ? i18n.t('board.ctx.bypassOff') : i18n.t('board.ctx.bypass')"
        @click="toggleBypassed"
      >
        <ArrowsRightLeftIcon />
      </button>
      <button
        type="button"
        data-kind="ignore"
        :data-active="ignored ? 'true' : 'false'"
        :title="ignored ? i18n.t('board.ctx.enable') : i18n.t('board.ctx.ignore')"
        @click="toggleIgnored"
      >
        <component :is="ignored ? EyeIcon : EyeSlashIcon" />
      </button>
      <button type="button" data-kind="delete" :title="i18n.t('common.delete')" @click="remove">
        <TrashIcon />
      </button>
    </div>

    <!-- 内容舞台：图片 / 视频 / 音频是整张作品卡，文本与模型是排版卡 -->
    <div class="node-surface" :data-kind="kind">
      <StackBar
        v-if="showStackBar"
        class="node-stack-bar"
        :count="stackCount"
        :index="stackPos"
        :editable="stackEditable"
        @shift="shiftStack"
        @add="addStackItem"
        @remove="removeStackItem"
      />
      <div v-if="error" class="node-error">{{ error }}</div>

      <!--
        ============ 定义缺失：插件没加载成功 / 被卸载 ============
        工程里的节点、端口快照和连线都还在，这里给一张占位卡——不能什么都不画，
        否则用户看到的是「节点凭空消失」，既点不中也删不掉。
      -->
      <div v-if="!definition" class="node-unknown">
        <span class="art-empty-icon"><LinkIcon /></span>
        <strong>{{ i18n.t("board.node.missingPlugin") }}</strong>
        <span>{{ i18n.t("board.node.missingPluginHint") }}</span>
        <code>{{ node.type }}</code>
      </div>

      <!-- ============ 组：一块安静的虚线容器（成员节点画在它上面） ============ -->
      <div v-else-if="kind === 'group'" class="group-frame" :data-tone="groupTone">
        <p v-if="groupMembers.length === 0" class="group-empty">
          {{ i18n.t("board.group.empty") }}
        </p>
      </div>

      <!-- ============ 图片（ai-board 的 art-card） ============ -->
      <div v-else-if="kind === 'image'" class="art-card" data-kind="image" :data-drop="dropActive ? 'true' : 'false'">
        <template v-if="primary && imageUrl && !imageFailed">
          <div v-if="deck.length > 0" class="art-deck" aria-hidden="true">
            <div
              v-for="(sheet, index) in deck"
              :key="sheet.id"
              class="art-deck-sheet"
              :style="deckStyle(sheet, index)"
            />
          </div>
          <div class="art-stage">
            <img
              :src="imageUrl"
              :alt="primary.name"
              draggable="false"
              @load="onImageLoad"
              @error="imageFailed = true"
            />
          </div>
          <button
            v-if="stack.length > 1"
            class="art-stack-pill nodrag"
            type="button"
            :title="i18n.t('board.node.nextImage')"
            :aria-label="i18n.t('board.node.nextImage')"
            @pointerdown.stop
            @click.stop="stepStack(1)"
          >
            <span>{{ stackIndex + 1 }}</span>
            <span class="art-stack-sep">/</span>
            <span>{{ stack.length }}</span>
          </button>
        </template>

        <!-- 显示节点：安静的等待态（art-empty-quiet） -->
        <div v-else-if="isDisplay" class="art-empty art-empty-quiet">
          <PhotoIcon />
          <strong>{{ imageFailed ? i18n.t("board.node.brokenImage") : i18n.t(upstreamConnected ? "board.node.waitingRun" : "board.node.waitingMedia") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t(upstreamConnected ? "board.node.waitingRunHint" : "board.node.waitingHint") }}</span>
        </div>

        <!-- 输入节点：内缩的虚线投放区 + 两个胶囊按钮 -->
        <div v-else class="art-empty">
          <span class="art-empty-icon"><PhotoIcon /></span>
          <strong>{{ imageFailed ? i18n.t("board.node.brokenImage") : i18n.t("board.node.uploadImage") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t("board.node.imageHint") }}</span>
          <div class="art-empty-actions">
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="pickFiles">
              <ArrowUpTrayIcon />
              {{ i18n.t("board.node.chooseFile") }}
            </button>
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="openLibrary">
              <PhotoIcon />
              {{ i18n.t("board.inspect.pickAsset") }}
            </button>
          </div>
        </div>
      </div>

      <!-- ============ 视频 ============ -->
      <div v-else-if="kind === 'video'" class="art-card" data-kind="video" :data-drop="dropActive ? 'true' : 'false'">
        <div v-if="deck.length > 0" class="art-deck" aria-hidden="true">
          <div
            v-for="(sheet, index) in deck"
            :key="sheet.id"
            class="art-deck-sheet"
            :style="deckStyle(sheet, index)"
          />
        </div>
        <div v-if="primary && mediaSrc" class="media-video">
          <!-- 与模型节点输出附件共用同一个播放器：自绘播放条 + 首帧。 -->
          <BoardVideoPlayer
            :src="mediaSrc"
            :poster="imageUrl"
            fill
            @meta="onVideoMeta"
            @error="imageFailed = true"
          />
        </div>

        <div v-else-if="isDisplay" class="art-empty art-empty-quiet">
          <FilmIcon />
          <strong>{{ imageFailed ? i18n.t("board.node.brokenVideo") : i18n.t(upstreamConnected ? "board.node.waitingRun" : "board.node.waitingMedia") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t(upstreamConnected ? "board.node.waitingRunHint" : "board.node.waitingHint") }}</span>
        </div>

        <div v-else class="art-empty">
          <span class="art-empty-icon"><VideoCameraIcon /></span>
          <strong>{{ imageFailed ? i18n.t("board.node.brokenVideo") : i18n.t("board.node.dropVideo") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t("board.node.videoHint") }}</span>
          <div class="art-empty-actions">
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="pickFiles">
              <ArrowUpTrayIcon />
              {{ i18n.t("board.node.chooseFile") }}
            </button>
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="openLibrary">
              <VideoCameraIcon />
              {{ i18n.t("board.inspect.pickAsset") }}
            </button>
          </div>
        </div>

        <button
          v-if="stack.length > 1 && primary"
          class="art-stack-pill art-stack-pill-top nodrag"
          type="button"
          :title="i18n.t('board.node.nextMedia')"
          :aria-label="i18n.t('board.node.nextMedia')"
          @pointerdown.stop
          @click.stop="stepStack(1)"
        >
          <span>{{ stackIndex + 1 }}</span>
          <span class="art-stack-sep">/</span>
          <span>{{ stack.length }}</span>
        </button>
      </div>

      <!-- ============ 音频 ============ -->
      <div v-else-if="kind === 'audio'" class="art-card" data-kind="audio" :data-drop="dropActive ? 'true' : 'false'">
        <div v-if="primary && mediaSrc" class="media-audio">
          <audio
            ref="audioEl"
            :src="mediaSrc"
            preload="metadata"
            @play="audioPlaying = true"
            @pause="audioPlaying = false"
            @ended="audioPlaying = false"
            @loadedmetadata="onAudioMeta"
            @timeupdate="onAudioTime"
            @error="imageFailed = true"
          />
          <div class="audio-top nodrag" @pointerdown.stop>
            <button
              class="audio-orb"
              type="button"
              :aria-label="audioPlaying ? i18n.t('board.node.pause') : i18n.t('board.node.play')"
              @click.stop="toggleAudio"
            >
              <component :is="audioPlaying ? PauseIcon : PlayIcon" />
            </button>
            <div class="audio-copy">
              <strong>{{ primary.name }}</strong>
              <span>{{ clockText(audioTime) }} / {{ clockText(audioDuration) }}</span>
            </div>
          </div>
          <div class="audio-wave nodrag" @pointerdown.stop @click.stop="seekAudio">
            <span
              v-for="(height, index) in audioBars"
              :key="index"
              :data-active="index / audioBars.length <= audioProgress ? 'true' : 'false'"
              :style="{ height: `${height}%` }"
            />
          </div>
        </div>

        <div v-else-if="isDisplay" class="art-empty art-empty-quiet">
          <SpeakerWaveIcon />
          <strong>{{ imageFailed ? i18n.t("board.node.brokenAudio") : i18n.t(upstreamConnected ? "board.node.waitingRun" : "board.node.waitingMedia") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t(upstreamConnected ? "board.node.waitingRunHint" : "board.node.waitingHint") }}</span>
        </div>

        <div v-else class="art-empty">
          <span class="art-empty-icon"><MusicalNoteIcon /></span>
          <strong>{{ imageFailed ? i18n.t("board.node.brokenAudio") : i18n.t("board.node.dropAudio") }}</strong>
          <span>{{ imageFailed ? i18n.t("board.node.brokenHint") : i18n.t("board.node.audioHint") }}</span>
          <div class="art-empty-actions">
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="pickFiles">
              <ArrowUpTrayIcon />
              {{ i18n.t("board.node.chooseFile") }}
            </button>
            <button class="art-empty-action" type="button" @pointerdown.stop @click.stop="openLibrary">
              <SpeakerWaveIcon />
              {{ i18n.t("board.inspect.pickAsset") }}
            </button>
          </div>
        </div>

        <button
          v-if="stack.length > 1 && primary"
          class="art-stack-pill art-stack-pill-top nodrag"
          type="button"
          :title="i18n.t('board.node.nextMedia')"
          :aria-label="i18n.t('board.node.nextMedia')"
          @pointerdown.stop
          @click.stop="stepStack(1)"
        >
          <span>{{ stackIndex + 1 }}</span>
          <span class="art-stack-sep">/</span>
          <span>{{ stack.length }}</span>
        </button>
      </div>

      <!-- ============ 文本输入：一个 MD3 filled 复写框 + 字符数页脚 ============ -->
      <div v-else-if="kind === 'text' && !isDisplay" class="node-text-card">
        <div class="node-text-field">
          <textarea
            class="node-textarea nodrag nowheel"
            :value="textValue"
            :placeholder="i18n.t('board.node.textPlaceholder')"
            spellcheck="false"
            @input="setText"
          />
        </div>
        <div class="node-text-foot">
          <span>{{ i18n.t("board.node.chars", { count: textValue.length }) }}</span>
          <span class="node-text-foot-actions">
            <button
              class="node-foot-btn nodrag"
              type="button"
              :title="i18n.t('board.node.copyText')"
              :aria-label="i18n.t('board.node.copyText')"
              @pointerdown.stop
              @click.stop="copyTextValue"
            >
              <DocumentDuplicateIcon />
            </button>
            <button
              class="node-foot-btn nodrag"
              type="button"
              :title="i18n.t('board.node.clearText')"
              :aria-label="i18n.t('board.node.clearText')"
              @pointerdown.stop
              @click.stop="clearText"
            >
              <XMarkIcon />
            </button>
          </span>
        </div>
      </div>

      <!-- ============ 文本显示：一个阅读面 ============ -->
      <div
        v-else-if="kind === 'text'"
        class="node-text-display nowheel"
        :data-streaming="status === 'running' || upstreamLiveText ? 'true' : 'false'"
      >
        <span class="node-text-grip" aria-hidden="true" />
        <span v-if="upstreamLiveText" class="node-stream-pill">
          <span class="node-stream-dot" aria-hidden="true" />
          {{ i18n.t("board.status.streaming") }}
        </span>
        <div
          v-if="textPreview && textMode === 'markdown'"
          class="node-markdown"
          v-html="textHtml"
        />
        <div v-else-if="textPreview" class="node-text-plain">{{ textPreview }}</div>
        <div v-else class="art-empty art-empty-quiet">
          <LinkIcon />
          <strong>{{ i18n.t(upstreamConnected ? "board.node.waitingRun" : "board.node.waitingMedia") }}</strong>
          <span>{{ i18n.t(upstreamConnected ? "board.node.waitingRunHint" : "board.node.waitingHint") }}</span>
        </div>
      </div>

      <!-- ============ 值节点：一条安静的表面，编辑器 / 值本身占满整张卡 ============ -->
      <div
        v-else-if="isValueNode"
        class="value-card"
        :data-kind="valuePreviewKind"
        :data-display="isValueDisplay ? 'true' : 'false'"
      >
        <div v-if="!isValueDisplay" class="value-input-body">
          <component
            :is="controlFor('core.value') ?? 'input'"
            v-if="valueSpec"
            :node="node"
            :spec="valueSpec"
            :value="paramRaw(valueSpec)"
            @update="setValueParam(valueSpec, $event)"
          />
        </div>
        <div
          v-else
          class="value-display-body"
          :data-long="valuePreviewText.length > 80 ? 'true' : undefined"
        >
          <span v-if="valuePreviewEmpty" class="value-display-empty">—</span>
          <span
            v-else-if="valuePreviewKind === 'boolean'"
            class="value-display-boolean"
            :data-value="valuePreviewText"
          >{{ valuePreviewText }}</span>
          <pre v-else-if="valuePreviewKind === 'json'" class="value-display-pre">{{ valuePreviewText }}</pre>
          <span v-else-if="valuePreviewKind === 'number'" class="value-display-number">{{ valuePreviewText }}</span>
          <span v-else class="value-display-text">{{ valuePreviewText }}</span>
        </div>
      </div>

      <!-- ============ 模型节点：表格卡（ai-board mn-card） ============ -->
      <!-- 工作流开始 / 结束 / 嵌入：卡片只列签名与目标，增删改在画布检查器里 -->
      <div v-else-if="isWorkflowNode" class="mn-card wf-card" :data-kind="kind" :data-status="status">
        <header class="wf-head">
          <span class="wf-icon"><component :is="nodeIcon(node?.type ?? '')" /></span>
          <div class="wf-heading">
            <strong class="wf-title">{{ title }}</strong>
            <span class="wf-subtitle">{{ workflowSubtitle }}</span>
          </div>
        </header>
        <div v-if="isWorkflowCall" class="wf-target">
          <span>{{ callTargetName || i18n.t("board.workflow.noTarget") }}</span>
        </div>
        <ul v-if="isWorkflowCall && callOutputs.length" class="wf-rows">
          <li v-for="row in callOutputs" :key="row.id" class="wf-row" data-bound="true">
            <span class="wf-row-key">{{ row.label }}</span>
            <span class="wf-row-type">{{ typeLabel(row.type) }}</span>
            <span class="wf-row-state">{{ i18n.t("board.inspect.published") }}</span>
          </li>
        </ul>
        <ul v-else class="wf-rows">
          <li v-for="row in workflowRows" :key="row.id" class="wf-row" :data-bound="row.bound ? 'true' : 'false'">
            <span class="wf-row-key">{{ row.label }}</span>
            <span class="wf-row-type">{{ typeLabel(row.type) }}</span>
            <span class="wf-row-state">
              {{ row.bound ? i18n.t("board.inspect.published") : i18n.t("board.inspect.outputReady") }}
            </span>
          </li>
        </ul>
        <footer class="wf-foot">
          <span>{{ workflowFoot }}</span>
        </footer>
      </div>

      <div v-else class="mn-card" :data-kind="kind" :data-status="status">
        <header class="mn-head">
          <span class="mn-icon" aria-hidden="true">
            <component :is="nodeIcon(node.type)" />
          </span>
          <div class="mn-heading">
            <strong class="mn-title" :title="title">{{ title }}</strong>
            <span class="mn-subtitle" :title="modelSubtitle">{{ modelSubtitle }}</span>
          </div>
          <span class="mn-status" :data-state="status" :title="statusLabel">
            <span class="mn-status-dot" aria-hidden="true" />
            {{ statusLabel }}
          </span>
        </header>

        <div class="mn-params nodrag nowheel" @pointerdown.stop>
          <label
            v-for="spec in modelParams"
            :key="spec.id"
            class="mn-field"
            :class="{ 'mn-field-short': spec.kind === 'number' || spec.kind === 'seed' || spec.kind === 'toggle' }"
          >
            <span class="mn-label">{{ i18n.t(spec.labelKey) }}</span>
            <component
              :is="controlFor(spec.control ?? '') ?? 'input'"
              v-if="spec.kind === 'component'"
              :node="node"
              :spec="spec"
              :value="paramValue(spec)"
              @update="setParam(spec, $event)"
            />
            <BoardSizeControl
              v-else-if="spec.kind === 'size'"
              :node="node"
              variant="card"
              @update="patchParams"
            />
            <textarea
              v-else-if="spec.kind === 'longtext'"
              class="mn-textarea"
              rows="2"
              :value="paramValue(spec)"
              :placeholder="
                spec.placeholderKey
                  ? i18n.t(spec.placeholderKey)
                  : i18n.t('board.node.promptPlaceholder')
              "
              @input="setParam(spec, ($event.target as HTMLTextAreaElement).value)"
            />
            <Md3Select
              v-else-if="spec.kind === 'select'"
              :model-value="paramValue(spec)"
              :options="paramOptions(spec)"
              :label="i18n.t(spec.labelKey)"
              :placeholder="spec.model || spec.llm ? i18n.t('board.inspect.pickModel') : '—'"
              :searchable="paramOptions(spec).length > 5"
              @select="setParam(spec, $event)"
              @action="openParamSettings(spec)"
            />
            <ToggleSwitch
              v-else-if="spec.kind === 'toggle'"
              class="mn-switch"
              :model-value="paramBool(spec)"
              :label="i18n.t(spec.labelKey)"
              @update:model-value="setParam(spec, $event)"
            />
            <NumberField
              v-else-if="spec.kind === 'number' || spec.kind === 'seed'"
              class="mn-number"
              :model-value="paramNumber(spec)"
              :min="spec.min ?? (spec.kind === 'seed' ? -1 : 0)"
              :max="spec.max ?? 2147483647"
              :step="spec.step ?? 1"
              :sr-label="i18n.t(spec.labelKey)"
              input-width="42px"
              @update:model-value="setParam(spec, $event)"
            />
            <input
              v-else
              class="mn-input"
              type="text"
              :value="paramValue(spec)"
              :placeholder="i18n.t('board.node.paramPlaceholder')"
              @change="setParam(spec, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <!-- 产物在卡片下方的输出附件卡里；卡片主体只留参数与运行状态。 -->
        <footer class="mn-foot">
          <span>{{ modelFoot }}</span>
          <span v-if="hasOutputDock">{{ i18n.t("board.node.hasOutput") }}</span>
        </footer>
      </div>

      <!-- 运行进度：沿节点圆角一圈生长的描边，有百分比时按百分比长，没有时一段弧沿边框跑 -->
      <svg
        v-if="status === 'running'"
        class="node-run-progress"
        :data-indeterminate="progress === null ? 'true' : 'false'"
        :style="{ '--node-progress': progress ?? 0 }"
        aria-hidden="true"
      >
        <rect pathLength="100" x="1" y="1" width="100%" height="100%" rx="21" ry="21" />
      </svg>
    </div>

    <!--
      输出附件：模型产物挂在卡片正下方，和卡片一样是一张带渐变底、圆角边框的卡
      （不再是透明底）。文本直接排在卡上；图片多张时按「牌堆」叠放，
      多音轨 / 视频音频分离用顶部缩略图切换。
    -->
    <div
      v-if="isModel && hasOutputDock && outputOpen"
      class="node-output-dock nodrag nowheel"
      :data-kind="outputKind"
      :data-media="activeOutput && outputKind === 'video' ? 'true' : 'false'"
      :data-running="status === 'running' ? 'true' : 'false'"
      @pointerdown.stop
      @click.stop
    >
      <div class="node-output" :data-tabs="showReasoningTab ? 'true' : 'false'">
        <!-- 文本模型：内容 / 思考过程两个浮层 tab -->
        <div v-if="showReasoningTab" class="node-output-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="dockTab === 'text'"
            :data-active="dockTab === 'text'"
            @click.stop="selectDockTab('text')"
          >
            <span>{{ i18n.t("board.node.contentTab") }}</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="dockTab === 'reasoning'"
            :data-active="dockTab === 'reasoning'"
            @click.stop="selectDockTab('reasoning')"
          >
            <span>{{ i18n.t("board.node.reasoningTab") }}</span>
            <em v-if="reasoningOutput.length">{{ reasoningOutput.length }}</em>
            <span v-if="status === 'running' && !textOutput" class="node-output-tab-dot" />
          </button>
        </div>

        <!-- 多图：牌堆 + 循环切换胶囊（和图片显示节点一致）；其它类型用缩略图条 -->
        <div v-if="outputAssets.length > 1 && outputKind === 'image'" class="node-output-deck" aria-hidden="true">
          <div
            v-for="(sheet, index) in outputDeck"
            :key="sheet.id"
            class="node-output-deck-sheet"
            :style="outputDeckStyle(sheet, index)"
          />
        </div>
        <button
          v-if="outputAssets.length > 1 && outputKind === 'image'"
          class="node-output-cycle nodrag"
          type="button"
          :title="i18n.t('board.node.nextOutput')"
          :aria-label="i18n.t('board.node.nextOutput')"
          @click.stop="cycleOutput"
        >
          <Square3Stack3DIcon />
          <span>{{ activeOutputIndex + 1 }} / {{ outputAssets.length }}</span>
        </button>

        <!-- 多输出（音轨 / 视频音频分离）：浮层缩略图切换 -->
        <div
          v-if="outputAssets.length > 1 && outputKind !== 'image'"
          class="node-output-strip"
          role="tablist"
          :aria-label="i18n.t('board.node.outputs')"
        >
          <button
            v-for="(asset, index) in outputAssets"
            :key="asset.id"
            type="button"
            role="tab"
            :aria-selected="index === activeOutputIndex"
            :aria-label="i18n.t('board.node.selectOutput', { index: index + 1 })"
            :title="outputLabel(asset)"
            :data-active="index === activeOutputIndex"
            @click.stop="selectOutput(asset)"
          >
            <img v-if="assetThumbnailUrl(asset)" :src="assetThumbnailUrl(asset) ?? ''" alt="" />
            <component v-else :is="asset.kind === 'audio' ? MusicalNoteIcon : FilmIcon" />
            <em>{{ index + 1 }}</em>
          </button>
        </div>
        <span v-if="outputAssets.length > 1 && outputKind !== 'image'" class="node-output-count">
          {{ activeOutputIndex + 1 }} / {{ outputAssets.length }}
        </span>

        <div class="node-output-body">
          <template v-if="outputKind === 'text'">
            <div v-if="dockTab === 'reasoning'" class="node-output-reasoning">
              <p v-if="reasoningOutput" class="node-output-reasoning-text">
                {{ reasoningOutput }}<span
                  v-if="status === 'running' && !textOutput"
                  class="node-output-caret"
                  aria-hidden="true"
                />
              </p>
              <div v-else class="node-output-waiting">
                <em>{{ i18n.t("board.status.thinking") }}</em>
              </div>
            </div>
            <div v-else class="node-output-text-wrap">
              <div
                v-if="textOutput"
                class="node-markdown node-output-text"
                v-html="textOutputHtml"
              />
              <div v-else class="node-output-waiting">
                <span class="node-output-shimmer" aria-hidden="true" />
                <span class="node-output-shimmer" aria-hidden="true" />
                <span class="node-output-shimmer" aria-hidden="true" />
                <em>{{ status === "running" ? i18n.t("board.status.thinking") : i18n.t("board.node.waitingRun") }}</em>
              </div>
              <span v-if="status === 'running'" class="node-output-caret" aria-hidden="true" />
            </div>
          </template>
          <template v-else-if="activeOutput && outputKind === 'image'">
            <img
              class="node-output-image"
              :src="outputMediaSrc"
              :alt="activeOutput.name"
              :title="outputMeta"
              :data-stack="outputAssets.length > 1 ? 'true' : 'false'"
              @click="cycleOutput"
            />
          </template>
          <template v-else-if="activeOutput && outputKind === 'video'">
            <!-- 和显示节点完全同一套播放条 / 首帧，且铺满附件卡（见 data-media 的样式）。 -->
            <BoardVideoPlayer
              class="node-output-player"
              :src="outputMediaSrc"
              :poster="outputPoster"
            />
          </template>
          <template v-else-if="activeOutput && outputKind === 'audio'">
            <audio class="node-output-audio" :src="outputMediaSrc" controls preload="metadata" />
          </template>
          <div v-else class="node-output-waiting">
            <span class="node-output-shimmer" aria-hidden="true" />
            <span class="node-output-shimmer" aria-hidden="true" />
            <span class="node-output-shimmer" aria-hidden="true" />
            <em>{{ status === "running" ? live?.message || statusLabel : i18n.t("board.node.waitingRun") }}</em>
          </div>
        </div>
      </div>
    </div>

    <!-- 收起 / 展开：贴在节点右下角，附件没有自己的顶栏 -->
    <button
      v-if="isModel && hasOutputDock"
      class="node-output-toggle nodrag"
      type="button"
      :data-open="outputOpen ? 'true' : 'false'"
      :title="i18n.t(outputOpen ? 'board.node.collapseOutput' : 'board.node.expandOutput')"
      :aria-label="i18n.t(outputOpen ? 'board.node.collapseOutput' : 'board.node.expandOutput')"
      @pointerdown.stop
      @click.stop="setDockOpen(!outputOpen)"
    >
      <component :is="outputOpen ? ChevronUpIcon : ChevronDownIcon" />
    </button>

    <!--
      端口：节点 UI 上永远只有**一进一出**两个锚点。
      多路输入（H3 的 9 图 / 3 音频 / 3 视频、多图参考）合并成同一个输入端口，
      具体接哪几个上游、分别接到哪个逻辑端口，全部在节点检查器里配置。
    -->
    <Handle
      v-if="ports.inputs.length > 0"
      id="in"
      type="target"
      :position="Position.Left"
      class="node-handle node-handle-in"
    />
    <Handle
      v-if="ports.outputs.length > 0"
      id="out"
      type="source"
      :position="Position.Right"
      class="node-handle node-handle-out"
    />

    <span
      v-if="kind !== 'group'"
      class="node-resize nodrag"
      :title="i18n.t('board.resize.hint')"
      @pointerdown="onResizeStart"
    />

    <BoardMediaPicker
      v-if="mediaKind"
      v-model:open="libraryOpen"
      :kind="mediaKind"
      :multiple="mediaKind !== null"
      @pick="onLibraryPick"
    />
  </div>
</template>

<style scoped>
/* ==========================================================================
   ai-board 节点外观逐项对齐：卡片几何、标签、悬停控制、艺术卡 / 文本 / 模型
   三种内容舞台，以及端口与缩放手柄。数值直接取自 ai-board 的 styles.css。
   ========================================================================== */

.board-node {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 20px;
  /* ai-board 的画布基字号是 13px；卡片内所有没写字号的文字都跟着它。 */
  font-size: 13px;
  line-height: 19.5px;
  color: rgb(var(--md-on-surface));
}
.node-surface {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  /* 牌堆纸片要露到卡片外，所以这里不能裁切；裁切由 art-card / art-stage 负责。 */
  overflow: visible;
}
.board-node[data-selected="true"] .node-surface::after {
  content: "";
  position: absolute;
  inset: -3px;
  z-index: 8;
  border: 1.5px solid rgb(var(--md-primary) / 0.9);
  border-radius: 23px;
  box-shadow: 0 0 0 4px rgb(var(--md-primary) / 0.1);
  pointer-events: none;
}
.board-node.ignored .node-surface {
  opacity: 0.55;
}

/* 多值牌堆胶囊：浮在卡片右上角，不挡内容。 */
.node-stack-bar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 7;
}

/* ============ 浮动标签 ============ */
.node-label {
  position: absolute;
  left: 4px;
  bottom: calc(100% + 8px);
  z-index: 6;
  max-width: calc(100% - 84px);
  height: 18px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--md-on-surface-variant));
  pointer-events: none;
  white-space: nowrap;
}
.node-label-mark {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: rgb(var(--md-surface-container-high) / 0.75);
  color: rgb(var(--md-on-surface-variant));
}
.node-label-mark :deep(svg) {
  width: 11px;
  height: 11px;
}
.node-label-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.node-label-type {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  opacity: 0.8;
}
.node-label-status {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: rgb(var(--md-outline));
  flex: 0 0 auto;
}
.node-label-status[data-state="queued"],
.node-label-status[data-state="running"] {
  background: #c4b5fd;
  animation: node-pulse 1.2s infinite;
}
.node-label-status[data-state="done"] {
  background: #4ade80;
}
.node-label-status[data-state="error"] {
  background: #f87171;
}
.node-label-status[data-state="skipped"] {
  background: rgb(var(--md-on-surface-muted));
  opacity: 0.6;
}
/* 运行计时 / 百分比：贴在状态点后面，运行结束用耗时；不占卡片内部空间。 */
.node-label-runtime {
  flex: 0 0 auto;
  padding: 0 5px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  background: rgb(var(--md-surface-container-high) / 0.7);
  color: rgb(var(--md-on-surface-muted));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-variant-numeric: tabular-nums;
}
.node-label-runtime[data-state="running"] {
  color: rgb(var(--md-primary));
  border-color: rgb(var(--md-primary) / 0.4);
}
.node-label-runtime[data-state="error"] {
  color: rgb(var(--md-error));
  border-color: rgb(var(--md-error) / 0.45);
}
.node-label-runtime[data-state="done"] {
  color: rgb(74 222 128);
}
.node-label-flag {
  flex: 0 0 auto;
  height: 15px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  font-size: 8px;
  font-weight: 700;
  color: rgb(251 191 36);
  background: rgb(251 191 36 / 0.16);
}
/* 旁路：紫色，和「禁用」的黄区分开。 */
.node-label-flag.bypass {
  color: rgb(196 181 253);
  background: rgb(139 92 246 / 0.22);
}
.node-label-flag.group {
  color: rgb(var(--md-on-surface-variant));
  background: rgb(var(--md-on-surface) / 0.1);
}
/* 被旁路的节点整体降一档亮度：它还画在画布上，但不参与这次运行。 */
.board-node.bypassed .node-surface {
  opacity: 0.72;
}

/* ============ 组节点：虚线框 + 标题条 ============ */
.board-node[data-kind="group"] {
  /* 组框只是背景，别抢走成员节点的点击；标题条 / 浮动标签 / 悬停控制自己恢复可点。 */
  pointer-events: none;
}
.board-node[data-kind="group"] .node-label,
.board-node[data-kind="group"] .node-hover-controls {
  pointer-events: auto;
}
/* 组框对齐 ai-board：没有标题条，只是一块很安静的虚线区域。 */
.group-frame {
  --group-accent: var(--md-primary);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgb(var(--group-accent) / 0.38);
  border-radius: 26px;
  background:
    radial-gradient(90% 60% at 20% 0%, rgb(var(--group-accent) / 0.07), transparent 65%),
    linear-gradient(160deg, rgb(var(--group-accent) / 0.045), transparent 55%);
  cursor: grab;
  user-select: none;
}
.group-frame:active {
  cursor: grabbing;
}
.group-frame[data-tone="blue"] {
  --group-accent: 96 165 250;
}
.group-frame[data-tone="green"] {
  --group-accent: 74 222 128;
}
.group-frame[data-tone="coral"] {
  --group-accent: 251 113 133;
}
.group-frame[data-tone="amber"] {
  --group-accent: 251 191 36;
}
.board-node[data-selected="true"] .group-frame {
  border-color: rgb(var(--group-accent) / 0.8);
  box-shadow:
    inset 0 0 0 1px rgb(var(--group-accent) / 0.14),
    0 0 0 3px rgb(var(--group-accent) / 0.1);
}
/* 定义缺失（插件没加载 / 被卸载）：一块安静的占位卡，别让节点凭空消失。 */
.node-unknown {
  position: absolute;
  inset: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 16px;
  border: 1px dashed rgb(var(--md-error) / 0.45);
  border-radius: 14px;
  text-align: center;
  color: rgb(var(--md-on-surface-muted));
  background: rgb(var(--md-error) / 0.05);
}
.node-unknown .art-empty-icon {
  background: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
  margin-bottom: 3px;
}
.node-unknown strong {
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  font-weight: 650;
}
.node-unknown > span:not(.art-empty-icon) {
  max-width: 240px;
  font-size: 9.5px;
  line-height: 1.45;
}
.node-unknown code {
  margin-top: 2px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  opacity: 0.75;
}
.group-empty {
  margin: 0;
  padding: 0 18px;
  text-align: center;
  font-size: 9.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
  pointer-events: none;
}
.board-node[data-compact="true"] .node-label-type,
.board-node[data-compact="true"] .node-label-flag {
  display: none;
}

/* 类型色：让画布一眼能分出输入 / 输出媒体（ai-board 的 type accents） */
.board-node[data-node-type*="text"] .node-label-mark {
  background: rgb(96 165 250 / 0.18);
  color: rgb(147 197 253);
}
.board-node[data-node-type*="image"] .node-label-mark {
  background: rgb(196 181 253 / 0.18);
  color: rgb(221 214 254);
}
.board-node[data-node-type*="video"] .node-label-mark {
  background: rgb(251 113 133 / 0.16);
  color: rgb(253 164 175);
}
.board-node[data-node-type*="audio"] .node-label-mark,
.board-node[data-node-type*="tts"] .node-label-mark,
.board-node[data-node-type*="asr"] .node-label-mark,
.board-node[data-node-type*="separate"] .node-label-mark {
  background: rgb(74 222 128 / 0.14);
  color: rgb(134 239 172);
}

@keyframes node-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

/* ============ 悬停控制（ai-board：标签行右侧 22px 圆钮） ============ */
.node-hover-controls {
  position: absolute;
  right: 2px;
  bottom: calc(100% + 4px);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-high) / 0.96);
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  box-shadow: var(--md-elevation-1);
  opacity: 0;
  transform: translateY(2px);
  pointer-events: none;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.board-node:hover .node-hover-controls,
.board-node[data-selected="true"] .node-hover-controls,
.board-node[data-status="running"] .node-hover-controls,
.node-hover-controls:focus-within {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.node-hover-controls button {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.node-hover-controls button :deep(svg) {
  width: 13px;
  height: 13px;
}
.node-hover-controls button[data-kind="run"] {
  color: rgb(var(--md-primary));
}
.node-hover-controls button[data-kind="stop"] {
  color: rgb(var(--md-error));
}
.node-hover-controls button:hover {
  background: rgb(var(--md-on-surface) / 0.08);
  color: rgb(var(--md-on-surface));
}
.node-hover-controls button[data-kind="delete"]:hover {
  color: rgb(var(--md-error));
}

/* ============ 艺术卡：图片 / 视频 / 音频 ============ */
.art-card {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  background: var(--node-surface-bg, linear-gradient(150deg, rgb(var(--node-card-top)), rgb(var(--node-card-bottom))));
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.38));
  box-shadow: var(--node-surface-shadow, inset 0 1px 0 rgb(255 255 255 / 0.1), 0 16px 38px rgb(0 0 0 / 0.24));
  overflow: visible;
}
.art-card[data-kind="video"] {
  background: var(--node-surface-bg-video, var(--node-surface-bg));
}
.art-card[data-kind="audio"] {
  background: var(--node-surface-bg-audio, var(--node-surface-bg));
}
.art-card[data-drop="true"] {
  border-color: rgb(var(--md-primary) / 0.85);
  box-shadow: 0 0 0 3px rgb(var(--md-primary) / 0.18), 0 18px 42px rgb(0 0 0 / 0.3);
}
.art-stage {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background-color: rgb(var(--md-surface-container-low) / 0.72);
  background-image:
    linear-gradient(45deg, rgb(var(--md-on-surface) / 0.035) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(var(--md-on-surface) / 0.035) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(var(--md-on-surface) / 0.035) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(var(--md-on-surface) / 0.035) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}
.art-stage img {
  width: 100%;
  height: 100%;
  display: block;
  /* 卡片高度跟随图片比例（mediaHeight），所以这里永远不裁图。 */
  object-fit: contain;
  -webkit-user-drag: none;
}
.art-deck {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.art-deck-sheet {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-size: cover;
  background-position: center;
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.28);
  opacity: 0.88;
}
.art-stack-pill {
  position: absolute;
  right: 11px;
  bottom: 11px;
  z-index: 4;
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 999px;
  background: rgb(12 9 16 / 0.58);
  color: #f6f1fa;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease;
}
.art-stack-pill:hover {
  background: rgb(12 9 16 / 0.8);
  border-color: rgb(255 255 255 / 0.35);
}
/* 视频 / 音频的翻页胶囊放右上，避开底部播放条与波形。 */
.art-stack-pill-top {
  top: 11px;
  bottom: auto;
}
.art-stack-sep {
  opacity: 0.5;
}

/* ============ 空态（ai-board 的 art-empty / art-empty-quiet） ============ */
.art-empty {
  position: absolute;
  inset: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 16px;
  border: 1px dashed rgb(var(--md-outline) / 0.45);
  border-radius: 14px;
  text-align: center;
  color: rgb(var(--md-on-surface-muted));
}
.art-empty-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: rgb(var(--md-primary-container) / 0.6);
  color: rgb(var(--md-on-primary-container));
  margin-bottom: 3px;
}
.art-empty-icon :deep(svg) {
  width: 20px;
  height: 20px;
}
.art-empty strong {
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  font-weight: 650;
}
.art-empty > span:not(.art-empty-icon) {
  max-width: 220px;
  font-size: 9.5px;
  line-height: 1.45;
}
.art-empty-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.art-empty-action {
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.55);
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest) / 0.55);
  color: rgb(var(--md-on-surface));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.art-empty-action:hover {
  background: rgb(var(--md-surface-container-highest));
}
.art-empty-action :deep(svg) {
  width: 12px;
  height: 12px;
}
.art-empty-quiet {
  border: 0;
  background: transparent;
}
.art-empty-quiet :deep(svg) {
  width: 23px;
  height: 23px;
  margin-bottom: 2px;
  opacity: 0.7;
}

/* ============ 视频：舞台（播放器见 BoardVideoPlayer.vue） ============ */
.media-video {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  overflow: hidden;
  background: rgb(8 6 12 / 0.92);
}

/* ============ 音频：波形 + 一个播放球 ============ */
.media-audio {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 15px 16px;
  border-radius: 18px;
  overflow: hidden;
}
.audio-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.audio-orb {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 999px;
  background: radial-gradient(circle at 35% 25%, rgb(var(--md-primary) / 0.9), rgb(var(--md-primary) / 0.45));
  color: rgb(var(--md-on-primary));
  display: grid;
  place-items: center;
  box-shadow: 0 6px 18px rgb(var(--md-primary) / 0.22);
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.audio-orb:hover {
  transform: scale(1.04);
}
.audio-orb :deep(svg) {
  width: 18px;
  height: 18px;
  margin-left: 1px;
}
.audio-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.audio-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 650;
  color: rgb(var(--md-on-surface));
}
.audio-copy span {
  color: rgb(var(--md-on-surface-muted));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
}
.audio-wave {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 1px;
  cursor: pointer;
}
.audio-wave span {
  flex: 1 1 0;
  min-width: 1px;
  max-width: 5px;
  border-radius: 999px;
  background: rgb(var(--md-primary) / 0.38);
  transition: background-color 0.1s linear;
}
.audio-wave span[data-active="true"] {
  background: linear-gradient(to top, rgb(var(--md-primary) / 0.5), rgb(var(--md-primary)));
}

/* ============ 文本输入：filled field + 字符数页脚 ============ */
.node-text-card {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  overflow: hidden;
  padding: 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--node-surface-bg-text, var(--node-surface-bg));
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.4));
  box-shadow: var(--node-surface-shadow, 0 16px 38px rgb(0 0 0 / 0.24));
  color: rgb(var(--md-on-surface));
}
.node-text-field {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  border-radius: 16px;
  background: rgb(var(--md-on-surface) / 0.075);
  padding: 12px 14px;
  transition: background-color 0.14s ease;
}
.node-text-field:hover {
  background: rgb(var(--md-on-surface) / 0.095);
}
.node-text-field:focus-within {
  background: rgb(var(--md-on-surface) / 0.11);
}
.node-textarea {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.62;
  letter-spacing: 0.005em;
}
.node-textarea::placeholder {
  color: rgb(var(--md-on-surface-muted) / 0.7);
}
.node-text-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 7px 4px 1px;
  color: rgb(var(--md-on-surface-muted));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.08em;
}
.node-text-foot-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  opacity: 0.7;
}
.node-text-foot:hover .node-text-foot-actions {
  opacity: 1;
}
.node-foot-btn {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.node-foot-btn:hover {
  background: rgb(var(--md-on-surface) / 0.1);
  color: rgb(var(--md-on-surface));
}
.node-foot-btn :deep(svg) {
  width: 11px;
  height: 11px;
}

/* ============ 文本显示：一个阅读面 ============ */
.node-text-display {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 18px 12px;
  border-radius: 20px;
  /* 整张卡就是拖动面：卡上不能再有 `nodrag`，也不做文字选中，
     否则从正文起手只会选中文字、拖不动节点。要复制走悬停控制里的复制按钮。 */
  user-select: none;
  -webkit-user-select: none;
  /* 让整张显示卡就是滚动容器：滚轮落在内边距 / 空白处也能滚，而不是只有正文区域生效。 */
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  background: var(--node-surface-bg, linear-gradient(155deg, rgb(var(--node-card-top)), rgb(var(--node-card-bottom))));
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.4));
  box-shadow: var(--node-surface-shadow, 0 14px 34px rgb(0 0 0 / 0.22));
}
.node-text-grip {
  position: absolute;
  top: 7px;
  left: 50%;
  width: 22px;
  height: 6px;
  transform: translateX(-50%);
  border-radius: 999px;
  background-image: radial-gradient(circle, rgb(var(--md-on-surface-muted) / 0.65) 1px, transparent 1.35px);
  background-size: 5px 5px;
  background-position: center;
  opacity: 0.5;
  transition: opacity 0.14s ease;
}
.node-text-display:hover .node-text-grip {
  opacity: 0.95;
}
/* 上游正在流式输出：显示节点右上角挂一个实时胶囊（对齐 ai-board）。 */
.node-stream-pill {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 2;
  height: 18px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-primary) / 0.4);
  background: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-weight: 600;
  pointer-events: none;
}
.node-stream-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: node-pulse 1s ease-in-out infinite;
}
.node-markdown,
.node-text-plain {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 4px 2px 10px;
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  font-weight: 450;
  line-height: 1.68;
  letter-spacing: 0.002em;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}
.node-markdown::-webkit-scrollbar,
.node-text-plain::-webkit-scrollbar {
  width: 6px;
}
.node-markdown::-webkit-scrollbar-thumb,
.node-text-plain::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgb(var(--md-outline) / 0.5);
}
/* 纯文本：保留换行与缩进，但不解析任何 Markdown 语法。 */
.node-text-plain {
  white-space: pre-wrap;
}
/* Markdown：字号都用 em，节点卡片和「文本输出」小窗共用同一套样式也不会失真。 */
.node-markdown {
  white-space: normal;
}
.node-markdown :deep(h1),
.node-markdown :deep(h2),
.node-markdown :deep(h3),
.node-markdown :deep(h4),
.node-markdown :deep(h5),
.node-markdown :deep(h6) {
  margin: 0.6em 0 0.35em;
  font-weight: 700;
  line-height: 1.3;
}
.node-markdown :deep(h1) {
  margin-top: 0.2em;
  font-size: 1.55em;
}
.node-markdown :deep(h2) {
  font-size: 1.32em;
}
.node-markdown :deep(h3) {
  font-size: 1.14em;
}
.node-markdown :deep(h4) {
  font-size: 1em;
}
.node-markdown :deep(h5),
.node-markdown :deep(h6) {
  font-size: 0.92em;
  color: rgb(var(--md-on-surface-variant));
}
.node-markdown :deep(p) {
  margin: 0.45em 0;
}
.node-markdown :deep(ul),
.node-markdown :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.node-markdown :deep(li) {
  margin: 0.15em 0;
}
.node-markdown :deep(li > p) {
  margin: 0;
}
.node-markdown :deep(strong) {
  font-weight: 650;
}
.node-markdown :deep(em) {
  font-style: italic;
}
.node-markdown :deep(a) {
  color: rgb(var(--md-primary));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.node-markdown :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.15em 0.75em;
  border-left: 3px solid rgb(var(--md-primary) / 0.45);
  color: rgb(var(--md-on-surface-variant));
}
.node-markdown :deep(hr) {
  margin: 0.8em 0;
  border: 0;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.45);
}
.node-markdown :deep(code) {
  padding: 0 3px;
  border-radius: 4px;
  background: rgb(var(--md-on-surface-variant) / 0.16);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.88em;
}
.node-markdown :deep(pre) {
  margin: 0.5em 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background: rgb(var(--md-surface-container-lowest) / 0.55);
}
.node-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.86em;
}
.node-markdown :deep(table) {
  width: 100%;
  margin: 0.5em 0;
  border-collapse: collapse;
  font-size: 0.94em;
}
.node-markdown :deep(th),
.node-markdown :deep(td) {
  padding: 4px 8px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  text-align: left;
}
.node-markdown :deep(th) {
  background: rgb(var(--md-on-surface) / 0.06);
  font-weight: 650;
}
.node-markdown :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}
.node-text-display .node-markdown,
.node-text-display .node-text-plain {
  flex: 0 0 auto;
  overflow: visible;
}
.node-text-display .art-empty {
  inset: 0;
}

/* ============ 模型节点：ai-board 的 mn-card ============ */
.mn-card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.42));
  background: var(--node-surface-bg, linear-gradient(152deg, rgb(var(--node-card-top)), rgb(var(--node-card-bottom))));
  box-shadow: var(--node-surface-shadow, inset 0 1px rgb(255 255 255 / 0.06), 0 12px 30px rgb(0 0 0 / 0.19));
  color: rgb(var(--md-on-surface));
  transition: border-color 0.18s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.18s cubic-bezier(0.2, 0, 0, 1);
}
/* 模型卡片也按能力给渐变：视频偏 tertiary、语音偏 primary、文本走文本卡配色。 */
.board-node[data-node-type="model.video"] .mn-card {
  background: var(--node-surface-bg-video, var(--node-surface-bg));
}
.board-node[data-node-type="model.text"] .mn-card {
  background: var(--node-surface-bg-text, var(--node-surface-bg));
}
.board-node[data-node-type="model.tts"] .mn-card,
.board-node[data-node-type="model.asr"] .mn-card,
.board-node[data-node-type="model.separate"] .mn-card {
  background: var(--node-surface-bg-audio, var(--node-surface-bg));
}
.mn-card[data-status="running"] {
  border-color: rgb(var(--md-primary) / 0.38);
}
.mn-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.mn-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(var(--md-primary-container) / 0.62);
  color: rgb(var(--md-on-primary-container));
}
.mn-icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.mn-heading {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mn-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.mn-subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: rgb(var(--md-on-surface-muted));
}
.mn-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest) / 0.6);
  color: rgb(var(--md-on-surface-variant));
  font-size: 9.5px;
  font-weight: 600;
  white-space: nowrap;
}
.mn-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.75;
}
.mn-status[data-state="running"] {
  background: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.mn-status[data-state="running"] .mn-status-dot {
  opacity: 1;
  animation: node-pulse 1.2s ease-in-out infinite;
}
.mn-status[data-state="done"] {
  background: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.mn-status[data-state="done"] .mn-status-dot {
  background: #4caf72;
  opacity: 1;
}
.mn-status[data-state="error"] {
  background: rgb(var(--md-error-container) / 0.6);
  color: rgb(var(--md-on-error-container));
}
.mn-status[data-state="error"] .mn-status-dot {
  background: rgb(var(--md-error));
  opacity: 1;
}
.mn-params {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-content: start;
  gap: 6px;
  padding-right: 2px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.mn-params::-webkit-scrollbar {
  width: 4px;
}
/* ============ 值节点：一条安静的表面，编辑器 / 值本身占满整张卡 ============ */
.value-card {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.42));
  color: rgb(var(--md-on-surface));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    0 14px 34px rgb(0 0 0 / 0.22);
}

.value-card[data-display="false"] {
  padding: 12px;
  background:
    radial-gradient(120% 80% at 12% 0%, rgb(var(--md-primary) / 0.16), transparent 60%),
    linear-gradient(
      148deg,
      rgb(var(--md-primary-container) / 0.44),
      rgb(var(--node-card-top) / 0.95) 52%,
      rgb(var(--node-card-bottom) / 0.96)
    );
}

.value-card[data-display="true"] {
  align-items: center;
  justify-content: center;
  padding: 20px 18px;
  background:
    radial-gradient(110% 80% at 0% 0%, rgb(var(--md-primary) / 0.1), transparent 58%),
    linear-gradient(155deg, rgb(var(--node-card-top) / 0.97), rgb(var(--node-card-bottom) / 0.96));
}

.value-input-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border-radius: 16px;
  background: rgb(var(--md-on-surface) / 0.07);
  transition: background-color 160ms var(--md-ease-emphasized, ease);
}

.value-input-body:hover {
  background: rgb(var(--md-on-surface) / 0.09);
}

.value-input-body:focus-within {
  background: rgb(var(--md-on-surface) / 0.105);
}

.value-display-body {
  width: 100%;
  max-height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  text-align: center;
}

.value-display-empty {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 22px;
  line-height: 1;
  color: rgb(var(--md-on-surface-muted) / 0.45);
}

.value-display-number {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.04;
  overflow-wrap: anywhere;
}

.value-display-text {
  display: block;
  max-width: 30ch;
  color: rgb(var(--md-on-surface));
  font-size: 15px;
  font-weight: 500;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.value-display-body[data-long="true"] .value-display-text {
  text-align: left;
  font-size: 13px;
  font-weight: 450;
}

.value-display-boolean {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
  font-size: 13px;
  font-weight: 650;
}

.value-display-boolean[data-value="true"] {
  background: rgb(52 211 153 / 0.14);
  color: #34d399;
}

.value-display-pre {
  margin: 0;
  max-width: 100%;
  max-height: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgb(var(--md-surface-container-lowest) / 0.38);
  color: rgb(var(--md-on-surface));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.6;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.mn-params::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgb(var(--md-outline) / 0.4);
}
.mn-field {
  min-width: 0;
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
/* 数字 / 开关两两并排，和 ai-board 模型卡的字段节奏一致。 */
.mn-field-short {
  grid-column: span 1;
}
.mn-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.015em;
  color: rgb(var(--md-on-surface-variant));
}
.mn-textarea {
  min-height: 58px;
  max-height: 110px;
  padding: 8px 10px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  background: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  outline: none;
}
.mn-textarea:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.mn-input {
  height: 34px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  background: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font: inherit;
  font-size: 12px;
  outline: none;
}
.mn-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
/* 下拉 / 数字步进器直接用 Md3Select、NumberField 的标准 MD3 外观（药丸两端、34px），
   不再在卡片里压成 30px 方角——节点上的控件和其他界面保持一致。 */
.mn-card :deep(.md3-select-root) {
  width: 100%;
}
/* 数字步进器撑满字段：NumberField 是 inline-flex，不显式给宽度就只占内容宽度，
   看起来像「只占半截」（节点卡片和检查器都要这一条）。 */
.mn-field :deep(.step) {
  width: 100%;
  justify-content: space-between;
}
.mn-field :deep(.step-input) {
  flex: 1 1 auto;
}

/* ============ 输出附件（无边框 / 无顶栏，内容铺满） ============ */
.node-output-dock {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 40;
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border-radius: 16px;
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.4));
  background: var(--node-surface-bg, linear-gradient(150deg, rgb(var(--node-card-top)), rgb(var(--node-card-bottom))));
  box-shadow: var(--node-surface-shadow, 0 16px 34px rgb(0 0 0 / 0.22));
  animation: node-dock-in 170ms cubic-bezier(0.2, 0, 0, 1);
}
.node-output-dock[data-kind="video"] {
  background: var(--node-surface-bg-video, var(--node-surface-bg));
}
/* 视频产物：和显示节点一样整块铺满——不再留 8px 内边距（那就是用户看到的那圈
   「边缘」），圆角交给附件卡自己裁，播放器直接顶到卡片边沿。 */
.node-output-dock[data-media="true"] {
  padding: 0;
  overflow: hidden;
}
.node-output-dock[data-media="true"] .node-output {
  max-height: none;
  border-radius: 15px;
}
.node-output-dock[data-media="true"] .node-output-body {
  overflow: hidden;
}
.node-output-dock[data-media="true"] .node-output-player {
  display: block;
  width: 100%;
}
.node-output-dock[data-kind="audio"] {
  background: var(--node-surface-bg-audio, var(--node-surface-bg));
}
.node-output {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(560px, 78vh);
  /* 背景 / 边框统一由外层的 dock 画，内容铺满卡片内边距。 */
  background: transparent;
  border: 0;
  box-shadow: none;
  border-radius: 12px;
  overflow: visible;
}
/* 文本：tab 浮在内容上，正文留出顶部让位。 */
.node-output[data-tabs="true"] .node-output-body {
  padding-top: 34px;
}
/* 文本附件：和节点一样的不透明渐变底（深色 / 浅色都跟着主题走），不再透出画布。 */
.node-output-dock[data-kind="text"] {
  background: var(--node-surface-bg-text, var(--node-surface-bg));
}
.node-output-dock[data-kind="text"] .node-output {
  padding: 2px 8px 8px;
}
/* 文本模型：内容 / 思考过程两个浮层 tab。 */
.node-output-tabs {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: rgb(12 9 16 / 0.48);
  border: 1px solid rgb(255 255 255 / 0.12);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
}
.node-output-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(246 241 250 / 0.72);
  font-family: inherit;
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
}
.node-output-tabs button:hover {
  background: rgb(255 255 255 / 0.08);
  color: #f6f1fa;
}
.node-output-tabs button[data-active="true"] {
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.node-output-tabs button em {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-style: normal;
  opacity: 0.65;
}
.node-output-tab-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: node-pulse 1s ease-in-out infinite;
}
/* 多输出：浮层缩略图 + 计数；内容铺满整宽，不被工具条占位。 */
.node-output-strip {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 76px);
  padding: 3px;
  border-radius: 12px;
  background: rgb(12 9 16 / 0.48);
  border: 1px solid rgb(255 255 255 / 0.12);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  overflow-x: auto;
  scrollbar-width: none;
}
.node-output-strip button {
  position: relative;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--md-surface-container-lowest) / 0.4);
  color: rgb(246 241 250 / 0.8);
  cursor: pointer;
}
.node-output-strip button[data-active="true"] {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-primary) / 0.5);
}
.node-output-strip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.node-output-strip button :deep(svg) {
  width: 16px;
  height: 16px;
}
.node-output-strip em {
  position: absolute;
  right: 2px;
  bottom: 1px;
  padding: 0 3px;
  border-radius: 999px;
  background: rgb(12 9 16 / 0.66);
  color: #f6f1fa;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 7px;
  font-style: normal;
  line-height: 12px;
}
.node-output-count {
  position: absolute;
  top: 10px;
  right: 8px;
  z-index: 6;
  height: 18px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgb(12 9 16 / 0.5);
  border: 1px solid rgb(255 255 255 / 0.12);
  color: rgb(246 241 250 / 0.82);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.node-output-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: auto;
  scrollbar-width: thin;
}
/* 文本正文：铺满附件宽度，只有可读性需要的左右内边距。 */
.node-output-text {
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(460px, 68vh);
  padding: 0 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  font-size: 12px;
  line-height: 1.66;
  white-space: normal;
}
.node-output-text-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 流式光标 */
.node-output-caret {
  display: inline-block;
  width: 6px;
  height: 13px;
  margin: 2px 0 0 2px;
  align-self: flex-start;
  border-radius: 2px;
  background: rgb(var(--md-primary));
  animation: node-output-blink 1s steps(2, start) infinite;
}
@keyframes node-output-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .node-output-caret {
    animation: none;
  }
}
/* 思考过程：等宽、弱化、可滚。 */
.node-output-reasoning {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.node-output-reasoning-text {
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(460px, 68vh);
  margin: 0;
  padding: 0 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: rgb(var(--md-on-surface-variant));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  line-height: 1.7;
}
/* 运行中 / 等待：三条 shimmer 占位 */
.node-output-waiting {
  flex: 1 1 auto;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px 4px;
  border-radius: 12px;
  background: rgb(var(--md-surface-container-lowest) / 0.32);
  overflow: hidden;
}
.node-output-shimmer {
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgb(var(--md-surface-container-highest) / 0.4),
    rgb(var(--md-primary) / 0.28),
    rgb(var(--md-surface-container-highest) / 0.4)
  );
  background-size: 200% 100%;
  animation: node-output-shimmer 1.4s ease-in-out infinite;
}
.node-output-shimmer:nth-child(1) {
  width: 72%;
}
.node-output-shimmer:nth-child(2) {
  width: 48%;
  animation-delay: 0.12s;
}
.node-output-shimmer:nth-child(3) {
  width: 60%;
  animation-delay: 0.24s;
}
.node-output-waiting em {
  margin-top: 4px;
  font-style: normal;
  font-size: 9.5px;
  color: rgb(var(--md-on-surface-muted));
}
@keyframes node-output-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
/* 图片 / 视频 / 音频：直接铺满附件宽度，不套边框卡片。 */
.node-output-image {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(560px, 76vh);
  object-fit: contain;
  border-radius: 12px;
  background: transparent;
}
.node-output-image[data-stack="true"] {
  cursor: pointer;
}
/* 多图输出：背后叠几张纸片（和图片显示节点的牌堆一致）。 */
.node-output-deck {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: visible;
}
.node-output-deck-sheet {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  background-size: cover;
  background-position: center;
  box-shadow: 0 10px 22px rgb(0 0 0 / 0.22);
  opacity: 0.92;
}
/* 循环切换胶囊：贴在图片卡右下角。 */
.node-output-cycle {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 7;
  height: 22px;
  padding: 0 8px 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / 0.18);
  background: rgb(12 9 16 / 0.55);
  color: #f6f1fa;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
}
.node-output-cycle :deep(svg) {
  width: 12px;
  height: 12px;
}
.node-output-cycle:hover {
  background: rgb(12 9 16 / 0.72);
}
.node-output-audio {
  display: block;
  width: 100%;
  height: 40px;
  margin: 6px 0 2px;
}
/* 收起 / 展开：贴在节点右下角，附件没有自己的顶栏。 */
.node-output-toggle {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 12;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgb(var(--md-primary) / 0.38);
  border-radius: 999px;
  background: rgb(var(--md-surface-container-high) / 0.88);
  color: rgb(var(--md-primary));
  box-shadow: var(--md-elevation-2);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: background-color 0.14s ease, transform 0.14s ease;
}
.node-output-toggle:hover {
  background: rgb(var(--md-primary) / 0.16);
  transform: scale(1.06);
}
.node-output-toggle[data-open="true"] {
  background: rgb(var(--md-primary) / 0.16);
}
.node-output-toggle :deep(svg) {
  width: 15px;
  height: 15px;
}
@keyframes node-dock-in {
  from {
    opacity: 0;
    transform: translateY(-5px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .node-output-dock {
    animation: none;
  }
  .node-output-shimmer {
    animation: none;
  }
}

/* ============ 错误 / 进度 ============ */
.node-error {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 10;
  /* 右侧给节点右下角的收起 / 展开钮留位。 */
  padding: 7px 40px 7px 9px;
  border-radius: 9px;
  background: rgb(var(--md-error) / 0.9);
  color: rgb(var(--md-on-error));
  font-size: 9.5px;
  line-height: 1.4;
}
.node-run-progress {
  position: absolute;
  inset: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  overflow: visible;
  pointer-events: none;
  z-index: 7;
  fill: none;
}
.node-run-progress rect {
  x: 1px;
  y: 1px;
  width: calc(100% - 2px);
  height: calc(100% - 2px);
  rx: 21px;
  ry: 21px;
  fill: none;
  stroke: rgb(var(--md-primary));
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 100;
  /* pathLength=100：0 表示空，100 表示整圈；进度直接换算成描边长度。 */
  stroke-dashoffset: calc(100 - var(--node-progress, 0) * 100);
  transition: stroke-dashoffset 0.2s linear;
  filter: drop-shadow(0 0 5px rgb(var(--md-primary) / 0.5));
}
/* 没有百分比（文本流 / 云端排队）：一段 18% 的弧沿圆角边框跑，而不是整圈方框转。 */
.node-run-progress[data-indeterminate="true"] rect {
  stroke-dasharray: 18 82;
  animation: node-ring-travel 1.25s linear infinite;
}
@keyframes node-ring-travel {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .node-run-progress[data-indeterminate="true"] rect {
    animation: none;
    stroke-dashoffset: 64;
  }
}

/* ============ 端口（悬停 / 选中才出现） ============ */
.node-handle {
  width: 12px;
  height: 12px;
  border: 2px solid rgb(var(--md-surface-container-lowest));
  border-radius: 999px;
  background: rgb(var(--md-primary));
  box-shadow:
    0 0 0 1px rgb(var(--md-primary) / 0.55),
    0 0 14px rgb(var(--md-primary) / 0.45);
  opacity: 0;
  transition: opacity 0.14s ease, transform 0.14s ease;
  z-index: 9;
}
.board-node:hover .node-handle,
.board-node[data-selected="true"] .node-handle {
  opacity: 1;
}
/* 悬停放大的 transform 必须**保留** Vue Flow 的左右平移（±50%），否则端口会
   朝卡片里跳半个宽度，指针随即离开 → 反复进出 → 看起来像抽搐。 */
.board-node .node-handle-in:hover {
  transform: translate(-50%, -50%) scale(1.18);
}
.board-node .node-handle-out:hover {
  transform: translate(50%, -50%) scale(1.18);
}
/* ============ 缩放手柄（ai-board 的 8 个圆点，这里保留右下角一个） ============ */
.node-resize {
  position: absolute;
  right: -5px;
  bottom: -5px;
  z-index: 12;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-surface-container-lowest));
  background: rgb(var(--md-primary));
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.board-node:hover .node-resize,
.board-node[data-selected="true"] .node-resize {
  opacity: 1;
}

/* ---------------- 工作流节点卡片 ----------------
   卡面样式直接复用 `.mn-card`（渐变底 / 描边 / 圆角 / 阴影），这里只补布局。
   新增颜色一律用 main.css 里真实存在的 MD3 token，别再发明 `--surface-*`。 */
.wf-card {
  gap: 8px;
}

.wf-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.wf-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(var(--md-primary-container) / 0.62);
  color: rgb(var(--md-on-primary-container));
}

.wf-icon svg {
  width: 16px;
  height: 16px;
}

.wf-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.wf-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-subtitle {
  font-size: 10px;
  line-height: 14px;
  color: rgb(var(--md-on-surface-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-target {
  flex: 0 0 auto;
  padding: 5px 9px;
  border-radius: 9px;
  background: rgb(var(--md-surface-container-high) / 0.66);
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.wf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 7px;
  background: rgb(var(--md-surface-container-high) / 0.55);
}

.wf-row-key {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-row-type {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest) / 0.8);
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}

.wf-row-state {
  flex: none;
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}

.wf-row[data-bound="true"] .wf-row-state {
  color: rgb(var(--md-tertiary));
}

.wf-foot {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}

</style>
