<script setup lang="ts">
/**
 * 下载管理器：本地 AI 模型的清单、下载源、下载、删除与定位。
 *
 * 分发规则：只有不超过 10 MB 的模型可以随包分发；更大的模型必须由用户按需下载。
 * 下载进度走 `model-progress` 事件，同一时刻只允许一个下载任务。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useModelsStore } from "@/stores/models";
import { useLayoutStore } from "@/stores/layout";
import { useI18n } from "@/i18n";
import { humanSize, missingBytes } from "@/utils/size";
import { regionsLabel, sourceKindLabel } from "@/utils/modelSource";
import type { ModelSourceStatus } from "@/types/models";

type Filter = "all" | "installed" | "available";

const models = useModelsStore();
const layout = useLayoutStore();
const i18n = useI18n();
const filter = ref<Filter>("all");
const confirming = ref<string | null>(null);

const installedCount = computed(
  () => models.catalog.filter((model) => model.installed).length,
);

const visible = computed(() =>
  models.catalog.filter((model) => {
    if (filter.value === "installed") return model.installed;
    if (filter.value === "available") return !model.installed;
    return true;
  }),
);

function featureLabel(feature: string): string {
  const key = `models.feature.${feature}`;
  const label = i18n.t(key);
  return label === key ? feature : label;
}

function summary(model: { total_files: number; installed_files: number; files: { filename: string }[] }): string {
  if (model.total_files <= 1) return model.files[0]?.filename ?? "";
  return i18n.t("models.fileProgress", {
    done: model.installed_files,
    total: model.total_files,
  });
}

async function download(id: string): Promise<void> {
  try {
    await models.download(id);
  } catch {
    // 错误已写进 store.error，界面统一展示。
  }
}

async function remove(id: string): Promise<void> {
  confirming.value = null;
  await models.remove(id);
}

function currentSource(): string {
  return sourceKindLabel(
    i18n.t,
    models.progress?.source_kind ?? null,
    models.progress?.source ?? null,
  );
}

function sourceLabels(sources: ModelSourceStatus[]): string {
  const kinds = new Set(sources.map((source) => source.kind));
  const labels: string[] = [];
  if (kinds.has("modelscope")) labels.push(i18n.t("models.source.modelscope"));
  if (kinds.has("hf")) labels.push(i18n.t("models.source.huggingface"));
  if (kinds.has("github")) labels.push(i18n.t("models.source.github"));
  return labels.join(" + ");
}

onMounted(() => {
  models.watchProgress();
  if (models.catalog.length === 0) void models.load();
});
</script>

<template>
  <div class="pane">
    <header class="head">
      <div class="head-main">
        <h2 class="title">{{ i18n.t("models.title") }}</h2>
        <p class="sub">
          {{
            i18n.t("models.sub", {
              installed: installedCount,
              total: models.catalog.length,
            })
          }}
        </p>
      </div>
      <button
        class="icon-btn"
        :title="i18n.t('models.refresh')"
        :aria-label="i18n.t('models.refresh')"
        :disabled="models.loading"
        @click="models.load()"
      >
        <ArrowPathIcon class="w-[16px] h-[16px]" :class="{ spinning: models.loading }" />
      </button>
    </header>

    <div class="policy-row">
      <p class="policy">{{ i18n.t("models.bundlePolicy") }}</p>
      <button class="mini-btn" @click="layout.openSettings('network')">
        {{ i18n.t("models.sourceSettings") }}
      </button>
    </div>

    <div v-if="models.error" class="banner">
      <ExclamationTriangleIcon class="banner-icon" />
      <span class="banner-text">{{ models.error }}</span>
      <button class="banner-close" @click="models.error = null">×</button>
    </div>

    <div class="chips" role="group" :aria-label="i18n.t('models.filter')">
      <button
        v-for="item in (['all', 'installed', 'available'] as const)"
        :key="item"
        class="chip"
        :class="{ on: filter === item }"
        :aria-pressed="filter === item"
        @click="filter = item"
      >
        {{ i18n.t(`models.filter.${item}`) }}
      </button>
    </div>

    <ul v-if="visible.length > 0" class="list">
      <li
        v-for="model in visible"
        :key="model.id"
        class="card"
        :class="{ busy: models.installing(model.id) }"
      >
        <div class="card-top">
          <span class="card-name">{{ model.name }}</span>
          <span class="badge">{{ featureLabel(model.feature) }}</span>
          <span v-if="model.recommended" class="badge on">
            {{ i18n.t("models.recommended") }}
          </span>
          <span v-if="model.bundled" class="badge on">{{ i18n.t("models.bundled") }}</span>
          <span v-else-if="model.bundle_eligible" class="badge">
            {{ i18n.t("models.bundleEligible") }}
          </span>
          <span v-if="model.installed" class="badge ok">
            {{ i18n.t("models.installed") }}
          </span>
          <span
            class="badge"
            :class="{
              source: model.regions.length > 1,
              warn: !model.regions.includes('cn'),
            }"
          >
            {{ regionsLabel(i18n.t, model.regions) }}
          </span>
        </div>

        <p class="card-meta">
          {{ humanSize(model.approx_bytes) }} · {{ i18n.t("models.license") }}
          {{ model.license }}
        </p>
        <p class="card-files" :title="model.files.map((file) => file.filename).join('\n')">
          {{ summary(model) }}
        </p>
        <p
          class="card-source-line"
          :title="model.sources.map((source) => source.url).join('\n')"
        >
          {{ i18n.t("models.sourceLine") }}：{{ sourceLabels(model.sources) }}
        </p>
        <p v-if="models.probes[model.id]" class="card-probe">
          <span
            v-for="probe in models.probes[model.id]"
            :key="probe.url"
            class="probe-chip"
            :class="{ ok: probe.ok, fail: !probe.ok }"
            :title="probe.error ?? probe.url"
          >
            {{ sourceKindLabel(i18n.t, probe.kind, probe.url) }}
            · {{ probe.ok ? `${probe.ms}ms` : i18n.t("models.probeFailed") }}
          </span>
        </p>

        <div class="card-actions">
          <button
            class="mini-btn"
            :disabled="models.probingId !== null || models.installing(model.id)"
            @click="models.probe(model.id)"
          >
            {{
              models.probingId === model.id
                ? i18n.t("models.probing")
                : i18n.t("models.testSource")
            }}
          </button>
          <!-- 下载中：取消 -->
          <button
            v-if="models.installing(model.id)"
            class="mini-btn danger"
            @click="models.cancel()"
          >
            {{ i18n.t("models.cancel") }}
          </button>

          <!-- 未安装：下载 -->
          <button
            v-else-if="!model.installed"
            class="mini-btn primary"
            :disabled="models.busyId !== null"
            @click="download(model.id)"
          >
            <ArrowDownTrayIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("models.download", { size: humanSize(missingBytes(model)) }) }}
          </button>

          <!-- 已安装：定位 + 删除（随包模型不可删） -->
          <template v-else>
            <button
              class="mini-btn"
              :disabled="models.busyId !== null"
              @click="models.reveal(model.id)"
            >
              <FolderOpenIcon class="w-[13px] h-[13px]" />
              {{ i18n.t("models.reveal") }}
            </button>
            <template v-if="!model.bundled">
              <button
                v-if="confirming !== model.id"
                class="mini-btn danger"
                :disabled="models.busyId !== null"
                @click="confirming = model.id"
              >
                <TrashIcon class="w-[13px] h-[13px]" />
                {{ i18n.t("models.remove") }}
              </button>
              <template v-else>
                <button class="mini-btn danger" @click="remove(model.id)">
                  {{ i18n.t("models.confirmRemove") }}
                </button>
                <button class="mini-btn" @click="confirming = null">
                  {{ i18n.t("common.cancel") }}
                </button>
              </template>
            </template>
          </template>
        </div>

        <p v-if="models.installing(model.id)" class="card-source">
          {{ i18n.t("models.downloadingFrom", { source: currentSource() }) }}
        </p>

        <div v-if="models.installing(model.id)" class="progress">
          <div
            class="progress-fill"
            :class="{ indeterminate: models.progressPct === null }"
            :style="models.progressPct === null ? undefined : { width: `${models.progressPct}%` }"
          />
        </div>
      </li>
    </ul>

    <div v-else class="empty">
      <ArrowDownTrayIcon class="empty-icon" />
      <p class="empty-text">
        {{ models.loading ? i18n.t("common.loading") : i18n.t("models.empty") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 12px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 0;
}
.head-main {
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.sub {
  margin: 3px 0 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.policy-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 14px 0;
}
.policy {
  flex: 1 1 auto;
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
}
.icon-btn {
  width: 30px;
  height: 30px;
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
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.spinning {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 8px 10px;
  border-radius: 10px;
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.banner-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.banner-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.banner-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 14px 4px;
}
.chip {
  height: 26px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.chip.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.list {
  list-style: none;
  margin: 0;
  padding: 8px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border-radius: 14px;
  background-color: var(--app-inset);
}
.card-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.card-name {
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.badge {
  padding: 1px 7px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.badge.on {
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.badge.ok {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.badge.source {
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.badge.warn {
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.card-source {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.card-source-line {
  margin: 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-probe {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 1px 0 0;
}
.probe-chip {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
}
.probe-chip.ok {
  background-color: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
}
.probe-chip.fail {
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.card-meta,
.card-files {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.card-files {
  color: rgb(var(--md-on-surface-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}
.mini-btn {
  height: 27px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.mini-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.mini-btn.primary {
  border-color: transparent;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.mini-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.mini-btn.danger {
  border-color: transparent;
  background-color: rgb(var(--md-error) / 0.14);
  color: rgb(var(--md-error));
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background-color: rgb(var(--md-primary) / 0.15);
}
.progress-fill {
  height: 100%;
  width: 0;
  background-color: rgb(var(--md-primary));
  transition: width 120ms linear;
}
.progress-fill.indeterminate {
  width: 35%;
  animation: indeterminate 1.1s ease-in-out infinite;
}
@keyframes indeterminate {
  0% {
    margin-left: -35%;
  }
  100% {
    margin-left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning,
  .progress-fill.indeterminate {
    animation: none;
  }
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 16px;
  color: rgb(var(--md-on-surface-muted));
}
.empty-icon {
  width: 26px;
  height: 26px;
}
.empty-text {
  margin: 0;
  font-size: 12px;
}
</style>
