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
  type Edge,
  type EdgeMouseEvent,
  type Node,
  type NodeMouseEvent,
  type NodeTypesObject,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import {
  ArrowsPointingOutIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3Icon,
  BoltIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  Squares2X2Icon,
  SquaresPlusIcon,
  TableCellsIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";
import BoardNodeCard from "./BoardNode.vue";
import BoardMenu from "./BoardMenu.vue";
import type { BoardMenuItem } from "./BoardMenuList.vue";
import { categoryIcon, nodeIcon } from "./nodeIcons";
import { useI18n } from "@/i18n";
import { useBoardStore } from "@/stores/board";
import { useLayoutStore } from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { useBoardRun } from "@/composables/useBoardRun";
import { useAssetDownload } from "@/composables/useAssetDownload";
import { portsCompatible } from "@/core/board/schema";
import { nodeDefinition, nodesByCategory, portOf } from "@/core/board/registry";
import { addAsset } from "@/core/ops";
import { importAssetAt, kindFromPath } from "@/core/media";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import type { BoardCategory, BoardPortType, BoardRunMode } from "@/types/board";
import type { BoardNode } from "@/types/board";

const i18n = useI18n();
const board = useBoardStore();
const layout = useLayoutStore();
const project = useProjectStore();
const run = useBoardRun();
const { download } = useAssetDownload();

const nodeTypes = { board: BoardNodeCard } as unknown as NodeTypesObject;

// shallowRef：Vue Flow 的 Node/Edge 泛型嵌套很深，ref 的深度解包会触发 TS 递归上限。
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const rootEl = ref<HTMLElement | null>(null);
const dropActive = ref(false);

type MenuState =
  | { kind: "add"; anchor: DOMRect }
  | { kind: "connect"; x: number; y: number; sourceNodeId: string; sourcePort: string; portType: BoardPortType }
  | { kind: "runMode"; anchor: DOMRect }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string }
  | { kind: "pane"; x: number; y: number };

const menu = ref<MenuState | null>(null);
/** ai-board 的两种交互模式：拖动画面 / 框选。 */
const interactionMode = ref<"drag" | "marquee">("drag");
const gridSnap = ref(true);

const { fitView, zoomIn, zoomOut, setViewport, onNodeDragStop, onMoveEnd, onConnectStart, onConnectEnd } =
  useVueFlow();

const groups = computed(() => nodesByCategory());
const zoomLabel = computed(() => `${Math.round((board.viewport.zoom || 1) * 100)}%`);
const repeatMode = computed(() => run.mode.value === "repeat");

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
  flowNodes.value = board.nodes.map((node) => {
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
  flowEdges.value = board.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
  }));
}

watch(() => board.nodes, syncNodes, { deep: false });
watch(() => board.edges, syncEdges, { deep: false });

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

/** 连线前校验端口类型：不兼容直接拒绝（Vue Flow 会显示禁止光标）。 */
function isValidConnection(connection: Connection): boolean {
  const source = board.nodes.find((node) => node.id === connection.source);
  const target = board.nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return false;
  const from = portOf(source, connection.sourceHandle ?? "", "out");
  const to = portOf(target, connection.targetHandle ?? "", "in");
  if (!from || !to) return false;
  return portsCompatible(from.type, to.type);
}

/** 拖线到空白处：记住起点，松手后弹"兼容节点选择器"（ai-board 的核心手感）。 */
let pendingConnect: { nodeId: string; portId: string; portType: BoardPortType } | null = null;

onConnectStart((payload) => {
  if (payload.handleType !== "source" || !payload.nodeId) {
    pendingConnect = null;
    return;
  }
  const node = board.nodes.find((item) => item.id === payload.nodeId);
  const port = node ? portOf(node, payload.handleId ?? "", "out") : null;
  pendingConnect =
    node && port ? { nodeId: node.id, portId: port.id, portType: port.type } : null;
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
  menu.value = { kind: "connect", ...point, sourceNodeId: source.nodeId, sourcePort: source.portId, portType: source.portType };
});

/** 选中兼容节点后：在松手处建节点并连上。 */
function connectToNew(
  state: { x: number; y: number; sourceNodeId: string; sourcePort: string },
  type: string,
  targetPort: string,
): void {
  const definition = nodeDefinition(type);
  if (!definition) return;
  const point = toFlowPoint(state.x, state.y);
  const id = crypto.randomUUID();
  board.addNode({
    id,
    type,
    position: {
      x: Math.round(point.x - definition.defaultSize.width / 2),
      y: Math.round(point.y - definition.defaultSize.height / 2),
    },
    data: { params: {}, bindings: {} },
  });
  board.connect({
    id: crypto.randomUUID(),
    source: state.sourceNodeId,
    sourcePort: state.sourcePort,
    target: id,
    targetPort,
  });
}

function onConnect(connection: Connection): void {
  if (!isValidConnection(connection)) return;
  board.connect({
    id: crypto.randomUUID(),
    source: connection.source,
    sourcePort: connection.sourceHandle ?? "",
    target: connection.target,
    targetPort: connection.targetHandle ?? "",
  });
}

/** 添加节点：默认落在视口中心；右键 / 拖入时落在鼠标处。 */
function addNode(type: string, at?: { x: number; y: number }): void {
  const definition = nodeDefinition(type);
  if (!definition) return;
  const point = at ?? centerPoint();
  const id = crypto.randomUUID();
  board.addNode({
    id,
    type,
    position: {
      x: Math.round(point.x - definition.defaultSize.width / 2),
      y: Math.round(point.y - definition.defaultSize.height / 2),
    },
    data: { params: {}, bindings: {} },
  });
  void nextTick(() => {
    if (board.nodes.length === 1) void fitView({ padding: 0.35, duration: 260 });
  });
}

function duplicateNode(nodeId: string): void {
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

function runDownstream(nodeId: string): void {
  run.runNode(nodeId);
  for (const id of downstreamOf(nodeId)) {
    const node = board.nodes.find((item) => item.id === id);
    if (node?.type.startsWith("model.")) run.runNode(id);
  }
}

function selectAll(): void {
  board.select(board.nodes.map((node) => node.id));
}

function clearBoard(): void {
  void confirm({
    title: i18n.t("board.clearTitle"),
    message: i18n.t("board.clearMessage"),
    confirmText: i18n.t("board.clear"),
    destructive: true,
  }).then((accepted) => {
    if (accepted) board.clear();
  });
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

/** 添加节点菜单：按分类做子菜单（节点选项带图标）。 */
function addSubmenus(): BoardMenuItem[] {
  const list: BoardMenuItem[] = [];
  for (const category of ["input", "display", "model"] as BoardCategory[]) {
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
        label: i18n.t(definition.titleKey),
        icon: nodeIcon(definition.type),
        hint: definition.type,
        searchText: `${definition.type} ${i18n.t(definition.titleKey)}`,
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
    const items: BoardMenuItem[] = [];
    for (const category of ["input", "display", "model"] as BoardCategory[]) {
      for (const definition of groups.value[category] ?? []) {
        const input = definition.inputs.find((port) =>
          portsCompatible(current.portType, port.type),
        );
        if (!input) continue;
        items.push({
          kind: "action",
          id: `connect-${definition.type}`,
          label: i18n.t(definition.titleKey),
          icon: nodeIcon(definition.type),
          hint: definition.type,
          searchText: `${definition.type} ${i18n.t(definition.titleKey)}`,
          run: () => connectToNew(current, definition.type, input.id),
        });
      }
    }
    return [
      { kind: "label", id: "connect-label", label: i18n.t("board.connect.title") },
      ...items,
    ];
  }

  if (current.kind === "runMode") {
    const modes: { value: BoardRunMode; labelKey: string }[] = [
      { value: "manual", labelKey: "board.run.manual" },
      { value: "always", labelKey: "board.run.always" },
      { value: "repeat", labelKey: "board.run.repeat" },
      { value: "none", labelKey: "board.run.none" },
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
    ];
  }

  if (current.kind === "node") {
    const target = nodeMenuTarget.value;
    if (!target) return [];
    const isModel = target.type.startsWith("model.");
    return [
      {
        kind: "action",
        id: "run",
        label: i18n.t("board.ctx.run"),
        icon: PlayIcon,
        disabled: !isModel || target.data.ignored,
        keys: ["⌘", "↵"],
        run: () => run.runNode(target.id),
      },
      {
        kind: "action",
        id: "run-downstream",
        label: i18n.t("board.ctx.runDownstream"),
        icon: BoltIcon,
        disabled: !isModel || target.data.ignored,
        run: () => runDownstream(target.id),
      },
      { kind: "separator", id: "sep-1" },
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
        id: "toggle",
        label: target.data.ignored ? i18n.t("board.ctx.enable") : i18n.t("board.ctx.ignore"),
        icon: target.data.ignored ? EyeIcon : EyeSlashIcon,
        run: () => board.updateNodeData(target.id, { ignored: !target.data.ignored }),
      },
      {
        kind: "action",
        id: "download",
        label: i18n.t("board.ctx.download"),
        icon: ArrowDownTrayIcon,
        disabled: !nodeMenuAsset.value,
        run: () => {
          const asset = nodeMenuAsset.value;
          if (asset) void download(asset);
        },
      },
      { kind: "separator", id: "sep-2" },
      {
        kind: "action",
        id: "delete",
        label: i18n.t("common.delete"),
        icon: TrashIcon,
        danger: true,
        keys: ["Del"],
        run: () => board.removeNodes([target.id]),
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
      run: () => void fitView({ padding: 0.2, duration: 260 }),
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
}

function onNodeCtx(payload: NodeMouseEvent): void {
  const event = payload.event as MouseEvent;
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
  event.preventDefault();
  board.select([payload.node.id]);
  menu.value = { kind: "node", x: event.clientX, y: event.clientY, nodeId: payload.node.id };
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

onNodeDragStop((event) => {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of event.nodes) positions[node.id] = { x: node.position.x, y: node.position.y };
  board.applyPositions(positions);
  board.syncPositions();
});

onMoveEnd(({ flowTransform }) => {
  board.setViewport({ x: flowTransform.x, y: flowTransform.y, zoom: flowTransform.zoom });
});

async function onFileDrop(event: DragEvent): Promise<void> {
  dropActive.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  for (const file of files) {
    const path = (file as File & { path?: string }).path;
    if (!path) continue;
    const kind = kindFromPath(path);
    if (!kind) continue;
    try {
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      const type = kind === "image" ? "input.image" : kind === "video" ? "input.video" : "input.audio";
      addNode(type, toFlowPoint(event.clientX, event.clientY));
      const created = board.nodes[board.nodes.length - 1];
      if (created) board.updateNodeData(created.id, { assetId: asset.id });
    } catch (error) {
      toast(String(error), "error");
    }
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  dropActive.value = true;
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
  if (mod && event.key.toLowerCase() === "d" && board.selection.length > 0) {
    event.preventDefault();
    for (const id of board.selection) duplicateNode(id);
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

function onFlowInit(): void {
  void setViewport({ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom });
}

onMounted(() => {
  layout.openTab("boardInspector");
  syncNodes();
  syncEdges();
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  board.flush();
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <section
    ref="rootEl"
    class="board-view"
    data-view="board"
    :class="{ 'drop-active': dropActive }"
    @click.self="onPaneClick"
    @dragover="onDragOver"
    @dragleave="dropActive = false"
    @drop.prevent="onFileDrop"
  >
    <VueFlow
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :min-zoom="0.15"
      :max-zoom="2.2"
      :snap-to-grid="gridSnap"
      :pan-on-drag="interactionMode === 'drag'"
      :selection-on-drag="interactionMode === 'marquee'"
      :snap-grid="[22, 22]"
      :pan-on-scroll="true"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      :default-viewport="{ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom }"
      :is-valid-connection="isValidConnection"
      @init="onFlowInit"
      @connect="onConnect"
      @node-click="onSelectNode"
      @node-double-click="onNodeDoubleClick"
      @pane-click="onPaneClick"
      @node-context-menu="onNodeCtx"
      @edge-context-menu="onEdgeCtx"
      @pane-context-menu="onPaneCtx"
    >
      <Background
        id="grid-minor"
        :gap="22"
        :size="1"
        pattern-color="rgb(var(--md-outline) / 0.5)"
        bg-color="transparent"
      />
      <Background
        id="grid-major"
        :gap="110"
        :size="1.5"
        pattern-color="rgb(var(--md-outline) / 0.75)"
        bg-color="transparent"
      />
      <MiniMap
        pannable
        zoomable
        class="board-minimap"
        node-color="rgb(139 111 232 / 0.7)"
        mask-color="rgb(28 27 31 / 0.5)"
      />
    </VueFlow>

    <div v-if="board.nodes.length === 0 && menu === null" class="board-empty">
      <div class="board-empty-mark" aria-hidden="true"><SquaresPlusIcon /></div>
      <h2 class="board-empty-title">{{ i18n.t("board.emptyTitle") }}</h2>
      <p class="board-empty-hint">{{ i18n.t("board.emptyHint") }}</p>
      <button class="board-empty-action" type="button" @click="toggleAdd">
        <PlusIcon class="board-empty-icon" />
        <span>{{ i18n.t("board.addNode") }}</span>
      </button>
    </div>

    <div class="board-toolbar" role="toolbar" :aria-label="i18n.t('board.toolbar')">
      <button
        class="board-run"
        type="button"
        :class="{ running: run.running.value }"
        @click="run.running.value ? run.stop() : run.runSelection()"
      >
        {{ run.running.value ? i18n.t("board.run.stop") : i18n.t("board.run.run") }}
        <span v-if="run.queue.value.length > 0" class="board-run-count">{{ run.queue.value.length }}</span>
      </button>
      <button
        class="board-tool"
        type="button"
        :title="i18n.t('board.run.mode')"
        @click="toggleRunMode"
      >
        <Bars3Icon />
      </button>
      <input
        v-if="repeatMode"
        v-model.number="run.repeatCount.value"
        class="board-repeat"
        type="number"
        min="1"
        max="99"
        :title="i18n.t('board.run.repeatTimes')"
      />
      <span class="board-sep" aria-hidden="true" />
      <button class="board-tool" type="button" :title="i18n.t('board.addNode')" @click="toggleAdd">
        <PlusIcon />
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
        <CursorArrowRaysIcon />
      </button>
      <button
        class="board-tool"
        type="button"
        :class="{ on: interactionMode === 'marquee' }"
        :title="i18n.t('board.mode.marquee')"
        @click="interactionMode = 'marquee'"
      >
        <Squares2X2Icon />
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
      <button class="board-tool" type="button" :title="i18n.t('board.fit')" @click="fitView({ padding: 0.2 })">
        <ArrowsPointingOutIcon />
      </button>
      <button class="board-tool" type="button" :title="i18n.t('board.zoomOut')" @click="zoomOut({ duration: 160 })">
        <MinusIcon />
      </button>
      <span class="board-zoom">{{ zoomLabel }}</span>
      <button class="board-tool" type="button" :title="i18n.t('board.zoomIn')" @click="zoomIn({ duration: 160 })">
        <PlusIcon />
      </button>
    </div>

    <div v-if="dropActive" class="board-drop" aria-hidden="true">{{ i18n.t("board.dropHint") }}</div>

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
  background-color: var(--app-inset);
}
.board-view :deep(.vue-flow__pane) {
  cursor: default;
}
.board-view :deep(.vue-flow__node) {
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 12px;
}
.board-view :deep(.vue-flow__edge-path) {
  stroke: rgb(var(--md-primary) / 0.55);
  stroke-width: 1.8;
}
.board-view :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: rgb(var(--md-primary));
}
.board-minimap {
  left: 14px;
  bottom: 78px;
  width: 150px;
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
.board-empty-action {
  pointer-events: auto;
  margin-top: 6px;
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
.board-run {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  white-space: nowrap;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary));
  cursor: pointer;
}
.board-run.running {
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container));
}
.board-run-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-on-primary) / 0.22);
}
.board-repeat {
  width: 46px;
  height: 26px;
  padding: 0 4px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  text-align: center;
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
.board-zoom {
  flex: 0 0 auto;
  min-width: 42px;
  text-align: center;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--md-on-surface-variant));
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
