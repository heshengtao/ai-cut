<script setup lang="ts">
/**
 * 画布节点卡片：照 ai-board 的插件节点结构复刻。
 *
 * 结构：卡片上方是浮动 label（图标 + 标题 + 类型 + 状态），卡片本身是
 * **无内边距的内容舞台**——图片 / 视频铺满整张卡，文字直接写在卡上，
 * 只有输入类节点底部留一条 media-bar 放文件名与元信息。
 */
import { computed, ref } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { useI18n } from "@/i18n";
import { nodeDefinition, portsOf } from "@/core/board/registry";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { useBoardRun } from "@/composables/useBoardRun";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { importAssetAt, pickMediaFiles } from "@/core/media";
import { addAsset } from "@/core/ops";
import { toast } from "@/composables/useToast";
import { nodeIcon } from "./nodeIcons";
import {
  ChevronRightIcon,
  DocumentDuplicateIcon,
  EyeIcon,
  EyeSlashIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import type { BoardNode } from "@/types/board";
import type { MediaAsset } from "@/types/project";

const props = defineProps<{
  /** Vue Flow 会把自己的节点 id 作为 `id` 传进来。 */
  id?: string;
  /** 我们自己的节点数据（`data.nodeId`）。 */
  data?: { nodeId?: string };
  selected?: boolean;
}>();

const i18n = useI18n();
const board = useBoardStore();
const project = useProjectStore();
const run = useBoardRun();

const cardEl = ref<HTMLElement | null>(null);
const resizing = ref(false);
const size = ref<{ width: number; height: number } | null>(null);

const nodeId = computed(() => props.data?.nodeId ?? props.id ?? "");
const node = computed<BoardNode | undefined>(() => board.nodes.find((item) => item.id === nodeId.value));
const definition = computed(() => (node.value ? nodeDefinition(node.value.type) : null));
const ports = computed(() => (node.value ? portsOf(node.value) : { inputs: [], outputs: [] }));

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
  if (current.type.startsWith("model.")) return "model";
  return definition.value?.assetKind ?? (current.type.includes("text") ? "text" : "model");
});

function assetById(id: string | undefined): MediaAsset | null {
  if (!id) return null;
  return project.doc.assets.find((item) => item.id === id) ?? null;
}

/** 图片牌堆（图片输入可以放多张）。 */
const stack = computed<MediaAsset[]>(() => {
  const current = node.value;
  if (!current) return [];
  const ids = current.data.assetIds ?? (current.data.assetId ? [current.data.assetId] : []);
  return ids.map((id) => assetById(id)).filter((asset): asset is MediaAsset => asset !== null);
});

const nodeWidth = computed(
  () => node.value?.size?.width ?? definition.value?.defaultSize.width ?? 240,
);
const compact = computed(() => nodeWidth.value < 300);

const stackIndex = computed(() => {
  const total = stack.value.length;
  if (total === 0) return 0;
  return Math.min(Math.max(0, node.value?.data.stackIndex ?? 0), total - 1);
});

/** 显示节点用：从上游连线解析出它当前要展示的素材。 */
const upstreamEdge = computed(() =>
  node.value ? board.edges.find((edge) => edge.target === node.value!.id) ?? null : null,
);
const upstreamNode = computed(() => {
  const edge = upstreamEdge.value;
  return edge ? board.nodes.find((item) => item.id === edge.source) ?? null : null;
});
const upstreamAsset = computed<MediaAsset | null>(() => {
  const source = upstreamNode.value;
  if (!source) return null;
  if (source.data.assetIds && source.data.assetIds.length > 0) {
    const index = Math.min(Math.max(0, source.data.stackIndex ?? 0), source.data.assetIds.length - 1);
    return assetById(source.data.assetIds[index]);
  }
  return assetById(source.data.outputAssetId ?? source.data.assetId);
});
const upstreamText = computed(() => {
  const source = upstreamNode.value;
  if (!source) return "";
  if (source.data.outputText) return source.data.outputText;
  const text = source.data.params.text;
  return typeof text === "string" ? text : "";
});

const isDisplay = computed(() => definition.value?.category === "display");

const primary = computed<MediaAsset | null>(() => {
  const current = node.value;
  if (!current) return null;
  if (isDisplay.value) return upstreamAsset.value ?? assetById(current.data.assetId);
  if (kind.value === "image" && stack.value.length > 0) return stack.value[stackIndex.value];
  return assetById(current.data.outputAssetId ?? current.data.assetId);
});

const imageUrl = computed(() => (primary.value ? assetThumbnailUrl(primary.value) : null));
const empty = computed(() => primary.value === null);

/** 牌堆里除当前张以外的图（最多 3 张）作为背后的"纸叠"。 */
const deck = computed(() =>
  stack.value.filter((_, index) => index !== stackIndex.value).slice(0, 3),
);

const meta = computed(() => {
  const current = primary.value;
  if (!current) return "";
  if (current.kind === "video") {
    return `${clock(current.duration)} · ${current.width ?? "?"}×${current.height ?? "?"}`;
  }
  if (current.kind === "image") {
    return current.width && current.height ? `${current.width}×${current.height}` : current.name;
  }
  return clock(current.duration);
});

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

const status = computed(() => node.value?.data.status ?? "idle");
const progress = computed(() => node.value?.data.progress ?? null);
const error = computed(() => node.value?.data.error ?? null);
const ignored = computed(() => node.value?.data.ignored === true);
const isModel = computed(() => node.value?.type.startsWith("model.") === true);

const textPreview = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (isDisplay.value && upstreamText.value) return upstreamText.value;
  const text = current.data.params.text;
  if (typeof text === "string" && text) return text;
  return current.data.outputText ?? "";
});

const textMode = computed(() => (node.value?.data.params.mode === "plain" ? "plain" : "markdown"));

/** 极简 markdown：加粗 / 行内代码 / 标题 / 列表 / 换行。 */
const textHtml = computed(() => {
  const escaped = textPreview.value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br />");
});

/** 模型节点的实时输出：图片 / 文本 / 提示。 */
const modelImage = computed(() => {
  const asset = assetById(node.value?.data.outputAssetId);
  return asset ? assetThumbnailUrl(asset) : null;
});
const modelText = computed(() => {
  const text = node.value?.data.outputText ?? "";
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
});

function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/** 点击牌堆切下一张（与 ai-board 一致）。 */
function cycleStack(): void {
  const current = node.value;
  if (!current || stack.value.length < 2) return;
  const next = (stackIndex.value + 1) % stack.value.length;
  board.updateNodeData(current.id, { stackIndex: next, assetId: stack.value[next].id });
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
  const ids = [...stack.value.map((asset) => asset.id), ...imported.map((asset) => asset.id)];
  for (const asset of imported) project.dispatch((doc) => addAsset(doc, asset));
  const index = stack.value.length;
  board.updateNodeData(current.id, {
    assetIds: ids,
    stackIndex: index,
    assetId: ids[index],
  });
  fitImageAspect(imported[0]);
}

/** 导入图片后按比例定高（与 ai-board 的 mediaHeight 一致）：宽度不变，高度跟图走。 */
function fitImageAspect(asset: MediaAsset): void {
  const current = node.value;
  if (!current || !asset.width || !asset.height) return;
  const width = nodeWidth.value;
  const bar = definition.value?.category === "input" ? 40 : 0;
  const height = Math.round((width * asset.height) / asset.width) + bar;
  board.resizeNode(current.id, {
    width,
    height: Math.min(560, Math.max(160, height)),
  });
}

function runNode(): void {
  if (node.value) run.runNode(node.value.id);
}

function toggleIgnored(): void {
  const current = node.value;
  if (current) board.updateNodeData(current.id, { ignored: !current.data.ignored });
}

function duplicate(): void {
  if (node.value) board.duplicateNode(node.value.id);
}

function remove(): void {
  if (node.value) board.removeNodes([node.value.id]);
}

/** 🔻 右下角缩放：拖动时直接改外层节点尺寸，松手提交到 store（记一步撤销）。 */
function onResizeStart(event: PointerEvent): void {
  const wrapper = cardEl.value?.closest(".vue-flow__node") as HTMLElement | null;
  if (!wrapper) return;
  event.preventDefault();
  event.stopPropagation();
  const box = wrapper.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  resizing.value = true;

  const onMove = (move: PointerEvent): void => {
    const width = Math.max(150, Math.round(box.width + move.clientX - startX));
    const height = Math.max(96, Math.round(box.height + move.clientY - startY));
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    size.value = { width, height };
  };
  const onUp = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    resizing.value = false;
    if (node.value && size.value) board.resizeNode(node.value.id, size.value);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
</script>

<template>
  <div
    v-if="node && definition"
    ref="cardEl"
    class="board-node"
    :data-kind="kind"
    :data-selected="selected ? 'true' : 'false'"
    :data-empty="empty ? 'true' : 'false'"
    :data-status="status"
    :data-compact="compact ? 'true' : 'false'"
    :class="{ ignored, resizing }"
  >
    <!-- 卡片上方浮动标签：图标 + 标题 + 类型 + 状态 -->
    <div class="node-label">
      <span class="node-label-mark">
        <component :is="nodeIcon(node.type)" />
      </span>
      <span class="node-label-title">{{ title }}</span>
      <span class="node-label-type">{{ node.type }}</span>
      <span class="node-label-status" :data-state="status" :title="i18n.t(`board.status.${status}`)" />
      <span v-if="ignored" class="node-label-flag">{{ i18n.t("board.ctx.ignore") }}</span>
      <span v-if="stack.length > 1" class="node-label-flag count">×{{ stack.length }}</span>
    </div>

    <!-- 悬停控制：与 ai-board 一样贴在标签右侧 -->
    <div class="node-hover-controls nodrag" @pointerdown.stop @click.stop>
      <button v-if="isModel" type="button" :title="i18n.t('board.ctx.run')" @click="runNode">
        <PlayIcon />
      </button>
      <button type="button" :title="i18n.t('board.ctx.duplicate')" @click="duplicate">
        <DocumentDuplicateIcon />
      </button>
      <button
        type="button"
        :title="ignored ? i18n.t('board.ctx.enable') : i18n.t('board.ctx.ignore')"
        @click="toggleIgnored"
      >
        <component :is="ignored ? EyeIcon : EyeSlashIcon" />
      </button>
      <button type="button" class="danger" :title="i18n.t('common.delete')" @click="remove">
        <TrashIcon />
      </button>
    </div>

    <!-- 内容舞台：图片 / 视频铺满，文字直接排版 -->
    <div class="node-surface" :data-kind="kind">
      <div v-if="error" class="node-error">{{ error }}</div>

      <!-- 图片：牌堆 + 铺满舞台（显示节点没有底部条） -->
      <template v-if="kind === 'image'">
        <div v-if="deck.length > 0" class="image-deck" aria-hidden="true">
          <div
            v-for="(sheet, index) in deck"
            :key="sheet.id"
            class="image-deck-sheet"
            :style="{ backgroundImage: `url(${assetThumbnailUrl(sheet) ?? ''})` }"
            :data-index="index"
          />
        </div>
        <div v-if="imageUrl" class="image-stage" @click="cycleStack">
          <img :src="imageUrl" :alt="title" />
        </div>
        <div v-if="isDisplay" class="media-empty passive">
          <span class="media-empty-icon"><EyeIcon /></span>
          <strong>{{ i18n.t("board.node.waitingMedia") }}</strong>
          <span>{{ i18n.t("board.node.waitingHint") }}</span>
        </div>
        <button
          v-else
          class="media-empty"
          type="button"
          @pointerdown.stop
          @click.stop="pickFiles"
        >
          <span class="media-empty-icon"><PlusIcon /></span>
          <strong>{{ i18n.t("board.node.dropImage") }}</strong>
          <span>{{ i18n.t("board.node.dropHint") }}</span>
        </button>

        <div v-if="definition.category === 'input' && primary" class="media-bar">
          <div class="media-bar-copy">
            <strong>{{ primary.name }}</strong>
            <span>{{ meta }}</span>
          </div>
          <button
            v-if="stack.length > 1"
            class="media-icon-button"
            type="button"
            :title="i18n.t('board.node.nextImage')"
            @click="cycleStack"
          >
            <ChevronRightIcon />
          </button>
          <button class="media-icon-button" type="button" :title="i18n.t('board.inspect.addImages')" @click="pickFiles">
            <PlusIcon />
          </button>
        </div>
      </template>

      <!-- 视频：舞台 + 底部媒体条 -->
      <template v-else-if="kind === 'video'">
        <div class="node-media-stage">
          <img v-if="imageUrl" :src="imageUrl" :alt="title" />
          <div v-if="isDisplay" class="media-empty passive compact">
            <span class="media-empty-icon"><EyeIcon /></span>
            <strong>{{ i18n.t("board.node.waitingMedia") }}</strong>
          </div>
          <button v-else class="media-empty" type="button" @pointerdown.stop @click.stop="pickFiles">
            <span class="media-empty-icon"><PlusIcon /></span>
            <strong>{{ i18n.t("board.node.dropVideo") }}</strong>
            <span>{{ i18n.t("board.node.dropHint") }}</span>
          </button>
          <span v-if="imageUrl" class="media-play" aria-hidden="true"><PlayIcon /></span>
        </div>
        <div v-if="primary" class="media-bar">
          <div class="media-bar-copy">
            <strong>{{ primary.name }}</strong>
            <span>{{ meta }}</span>
          </div>
        </div>
      </template>

      <!-- 音频：波形 + 媒体条 -->
      <template v-else-if="kind === 'audio'">
        <div class="node-audio-stage">
          <div v-if="primary" class="node-audio-wave" aria-hidden="true" />
          <div v-if="isDisplay" class="media-empty passive compact">
            <span class="media-empty-icon"><EyeIcon /></span>
            <strong>{{ i18n.t("board.node.waitingMedia") }}</strong>
          </div>
          <button v-else class="media-empty compact" type="button" @pointerdown.stop @click.stop="pickFiles">
            <span class="media-empty-icon"><PlusIcon /></span>
            <strong>{{ i18n.t("board.node.dropAudio") }}</strong>
          </button>
        </div>
        <div v-if="primary" class="media-bar">
          <div class="media-bar-copy">
            <strong>{{ primary.name }}</strong>
            <span>{{ meta }}</span>
          </div>
        </div>
      </template>

      <!-- 文本：直接写在卡上 -->
      <div v-else-if="kind === 'text'" class="node-text" :class="`mode-${textMode}`">
        <div v-if="textPreview" v-html="textMode === 'markdown' ? textHtml : textPreview" />
        <span v-else class="node-text-empty">{{ i18n.t("board.node.noText") }}</span>
      </div>

      <!-- 模型：实时输出 -->
      <div v-else class="node-live">
        <img v-if="modelImage" class="node-live-image" :src="modelImage" :alt="title" />
        <div v-else-if="modelText" class="node-live-text">{{ modelText }}</div>
        <span v-else class="node-live-hint">{{ i18n.t("board.node.modelHint") }}</span>
      </div>

      <div v-if="progress !== null && status === 'running'" class="node-progress">
        <span :style="{ width: `${Math.round(progress * 100)}%` }" />
      </div>
    </div>

    <!-- 端口：贴在卡片左右边缘，标签在卡内 -->
    <Handle
      v-for="(port, index) in ports.inputs"
      :id="port.id"
      :key="`in-${port.id}`"
      type="target"
      :position="Position.Left"
      class="node-handle node-handle-in"
      :style="{ top: handleTop(index, ports.inputs.length) }"
    />
    <span
      v-for="(port, index) in ports.inputs"
      :key="`in-label-${port.id}`"
      class="node-port left"
      :style="{ top: handleTop(index, ports.inputs.length) }"
    >
      {{ i18n.t(port.labelKey) }}
    </span>

    <Handle
      v-for="(port, index) in ports.outputs"
      :id="port.id"
      :key="`out-${port.id}`"
      type="source"
      :position="Position.Right"
      class="node-handle node-handle-out"
      :style="{ top: handleTop(index, ports.outputs.length) }"
    />
    <span
      v-for="(port, index) in ports.outputs"
      :key="`out-label-${port.id}`"
      class="node-port right"
      :style="{ top: handleTop(index, ports.outputs.length) }"
    >
      {{ i18n.t(port.labelKey) }}
    </span>

    <span class="node-resize nodrag" @pointerdown="onResizeStart" />
  </div>
</template>

<style scoped>
/* ============ 卡片外壳（ai-board plugin-node 的几何） ============ */
.board-node {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 20px;
  color: rgb(var(--md-on-surface));
}
.node-surface {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 85% at 14% 0%, rgb(var(--md-primary) / 0.13), transparent 62%),
    linear-gradient(150deg, rgb(var(--md-surface-container-high) / 0.98), rgb(var(--md-surface-container-low) / 0.94));
  border: 1px solid rgb(255 255 255 / 0.07);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.1),
    0 14px 34px rgb(0 0 0 / 0.22);
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}
.board-node[data-kind="video"] .node-surface {
  background:
    radial-gradient(120% 85% at 14% 0%, rgb(239 184 200 / 0.16), transparent 62%),
    linear-gradient(150deg, rgb(var(--md-surface-container-high) / 0.98), rgb(var(--md-surface-container-low) / 0.94));
}
.board-node[data-kind="audio"] .node-surface {
  background:
    radial-gradient(120% 85% at 14% 0%, rgb(var(--md-primary) / 0.16), transparent 62%),
    linear-gradient(150deg, rgb(var(--md-surface-container-high) / 0.98), rgb(var(--md-surface-container-low) / 0.94));
}
.board-node[data-selected="true"] .node-surface {
  border-color: rgb(var(--md-primary) / 0.85);
  box-shadow:
    0 0 0 2px rgb(var(--md-primary) / 0.35),
    0 18px 40px rgb(0 0 0 / 0.3);
}
.board-node.ignored .node-surface {
  opacity: 0.55;
}

/* ============ 浮动标签 ============ */
.node-label {
  position: absolute;
  left: 4px;
  bottom: calc(100% + 8px);
  z-index: 6;
  max-width: calc(100% - 104px);
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
.board-node[data-compact="true"] .node-label-type,
.board-node[data-compact="true"] .node-label-flag {
  display: none;
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
.node-label-flag.count {
  color: rgb(var(--md-on-surface-variant));
  background: rgb(var(--md-on-surface-variant) / 0.14);
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

/* ============ 悬停控制 ============ */
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
.board-node[data-selected="true"] .node-hover-controls {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.node-hover-controls button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.node-hover-controls button:hover {
  background: rgb(var(--md-on-surface-variant) / 0.14);
  color: rgb(var(--md-on-surface));
}
.node-hover-controls button.danger:hover {
  color: rgb(var(--md-error));
}
.node-hover-controls button :deep(svg) {
  width: 13px;
  height: 13px;
}

/* ============ 图片：牌堆 + 铺满舞台 ============ */
.image-deck {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.image-deck-sheet {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  background-size: cover;
  background-position: center;
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.22);
  opacity: 0.82;
}
.image-deck-sheet[data-index="0"] {
  transform: translate(9px, 5px) rotate(1.15deg);
  z-index: -1;
}
.image-deck-sheet[data-index="1"] {
  transform: translate(15px, 9px) rotate(2.15deg);
  z-index: -2;
}
.image-deck-sheet[data-index="2"] {
  transform: translate(21px, 13px) rotate(3.15deg);
  z-index: -3;
}
.image-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(
    145deg,
    rgb(var(--md-primary-container) / 0.55),
    rgb(var(--md-tertiary-container) / 0.42)
  );
  cursor: pointer;
}
.image-stage img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* ============ 视频 ============ */
.node-media-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  margin: 8px 8px 0;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background:
    linear-gradient(45deg, rgb(255 255 255 / 0.025) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.025) 75%),
    linear-gradient(45deg, rgb(255 255 255 / 0.025) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.025) 75%),
    rgb(13 11 18 / 0.55);
  background-size: 18px 18px, 18px 18px, auto;
  background-position: 0 0, 9px 9px, 0 0;
}
.node-media-stage img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}
.media-play {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(6px);
}
.media-play :deep(svg) {
  width: 13px;
  height: 13px;
  margin-left: 1px;
}

/* ============ 音频 ============ */
.node-audio-stage {
  flex: 1 1 auto;
  min-height: 0;
  margin: 8px 8px 0;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: rgb(13 11 18 / 0.35);
}
.node-audio-wave {
  width: 100%;
  height: 46px;
  border-radius: 8px;
  background-image: repeating-linear-gradient(
    90deg,
    rgb(var(--md-primary) / 0.6) 0 2px,
    transparent 2px 5px
  );
  mask-image: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent);
}

/* ============ 媒体条 ============ */
.media-bar {
  flex: 0 0 auto;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px 7px 12px;
  background: linear-gradient(to top, rgb(10 8 14 / 0.55), transparent);
}
.media-bar-copy {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.media-bar-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  font-weight: 650;
}
.media-bar-copy span {
  color: rgb(var(--md-on-surface-variant));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8px;
}
.media-icon-button {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
}
.media-icon-button:hover {
  background: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.media-icon-button :deep(svg) {
  width: 13px;
  height: 13px;
}

/* ============ 空态 ============ */
.media-empty {
  position: absolute;
  inset: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 16px;
  border: 1px dashed rgb(var(--md-outline) / 0.5);
  border-radius: 15px;
  text-align: center;
  color: rgb(var(--md-on-surface-variant));
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.media-empty.passive {
  cursor: default;
  border-style: solid;
  border-color: rgb(var(--md-outline-variant) / 0.35);
}
.media-empty.passive:hover {
  border-color: rgb(var(--md-outline-variant) / 0.35);
  background: transparent;
}
.media-empty:hover {
  border-color: rgb(var(--md-primary));
  background: rgb(var(--md-primary) / 0.08);
}
.media-empty.compact {
  inset: 8px;
  gap: 3px;
  padding: 9px;
}
.media-empty-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgb(var(--md-primary-container) / 0.65);
  color: rgb(var(--md-on-primary-container));
  margin-bottom: 3px;
}
.media-empty-icon :deep(svg) {
  width: 19px;
  height: 19px;
}
.media-empty strong {
  font-size: 11.5px;
  font-weight: 650;
  color: rgb(var(--md-on-surface));
}
.media-empty > span:not(.media-empty-icon) {
  max-width: 210px;
  font-size: 9.5px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-variant));
}

/* ============ 文本 / 模型 ============ */
.node-text {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 14px;
  overflow: hidden;
  line-height: 1.55;
  font-size: 11.5px;
  word-break: break-word;
}
.node-text.mode-plain {
  white-space: pre-wrap;
}
.node-text :deep(h2),
.node-text :deep(h3),
.node-text :deep(h4) {
  margin: 0 0 4px;
  font-size: 12.5px;
}
.node-text :deep(li) {
  margin-left: 16px;
}
.node-text :deep(code) {
  padding: 0 3px;
  border-radius: 3px;
  background: rgb(var(--md-on-surface-variant) / 0.14);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10.5px;
}
.node-text-empty,
.node-live-hint {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant) / 0.75);
}
.node-live {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
}
.node-live-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.node-live-text {
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: rgb(var(--md-on-surface));
}

/* ============ 错误 / 进度 ============ */
.node-error {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 8px;
  z-index: 2;
  margin: 0;
  padding: 5px 7px;
  border-radius: 8px;
  font-size: 10px;
  color: rgb(var(--md-on-error));
  background: rgb(var(--md-error) / 0.9);
}
.node-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgb(var(--md-primary) / 0.18);
}
.node-progress span {
  display: block;
  height: 100%;
  background: rgb(var(--md-primary));
  transition: width 0.2s linear;
}

/* ============ 端口 ============ */
.node-handle {
  width: 9px;
  height: 9px;
  border: 2px solid rgb(var(--md-surface-container-low));
  background: rgb(var(--md-primary));
}
.node-port {
  position: absolute;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  color: rgb(var(--md-on-surface-variant) / 0.85);
  pointer-events: none;
  z-index: 2;
}
.node-port.left {
  left: 8px;
}
.node-port.right {
  right: 8px;
}

/* ============ 缩放手柄 ============ */
.node-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 7;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background-image: linear-gradient(
    135deg,
    transparent 0 55%,
    rgb(var(--md-outline) / 0.9) 55% 62%,
    transparent 62% 74%,
    rgb(var(--md-outline) / 0.9) 74% 81%,
    transparent 81%
  );
  border-bottom-right-radius: 20px;
}
</style>
