<script setup lang="ts">
/**
 * 画布检查器：节点的所有操作都在这里（卡片上只做展示）。
 *
 * 输入节点：选本地文件 / 从素材库挑；显示节点：插入当前分P 时间线。
 * 参数按注册表的 ParamSpec 渲染，模型节点的模型下拉在模型节点阶段接入。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  FolderOpenIcon,
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
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import { providersForCapability } from "@/utils/cloudGen";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { ModelFeature } from "@/types/models";
import { importAssetAt, pickMediaFiles } from "@/core/media";
import { addAsset } from "@/core/ops";
import { insertImportedAssets } from "@/core/importInsert";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { copyText } from "@/utils/clipboard";
import { toast } from "@/composables/useToast";
import type { BoardParamSpec } from "@/types/board";

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

/** 动态模型下拉：本地模型 + 云端服务并排，值形如 local:/cloud:。 */
function modelOptions(spec: BoardParamSpec): { value: string; label: string }[] {
  if (!spec.model) return [];
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
      options.push({ value: `cloud:${provider.id}`, label: `${provider.name} · ${i18n.t("board.inspect.cloud")}` });
    }
  }
  return options;
}

function paramOptions(spec: BoardParamSpec): { value: string; label: string }[] {
  if (spec.model) return modelOptions(spec);
  return (spec.options ?? []).map((option) => ({ value: option.value, label: i18n.t(option.labelKey) }));
}

function runNode(): void {
  if (!node.value) return;
  run.runNode(node.value.id);
}

const node = computed(() => board.nodes.find((item) => item.id === board.selection[0]) ?? null);
const definition = computed(() => (node.value ? nodeDefinition(node.value.type) : null));

const title = computed(() => {
  if (!node.value) return "";
  if (node.value.data.title) return node.value.data.title;
  return definition.value ? i18n.t(definition.value.titleKey) : node.value.type;
});

const asset = computed(() => {
  const id = node.value?.data.assetId ?? node.value?.data.outputAssetId;
  if (!id) return null;
  return project.doc.assets.find((item) => item.id === id) ?? null;
});

const assetOptions = computed(() => {
  const kind = definition.value?.assetKind;
  return project.doc.assets.filter((item) => !kind || item.kind === kind);
});

const params = computed<BoardParamSpec[]>(() => definition.value?.params ?? []);

function setTitle(event: Event): void {
  if (!node.value) return;
  const value = (event.target as HTMLInputElement).value.trim();
  board.updateNodeData(node.value.id, { title: value || undefined });
}

function setParam(spec: BoardParamSpec, value: unknown): void {
  if (!node.value) return;
  board.updateNodeData(node.value.id, {
    params: { ...node.value.data.params, [spec.id]: value },
  });
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

async function pickFiles(): Promise<void> {
  if (!node.value) return;
  const files = await pickMediaFiles();
  for (const path of files) {
    try {
      const imported = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, imported));
      board.updateNodeData(node.value.id, { assetId: imported.id });
    } catch (error) {
      toast(String(error), "error");
    }
  }
}

function pickAsset(event: Event): void {
  if (!node.value) return;
  const id = (event.target as HTMLSelectElement).value;
  board.updateNodeData(node.value.id, { assetId: id || undefined });
}

function clearAsset(): void {
  if (!node.value) return;
  board.updateNodeData(node.value.id, { assetId: undefined });
}

/** 显示节点的"一键导出"：把素材插到当前分P 的播放头处。 */
function insertToTimeline(): void {
  const current = asset.value;
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
  const current = asset.value;
  if (current) await download(current);
}

async function copyPath(): Promise<void> {
  const current = asset.value;
  if (!current) return;
  await copyText(current.src);
  toast(i18n.t("board.inspect.pathCopied"));
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
      <section class="bi-section">
        <p class="bi-label">{{ i18n.t("board.inspect.node") }}</p>
        <input class="bi-input" type="text" :value="title" @change="setTitle" />
        <div class="bi-meta">
          <span class="bi-status" :data-state="node.data.status ?? 'idle'">
            {{ i18n.t(`board.status.${node.data.status ?? "idle"}`) }}
          </span>
          <span class="bi-type">{{ node.type }}</span>
        </div>
        <p v-if="node.data.error" class="bi-error">{{ node.data.error }}</p>
      </section>

      <section v-if="definition.category !== 'model'" class="bi-section">
        <p class="bi-label">{{ i18n.t("board.inspect.media") }}</p>
        <div class="bi-asset">
          <img v-if="asset && assetThumbnailUrl(asset)" class="bi-thumb" :src="assetThumbnailUrl(asset)!" :alt="asset.name" />
          <div class="bi-asset-copy">
            <span class="bi-asset-name">{{ asset?.name ?? i18n.t("board.node.noAsset") }}</span>
            <span v-if="asset" class="bi-asset-src" :title="asset.src">{{ asset.src }}</span>
          </div>
        </div>
        <div class="bi-row">
          <button class="bi-btn" type="button" @click="pickFiles">
            <FolderOpenIcon />{{ i18n.t("board.inspect.pickFile") }}
          </button>
          <button v-if="asset" class="bi-btn" type="button" @click="clearAsset">
            <XMarkIcon />{{ i18n.t("board.inspect.clearMedia") }}
          </button>
        </div>
        <label v-if="assetOptions.length > 0" class="bi-select-row">
          <RectangleStackIcon />
          <select class="bi-select" :value="node.data.assetId ?? ''" @change="pickAsset">
            <option value="">{{ i18n.t("board.inspect.pickAsset") }}</option>
            <option v-for="item in assetOptions" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </label>
      </section>

      <section v-if="params.length > 0" class="bi-section">
        <p class="bi-label">{{ i18n.t("board.inspect.params") }}</p>
        <label v-for="spec in params" :key="spec.id" class="bi-field">
          <span>{{ i18n.t(spec.labelKey) }}</span>
          <textarea
            v-if="spec.kind === 'longtext'"
            class="bi-textarea"
            rows="4"
            :value="paramValue(spec)"
            @input="setParam(spec, ($event.target as HTMLTextAreaElement).value)"
          />
          <select
            v-else-if="spec.kind === 'select'"
            class="bi-select"
            :value="paramValue(spec)"
            @change="setParam(spec, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ i18n.t("board.inspect.pickModel") }}</option>
            <option v-for="option in paramOptions(spec)" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <input
            v-else-if="spec.kind === 'toggle'"
            class="bi-check"
            type="checkbox"
            :checked="paramBool(spec)"
            @change="setParam(spec, ($event.target as HTMLInputElement).checked)"
          />
          <input
            v-else
            class="bi-input"
            :type="spec.kind === 'number' || spec.kind === 'seed' ? 'number' : 'text'"
            :min="spec.min"
            :max="spec.max"
            :step="spec.step"
            :value="paramValue(spec)"
            @change="setParam(spec, spec.kind === 'number' || spec.kind === 'seed' ? Number(($event.target as HTMLInputElement).value) : ($event.target as HTMLInputElement).value)"
          />
        </label>
      </section>

      <section class="bi-section">
        <p class="bi-label">{{ i18n.t("board.inspect.output") }}</p>
        <div class="bi-row wrap">
          <span class="bi-status" :data-state="node.data.status ?? 'idle'">
            {{ i18n.t(`board.status.${node.data.status ?? "idle"}`) }}
          </span>
          <span v-if="node.data.outputText" class="bi-output-chars">
            {{ i18n.t("board.inspect.chars", { count: node.data.outputText.length }) }}
          </span>
          <span v-else-if="!asset" class="bi-output-empty">{{ i18n.t("board.inspect.outputEmpty") }}</span>
        </div>
      </section>

      <section class="bi-section">
        <p class="bi-label">{{ i18n.t("board.inspect.actions") }}</p>
        <div class="bi-row wrap">
          <button
            v-if="definition.category === 'model'"
            class="bi-btn primary"
            type="button"
            @click="runNode"
          >
            {{ i18n.t("board.inspect.run") }}
          </button>
          <button v-if="asset" class="bi-btn" type="button" @click="insertToTimeline">
            <ArrowDownTrayIcon />{{ i18n.t("board.inspect.insertTimeline") }}
          </button>
          <button v-if="asset" class="bi-btn" type="button" @click="downloadAsset">
            {{ i18n.t("board.inspect.download") }}
          </button>
          <button v-if="asset" class="bi-btn" type="button" @click="copyPath">
            {{ i18n.t("board.inspect.copyPath") }}
          </button>
          <button class="bi-btn danger" type="button" @click="remove">
            <TrashIcon />{{ i18n.t("common.delete") }}
          </button>
        </div>
      </section>
    </template>

    <div v-else class="bi-empty">
      <p class="bi-empty-title">{{ i18n.t("board.inspect.empty") }}</p>
      <p class="bi-empty-hint">{{ i18n.t("board.inspect.emptyHint") }}</p>
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
  gap: 14px;
}
.bi-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bi-label {
  margin: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant) / 0.85);
}
.bi-input,
.bi-textarea,
.bi-select {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high) / 0.6);
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
.bi-input:focus,
.bi-textarea:focus,
.bi-select:focus {
  border-color: rgb(var(--md-primary));
}
.bi-textarea {
  resize: vertical;
  min-height: 68px;
  font-family: inherit;
  line-height: 1.5;
}
.bi-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.bi-status[data-state="done"] {
  color: rgb(var(--md-primary));
}
.bi-status[data-state="error"] {
  color: rgb(var(--md-error));
}
.bi-type {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10.5px;
  opacity: 0.7;
}
.bi-error {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  color: rgb(var(--md-on-error));
  background-color: rgb(var(--md-error) / 0.9);
}
.bi-asset {
  display: flex;
  gap: 10px;
  align-items: center;
}
.bi-thumb {
  width: 72px;
  height: 46px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
  background-color: rgb(var(--md-surface-container-highest));
}
.bi-asset-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bi-asset-name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bi-asset-src {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant) / 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bi-row {
  display: flex;
  gap: 6px;
}
.bi-row.wrap {
  flex-wrap: wrap;
}
.bi-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  font-size: 12px;
  color: rgb(var(--md-on-surface));
  cursor: pointer;
}
.bi-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.1);
}
.bi-btn.primary {
  border-color: transparent;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary));
}
.bi-btn.danger:hover {
  color: rgb(var(--md-error));
}
.bi-btn :deep(svg) {
  width: 14px;
  height: 14px;
}
.bi-select-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--md-on-surface-variant));
}
.bi-select-row :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.bi-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.bi-check {
  width: 16px;
  height: 16px;
  accent-color: rgb(var(--md-primary));
}
.bi-output-chars,
.bi-output-empty {
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.bi-empty {
  margin-top: 40px;
  text-align: center;
  padding: 0 12px;
}
.bi-empty-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.bi-empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
</style>
