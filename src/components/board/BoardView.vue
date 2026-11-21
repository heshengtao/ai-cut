<script setup lang="ts">
/**
 * 无限画布（Vue Flow）：视图 + 交互层。
 *
 * 交互按 ai-board 复刻：双层点阵背景、左下小地图、浮动工具栏、右键菜单
 * （节点 / 连线 / 空白）、文件拖入建输入节点、连线端口类型校验、框选、
 * Delete 删除、⌘A 全选、⌘D 复制。
 *
 * 节点数据真相在 `board` store（最终落进工程 `board` 字段），这里只做映射。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  VueFlow,
  useVueFlow,
  type Connection,
  ConnectionMode,
  type Edge,
  type EdgeMouseEvent,
  type EdgeTypesObject,
  type Node,
  SelectionMode,
  type NodeMouseEvent,
  type NodeTypesObject,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import {
  ArrowsPointingOutIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  BoltIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  HandRaisedIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  Squares2X2Icon,
  SquaresPlusIcon,
  Square3Stack3DIcon,
  StopIcon,
  TableCellsIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ScissorsIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";
import BoardNodeCard from "./BoardNode.vue";
import BoardEdgeCard from "./BoardEdge.vue";
import BoardMenu from "./BoardMenu.vue";
import NumberField from "@/components/common/NumberField.vue";
import FloppyDiskIcon from "@/components/common/icons/FloppyDiskIcon.vue";
import type { BoardMenuItem } from "./BoardMenuList.vue";
import { categoryIcon, nodeIcon } from "./nodeIcons";
import { useI18n } from "@/i18n";
import { useBoardStore } from "@/stores/board";
import { useLayoutStore } from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { useBoardRun } from "@/composables/useBoardRun";
import {
  readWorkflowGroup,
  useWorkflowLibrary,
} from "@/composables/useWorkflowLibrary";
import { useAssetDownload } from "@/composables/useAssetDownload";
import { portsCompatible } from "@/core/board/schema";
import { wouldCreateCycle } from "@/core/board/graph";
import {
  BOARD_NODES,
  boardRegistryRevision,
  nodeDefinition,
  nodesByCategory,
  portsOf,
} from "@/core/board/registry";
import { boardCloudPresets, boardCloudProviders } from "@/composables/useBoardCloudOptions";
import { useBoardPortContext } from "@/composables/useBoardPortContext";
import { mediaNodeSize } from "@/core/board/mediaFit";
import { useModelsStore } from "@/stores/models";
import {
  connectCandidates,
  type ConnectCandidate,
  type ConnectDirection,
} from "@/core/board/connect";
import { connectedNodePosition, type BoardRect } from "@/core/board/placement";
import { addAsset } from "@/core/ops";
import { importAssetAt, kindFromPath } from "@/core/media";
import { toast } from "@/composables/useToast";
import { clearDragPayload, getDragPayload } from "@/core/dragPayload";
import { parseWorkflow } from "@/core/board/workflow";
import { useTextPresetsStore } from "@/stores/textPresets";
import type {
  BoardCategory,
  BoardNodeData,
  BoardPortSpec,
  BoardPortType,
  BoardRunMode,
} from "@/types/board";
import type { BoardNode } from "@/types/board";
import type { AssetKind, MediaAsset } from "@/types/project";

const i18n = useI18n();
const board = useBoardStore();
const layout = useLayoutStore();
const project = useProjectStore();
const models = useModelsStore();

/** 动态端口（H3 参考 / 多图 / 分轨）的上下文：云端服务类型 + 本地模型家族。 */
const portContext = useBoardPortContext();
const run = useBoardRun();
const library = useWorkflowLibrary();
const textPresets = useTextPresetsStore();
const { download } = useAssetDownload();

const nodeTypes = { board: BoardNodeCard } as unknown as NodeTypesObject;
const edgeTypes = { board: BoardEdgeCard } as unknown as EdgeTypesObject;

// shallowRef：Vue Flow 的 Node/Edge 泛型嵌套很深，ref 的深度解包会触发 TS 递归上限。
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const rootEl = ref<HTMLElement | null>(null);
const dropActive = ref(false);
const dropHint = ref("");

type MenuState =
  | { kind: "add"; anchor: DOMRect }
  | {
      kind: "connect";
      x: number;
      y: number;
      /** 拖线的锚点节点（新节点会接在它下游 / 上游）。 */
      nodeId: string;
      direction: ConnectDirection;
    }
  | { kind: "runMode"; anchor: DOMRect }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string }
  | { kind: "pane"; x: number; y: number };

const menu = ref<MenuState | null>(null);
/** ai-board 的两种交互模式：拖动画面 / 框选。 */
const interactionMode = ref<"drag" | "marquee">("drag");
const gridSnap = ref(true);

const {
  fitView,
  getViewport,
  setViewport,
  onViewportChange,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onMoveEnd,
  onConnectStart,
  onConnectEnd,
  getNodes,
  getSelectedNodes,
  onNodesInitialized,
  updateNode,
} = useVueFlow();

const groups = computed(() => {
  // 插件注册 / 卸载节点后，「添加节点」菜单要跟着变（注册表本身不是响应式的）。
  void boardRegistryRevision();
  return nodesByCategory();
});

/**
 * Vue Flow 1.x 没有 `selectionOnDrag`：框选靠 `selectionKeyCode` 驱动。
 * 框选模式下把它设成 `true`（无需按键即可拖框），拖动模式下退回默认的 Shift。
 * 这里再把 Vue Flow 的选中集合与 store 双向同步，框选后检查器/右键菜单才认这些节点。
 */
function unwrapList<T>(source: unknown): T[] {
  const raw = source as { value?: T[] } | T[] | undefined;
  if (Array.isArray(raw)) return raw;
  return (raw?.value ?? []) as T[];
}

const flowSelectedIds = computed(() =>
  unwrapList<{ id: string }>(getSelectedNodes)
    .filter((node) => Boolean((node as { selected?: boolean }).selected))
    .map((node) => node.id)
    .join(","),
);

watch(
  flowSelectedIds,
  (joined) => {
    const ids = joined ? joined.split(",") : [];
    if (ids.join(",") === board.selection.join(",")) return;
    board.select(ids);
  },
  { flush: "post" },
);

watch(
  () => board.selection.join(","),
  (joined) => {
    const wanted = new Set(joined ? joined.split(",") : []);
    for (const node of unwrapList<{ id: string; selected?: boolean }>(getNodes)) {
      const shouldSelect = wanted.has(node.id);
      if (Boolean(node.selected) !== shouldSelect) {
        // Node 的类型里没有 selected（那是 GraphNode 的运行时字段），这里按运行时用法写。
        updateNode(node.id, { selected: shouldSelect } as never);
      }
    }
  },
  { flush: "post" },
);

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.2;

/** 缩放级别：拖动 / 捏合过程中实时更新（不只等惯性结束）。 */
const liveZoom = ref(board.viewport.zoom || 1);
const zoomLabel = computed(() => `${Math.round(liveZoom.value * 100)}%`);

let zoomFrame = 0;
let zoomTarget = liveZoom.value;
let zoomAnchor: { x: number; y: number } | null = null;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** 以指针（或视口中心）为锚点立即应用一次缩放。 */
function applyZoom(zoom: number, anchor: { x: number; y: number } | null): void {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return;
  const viewport = getViewport();
  const px = (anchor?.x ?? rect.left + rect.width / 2) - rect.left;
  const py = (anchor?.y ?? rect.top + rect.height / 2) - rect.top;
  const scale = zoom / viewport.zoom;
  void setViewport(
    {
      x: px - (px - viewport.x) * scale,
      y: py - (py - viewport.y) * scale,
      zoom,
    },
    { duration: 0 },
  );
  liveZoom.value = zoom;
}

/** 每帧向目标靠近一点：滚轮 / 捏合 / 按钮共用同一条缓动，不会一格一格跳。 */
function stepZoom(): void {
  const current = getViewport().zoom;
  const diff = zoomTarget - current;
  if (Math.abs(diff) < 0.002) {
    applyZoom(zoomTarget, zoomAnchor);
    zoomFrame = 0;
    // 程序化缩放不会触发 moveEnd，这里主动把视口写回工程。
    board.setViewport(getViewport());
    return;
  }
  applyZoom(current + diff * 0.32, zoomAnchor);
  zoomFrame = requestAnimationFrame(stepZoom);
}

function zoomBy(factor: number, anchor: { x: number; y: number } | null): void {
  const base = zoomFrame ? zoomTarget : getViewport().zoom;
  zoomTarget = clampZoom(base * factor);
  zoomAnchor = anchor;
  if (!zoomFrame) zoomFrame = requestAnimationFrame(stepZoom);
}

/** ⌘ / Ctrl + 滚轮（含触控板捏合）= 平滑缩放；普通滚轮仍然平移画布。 */
function onWheelZoom(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY;
  zoomBy(Math.exp(-delta * 0.0022), { x: event.clientX, y: event.clientY });
}
const repeatMode = computed(() => run.mode.value === "repeat");
/** 运行模式在运行按钮上的短标签（手动模式只留一个展开箭头）。 */
const runModeShort = computed(() =>
  run.mode.value === "manual" ? "" : i18n.t(`board.run.modeShort.${run.mode.value}`),
);
const runModeTip = computed(() =>
  i18n.t("board.run.modeTip", { mode: i18n.t(`board.run.${run.mode.value}`) }),
);

/** 文档节点 → Vue Flow 节点（卡片组件自己从 store 取数据）。 */
function toFlowNode(node: BoardNode): Node {
  const definition = nodeDefinition(node.type);
  const size = node.size ?? definition?.defaultSize ?? { width: 240, height: 160 };
  return {
    id: node.id,
    type: "board",
    position: { ...node.position },
    data: { nodeId: node.id },
    style: { width: `${size.width}px`, height: `${size.height}px` },
  };
}

function syncNodes(): void {
  const existing: Record<string, Node> = {};
  for (const node of flowNodes.value) existing[node.id] = node;
  // 组节点排在最前面：DOM 顺序就是绘制顺序，组框才会落在成员的下面
  // （又不靠 z-index，免得盖住连线 / 选择框）。
  const ordered = [
    ...board.nodes.filter((node) => node.type === "group"),
    ...board.nodes.filter((node) => node.type !== "group"),
  ];
  flowNodes.value = ordered.map((node) => {
    const current = existing[node.id];
    if (!current) return toFlowNode(node);
    const definition = nodeDefinition(node.type);
    const size = node.size ?? definition?.defaultSize ?? { width: 240, height: 160 };
    return {
      ...current,
      position: { ...node.position },
      style: { width: `${size.width}px`, height: `${size.height}px` },
    };
  });
}

function syncEdges(): void {
  // 节点 UI 永远是一进一出：连线只认 `in` / `out` 两个锚点，具体走哪个逻辑
  // 端口由边自己的 `sourcePort` / `targetPort` 记录，检查器里配置。
  flowEdges.value = board.edges.map((edge) => ({
    id: edge.id,
    type: "board",
    source: edge.source,
    sourceHandle: "out",
    target: edge.target,
    targetHandle: "in",
    data: edge.kind === "pair" ? { pair: true } : undefined,
  }));
}

watch(() => board.nodes, syncNodes, { deep: false });
watch(() => board.edges, syncEdges, { deep: false });
/**
 * 插件注册 / 卸载节点后重新排一次尺寸：插件节点创建时没存 `size`，
 * 卡片尺寸来自定义里的 `defaultSize`，定义晚到就得再同步一遍。
 */
watch(boardRegistryRevision, syncNodes);

onMounted(() => {
  void models.load();
  void boardCloudProviders();
  void boardCloudPresets();
});

/** 屏幕坐标 → 画布坐标（用容器矩形 + 当前 viewport 自己算，不依赖 flow 内部状态）。 */
function toFlowPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = rootEl.value?.getBoundingClientRect();
  const zoom = board.viewport.zoom || 1;
  if (!rect) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.left - board.viewport.x) / zoom,
    y: (clientY - rect.top - board.viewport.y) / zoom,
  };
}

function centerPoint(): { x: number; y: number } {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return toFlowPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function anchorRect(event: MouseEvent): DOMRect {
  return (event.currentTarget as HTMLElement).getBoundingClientRect();
}

/** 单出口节点真正发布的那一路（画布锚点固定是 `out`）。 */
function sourcePortOf(node: BoardNode): BoardPortSpec | null {
  return portsOf(node, portContext.value).outputs[0] ?? null;
}

/**
 * 连到某个下游时，从节点的多路输出里挑一路类型兼容的。
 *
 * 画布只有一个 `out` 锚点：视频音频分离 / 音频分离这类多输出节点，拖到
 * 音频输入就自动先接音频那一路，要换别的路子在检查器里改。
 */
function sourcePortFor(source: BoardNode, target: BoardNode): BoardPortSpec | null {
  const outputs = portsOf(source, portContext.value).outputs;
  const inputs = portsOf(target, portContext.value).inputs;
  return (
    outputs.find((output) =>
      inputs.some((input) => portsCompatible(output.type, input.type)),
    ) ??
    outputs[0] ??
    null
  );
}

/** 某个输入端口当前接了几个上游。 */
function boundCount(nodeId: string, portId: string): number {
  return board.edges.filter((edge) => edge.target === nodeId && edge.targetPort === portId).length;
}

/**
 * 单入口节点的真实输入端口：和来源类型兼容、优先还没接满的那一个。
 *
 * 多路输入（H3 的 9 图 / 3 音频 / 3 视频、多图参考）都合并成一个端口，
 * 这里按 max 判断是否还能再接；max = 1 的端口保持旧行为（再连就替换）。
 */
function targetPortOf(node: BoardNode, sourceType: BoardPortType): BoardPortSpec | null {
  const candidates = portsOf(node, portContext.value).inputs.filter((port) =>
    portsCompatible(sourceType, port.type),
  );
  if (candidates.length === 0) return null;
  const open = candidates.find(
    (port) => boundCount(node.id, port.id) < (port.max ?? 1),
  );
  if (open) return open;
  // 单路端口：再连一根就替换原来那根。
  return candidates.find((port) => (port.max ?? 1) === 1) ?? null;
}

/** 连线前校验端口类型：不兼容直接拒绝（Vue Flow 会显示禁止光标）。 */
function isValidConnection(connection: Connection): boolean {
  const source = board.nodes.find((node) => node.id === connection.source);
  const target = board.nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return false;
  // 接上会成环的线不画（否则输入下拉 / 调度器都会绕进死循环）。
  if (wouldCreateCycle(board.edges, source.id, target.id)) return false;
  const from = sourcePortFor(source, target);
  if (!from) return false;
  return targetPortOf(target, from.type) !== null;
}

/**
 * 拖线到空白处：记住锚点与方向，松手后弹「兼容节点选择器」。
 *
 * 两个方向都支持（对齐 ai-board）：
 * - 从输出端拖出 → 列出**能消费这个输出**的节点，新节点接在锚点下游；
 * - 从输入端拖出 → 列出**能喂这个输入**的节点，新节点接在锚点上游。
 */
let pendingConnect: { nodeId: string; direction: ConnectDirection } | null = null;

onConnectStart((payload) => {
  if (!payload.nodeId) {
    pendingConnect = null;
    return;
  }
  const node = board.nodes.find((item) => item.id === payload.nodeId);
  if (!node) {
    pendingConnect = null;
    return;
  }
  if (payload.handleType === "source") {
    pendingConnect = sourcePortOf(node) ? { nodeId: node.id, direction: "forward" } : null;
    return;
  }
  pendingConnect =
    portsOf(node, portContext.value).inputs.length > 0
      ? { nodeId: node.id, direction: "backward" }
      : null;
});

onConnectEnd((event) => {
  const source = pendingConnect;
  pendingConnect = null;
  if (!source || !event) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".vue-flow__node")) return;
  const point =
    "clientX" in event
      ? { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }
      : null;
  if (!point) return;
  menu.value = { kind: "connect", ...point, ...source };
});

function nodeRect(node: BoardNode): BoardRect {
  const size = node.size ?? nodeDefinition(node.type)?.defaultSize ?? { width: 240, height: 160 };
  return { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

/**
 * 选中兼容节点后：建节点并连上。
 *
 * 落点交给 `connectedNodePosition`：横向按「锚点 + 80px 间距」留出距离，
 * 纵向跟随松手位置，再做一次避让（不会压在原节点或别的节点上）。
 */
function connectToNew(
  state: { x: number; y: number; nodeId: string; direction: ConnectDirection },
  candidate: ConnectCandidate,
): void {
  const anchor = board.nodes.find((item) => item.id === state.nodeId);
  if (!anchor) return;
  const drop = toFlowPoint(state.x, state.y);
  const position = connectedNodePosition({
    direction: state.direction,
    anchor: nodeRect(anchor),
    size: candidate.definition.defaultSize,
    drop,
    nodes: board.nodes.map(nodeRect),
    snap: gridSnap.value ? 22 : 1,
  });
  const id = crypto.randomUUID();
  board.addNode({
    id,
    type: candidate.definition.type,
    position,
    data: { params: {}, bindings: {} },
  });
  const forward = state.direction === "forward";
  board.connect({
    id: crypto.randomUUID(),
    source: forward ? anchor.id : id,
    sourcePort: forward ? candidate.anchorPort.id : candidate.port.id,
    target: forward ? id : anchor.id,
    targetPort: forward ? candidate.port.id : candidate.anchorPort.id,
  });
  board.select([id]);
}

function onConnect(connection: Connection): void {
  const source = board.nodes.find((node) => node.id === connection.source);
  const target = board.nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return;
  const from = sourcePortFor(source, target);
  if (!from) return;
  const to = targetPortOf(target, from.type);
  if (!to) return;
  board.connect({
    id: crypto.randomUUID(),
    source: source.id,
    sourcePort: from.id,
    target: target.id,
    targetPort: to.id,
  });
}

/** 添加节点：默认落在视口中心；右键 / 拖入时落在鼠标处。返回新节点 id。 */
function addNode(type: string, at?: { x: number; y: number }, data?: Partial<BoardNodeData>): string | null {
  const definition = nodeDefinition(type);
  if (!definition) return null;
  const point = at ?? centerPoint();
  const id = crypto.randomUUID();
  board.addNode({
    id,
    type,
    position: {
      x: Math.round(point.x - definition.defaultSize.width / 2),
      y: Math.round(point.y - definition.defaultSize.height / 2),
    },
    data: { params: {}, bindings: {}, ...data },
  });
  void nextTick(() => {
    if (board.nodes.length === 1) {
      void fitView({ padding: 0.35, duration: 260, maxZoom: FIT_MAX_ZOOM });
    }
  });
  return id;
}

/** 素材类型 → 输入节点类型。 */
function inputTypeOf(kind: AssetKind): string {
  return kind === "image" ? "input.image" : kind === "video" ? "input.video" : "input.audio";
}

/** 按素材原始比例给图片 / 视频节点一个合适的初始高度（与卡片内的 fit 共用一份规则）。 */
function fitNodeToAsset(id: string, asset: MediaAsset, width: number): void {
  if (asset.kind === "audio" || !asset.width || !asset.height) return;
  board.resizeNode(id, mediaNodeSize(width, asset.width, asset.height), { record: false });
}

/** 素材库拖到空白处：建一个对应的输入节点并把素材挂上去。 */
function createInputNode(asset: MediaAsset, at: { x: number; y: number }): void {
  const definition = nodeDefinition(inputTypeOf(asset.kind));
  if (!definition) return;
  const width = definition.defaultSize.width;
  const payload: Partial<BoardNodeData> =
    asset.kind === "image"
      ? { assetIds: [asset.id], stackIndex: 0, assetId: asset.id }
      : { assetId: asset.id, assetIds: undefined };
  const id = addNode(inputTypeOf(asset.kind), at, payload);
  if (!id) return;
  fitNodeToAsset(id, asset, width);
}

function duplicateNode(nodeId: string): void {
  // 多选（或组）时整段复制：选中的节点 + 它们之间的连线。
  if (board.selection.length > 1 && board.selection.includes(nodeId)) {
    board.duplicateSelection(board.selection);
    return;
  }
  board.duplicateNode(nodeId);
}

/** 下游节点 id（BFS），用于「运行下游」。 */
function downstreamOf(nodeId: string): string[] {
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

/** 运行整组：组员各自入队（调度器会按依赖与资源排）。 */
function runGroup(groupId: string): void {
  const group = board.nodes.find((item) => item.id === groupId);
  if (!group) return;
  const members = board.expandGroups([groupId]);
  const ids = members.length > 0 ? members : (group.data.children ?? []);
  for (const id of ids) run.runNode(id);
}

function runDownstream(nodeId: string): void {
  run.runNode(nodeId);
  for (const id of downstreamOf(nodeId)) {
    const node = board.nodes.find((item) => item.id === id);
    if (node && !node.data.ignored) run.runNode(id);
  }
}

/** 多选 / 整组运行：组节点展开成组员，其余节点各入队一次。 */
function runNodes(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    const node = board.nodes.find((item) => item.id === id);
    if (!node) continue;
    const members = node.type === "group" ? board.expandGroups([id]) : [id];
    for (const member of members) {
      if (seen.has(member)) continue;
      seen.add(member);
      run.runNode(member);
    }
  }
}

function runDownstreamMany(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    const node = board.nodes.find((item) => item.id === id);
    if (!node) continue;
    const roots = node.type === "group" ? board.expandGroups([id]) : [id];
    for (const root of roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      runDownstream(root);
    }
  }
}

function selectAll(): void {
  board.select(board.nodes.map((node) => node.id));
}

/** 清空画布：先把当前工作流快速存进工作流库（和历史工程一致），再清空。 */
function clearBoard(): void {
  void library.clearCanvas();
}

const nodeMenuTarget = computed(() =>
  menu.value?.kind === "node"
    ? board.nodes.find((node) => node.id === (menu.value as { nodeId: string }).nodeId) ?? null
    : null,
);
const nodeMenuAsset = computed(() => {
  const target = nodeMenuTarget.value;
  if (!target) return null;
  const id = target.data.outputAssetId ?? target.data.assetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});

/**
 * 右键操作的目标集合：右键的节点在多选里就操作整个选择，否则只操作它。
 *
 * 框选 / Shift 多选后右键，删除、禁用、旁路、重建、复制、剪切、运行都作用于
 * 所有选中节点（组会展开到组员）。
 */
const nodeActionIds = computed<string[]>(() => {
  const target = nodeMenuTarget.value;
  if (!target) return [];
  return board.selection.includes(target.id) && board.selection.length > 1
    ? [...board.selection]
    : [target.id];
});

/** 添加节点菜单：按分类做子菜单（节点选项带图标）。 */
function addSubmenus(): BoardMenuItem[] {
  const list: BoardMenuItem[] = [];
  for (const category of ["input", "display", "model", "group"] as BoardCategory[]) {
    const nodes = groups.value[category];
    if (!nodes || nodes.length === 0) continue;
    list.push({
      kind: "submenu",
      id: `add-${category}`,
      label: i18n.t(`board.category.${category}`),
      icon: categoryIcon(category),
      items: nodes.map((definition) => ({
        kind: "action" as const,
        id: `add-${definition.type}`,
        label: i18n.t(definition.menuTitleKey ?? definition.titleKey),
        icon: nodeIcon(definition.type),
        hint: definition.type,
        searchText: `${definition.type} ${i18n.t(definition.menuTitleKey ?? definition.titleKey)}`,
        run: () => addNode(definition.type),
      })),
    });
  }
  return list;
}

const menuItems = computed<BoardMenuItem[]>(() => {
  const current = menu.value;
  if (!current) return [];

  if (current.kind === "add") {
    return [
      { kind: "label", id: "add-label", label: i18n.t("board.addNode") },
      ...addSubmenus(),
    ];
  }

  if (current.kind === "connect") {
    const anchor = board.nodes.find((item) => item.id === current.nodeId);
    if (!anchor) return [];
    const anchorPorts = portsOf(anchor, portContext.value);
    // 多路输入：只拿还有空位的端口；全满了就沿用原端口（连接会被拒绝）。
    const available = anchorPorts.inputs.filter(
      (port) => boundCount(anchor.id, port.id) < (port.max ?? 1),
    );
    const inputs = [...(available.length > 0 ? available : anchorPorts.inputs)].sort(
      (a, b) =>
        Number(boundCount(anchor.id, a.id) < (a.max ?? 1)) -
        Number(boundCount(anchor.id, b.id) < (b.max ?? 1)),
    );
    const candidates = connectCandidates({
      direction: current.direction,
      anchorInputs: inputs,
      anchorOutputs: anchorPorts.outputs,
      definitions: BOARD_NODES,
    });
    const labelKey =
      current.direction === "forward" ? "board.connect.title" : "board.connect.fromInput";
    return [
      { kind: "label", id: "connect-label", label: i18n.t(labelKey) },
      ...(candidates.length === 0
        ? [
            {
              kind: "label" as const,
              id: "connect-none",
              label: i18n.t("board.connect.none"),
            },
          ]
        : candidates.map((candidate) => ({
            kind: "action" as const,
            id: `connect-${candidate.definition.type}`,
            label: i18n.t(candidate.definition.menuTitleKey ?? candidate.definition.titleKey),
            icon: nodeIcon(candidate.definition.type),
            hint: candidate.definition.type,
            searchText: `${candidate.definition.type} ${i18n.t(candidate.definition.menuTitleKey ?? candidate.definition.titleKey)}`,
            run: () => connectToNew(current, candidate),
          }))),
    ];
  }

  if (current.kind === "runMode") {
    const modes: { value: BoardRunMode; labelKey: string }[] = [
      { value: "manual", labelKey: "board.run.manual" },
      { value: "always", labelKey: "board.run.always" },
      { value: "repeat", labelKey: "board.run.repeat" },
    ];
    return [
      { kind: "label", id: "mode-label", label: i18n.t("board.run.mode") },
      ...modes.map((mode) => ({
        kind: "action" as const,
        id: `mode-${mode.value}`,
        label: i18n.t(mode.labelKey),
        checked: run.mode.value === mode.value,
        run: () => {
          run.mode.value = mode.value;
        },
      })),
      { kind: "separator", id: "mode-sep" },
      { kind: "label", id: "sched-label", label: i18n.t("board.run.schedule") },
      {
        kind: "action",
        id: "smart-order",
        label: i18n.t("board.run.smartOrder"),
        hint: i18n.t("board.run.smartOrderHint"),
        checked: run.smartOrder.value,
        run: () => {
          run.smartOrder.value = !run.smartOrder.value;
        },
      },
      {
        kind: "action",
        id: "smart-memory",
        label: i18n.t("board.run.smartMemory"),
        hint: i18n.t("board.run.smartMemoryHint"),
        checked: run.smartMemory.value,
        run: () => {
          run.smartMemory.value = !run.smartMemory.value;
        },
      },
      ...(run.plan.value
        ? [
            {
              kind: "label" as const,
              id: "plan-summary",
              label: i18n.t("board.run.plan", {
                instant: run.plan.value.lanes.instant,
                api: run.plan.value.lanes.api,
                gpu: run.plan.value.lanes.gpu,
                cpu: run.plan.value.lanes.cpu,
              }),
            },
          ]
        : []),
    ];
  }

  if (current.kind === "node") {
    const target = nodeMenuTarget.value;
    if (!target) return [];
    const actionIds = nodeActionIds.value;
    const isGroup = target.type === "group";
    const groupItems: BoardMenuItem[] = isGroup
      ? [
          {
            kind: "action",
            id: "group-run",
            label: i18n.t("board.ctx.groupRun"),
            icon: PlayIcon,
            disabled: target.data.ignored || target.data.bypassed,
            run: () => runGroup(target.id),
          },
          {
            kind: "action",
            id: "group-select",
            label: i18n.t("board.ctx.groupSelect"),
            icon: Squares2X2Icon,
            run: () => board.select([target.id, ...(target.data.children ?? [])]),
          },
          {
            kind: "action",
            id: "group-ungroup",
            label: i18n.t("board.ctx.ungroup"),
            icon: Square3Stack3DIcon,
            run: () => board.ungroup(target.id),
          },
          {
            kind: "action",
            id: "group-toggle",
            label: target.data.ignored ? i18n.t("board.ctx.enable") : i18n.t("board.ctx.ignore"),
            icon: target.data.ignored ? EyeIcon : EyeSlashIcon,
            run: () =>
              board.setGroupFlag(target.id, { ignored: !target.data.ignored }),
          },
          {
            kind: "action",
            id: "group-bypass",
            label: target.data.bypassed
              ? i18n.t("board.ctx.bypassOff")
              : i18n.t("board.ctx.bypass"),
            icon: ArrowsRightLeftIcon,
            run: () =>
              board.setGroupFlag(target.id, { bypassed: !target.data.bypassed }),
          },
          { kind: "separator", id: "group-sep" },
        ]
      : [];
    return [
      ...(actionIds.length > 1
        ? [
            {
              kind: "label" as const,
              id: "selection-hint",
              label: i18n.t("board.ctx.selectionHint", { count: actionIds.length }),
            },
          ]
        : []),
      {
        kind: "action",
        id: "run",
        label: i18n.t("board.ctx.run"),
        icon: PlayIcon,
        disabled: target.data.ignored || target.data.bypassed || isGroup,
        keys: ["⌘", "↵"],
        run: () => runNodes(actionIds),
      },
      {
        kind: "action",
        id: "run-downstream",
        label: i18n.t("board.ctx.runDownstream"),
        icon: BoltIcon,
        disabled: target.data.ignored || target.data.bypassed || isGroup,
        run: () => runDownstreamMany(actionIds),
      },
      {
        kind: "action",
        id: "rebuild",
        label: isGroup ? i18n.t("board.ctx.rebuildGroup") : i18n.t("board.ctx.rebuild"),
        hint: i18n.t("board.ctx.rebuildHint"),
        icon: ArrowPathIcon,
        // 组节点的「重建」= 组员一起重建（保留标题 / 连线 / 成员）。
        disabled: target.data.ignored || target.data.bypassed,
        run: () => board.resetNodes(actionIds),
      },
      { kind: "separator", id: "sep-1" },
      ...groupItems,
      {
        kind: "action",
        id: "edit",
        label: i18n.t("board.ctx.edit"),
        icon: PencilSquareIcon,
        run: () => {
          layout.openTab("boardInspector");
          board.select([target.id]);
        },
      },
      {
        kind: "action",
        id: "duplicate",
        label: i18n.t("board.ctx.duplicate"),
        icon: DocumentDuplicateIcon,
        keys: ["⌘", "D"],
        run: () => duplicateNode(target.id),
      },
      {
        kind: "action",
        id: "copy",
        label: i18n.t("board.ctx.copy"),
        icon: DocumentDuplicateIcon,
        keys: ["⌘", "C"],
        run: () => {
          const count = board.copySelection(actionIds);
          if (count > 0) toast(i18n.t("board.ctx.copied", { count }));
        },
      },
      {
        kind: "action",
        id: "cut",
        label: i18n.t("board.ctx.cut"),
        icon: ScissorsIcon,
        keys: ["⌘", "X"],
        run: () => {
          const count = board.cutSelection(actionIds);
          if (count > 0) toast(i18n.t("board.ctx.copied", { count }));
        },
      },
      {
        kind: "action",
        id: "paste",
        label: i18n.t("board.ctx.paste"),
        icon: PlusIcon,
        keys: ["⌘", "V"],
        disabled: !board.clipboard,
        run: () => {
          const ids = board.pasteClipboard();
          if (ids.length > 0) toast(i18n.t("board.ctx.pasted", { count: ids.length }));
        },
      },
      {
        kind: "action",
        id: "toggle",
        label: target.data.ignored ? i18n.t("board.ctx.enable") : i18n.t("board.ctx.ignore"),
        icon: target.data.ignored ? EyeIcon : EyeSlashIcon,
        run: () => board.setNodeFlags(actionIds, { ignored: !target.data.ignored }),
      },
      {
        kind: "action",
        id: "bypass",
        label: target.data.bypassed ? i18n.t("board.ctx.bypassOff") : i18n.t("board.ctx.bypass"),
        icon: ArrowsRightLeftIcon,
        run: () => board.setNodeFlags(actionIds, { bypassed: !target.data.bypassed }),
      },
      {
        kind: "action",
        id: "group-create",
        label: i18n.t("board.ctx.groupCreate"),
        hint: i18n.t("board.ctx.groupCreateHint"),
        icon: Square3Stack3DIcon,
        disabled: actionIds.length < 2 && board.selection.length < 2,
        keys: ["⌘", "G"],
        run: () => {
          const ids = actionIds.length >= 2 ? actionIds : board.selection;
          board.createGroup(ids);
        },
      },
      // 只有节点当前有素材（输入素材 / 已发布的产物）时才显示下载，避免菜单里
      // 永远挂一条灰着的项让人猜它是干嘛的。
      ...(nodeMenuAsset.value
        ? [
            {
              kind: "action" as const,
              id: "download",
              label: i18n.t("board.ctx.download"),
              hint: i18n.t("board.ctx.downloadHint"),
              icon: ArrowDownTrayIcon,
              run: () => {
                const asset = nodeMenuAsset.value;
                if (asset) void download(asset);
              },
            },
          ]
        : []),
      { kind: "separator", id: "sep-2" },
      {
        kind: "action",
        id: "delete",
        label: i18n.t("common.delete"),
        icon: TrashIcon,
        danger: true,
        keys: ["Del"],
        run: () => board.removeNodes(actionIds),
      },
    ];
  }

  if (current.kind === "edge") {
    const edgeId = current.edgeId;
    return [
      {
        kind: "action",
        id: "remove-edge",
        label: i18n.t("board.ctx.removeEdge"),
        icon: TrashIcon,
        danger: true,
        keys: ["Del"],
        run: () => board.removeEdges([edgeId]),
      },
    ];
  }

  // pane
  return [
    {
      kind: "submenu",
      id: "pane-add",
      label: i18n.t("board.addNode"),
      icon: SquaresPlusIcon,
      items: addSubmenus(),
    },
    { kind: "separator", id: "pane-sep-1" },
    {
      kind: "action",
      id: "paste",
      label: i18n.t("board.ctx.paste"),
      icon: PlusIcon,
      keys: ["⌘", "V"],
      disabled: !board.clipboard,
      run: () => {
        const ids = board.pasteClipboard();
        if (ids.length > 0) toast(i18n.t("board.ctx.pasted", { count: ids.length }));
      },
    },
    {
      kind: "action",
      id: "select-all",
      label: i18n.t("board.ctx.selectAll"),
      icon: Squares2X2Icon,
      keys: ["⌘", "A"],
      run: selectAll,
    },
    {
      kind: "action",
      id: "fit",
      label: i18n.t("board.fit"),
      icon: ArrowsPointingOutIcon,
      run: () =>
        void fitView({ padding: 0.2, duration: 260, maxZoom: FIT_MAX_ZOOM }),
    },
    {
      kind: "action",
      id: "canvas-list",
      label: i18n.t("board.ctx.canvasList"),
      icon: Squares2X2Icon,
      run: () => {
        // 画布列表在画布检查器里：清掉选中，切到该面板。
        board.select([]);
        layout.openTab("boardInspector");
      },
    },
    { kind: "separator", id: "pane-sep-2" },
    {
      kind: "action",
      id: "clear",
      label: i18n.t("board.ctx.clear"),
      icon: TrashIcon,
      danger: true,
      run: clearBoard,
    },
  ];
});

const menuPlacement = computed(() =>
  menu.value?.kind === "add" || menu.value?.kind === "runMode" ? "above" : "point",
);
const menuSearchable = computed(
  () => menu.value?.kind === "add" || menu.value?.kind === "connect",
);
const menuAnchor = computed(() =>
  menu.value && "anchor" in menu.value ? menu.value.anchor : null,
);
const menuPoint = computed(() =>
  menu.value && "x" in menu.value ? { x: menu.value.x, y: menu.value.y } : { x: 0, y: 0 },
);

function onNodeDoubleClick(payload: { node: Node }): void {
  layout.openTab("boardInspector");
  board.select([payload.node.id]);
}

function onSelectNode(event: { node: Node }): void {
  board.select([event.node.id]);
}

function onPaneClick(): void {
  // 只清选择；菜单由"点外面关闭"负责——否则"拖线到空白松手"弹出来的兼容节点菜单
  // 会被同一轮鼠标抬起的 pane click 立刻关掉。
  board.select([]);
  selectedEdgeId.value = null;
}

function onNodeCtx(payload: NodeMouseEvent): void {
  const event = payload.event as MouseEvent;
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
  event.preventDefault();
  // 右键已选中的节点时保留多选（「创建组」等整组操作要用）；
  // 右键一个未选中的节点则改成只选它。
  if (!board.selection.includes(payload.node.id)) board.select([payload.node.id]);
  menu.value = { kind: "node", x: event.clientX, y: event.clientY, nodeId: payload.node.id };
}

/**
 * 多选后的右键：Vue Flow 的 `.vue-flow__nodesselection-rect` 盖在选中节点之上，
 * 右键会走 `selection-context-menu` 而不是节点自己的事件。这里把它接回节点菜单，
 * 主目标取一个非组节点，菜单里的操作仍作用于整个选择。
 */
function onSelectionCtx(payload: { event: MouseEvent; nodes: Node[] }): void {
  const event = payload.event;
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
  event.preventDefault();
  const targets = payload.nodes
    .map((node) => board.nodes.find((item) => item.id === node.id))
    .filter((node): node is BoardNode => Boolean(node));
  // 选择框盖在节点上面：用 elementsFromPoint 找到右键落点下面真正的节点，
  // 让「在检查器中编辑 / 组操作」对着用户点的那一个，而不是选择列表第一个。
  const under = document
    .elementsFromPoint(event.clientX, event.clientY)
    .map((el) => (el as HTMLElement).closest?.(".vue-flow__node") as HTMLElement | null)
    .find((el): el is HTMLElement => Boolean(el));
  const underId = under?.dataset.id;
  const target =
    targets.find((node) => node.id === underId) ??
    targets.find((node) => node.type !== "group") ??
    targets[0];
  if (!target) return;
  menu.value = {
    kind: "node",
    x: event.clientX,
    y: event.clientY,
    nodeId: target.id,
  };
}

function onEdgeCtx(payload: EdgeMouseEvent): void {
  const event = payload.event as MouseEvent;
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
  event.preventDefault();
  menu.value = { kind: "edge", x: event.clientX, y: event.clientY, edgeId: payload.edge.id };
}

function onPaneCtx(event: MouseEvent): void {
  event.preventDefault();
  board.select([]);
  menu.value = { kind: "pane", x: event.clientX, y: event.clientY };
}

function toggleAdd(event: MouseEvent): void {
  const current = menu.value;
  if (current?.kind === "add") {
    menu.value = null;
    return;
  }
  menu.value = { kind: "add", anchor: anchorRect(event) };
}

function toggleRunMode(event: MouseEvent): void {
  const current = menu.value;
  if (current?.kind === "runMode") {
    menu.value = null;
    return;
  }
  menu.value = { kind: "runMode", anchor: anchorRect(event) };
}

/** 拖动组：组成员跟着组框一起走（按住组标题拖动）。 */
let groupDrag: {
  id: string;
  start: { x: number; y: number };
  members: Map<string, { x: number; y: number }>;
} | null = null;

onNodeDragStart(({ node }) => {
  const group = board.nodes.find((item) => item.id === node.id && item.type === "group");
  const members = new Map<string, { x: number; y: number }>();
  if (group) {
    const byId = new Map(board.nodes.map((item) => [item.id, item]));
    for (const child of group.data.children ?? []) {
      const member = byId.get(child);
      if (member) members.set(child, { ...member.position });
    }
  }
  groupDrag = group
    ? { id: group.id, start: { x: node.position.x, y: node.position.y }, members }
    : null;
});

onNodeDrag(({ node }) => {
  if (!groupDrag || node.id !== groupDrag.id) return;
  const dx = node.position.x - groupDrag.start.x;
  const dy = node.position.y - groupDrag.start.y;
  const positions: Record<string, { x: number; y: number }> = {
    // 组自己的坐标也要同步进 store，否则 syncNodes 会用旧坐标把它拽回去。
    [groupDrag.id]: { x: node.position.x, y: node.position.y },
  };
  for (const [id, origin] of groupDrag.members) {
    positions[id] = { x: origin.x + dx, y: origin.y + dy };
  }
  board.applyPositions(positions);
});

onNodeDragStop((event) => {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of event.nodes) positions[node.id] = { x: node.position.x, y: node.position.y };
  board.applyPositions(positions);
  board.syncPositions();
  groupDrag = null;
  const moved = event.nodes
    .map((node) => board.nodes.find((item) => item.id === node.id))
    .filter((node): node is BoardNode => Boolean(node) && node!.type !== "group")
    .map((node) => node.id);
  // 拖出组框 → 离开组；拖进组框 → 加入组（对齐 ai-board 的视觉容器语义）。
  if (moved.length > 0) board.refreshGroupMembership(moved);
  // 成员被拖出组 / 组内成员增删后，组框重新贴合。
  board.syncGroupBounds();
});

onViewportChange((transform) => {
  liveZoom.value = transform.zoom;
});

onMoveEnd(({ flowTransform }) => {
  liveZoom.value = flowTransform.zoom;
  board.setViewport({ x: flowTransform.x, y: flowTransform.y, zoom: flowTransform.zoom });
});

/** 拖进来的素材 / 文本预设（素材库内部拖拽）。 */
function draggedAsset(): MediaAsset | null {
  const payload = getDragPayload();
  if (payload?.kind !== "asset") return null;
  return project.doc.assets.find((item) => item.id === payload.id) ?? null;
}

async function onFileDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  dropActive.value = false;
  const point = toFlowPoint(event.clientX, event.clientY);

  // 素材库 → 画布：不重新导入，直接建节点。
  const asset = draggedAsset();
  if (asset) {
    createInputNode(asset, point);
    clearDragPayload();
    return;
  }
  const payload = getDragPayload();
  if (payload?.kind === "text") {
    const preset = textPresets.presets.find((item) => item.id === payload.id);
    if (preset) {
      addNode("input.text", point, { title: preset.name });
    }
    clearDragPayload();
    return;
  }
  // 工作流库 → 画布：直接按当前落点插入（可指定某个历史版本）。
  if (payload?.kind === "workflow") {
    const group = await readWorkflowGroup(payload.id);
    const version = group?.versions.find((item) => item.id === payload.versionId);
    if (group) await library.insertWorkflow(group, version, point);
    clearDragPayload();
    return;
  }

  // 工作流 JSON：直接并进画布（这是「把工作流拖进来快速恢复」的那条路）。
  const files = Array.from(event.dataTransfer?.files ?? []);
  const jsonFile = files.find(
    (file) => /\.json$/i.test(file.name) || file.type === "application/json",
  );
  if (jsonFile) {
    try {
      const parsed = parseWorkflow(await jsonFile.text());
      if (!parsed) {
        toast(i18n.t("board.workflow.invalid"), "error");
        return;
      }
      const ids = board.insertWorkflow(parsed, point);
      toast(i18n.t("board.workflow.imported", { count: ids.length }));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }

  // 系统文件：导入后建对应输入节点（多个文件各建一个）。
  let created = 0;
  for (const file of files) {
    const path = (file as File & { path?: string }).path;
    if (!path) continue;
    const kind = kindFromPath(path);
    if (!kind) continue;
    try {
      const imported = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, imported));
      const type = inputTypeOf(kind);
      const definition = nodeDefinition(type);
      const id = addNode(type, point, { assetId: imported.id });
      if (id && definition) fitNodeToAsset(id, imported, definition.defaultSize.width);
      created += 1;
    } catch (error) {
      toast(String(error), "error");
    }
  }
  if (created > 1) toast(i18n.t("board.drop.imported", { count: created }));
}

function onDragOver(event: DragEvent): void {
  const asset = draggedAsset();
  const payload = getDragPayload();
  if (asset) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropActive.value = true;
    dropHint.value = i18n.t("board.drop.createNode", {
      kind: i18n.t(`board.port.${asset.kind}`),
    });
    return;
  }
  if (payload?.kind === "text") {
    event.preventDefault();
    dropActive.value = true;
    dropHint.value = i18n.t("board.drop.createNode", { kind: i18n.t("board.port.text") });
    return;
  }
  if (payload?.kind === "workflow") {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropActive.value = true;
    dropHint.value = i18n.t("board.drop.workflow");
    return;
  }
  event.preventDefault();
  dropActive.value = true;
  const types = Array.from(event.dataTransfer?.types ?? []);
  dropHint.value =
    types.includes("application/json") || types.includes("Files")
      ? i18n.t("board.workflow.dropHint")
      : i18n.t("board.dropHint");
}

function onDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as globalThis.Node | null;
  if (next && rootEl.value?.contains(next)) return;
  dropActive.value = false;
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAll();
    return;
  }
  if (mod && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (board.selection.length >= 2) board.createGroup(board.selection);
    else toast(i18n.t("board.group.needSelection"), "error");
    return;
  }
  if (mod && event.key.toLowerCase() === "d" && board.selection.length > 0) {
    event.preventDefault();
    board.duplicateSelection(board.selection);
    return;
  }
  if (mod && event.key.toLowerCase() === "c" && board.selection.length > 0) {
    event.preventDefault();
    const count = board.copySelection();
    if (count > 0) toast(i18n.t("board.ctx.copied", { count }));
    return;
  }
  if (mod && event.key.toLowerCase() === "x" && board.selection.length > 0) {
    event.preventDefault();
    const count = board.cutSelection();
    if (count > 0) toast(i18n.t("board.ctx.copied", { count }));
    return;
  }
  if (mod && event.key.toLowerCase() === "v" && board.clipboard) {
    event.preventDefault();
    const ids = board.pasteClipboard();
    if (ids.length > 0) toast(i18n.t("board.ctx.pasted", { count: ids.length }));
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    board.selection.length === 0 &&
    selectedEdgeId.value &&
    !mod
  ) {
    // 选中连线（循环配对线）时，Delete 直接删线：配对线会连两端节点一起删。
    event.preventDefault();
    board.removeEdges([selectedEdgeId.value]);
    selectedEdgeId.value = null;
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    board.selection.length > 0 &&
    !mod
  ) {
    event.preventDefault();
    board.removeNodes([...board.selection]);
    return;
  }
  if ((event.key === "Enter" || event.key === "n") && menu.value?.kind === "node") {
    event.preventDefault();
    run.runNode(menu.value.nodeId);
  }
}

/** 当前选中的连线：循环配对线靠右键 / Delete 删除，删线等于解散这对循环。 */
const selectedEdgeId = ref<string | null>(null);

function onEdgeClick(payload: { edge: { id: string } }): void {
  selectedEdgeId.value = payload.edge.id;
}

function onFlowInit(): void {
  void setViewport({ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom });
}

/** 「适应画布」的缩放上限：100%。只有一个节点时 fit 会把它放到很大、占满全屏。 */
const FIT_MAX_ZOOM = 1;

/**
 * 本进程是否已经自动「适应画布」过。
 *
 * 模块级而不是组件级：切到预览台再切回画布会重新挂载，但只有**重启后第一次**
 * 进入画布要自动居中；之后再进来沿用用户调好的视角。
 */
let fittedOnEnter = false;

/**
 * 重启后第一次进入画布：等节点测量完（`onNodesInitialized`）再 fit，
 * 否则空画布 / 尺寸还没测出来时 fit 出来的位置是错的。
 */
function fitOnFirstEnter(): void {
  if (fittedOnEnter) return;
  if (board.nodes.length === 0) return;
  fittedOnEnter = true;
  void fitCanvas();
}

onNodesInitialized(fitOnFirstEnter);

/** 把当前视图写回画布文档（fit 之后保存，切回来还是这个视角）。 */
function rememberViewport(): void {
  const viewport = getViewport();
  board.setViewport(viewport);
  liveZoom.value = viewport.zoom;
}

/**
 * 适应画布：等新画布的节点进 Vue Flow 之后再 fit。
 *
 * 切换画布时会换掉整份节点，Vue Flow 需要一帧测量尺寸；直接 fit 会按旧尺寸算，
 * 所以这里连等两个 tick。空画布不 fit（没有可居中的东西）。
 */
async function fitCanvas(): Promise<void> {
  if (board.nodes.length === 0) return;
  // 节点刚换进 Vue Flow 时可能还没测量完尺寸：fitView 会返回 false，隔一帧重试。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nextTick();
    if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, 32));
    const done = await fitView({
      padding: 0.2,
      duration: attempt === 0 ? 260 : 0,
      maxZoom: FIT_MAX_ZOOM,
    });
    if (!done) continue;
    rememberViewport();
    return;
  }
}

/**
 * 切换画布：主动适应一次。
 *
 * 每张画布虽然各存了视口，但刚切过去时用户最容易「咦，节点去哪了」——
 * 统一 fit 一次，比沿用可能已经漂走的旧视角更可靠。
 */
watch(
  () => board.activeCanvasId,
  async (id, previous) => {
    if (!id || id === previous) return;
    await fitCanvas();
  },
);

onMounted(() => {
  layout.openTab("boardInspector");
  syncNodes();
  syncEdges();
  window.addEventListener("keydown", onKeyDown);
  rootEl.value?.addEventListener("wheel", onWheelZoom, { passive: false, capture: true });
});

onUnmounted(() => {
  board.flush();
  if (zoomFrame) cancelAnimationFrame(zoomFrame);
  rootEl.value?.removeEventListener("wheel", onWheelZoom, { capture: true });
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <section
    ref="rootEl"
    class="board-view ab-canvas"
    data-view="board"
    :class="{ 'drop-active': dropActive }"
    @click.self="onPaneClick"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onFileDrop"
  >
    <VueFlow
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :min-zoom="0.15"
      :max-zoom="2.2"
      :snap-to-grid="gridSnap"
      :pan-on-drag="interactionMode === 'drag'"
      :selection-key-code="true"
      :selection-mode="SelectionMode.Partial"
      :connection-mode="ConnectionMode.Strict"
      :snap-grid="[22, 22]"
      :pan-on-scroll="true"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      :default-viewport="{ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom }"
      :is-valid-connection="isValidConnection"
      @init="onFlowInit"
      @connect="onConnect"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-click="onSelectNode"
      @node-double-click="onNodeDoubleClick"
      @node-context-menu="onNodeCtx"
      @selection-context-menu="onSelectionCtx"
      @edge-context-menu="onEdgeCtx"
      @pane-context-menu="onPaneCtx"
    >
      <Background
        id="grid-minor"
        :gap="22"
        :size="1"
        pattern-color="var(--ab-dot-minor)"
        bg-color="transparent"
      />
      <Background
        id="grid-major"
        :gap="110"
        :size="1.5"
        pattern-color="var(--ab-dot-major)"
        bg-color="transparent"
      />
      <!-- 小地图 + 缩放：缩放在画布视图里，不占工具栏。 -->
      <div class="board-canvas-dock">
        <MiniMap
          pannable
          zoomable
          class="board-minimap"
          node-color="rgb(139 111 232 / 0.7)"
          mask-color="rgb(28 27 31 / 0.5)"
        />
        <div class="board-zoom-bar" role="group" :aria-label="i18n.t('board.zoomGroup')">
          <button
            class="board-zoom-step"
            type="button"
            :title="i18n.t('board.zoomOut')"
            :aria-label="i18n.t('board.zoomOut')"
            @click="zoomBy(1 / 1.2, null)"
          >
            <MinusIcon />
          </button>
          <span class="board-zoom-label">{{ zoomLabel }}</span>
          <button
            class="board-zoom-step"
            type="button"
            :title="i18n.t('board.zoomIn')"
            :aria-label="i18n.t('board.zoomIn')"
            @click="zoomBy(1.2, null)"
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    </VueFlow>

    <div v-if="board.nodes.length === 0 && menu === null" class="board-empty">
      <div class="board-empty-mark" aria-hidden="true"><SquaresPlusIcon /></div>
      <h2 class="board-empty-title">{{ i18n.t("board.emptyTitle") }}</h2>
      <p class="board-empty-hint">{{ i18n.t("board.emptyHint") }}</p>
      <div class="board-empty-actions">
        <button class="board-empty-action" type="button" @click="toggleAdd">
          <SquaresPlusIcon class="board-empty-icon" />
          <span>{{ i18n.t("board.addNode") }}</span>
        </button>
        <button
          class="board-empty-action board-empty-secondary"
          type="button"
          @click="layout.openTab('workflowLibrary')"
        >
          <Square3Stack3DIcon class="board-empty-icon" />
          <span>{{ i18n.t("board.library.openLibrary") }}</span>
        </button>
      </div>
    </div>

    <div class="board-toolbar" role="toolbar" :aria-label="i18n.t('board.toolbar')">
      <!-- 运行 = 主按钮 + 模式菜单：模式和运行是同一件事，不再单独放一个图标。 -->
      <div class="board-run-group" :data-running="run.running.value ? 'true' : 'false'">
        <button
          class="board-run-main"
          type="button"
          :title="i18n.t('board.run.runHint')"
          @click="run.running.value ? run.stop() : run.runAll()"
        >
          <component :is="run.running.value ? StopIcon : PlayIcon" class="board-run-icon" />
          <span>{{ run.running.value ? i18n.t("board.run.stop") : i18n.t("board.run.run") }}</span>
          <span
            v-if="run.queue.value.length + Object.keys(run.active).length > 0"
            class="board-run-count"
          >{{ run.queue.value.length + Object.keys(run.active).length }}</span>
        </button>
        <NumberField
          v-if="repeatMode"
          class="board-repeat"
          :model-value="run.repeatCount.value"
          :min="1"
          :max="99"
          :step="1"
          :sr-label="i18n.t('board.run.repeatTimes')"
          input-width="24px"
          @update:model-value="run.repeatCount.value = $event"
        />
        <button
          class="board-run-caret"
          type="button"
          :data-active="run.mode.value !== 'manual' ? 'true' : 'false'"
          :title="runModeTip"
          :aria-label="runModeTip"
          :aria-expanded="menu?.kind === 'runMode'"
          aria-haspopup="menu"
          @click="toggleRunMode"
        >
          <span v-if="runModeShort" class="board-run-mode">{{ runModeShort }}</span>
          <ChevronDownIcon />
        </button>
      </div>
      <span class="board-sep" aria-hidden="true" />
      <button
        class="board-tool"
        type="button"
        :class="{ on: menu?.kind === 'add' }"
        :title="i18n.t('board.addNode')"
        @click="toggleAdd"
      >
        <SquaresPlusIcon />
      </button>
      <span class="board-sep" aria-hidden="true" />
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.undo')"
        :disabled="!board.canUndo"
        @click="board.undo()"
      >
        <ArrowUturnLeftIcon />
      </button>
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.redo')"
        :disabled="!board.canRedo"
        @click="board.redo()"
      >
        <ArrowUturnRightIcon />
      </button>
      <span class="board-sep" aria-hidden="true" />
      <button
        class="board-tool"
        type="button"
        :class="{ on: interactionMode === 'drag' }"
        :title="i18n.t('board.mode.drag')"
        @click="interactionMode = 'drag'"
      >
        <HandRaisedIcon />
      </button>
      <button
        class="board-tool"
        type="button"
        :class="{ on: interactionMode === 'marquee' }"
        :title="i18n.t('board.mode.marquee')"
        @click="interactionMode = 'marquee'"
      >
        <svg
          class="board-marquee-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke-dasharray="3 2.6" />
          <path
            d="M11 9.5 16.5 12 14 13.1l1.7 2.7-1.9 1.1-1.6-2.7-1.7 1.6z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      </button>
      <button
        class="board-tool"
        type="button"
        :class="{ on: gridSnap }"
        :title="i18n.t('board.gridSnap')"
        @click="gridSnap = !gridSnap"
      >
        <TableCellsIcon />
      </button>
      <span class="board-sep" aria-hidden="true" />
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.fit')"
        :aria-label="i18n.t('board.fit')"
        @click="fitView({ padding: 0.2, maxZoom: FIT_MAX_ZOOM })"
      >
        <ArrowsPointingOutIcon />
      </button>
      <span class="board-sep" aria-hidden="true" />
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.library.saveCurrent')"
        :aria-label="i18n.t('board.library.saveCurrent')"
        :disabled="board.nodes.length === 0"
        @click="library.openSave()"
      >
        <FloppyDiskIcon />
      </button>
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.library.openLibrary')"
        :aria-label="i18n.t('board.library.openLibrary')"
        @click="layout.openTab('workflowLibrary')"
      >
        <Square3Stack3DIcon />
      </button>
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.clear')"
        :aria-label="i18n.t('board.clear')"
        @click="clearBoard()"
      >
        <TrashIcon />
      </button>
    </div>

    <div v-if="dropActive" class="board-drop" aria-hidden="true">{{ dropHint || i18n.t("board.dropHint") }}</div>

    <BoardMenu
      v-if="menu"
      :items="menuItems"
      :anchor="menuAnchor"
      :x="menuPoint.x"
      :y="menuPoint.y"
      :placement="menuPlacement"
      :searchable="menuSearchable"
      :search-placeholder="i18n.t('board.addSearch')"
      :no-results="i18n.t('board.addNoResults')"
      :min-width="menuSearchable ? 220 : 190"
      @close="menu = null"
    />
  </section>
</template>

<style scoped>
.board-view {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background-color: var(--ab-canvas-bg, var(--app-inset));
}
.board-view :deep(.vue-flow__pane) {
  cursor: default;
}
/* 拖动模式：手掌光标；框选模式：十字光标（Vue Flow 自带的是 grab / pointer）。 */
.board-view :deep(.vue-flow__pane.draggable) {
  cursor: grab;
}
.board-view :deep(.vue-flow__pane.draggable.dragging) {
  cursor: grabbing;
}
.board-view :deep(.vue-flow__pane.selection) {
  cursor: crosshair;
}
/* 框选矩形换成主题色虚线（默认是 Vue Flow 的蓝色点线）。 */
.board-view :deep(.vue-flow__selection) {
  background: rgb(var(--md-primary) / 0.08);
  border: 1px dashed rgb(var(--md-primary) / 0.85);
  border-radius: 6px;
}
/* 缩放 / 平移时让浏览器把画布提到独立的合成层，避免逐帧重排。 */
.board-view :deep(.vue-flow__viewport) {
  will-change: transform;
}
.board-view :deep(.vue-flow__node) {
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 12px;
}
/* 组节点永远在图层最下方：Vue Flow 会给选中节点 +1000 的 z-index，这里压回 0；
   组之间靠 DOM 顺序（syncNodes 把组排在最前）决定，成员永远画在组框上面。 */
.board-view :deep(.vue-flow__node:has(.group-frame)) {
  z-index: 0 !important;
}
/* 输出附件卡画在节点卡片外：把 owning node 抬起来，免得被邻居盖住。
   Vue Flow 给选中节点写的是行内 z-index 1000，所以这里用 1030 + !important，
   保证附件卡盖过任何普通节点。 */
.board-view :deep(.vue-flow__node:has(.node-output-dock)) {
  z-index: 1030 !important;
}
/* 拖线预览：和正式连线一样有辉光 + 流动虚线。 */
.board-view :deep(.vue-flow__connection-path) {
  stroke: rgb(var(--md-primary));
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 7 8;
  filter: drop-shadow(0 0 5px rgb(var(--md-primary) / 0.65));
  animation: board-connect-flow 1s linear infinite;
}
@keyframes board-connect-flow {
  to {
    stroke-dashoffset: -15;
  }
}
@media (prefers-reduced-motion: reduce) {
  .board-view :deep(.vue-flow__connection-path) {
    animation: none;
  }
}
/* 小地图 + 缩放：固定在画布左下角（工具栏上方），两者共用同一个锚点。 */
.board-canvas-dock {
  position: absolute;
  left: 14px;
  bottom: 78px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 150px;
}
/* MiniMap 本身是一个 Vue Flow Panel（绝对定位 + 15px 外边距），放进 dock 后
   交回普通文档流：位置只由 dock 决定，小地图下方才有地方放缩放条。 */
.board-canvas-dock .board-minimap {
  position: relative !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  margin: 0 !important;
  width: 100%;
  height: 96px;
  border-radius: 10px;
  overflow: hidden;
  /* Vue Flow 默认给 minimap 白底；这里换成和画布同族的深色卡片，并压暗遮罩。 */
  background-color: rgb(var(--md-surface-container-high) / 0.92) !important;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
}
.board-minimap :deep(.vue-flow__minimap-mask) {
  fill: rgb(12 12 14 / 0.55);
}
/* 缩放：−  100%  + ，贴在小地图正下方。 */
.board-zoom-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 4px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.94);
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
}
.board-zoom-step {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
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
.board-zoom-step:hover {
  background-color: rgb(var(--md-on-surface) / 0.1);
  color: rgb(var(--md-on-surface));
}
.board-zoom-step:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.board-zoom-step :deep(svg) {
  width: 13px;
  height: 13px;
}
.board-zoom-label {
  flex: 1 1 auto;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--md-on-surface-variant));
  user-select: none;
}
.board-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
  pointer-events: none;
}
.board-empty-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.1);
}
.board-empty-mark :deep(svg) {
  width: 26px;
  height: 26px;
}
.board-empty-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.board-empty-hint {
  margin: 0;
  max-width: 440px;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.board-empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.board-empty-action {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary));
  cursor: pointer;
}
.board-empty-secondary {
  color: rgb(var(--md-on-surface));
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: inset 0 0 0 1px rgb(var(--md-outline-variant) / 0.7);
}
.board-empty-secondary:hover {
  background-color: rgb(var(--md-surface-container-highest));
}
.board-empty-action:hover {
  filter: brightness(1.04);
}
.board-empty-icon {
  width: 16px;
  height: 16px;
}
.board-toolbar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.94);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
  z-index: 5;
}
/* 运行按钮：主键 + 模式菜单拼成一个药丸，模式不再散落在工具栏上。 */
.board-run-group {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding-right: 2px;
  border-radius: 999px;
  overflow: hidden;
  white-space: nowrap;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary));
  box-shadow: 0 2px 10px rgb(var(--md-primary) / 0.24);
}
.board-run-group[data-running="true"] {
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container));
  box-shadow: none;
}
.board-run-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px 0 11px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.board-run-main:hover {
  background: rgb(255 255 255 / 0.1);
}
.board-run-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.board-run-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  background-color: rgb(255 255 255 / 0.22);
}
.board-run-caret {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 6px 0 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.board-run-caret::before {
  content: "";
  position: absolute;
  left: -1px;
  top: 3px;
  bottom: 3px;
  width: 1px;
  background: currentColor;
  opacity: 0.28;
}
.board-run-caret:hover {
  background: rgb(255 255 255 / 0.12);
}
.board-run-caret svg {
  width: 13px;
  height: 13px;
  transition: transform 0.16s ease;
}
.board-run-caret[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
.board-run-mode {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
}
/* 运行模式「重复 N 次」：MD3 步进器（− 数字 +），嵌在运行药丸里。 */
.board-repeat {
  height: 22px;
  padding: 0;
  gap: 0;
  border: 0;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.16);
  color: inherit;
  margin-right: 2px;
}
.board-repeat :deep(.step-btn) {
  width: 18px;
  height: 22px;
  color: inherit;
}
.board-repeat :deep(.step-btn:hover:not(:disabled)) {
  background: rgb(255 255 255 / 0.14);
}
.board-repeat :deep(.step-input) {
  width: 24px;
  height: 22px;
  font-size: 11px;
  color: inherit;
  background: transparent;
}
.board-tool {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.board-tool.on {
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container));
}
.board-tool:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.board-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.board-tool :deep(svg) {
  width: 17px;
  height: 17px;
}
.board-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  background-color: rgb(var(--md-outline-variant) / 0.6);
}
.board-drop {
  position: absolute;
  inset: 10px;
  display: grid;
  place-items: center;
  border: 2px dashed rgb(var(--md-primary) / 0.6);
  border-radius: 16px;
  background-color: rgb(var(--md-primary) / 0.06);
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-primary));
  pointer-events: none;
}
</style>
