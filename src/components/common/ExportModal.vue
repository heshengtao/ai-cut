<script setup lang="ts">
/** 导出模态框：格式预设 + 输出设置 + 进度 / 取消。 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowUpTrayIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useExportStore } from "@/stores/export";
import { useProjectStore } from "@/stores/project";
import { projectDuration } from "@/core/playback/activeClips";
import { formatTimecode } from "@/core/time";
import { EXPORT_ANCHORS, EXPORT_FORMATS, GIF_DITHERS } from "@/types/export";
import type {
  ExportAnchor,
  ExportFit,
  ExportFormat,
  ExportQuality,
  ExportResolution,
  GifDither,
} from "@/types/export";
import { useI18n } from "@/i18n";

const store = useExportStore();
const project = useProjectStore();
const i18n = useI18n();

const dialogEl = ref<HTMLElement | null>(null);

const formatIds = Object.keys(EXPORT_FORMATS) as ExportFormat[];

const resolutions: { id: ExportResolution; labelKey: string }[] = [
  { id: "project", labelKey: "export.resolution.project" },
  { id: "1080p", labelKey: "export.resolution.1080p" },
  { id: "720p", labelKey: "export.resolution.720p" },
  { id: "custom", labelKey: "export.resolution.custom" },
];

const fits: { id: ExportFit; labelKey: string }[] = [
  { id: "contain", labelKey: "export.fit.contain" },
  { id: "cover", labelKey: "export.fit.cover" },
];

const anchors: { id: ExportAnchor; labelKey: string }[] = EXPORT_ANCHORS.map((id) => ({
  id,
  labelKey: `export.anchor.${id}`,
}));

const fpsOptions: { value: number | null; label: string }[] = [
  { value: null, label: "" },
  { value: 24, label: "24" },
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];

const gifFpsOptions: { value: number | null; label: string }[] = [
  { value: null, label: "" },
  { value: 10, label: "10" },
  { value: 12, label: "12" },
  { value: 24, label: "24" },
  { value: 30, label: "30" },
];

const gifColorOptions = [64, 128, 256];

const ditherLabelKeys: Record<GifDither, string> = {
  sierra2_4a: "export.gifDither.sierra2_4a",
  bayer: "export.gifDither.bayer",
  floyd_steinberg: "export.gifDither.floyd_steinberg",
  none: "export.gifDither.none",
};

const gifDithers = GIF_DITHERS.map((id) => ({ id, labelKey: ditherLabelKeys[id] }));

const gifLoopOptions = [
  { value: 0, label: "∞" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 3, label: "3×" },
];

const qualities: { id: ExportQuality; labelKey: string }[] = [
  { id: "high", labelKey: "export.quality.high" },
  { id: "standard", labelKey: "export.quality.standard" },
  { id: "small", labelKey: "export.quality.small" },
];

const total = computed(() => projectDuration(project.doc));
const exporting = computed(() => store.status === "exporting");
const percent = computed(() => Math.round(store.progress * 100));
const spec = computed(() => store.outputSpec);
const isGif = computed(() => store.options.format === "gif");
const activeFpsOptions = computed(() => (isGif.value ? gifFpsOptions : fpsOptions));
const fitLabel = computed(() => i18n.t(`export.fit.${store.options.fit}`));

function formatMeta(id: ExportFormat): string {
  const meta = EXPORT_FORMATS[id];
  return `${i18n.t(meta.audioKey)} · .${meta.extension}`;
}

function fpsLabel(value: number | null): string {
  if (value !== null) return String(value);
  return isGif.value ? "15" : i18n.t("export.fps.project");
}

function chooseFormat(id: ExportFormat): void {
  store.options.format = id;
  if (id === "gif" && (store.options.fps ?? 0) > 30) {
    store.options.fps = null;
  }
}

function chooseResolution(id: ExportResolution): void {
  store.options.resolution = id;
  if (id !== "custom") return;
  if (store.options.width == null) store.options.width = project.doc.width;
  if (store.options.height == null) store.options.height = project.doc.height;
}

function setDimension(axis: "width" | "height", event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  store.options[axis] = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function close(): void {
  store.closeDialog();
}

function onKeyDown(event: KeyboardEvent): void {
  if (!store.dialogOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

watch(
  () => store.dialogOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    dialogEl.value?.focus();
  },
);

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="store.dialogOpen" class="scrim" @pointerdown.self="close">
        <div
          ref="dialogEl"
          class="dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="i18n.t('export.title')"
          tabindex="-1"
        >
          <header class="head">
            <div class="head-text">
              <h2 class="title">{{ i18n.t("export.title") }}</h2>
              <p class="sub">
                {{ formatTimecode(total, project.doc.fps) }} · {{ spec.width }} × {{ spec.height }} ·
                {{ spec.fps }} fps
              </p>
            </div>
            <button
              class="icon-btn"
              :disabled="exporting"
              :aria-label="i18n.t('common.close')"
              @click="close"
            >
              <XMarkIcon class="w-[18px] h-[18px]" />
            </button>
          </header>

          <div class="body">
            <div class="field">
              <span class="field-label">{{ i18n.t("export.format") }}</span>
              <div class="presets">
                <button
                  v-for="id in formatIds"
                  :key="id"
                  class="preset"
                  :class="{ on: store.options.format === id }"
                  :aria-pressed="store.options.format === id"
                  :disabled="exporting"
                  @click="chooseFormat(id)"
                >
                  <span class="preset-radio">
                    <CheckIcon v-if="store.options.format === id" class="w-3 h-3" />
                  </span>
                  <span class="preset-text">
                    <span class="preset-name">{{ i18n.t(EXPORT_FORMATS[id].labelKey) }}</span>
                    <span class="preset-hint">{{ i18n.t(EXPORT_FORMATS[id].hintKey) }}</span>
                    <span class="preset-meta tabular">{{ formatMeta(id) }}</span>
                  </span>
                </button>
              </div>
            </div>

            <div class="field">
              <span class="field-label">{{ i18n.t("export.outputSpec") }}</span>
              <div class="group">
                <div class="prop-row">
                  <span>{{ i18n.t("export.resolution") }}</span>
                  <span class="chips">
                    <button
                      v-for="r in resolutions"
                      :key="r.id"
                      class="chip"
                      :class="{ on: store.options.resolution === r.id }"
                      :disabled="exporting"
                      @click="chooseResolution(r.id)"
                    >
                      {{ i18n.t(r.labelKey) }}
                    </button>
                  </span>
                </div>

                <div v-if="store.options.resolution === 'custom'" class="prop-row">
                  <span>{{ i18n.t("export.size") }}</span>
                  <span class="size-inputs">
                    <input
                      class="size-input tabular"
                      type="number"
                      min="16"
                      max="8192"
                      step="2"
                      :value="store.options.width ?? project.doc.width"
                      :disabled="exporting"
                      @input="setDimension('width', $event)"
                    />
                    <span class="size-times">×</span>
                    <input
                      class="size-input tabular"
                      type="number"
                      min="16"
                      max="8192"
                      step="2"
                      :value="store.options.height ?? project.doc.height"
                      :disabled="exporting"
                      @input="setDimension('height', $event)"
                    />
                  </span>
                </div>

                <div class="prop-row">
                  <span>{{ i18n.t("export.fps") }}</span>
                  <span class="chips">
                    <button
                      v-for="f in activeFpsOptions"
                      :key="String(f.value)"
                      class="chip"
                      :class="{ on: store.options.fps === f.value }"
                      :disabled="exporting"
                      @click="store.options.fps = f.value"
                    >
                      {{ f.label || fpsLabel(f.value) }}
                    </button>
                  </span>
                </div>

                <div class="prop-row">
                  <span>{{ i18n.t("export.fit") }}</span>
                  <span class="chips">
                    <button
                      v-for="f in fits"
                      :key="f.id"
                      class="chip"
                      :class="{ on: store.options.fit === f.id }"
                      :disabled="exporting"
                      @click="store.options.fit = f.id"
                    >
                      {{ i18n.t(f.labelKey) }}
                    </button>
                  </span>
                </div>

                <div v-if="store.options.fit === 'cover'" class="prop-row">
                  <span>{{ i18n.t("export.anchor") }}</span>
                  <span class="anchor-grid" role="group" :aria-label="i18n.t('export.anchor')">
                    <button
                      v-for="anchor in anchors"
                      :key="anchor.id"
                      class="anchor-btn"
                      :class="{ on: store.options.fitAnchor === anchor.id }"
                      :disabled="exporting"
                      :title="i18n.t(anchor.labelKey)"
                      :aria-label="i18n.t(anchor.labelKey)"
                      :aria-pressed="store.options.fitAnchor === anchor.id"
                      @click="store.options.fitAnchor = anchor.id"
                    >
                      <span class="anchor-dot" />
                    </button>
                  </span>
                </div>

                <div v-if="store.options.format === 'mp4'" class="prop-row">
                  <span>{{ i18n.t("export.quality") }}</span>
                  <span class="chips">
                    <button
                      v-for="q in qualities"
                      :key="q.id"
                      class="chip"
                      :class="{ on: store.options.quality === q.id }"
                      :disabled="exporting"
                      @click="store.options.quality = q.id"
                    >
                      {{ i18n.t(q.labelKey) }}
                    </button>
                  </span>
                </div>

                <template v-if="isGif">
                  <div class="prop-row">
                    <span>{{ i18n.t("export.gifColors") }}</span>
                    <span class="chips">
                      <button
                        v-for="colors in gifColorOptions"
                        :key="colors"
                        class="chip"
                        :class="{ on: store.options.gifColors === colors }"
                        :disabled="exporting"
                        @click="store.options.gifColors = colors"
                      >
                        {{ colors }}
                      </button>
                    </span>
                  </div>

                  <div class="prop-row">
                    <span>{{ i18n.t("export.gifDither") }}</span>
                    <span class="chips">
                      <button
                        v-for="d in gifDithers"
                        :key="d.id"
                        class="chip"
                        :class="{ on: store.options.gifDither === d.id }"
                        :disabled="exporting"
                        @click="store.options.gifDither = d.id"
                      >
                        {{ i18n.t(d.labelKey) }}
                      </button>
                    </span>
                  </div>

                  <div class="prop-row">
                    <span>{{ i18n.t("export.gifLoop") }}</span>
                    <span class="chips">
                      <button
                        v-for="loop in gifLoopOptions"
                        :key="loop.value"
                        class="chip"
                        :class="{ on: store.options.gifLoop === loop.value }"
                        :disabled="exporting"
                        @click="store.options.gifLoop = loop.value"
                      >
                        {{ loop.label }}
                      </button>
                    </span>
                  </div>
                </template>

                <div class="prop-row">
                  <span>{{ i18n.t("export.audio") }}</span>
                  <span class="prop-value">
                    {{ i18n.t(EXPORT_FORMATS[store.options.format].audioKey) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="estimate">
              <span>{{ i18n.t("export.outputSpec") }}</span>
              <span class="estimate-value tabular">
                {{ spec.width }} × {{ spec.height }} · {{ spec.fps }} fps · {{ fitLabel }}
              </span>
            </div>

            <p v-if="store.warnings.length > 0" class="warning-row">
              <ExclamationTriangleIcon class="w-4 h-4" />
              <span>{{ store.warnings.join(i18n.t("common.listSeparator")) }}</span>
            </p>

            <p v-if="store.status === 'error' && store.errorMessage" class="error-row">
              <ExclamationTriangleIcon class="w-4 h-4" />
              <span>{{ store.errorMessage }}</span>
            </p>
          </div>

          <footer class="foot">
            <template v-if="exporting">
              <div
                class="progress"
                role="progressbar"
                :aria-valuenow="percent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span class="progress-bar" :style="{ width: `${percent}%` }" />
              </div>
              <div class="progress-meta">
                <span class="tabular">{{ percent }}%</span>
                <span class="tabular">
                  {{ formatTimecode(store.seconds, spec.fps) }} /
                  {{ formatTimecode(store.duration, spec.fps) }}
                </span>
              </div>
              <button class="btn-text cancel" @click="store.cancel()">
                {{ i18n.t("export.cancel") }}
              </button>
            </template>

            <template v-else>
              <button class="btn-filled export-btn" @click="store.start()">
                <ArrowUpTrayIcon class="w-[17px] h-[17px]" />
                {{ i18n.t("export.exportVideo") }}
              </button>
              <p v-if="store.status === 'done' && store.outputPath" class="foot-hint">
                {{ i18n.t("export.done", { path: store.outputPath }) }}
              </p>
              <p v-else class="foot-hint">{{ i18n.t("export.hint") }}</p>
            </template>
          </footer>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(var(--md-scrim) / 0.42);
}
.dialog {
  width: 480px;
  max-width: 100%;
  max-height: min(680px, 88vh);
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
  overflow: hidden;
  outline: none;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 16px 8px 22px;
}
.head-text {
  flex: 1 1 auto;
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.icon-btn {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.icon-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 22px 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 11px;
  letter-spacing: 0.4px;
  color: rgb(var(--md-on-surface-variant));
}
.presets {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.preset {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.preset:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / 0.04);
}
.preset.on {
  border-color: rgb(var(--md-primary) / 0.65);
  background-color: rgb(var(--md-primary) / 0.08);
}
.preset:disabled {
  opacity: 0.65;
  cursor: default;
}
.preset-radio {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1.5px solid rgb(var(--md-outline));
  color: rgb(var(--md-on-primary));
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.preset.on .preset-radio {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary));
}
.preset-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.preset-name {
  font-size: 12.5px;
  font-weight: 600;
}
.preset-hint {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.preset-meta {
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}
.group {
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  padding: 2px 12px;
}
.prop-row {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.prop-row:last-child {
  border-bottom: 0;
}
.prop-value {
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  font-weight: 500;
}
.size-inputs {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.size-input {
  width: 64px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 11px;
  text-align: center;
}
.size-input:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.size-input:disabled {
  opacity: 0.5;
}
.size-times {
  color: rgb(var(--md-on-surface-muted));
  font-size: 11px;
}
.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  gap: 4px;
}
.anchor-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.anchor-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.anchor-btn.on {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.12);
}
.anchor-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.anchor-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.anchor-dot {
  width: 5px;
  height: 5px;
  border-radius: 1px;
  background-color: rgb(var(--md-on-surface-muted));
}
.anchor-btn.on .anchor-dot {
  background-color: rgb(var(--md-primary));
}
.chips {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.chip {
  height: 24px;
  padding: 0 9px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.chip.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.estimate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 0;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.estimate-value {
  color: rgb(var(--md-on-surface));
  font-weight: 600;
}
.warning-row,
.error-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  padding: 9px 11px;
  border-radius: 12px;
  font-size: 11px;
  line-height: 1.45;
}
.warning-row {
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
}
.error-row {
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
.warning-row svg,
.error-row svg {
  flex: 0 0 auto;
  margin-top: 1px;
}
.foot {
  flex: 0 0 auto;
  padding: 10px 18px 16px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: transparent;
}
.export-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.foot-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
  overflow-wrap: anywhere;
}
.progress {
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgb(var(--md-primary) / 0.16);
}
.progress-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.18s linear;
}
.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.cancel {
  width: 100%;
  margin-top: 6px;
}
.btn-text {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.btn-text:hover {
  background-color: rgb(var(--md-primary) / 0.08);
}
.btn-filled {
  height: 38px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.14s ease;
}
.btn-filled:hover {
  filter: brightness(1.06);
}
.btn-text:focus-visible,
.btn-filled:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .icon-btn,
  .preset,
  .chip,
  .btn-text,
  .btn-filled,
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
