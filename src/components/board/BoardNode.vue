<script setup lang="ts">
/**
 * 画布节点卡片：输入 / 显示节点共用一张卡。
 *
 * 卡片只负责"是什么 + 现在什么样"，所有可编辑的操作都在右侧检查器里。
 * 模型节点会有可展开的实时输出区（`liveOutput`），输入 / 显示节点没有。
 */
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { useI18n } from "@/i18n";
import { nodeDefinition, portsOf } from "@/core/board/registry";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { assetThumbnailUrl } from "@/core/thumbnails";
import type { BoardNode } from "@/types/board";

const props = defineProps<{ nodeId: string; selected?: boolean }>();

const i18n = useI18n();
const board = useBoardStore();
const project = useProjectStore();

const node = computed<BoardNode | undefined>(() =>
  board.nodes.find((item) => item.id === props.nodeId),
);
const definition = computed(() => (node.value ? nodeDefinition(node.value.type) : null));

const ports = computed(() => (node.value ? portsOf(node.value) : { inputs: [], outputs: [] }));

const title = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (current.data.title) return current.data.title;
  return definition.value ? i18n.t(definition.value.titleKey) : current.type;
});

const asset = computed(() => {
  const current = node.value;
  if (!current) return null;
  const id = current.data.outputAssetId ?? current.data.assetId;
  if (!id) return null;
  return project.doc.assets.find((item) => item.id === id) ?? null;
});

const preview = computed(() => {
  const current = asset.value;
  if (!current) return null;
  if (current.kind === "video" || current.kind === "image") return assetThumbnailUrl(current);
  return null;
});

const audioName = computed(() => (asset.value ? asset.value.name : null));

const textPreview = computed(() => {
  const current = node.value;
  if (!current) return "";
  const text = current.data.params.text;
  if (typeof text === "string") return text;
  return current.data.outputText ?? "";
});

const mode = computed(() => {
  const value = node.value?.data.params.mode;
  return value === "plain" ? "plain" : "markdown";
});

/** 极简 markdown：加粗 / 行内代码 / 标题 / 列表 / 换行（不引第三方解析器）。 */
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

/** 模型节点的实时文本输出（截断，完整内容在检查器里）。 */
const outputBrief = computed(() => {
  const text = node.value?.data.outputText ?? "";
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
});

const status = computed(() => node.value?.data.status ?? "idle");
const progress = computed(() => node.value?.data.progress ?? null);
const error = computed(() => node.value?.data.error ?? null);

function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}
</script>

<template>
  <div v-if="node && definition" class="board-node" :class="[`is-${definition.category}`, { selected }]">
    <header class="board-node-head">
      <span class="board-node-title">{{ title }}</span>
      <span class="board-node-status" :data-state="status" :title="i18n.t(`board.status.${status}`)" />
    </header>

    <div class="board-node-body">
      <p v-if="error" class="board-node-error">{{ error }}</p>

      <template v-if="definition.category === 'input' || definition.category === 'display'">
        <img v-if="preview" class="board-node-image" :src="preview" :alt="title" />
        <div v-else-if="definition.assetKind === 'audio'" class="board-node-audio">
          <span class="board-node-audio-wave" aria-hidden="true" />
          <span class="board-node-audio-name">{{ audioName ?? i18n.t("board.node.noAsset") }}</span>
        </div>
        <div v-else-if="definition.type === 'input.text' || definition.type === 'display.text'" class="board-node-text" :class="`mode-${mode}`">
          <div v-if="textPreview" v-html="mode === 'markdown' ? textHtml : textPreview" />
          <span v-else class="board-node-empty">{{ i18n.t("board.node.noText") }}</span>
        </div>
        <div v-else class="board-node-empty">{{ i18n.t("board.node.noAsset") }}</div>
      </template>

      <div v-else class="board-node-model">
        <img v-if="preview" class="board-node-image" :src="preview" :alt="title" />
        <div v-else-if="outputBrief" class="board-node-text mode-plain">{{ outputBrief }}</div>
        <span v-else class="board-node-model-hint">{{ i18n.t("board.node.modelHint") }}</span>
      </div>
    </div>

    <div v-if="progress !== null && status === 'running'" class="board-node-progress">
      <span :style="{ width: `${Math.round(progress * 100)}%` }" />
    </div>

    <Handle
      v-for="(port, index) in ports.inputs"
      :id="port.id"
      :key="`in-${port.id}`"
      type="target"
      :position="Position.Left"
      class="board-handle board-handle-in"
      :style="{ top: handleTop(index, ports.inputs.length) }"
    />
    <span
      v-for="(port, index) in ports.inputs"
      :key="`in-label-${port.id}`"
      class="board-port-label in"
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
      class="board-handle board-handle-out"
      :style="{ top: handleTop(index, ports.outputs.length) }"
    />
    <span
      v-for="(port, index) in ports.outputs"
      :key="`out-label-${port.id}`"
      class="board-port-label out"
      :style="{ top: handleTop(index, ports.outputs.length) }"
    >
      {{ i18n.t(port.labelKey) }}
    </span>
  </div>
</template>

<style scoped>
.board-node {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.55);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.1);
  font-size: 12px;
  color: rgb(var(--md-on-surface));
}
.board-node.selected {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.35), 0 6px 18px rgb(0 0 0 / 0.14);
}
.board-node-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: rgb(var(--md-surface-container-high) / 0.7);
}
.board-node-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.board-node-status {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
}
.board-node-status[data-state="done"] {
  background-color: rgb(var(--md-primary));
}
.board-node-status[data-state="running"] {
  background-color: rgb(var(--md-tertiary, 255 180 0));
}
.board-node-status[data-state="error"] {
  background-color: rgb(var(--md-error));
}
.board-node-status[data-state="stale"] {
  background-color: rgb(var(--md-outline));
}
.board-node-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background-color: rgb(var(--md-surface-container-highest) / 0.5);
}
.board-node-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.board-node-audio {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 10px;
}
.board-node-audio-wave {
  height: 26px;
  border-radius: 6px;
  background-image: repeating-linear-gradient(
    90deg,
    rgb(var(--md-primary) / 0.55) 0 2px,
    transparent 2px 5px
  );
  mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);
}
.board-node-audio-name {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.board-node-text {
  width: 100%;
  height: 100%;
  padding: 9px 10px;
  overflow: hidden;
  line-height: 1.55;
  word-break: break-word;
  color: rgb(var(--md-on-surface));
}
.board-node-text.mode-plain {
  white-space: pre-wrap;
}
.board-node-text :deep(h2),
.board-node-text :deep(h3),
.board-node-text :deep(h4) {
  margin: 0 0 4px;
  font-size: 13px;
}
.board-node-text :deep(li) {
  margin-left: 16px;
}
.board-node-text :deep(code) {
  padding: 0 3px;
  border-radius: 3px;
  background-color: rgb(var(--md-on-surface-variant) / 0.14);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
}
.board-node-empty {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 48px;
  padding: 10px;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant) / 0.75);
}
.board-node-error {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 6px;
  z-index: 2;
  margin: 0;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  color: rgb(var(--md-on-error));
  background-color: rgb(var(--md-error) / 0.9);
}
.board-node-model {
  display: grid;
  place-items: center;
  width: 100%;
  padding: 10px;
}
.board-node-model-hint {
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.board-node-progress {
  flex: 0 0 auto;
  height: 3px;
  background-color: rgb(var(--md-primary) / 0.15);
}
.board-node-progress span {
  display: block;
  height: 100%;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s linear;
}
/* 端口 */
.board-handle {
  width: 9px;
  height: 9px;
  border: 2px solid rgb(var(--md-surface-container-low));
  background-color: rgb(var(--md-primary));
}
.board-port-label {
  position: absolute;
  transform: translateY(-50%);
  font-size: 9.5px;
  color: rgb(var(--md-on-surface-variant) / 0.85);
  pointer-events: none;
  white-space: nowrap;
}
.board-port-label.in {
  left: 12px;
}
.board-port-label.out {
  right: 12px;
}
</style>
