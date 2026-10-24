<script setup lang="ts">
/**
 * 检查器里的 OFX 效果链。
 *
 * 这里只管理「链」：添加、启停、排序、删除、打开参数面板。
 * 具体参数在隐藏的「参数」面板里编辑，避免参数多的插件把检查器撑爆。
 */
import { computed, onMounted, ref } from "vue";
import {
  AdjustmentsHorizontalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import type { Clip, ClipEffect, Project } from "@/types/project";
import type { OfxPluginInfo, PluginStatus } from "@/types/plugins";
import { useProjectStore } from "@/stores/project";
import { usePluginsStore } from "@/stores/plugins";
import { useOfxStore } from "@/stores/ofx";
import { useEffectRenderStore } from "@/stores/effectRender";
import { useLayoutStore } from "@/stores/layout";
import {
  addClipEffect,
  moveClipEffect,
  removeClipEffect,
  setClipEffectEnabled,
} from "@/core/ops";
import { defaultEffectParams } from "@/core/effects";
import { toast } from "@/composables/useToast";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  clip: Clip | null;
  clips: Clip[];
  disabled?: boolean;
}>();

const project = useProjectStore();
const plugins = usePluginsStore();
const ofx = useOfxStore();
const effectRender = useEffectRenderStore();
const layout = useLayoutStore();
const i18n = useI18n();

const effects = computed(() => props.clip?.effects ?? []);

/** 当前片段的整段预渲染状态（打开效果后自动排队）。 */
const renderJob = computed(() => effectRender.jobFor(props.clip?.id ?? null));
const renderPct = computed(() => {
  const job = renderJob.value;
  if (!job || job.total <= 0) return 0;
  return Math.min(100, Math.round((job.done / job.total) * 100));
});

/** 只有画面素材能进 OFX；文字与纯音频片段跳过。 */
const targetClips = computed(() =>
  props.clips.filter((clip) => {
    if (!clip.assetId) return false;
    const asset = project.doc.assets.find((item) => item.id === clip.assetId);
    return asset?.kind === "video" || asset?.kind === "image";
  }),
);

interface MatchedEffect {
  clip: Clip;
  effect: ClipEffect;
}

/** 优先按 effect.id 匹配（同一手势应用到多选时 id 相同），否则按链序号。 */
function matched(effect: ClipEffect, index: number): MatchedEffect[] {
  const out: MatchedEffect[] = [];
  for (const clip of targetClips.value) {
    const list = clip.effects ?? [];
    const byId = list.find((item) => item.id === effect.id);
    const candidate = byId ?? list[index];
    if (candidate && candidate.plugin === effect.plugin) {
      out.push({ clip, effect: candidate });
    }
  }
  return out;
}

function dispatch(
  effect: ClipEffect,
  index: number,
  mutate: (doc: Project, clipId: string, effectId: string) => Project,
  labelKey: string,
): void {
  const targets = matched(effect, index);
  if (targets.length === 0) return;
  project.dispatch(
    (doc) => {
      let next = doc;
      for (const target of targets) {
        next = mutate(next, target.clip.id, target.effect.id);
      }
      return next;
    },
    { kind: "ui.dispatch", actor: "human", label: i18n.t(labelKey) },
  );
}

function isEnabledMixed(effect: ClipEffect, index: number): boolean {
  const values = matched(effect, index).map((item) => item.effect.enabled !== false);
  return values.length > 1 && new Set(values).size > 1;
}

function toggleEffect(effect: ClipEffect, index: number, enabled: boolean): void {
  dispatch(
    effect,
    index,
    (doc, clipId, effectId) => setClipEffectEnabled(doc, clipId, effectId, enabled),
    "effects.toggle",
  );
}

function moveEffect(effect: ClipEffect, index: number, delta: number): void {
  dispatch(
    effect,
    index,
    (doc, clipId, effectId) => moveClipEffect(doc, clipId, effectId, delta),
    "effects.reorder",
  );
}

function removeEffect(effect: ClipEffect, index: number): void {
  dispatch(
    effect,
    index,
    (doc, clipId, effectId) => removeClipEffect(doc, clipId, effectId),
    "effects.remove",
  );
}

/** 打开「参数」面板，并把它绑定到当前片段 / 效果。 */
function openParams(effect: ClipEffect): void {
  const clip = props.clip;
  if (!clip || targetClips.value.length === 0) return;
  ofx.openEffectTarget({
    bundle: effect.bundle,
    plugin: effect.plugin,
    name: effect.name,
    clipId: clip.id,
    effectId: effect.id,
    selectedClipIds: targetClips.value.map((item) => item.id),
  });
  layout.openTab("pluginEditor");
}

// ---------------------------------------------------------------------------
// 添加效果
// ---------------------------------------------------------------------------

const installedBundles = computed(() =>
  plugins.installedPlugins.filter((plugin) => {
    if (!plugin.installed_path) return false;
    if (plugin.plugin_types.length === 0) return true;
    return plugin.plugin_types.some(
      (type) => type === "filter" || type === "generator" || type === "general",
    );
  }),
);

const bundleOptions = computed<SelectOption[]>(() =>
  installedBundles.value.map((plugin) => ({
    id: plugin.slug,
    label: plugin.name,
    hint: plugin.plugin_types.join(" / "),
  })),
);

const addModel = ref<string | null>(null);
const addBusy = ref(false);
const pendingBundle = ref<PluginStatus | null>(null);
const pendingPlugins = ref<OfxPluginInfo[]>([]);
const pluginModel = ref<string | null>(null);

const pluginOptions = computed<SelectOption[]>(() =>
  pendingPlugins.value.map((plugin) => ({
    id: plugin.identifier,
    label: plugin.label || plugin.name || plugin.identifier,
    hint: plugin.grouping,
  })),
);

function cancelPick(): void {
  pendingBundle.value = null;
  pendingPlugins.value = [];
  pluginModel.value = null;
}

async function onAddBundle(slug: string): Promise<void> {
  addModel.value = null;
  if (addBusy.value) return;
  const status = installedBundles.value.find((plugin) => plugin.slug === slug);
  if (!status?.installed_path) return;
  addBusy.value = true;
  try {
    const found = await ofx.probe(status.installed_path);
    if (found.length === 0) throw new Error(i18n.t("effects.notFound"));
    if (found.length === 1) {
      addEffect(status, found[0]);
    } else {
      pendingBundle.value = status;
      pendingPlugins.value = found;
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    addBusy.value = false;
  }
}

function onAddPlugin(identifier: string): void {
  const status = pendingBundle.value;
  const info = pendingPlugins.value.find((plugin) => plugin.identifier === identifier);
  if (!status || !info) return;
  addEffect(status, info);
}

function addEffect(status: PluginStatus, info: OfxPluginInfo): void {
  const bundle = status.installed_path;
  if (!bundle || targetClips.value.length === 0) return;
  const effect: ClipEffect = {
    id: crypto.randomUUID(),
    plugin: info.identifier,
    name: info.label || info.name || info.identifier,
    bundle,
    ...(info.context ? { context: info.context } : {}),
    params: defaultEffectParams(info),
    enabled: true,
  };
  const targets = targetClips.value;
  project.dispatch(
    (doc) => {
      let next = doc;
      for (const clip of targets) {
        next = addClipEffect(next, clip.id, {
          ...effect,
          params: { ...effect.params },
        });
      }
      return next;
    },
    { kind: "ui.dispatch", actor: "human", label: i18n.t("effects.add") },
  );
  cancelPick();
}

onMounted(() => {
  if (plugins.installedPlugins.length === 0) void plugins.loadInstalled();
});
</script>

<template>
  <div class="effects-section">
    <div class="effects-head">
      <span class="section-label">{{ i18n.t("effects.title") }}</span>
      <div class="add-wrap">
        <Md3Select
          v-if="bundleOptions.length > 0"
          class="add-select"
          compact
          :model-value="addModel"
          :options="bundleOptions"
          :label="i18n.t('effects.add')"
          :placeholder="addBusy ? i18n.t('effects.probing') : i18n.t('effects.add')"
          :disabled="disabled || addBusy"
          @update:model-value="onAddBundle"
        />
        <button
          v-else
          class="manage-btn"
          type="button"
          @click="layout.openDownloads('plugins')"
        >
          <PlusIcon class="manage-icon" />
          {{ i18n.t("effects.manage") }}
        </button>
      </div>
    </div>

    <div
      v-if="renderJob && renderJob.status !== 'ready'"
      class="render-state"
      :class="{ error: renderJob.status === 'error' }"
    >
      <template v-if="renderJob.status === 'error'">
        <ExclamationTriangleIcon class="render-icon" />
        <span class="render-text">
          {{ i18n.t("effects.renderFailed", { error: renderJob.error ?? "" }) }}
        </span>
      </template>
      <template v-else>
        <span class="render-text">
          {{
            renderJob.status === "queued"
              ? i18n.t("effects.renderQueued")
              : i18n.t("effects.rendering", { pct: renderPct })
          }}
        </span>
        <div class="render-bar">
          <div class="render-fill" :style="{ width: `${renderPct}%` }" />
        </div>
      </template>
    </div>

    <div v-if="pendingPlugins.length > 0" class="plugin-picker">
      <span class="picker-label">{{ i18n.t("effects.choosePlugin") }}</span>
      <Md3Select
        class="picker-select"
        :model-value="pluginModel"
        :options="pluginOptions"
        :label="i18n.t('effects.choosePlugin')"
        @update:model-value="onAddPlugin"
      />
      <button class="btn-text" type="button" @click="cancelPick">
        {{ i18n.t("common.cancel") }}
      </button>
    </div>

    <p v-if="effects.length === 0" class="effect-empty">
      {{ i18n.t("effects.empty") }}
    </p>

    <div
      v-for="(effect, index) in effects"
      :key="effect.id"
      class="effect-card"
      :class="{ off: effect.enabled === false }"
    >
      <div class="effect-head">
        <span class="effect-name" :title="effect.bundle">{{ effect.name }}</span>
        <span v-if="isEnabledMixed(effect, index)" class="mixed-chip">
          {{ i18n.t("effects.mixed") }}
        </span>
        <button
          class="effect-move"
          type="button"
          :aria-label="i18n.t('effects.moveUp')"
          :disabled="disabled || index === 0"
          @click="moveEffect(effect, index, -1)"
        >
          <ChevronUpIcon class="move-icon" />
        </button>
        <button
          class="effect-move"
          type="button"
          :aria-label="i18n.t('effects.moveDown')"
          :disabled="disabled || index === effects.length - 1"
          @click="moveEffect(effect, index, 1)"
        >
          <ChevronDownIcon class="move-icon" />
        </button>
        <ToggleSwitch
          :model-value="effect.enabled !== false"
          :label="i18n.t('effects.enabled')"
          :disabled="disabled"
          @update:model-value="toggleEffect(effect, index, $event)"
        />
      </div>

      <div class="effect-foot">
        <button
          class="effect-params-btn"
          type="button"
          :title="i18n.t('effects.openParams')"
          :disabled="disabled"
          @click="openParams(effect)"
        >
          <AdjustmentsHorizontalIcon class="action-icon" />
          <span>{{ i18n.t("effects.openParams") }}</span>
        </button>
        <button
          class="effect-remove"
          type="button"
          :aria-label="i18n.t('effects.remove')"
          :disabled="disabled"
          @click="removeEffect(effect, index)"
        >
          <TrashIcon class="remove-icon" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.effects-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.effects-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 18px;
}
.section-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-muted));
}
.add-wrap {
  flex: 0 0 auto;
  min-width: 0;
}
.add-select {
  width: 132px;
}
.manage-btn {
  height: 28px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.manage-icon {
  width: 13px;
  height: 13px;
}
.render-state {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
}
.render-state.error {
  flex-direction: row;
  align-items: flex-start;
  gap: 6px;
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.render-text {
  font-size: 10.5px;
  line-height: 1.4;
  color: rgb(var(--md-on-surface-variant));
  overflow-wrap: anywhere;
}
.render-state.error .render-text {
  color: inherit;
}
.render-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  margin-top: 1px;
}
.render-bar {
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgb(var(--md-primary) / 0.15);
}
.render-fill {
  height: 100%;
  width: 0;
  background-color: rgb(var(--md-primary));
  transition: width 140ms linear;
}
.plugin-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
}
.picker-label {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  flex: 1 1 auto;
}
.picker-select {
  width: 140px;
}
.effect-empty {
  margin: 0;
  padding: 10px 12px;
  border-radius: 14px;
  background-color: var(--app-inset);
  font-size: 11.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}
.effect-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 16px;
  background-color: var(--app-inset);
}
.effect-card.off {
  opacity: 0.62;
}
.effect-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
}
.effect-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.mixed-chip {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
  font-size: 9px;
  font-weight: 600;
}
.effect-move,
.effect-remove {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
  cursor: pointer;
}
.effect-move:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.effect-move:disabled {
  opacity: 0.3;
  cursor: default;
}
.effect-remove:hover:not(:disabled) {
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.effect-remove:disabled {
  opacity: 0.4;
  cursor: default;
}
.effect-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 2px 0 2px;
}
.effect-params-btn {
  height: 27px;
  margin: 0;
  padding: 0 11px 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.14s ease, transform 0.14s ease;
}
.effect-foot .effect-remove {
  margin-left: auto;
}
.effect-params-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}
.effect-params-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.effect-params-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.action-icon {
  width: 13px;
  height: 13px;
}
.move-icon,
.remove-icon {
  width: 12px;
  height: 12px;
}
.btn-text {
  border: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11px;
  cursor: pointer;
}
</style>
