<script setup lang="ts">
/**
 * 「参数」面板：编辑当前 OFX 特效实例的全部参数。
 *
 * 从检查器的特效卡片打开；也可以从插件列表打开，此时只读展示该插件的
 * 默认参数表。面板默认不在标签栏里，避免参数多的插件占满检查器。
 */
import { computed, ref, watch } from "vue";
import {
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  PuzzlePieceIcon,
} from "@heroicons/vue/24/outline";
import type { Clip, ClipEffect } from "@/types/project";
import type { OfxPluginInfo } from "@/types/plugins";
import { useProjectStore } from "@/stores/project";
import { useOfxStore } from "@/stores/ofx";
import { useLayoutStore } from "@/stores/layout";
import { defaultEffectParams } from "@/core/effects";
import EffectParamEditor from "./EffectParamEditor.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const ofx = useOfxStore();
const layout = useLayoutStore();
const i18n = useI18n();

const target = computed(() => ofx.editorTarget);
const loading = ref(false);
const error = ref<string | null>(null);
const plugins = ref<OfxPluginInfo[]>([]);
const pluginId = ref("");

let loadToken = 0;

const info = computed(
  () => plugins.value.find((plugin) => plugin.identifier === pluginId.value) ?? null,
);

function findClip(id: string | undefined): Clip | null {
  if (!id) return null;
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return clip;
  }
  return null;
}

function clipLabel(clip: Clip): string {
  if (!clip.assetId) return clip.text?.slice(0, 24) || i18n.t("inspector.textClip");
  const asset = project.doc.assets.find((item) => item.id === clip.assetId);
  return asset?.name ?? i18n.t("inspector.missingAsset");
}

const clip = computed(() =>
  target.value?.clipId ? findClip(target.value.clipId) : null,
);

const effectIndex = computed(() => {
  if (!clip.value || !target.value?.effectId) return -1;
  return (clip.value.effects ?? []).findIndex(
    (effect) => effect.id === target.value!.effectId,
  );
});

const effect = computed<ClipEffect | null>(() => {
  if (effectIndex.value < 0) return null;
  return clip.value?.effects?.[effectIndex.value] ?? null;
});

const targetClips = computed(() => {
  const ids = target.value?.selectedClipIds;
  if (ids && ids.length > 0) {
    return ids
      .map((id) => findClip(id))
      .filter((item): item is Clip => Boolean(item));
  }
  return clip.value ? [clip.value] : [];
});

/** 多选时按 effect.id 匹配；缺失时退回链序号。 */
const targets = computed(() => {
  const out: Array<{ clipId: string; effect: ClipEffect }> = [];
  const index = effectIndex.value;
  const effectId = target.value?.effectId;
  for (const current of targetClips.value) {
    const effects = current.effects ?? [];
    const match =
      effects.find((item) => item.id === effectId) ??
      (index >= 0 ? effects[index] : undefined);
    if (match) out.push({ clipId: current.id, effect: match });
  }
  return out;
});

/** 从插件列表打开时没有实例，用默认值做只读预览。 */
const previewEffect = computed<ClipEffect>(() => ({
  id: "plugin-preview",
  plugin: info.value?.identifier ?? "",
  name: info.value?.label || info.value?.name || "",
  bundle: target.value?.bundle ?? "",
  ...(info.value?.context ? { context: info.value.context } : {}),
  params: info.value ? defaultEffectParams(info.value) : {},
  enabled: true,
}));

const pluginOptions = computed<SelectOption[]>(() =>
  plugins.value.map((plugin) => ({
    id: plugin.identifier,
    label: plugin.label || plugin.name || plugin.identifier,
    hint: plugin.grouping,
  })),
);

const subtitle = computed(() => {
  if (!target.value) return "";
  if (target.value.kind === "effect") {
    const name = effect.value?.name || target.value.name || target.value.plugin;
    return clip.value ? `${name} · ${clipLabel(clip.value)}` : name;
  }
  return info.value?.label || info.value?.name || target.value.name || target.value.plugin;
});

const effectMissing = computed(
  () => target.value?.kind === "effect" && !effect.value,
);

async function loadTarget(): Promise<void> {
  const token = ++loadToken;
  plugins.value = [];
  pluginId.value = "";
  error.value = null;
  if (!target.value) return;
  loading.value = true;
  try {
    const found = await ofx.ensure(target.value.bundle);
    if (token !== loadToken) return;
    plugins.value = found;
    const requested = target.value?.plugin ?? "";
    const preferred = requested
      ? found.find((plugin) => plugin.identifier === requested)
      : found[0];
    if (!preferred) throw new Error(i18n.t("effects.notFound"));
    pluginId.value = preferred.identifier;
  } catch (reason) {
    if (token === loadToken) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

watch(
  () => target.value,
  () => {
    void loadTarget();
  },
  { immediate: true },
);

function clearTarget(): void {
  ofx.closeEditorTarget();
  error.value = null;
  plugins.value = [];
  pluginId.value = "";
}

function openInspector(): void {
  layout.openTab("inspector");
}
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">{{ i18n.t("plugins.editorTitle") }}</h2>
        <p class="pane-sub">
          {{ subtitle || i18n.t("plugins.editorNoSelection") }}
        </p>
      </div>
      <button
        v-if="target"
        class="icon-btn"
        type="button"
        :title="i18n.t('plugins.editorClear')"
        :aria-label="i18n.t('plugins.editorClear')"
        @click="clearTarget"
      >
        <ArrowUturnLeftIcon class="w-[17px] h-[17px]" />
      </button>
    </header>

    <div class="pane-scroll">
      <div v-if="!target" class="empty">
        <AdjustmentsHorizontalIcon class="empty-icon" />
        <p class="empty-title">{{ i18n.t("plugins.editorNoSelection") }}</p>
        <p class="empty-hint">{{ i18n.t("plugins.editorNoSelectionHint") }}</p>
        <button class="primary-btn" type="button" @click="openInspector">
          {{ i18n.t("plugins.editorOpenInspector") }}
        </button>
      </div>

      <div v-else-if="loading" class="empty">
        <AdjustmentsHorizontalIcon class="empty-icon spinning" />
        <p class="empty-title">{{ i18n.t("common.loading") }}</p>
      </div>

      <div v-else-if="error" class="error-box">
        <p class="error-title">{{ i18n.t("plugins.editorProbeFailed") }}</p>
        <p class="error-text">{{ error }}</p>
      </div>

      <template v-else>
        <div v-if="plugins.length > 1" class="plugin-select">
          <span class="select-label">{{ i18n.t("plugins.editorChoosePlugin") }}</span>
          <Md3Select
            v-model="pluginId"
            class="select"
            :options="pluginOptions"
            :label="i18n.t('plugins.editorChoosePlugin')"
          />
        </div>

        <div v-if="target.kind === 'effect' && effectMissing" class="empty">
          <p class="empty-title">{{ i18n.t("plugins.editorTargetMissing") }}</p>
          <button class="primary-btn" type="button" @click="openInspector">
            {{ i18n.t("plugins.editorOpenInspector") }}
          </button>
        </div>

        <template v-else-if="target.kind === 'effect' && info && effect">
          <div class="meta">
            <span class="meta-chip">{{ info.label || info.name }}</span>
            <span class="meta-chip">{{ info.context }}</span>
            <span v-if="targets.length > 1" class="meta-chip mixed">
              {{ i18n.t("effects.mixed") }} {{ targets.length }}
            </span>
          </div>
          <EffectParamEditor
            :info="info"
            :effect="effect"
            :targets="targets"
          />
        </template>

        <template v-else-if="target.kind === 'plugin' && info">
          <div class="meta">
            <span class="meta-chip">{{ info.label || info.name }}</span>
            <span class="meta-chip">{{ info.context }}</span>
            <span class="meta-chip readonly">{{ i18n.t("plugins.editorReadonly") }}</span>
          </div>
          <p class="readonly-hint">{{ i18n.t("plugins.editorReadonlyHint") }}</p>
          <EffectParamEditor
            :info="info"
            :effect="previewEffect"
            :targets="[]"
            readonly
          />
        </template>

        <div v-else class="empty">
          <PuzzlePieceIcon class="empty-icon" />
          <p class="empty-title">{{ i18n.t("effects.notFound") }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 16px;
  text-align: center;
}
.empty-icon {
  width: 28px;
  height: 28px;
  color: rgb(var(--md-on-surface-muted));
}
.empty-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.empty-hint {
  margin: 0;
  max-width: 260px;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-variant));
}
.primary-btn {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:hover {
  filter: brightness(1.08);
}
.plugin-select {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
}
.select-label {
  flex: 1 1 auto;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.select {
  width: 180px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.meta-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  font-size: 10px;
  color: rgb(var(--md-on-surface-variant));
}
.meta-chip.mixed,
.meta-chip.readonly {
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
  font-weight: 600;
}
.readonly-hint {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}
.error-box {
  padding: 12px;
  border-radius: 14px;
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
.error-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
}
.error-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  word-break: break-word;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
