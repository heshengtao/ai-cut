<script setup lang="ts">
/**
 * 剧集连线画布（视觉与交互对齐画布工作流）。
 *
 * 用 Vue Flow 渲染（与 BoardView 同一个画布库，但不共享节点 / store / 端口概念）：
 * 分P 是节点、播放关系是边，全部由 `project.doc` 派生；用户拖卡片 / 连线 / 改选项名
 * 后写回工程。读取一律走 `core/series/graph`，布局走 `core/series/layout`。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type CSSProperties,
} from "vue";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import {
  ConnectionMode,
  SelectionMode,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type EdgeTypesObject,
  type Node,
  type NodeMouseEvent,
  type NodeTypesObject,
} from "@vue-flow/core";
import {
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  CheckIcon,
  ClipboardIcon,
  DocumentDuplicateIcon,
  HandRaisedIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  ScissorsIcon,
  Squares2X2Icon,
  Square2StackIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";
import BoardMenu from "@/components/board/BoardMenu.vue";
import type { BoardMenuItem } from "@/components/board/BoardMenuList.vue";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { useEpisodeOpen } from "@/composables/useEpisodeOpen";
import { useSeriesClipboard } from "@/composables/useSeriesClipboard";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { CARD_HEIGHT, CARD_WIDTH, ORIGIN, placements } from "@/core/series/layout";
import { orderedEpisodes, seriesEdges } from "@/core/series/graph";
import {
  cachedSeriesPosition,
  clearSeriesPositions,
  pruneSeriesPositions,
  setSeriesPosition,
} from "@/core/series/positionCache";
import {
  addConnectedEpisode,
  addEpisode,
  autoLayoutSeries,
  connectEpisode,
  disconnectEpisodeEdge,
  duplicateEpisode,
  moveSeriesCard,
  pasteSeriesEpisode,
  removeEpisode,
  renameEpisode,
  resetSeriesGraph,
  setEpisodeEdgeLabel,
} from "@/core/ops";
import SeriesGraphCard from "./SeriesGraphCard.vue";
import SeriesEdge from "./SeriesEdge.vue";

const emit = defineEmits<{ (e: "open", episodeId: string): void }>();

type MenuState =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | { kind: "pane"; x: number; y: number };

const nodeTypes = { seriesCard: SeriesGraphCard } as unknown as NodeTypesObject;
const edgeTypes = { seriesEdge: SeriesEdge } as unknown as EdgeTypesObject;

const i18n = useI18n();
const project = useProjectStore();
const openEpisode = useEpisodeOpen();

const {
  fitView,
  findEdge,
  zoomIn,
  zoomOut,
  screenToFlowCoordinate,
  onViewportChange,
  onNodeDragStop,
  onNodesInitialized,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onConnectStart,
  onConnectEnd,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
} = useVueFlow();

const rootEl = ref<HTMLElement | null>(null);
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const selectedEdgeId = ref<string | null>(null);
const labelDraft = ref("");
const edgeInput = ref<HTMLInputElement | null>(null);
const liveZoom = ref(1);
const viewport = ref({ x: 0, y: 0, zoom: 1 });
const menu = ref<MenuState | null>(null);
/** 画布交互模式：拖动画面 / 框选（对齐 BoardView）。 */
const interactionMode = ref<"drag" | "marquee">("drag");
const clipboard = useSeriesClipboard();

const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);

const zoomPercent = computed(() => Math.round(liveZoom.value * 100));

const selectedEdge = computed(
  () => flowEdges.value.find((edge) => edge.id === selectedEdgeId.value) ?? null,
);

const selectedRoute = computed(() => {
  const edge = selectedEdge.value;
  if (!edge) return "";
  const nameOf = (id: string) =>
    project.doc.episodes.find((episode) => episode.id === id)?.name ?? "?";
  return i18n.t("series.edge.route", { from: nameOf(edge.source), to: nameOf(edge.target) });
});

/** 编辑面板定位：边中点 → 屏幕坐标，再夹在画布范围内。 */
const panelStyle = computed<CSSProperties>(() => {
  const id = selectedEdgeId.value;
  const root = rootEl.value;
  // 读一下 selectedEdge：节点被拖动后 edges 会重建，这里要跟着重新定位。
  void selectedEdge.value;
  const edge = id ? findEdge(id) : null;
  if (!root || !edge) return { display: "none" };
  const zoom = viewport.value.zoom || 1;
  const midX = ((edge.sourceX + edge.targetX) / 2) * zoom + viewport.value.x;
  const midY = ((edge.sourceY + edge.targetY) / 2) * zoom + viewport.value.y;
  const x = Math.min(Math.max(midX, 150), Math.max(150, root.clientWidth - 150));
  const y = Math.min(Math.max(midY + 14, 90), Math.max(90, root.clientHeight - 130));
  return { left: `${x}px`, top: `${y}px` };
});

/** 改名面板定位：卡片上方居中的屏幕坐标。 */
const renameStyle = computed<CSSProperties>(() => {
  const id = renamingId.value;
  const root = rootEl.value;
  if (!id || !root) return { display: "none" };
  const placement = placements(project.doc).get(id);
  if (!placement) return { display: "none" };
  const zoom = viewport.value.zoom || 1;
  const x = (placement.x + CARD_WIDTH / 2) * zoom + viewport.value.x;
  const y = placement.y * zoom + viewport.value.y - 8;
  const clampedX = Math.min(Math.max(x, 140), Math.max(140, root.clientWidth - 140));
  const clampedY = Math.min(Math.max(y, 44), Math.max(44, root.clientHeight - 80));
  return { left: `${clampedX}px`, top: `${clampedY}px` };
});

// ---------------------------------------------------------------------------
// 节点 / 边同步
// ---------------------------------------------------------------------------

/** 交给卡片的动作（卡片是 Vue Flow 内部渲染的，拿不到父组件 emits）。 */
const seriesActions = {
  open: (episodeId: string): void => openEpisode(episodeId),
  rename: (episodeId: string): void => beginRename(episodeId),
  duplicate: (episodeId: string): void => duplicateById(episodeId),
  remove: (episodeId: string): void => void removeById(episodeId),
};

function syncNodes(): void {
  const existing = new Map(flowNodes.value.map((node) => [node.id, node]));
  const auto = placements(project.doc);
  const manual = project.doc.seriesGraph?.positions ?? {};
  const episodes = orderedEpisodes(project.doc);
  pruneSeriesPositions(new Set(episodes.map((episode) => episode.id)));

  // 先把「手动坐标 / 上次位置」定下来，新分P 再找一个不重叠的位置。不能在缓存已经
  // 冻结旧坐标时用 autoLayout 给新节点算坐标——那会正好压在别的卡片上（看起来像消失）。
  const resolved = new Map<string, { x: number; y: number }>();
  for (const episode of episodes) {
    const saved = manual[episode.id];
    const cached = cachedSeriesPosition(episode.id);
    const position =
      saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: saved.x, y: saved.y }
        : cached;
    if (!position) continue;
    resolved.set(episode.id, position);
  }

  /**
   * 新分P 只落在**当前视口内**的空位：从视口中心向外找，避开已有卡片。
   * 不能放到包围盒右侧——视口没跟着动的话，新卡片就生成在屏幕外，看起来像「节点消失」。
   */
  const freeSpot = (): { x: number; y: number } => {
    const root = rootEl.value;
    const rect = root?.getBoundingClientRect();
    const topLeft = screenToFlowCoordinate({
      x: rect?.left ?? 0,
      y: rect?.top ?? 0,
    });
    const bottomRight = screenToFlowCoordinate({
      x: (rect?.left ?? 0) + (root?.clientWidth ?? 900),
      y: (rect?.top ?? 0) + (root?.clientHeight ?? 600),
    });
    const stepX = CARD_WIDTH + 32;
    const stepY = CARD_HEIGHT + 32;
    const pad = 24;
    const columns = Math.max(1, Math.floor((bottomRight.x - topLeft.x - pad * 2) / stepX));
    const rows = Math.max(1, Math.floor((bottomRight.y - topLeft.y - pad * 2) / stepY));
    const candidates: { x: number; y: number }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        candidates.push({
          x: topLeft.x + pad + column * stepX,
          y: topLeft.y + pad + row * stepY,
        });
      }
    }
    const centerX = (topLeft.x + bottomRight.x) / 2;
    const centerY = (topLeft.y + bottomRight.y) / 2;
    candidates.sort(
      (a, b) =>
        Math.abs(a.x - centerX) + Math.abs(a.y - centerY) -
        (Math.abs(b.x - centerX) + Math.abs(b.y - centerY)),
    );
    const taken = [...resolved.values()];
    for (const spot of candidates) {
      const clash = taken.some(
        (item) =>
          Math.abs(item.x - spot.x) < CARD_WIDTH * 0.7 &&
          Math.abs(item.y - spot.y) < CARD_HEIGHT * 0.7,
      );
      if (!clash) return spot;
    }
    return candidates[0] ?? { x: topLeft.x + pad, y: topLeft.y + pad };
  };

  const hasLayout = resolved.size > 0;
  for (const episode of episodes) {
    if (resolved.has(episode.id)) continue;
    const fallback = auto.get(episode.id) ?? { x: ORIGIN, y: ORIGIN };
    // 挂载前还没有画布尺寸：这时算「视口内空位」只能拿到 0,0，会把卡片排到奇怪的地方。
    // 首屏一律走自动分层，挂载之后再给新卡片找视口内的位置。
    const position = hasLayout && viewportReady ? freeSpot() : fallback;
    resolved.set(episode.id, position);
  }

  flowNodes.value = episodes.map((episode) => {
    const position = resolved.get(episode.id) ?? { x: ORIGIN, y: ORIGIN };
    setSeriesPosition(episode.id, position);
    const current = existing.get(episode.id);
    if (current) {
      const samePosition =
        current.position.x === position.x && current.position.y === position.y;
      const sameData =
        current.data?.episodeId === episode.id && current.data?.actions === seriesActions;
      // 没变化就复用同一个节点对象，减少 Vue Flow 重新解析 / 重挂载。
      if (samePosition && sameData) return current;
      return {
        ...current,
        position,
        data: { episodeId: episode.id, actions: seriesActions },
      };
    }
    return {
      id: episode.id,
      type: "seriesCard",
      position,
      style: { width: `${CARD_WIDTH}px` },
      data: { episodeId: episode.id, actions: seriesActions },
    } satisfies Node;
  });
}

function syncEdges(): void {
  flowEdges.value = seriesEdges(project.doc).map((edge) => ({
    id: edge.id,
    type: "seriesEdge",
    source: edge.from,
    sourceHandle: "out",
    target: edge.to,
    targetHandle: "in",
    data: { label: edge.label ?? "", active: edge.id === selectedEdgeId.value },
  }));
}

watch(
  () => project.doc,
  () => {
    syncNodes();
    syncEdges();
  },
  { immediate: true },
);

watch(selectedEdgeId, () => {
  const edge = selectedEdgeId.value
    ? seriesEdges(project.doc).find((item) => item.id === selectedEdgeId.value)
    : null;
  labelDraft.value = edge?.label ?? "";
  syncEdges();
});

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

/**
 * 适应视图要等节点量完尺寸：刚挂载 / 刚换节点时 `fitView` 会返回 false。
 * 之前直接调一次就完事，失败后视口停在默认位置，靠右的卡片看起来就像「消失了」。
 */
async function fitAll(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const ok = await fitView({ padding: 0.2, maxZoom: 1 });
    if (ok) return;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

/** 第一次量完节点尺寸后适应视图；之后加节点不再抢视口。 */
let fitted = false;
onNodesInitialized(() => {
  viewportReady = true;
  if (fitted) return;
  fitted = true;
  void fitAll();
});

onViewportChange((transform) => {
  viewport.value = transform;
  liveZoom.value = transform.zoom;
});

// ---------------------------------------------------------------------------
// 连线 / 拖到空白新建分P
// ---------------------------------------------------------------------------

/** 画布是否已经量完（挂载前 `screenToFlowCoordinate` 拿不到容器，不能用来算落点）。 */
let viewportReady = false;

/** 本次拖线从哪个端口开始（用于「松手在空白处」时新建分P）。 */
let connectStart: {
  nodeId: string;
  handleType: "source" | "target";
  clientX: number;
  clientY: number;
} | null = null;
let connectHandled = false;

onConnectStart(({ nodeId, handleType, event }) => {
  connectHandled = false;
  if (!nodeId || !handleType || !event || !("clientX" in event)) {
    connectStart = null;
    return;
  }
  connectStart = {
    nodeId,
    handleType,
    clientX: event.clientX,
    clientY: event.clientY,
  };
});

onConnect((connection: Connection) => {
  connectHandled = true;
  if (project.readOnly) return;
  project.dispatch((doc) => connectEpisode(doc, connection.source, connection.target));
});

onConnectEnd((event) => {
  const start = connectStart;
  connectStart = null;
  if (!start || connectHandled || project.readOnly) return;
  if (!event || !("clientX" in event)) return;
  const distance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
  // 只是点了一下端口、没有真的拖出去：不要莫名其妙多出一集。
  if (distance < 16) return;
  // 松手落在另一张卡上、但 Vue Flow 没当成有效连接（比如落在卡片空白处 / 自连）：
  // 补一条边，而不是在卡片底下新建一集。
  const under = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest?.(".vue-flow__node") as HTMLElement | null;
  const targetId = under?.dataset.id;
  if (targetId) {
    project.dispatch((doc) =>
      start.handleType === "source"
        ? connectEpisode(doc, start.nodeId, targetId)
        : connectEpisode(doc, targetId, start.nodeId),
    );
    return;
  }
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const name = i18n.t("series.newEpisodeName", { index: project.doc.episodes.length + 1 });
  project.dispatch((doc) =>
    addConnectedEpisode(
      doc,
      start.nodeId,
      start.handleType,
      name,
      { x: point.x - CARD_WIDTH / 2, y: point.y - CARD_HEIGHT / 2 },
    ),
  );
});

onNodeDragStop((event) => {
  if (project.readOnly) return;
  // 只写「真的动过」的节点：Vue Flow 在布局重排 / 选中后也可能补发 dragStop，
  // 把程序算出来的坐标当成用户拖动写进工程，切视图后就会看到莫名其妙的排布。
  const moves = event.nodes
    .map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }))
    .filter((move) => {
      const saved = project.doc.seriesGraph?.positions?.[move.id];
      const known = saved ?? cachedSeriesPosition(move.id);
      if (!known) return true;
      return Math.abs(known.x - move.x) > 0.5 || Math.abs(known.y - move.y) > 0.5;
    });
  if (moves.length === 0) return;
  project.dispatch((doc) =>
    moves.reduce((acc, move) => moveSeriesCard(acc, move.id, move.x, move.y), doc),
  );
});

// ---------------------------------------------------------------------------
// 选择 / 菜单
// ---------------------------------------------------------------------------

onEdgeClick(({ edge }) => {
  menu.value = null;
  selectedEdgeId.value = edge.id;
});

onPaneClick(() => {
  selectedEdgeId.value = null;
  menu.value = null;
});

function pointOf(event: MouseEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}

function onNodeDoubleClick({ node }: NodeMouseEvent): void {
  emit("open", node.id);
}

onNodeContextMenu(({ node, event }) => {
  const mouse = event as MouseEvent;
  mouse.preventDefault();
  if (typeof mouse.clientX !== "number") return;
  menu.value = { kind: "node", id: node.id, ...pointOf(mouse) };
});

onEdgeContextMenu(({ edge, event }) => {
  const mouse = event as MouseEvent;
  mouse.preventDefault();
  if (typeof mouse.clientX !== "number") return;
  // 右键只出菜单：不要顺手把选项命名面板也弹出来。
  selectedEdgeId.value = null;
  menu.value = { kind: "edge", id: edge.id, ...pointOf(mouse) };
});

onPaneContextMenu((event: MouseEvent) => {
  event.preventDefault();
  menu.value = { kind: "pane", ...pointOf(event) };
});

function episodeName(id: string): string {
  return project.doc.episodes.find((episode) => episode.id === id)?.name ?? "";
}

function beginRename(episodeId: string): void {
  if (project.readOnly) return;
  renamingId.value = episodeId;
  renameDraft.value = episodeName(episodeId);
  menu.value = null;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function commitRename(): void {
  const id = renamingId.value;
  renamingId.value = null;
  if (!id) return;
  project.dispatch((doc) => renameEpisode(doc, id, renameDraft.value));
}

function duplicateById(episodeId: string): void {
  if (project.readOnly) return;
  const name = episodeName(episodeId);
  project.dispatch((doc) =>
    duplicateEpisode(doc, episodeId, i18n.t("series.duplicateSuffix", { name })),
  );
  menu.value = null;
}

function copyById(episodeId: string): void {
  const episode = project.doc.episodes.find((item) => item.id === episodeId);
  if (!episode) return;
  clipboard.copy(episode);
  menu.value = null;
  toast(i18n.t("series.ctx.copied"));
}

function cutById(episodeId: string): void {
  if (project.readOnly) return;
  const episode = project.doc.episodes.find((item) => item.id === episodeId);
  if (!episode) return;
  if (project.doc.episodes.length <= 1) {
    toast(i18n.t("series.keepLast"), "info");
    return;
  }
  clipboard.copy(episode);
  menu.value = null;
  project.dispatch((doc) => removeEpisode(doc, episodeId));
  toast(i18n.t("series.ctx.cutDone"));
}

/** 粘贴到鼠标位置（右键处）。 */
function pasteAt(clientX: number, clientY: number): void {
  const source = clipboard.read();
  if (!source || project.readOnly) return;
  menu.value = null;
  const point = screenToFlowCoordinate({ x: clientX, y: clientY });
  const name = i18n.t("series.duplicateSuffix", { name: source.name });
  project.dispatch((doc) =>
    pasteSeriesEpisode(doc, source, name, {
      x: point.x - CARD_WIDTH / 2,
      y: point.y - CARD_HEIGHT / 2,
    }),
  );
  toast(i18n.t("series.ctx.pasted"));
}

async function removeById(episodeId: string): Promise<void> {
  if (project.readOnly) return;
  menu.value = null;
  if (project.doc.episodes.length <= 1) {
    toast(i18n.t("series.keepLast"), "info");
    return;
  }
  const accepted = await confirm({
    title: i18n.t("series.deleteTitle"),
    message: i18n.t("series.deleteMessage", { name: episodeName(episodeId) }),
    confirmText: i18n.t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;
  project.dispatch((doc) => removeEpisode(doc, episodeId));
}

/** 右键空白处：在点击位置新建一集。 */
function createEpisodeAt(clientX: number, clientY: number): void {
  menu.value = null;
  const point = screenToFlowCoordinate({ x: clientX, y: clientY });
  const name = i18n.t("series.newEpisodeName", { index: project.doc.episodes.length + 1 });
  project.dispatch((doc) => {
    const next = addEpisode(doc, name);
    const created = next.episodes[next.episodes.length - 1];
    return moveSeriesCard(
      next,
      created.id,
      point.x - CARD_WIDTH / 2,
      point.y - CARD_HEIGHT / 2,
    );
  });
}

function openEdgeEditor(edgeId: string): void {
  selectedEdgeId.value = edgeId;
  menu.value = null;
  void nextTick(() => edgeInput.value?.focus());
}

const menuItems = computed<BoardMenuItem[]>(() => {
  const current = menu.value;
  if (!current) return [];
  if (current.kind === "node") {
    return [
      {
        kind: "action",
        id: "node-open",
        label: i18n.t("series.preview"),
        icon: PlayIcon,
        run: () => {
          menu.value = null;
          openEpisode(current.id);
        },
      },
      {
        kind: "action",
        id: "node-rename",
        label: i18n.t("common.rename"),
        icon: PencilSquareIcon,
        disabled: project.readOnly,
        run: () => beginRename(current.id),
      },
      {
        kind: "action",
        id: "node-duplicate",
        label: i18n.t("series.ctx.duplicate"),
        icon: DocumentDuplicateIcon,
        disabled: project.readOnly,
        run: () => duplicateById(current.id),
      },
      {
        kind: "action",
        id: "node-copy",
        label: i18n.t("series.ctx.copy"),
        icon: Square2StackIcon,
        run: () => copyById(current.id),
      },
      {
        kind: "action",
        id: "node-cut",
        label: i18n.t("series.ctx.cut"),
        icon: ScissorsIcon,
        disabled: project.readOnly,
        run: () => cutById(current.id),
      },
      {
        kind: "action",
        id: "node-paste",
        label: i18n.t("series.ctx.paste"),
        icon: ClipboardIcon,
        disabled: project.readOnly || !clipboard.hasContent.value,
        run: () => pasteAt(current.x, current.y),
      },
      { kind: "separator", id: "node-sep" },
      {
        kind: "action",
        id: "node-delete",
        label: i18n.t("common.delete"),
        icon: TrashIcon,
        danger: true,
        disabled: project.readOnly || project.doc.episodes.length <= 1,
        run: () => void removeById(current.id),
      },
    ];
  }
  if (current.kind === "edge") {
    return [
      {
        kind: "action",
        id: "edge-label",
        label: i18n.t("series.edge.label"),
        icon: PencilSquareIcon,
        disabled: project.readOnly,
        run: () => openEdgeEditor(current.id),
      },
      {
        kind: "action",
        id: "edge-delete",
        label: i18n.t("series.edge.delete"),
        icon: TrashIcon,
        danger: true,
        disabled: project.readOnly,
        run: () => {
          menu.value = null;
          selectedEdgeId.value = null;
          project.dispatch((doc) => disconnectEpisodeEdge(doc, current.id));
        },
      },
    ];
  }
  return [
    {
      kind: "action",
      id: "pane-new",
      label: i18n.t("series.newEpisode"),
      icon: PlusIcon,
      disabled: project.readOnly,
      run: () => createEpisodeAt(current.x, current.y),
    },
    {
      kind: "action",
      id: "pane-paste",
      label: i18n.t("series.ctx.paste"),
      icon: ClipboardIcon,
      disabled: project.readOnly || !clipboard.hasContent.value,
      run: () => pasteAt(current.x, current.y),
    },
    {
      kind: "action",
      id: "pane-layout",
      label: i18n.t("series.graph.autoLayout"),
      icon: Squares2X2Icon,
      disabled: project.readOnly,
      run: () => doAutoLayout(),
    },
    {
      kind: "action",
      id: "pane-fit",
      label: i18n.t("series.graph.fit"),
      icon: ArrowsPointingOutIcon,
      run: () => {
        menu.value = null;
        void fitAll();
      },
    },
  ];
});

// ---------------------------------------------------------------------------
// 选项编辑 / 工具栏
// ---------------------------------------------------------------------------

function commitLabel(): void {
  const id = selectedEdgeId.value;
  if (!id || project.readOnly) return;
  project.dispatch((doc) => setEpisodeEdgeLabel(doc, id, labelDraft.value));
}

function removeEdge(): void {
  const id = selectedEdgeId.value;
  if (!id || project.readOnly) return;
  selectedEdgeId.value = null;
  project.dispatch((doc) => disconnectEpisodeEdge(doc, id));
}

function doAutoLayout(): void {
  menu.value = null;
  if (project.readOnly) return;
  clearSeriesPositions();
  project.dispatch((doc) => autoLayoutSeries(doc));
  void fitAll();
}

async function rebuild(): Promise<void> {
  if (project.readOnly) return;
  const accepted = await confirm({
    title: i18n.t("series.graph.rebuildTitle"),
    message: i18n.t("series.graph.rebuildMessage"),
    confirmText: i18n.t("series.graph.rebuild"),
    destructive: true,
  });
  if (!accepted) return;
  clearSeriesPositions();
  project.dispatch((doc) => resetSeriesGraph(doc));
  toast(i18n.t("series.graph.rebuildDone"));
  void fitAll();
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  if (event.key === "Escape") {
    selectedEdgeId.value = null;
    renamingId.value = null;
    menu.value = null;
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedEdgeId.value &&
    !event.metaKey &&
    !event.ctrlKey &&
    !project.readOnly
  ) {
    event.preventDefault();
    removeEdge();
  }
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <section ref="rootEl" class="series-graph ab-canvas" data-view="series-graph">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :min-zoom="0.25"
      :max-zoom="2"
      :pan-on-scroll="false"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      :pan-on-drag="interactionMode === 'drag'"
      :selection-key-code="true"
      :selection-mode="SelectionMode.Partial"
      :nodes-draggable="!project.readOnly"
      :nodes-connectable="!project.readOnly"
      :edges-selectable="!project.readOnly"
      :connection-mode="ConnectionMode.Loose"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      @node-double-click="onNodeDoubleClick"
    >
      <Background
        id="series-grid-minor"
        :gap="22"
        :size="1"
        pattern-color="var(--ab-dot-minor)"
        bg-color="transparent"
      />
      <Background
        id="series-grid-major"
        :gap="110"
        :size="1.5"
        pattern-color="var(--ab-dot-major)"
        bg-color="transparent"
      />
      <div class="series-canvas-dock">
        <MiniMap
          pannable
          zoomable
          class="series-minimap"
          :width="150"
          :height="96"
          node-color="rgb(139 111 232 / 0.7)"
          mask-color="rgb(28 27 31 / 0.5)"
        />
        <div class="series-zoom-bar" role="group" :aria-label="i18n.t('series.graph.fit')">
          <button
            class="series-zoom-step"
            type="button"
            :title="i18n.t('series.graph.zoomOut')"
            :aria-label="i18n.t('series.graph.zoomOut')"
            @click="zoomOut({ duration: 120 })"
          >
            <MagnifyingGlassMinusIcon />
          </button>
          <span class="series-zoom-label">{{ zoomPercent }}%</span>
          <button
            class="series-zoom-step"
            type="button"
            :title="i18n.t('series.graph.zoomIn')"
            :aria-label="i18n.t('series.graph.zoomIn')"
            @click="zoomIn({ duration: 120 })"
          >
            <MagnifyingGlassPlusIcon />
          </button>
        </div>
      </div>
    </VueFlow>

    <div class="series-toolbar" role="toolbar" :aria-label="i18n.t('series.graph.toolbar')">
      <button
        class="series-tool"
        type="button"
        :class="{ on: interactionMode === 'drag' }"
        :title="i18n.t('series.mode.drag')"
        :aria-label="i18n.t('series.mode.drag')"
        :aria-pressed="interactionMode === 'drag'"
        @click="interactionMode = 'drag'"
      >
        <HandRaisedIcon />
      </button>
      <button
        class="series-tool"
        type="button"
        :class="{ on: interactionMode === 'marquee' }"
        :title="i18n.t('series.mode.marquee')"
        :aria-label="i18n.t('series.mode.marquee')"
        :aria-pressed="interactionMode === 'marquee'"
        @click="interactionMode = 'marquee'"
      >
        <svg
          class="series-marquee-icon"
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
      <span class="series-toolbar-sep" aria-hidden="true" />
      <button
        class="series-tool"
        type="button"
        :title="i18n.t('series.graph.fit')"
        :aria-label="i18n.t('series.graph.fit')"
        @click="fitAll"
      >
        <ArrowsPointingOutIcon />
      </button>
      <button
        class="series-tool"
        type="button"
        :title="i18n.t('series.graph.rebuild')"
        :aria-label="i18n.t('series.graph.rebuild')"
        :disabled="project.readOnly || !project.doc.seriesGraph?.custom"
        @click="rebuild"
      >
        <ArrowPathIcon />
      </button>
    </div>

    <form
      v-if="selectedEdge && !project.readOnly"
      class="edge-panel"
      :style="panelStyle"
      @submit.prevent="commitLabel"
      @pointerdown.stop
    >
      <p class="edge-route">{{ selectedRoute }}</p>
      <div class="edge-row">
        <input
          ref="edgeInput"
          v-model="labelDraft"
          class="edge-input"
          type="text"
          :placeholder="i18n.t('series.edge.labelPlaceholder', { index: 1 })"
          :aria-label="i18n.t('series.edge.label')"
          @keydown.esc.prevent="selectedEdgeId = null"
          @blur="commitLabel"
        />
        <button
          class="edge-confirm"
          type="submit"
          :title="i18n.t('common.confirm')"
          :aria-label="i18n.t('common.confirm')"
          @mousedown.prevent
        >
          <CheckIcon />
        </button>
        <button
          class="edge-delete"
          type="button"
          :title="i18n.t('series.edge.delete')"
          :aria-label="i18n.t('series.edge.delete')"
          @mousedown.prevent
          @click="removeEdge"
        >
          <TrashIcon />
        </button>
      </div>
    </form>

    <form
      v-if="renamingId && !project.readOnly"
      class="rename-panel"
      :style="renameStyle"
      @submit.prevent="commitRename"
      @pointerdown.stop
    >
      <input
        ref="renameInput"
        v-model="renameDraft"
        class="rename-input"
        type="text"
        :aria-label="i18n.t('common.rename')"
        @keydown.esc.prevent="renamingId = null"
        @blur="commitRename"
      />
    </form>

    <BoardMenu
      v-if="menu"
      :items="menuItems"
      :x="menu.x"
      :y="menu.y"
      :min-width="190"
      @close="menu = null"
    />
  </section>
</template>

<style scoped>
.series-graph {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--ab-canvas-bg, var(--app-inset));
}
.series-graph :deep(.vue-flow) {
  background: transparent;
}
.series-graph :deep(.vue-flow__node) {
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 20px;
  outline: none;
}
/* 拖线时的那根虚线，跟画布主色一致。 */
.series-graph :deep(.vue-flow__connection-path) {
  stroke: rgb(var(--md-primary));
  stroke-width: 2;
  stroke-dasharray: 5 4;
}
/* 底部工具栏：和画布工作流同一条胶囊，居中贴在画布底部。 */
.series-toolbar {
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
.series-tool {
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
.series-tool.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.series-tool:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.series-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.series-tool :deep(svg) {
  width: 17px;
  height: 17px;
}
.series-marquee-icon {
  width: 17px;
  height: 17px;
}
.series-toolbar-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  background-color: rgb(var(--md-outline-variant) / 0.6);
}

/* ============ 小地图 + 缩放（对齐画布左下角 dock） ============ */
.series-canvas-dock {
  position: absolute;
  left: 14px;
  bottom: 78px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 150px;
}
.series-canvas-dock .series-minimap {
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
  background-color: rgb(var(--md-surface-container-high) / 0.92) !important;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
}
.series-minimap :deep(.vue-flow__minimap-mask) {
  fill: rgb(12 12 14 / 0.55);
}
.series-zoom-bar {
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
.series-zoom-step {
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
.series-zoom-step:hover {
  background-color: rgb(var(--md-on-surface) / 0.1);
  color: rgb(var(--md-on-surface));
}
.series-zoom-step :deep(svg) {
  width: 13px;
  height: 13px;
}
.series-zoom-label {
  flex: 1 1 auto;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--md-on-surface-variant));
}

/* ============ 选中边的选项编辑 ============ */
.edge-panel {
  position: absolute;
  z-index: 5;
  width: 260px;
  padding: 8px;
  border-radius: 12px;
  transform: translate(-50%, 0);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-2);
}
.edge-route {
  margin: 0 0 6px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edge-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.edge-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
.edge-input:focus {
  border-color: rgb(var(--md-primary));
}
.edge-confirm {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-primary));
  cursor: pointer;
}
.edge-confirm:hover {
  background-color: rgb(var(--md-primary) / 0.12);
}
.edge-confirm :deep(svg) {
  width: 16px;
  height: 16px;
}
.edge-delete {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.edge-delete:hover {
  color: rgb(var(--md-error));
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
}
.edge-delete :deep(svg) {
  width: 15px;
  height: 15px;
}

/* ============ 卡片改名 ============ */
.rename-panel {
  position: absolute;
  z-index: 6;
  width: 220px;
  transform: translate(-50%, -100%);
}
.rename-input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-primary));
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-2);
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
</style>
