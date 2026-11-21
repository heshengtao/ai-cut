<script setup lang="ts">
/**
 * 剧集连线画布。
 *
 * 用 Vue Flow 渲染（与 BoardView 同一个画布库，但不共享节点 / store / 端口概念）：
 * 分P 是节点、播放关系是边，全部由 `project.doc` 派生；用户拖卡片 / 连线 / 改选项名
 * 后写回工程。读取一律走 `core/series/graph`，布局走 `core/series/layout`。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type CSSProperties } from "vue";
import { Background } from "@vue-flow/background";
import {
  ConnectionMode,
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
  ArrowsPointingOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { CARD_WIDTH, placements } from "@/core/series/layout";
import { orderedEpisodes, seriesEdges } from "@/core/series/graph";
import {
  autoLayoutSeries,
  connectEpisode,
  disconnectEpisodeEdge,
  moveSeriesCard,
  resetSeriesGraph,
  setEpisodeEdgeLabel,
} from "@/core/ops";
import SeriesGraphCard from "./SeriesGraphCard.vue";
import SeriesEdge from "./SeriesEdge.vue";

const emit = defineEmits<{ (e: "open", episodeId: string): void }>();

const nodeTypes = { seriesCard: SeriesGraphCard } as unknown as NodeTypesObject;
const edgeTypes = { seriesEdge: SeriesEdge } as unknown as EdgeTypesObject;

const i18n = useI18n();
const project = useProjectStore();

const {
  fitView,
  findEdge,
  zoomIn,
  zoomOut,
  onViewportChange,
  onNodeDragStop,
  onNodesInitialized,
  onEdgeClick,
  onPaneClick,
} = useVueFlow();

const rootEl = ref<HTMLElement | null>(null);
const flowNodes = shallowRef<Node[]>([]);
const flowEdges = shallowRef<Edge[]>([]);
const selectedEdgeId = ref<string | null>(null);
const labelDraft = ref("");
const liveZoom = ref(1);
const viewport = ref({ x: 0, y: 0, zoom: 1 });

const zoomPercent = computed(() => Math.round(liveZoom.value * 100));
const hasEdges = computed(() => seriesEdges(project.doc).length > 0);

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

function syncNodes(): void {
  const existing = new Map(flowNodes.value.map((node) => [node.id, node]));
  const positions = placements(project.doc);
  flowNodes.value = orderedEpisodes(project.doc).map((episode) => {
    const current = existing.get(episode.id);
    const position = positions.get(episode.id) ?? { x: 0, y: 0 };
    if (current) return { ...current, position };
    return {
      id: episode.id,
      type: "seriesCard",
      position,
      style: { width: `${CARD_WIDTH}px` },
      data: { episodeId: episode.id },
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

function fitAll(): void {
  void fitView({ padding: 0.25, maxZoom: 1 });
}

/** 第一次量完节点尺寸后适应视图；之后加节点不再抢视口。 */
let fitted = false;
onNodesInitialized(() => {
  if (fitted) return;
  fitted = true;
  fitAll();
});

function onConnect(connection: Connection): void {
  if (project.readOnly) return;
  project.dispatch((doc) => connectEpisode(doc, connection.source, connection.target));
}

function onNodeDoubleClick({ node }: NodeMouseEvent): void {
  emit("open", node.id);
}

onNodeDragStop((event) => {
  if (project.readOnly) return;
  const moves = event.nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
  }));
  project.dispatch((doc) =>
    moves.reduce((acc, move) => moveSeriesCard(acc, move.id, move.x, move.y), doc),
  );
});

onEdgeClick(({ edge }) => {
  selectedEdgeId.value = edge.id;
});

onPaneClick(() => {
  selectedEdgeId.value = null;
});

onViewportChange((transform) => {
  viewport.value = transform;
  liveZoom.value = transform.zoom;
});

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
  if (project.readOnly) return;
  project.dispatch((doc) => autoLayoutSeries(doc));
  fitAll();
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
  project.dispatch((doc) => resetSeriesGraph(doc));
  toast(i18n.t("series.graph.rebuildDone"));
  fitAll();
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
  <section ref="rootEl" class="series-graph" data-view="series-graph">
    <VueFlow
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :min-zoom="0.25"
      :max-zoom="2"
      :pan-on-scroll="true"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      :nodes-draggable="!project.readOnly"
      :nodes-connectable="!project.readOnly"
      :edges-selectable="!project.readOnly"
      :connection-mode="ConnectionMode.Loose"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      @connect="onConnect"
      @node-double-click="onNodeDoubleClick"
    >
      <Background
        id="series-grid"
        :gap="22"
        :size="1"
        pattern-color="var(--ab-dot-minor)"
        bg-color="transparent"
      />
    </VueFlow>

    <div class="graph-toolbar" role="toolbar" :aria-label="i18n.t('series.graph.fit')">
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.zoomOut')"
        :aria-label="i18n.t('series.graph.zoomOut')"
        @click="zoomOut({ duration: 120 })"
      >
        <MagnifyingGlassMinusIcon />
      </button>
      <button
        class="graph-zoom tabular"
        type="button"
        :title="i18n.t('series.graph.fit')"
        @click="fitAll"
      >
        {{ zoomPercent }}%
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.zoomIn')"
        :aria-label="i18n.t('series.graph.zoomIn')"
        @click="zoomIn({ duration: 120 })"
      >
        <MagnifyingGlassPlusIcon />
      </button>
      <span class="graph-sep" aria-hidden="true" />
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.fit')"
        :aria-label="i18n.t('series.graph.fit')"
        @click="fitAll"
      >
        <ArrowsPointingOutIcon />
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.autoLayout')"
        :aria-label="i18n.t('series.graph.autoLayout')"
        :disabled="project.readOnly"
        @click="doAutoLayout"
      >
        <span class="graph-tool-text">{{ i18n.t("series.graph.autoLayout") }}</span>
      </button>
      <button
        class="graph-tool"
        type="button"
        :title="i18n.t('series.graph.rebuild')"
        :aria-label="i18n.t('series.graph.rebuild')"
        :disabled="project.readOnly || !project.doc.seriesGraph?.custom"
        @click="rebuild"
      >
        <span class="graph-tool-text">{{ i18n.t("series.graph.rebuild") }}</span>
      </button>
    </div>

    <div v-if="!hasEdges" class="graph-hint">
      <p class="graph-hint-title">{{ i18n.t("series.graph.empty") }}</p>
      <p class="graph-hint-text">{{ i18n.t("series.graph.emptyHint") }}</p>
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
          v-model="labelDraft"
          class="edge-input"
          type="text"
          :placeholder="i18n.t('series.edge.labelPlaceholder', { index: 1 })"
          :aria-label="i18n.t('series.edge.label')"
          @keydown.esc.prevent="selectedEdgeId = null"
          @blur="commitLabel"
        />
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
  </section>
</template>

<style scoped>
.series-graph {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* 圆点底色：和画布同一套视觉，但不引入 .ab-canvas 的整套节点配色。 */
  --ab-dot-minor: rgb(var(--md-outline) / 0.45);
  background-color: var(--app-bg);
}
.series-graph :deep(.vue-flow) {
  background: transparent;
}
.series-graph :deep(.vue-flow__node) {
  border: 0;
  background: transparent;
  padding: 0;
}
.graph-toolbar {
  position: absolute;
  left: 14px;
  top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.92);
  box-shadow: var(--md-elevation-1);
  z-index: 4;
}
.graph-tool {
  height: 26px;
  min-width: 26px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  cursor: pointer;
}
.graph-tool:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.graph-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.graph-tool :deep(svg) {
  width: 15px;
  height: 15px;
}
.graph-tool-text {
  white-space: nowrap;
}
.graph-zoom {
  min-width: 44px;
  height: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.graph-zoom:hover {
  color: rgb(var(--md-on-surface));
}
.graph-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background-color: rgb(var(--md-outline-variant) / 0.8);
}
.graph-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
.graph-hint-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.graph-hint-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
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
</style>
