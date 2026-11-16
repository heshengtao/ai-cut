<script setup lang="ts">
/**
 * 画布检查器（MD3）：节点的所有编辑都在这里。
 *
 * 版式对齐 ai-board 的 inspector：节点标题条 → 分区小标题（大写小字）→ 字段
 * （标签 + MD3 输入框）→ 媒体预览卡 → 操作按钮。图片输入支持多张（牌堆），
 * 这里用缩略图网格管理。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  CheckIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  PlusIcon,
  RectangleStackIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useBoardRun } from "@/composables/useBoardRun";
import { useAssetDownload } from "@/composables/useAssetDownload";
import { nodeDefinition } from "@/core/board/registry";
import { nodeIcon } from "@/components/board/nodeIcons";
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import { providersForCapability } from "@/utils/cloudGen";
import { importAssetAt, pickMediaFiles } from "@/core/media";
import { addAsset } from "@/core/ops";
import { insertImportedAssets } from "@/core/importInsert";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { copyText } from "@/utils/clipboard";
import { toast } from "@/composables/useToast";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { ModelFeature } from "@/types/models";
import type { BoardParamSpec } from "@/types/board";
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

const node = computed(() => board.nodes.find((item) => item.id === board.selection[0]) ?? null);
const definition = computed(() => (node.value ? nodeDefinition(node.value.type) : null));
const title = computed(() => {
  if (!node.value) return "";
  if (node.value.data.title) return node.value.data.title;
  return definition.value ? i18n.t(definition.value.titleKey) : node.value.type;
});
const isModel = computed(() => definition.value?.category === "model");
const isImageNode = computed(() => definition.value?.assetKind === "image");

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

const asset = computed(() => {
  const current = node.value;
  if (!current) return null;
  if (isImageNode.value) return stack.value[stackIndex.value] ?? null;
  const id = current.data.assetId ?? current.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
const outputAsset = computed(() => {
  const id = node.value?.data.outputAssetId;
  return id ? project.doc.assets.find((item) => item.id === id) ?? null : null;
});
const assetOptions = computed(() => {
  const kind = definition.value?.assetKind;
  return project.doc.assets.filter((item) => !kind || item.kind === kind);
});
const params = computed<BoardParamSpec[]>(() => definition.value?.params ?? []);

onMounted(() => {
  void models.load();
  void loadCloudProviders();
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

function setTitle(event: Event): void {
  if (!node.value) return;
  const value = (event.target as HTMLInputElement).value.trim();
  board.updateNodeData(node.value.id, { title: value || undefined });
}

function setParam(spec: BoardParamSpec, value: unknown): void {
  if (!node.value) return;
  board.updateNodeData(node.value.id, { params: { ...node.value.data.params, [spec.id]: value } });
}

function paramValue(spec: BoardParamSpec): string {
  const current = node.value?.data.params[spec.id];
  if (current === undefined || current === null) return spec.default === undefined ? "" : String(spec.default);
  return String(current);
}

function paramBool(spec: BoardParamSpec): boolean {
  const current = node.value?.data.params[spec.id];
  return typeof current === "boolean" ? current : spec.default === true;
}

/** 动态模型下拉：本地模型 + 云端服务并排，值形如 local: / cloud:。 */
function paramOptions(spec: BoardParamSpec): { value: string; label: string }[] {
  if (spec.model) {
    const options: { value: string; label: string }[] = [];
    for (const model of models.ofFeature(spec.model.feature as ModelFeature)) {
      options.push({
        value: `local:${model.id}`,
        label: model.installed ? model.name : `${model.name} · ${i18n.t("board.inspect.missing")}`,
      });
    }
    if (spec.model.capability) {
      for (const provider of providersForCapability(
        cloudProviders.value,
        spec.model.capability as never,
        cloudPresets.value,
      )) {
        options.push({
          value: `cloud:${provider.id}`,
          label: `${provider.name} · ${i18n.t("board.inspect.cloud")}`,
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

function pickAsset(event: Event): void {
  const current = node.value;
  if (!current) return;
  const id = (event.target as HTMLSelectElement).value;
  (event.target as HTMLSelectElement).value = "";
  if (!id) return;
  if (isImageNode.value) appendToStack(id);
  else board.updateNodeData(current.id, { assetId: id, assetIds: undefined });
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
</script>

<template>
  <div class="board-inspector">
    <template v-if="node && definition">
      <!-- 节点标题条 -->
      <div class="insp-node">
        <span class="insp-node-icon">
          <component :is="nodeIcon(node.type)" />
        </span>
        <div class="insp-node-copy">
          <input class="insp-node-title" :value="title" @change="setTitle" />
          <span class="insp-node-type">{{ node.type }}</span>
        </div>
        <span class="insp-node-status" :data-state="node.data.status ?? 'idle'">
          {{ i18n.t(`board.status.${node.data.status ?? "idle"}`) }}
        </span>
      </div>

      <!-- 运行（模型节点） -->
      <section v-if="isModel" class="insp-section">
        <p class="insp-title">{{ i18n.t("board.inspect.runSection") }}</p>
        <div class="insp-actions">
          <button class="md-btn filled" type="button" @click="runNode">
            {{ i18n.t("board.inspect.run") }}
          </button>
          <button class="md-btn text" type="button" @click="duplicate">
            <DocumentDuplicateIcon />{{ i18n.t("board.ctx.duplicate") }}
          </button>
        </div>
        <p v-if="node.data.error" class="insp-error">{{ node.data.error }}</p>
        <div v-if="node.data.outputText" class="insp-output-text">{{ node.data.outputText }}</div>
      </section>

      <!-- 素材 -->
      <section v-if="!isModel" class="insp-section">
        <p class="insp-title">
          {{ i18n.t("board.inspect.media") }}
          <span v-if="isImageNode && stack.length > 1" class="insp-count">
            {{ i18n.t("board.inspect.stackCount", { count: stack.length }) }}
          </span>
        </p>

        <!-- 图片：牌堆缩略图网格 -->
        <div v-if="isImageNode" class="insp-stack">
          <button
            v-for="(item, index) in stack"
            :key="item.id"
            type="button"
            class="insp-stack-item"
            :class="{ on: index === stackIndex }"
            :title="item.name"
            @click="showInStack(index)"
          >
            <img v-if="assetThumbnailUrl(item)" :src="assetThumbnailUrl(item)!" :alt="item.name" />
            <span class="insp-stack-index">{{ index + 1 }}</span>
            <span class="insp-stack-remove" role="button" :title="i18n.t('common.remove')" @click.stop="removeFromStack(item.id)">
              <XMarkIcon />
            </span>
            <span v-if="index === stackIndex" class="insp-stack-check"><CheckIcon /></span>
          </button>
          <button class="insp-stack-add" type="button" :title="i18n.t('board.inspect.addImages')" @click="pickFiles">
            <PlusIcon />
          </button>
        </div>

        <!-- 视频 / 音频：单张媒体卡 -->
        <div v-else-if="asset" class="insp-media">
          <img v-if="assetThumbnailUrl(asset)" :src="assetThumbnailUrl(asset)!" :alt="asset.name" />
          <div class="insp-media-copy">
            <strong>{{ asset.name }}</strong>
            <span>{{ asset.src }}</span>
          </div>
          <button class="insp-media-x" type="button" :title="i18n.t('board.inspect.clearMedia')" @click="clearAsset">
            <XMarkIcon />
          </button>
        </div>
        <p v-else class="insp-hint">{{ i18n.t("board.node.noAsset") }}</p>

        <div class="insp-actions">
          <button class="md-btn tonal" type="button" @click="pickFiles">
            <FolderOpenIcon />{{ i18n.t("board.inspect.pickFile") }}
          </button>
          <label v-if="assetOptions.length > 0" class="md-btn outlined file-btn">
            <RectangleStackIcon />
            <span>{{ i18n.t("board.inspect.pickAsset") }}</span>
            <select class="insp-asset-select" :value="''" @change="pickAsset">
              <option value="">{{ i18n.t("board.inspect.pickAsset") }}</option>
              <option v-for="item in assetOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
        </div>
      </section>

      <!-- 参数 -->
      <section v-if="params.length > 0" class="insp-section">
        <p class="insp-title">{{ i18n.t("board.inspect.params") }}</p>
        <label v-for="spec in params" :key="spec.id" class="md-field">
          <span>{{ i18n.t(spec.labelKey) }}</span>
          <textarea
            v-if="spec.kind === 'longtext'"
            class="md-textarea"
            rows="4"
            :value="paramValue(spec)"
            @input="setParam(spec, ($event.target as HTMLTextAreaElement).value)"
          />
          <select
            v-else-if="spec.kind === 'select'"
            class="md-select"
            :value="paramValue(spec)"
            @change="setParam(spec, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ i18n.t("board.inspect.pickModel") }}</option>
            <option v-for="option in paramOptions(spec)" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <button
            v-else-if="spec.kind === 'toggle'"
            class="md-switch"
            type="button"
            role="switch"
            :aria-checked="paramBool(spec)"
            :data-on="paramBool(spec) ? 'true' : 'false'"
            @click="setParam(spec, !paramBool(spec))"
          >
            <span class="md-switch-thumb" />
          </button>
          <input
            v-else
            class="md-input"
            :type="spec.kind === 'number' || spec.kind === 'seed' ? 'number' : 'text'"
            :min="spec.min"
            :max="spec.max"
            :step="spec.step"
            :value="paramValue(spec)"
            @change="
              setParam(
                spec,
                spec.kind === 'number' || spec.kind === 'seed'
                  ? Number(($event.target as HTMLInputElement).value)
                  : ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>
      </section>

      <!-- 输出 -->
      <section class="insp-section">
        <p class="insp-title">{{ i18n.t("board.inspect.output") }}</p>
        <div class="insp-output">
          <img
            v-if="outputAsset && assetThumbnailUrl(outputAsset)"
            class="insp-output-thumb"
            :src="assetThumbnailUrl(outputAsset)!"
            :alt="outputAsset.name"
          />
          <div class="insp-output-copy">
            <strong>{{ outputAsset?.name ?? i18n.t("board.inspect.outputEmpty") }}</strong>
            <span v-if="node.data.outputText">
              {{ i18n.t("board.inspect.chars", { count: node.data.outputText.length }) }}
            </span>
            <span v-else-if="outputAsset" class="insp-mono">{{ outputAsset.kind }}</span>
          </div>
        </div>
      </section>

      <!-- 操作 -->
      <section class="insp-section">
        <p class="insp-title">{{ i18n.t("board.inspect.actions") }}</p>
        <div class="insp-actions wrap">
          <button v-if="asset || outputAsset" class="md-btn tonal" type="button" @click="insertToTimeline">
            <ArrowDownTrayIcon />{{ i18n.t("board.inspect.insertTimeline") }}
          </button>
          <button v-if="asset || outputAsset" class="md-btn text" type="button" @click="downloadAsset">
            {{ i18n.t("board.inspect.download") }}
          </button>
          <button v-if="asset || outputAsset" class="md-btn text" type="button" @click="copyPath">
            {{ i18n.t("board.inspect.copyPath") }}
          </button>
          <button class="md-btn text danger" type="button" @click="remove">
            <TrashIcon />{{ i18n.t("common.delete") }}
          </button>
        </div>
      </section>
    </template>

    <div v-else class="insp-empty">
      <p class="insp-empty-title">{{ i18n.t("board.inspect.empty") }}</p>
      <p class="insp-empty-hint">{{ i18n.t("board.inspect.emptyHint") }}</p>
    </div>
  </div>
</template>

<style scoped>
.board-inspector {
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 节点标题条（ai-board 的 inspector-node-title） */
.insp-node {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 12px;
  background: var(--app-inset);
  border: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.insp-node-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: rgb(var(--md-primary-container) / 0.7);
  color: rgb(var(--md-on-primary-container));
}
.insp-node-icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.insp-node-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.insp-node-title {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12px;
  font-weight: 650;
  color: rgb(var(--md-on-surface));
  padding: 0;
}
.insp-node-type {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  color: rgb(var(--md-on-surface-variant));
}
.insp-node-status {
  flex: 0 0 auto;
  font-size: 9px;
  padding: 2px 7px;
  border-radius: 999px;
  color: rgb(var(--md-on-surface-variant));
  background: rgb(var(--md-on-surface-variant) / 0.12);
}
.insp-node-status[data-state="done"] {
  color: rgb(var(--md-primary));
  background: rgb(var(--md-primary) / 0.14);
}
.insp-node-status[data-state="error"] {
  color: rgb(var(--md-error));
  background: rgb(var(--md-error) / 0.14);
}

/* 分区 */
.insp-section {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.insp-title {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant) / 0.9);
}
.insp-count {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--md-on-surface-variant) / 0.75);
}
.insp-hint {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}

/* MD3 字段 */
.md-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.md-field > span {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-variant));
}
.md-input,
.md-textarea,
.md-select {
  width: 100%;
  border: 1px solid rgb(var(--md-outline) / 0.45);
  border-radius: 12px;
  background: rgb(var(--md-surface-container-lowest) / 0.55);
  color: rgb(var(--md-on-surface));
  padding: 9px 11px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.md-textarea {
  resize: vertical;
  min-height: 84px;
  line-height: 1.55;
}
.md-input:focus,
.md-textarea:focus,
.md-select:focus {
  border-color: rgb(var(--md-primary) / 0.8);
  box-shadow: 0 0 0 3px rgb(var(--md-primary) / 0.12);
}
.md-select {
  appearance: none;
  padding-right: 30px;
  background-image:
    linear-gradient(45deg, transparent 50%, rgb(var(--md-on-surface-variant)) 50%),
    linear-gradient(135deg, rgb(var(--md-on-surface-variant)) 50%, transparent 50%);
  background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

/* MD3 按钮 */
.insp-actions {
  display: flex;
  gap: 7px;
}
.insp-actions.wrap {
  flex-wrap: wrap;
}
.md-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: rgb(var(--md-primary));
  background: transparent;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.md-btn :deep(svg) {
  width: 15px;
  height: 15px;
}
.md-btn.filled {
  color: rgb(var(--md-on-primary));
  background: rgb(var(--md-primary));
}
.md-btn.tonal {
  color: rgb(var(--md-on-secondary-container));
  background: rgb(var(--md-secondary-container));
}
.md-btn.outlined {
  border-color: rgb(var(--md-outline) / 0.55);
  color: rgb(var(--md-on-surface-variant));
}
.md-btn.text:hover,
.md-btn.outlined:hover,
.md-btn.tonal:hover {
  background: rgb(var(--md-on-surface-variant) / 0.1);
}
.md-btn.filled:hover {
  filter: brightness(1.06);
}
.md-btn.danger {
  color: rgb(var(--md-error));
}
.file-btn {
  position: relative;
  overflow: hidden;
}
.insp-asset-select {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* MD3 开关 */
.md-switch {
  position: relative;
  width: 44px;
  height: 26px;
  padding: 0;
  border: 1px solid rgb(var(--md-outline) / 0.6);
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}
.md-switch[data-on="true"] {
  background: rgb(var(--md-primary));
  border-color: transparent;
}
.md-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgb(var(--md-outline));
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease;
}
.md-switch[data-on="true"] .md-switch-thumb {
  transform: translateX(18px);
  background: rgb(var(--md-on-primary));
}

/* 图片牌堆 */
.insp-stack {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
}
.insp-stack-item,
.insp-stack-add {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background: rgb(var(--md-surface-container-high) / 0.6);
  padding: 0;
  cursor: pointer;
}
.insp-stack-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.insp-stack-item.on {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.35);
}
.insp-stack-index {
  position: absolute;
  left: 4px;
  bottom: 4px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 9px;
  line-height: 15px;
  text-align: center;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
}
.insp-stack-remove {
  position: absolute;
  right: 3px;
  top: 3px;
  width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
  opacity: 0;
  transition: opacity 0.14s ease;
}
.insp-stack-item:hover .insp-stack-remove {
  opacity: 1;
}
.insp-stack-remove :deep(svg),
.insp-stack-check :deep(svg) {
  width: 11px;
  height: 11px;
}
.insp-stack-check {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: rgb(var(--md-on-primary));
  background: rgb(var(--md-primary));
}
.insp-stack-add {
  display: grid;
  place-items: center;
  border-style: dashed;
  color: rgb(var(--md-on-surface-variant));
}
.insp-stack-add :deep(svg) {
  width: 18px;
  height: 18px;
}

/* 媒体卡 */
.insp-media {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px;
  border-radius: 12px;
  background: rgb(var(--md-surface-container-low) / 0.65);
  border: 1px solid rgb(var(--md-outline-variant) / 0.35);
}
.insp-media img {
  width: 64px;
  height: 52px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 8px;
  background: #000;
}
.insp-media-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.insp-media-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.insp-media-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  color: rgb(var(--md-on-surface-variant));
}
.insp-media-x {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.insp-media-x:hover {
  background: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.insp-media-x :deep(svg) {
  width: 14px;
  height: 14px;
}

/* 输出 */
.insp-output {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px;
  border-radius: 12px;
  background: rgb(var(--md-surface-container-low) / 0.5);
  border: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.insp-output-thumb {
  width: 64px;
  height: 52px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 8px;
  background: #000;
}
.insp-output-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.insp-output-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.insp-output-copy span {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  color: rgb(var(--md-on-surface-variant));
}
.insp-output-text {
  max-height: 140px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgb(var(--md-surface-container-low) / 0.55);
  border: 1px solid rgb(var(--md-outline-variant) / 0.3);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: rgb(var(--md-on-surface));
}
.insp-error {
  margin: 0;
  padding: 7px 9px;
  border-radius: 10px;
  font-size: 11px;
  color: rgb(var(--md-on-error));
  background: rgb(var(--md-error) / 0.9);
}

/* 空态 */
.insp-empty {
  margin-top: 40px;
  text-align: center;
  padding: 0 12px;
}
.insp-empty-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
}
.insp-empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
</style>
