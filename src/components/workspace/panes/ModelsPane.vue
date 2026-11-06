<script setup lang="ts">
/**
 * 下载管理器：本地 AI 模型的清单、下载源、下载、删除与定位。
 *
 * 分发规则：只有不超过 10 MB 的模型可以随包分发；更大的模型必须由用户按需下载。
 * 下载进度走 `model-progress` 事件，同一时刻只允许一个下载任务。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useSdcppStore } from "@/stores/sdcpp";
import { useDownloadsStore } from "@/stores/downloads";
import { usePluginsStore } from "@/stores/plugins";
import { useLayoutStore } from "@/stores/layout";
import PluginList from "./PluginList.vue";
import PluginImportButton from "./PluginImportButton.vue";
import { useI18n } from "@/i18n";
import { humanSize, missingBytes } from "@/utils/size";
import { appRestart } from "@/core/runtimeApi";
import { toast } from "@/composables/useToast";
import { regionsLabel, sourceKindLabel } from "@/utils/modelSource";
import type { ModelSourceStatus } from "@/types/models";
import type { PluginStatus } from "@/types/plugins";

type Tab = "installed" | "available";
type Kind = "all" | "plugin" | "model" | "runtime";

const models = useModelsStore();
const runtimes = useRuntimesStore();
const sdcpp = useSdcppStore();
const downloads = useDownloadsStore();
const plugins = usePluginsStore();
const layout = useLayoutStore();
const i18n = useI18n();

/**
 * 能出现在列表里的引擎：本机能跑的，或者已经装好的。
 *
 * NVIDIA 机器上不该出现 ROCm（A 卡专用）、AMD 机器上也不该出现 CUDA——装了也只会报
 * 「找不到对应显卡」。但**已安装**的仍要显示，否则换了显卡之后用户连删都找不到它。
 */
const sdcppPacks = computed(() => sdcpp.items.filter((pack) => pack.usable || pack.installed));
const tab = ref<Tab>("installed");
const kind = ref<Kind>("all");
const query = ref("");
const confirming = ref<string | null>(null);
const confirmingRuntime = ref<string | null>(null);
const confirmingSdcpp = ref<string | null>(null);

function matches(text: string): boolean {
  const needle = query.value.trim().toLowerCase();
  return needle === "" || text.toLowerCase().includes(needle);
}

/** 运行时本体（CUDA 12 / CUDA 13 的 ONNX Runtime）；随包基线不在这里出现。 */
const coreRuntimes = computed(() =>
  runtimes.items
    .filter((runtime) => runtime.core && !runtime.bundled)
    // 两个页签都显示：设置页「补齐运行库」会直接跳到这里下载，进度必须看得见。
    .filter((runtime) => matches(i18n.t(runtime.label))),
);

/** CUDA 12 / CUDA 13 的组件：和本体分开、也不算随包基线。 */
const cudaParts = computed(() =>
  runtimes.items.filter((runtime) => runtime.group === "cuda12" || runtime.group === "cuda13"),
);

/**
 * 当前页签下要显示的组件。
 *
 * **两个页签都列全**：以前「已安装」只保留装好的组件，没装过 CUDA 13 的机器上
 * 整块 CUDA 13 卡片直接消失，用户以为「这个版本根本没有组件」。现在缺的也摆出来，
 * 只是按钮变成「下载」。
 */
const visibleParts = computed(() =>
  cudaParts.value.filter((part) => matches(i18n.t(part.label))),
);

/** CUDA 12 / CUDA 13 的组件各一张卡片，别把两套版本挤在一起。 */
const componentGroups = computed(() =>
  [
    { key: "cuda12", titleKey: "runtime.cuda12Parts", hintKey: "runtime.cuda12PartsHint" },
    { key: "cuda13", titleKey: "runtime.cuda13Parts", hintKey: "runtime.cuda13PartsHint" },
  ]
    .map((group) => ({
      ...group,
      items: visibleParts.value.filter((part) => part.group === group.key),
    }))
    .filter((group) => group.items.length > 0),
);

const visible = computed(() =>
  models.catalog
    .filter((model) => (tab.value === "installed" ? model.installed : !model.installed))
    .filter((model) => matches(model.name)),
);

/** 插件：已安装 = 管理器装的 + 外部目录里的；可下载 = 注册表里兼容的。 */
const visiblePlugins = computed<PluginStatus[]>(() => {
  const rows =
    tab.value === "installed"
      ? [...plugins.managedInstalled, ...plugins.externalPlugins]
      : plugins.availablePlugins.filter((plugin) => plugin.compatible);
  return rows.filter((plugin) => plugins.matches(plugin, query.value));
});

const installedTotal = computed(
  () =>
    models.catalog.filter((model) => model.installed).length +
    runtimes.items.filter((runtime) => runtime.installed && !runtime.bundled).length +
    sdcpp.items.filter((pack) => pack.installed).length +
    plugins.managedInstalled.length,
);
const availableTotal = computed(
  () =>
    models.catalog.filter((model) => !model.installed).length +
    runtimes.items.filter((runtime) => !runtime.installed && !runtime.bundled).length +
    sdcppPacks.value.filter((pack) => !pack.installed).length +
    plugins.availablePlugins.filter((plugin) => plugin.compatible).length,
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

/** 运行时（CUDA）下载 / 重新安装 / 删除；随包基线只有「内置」状态，没有按钮。 */
async function installRuntime(id: string, force = false): Promise<void> {
  try {
    await runtimes.install(id, force);
  } catch {
    // 原因已经写进 runtimes.error，界面上的红条会显示。
  }
}

async function removeRuntime(id: string): Promise<void> {
  confirmingRuntime.value = null;
  await runtimes.remove(id);
}

async function installSdcpp(id: string, force = false): Promise<void> {
  try {
    await sdcpp.install(id, force);
  } catch {
    // 同上：sdcpp.error 会显示。
  }
}

async function removeSdcpp(id: string): Promise<void> {
  confirmingSdcpp.value = null;
  await sdcpp.remove(id);
}

/**
 * 装 / 删了运行库（含 CUDA 组件）之后，本进程还没生效。
 *
 * 开发模式下后端拒绝自动重启：提示完就把横幅收掉，别让它一直挂着。
 */
async function restartNow(): Promise<void> {
  try {
    await appRestart();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
    runtimes.consumeRestartPrompt();
  }
}

function currentSource(): string {
  // 下载中如果后端给了提示（例如「复用已有文件」），优先展示它；否则展示当前源。
  if (models.progress?.message) return models.progress.message;
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

// ---- 从别处跳过来时要定位到具体那一项 ----
/** 刚被定位到的条目 id（3 秒后自然消失）。 */
const highlight = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 消费聚焦请求：切到「可下载」→ 切到对应分类 → 滚到那一项 → 高亮 3 秒。
 *
 * 只做高亮是不够的：AI 页面点「下载引擎」时管理器通常还停在「已安装」页签，
 * 用户落地后看到的是「这里没有可下载的内容」，只能得出「点了没反应」的结论。
 */
async function applyFocus(): Promise<void> {
  const target = downloads.consumeFocus();
  if (!target) return;
  tab.value = "available";
  kind.value = target.section === "model" ? "model" : "runtime";
  highlight.value = target.id;
  await nextTick();
  const element = document.querySelector<HTMLElement>(
    `[data-download-id="${target.id}"]`,
  );
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (highlight.value === target.id) highlight.value = null;
    highlightTimer = null;
  }, 3000);
}

onMounted(() => {
  models.watchProgress();
  if (models.catalog.length === 0) void models.load();
  runtimes.watchProgress();
  if (runtimes.items.length === 0) void runtimes.load();
  sdcpp.watchProgress();
  if (sdcpp.items.length === 0) void sdcpp.load();
  plugins.watchProgress();
  if (!plugins.loaded) void plugins.load();
  void plugins.loadInstalled();
  void applyFocus();
});

// 面板已经开着时，聚焦请求通过 watcher 生效。
watch(
  () => downloads.focus,
  (value) => {
    if (value) void applyFocus();
  },
);

onUnmounted(() => {
  if (highlightTimer) clearTimeout(highlightTimer);
});
</script>

<template>
  <div class="pane">
    <!--
      运行库变了（含 CUDA 组件）：新的 dylib / 组件只在下次启动时加载。
      这里用常驻横幅而不是弹框——从设置页「补齐组件」回来时本面板会被卸载，
      弹框会跟着消失，横幅则一直留到用户重启。
    -->
    <div v-if="runtimes.restartPrompt" class="restart-banner">
      <span class="restart-text">{{ i18n.t("runtime.restartBody") }}</span>
      <button class="mini-btn primary" @click="restartNow()">
        {{ i18n.t("runtime.restartNow") }}
      </button>
      <button class="mini-btn" @click="runtimes.consumeRestartPrompt()">
        {{ i18n.t("runtime.restartLater") }}
      </button>
    </div>
    <header class="head">
      <div class="head-main">
        <h2 class="title">{{ i18n.t("models.title") }}</h2>
        <p class="sub">
          {{ i18n.t("models.subCounts", { installed: installedTotal, available: availableTotal }) }}
        </p>
      </div>
      <button
        class="icon-btn"
        :title="i18n.t('models.refresh')"
        :aria-label="i18n.t('models.refresh')"
        :disabled="models.loading"
        @click="models.load(); runtimes.load(); sdcpp.load(); plugins.refresh()"
      >
        <ArrowPathIcon class="w-[16px] h-[16px]" :class="{ spinning: models.loading }" />
      </button>
    </header>

    <!-- 标签 + 显眼的「导入插件」按钮（对齐 AI DAW 的下载管理器）。 -->
    <div class="manager-bar">
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ on: tab === 'installed' }"
          role="tab"
          :aria-selected="tab === 'installed'"
          @click="tab = 'installed'"
        >
          {{ i18n.t("models.tab.installed") }}
          <span v-if="installedTotal" class="tab-count">{{ installedTotal }}</span>
        </button>
        <button
          class="tab"
          :class="{ on: tab === 'available' }"
          role="tab"
          :aria-selected="tab === 'available'"
          @click="tab = 'available'"
        >
          {{ i18n.t("models.tab.available") }}
          <span v-if="availableTotal" class="tab-count">{{ availableTotal }}</span>
        </button>
      </div>
      <PluginImportButton />
    </div>

    <input
      v-model="query"
      class="search"
      type="search"
      :placeholder="i18n.t('models.searchPlaceholder')"
      :aria-label="i18n.t('models.searchPlaceholder')"
    />

    <div class="chips" role="group" :aria-label="i18n.t('models.kindFilter')">
      <button
        v-for="item in (['all', 'plugin', 'model', 'runtime'] as const)"
        :key="item"
        class="chip"
        :class="{ on: kind === item }"
        :aria-pressed="kind === item"
        @click="kind = item"
      >
        {{ i18n.t(`models.kind.${item}`) }}
      </button>
      <button
        class="chip source-chip"
        :title="i18n.t('models.sourceSettingsHint')"
        @click="layout.openSettings('network')"
      >
        <AdjustmentsHorizontalIcon class="w-[13px] h-[13px]" />
        {{ i18n.t("models.sourceSettings") }}
      </button>
    </div>

    <!-- 运行时：本体 + CUDA/cuDNN 组件，都在这里下载。 -->
    <div v-if="kind === 'all' || kind === 'runtime'" class="runtime-section">
      <div class="runtime-head">
        <span class="runtime-title">{{ i18n.t("runtime.title") }}</span>
        <span class="runtime-hint">{{ i18n.t("runtime.hint") }}</span>
      </div>
      <p v-if="runtimes.error" class="runtime-error">{{ runtimes.error }}</p>
      <ul v-if="coreRuntimes.length > 0" class="list">
        <li
          v-for="runtime in coreRuntimes"
          :key="runtime.id"
          class="card"
          :data-download-id="runtime.id"
          :class="{
            busy: runtimes.installing(runtime.id),
            focus: highlight === runtime.id,
          }"
        >
          <div class="card-top">
            <span class="card-name">{{ i18n.t(runtime.label) }}</span>
            <span v-if="runtime.installed" class="badge ok">
              {{ i18n.t("runtime.installed") }}
            </span>
            <span v-else class="badge">{{ i18n.t("runtime.notInstalled") }}</span>
          </div>
          <p class="card-meta">{{ i18n.t(runtime.note) }}</p>
          <p class="card-meta">
            {{ humanSize(runtime.bytes) }} · {{ i18n.t("models.license") }}
            {{ runtime.license }}
          </p>

          <div v-if="!runtime.bundled" class="card-actions">
            <button
              v-if="runtimes.installing(runtime.id)"
              class="mini-btn danger"
              @click="runtimes.cancel()"
            >
              {{ i18n.t("models.cancel") }}
            </button>
            <template v-else-if="runtime.installed">
              <template v-if="tab === 'available'">
                <button
                  class="mini-btn"
                  :disabled="runtimes.busyId !== null"
                  @click="installRuntime(runtime.id, true)"
                >
                  {{ i18n.t("models.reinstall") }}
                </button>
              </template>
              <template v-else>
                <button
                  class="mini-btn"
                  :disabled="runtimes.busyId !== null"
                  @click="runtimes.reveal(runtime.id)"
                >
                  <FolderOpenIcon class="w-[13px] h-[13px]" />
                  {{ i18n.t("models.reveal") }}
                </button>
                <template v-if="confirmingRuntime !== runtime.id">
                  <button
                    class="mini-btn danger"
                    :disabled="runtimes.busyId !== null"
                    @click="confirmingRuntime = runtime.id"
                  >
                    <TrashIcon class="w-[13px] h-[13px]" />
                    {{ i18n.t("models.remove") }}
                  </button>
                </template>
                <template v-else>
                  <button class="mini-btn danger" @click="removeRuntime(runtime.id)">
                    {{ i18n.t("models.confirmRemove") }}
                  </button>
                  <button class="mini-btn" @click="confirmingRuntime = null">
                    {{ i18n.t("common.cancel") }}
                  </button>
                </template>
              </template>
            </template>
            <button
              v-else
              class="mini-btn primary"
              :disabled="runtimes.busyId !== null"
              @click="installRuntime(runtime.id)"
            >
              <ArrowDownTrayIcon class="w-[13px] h-[13px]" />
              {{ i18n.t("models.download", { size: humanSize(runtime.bytes) }) }}
            </button>
          </div>

          <div v-if="runtimes.installing(runtime.id)" class="progress">
            <div
              class="progress-fill"
              :class="{ indeterminate: runtimes.progressPct === null }"
              :style="
                runtimes.progressPct === null
                  ? undefined
                  : { width: `${runtimes.progressPct}%` }
              "
            />
          </div>
        </li>
      </ul>

      <!-- CUDA 12 / CUDA 13 的组件各一张卡片：切哪套就自动装哪套，也可以单独下载。 -->
      <div
        v-for="group in componentGroups"
        :key="group.key"
        class="card cuda-parts-card"
      >
        <div class="parts-head">
          <span class="parts-title">{{ i18n.t(group.titleKey) }}</span>
          <span class="parts-note">{{ i18n.t(group.hintKey) }}</span>
        </div>
        <div
          v-for="part in group.items"
          :key="part.id"
          class="part-row"
          :data-download-id="part.id"
          :class="{ busy: runtimes.installing(part.id), focus: highlight === part.id }"
        >
          <div class="part-main">
            <span class="part-name">{{ i18n.t(part.label) }}</span>
            <span class="part-size">{{ humanSize(part.bytes) }}</span>
            <span v-if="part.installed" class="badge ok">
              {{ i18n.t("runtime.installed") }}
            </span>
          </div>
          <div class="part-actions">
            <button
              v-if="runtimes.installing(part.id)"
              class="mini-btn danger"
              @click="runtimes.cancel()"
            >
              {{ i18n.t("models.cancel") }}
            </button>
            <button
              v-else-if="part.installed && tab === 'available'"
              class="mini-btn"
              :disabled="runtimes.busyId !== null"
              @click="installRuntime(part.id, true)"
            >
              {{ i18n.t("models.reinstall") }}
            </button>
            <button
              v-else-if="part.installed"
              class="mini-btn"
              :disabled="runtimes.busyId !== null"
              @click="runtimes.remove(part.id)"
            >
              {{ i18n.t("models.remove") }}
            </button>
            <button
              v-else
              class="mini-btn primary"
              :disabled="runtimes.busyId !== null"
              @click="installRuntime(part.id)"
            >
              <ArrowDownTrayIcon class="w-[13px] h-[13px]" />
              {{ i18n.t("models.download", { size: humanSize(part.bytes) }) }}
            </button>
          </div>
          <div v-if="runtimes.installing(part.id)" class="progress">
            <div
              class="progress-fill"
              :class="{ indeterminate: runtimes.progressPct === null }"
              :style="
                runtimes.progressPct === null
                  ? undefined
                  : { width: `${runtimes.progressPct}%` }
              "
            />
          </div>
        </div>
      </div>

      <!-- sd.cpp 视频引擎：与 ONNX Runtime 分开的一组 -->
      <div class="runtime-head models-head">
        <span class="runtime-title">{{ i18n.t("sdcpp.group") }}</span>
        <span class="runtime-hint">{{ i18n.t("sdcpp.groupHint") }}</span>
      </div>
      <p class="policy">{{ i18n.t("sdcpp.officialOnly") }}</p>
      <p v-if="sdcpp.error" class="runtime-error">{{ sdcpp.error }}</p>
      <ul v-if="sdcppPacks.length > 0" class="list">
        <li
          v-for="pack in sdcppPacks"
          :key="pack.id"
          class="card"
          :data-download-id="pack.id"
          :class="{
            busy: sdcpp.installing(pack.id),
            focus: highlight === pack.id,
          }"
        >
          <div class="card-top">
            <span class="card-name">{{ i18n.t(pack.label) }}</span>
            <span v-if="pack.installed" class="badge ok">
              {{ i18n.t("runtime.installed") }}
            </span>
            <span v-else class="badge">{{ i18n.t("runtime.notInstalled") }}</span>
            <span v-if="pack.selected" class="badge on">{{ i18n.t("sdcpp.current") }}</span>
          </div>
          <p class="card-meta">{{ i18n.t(pack.note) }}</p>
          <p class="card-meta">
            {{ humanSize(pack.bytes) }} · {{ i18n.t("models.license") }}
            {{ pack.license }}
          </p>
          <div class="card-actions">
            <button
              v-if="sdcpp.installing(pack.id)"
              class="mini-btn danger"
              @click="sdcpp.cancel()"
            >
              {{ i18n.t("models.cancel") }}
            </button>
            <template v-else-if="pack.installed">
              <template v-if="tab === 'available'">
                <button
                  class="mini-btn"
                  :disabled="sdcpp.busyId !== null"
                  @click="installSdcpp(pack.id, true)"
                >
                  {{ i18n.t("models.reinstall") }}
                </button>
              </template>
              <template v-else>
                <button
                  class="mini-btn"
                  :disabled="sdcpp.busyId !== null"
                  @click="sdcpp.reveal(pack.id)"
                >
                  <FolderOpenIcon class="w-[13px] h-[13px]" />
                  {{ i18n.t("models.reveal") }}
                </button>
                <template v-if="confirmingSdcpp !== pack.id">
                  <button
                    class="mini-btn danger"
                    :disabled="sdcpp.busyId !== null"
                    @click="confirmingSdcpp = pack.id"
                  >
                    <TrashIcon class="w-[13px] h-[13px]" />
                    {{ i18n.t("models.remove") }}
                  </button>
                </template>
                <template v-else>
                  <button class="mini-btn danger" @click="removeSdcpp(pack.id)">
                    {{ i18n.t("models.confirmRemove") }}
                  </button>
                  <button class="mini-btn" @click="confirmingSdcpp = null">
                    {{ i18n.t("common.cancel") }}
                  </button>
                </template>
              </template>
            </template>
            <button
              v-else
              class="mini-btn primary"
              :disabled="sdcpp.busyId !== null"
              @click="installSdcpp(pack.id)"
            >
              <ArrowDownTrayIcon class="w-[13px] h-[13px]" />
              {{ i18n.t("models.download", { size: humanSize(pack.bytes) }) }}
            </button>
          </div>
          <div v-if="sdcpp.installing(pack.id)" class="progress">
            <div
              class="progress-fill"
              :class="{ indeterminate: sdcpp.progressPct === null }"
              :style="
                sdcpp.progressPct === null ? undefined : { width: `${sdcpp.progressPct}%` }
              "
            />
          </div>
        </li>
      </ul>

      <div
        v-if="coreRuntimes.length === 0 && visibleParts.length === 0 && sdcppPacks.length === 0"
        class="empty"
      >
        <p class="empty-text">{{ i18n.t("runtime.empty") }}</p>
      </div>
    </div>

    <!-- 模型 -->
    <template v-if="kind === 'all' || kind === 'model'">
    <div class="runtime-head models-head">
      <span class="runtime-title">{{ i18n.t("models.tab.models") }}</span>
    </div>

    <div class="policy-row">
      <p class="policy">{{ i18n.t("models.bundlePolicy") }}</p>
    </div>

    <div v-if="models.error" class="banner">
      <ExclamationTriangleIcon class="banner-icon" />
      <span class="banner-text">{{ models.error }}</span>
      <button class="banner-close" @click="models.error = null">×</button>
    </div>

    <ul v-if="visible.length > 0" class="list">
      <li
        v-for="model in visible"
        :key="model.id"
        class="card"
        :data-download-id="model.id"
        :class="{ busy: models.installing(model.id), focus: highlight === model.id }"
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
        <p v-if="model.reusable_bytes > 0 && !model.installed" class="card-meta">
          {{ i18n.t("models.reusableHint", { size: humanSize(model.reusable_bytes) }) }}
        </p>
        <p
          v-else-if="model.installed && model.shared_bytes > 0"
          class="card-meta"
        >
          {{ i18n.t("models.sharedHint", { size: humanSize(model.shared_bytes) }) }}
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
    </template>

    <!-- 插件 -->
    <div v-if="kind === 'all' || kind === 'plugin'" class="plugin-section">
      <div class="runtime-head models-head">
        <span class="runtime-title">{{ i18n.t("models.tab.plugins") }}</span>
      </div>
      <PluginList :plugins="visiblePlugins" mode="manage" />
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
.manager-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 0;
  flex: 0 0 auto;
}
/* 标签栏右侧：导入插件（窄面板里会换到下一行）。 */
/* 「下载源」：和筛选胶囊同一行的一个动作胶囊（点了跳设置页的「网络」）。 */
.chip.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.tab {
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.tab.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.tab-count {
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
  font-size: 10px;
}
.search {
  flex: 0 0 auto;
  height: 32px;
  min-height: 32px;
  margin: 8px 14px 0;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: var(--app-inset);
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  outline: none;
}
.search:focus {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 0;
}
.cuda-parts-card {
  margin: 8px 14px 0;
}
/* CUDA / cuDNN 组件列表（挂在 CUDA 本体卡片里）。 */
.runtime-parts {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.parts-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-muted));
}
.parts-note {
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--md-on-surface-muted));
}
.part-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background-color: rgb(var(--md-surface-container-high) / 0.5);
}
.part-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.part-name {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.part-size {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.part-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.plugin-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 0;
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
  flex: 0 0 auto;
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
/* 从 AI 页面 / 设置页跳到运行时区时的短暂高亮。 */
.card.focus,
.part-row.focus {
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.65);
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
/* ---- 运行时 / 「重启后生效」横幅 ---- */
.restart-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 12px 0;
  padding: 8px 12px;
  border-radius: 12px;
  background-color: rgb(var(--md-primary) / 0.1);
  color: rgb(var(--md-primary));
}
.restart-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
}
/* 运行时分区：和模型同一个列表样式，单独一段标题。 */
.runtime-section {
  margin-top: 10px;
}
.models-head {
  margin-top: 12px;
  padding-bottom: 0;
}
.runtime-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 14px 6px;
}
.runtime-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-muted));
}
.runtime-hint {
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
}
.runtime-error {
  margin: 0 14px 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
  font-size: 11px;
  overflow-wrap: anywhere;
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
