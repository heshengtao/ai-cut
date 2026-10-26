<script setup lang="ts">
/**
 * 下载管理器 → Plugins：插件文件管理。
 *
 * 结构对齐 AI DAW 的 ManagerPane：
 * - 已安装：本管理器装过的（可更新/删除）
 * - 外部：用户自己装在标准 OFX 目录里的（只读）
 * - 可下载：注册表里的插件（搜索、类型、兼容性筛选、安装/更新/打开下载页）
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
} from "@heroicons/vue/24/outline";
import { usePluginsStore } from "@/stores/plugins";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";
import PluginList from "./PluginList.vue";
import type { PluginStatus } from "@/types/plugins";

type Tab = "installed" | "external" | "available";
type TypeFilter =
  | "all"
  | "filter"
  | "general"
  | "generator"
  | "transition"
  | "paint"
  | "retimer";

const plugins = usePluginsStore();
const i18n = useI18n();
const tab = ref<Tab>("installed");
const installedQuery = ref("");
const availableQuery = ref("");
const installedType = ref<TypeFilter>("all");
const availableType = ref<TypeFilter>("all");
const compatibleOnly = ref(true);

const TYPE_FILTERS: TypeFilter[] = [
  "all",
  "filter",
  "general",
  "generator",
  "transition",
  "paint",
  "retimer",
];

function typeLabel(type: string): string {
  const key = `plugins.type.${type}`;
  const label = i18n.t(key);
  return label === key ? type : label;
}

function matchesType(plugin: PluginStatus, type: TypeFilter): boolean {
  return type === "all" || plugin.plugin_types.includes(type);
}

const installedRows = computed(() =>
  plugins.managedInstalled.filter(
    (plugin) =>
      plugins.matches(plugin, installedQuery.value) &&
      matchesType(plugin, installedType.value),
  ),
);

const externalRows = computed(() => plugins.externalPlugins);

const availableRows = computed(() =>
  plugins.availablePlugins.filter((plugin) => {
    if (compatibleOnly.value && !plugin.compatible) return false;
    return (
      plugins.matches(plugin, availableQuery.value) &&
      matchesType(plugin, availableType.value)
    );
  }),
);

const availableTotal = computed(() => plugins.availablePlugins.length);

/** 导入菜单：一个入口按内容类型分流（文件 / 归档 vs .ofx.bundle 目录）。 */
const importOpen = ref(false);
const importEl = ref<HTMLElement | null>(null);

function toggleImport(): void {
  if (plugins.importing) return;
  importOpen.value = !importOpen.value;
}

function closeImport(): void {
  importOpen.value = false;
}

async function runImport(mode: "file" | "bundle"): Promise<void> {
  closeImport();
  const ok =
    mode === "file" ? await plugins.importFile() : await plugins.importBundle();
  if (ok) toast(i18n.t("plugins.manager.imported"));
}

function onDocPointer(event: PointerEvent): void {
  if (!importOpen.value) return;
  const target = event.target as Node;
  if (importEl.value?.contains(target)) return;
  closeImport();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && importOpen.value) {
    event.stopPropagation();
    closeImport();
  }
}

onMounted(() => {
  plugins.watchProgress();
  if (!plugins.loaded) void plugins.load();
  void plugins.loadInstalled();
  window.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="pane">
    <div class="head">
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ on: tab === 'installed' }"
          role="tab"
          :aria-selected="tab === 'installed'"
          @click="tab = 'installed'"
        >
          {{ i18n.t("plugins.manager.tabInstalled") }}
          <span v-if="plugins.managedInstalled.length" class="count">
            {{ plugins.managedInstalled.length }}
          </span>
        </button>
        <button
          class="tab"
          :class="{ on: tab === 'external' }"
          role="tab"
          :aria-selected="tab === 'external'"
          @click="tab = 'external'"
        >
          {{ i18n.t("plugins.manager.tabExternal") }}
          <span v-if="plugins.externalPlugins.length" class="count">
            {{ plugins.externalPlugins.length }}
          </span>
        </button>
        <button
          class="tab"
          :class="{ on: tab === 'available' }"
          role="tab"
          :aria-selected="tab === 'available'"
          @click="tab = 'available'"
        >
          {{ i18n.t("plugins.manager.tabAvailable") }}
        </button>
      </div>
      <div class="head-actions">
        <button
          class="icon-btn"
          :title="i18n.t('plugins.refresh')"
          :aria-label="i18n.t('plugins.refresh')"
          :disabled="plugins.loading"
          @click="plugins.refresh()"
        >
          <ArrowPathIcon class="icon" :class="{ spinning: plugins.loading }" />
        </button>

        <div ref="importEl" class="import-wrap">
          <button
            class="import-btn"
            type="button"
            :disabled="plugins.importing"
            :aria-expanded="importOpen"
            aria-haspopup="menu"
            @click="toggleImport"
          >
            <ArrowUpTrayIcon class="import-icon" />
            {{ i18n.t("plugins.manager.import") }}
            <ChevronDownIcon class="import-caret" :class="{ up: importOpen }" />
          </button>

          <div v-if="importOpen" class="import-menu" role="menu">
            <button class="import-item" type="button" role="menuitem" @click="runImport('file')">
              <DocumentArrowUpIcon class="import-item-icon" />
              <span class="import-item-text">
                <span class="import-item-title">{{ i18n.t("plugins.manager.importFile") }}</span>
                <span class="import-item-hint">
                  {{ i18n.t("plugins.manager.importFileHint") }}
                </span>
              </span>
            </button>
            <button class="import-item" type="button" role="menuitem" @click="runImport('bundle')">
              <FolderOpenIcon class="import-item-icon" />
              <span class="import-item-text">
                <span class="import-item-title">
                  {{ i18n.t("plugins.manager.importBundle") }}
                </span>
                <span class="import-item-hint">
                  {{ i18n.t("plugins.manager.importBundleHint") }}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="plugins.error" class="banner">
      <ExclamationTriangleIcon class="banner-icon" />
      <span class="banner-text">{{ plugins.error }}</span>
      <button class="banner-close" @click="plugins.error = null">×</button>
    </div>

    <!-- 已安装 -->
    <template v-if="tab === 'installed'">
      <div class="filters">
        <input
          v-model="installedQuery"
          class="search"
          type="search"
          :placeholder="i18n.t('plugins.manager.searchInstalled')"
          :aria-label="i18n.t('plugins.manager.searchInstalled')"
        />
        <div class="chips" role="group" :aria-label="i18n.t('plugins.manager.typeFilter')">
          <button
            v-for="type in TYPE_FILTERS"
            :key="type"
            class="chip"
            :class="{ on: installedType === type }"
            :aria-pressed="installedType === type"
            @click="installedType = type"
          >
            {{ type === "all" ? i18n.t("plugins.filter.all") : typeLabel(type) }}
          </button>
        </div>
      </div>

      <PluginList v-if="installedRows.length > 0" :plugins="installedRows" mode="manage" compact />
      <div v-else class="empty">
        <PuzzlePieceIcon class="empty-icon" />
        <p class="empty-text">{{ i18n.t("plugins.manager.emptyInstalled") }}</p>
      </div>
    </template>

    <!-- 外部 -->
    <template v-else-if="tab === 'external'">
      <p class="hint">{{ i18n.t("plugins.manager.externalHint") }}</p>
      <PluginList
        v-if="externalRows.length > 0"
        :plugins="externalRows"
        mode="manage"
        compact
      />
      <div v-else class="empty">
        <PuzzlePieceIcon class="empty-icon" />
        <p class="empty-text">{{ i18n.t("plugins.manager.emptyExternal") }}</p>
        <p class="empty-hint">{{ i18n.t("plugins.manager.emptyExternalHint") }}</p>
      </div>
    </template>

    <!-- 可下载 -->
    <template v-else>
      <div class="filters">
        <input
          v-model="availableQuery"
          class="search"
          type="search"
          :placeholder="i18n.t('plugins.manager.searchAvailable')"
          :aria-label="i18n.t('plugins.manager.searchAvailable')"
        />
        <div class="chips" role="group" :aria-label="i18n.t('plugins.manager.typeFilter')">
          <button
            v-for="type in TYPE_FILTERS"
            :key="type"
            class="chip"
            :class="{ on: availableType === type }"
            :aria-pressed="availableType === type"
            @click="availableType = type"
          >
            {{ type === "all" ? i18n.t("plugins.filter.all") : typeLabel(type) }}
          </button>
          <button
            class="chip"
            :class="{ on: compatibleOnly }"
            :aria-pressed="compatibleOnly"
            @click="compatibleOnly = !compatibleOnly"
          >
            {{ i18n.t("plugins.manager.compatibleOnly") }}
          </button>
        </div>
        <span class="meta">
          {{
            i18n.t("plugins.manager.count", {
              shown: availableRows.length,
              total: availableTotal,
            })
          }}
        </span>
      </div>

      <PluginList
        v-if="availableRows.length > 0"
        :plugins="availableRows"
        mode="manage"
        compact
      />
      <div v-else class="empty">
        <ArrowDownTrayIcon class="empty-icon" />
        <p class="empty-text">{{ i18n.t("plugins.manager.emptyAvailable") }}</p>
        <p class="empty-hint">{{ i18n.t("plugins.manager.emptyAvailableHint") }}</p>
      </div>
    </template>
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 0;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.import-wrap {
  position: relative;
}
.import-btn {
  height: 30px;
  padding: 0 12px 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.14s ease;
}
.import-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.import-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.import-icon {
  width: 14px;
  height: 14px;
}
.import-caret {
  width: 12px;
  height: 12px;
  transition: transform 0.16s ease;
}
.import-caret.up {
  transform: rotate(180deg);
}
.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 236px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-2);
}
.import-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
}
.import-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.import-item-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: rgb(var(--md-primary));
}
.import-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.import-item-title {
  font-size: 11.5px;
  font-weight: 500;
}
.import-item-hint {
  font-size: 10.5px;
  line-height: 1.35;
  color: rgb(var(--md-on-surface-muted));
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}
.tab {
  height: 28px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  cursor: pointer;
}
.tab:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.tab.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.count {
  padding: 0 5px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
  font-size: 10px;
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
}
.icon-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.icon {
  width: 16px;
  height: 16px;
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
.filters {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 14px 0;
}
.search {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: var(--app-inset);
  color: rgb(var(--md-on-surface));
  font-size: 12px;
}
.search:focus {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  height: 24px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.chip:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.chip.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.meta {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 10px 14px 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 40px 16px;
  color: rgb(var(--md-on-surface-muted));
}
.empty-icon {
  width: 26px;
  height: 26px;
}
.empty-text {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--md-on-surface-variant));
}
.empty-hint {
  margin: 0;
  font-size: 11.5px;
  text-align: center;
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
