<script setup lang="ts">
/**
 * 无限画布：Vue Flow 承载视图，文档真相在 `board` store（最终落进工程 `board` 字段）。
 *
 * 交互按 ai-board 复刻：双层点阵背景、左下小地图、底部浮动工具栏（添加 / 撤销 /
 * 适应视图 / 缩放）、连线校验、框选、删除键、滚轮平移。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypesObject,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import {
  ArrowsPointingOutIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  CursorArrowRaysIcon,
  MinusIcon,
  PlusIcon,
  SquaresPlusIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";
import BoardNodeCard from "./BoardNode.vue";
import { useI18n } from "@/i18n";
import { useBoardStore } from "@/stores/board";
import { useLayoutStore } from "@/stores/layout";
import { portsCompatible } from "@/core/board/schema";
import { nodeDefinition, nodesByCategory, portSpecOf } from "@/core/board/registry";
import type { BoardNode } from "@/types/board";

const i18n = useI18n();
const board = useBoardStore();
const layout = useLayoutStore();

const nodeTypes = { board: BoardNodeCard } as unknown as NodeTypesObject;

// shallowRef：Vue Flow 的 Node/Edge 泛型嵌套很深，ref 的深度解包会触发 TS 递归上限。
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const addOpen = ref(false);
const addAnchor = ref<HTMLElement | null>(null);

const { fitView, zoomIn, zoomOut, setViewport, screenToFlowCoordinate, onNodeDragStop, onMoveEnd } =
  useVueFlow();

const groups = computed(() => nodesByCategory());

const zoomLabel = computed(() => `${Math.round((board.viewport.zoom || 1) * 100)}%`);

/** 文档节点 → Vue Flow 节点（节点组件自己从 store 取数据）。 */
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
    // 拖动时本地坐标是新的，别被文档里的旧坐标拉回去。
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
    animated: false,
  }));
}

watch(() => board.nodes, syncNodes, { deep: false });
watch(() => board.edges, syncEdges, { deep: false });

/** 连线前校验端口类型：不兼容直接拒绝（Vue Flow 会显示禁止光标）。 */
function isValidConnection(connection: Connection): boolean {
  const source = board.nodes.find((node) => node.id === connection.source);
  const target = board.nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return false;
  const from = portSpecOf(source.type, connection.sourceHandle ?? "", "out");
  const to = portSpecOf(target.type, connection.targetHandle ?? "", "in");
  if (!from || !to) return false;
  return portsCompatible(from.type, to.type);
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

function addNode(type: string): void {
  const definition = nodeDefinition(type);
  if (!definition) return;
  const center = screenToFlowCoordinate({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  board.addNode({
    id: crypto.randomUUID(),
    type,
    position: { x: Math.round(center.x - definition.defaultSize.width / 2), y: Math.round(center.y - definition.defaultSize.height / 2) },
    data: { params: {}, bindings: {} },
  });
  addOpen.value = false;
}

function onSelectNode(event: { node: Node }): void {
  board.select([event.node.id]);
}

function onPaneClick(): void {
  board.select([]);
  addOpen.value = false;
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

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if ((event.key === "Delete" || event.key === "Backspace") && board.selection.length > 0) {
    event.preventDefault();
    board.removeNodes([...board.selection]);
  }
}

onMounted(() => {
  // 进画布就把检查器打开：节点操作只在这里，没有它画布不可用。
  layout.openTab("boardInspector");
  syncNodes();
  syncEdges();
  void setViewport({ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom });
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  board.flush();
  window.removeEventListener("keydown", onKeyDown);
});

function toggleAdd(event: MouseEvent): void {
  addAnchor.value = event.currentTarget as HTMLElement;
  addOpen.value = !addOpen.value;
}
</script>

<template>
  <section class="board-view" data-view="board" @click.self="onPaneClick">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :min-zoom="0.15"
      :max-zoom="2.2"
      :snap-to-grid="true"
      :snap-grid="[22, 22]"
      :pan-on-scroll="true"
      :zoom-on-double-click="false"
      :selection-on-drag="true"
      :delete-key-code="null"
      :default-viewport="{ x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom }"
      :is-valid-connection="isValidConnection"
      @connect="onConnect"
      @node-click="onSelectNode"
      @pane-click="onPaneClick"
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
        :node-color="() => 'rgb(139 111 232 / 0.7)'"
        mask-color="rgb(28 27 31 / 0.5)"
      />
    </VueFlow>

    <div v-if="board.nodes.length === 0" class="board-empty">
      <div class="board-empty-mark" aria-hidden="true"><SquaresPlusIcon /></div>
      <h2 class="board-empty-title">{{ i18n.t("board.emptyTitle") }}</h2>
      <p class="board-empty-hint">{{ i18n.t("board.emptyHint") }}</p>
    </div>

    <div class="board-toolbar" role="toolbar" :aria-label="i18n.t('board.toolbar')">
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
      <span class="board-sep" aria-hidden="true" />
      <span class="board-hint">
        <CursorArrowRaysIcon />
        {{ i18n.t("board.panHint") }}
      </span>
    </div>

    <div v-if="addOpen" class="board-menu" :style="{ left: '50%', bottom: '64px' }">
      <template v-for="(list, category) in groups" :key="category">
        <p v-if="list.length" class="board-menu-group">{{ i18n.t(`board.category.${category}`) }}</p>
        <button
          v-for="definition in list"
          :key="definition.type"
          class="board-menu-item"
          type="button"
          @click="addNode(definition.type)"
        >
          {{ i18n.t(definition.titleKey) }}
        </button>
      </template>
    </div>
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
}
.board-tool {
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
  width: 1px;
  height: 16px;
  background-color: rgb(var(--md-outline-variant) / 0.6);
}
.board-zoom {
  min-width: 42px;
  text-align: center;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--md-on-surface-variant));
}
.board-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant) / 0.8);
}
.board-hint :deep(svg) {
  width: 14px;
  height: 14px;
}
.board-menu {
  position: absolute;
  z-index: 20;
  transform: translateX(-50%);
  min-width: 190px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.2);
}
.board-menu-group {
  margin: 6px 8px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant) / 0.8);
}
.board-menu-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  cursor: pointer;
}
.board-menu-item:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
}
</style>
