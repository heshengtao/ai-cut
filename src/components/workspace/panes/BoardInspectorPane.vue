<script setup lang="ts">
/**
 * 画布检查器（版式逐项复刻 ai-board 的 `InspectorPanel`）。
 *
 * 顺序固定为：节点标题卡 → 输入参数卡（连线状态）→ 输出卡（发布状态 / 预览）
 * → 标题字段 → 节点自己的设定（参数 / 素材）→ 操作 → 次级动作。
 *
 * 素材选择走 MD3 对话框（`BoardMediaPicker`），不再用下拉菜单；图片输入可以
 * 多张（牌堆），视频 / 音频单张。显示节点只读展示上游发布的输出。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  LinkIcon,
  MusicalNoteIcon,
  PhotoIcon,
  PlayIcon,
  PlusIcon,
  Square3Stack3DIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { controlFor } from "@/core/plugins/controls";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import BoardMediaPicker from "@/components/board/BoardMediaPicker.vue";
import BoardSizeControl from "@/components/board/BoardSizeControl.vue";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore, type SettingsSection } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useBoardRun } from "@/composables/useBoardRun";
import { LLM_VALUE_SEP, useBoardLlm } from "@/composables/useBoardLlm";
import { useAssetDownload } from "@/composables/useAssetDownload";
import {
  boardRegistryRevision,
  nodeDefinition,
  portsOf,
  publishedAssetId,
  visibleParams,
} from "@/core/board/registry";
import { BOARD_GROUP_TONES } from "@/types/board";
import { portsCompatible } from "@/core/board/schema";
import { ancestorIds } from "@/core/board/graph";
import { nodeIcon } from "@/components/board/nodeIcons";
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import {
  boardCloudAsrProviders,
  boardCloudProviders,
  boardCloudTtsProviders,
} from "@/composables/useBoardCloudOptions";
import { useBoardPortContext } from "@/composables/useBoardPortContext";
import { providersForNodeCapability } from "@/utils/cloudGen";
import { fileUrl, importAssetAt, pickMediaFiles } from "@/core/media";
import { addAsset } from "@/core/ops";
import { insertImportedAssets } from "@/core/importInsert";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { copyText } from "@/utils/clipboard";
import { toast } from "@/composables/useToast";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { CloudAsrProvider, CloudTtsProvider } from "@/types/models";
import type { ModelFeature } from "@/types/models";
import type {
  BoardGroupTone,
  BoardNode,
  BoardParamSpec,
  BoardPortSpec,
  BoardPortType,
} from "@/types/board";
import type { MediaAsset } from "@/types/project";

const i18n = useI18n();
const board = useBoardStore();
const project = useProjectStore();
const playback = usePlaybackStore();
const layout = useLayoutStore();
const models = useModelsStore();
const run = useBoardRun();
const { download } = useAssetDownload();

const cloudProviders = ref<CloudGenProvider[]>([]);
const cloudPresets = ref<CloudGenPreset[]>([]);
const pickerOpen = ref(false);

const node = computed(() => board.nodes.find((item) => item.id === board.selection[0]) ?? null);
const definition = computed(() => {
  // 插件异步注册节点：读版本号让检查器在插件装好后自动补上参数表单。
  void boardRegistryRevision();
  return node.value ? nodeDefinition(node.value.type) : null;
});

/** 节点标题：用户改过就用用户的，否则用定义的 i18n 标题。 */
function displayTitleOf(item: BoardNode): string {
  if (item.data.title) return item.data.title;
  const spec = nodeDefinition(item.type);
  return spec ? i18n.t(spec.titleKey) : item.type;
}

const title = computed(() => (node.value ? displayTitleOf(node.value) : ""));
/** 动态端口上下文（多图参考 / H3 / 分轨）。 */
const portContext = useBoardPortContext();
const isImageNode = computed(() => definition.value?.assetKind === "image");
const isDisplayNode = computed(() => definition.value?.category === "display");
const mediaKind = computed(() => definition.value?.assetKind ?? null);

/** 图片牌堆（图片输入可放多张）。 */
const stack = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids = current.data.assetIds ?? (current.data.assetId ? [current.data.assetId] : []);
  return ids
    .map((id) => project.doc.assets.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset));
});
const stackIndex = computed(() =>
  Math.min(Math.max(0, node.value?.data.stackIndex ?? 0), Math.max(0, stack.value.length - 1)),
);

/** 显示节点展示的是"上次运行发布的输出"，不再实时追上游。 */
const displayAsset = computed<MediaAsset | null>(() => {
  const current = node.value;
  if (!current || !isDisplayNode.value) return null;
  const id = current.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
const asset = computed(() => {
  const current = node.value;
  if (!current) return null;
  if (isDisplayNode.value) return displayAsset.value;
  if (isImageNode.value) return stack.value[stackIndex.value] ?? null;
  const id = current.data.assetId ?? current.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
const outputAsset = computed(() => {
  if (isDisplayNode.value) return displayAsset.value;
  const id = node.value?.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
const params = computed<BoardParamSpec[]>(() =>
  visibleParams(definition.value, node.value?.data.params ?? {}),
);

/** 循环结束节点：输入数量不在参数区改，走输入区的「新建输入」。 */
const isLoopEnd = computed(() => node.value?.type === "loop.end");
const nodeParams = computed(() =>
  params.value.filter((spec) => !(isLoopEnd.value && spec.id === "slots")),
);
const loopInputRows = computed(() => {
  const current = node.value;
  if (!current || current.type !== "loop.end") return [];
  const slots = Math.max(1, Math.min(8, Number(current.data.params.slots) || 1));
  return Array.from({ length: slots }, (_, index) => {
    const portId = `in${index + 1}`;
    const edge = board.edges.find(
      (item) => item.target === current.id && item.targetPort === portId,
    );
    const source = edge ? board.nodes.find((item) => item.id === edge.source) : null;
    return {
      portId,
      index: index + 1,
      source: source ? displayTitleOf(source) : null,
    };
  });
});

function addLoopInput(): void {
  const current = node.value;
  if (!current || current.type !== "loop.end") return;
  const slots = Math.max(1, Number(current.data.params.slots) || 1);
  board.setLoopInputCount(current.id, slots + 1);
}

function removeLoopInput(index: number): void {
  const current = node.value;
  if (!current || current.type !== "loop.end") return;
  board.removeLoopInputAt(current.id, index);
}

/** 输入 / 显示 / 循环这类节点的多个输出是「一包值」，连线不用选端口。 */
const isBundleOutputNode = computed(() => {
  const type = node.value?.type ?? "";
  return (
    type.startsWith("input.") ||
    type.startsWith("display.") ||
    type.startsWith("loop.")
  );
});

/** 端口显示名（同类型多路输入已经合并成一个端口，直接用端口标签）。 */
function portLabel(port: BoardPortSpec): string {
  return i18n.t(port.labelKey);
}

/** 一个输入端口 + 它当前接的上游列表（顺序 = 运行时读取顺序）。 */
interface InputEntry {
  edgeId: string;
  sourceId: string;
  sourcePort: string;
  source: string;
}

interface InputRow {
  port: BoardPortSpec;
  entries: InputEntry[];
}

const inputRows = computed<InputRow[]>(() => {
  const current = node.value;
  if (!current) return [];
  return portsOf(current, portContext.value).inputs.map((port) => {
    const entries = board.edges
      .filter((edge) => edge.target === current.id && edge.targetPort === port.id)
      .map((edge) => {
        const upstream = board.nodes.find((item) => item.id === edge.source);
        return {
          edgeId: edge.id,
          sourceId: edge.source,
          sourcePort: edge.sourcePort,
          source: upstream ? displayTitleOf(upstream) : edge.source,
        };
      });
    return { port, entries };
  });
});
const boundCount = computed(() =>
  inputRows.value.reduce((sum, row) => sum + row.entries.length, 0),
);
/** 所有输入端口的总容量（多路端口按 max 算）。 */
const inputCapacity = computed(() =>
  inputRows.value.reduce((sum, row) => sum + Math.max(1, row.port.max ?? 1), 0),
);
/** 第一个已连接上游的名字（显示节点用它说明"输入已连接"）。 */
const inputSourceName = computed(
  () => inputRows.value.find((row) => row.entries.length > 0)?.entries[0]?.source ?? "",
);

/** 输入端口最多接几个上游。 */
function portMax(port: BoardPortSpec): number {
  return Math.max(1, port.max ?? 1);
}

/** 某个输入端口当前接的上游（`来源节点:输出端口`）。 */
function bindingKeys(port: BoardPortSpec): string[] {
  return (
    inputRows.value.find((row) => row.port.id === port.id)?.entries.map(
      (entry) => `${entry.sourceId}:${entry.sourcePort}`,
    ) ?? []
  );
}

function parseBinding(key: string): { nodeId: string; portId: string } | null {
  const at = key.lastIndexOf(":");
  if (at <= 0) return null;
  const nodeId = key.slice(0, at);
  const portId = key.slice(at + 1);
  if (!nodeId || !portId) return null;
  return { nodeId, portId };
}

/** 用一组 `来源:端口` 重建这个输入端口的连线（多选 / 排序都走这里）。 */
function applyBindings(port: BoardPortSpec, keys: string[]): void {
  const current = node.value;
  if (!current) return;
  // 兜底：只接受当前节点依赖链上的上游，别的节点即使混进 key 也拒绝。
  const ancestors = ancestorIds(current.id, board.edges);
  const sources = keys
    .map(parseBinding)
    .filter((item): item is { nodeId: string; portId: string } => item !== null)
    .filter((item) => item.nodeId !== current.id && ancestors.has(item.nodeId));
  board.bindPort(current.id, port.id, sources, portMax(port));
}

/** 多选下拉：勾上就追加到末尾，取消就移除。 */
function toggleBinding(port: BoardPortSpec, key: string): void {
  const keys = bindingKeys(port);
  applyBindings(
    port,
    keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key],
  );
}

/** 调整多路输入的顺序（H3 的 `<Picture N>` 按这个顺序对应）。 */
function moveBinding(port: BoardPortSpec, index: number, delta: number): void {
  const keys = bindingKeys(port);
  const next = index + delta;
  if (next < 0 || next >= keys.length) return;
  const copy = [...keys];
  const [item] = copy.splice(index, 1);
  if (!item) return;
  copy.splice(next, 0, item);
  applyBindings(port, copy);
}

function removeBinding(port: BoardPortSpec, key: string): void {
  applyBindings(
    port,
    bindingKeys(port).filter((item) => item !== key),
  );
}
const outputPorts = computed(() =>
  node.value ? portsOf(node.value, portContext.value).outputs : [],
);
const hasOutput = computed(() => outputPorts.value.length > 0);

interface UpstreamOutput {
  nodeId: string;
  portId: string;
  type: string;
  label: string;
}

/**
 * 输入下拉的候选：**只允许这条节点向上游能走到的节点输出**。
 *
 * 也就是「跟自己输入直连的节点的输出」+「这些节点再往上的第 N 跳节点的输出」。
 * 下游节点（接上会成环）和完全无关的节点都不出现——一个输入的值只能来自它自己
 * 的依赖链，画布上别的工作流不会混进这个下拉框。
 */
const upstreamOutputs = computed<UpstreamOutput[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ancestors = ancestorIds(current.id, board.edges);
  const out: UpstreamOutput[] = [];
  // 按画布顺序输出，多路输入排序时位置稳定（不随边创建顺序跳来跳去）。
  for (const item of board.nodes) {
    if (!ancestors.has(item.id)) continue;
    const spec = nodeDefinition(item.type);
    if (!spec || spec.category === "group") continue;
    for (const port of portsOf(item, portContext.value).outputs) {
      out.push({
        nodeId: item.id,
        portId: port.id,
        type: port.type,
        label:
          item.type.startsWith("loop.") || item.type.startsWith("input.") || item.type.startsWith("display.")
            ? `${displayTitleOf(item)} · ${i18n.t(port.labelKey)} (${port.id})`
            : `${displayTitleOf(item)} · ${i18n.t(port.labelKey)}`,
      });
    }
  }
  return out;
});

/** 参数下拉的候选：类型为 any 或与端口一致。 */
function bindingOptions(port: BoardPortSpec): SelectOption[] {
  const compatible = upstreamOutputs.value.filter(
    (item) => port.type === "any" || item.type === "any" || item.type === port.type,
  );
  return [
    { id: "", label: i18n.t("board.inspect.unconnected") },
    ...compatible.map((item) => ({ id: `${item.nodeId}:${item.portId}`, label: item.label })),
  ];
}

/** 单路端口的下拉值（多路端口用 `bindingKeys` + 多选）。 */
function bindingValue(row: InputRow): string {
  const first = row.entries[0];
  return first ? `${first.sourceId}:${first.sourcePort}` : "";
}

const llm = useBoardLlm();
/** 语音合成 / 语音识别各自的云端服务（不在 cloud_gen 里）。 */
const cloudTts = ref<CloudTtsProvider[]>([]);
const cloudAsr = ref<CloudAsrProvider[]>([]);

onMounted(() => {
  void models.load();
  void boardCloudProviders();
  void loadCloudProviders();
  if (params.value.some((spec) => spec.llm)) void llm.ensure();
  if (params.value.some((spec) => spec.model?.cloud === "tts")) {
    void boardCloudTtsProviders().then((list) => (cloudTts.value = list));
  }
  if (params.value.some((spec) => spec.model?.cloud === "asr")) {
    void boardCloudAsrProviders().then((list) => (cloudAsr.value = list));
  }
});

async function loadCloudProviders(): Promise<void> {
  try {
    const config = await cloudGenConfig();
    cloudProviders.value = config.providers.filter((provider) => provider.enabled);
    cloudPresets.value = await cloudGenPresets();
  } catch {
    cloudProviders.value = [];
  }
}

/* ---------- 标题 ---------- */

function setTitle(event: Event): void {
  if (!node.value) return;
  const value = (event.target as HTMLInputElement).value.trim();
  board.updateNodeData(node.value.id, { title: value || undefined });
}

/* ---------- 参数 ---------- */

function setParam(spec: BoardParamSpec, value: unknown): void {
  if (!node.value) return;
  board.updateNodeData(node.value.id, { params: { ...node.value.data.params, [spec.id]: value } });
}

/** 一次写多个参数（分控件一次写 size + width + height）。 */
function patchParams(patch: Record<string, unknown>): void {
  const current = node.value;
  if (!current) return;
  board.updateNodeData(current.id, { params: { ...current.data.params, ...patch } });
}

/** 参数的原始值（不转字符串）：组件控件要拿 number / boolean 本身。 */
function paramRaw(spec: BoardParamSpec): unknown {
  const current = node.value?.data.params[spec.id];
  return current === undefined || current === null ? spec.default : current;
}

function paramValue(spec: BoardParamSpec): string {
  const current = node.value?.data.params[spec.id];
  const raw =
    current === undefined || current === null
      ? spec.default === undefined
        ? ""
        : String(spec.default)
      : String(current);
  // 文本模型没单独选时回落到第一家启用供应商的默认模型（运行也用它）。
  if (!raw && spec.llm) return llm.fallback.value?.id ?? "";
  return raw;
}

function paramBool(spec: BoardParamSpec): boolean {
  const current = node.value?.data.params[spec.id];
  return typeof current === "boolean" ? current : spec.default === true;
}

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

/** 动态模型下拉：本地模型 + 云端服务并排，值形如 local: / cloud:。 */
function paramSelectOptions(spec: BoardParamSpec): SelectOption[] {
  const options: SelectOption[] = paramOptions(spec).map((option) => ({
    id: option.value,
    label: option.label,
    group: option.group,
  }));
  if (settingsSectionOf(spec)) {
    options.unshift({
      id: "__open_settings",
      label: i18n.t("board.inspect.modelSettings"),
      hint: i18n.t("board.inspect.modelSettingsHint"),
      action: true,
    });
  }
  return options;
}

/** 云端生成服务在某个能力下用的模型名（能力不同，模型字段也不同）。 */
function cloudModelLabel(provider: CloudGenProvider, capability?: string): string {
  if (capability === "i2i") return provider.edit_model || provider.image_model;
  if (capability === "t2v" || capability === "i2v") return provider.video_model;
  return provider.image_model;
}

function paramOptions(
  spec: BoardParamSpec,
): { value: string; label: string; group?: string }[] {
  if (spec.llm) {
    // 文本生成：所有启用供应商的模型，标签是「模型 · 供应商」。
    const current = paramValue(spec);
    const items = llm.options.value;
    const list =
      current && !items.some((item) => item.id === current)
        ? [{ id: current, label: current.split(LLM_VALUE_SEP).join(" · ") }, ...items]
        : items.slice();
    return list.map((item) => ({ value: item.id, label: item.label }));
  }
  if (spec.model) {
    const options: { value: string; label: string; group?: string }[] = [];
    const localGroup = i18n.t("board.inspect.localGroup");
    for (const model of models.ofFeature(spec.model.feature as ModelFeature)) {
      options.push({
        value: `local:${model.id}`,
        label: model.installed ? model.name : `${model.name} · ${i18n.t("board.inspect.missing")}`,
        group: localGroup,
      });
    }
    // 云端：供应商名做分组标题，下面跟它的模型。
    if (spec.model.capability) {
      for (const provider of providersForNodeCapability(
        cloudProviders.value,
        spec.model.capability as never,
        cloudPresets.value,
      )) {
        options.push({
          value: `cloud:${provider.id}`,
          label: cloudModelLabel(provider, spec.model.capability) || provider.name,
          group: provider.name,
        });
      }
    }
    // 语音合成 / 语音识别：云端的服务来自各自的设置页，和本地模型并列。
    if (spec.model.cloud === "tts") {
      for (const provider of cloudTts.value) {
        if (!provider.enabled) continue;
        options.push({
          value: `cloud:${provider.id}`,
          label: provider.model || provider.name,
          group: provider.name,
        });
      }
    }
    if (spec.model.cloud === "asr") {
      for (const provider of cloudAsr.value) {
        if (!provider.enabled) continue;
        options.push({
          value: `cloud:${provider.id}`,
          label: provider.model || provider.name,
          group: provider.name,
        });
      }
    }
    return options;
  }
  return (spec.options ?? []).map((option) => ({ value: option.value, label: i18n.t(option.labelKey) }));
}

/* ---------- 素材 ---------- */

async function pickFiles(): Promise<void> {
  const current = node.value;
  if (!current) return;
  const files = await pickMediaFiles();
  for (const path of files) {
    try {
      const imported = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, imported));
      if (isImageNode.value) appendToStack(imported.id);
      else board.updateNodeData(current.id, { assetId: imported.id, assetIds: undefined });
    } catch (error) {
      toast(String(error), "error");
    }
  }
}

function appendToStack(assetId: string): void {
  const current = node.value;
  if (!current) return;
  const ids = [...stack.value.map((item) => item.id), assetId];
  board.updateNodeData(current.id, {
    assetIds: ids,
    stackIndex: ids.length - 1,
    assetId,
  });
}

/** 素材库对话框选中后：图片追加到牌堆，视频 / 音频替换。 */
function onPickerPick(ids: string[]): void {
  const current = node.value;
  if (!current) return;
  const picked = ids.filter((id) => {
    const item = project.doc.assets.find((candidate) => candidate.id === id);
    return item !== undefined && item.kind === mediaKind.value;
  });
  if (picked.length === 0) return;
  if (isImageNode.value) {
    const next = [...stack.value.map((item) => item.id), ...picked];
    const index = stack.value.length;
    board.updateNodeData(current.id, {
      assetIds: next,
      stackIndex: index,
      assetId: next[index],
    });
    return;
  }
  board.updateNodeData(current.id, { assetId: picked[0], assetIds: undefined });
}

function showInStack(index: number): void {
  const current = node.value;
  if (!current) return;
  board.updateNodeData(current.id, { stackIndex: index, assetId: stack.value[index]?.id });
}

function removeFromStack(assetId: string): void {
  const current = node.value;
  if (!current) return;
  const ids = stack.value.map((item) => item.id).filter((id) => id !== assetId);
  board.updateNodeData(current.id, {
    assetIds: ids.length > 0 ? ids : undefined,
    stackIndex: 0,
    assetId: ids[0],
  });
}

function clearAsset(): void {
  if (!node.value) return;
  board.updateNodeData(node.value.id, { assetId: undefined, assetIds: undefined, stackIndex: 0 });
}

/** 素材尺寸 / 类型的单行描述（mono 小字）。 */
function mediaMeta(item: MediaAsset): string {
  if (item.width && item.height) return `${item.width} × ${item.height}`;
  return item.kind;
}

/* ---------- 动作 ---------- */

function runNode(): void {
  if (node.value) run.runNode(node.value.id);
}

/** 显示节点的"一键导出"：插到当前分P 的播放头处。 */
function insertToTimeline(): void {
  const current = asset.value ?? outputAsset.value;
  if (!current) return;
  let placed = 0;
  project.dispatch((doc) => {
    const result = insertImportedAssets(doc, [current], playback.playhead);
    placed = result.clipIds.length;
    return result.doc;
  });
  if (placed > 0) toast(i18n.t("board.inspect.inserted"));
  else toast(i18n.t("board.inspect.insertFailed"), "error");
}

async function downloadAsset(): Promise<void> {
  const current = asset.value ?? outputAsset.value;
  if (current) await download(current);
}

async function copyPath(): Promise<void> {
  const current = asset.value ?? outputAsset.value;
  if (!current) return;
  await copyText(current.src);
  toast(i18n.t("board.inspect.pathCopied"));
}

function duplicate(): void {
  if (node.value) board.duplicateNode(node.value.id);
}

function remove(): void {
  if (!node.value) return;
  const id = node.value.id;
  board.removeNodes([id]);
  layout.openTab("inspector");
}

/** 跳到某个上游节点（方便顺着连线改上游）。 */
function focusNode(nodeId: string): void {
  board.select([nodeId]);
}

/**
 * 单路端口：下拉里选上游输出就（重新）连一条线，选「未连接」就断掉。
 * 连线是画布上唯一的真值来源，所以这里直接操作边而不是另存一份绑定。
 */
function setBinding(port: BoardPortSpec, value: string): void {
  applyBindings(port, value ? [value] : []);
}

/** 多输出节点：当前节点每一条下游连线，以及它走的是哪个输出端口。 */
interface OutgoingRow {
  edgeId: string;
  targetId: string;
  target: string;
  targetPort: string;
  /** 下游这个输入端的类型（决定可选哪几路输出）。 */
  targetType: BoardPortType | null;
  sourcePort: string;
}

const outgoingRows = computed<OutgoingRow[]>(() => {
  const current = node.value;
  if (!current) return [];
  return board.edges
    .filter((edge) => edge.source === current.id)
    .map((edge) => {
      const downstream = board.nodes.find((item) => item.id === edge.target);
      const inputPort = downstream
        ? portsOf(downstream, portContext.value).inputs.find(
            (port) => port.id === edge.targetPort,
          )
        : null;
      return {
        edgeId: edge.id,
        targetId: edge.target,
        target: downstream ? displayTitleOf(downstream) : edge.target,
        targetPort: edge.targetPort,
        targetType: inputPort?.type ?? null,
        sourcePort: edge.sourcePort,
      };
    });
});

/** 输出端口下拉：只列和下游输入类型兼容的那几路。 */
function outputPortOptions(row: OutgoingRow): SelectOption[] {
  return outputPorts.value
    .filter((port) => !row.targetType || portsCompatible(port.type, row.targetType))
    .map((port) => ({
      id: port.id,
      label: i18n.t(port.labelKey),
      hint: port.type,
    }));
}

function setEdgeSourcePort(edgeId: string, portId: string): void {
  if (board.setEdgeSourcePort(edgeId, portId)) {
    toast(i18n.t("board.inspect.outputRebound"));
  }
}

const statusLabel = computed(() => i18n.t(`board.status.${node.value?.data.status ?? "idle"}`));
/** 最近一次运行的耗时（与节点标签上的角标一致）。 */
const durationLabel = computed(() => {
  const ms = node.value?.data.durationMs;
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
});
const isGroupNode = computed(() => node.value?.type === "group");
const groupMembers = computed(() => node.value?.data.children ?? []);
const groupTone = computed(() => node.value?.data.tone ?? "lavender");
const toneOptions = computed(() =>
  BOARD_GROUP_TONES.map((tone) => ({
    id: tone,
    label: i18n.t(`board.group.tone.${tone}`),
  })),
);
const ignored = computed(() => node.value?.data.ignored === true);
const bypassed = computed(() => node.value?.data.bypassed === true);

/** 切换组框色调（对齐 ai-board 的 group tone）。 */
function setGroupTone(tone: string): void {
  const current = node.value;
  if (!current || current.type !== "group") return;
  board.updateNodeData(current.id, { tone: tone as BoardGroupTone });
}

/** 禁用 / 旁路：组节点作用于全体组员。 */
function setFlag(flag: "ignored" | "bypassed", value: boolean): void {
  const current = node.value;
  if (!current) return;
  if (current.type === "group") board.setGroupFlag(current.id, { [flag]: value });
  else board.updateNodeData(current.id, { [flag]: value });
}

function ungroup(): void {
  const current = node.value;
  if (current?.type === "group") board.ungroup(current.id);
}

function selectGroupMembers(): void {
  const current = node.value;
  if (current) board.select([current.id, ...(current.data.children ?? [])]);
}
const publishedText = computed(() => node.value?.data.outputText ?? "");
const publishedReasoning = computed(() => node.value?.data.outputReasoning ?? "");
const outputAssetCount = computed(() => {
  const data = node.value?.data;
  return data?.outputAssetIds?.length ?? (data?.outputAssetId ? 1 : 0);
});

/** 输出卡只说明「有几个、是什么类型」，具体内容去节点下方的附件卡看。 */
function outputCountLabel(port: BoardPortSpec): string {
  if (port.type === "text") {
    const kinds: string[] = [];
    if (publishedText.value) kinds.push(i18n.t("board.inspect.outputContent"));
    if (publishedReasoning.value) kinds.push(i18n.t("board.inspect.outputReasoning"));
    if (kinds.length === 0) return i18n.t("board.inspect.outputEmpty");
    return `${kinds.join(" + ")} · ${i18n.t("board.inspect.chars", { count: publishedText.value.length })}`;
  }
  const current = node.value;
  if (current && publishedAssetId(current, port.id, portContext.value)) {
    return i18n.t("board.inspect.outputCount", { count: outputAssetCount.value });
  }
  return i18n.t("board.inspect.outputEmpty");
}
const thumbOf = computed(() => (asset.value ? assetThumbnailUrl(asset.value) : null));

/** 输出端口是否已经有内容（文本端口看文本，媒体端口按端口取发布产物）。 */
function portReady(port: BoardPortSpec): boolean {
  if (!node.value) return false;
  if (port.type === "text") return publishedText.value.length > 0;
  return Boolean(publishedAssetId(node.value, port.id, portContext.value));
}
</script>

<template>
  <div class="board-inspector">
    <template v-if="node && definition">
      <!-- 节点标题卡 -->
      <div class="inspector-node-title">
        <span class="node-icon">
          <component :is="nodeIcon(node.type)" />
        </span>
        <div class="node-title-copy">
          <strong>{{ title }}</strong>
          <span>{{ node.type }}</span>
        </div>
        <span class="inspector-status" :data-state="node.data.status ?? 'idle'">
          {{ statusLabel }}<template v-if="durationLabel"> · {{ durationLabel }}</template>
        </span>
      </div>

      <div class="inspector-stack">
        <!-- 组节点：成员与整组操作 -->
        <section v-if="isGroupNode" class="binding-section">
          <div class="binding-head">
            <Square3Stack3DIcon />
            <span>{{ i18n.t("board.node.group") }}</span>
            <span class="binding-count">
              {{ i18n.t("board.group.count", { count: groupMembers.length }) }}
            </span>
          </div>
          <div v-if="groupMembers.length === 0" class="inspector-hint">
            {{ i18n.t("board.group.empty") }}
          </div>
          <div class="md-field">
            <label>{{ i18n.t("board.group.tone") }}</label>
            <Md3Select
              :model-value="groupTone"
              :options="toneOptions"
              :label="i18n.t('board.group.tone')"
              @select="setGroupTone"
            />
          </div>
          <div class="inspector-inline-actions">
            <button class="md-button" data-variant="outlined" type="button" @click="selectGroupMembers">
              {{ i18n.t("board.ctx.groupSelect") }}
            </button>
            <button class="md-button" data-variant="outlined" type="button" @click="ungroup">
              {{ i18n.t("board.ctx.ungroup") }}
            </button>
          </div>
        </section>

        <!-- 输入参数（连线） -->
        <section v-if="inputRows.length > 0" class="binding-section">
          <div class="binding-head">
            <LinkIcon />
            <span>{{ i18n.t("board.inspect.inputsTitle") }}</span>
            <span class="binding-count">
              {{ i18n.t("board.inspect.bindings", { bound: boundCount, total: inputCapacity }) }}
            </span>
          </div>
          <div v-for="row in inputRows" :key="row.port.id" class="binding-row">
            <div class="binding-label">
              <span>{{ portLabel(row.port) }}</span>
              <span class="binding-type">{{ row.port.type }}</span>
              <span v-if="portMax(row.port) > 1" class="binding-count">
                {{ row.entries.length }} / {{ portMax(row.port) }}
              </span>
            </div>
            <!-- 同类型多路输入合并成一个端口：下拉里多选最多 max 个 -->
            <Md3Select
              v-if="portMax(row.port) > 1"
              class="binding-select"
              multiple
              :model-value="''"
              :selected-ids="bindingKeys(row.port)"
              :options="bindingOptions(row.port).filter((option) => option.id !== '')"
              :label="portLabel(row.port)"
              :placeholder="i18n.t('board.inspect.pickMultiple')"
              :searchable="bindingOptions(row.port).length > 8"
              @toggle="toggleBinding(row.port, $event)"
            />
            <template v-else>
              <Md3Select
                class="binding-select"
                :model-value="bindingValue(row)"
                :options="bindingOptions(row.port)"
                :label="portLabel(row.port)"
                :searchable="bindingOptions(row.port).length > 8"
                @select="setBinding(row.port, $event)"
              />
              <button
                v-if="row.entries.length > 0"
                class="binding-note"
                type="button"
                :title="i18n.t('board.inspect.connectedHint')"
                @click="focusNode(row.entries[0]!.sourceId)"
              >
                {{ i18n.t("board.inspect.boundTo", { name: row.entries[0]!.source }) }}
              </button>
              <span v-else-if="bindingOptions(row.port).length <= 1" class="binding-note">
                {{ i18n.t("board.inspect.connectFirst", { type: row.port.type }) }}
              </span>
            </template>
            <!-- 已选多路：序号 + 上移 / 下移 / 移除（顺序就是运行时读取顺序） -->
            <div v-if="portMax(row.port) > 1 && row.entries.length > 0" class="binding-order">
              <div
                v-for="(entry, index) in row.entries"
                :key="entry.edgeId"
                class="binding-order-row"
              >
                <span class="binding-order-index">{{ index + 1 }}</span>
                <button
                  class="binding-order-name"
                  type="button"
                  :title="i18n.t('board.inspect.connectedHint')"
                  @click="focusNode(entry.sourceId)"
                >
                  {{ entry.source }}
                </button>
                <button
                  class="binding-order-btn"
                  type="button"
                  :disabled="index === 0"
                  :aria-label="i18n.t('board.inspect.moveUp')"
                  :title="i18n.t('board.inspect.moveUp')"
                  @click="moveBinding(row.port, index, -1)"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  class="binding-order-btn"
                  type="button"
                  :disabled="index === row.entries.length - 1"
                  :aria-label="i18n.t('board.inspect.moveDown')"
                  :title="i18n.t('board.inspect.moveDown')"
                  @click="moveBinding(row.port, index, 1)"
                >
                  <ChevronDownIcon />
                </button>
                <button
                  class="binding-order-btn"
                  type="button"
                  :aria-label="i18n.t('board.inspect.removeBinding')"
                  :title="i18n.t('board.inspect.removeBinding')"
                  @click="removeBinding(row.port, `${entry.sourceId}:${entry.sourcePort}`)"
                >
                  <XMarkIcon />
                </button>
              </div>
            </div>
            <span
              v-else-if="portMax(row.port) > 1 && bindingOptions(row.port).length <= 1"
              class="binding-note"
            >
              {{ i18n.t("board.inspect.connectFirst", { type: row.port.type }) }}
            </span>
          </div>
        </section>

        <!-- 循环结束节点的输入：新建输入 / 删除，不放在节点卡片上 -->
        <section v-if="isLoopEnd" class="binding-section">
          <div class="binding-head">
            <PlusIcon />
            <span>{{ i18n.t("board.loop.inputs") }}</span>
            <span class="binding-count">{{ loopInputRows.length }}</span>
          </div>
          <div v-for="row in loopInputRows" :key="row.portId" class="binding-row loop-input-row">
            <div class="binding-label">
              <span>{{ i18n.t("board.loop.inputN", { n: row.index }) }}</span>
              <span class="binding-type">{{ row.source ?? "—" }}</span>
            </div>
            <button
              class="loop-input-remove"
              type="button"
              :disabled="loopInputRows.length <= 1"
              :title="i18n.t('board.loop.removeInput')"
              @click="removeLoopInput(row.index - 1)"
            >
              <XMarkIcon />
            </button>
          </div>
          <button class="md-button" type="button" @click="addLoopInput">
            {{ i18n.t("board.loop.addInput") }}
          </button>
        </section>

        <!-- 输出（只列类型 / 数量，不重复展示内容；内容在节点下方的附件卡里） -->
        <section v-if="hasOutput" class="binding-section output-section">
          <div class="binding-head">
            <ArrowUpTrayIcon />
            <span>{{ i18n.t("board.inspect.outputs") }}</span>
            <span class="binding-count">{{ outputPorts.length }}</span>
          </div>
          <div v-for="port in outputPorts" :key="port.id" class="output-row">
            <div class="output-row-head">
              <span class="binding-label">
                <span>{{ i18n.t(port.labelKey) }}</span>
                <span class="binding-type">{{ port.type }}</span>
              </span>
              <span class="output-state" :data-ready="portReady(port) ? 'true' : 'false'">
                {{ portReady(port) ? i18n.t("board.inspect.published") : i18n.t("board.inspect.outputReady") }}
              </span>
            </div>
            <div class="output-summary">
              <span class="output-chip">{{ i18n.t(`board.port.${port.type}`) }}</span>
              <span class="output-count">{{ outputCountLabel(port) }}</span>
            </div>
          </div>
        </section>

        <!-- 输出连线：多输出节点（音频分轨 / 视频音频分离）每条下游走哪一路 -->
        <section v-if="outputPorts.length > 1 && !isBundleOutputNode" class="binding-section">
          <div class="binding-head">
            <LinkIcon />
            <span>{{ i18n.t("board.inspect.outBindings") }}</span>
            <span class="binding-count">{{ outgoingRows.length }}</span>
          </div>
          <p v-if="outgoingRows.length === 0" class="inspector-hint">
            {{ i18n.t("board.inspect.outBindingsHint") }}
          </p>
          <div v-for="row in outgoingRows" :key="row.edgeId" class="binding-row">
            <div class="binding-label">
              <span>{{ row.target }}</span>
              <span class="binding-type">{{ row.targetPort }}</span>
            </div>
            <Md3Select
              class="binding-select"
              :model-value="row.sourcePort"
              :options="outputPortOptions(row)"
              :label="i18n.t('board.inspect.outBindings')"
              @select="setEdgeSourcePort(row.edgeId, $event)"
            />
          </div>
        </section>

        <!-- 标题 -->
        <div class="md-field">
          <label>{{ i18n.t("board.inspect.title") }}</label>
          <input
            class="md-input"
            type="text"
            :value="title"
            :placeholder="i18n.t('board.inspect.titlePlaceholder')"
            @change="setTitle"
          />
        </div>

        <!-- 节点自己的设定：每个参数一个 md-field（没有分区标题） -->
        <div v-for="spec in nodeParams" :key="spec.id" class="md-field">
          <label>{{ i18n.t(spec.labelKey) }}</label>
          <component
            :is="controlFor(spec.control ?? '') ?? 'input'"
            v-if="spec.kind === 'component'"
            :node="node"
            :spec="spec"
            :value="paramRaw(spec)"
            @update="setParam(spec, $event)"
          />
          <BoardSizeControl
            v-else-if="spec.kind === 'size'"
            :node="node ?? undefined"
            variant="inspector"
            @update="patchParams"
          />
          <textarea
            v-else-if="spec.kind === 'longtext'"
            class="md-textarea"
            rows="7"
            :value="paramValue(spec)"
            :placeholder="spec.placeholderKey ? i18n.t(spec.placeholderKey) : ''"
            @input="setParam(spec, ($event.target as HTMLTextAreaElement).value)"
          />
          <Md3Select
            v-else-if="spec.kind === 'select'"
            class="field-select"
            :model-value="paramValue(spec)"
            :options="paramSelectOptions(spec)"
            :label="i18n.t(spec.labelKey)"
            :placeholder="spec.model || spec.llm ? i18n.t('board.inspect.pickModel') : '—'"
            :searchable="paramOptions(spec).length > 5"
            @select="setParam(spec, $event)"
            @action="openParamSettings(spec)"
          />
          <ToggleSwitch
            v-else-if="spec.kind === 'toggle'"
            :model-value="paramBool(spec)"
            :label="i18n.t(spec.labelKey)"
            @update:model-value="setParam(spec, $event)"
          />
          <NumberField
            v-else-if="spec.kind === 'number' || spec.kind === 'seed'"
            :model-value="Number(paramValue(spec)) || 0"
            :min="spec.min ?? (spec.kind === 'seed' ? -1 : 0)"
            :max="spec.max ?? 2147483647"
            :step="spec.step ?? 1"
            :sr-label="i18n.t(spec.labelKey)"
            input-width="68px"
            @update:model-value="setParam(spec, $event)"
          />
          <input
            v-else
            class="md-input"
            type="text"
            :value="paramValue(spec)"
            @change="setParam(spec, ($event.target as HTMLInputElement).value)"
          />
          <span v-if="spec.hintKey" class="inspector-hint">{{ i18n.t(spec.hintKey) }}</span>
        </div>

        <!-- 素材 -->
        <template v-if="mediaKind">
          <!-- 输入节点：可上传 / 可换素材 -->
          <div v-if="!isDisplayNode" class="inspector-media-block">
            <div v-if="isImageNode" class="asset-strip">
              <div
                v-for="(item, index) in stack"
                :key="item.id"
                class="asset-thumb"
                :data-active="index === stackIndex ? 'true' : 'false'"
              >
                <button class="asset-thumb-main" type="button" :title="item.name" @click="showInStack(index)">
                  <img v-if="assetThumbnailUrl(item)" :src="assetThumbnailUrl(item)!" :alt="item.name" />
                  <span v-else class="asset-thumb-mark"><PhotoIcon /></span>
                </button>
                <button
                  class="asset-thumb-remove"
                  type="button"
                  :aria-label="i18n.t('common.remove')"
                  @click.stop="removeFromStack(item.id)"
                >
                  <XMarkIcon />
                </button>
              </div>
              <button
                class="asset-thumb asset-thumb-add"
                type="button"
                :title="i18n.t('board.inspect.addImages')"
                @click="pickerOpen = true"
              >
                <PlusIcon />
              </button>
            </div>

            <div v-if="isImageNode" class="inspector-media-meta">
              <span>{{ asset ? asset.name : i18n.t("board.inspect.noMedia") }}</span>
              <span v-if="asset">{{ mediaMeta(asset) }} · {{ i18n.t("board.inspect.stackCount", { count: stack.length }) }}</span>
            </div>

            <div v-else class="inspector-media">
              <img v-if="thumbOf" :src="thumbOf" :alt="asset?.name ?? ''" />
              <video
                v-else-if="asset && mediaKind === 'video'"
                :src="fileUrl(asset.src)"
                muted
                playsinline
                preload="metadata"
              />
              <span v-else class="media-mark">
                <component :is="mediaKind === 'audio' ? MusicalNoteIcon : PhotoIcon" />
              </span>
              <div class="media-copy">
                <strong>{{ asset ? asset.name : i18n.t("board.inspect.noMedia") }}</strong>
                <span>{{ asset ? mediaMeta(asset) : mediaKind }}</span>
              </div>
              <button
                v-if="asset"
                class="media-clear"
                type="button"
                :title="i18n.t('board.inspect.clearMedia')"
                @click="clearAsset"
              >
                <XMarkIcon />
              </button>
            </div>

            <div class="inspector-media-state">
              <LinkIcon />
              <span>{{ i18n.t("board.inspect.mediaHint") }}</span>
            </div>

            <div class="inspector-inline-actions">
              <button class="md-button" data-variant="outlined" type="button" @click="pickFiles">
                <FolderOpenIcon />
                {{ i18n.t("board.inspect.pickFile") }}
              </button>
              <button class="md-button" data-variant="outlined" type="button" @click="pickerOpen = true">
                <PhotoIcon />
                {{ i18n.t("board.inspect.pickAsset") }}
              </button>
            </div>

            <p v-if="isImageNode || mediaKind === 'video'" class="inspector-hint">
              {{ i18n.t(isImageNode ? "board.inspect.aspectHint" : "board.inspect.aspectHintVideo") }}
            </p>
          </div>

          <!-- 显示节点：只读上游发布的素材 -->
          <div v-else class="inspector-media-block">
            <div v-if="asset" class="inspector-media">
              <img v-if="thumbOf" :src="thumbOf" :alt="asset.name" />
              <video
                v-else-if="mediaKind === 'video'"
                :src="fileUrl(asset.src)"
                muted
                playsinline
                preload="metadata"
              />
              <span v-else class="media-mark">
                <component :is="mediaKind === 'audio' ? MusicalNoteIcon : PhotoIcon" />
              </span>
              <div class="media-copy">
                <strong>{{ asset.name }}</strong>
                <span>{{ mediaMeta(asset) }}</span>
              </div>
            </div>
            <div class="inspector-media-state">
              <LinkIcon />
              <span v-if="asset">
                {{ inputSourceName ? i18n.t("board.inspect.connected", { name: inputSourceName }) : i18n.t("board.inspect.mediaHint") }}
              </span>
              <!-- 已经连上上游就不要再让人"去连一个"：改成等待运行，和节点卡片一致。 -->
              <span v-else>
                {{ inputSourceName
                  ? i18n.t("board.inspect.connected", { name: inputSourceName })
                  : i18n.t("board.node.waitingMedia") }}
              </span>
            </div>
            <p v-if="!asset" class="inspector-hint">
              {{ i18n.t(inputSourceName ? "board.node.waitingRunHint" : "board.node.waitingHint") }}
            </p>
          </div>
        </template>

        <p v-if="node.data.error" class="inspector-error">{{ node.data.error }}</p>

        <!-- 运行控制：旁路 / 禁用 -->
        <section class="binding-section">
          <div class="binding-head">
            <BoltIcon />
            <span>{{ i18n.t("board.inspect.runControls") }}</span>
          </div>
          <div class="flag-row">
            <span class="flag-copy">
              <span class="row-title">{{ i18n.t("board.ctx.bypass") }}</span>
              <span class="inspector-hint">{{ i18n.t("board.inspect.bypassHint") }}</span>
            </span>
            <ToggleSwitch
              :model-value="bypassed"
              :label="i18n.t('board.ctx.bypass')"
              @update:model-value="setFlag('bypassed', $event)"
            />
          </div>
          <div class="flag-row">
            <span class="flag-copy">
              <span class="row-title">{{ i18n.t("board.ctx.ignore") }}</span>
              <span class="inspector-hint">{{ i18n.t("board.inspect.ignoreHint") }}</span>
            </span>
            <ToggleSwitch
              :model-value="ignored"
              :label="i18n.t('board.ctx.ignore')"
              @update:model-value="setFlag('ignored', $event)"
            />
          </div>
        </section>

        <!-- 操作 -->
        <div class="inspector-actions">
          <button
            v-if="!isGroupNode"
            class="md-button"
            data-variant="filled"
            type="button"
            :title="i18n.t('board.inspect.run')"
            @click="runNode"
          >
            <PlayIcon />
            {{ i18n.t("board.inspect.run") }}
          </button>
          <button class="md-button" data-variant="outlined" type="button" :title="i18n.t('board.ctx.duplicate')" @click="duplicate">
            <DocumentDuplicateIcon />
            {{ i18n.t("board.ctx.duplicate") }}
          </button>
          <button class="md-button danger" data-variant="outlined" type="button" :title="i18n.t('common.delete')" @click="remove">
            <TrashIcon />
            {{ i18n.t("common.delete") }}
          </button>
        </div>

        <!-- 次级动作（导出 / 下载 / 复制路径）放在最底部 -->
        <div v-if="mediaKind && (asset || outputAsset)" class="inspector-actions secondary">
          <button class="md-button" data-variant="text" type="button" @click="insertToTimeline">
            <ArrowDownTrayIcon />
            {{ i18n.t("board.inspect.insertTimeline") }}
          </button>
          <button class="md-button" data-variant="text" type="button" @click="downloadAsset">
            {{ i18n.t("board.inspect.download") }}
          </button>
          <button class="md-button" data-variant="text" type="button" @click="copyPath">
            {{ i18n.t("board.inspect.copyPath") }}
          </button>
        </div>
      </div>

      <BoardMediaPicker
        v-if="mediaKind"
        v-model:open="pickerOpen"
        :kind="mediaKind"
        :multiple="isImageNode"
        @pick="onPickerPick"
      />
    </template>

    <div v-else class="inspector-empty">
      <span class="inspector-empty-icon"><CursorArrowRaysIcon /></span>
      <p class="inspector-empty-title">{{ i18n.t("board.inspect.empty") }}</p>
      <p class="inspector-empty-hint">{{ i18n.t("board.inspect.emptyHint") }}</p>
    </div>
  </div>
</template>

<style scoped>
.board-inspector {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 16px 22px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  background: var(--app-card);
  color: rgb(var(--md-on-surface));
  font-family: inherit;
  /* ai-board 的面板基字号是 13px，与画布节点保持一致。 */
  font-size: 13px;
}

/* ---------------- 节点标题卡（ai-board inspector-node-title） ---------------- */
.inspector-node-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 11px;
  background: var(--app-inset);
  border: 1px solid rgb(var(--md-outline-variant) / 0.3);
  min-width: 0;
}
.inspector-node-title .node-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.inspector-node-title .node-icon :deep(svg) {
  width: 13px;
  height: 13px;
}
.node-title-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.inspector-node-title strong {
  display: block;
  font-size: 11.5px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-node-title span {
  display: block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  color: rgb(var(--md-on-surface-muted));
}
.node-title-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-status {
  flex: 0 0 auto;
  height: 24px;
  padding: 0 9px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.inspector-status[data-state="running"],
.inspector-status[data-state="queued"] {
  background: rgb(var(--md-secondary-container));
  border-color: transparent;
  color: rgb(var(--md-on-secondary-container));
}
.inspector-status[data-state="done"] {
  background: rgb(var(--md-primary) / 0.14);
  border-color: transparent;
  color: rgb(var(--md-primary));
}
.inspector-status[data-state="stale"] {
  background: rgb(251 191 36 / 0.14);
  border-color: transparent;
  color: rgb(251 191 36);
}
.inspector-status[data-state="error"] {
  background: rgb(var(--md-error) / 0.14);
  border-color: transparent;
  color: rgb(var(--md-error));
}

/* ---------------- 纵向栈 ---------------- */
.inspector-stack {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-width: 0;
}

/* ---------------- 输入 / 输出分区（ai-board binding-section） ---------------- */
.binding-section {
  padding: 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.42);
  border-radius: 12px;
  background: rgb(var(--md-surface-container-low) / 0.5);
  min-width: 0;
}
.output-section {
  border-color: rgb(var(--md-primary) / 0.24);
  background:
    radial-gradient(120% 100% at 0% 0%, rgb(var(--md-primary) / 0.08), transparent 62%),
    rgb(var(--md-surface-container-low) / 0.5);
}
.binding-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 9px;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant));
}
.binding-head :deep(svg) {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}
.binding-count {
  margin-left: auto;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--md-on-surface-muted));
}
/* 循环输入行：标签与删除按钮横排，别让按钮在纵向 flex 里被拉成一整块。 */
.loop-input-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.loop-input-remove {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
}

.loop-input-remove:hover:not(:disabled) {
  background: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}

.loop-input-remove:disabled {
  opacity: 0.3;
}

.loop-input-remove svg {
  width: 13px;
  height: 13px;
}

.binding-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 0;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.24);
  min-width: 0;
}
.binding-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.binding-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
}
.binding-label > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.binding-type {
  flex: 0 0 auto;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  color: rgb(var(--md-on-surface-muted));
  padding: 1px 5px;
  border-radius: 5px;
  background: rgb(var(--md-on-surface) / 0.06);
}
/* 多路输入：已选上游的排序列表 */
.binding-order {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
}
.binding-order-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px 5px;
  border-radius: 8px;
  background: rgb(var(--md-surface-container-highest) / 0.45);
}
.binding-order-index {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  font-weight: 700;
}
.binding-order-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}
.binding-order-name:hover {
  color: rgb(var(--md-primary));
}
.binding-order-btn {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.binding-order-btn:hover:not(:disabled) {
  background: rgb(var(--md-on-surface) / 0.08);
  color: rgb(var(--md-on-surface));
}
.binding-order-btn:disabled {
  opacity: 0.28;
  cursor: default;
}
.binding-order-btn :deep(svg) {
  width: 12px;
  height: 12px;
}

.binding-note {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
  font-size: 9px;
  line-height: 1.4;
  text-align: left;
  font-family: inherit;
}
button.binding-note {
  cursor: pointer;
  transition: color 0.15s ease;
}
button.binding-note:hover {
  color: rgb(var(--md-primary));
}

/* 下拉框统一用 Md3Select 的原生外观（药丸两端 + 箭头贴右），
   只补宽度，不再覆盖圆角 / 内边距——以前覆盖成 9px 方角会让它和设置页不一致。 */
.binding-select {
  width: 100%;
}
.binding-select :deep(.md3-select-root) {
  flex: 1 1 auto;
  width: 100%;
}

/* ---------------- 输出行 ---------------- */
.output-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.24);
  min-width: 0;
}
.output-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.output-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.output-state {
  flex: 0 0 auto;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.04em;
  color: rgb(var(--md-on-surface-muted));
}
.output-state[data-ready="true"] {
  color: rgb(var(--md-on-surface-variant));
}
.output-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.output-chip {
  flex: 0 0 auto;
  height: 20px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgb(var(--md-secondary-container) / 0.65);
  color: rgb(var(--md-on-secondary-container));
  font-size: 9.5px;
  font-weight: 600;
}
.output-count {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  color: rgb(var(--md-on-surface-muted));
}

/* ---------------- 字段（ai-board .md-field / .md-input / .md-textarea） ---------------- */
.md-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.md-field > label {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-variant));
  letter-spacing: 0.2px;
}
.md-input,
.md-textarea {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  /* 和时间轴检查器的 .text-input 一致：同一档底色、同一档字号。 */
  background: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  padding: 8px 10px;
  min-height: 36px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.md-input::placeholder,
.md-textarea::placeholder {
  color: rgb(var(--md-on-surface-muted) / 0.8);
}
.md-input:focus,
.md-textarea:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.md-textarea {
  resize: vertical;
  min-height: 84px;
  font-size: 12px;
  line-height: 1.55;
}
.field-select {
  width: 100%;
}
.field-select :deep(.md3-select-root) {
  flex: 1 1 auto;
  width: 100%;
}

/* 数字步进器：直接用 NumberField 的标准外观（34px 药丸），只让它占满字段宽度。 */
.md-field :deep(.step) {
  width: 100%;
  justify-content: space-between;
}
.md-field :deep(.step-input) {
  flex: 1 1 auto;
}

/* 开关 */
/* ---------------- 素材 ---------------- */
.inspector-media-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.asset-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 6px;
  min-width: 0;
}
.asset-thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  background: rgb(var(--md-surface-container-low) / 0.5);
}
.asset-thumb[data-active="true"] {
  border-color: rgb(var(--md-primary) / 0.9);
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.18);
}
.asset-thumb-main {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  display: block;
  cursor: pointer;
}
.asset-thumb-main img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.asset-thumb-mark {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: rgb(var(--md-on-surface-variant));
}
.asset-thumb-mark :deep(svg) {
  width: 16px;
  height: 16px;
}
.asset-thumb-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  background: rgb(8 6 12 / 0.68);
  color: #fff;
  display: grid;
  place-items: center;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.14s ease;
}
.asset-thumb:hover .asset-thumb-remove {
  opacity: 1;
}
.asset-thumb-remove :deep(svg) {
  width: 10px;
  height: 10px;
}
.asset-thumb-add {
  display: grid;
  place-items: center;
  border-style: dashed;
  border-color: rgb(var(--md-outline-variant) / 0.6);
  background: rgb(var(--md-surface-container-lowest) / 0.4);
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}
.asset-thumb-add:hover {
  color: rgb(var(--md-primary));
  border-color: rgb(var(--md-primary) / 0.6);
}
.asset-thumb-add :deep(svg) {
  width: 17px;
  height: 17px;
}
.inspector-media-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  border-radius: 9px;
  background: rgb(var(--md-surface-container-low) / 0.55);
  border: 1px solid rgb(var(--md-outline-variant) / 0.3);
  font-size: 10px;
  min-width: 0;
}
.inspector-media-meta span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.inspector-media-meta span:last-child {
  color: rgb(var(--md-on-surface-muted));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
}
.inspector-media {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px;
  border-radius: 11px;
  background: rgb(var(--md-surface-container-low) / 0.65);
  border: 1px solid rgb(var(--md-outline-variant) / 0.35);
  min-width: 0;
}
.inspector-media img,
.inspector-media video,
.inspector-media .media-mark {
  width: 64px;
  height: 52px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 8px;
  background: #000;
}
.inspector-media .media-mark {
  display: grid;
  place-items: center;
  color: rgb(var(--md-on-surface-variant));
}
.inspector-media .media-mark :deep(svg) {
  width: 18px;
  height: 18px;
}
.media-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.inspector-media strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
}
.inspector-media .media-copy span {
  color: rgb(var(--md-on-surface-muted));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-clear {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.media-clear:hover {
  background: rgb(var(--md-on-surface-variant) / 0.12);
}
.media-clear :deep(svg) {
  width: 13px;
  height: 13px;
}
.inspector-media-state {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgb(var(--md-surface-container-low) / 0.55);
  color: rgb(var(--md-on-surface-muted));
  font-size: 9.5px;
  line-height: 1.45;
  min-width: 0;
}
.inspector-media-state :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.inspector-media-state span {
  min-width: 0;
  overflow-wrap: break-word;
}

/* ---------------- 提示 / 错误 ---------------- */
.inspector-hint {
  margin: 0;
  color: rgb(var(--md-on-surface-muted));
  font-size: 10px;
  line-height: 1.55;
}
.inspector-error {
  margin: 0;
  padding: 7px 9px;
  border-radius: 9px;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgb(var(--md-error));
  background: rgb(var(--md-error) / 0.1);
  overflow-wrap: break-word;
}

/* 运行控制：旁路 / 禁用两行（开关靠右，标题 + 说明在左） */
.flag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.22);
}
.flag-row:first-of-type {
  border-top: 0;
}
.flag-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.flag-copy .row-title {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}

/* ---------------- 按钮（ai-board .md-button） ---------------- */
.inspector-inline-actions,
.inspector-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.inspector-actions {
  margin-top: 4px;
}
.inspector-actions.secondary {
  gap: 4px;
  margin-top: -6px;
}
.md-button {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.1px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  color: rgb(var(--md-primary));
  background: transparent;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}
.md-button:active {
  transform: scale(0.97);
}
.md-button :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  display: block;
}
.md-button[data-variant="filled"] {
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.md-button[data-variant="filled"]:hover {
  filter: brightness(1.06);
}
.md-button[data-variant="outlined"] {
  background: transparent;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  color: rgb(var(--md-on-surface));
}
.md-button[data-variant="outlined"]:hover {
  background: rgb(var(--md-on-surface) / 0.08);
}
.md-button[data-variant="text"] {
  height: 30px;
  padding: 0 10px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11.5px;
}
.md-button[data-variant="text"]:hover {
  background: rgb(var(--md-primary) / 0.08);
}
.inspector-actions.secondary .md-button[data-variant="text"] {
  color: rgb(var(--md-on-surface-variant));
  padding: 0 8px;
}
.inspector-actions.secondary .md-button[data-variant="text"]:hover {
  background: rgb(var(--md-on-surface-variant) / 0.1);
  color: rgb(var(--md-on-surface));
}
.md-button.danger {
  color: rgb(var(--md-error));
  border-color: rgb(var(--md-error) / 0.5);
}
.md-button.danger:hover {
  background: rgb(var(--md-error) / 0.1);
}

/* ---------------- 空态 ---------------- */
.inspector-empty {
  margin: auto;
  padding: 28px 18px;
  text-align: center;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.inspector-empty-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  margin-bottom: 6px;
}
.inspector-empty-icon :deep(svg) {
  width: 22px;
  height: 22px;
}
/* 值节点的编辑器在卡上是无边界的；检查器里要看起来像一个输入框。 */
.md-field :deep(.value-editor-textarea) {
  box-sizing: border-box;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: 10px;
  background: rgb(var(--md-surface-container-lowest) / 0.4);
  padding: 8px 10px;
  resize: vertical;
}

.md-field :deep(.value-editor-boolean),
.md-field :deep(.step) {
  width: fit-content;
}

.inspector-empty-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.inspector-empty-hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}

@media (prefers-reduced-motion: reduce) {
  .md-button,
  .asset-thumb-remove {
    transition: none;
  }
}
</style>
