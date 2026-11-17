<script setup lang="ts">
/**
 * 画布插件面板：**已安装**与**发现**两件事分开做。
 *
 * - 已安装：本地目录导入、启用/禁用、移除、有新版本时一键更新；
 * - 发现：从索引源（默认作者维护的 GitHub 仓库）搜索并安装。
 *
 * 索引的抓取、校验、分页都在 daemon 里；这里只渲染一页结果。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { usePluginHostStore } from "@/stores/pluginHost";
import { importPluginModule } from "@/core/plugins/importer";
import { useI18n } from "@/i18n";
import type { MarketSearchHit } from "@/types/pluginMarket";

const host = usePluginHostStore();
const i18n = useI18n();
const tab = ref<"installed" | "discover">("installed");
const query = ref("");
const busy = ref<string | null>(null);
const notice = ref<string | null>(null);
const sourceDraft = ref("");

const entries = computed(() => host.plugins);
const updateFor = computed(() => {
  const map = new Map<string, string>();
  for (const hit of host.marketHits) {
    if (hit.updateAvailable) map.set(hit.name, hit.version);
  }
  return map;
});

function sizeLabel(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function importFolder(): Promise<void> {
  notice.value = null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string" || !picked) return;
    busy.value = "install";
    await host.installLocal(picked, importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function toggle(id: string, enabled: boolean): Promise<void> {
  busy.value = id;
  notice.value = null;
  try {
    await host.setEnabled(id, enabled);
    if (enabled) await host.loadEnabled(importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function remove(id: string): Promise<void> {
  if (!window.confirm(i18n.t("extensions.confirmRemove", { name: id }))) return;
  busy.value = id;
  try {
    await host.remove(id);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function updateEntry(id: string, version: string): Promise<void> {
  busy.value = id;
  notice.value = null;
  try {
    await host.installFromMarket(id, version);
    await host.loadEnabled(importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function installHit(hit: MarketSearchHit): Promise<void> {
  busy.value = hit.name;
  notice.value = null;
  try {
    await host.installFromMarket(hit.name, hit.version);
    await host.loadEnabled(importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function search(force = false): Promise<void> {
  await host.searchMarket(query.value, force);
}

async function saveSource(): Promise<void> {
  try {
    await host.setMarketUrl(sourceDraft.value.trim());
    await search(true);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(async () => {
  void host.refresh();
  await host.loadMarketUrl();
  sourceDraft.value = host.marketUrl;
  await search(false);
});
</script>

<template>
  <section class="extensions">
    <header class="head">
      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ on: tab === 'installed' }"
          @click="tab = 'installed'"
        >
          {{ i18n.t("extensions.tabInstalled") }}
        </button>
        <button
          type="button"
          class="tab"
          :class="{ on: tab === 'discover' }"
          @click="tab = 'discover'"
        >
          {{ i18n.t("extensions.tabDiscover") }}
        </button>
      </div>
      <button
        v-if="tab === 'installed'"
        class="install"
        type="button"
        :disabled="busy !== null"
        @click="importFolder"
      >
        <FolderOpenIcon class="w-4 h-4" />
        <span>{{ i18n.t("extensions.install") }}</span>
      </button>
    </header>

    <p v-if="notice" class="notice">
      <ExclamationTriangleIcon class="w-4 h-4" />
      <span>{{ notice }}</span>
    </p>

    <!-- 已安装 -->
    <template v-if="tab === 'installed'">
      <p v-if="host.loading" class="hint">{{ i18n.t("extensions.loading") }}</p>
      <p v-else-if="entries.length === 0" class="empty">
        <PuzzlePieceIcon class="w-6 h-6" />
        <span>{{ i18n.t("extensions.empty") }}</span>
      </p>
      <ul v-else class="list">
        <li v-for="entry in entries" :key="entry.id" class="item">
          <div class="item-main">
            <div class="item-title">
              <span class="id">{{ entry.id }}</span>
              <span class="version">v{{ entry.version }}</span>
              <span v-if="!entry.compatible" class="badge warn">
                {{ i18n.t("extensions.incompatible") }}
              </span>
            </div>
            <div class="item-sub">{{ entry.dir }}</div>
            <div v-if="entry.lastError" class="error">{{ entry.lastError }}</div>
          </div>
          <div class="item-actions">
            <button
              v-if="updateFor.get(entry.id)"
              type="button"
              class="ghost primary"
              :disabled="busy === entry.id"
              @click="updateEntry(entry.id, updateFor.get(entry.id) ?? '')"
            >
              {{ i18n.t("extensions.updateTo", { version: updateFor.get(entry.id) ?? "" }) }}
            </button>
            <button
              type="button"
              class="ghost"
              :disabled="busy === entry.id || !entry.compatible"
              @click="toggle(entry.id, !entry.enabled)"
            >
              {{ entry.enabled ? i18n.t("extensions.disable") : i18n.t("extensions.enable") }}
            </button>
            <button
              type="button"
              class="ghost danger"
              :disabled="busy === entry.id"
              @click="remove(entry.id)"
            >
              <TrashIcon class="w-4 h-4" />
            </button>
          </div>
        </li>
      </ul>
      <ul v-if="host.failed.length > 0" class="failures">
        <li v-for="line in host.failed" :key="line">{{ line }}</li>
      </ul>
    </template>

    <!-- 发现 -->
    <template v-else>
      <div class="search-row">
        <input
          v-model="query"
          class="field"
          :placeholder="i18n.t('extensions.search')"
          spellcheck="false"
          @keyup.enter="search(false)"
        />
        <button type="button" class="ghost" :disabled="host.marketLoading" @click="search(true)">
          <ArrowPathIcon class="w-4 h-4" />
        </button>
      </div>
      <p v-if="host.marketSource === 'stale-cache'" class="hint warn-text">
        {{ i18n.t("extensions.marketStale") }}
      </p>
      <p v-if="host.marketError" class="error">{{ host.marketError }}</p>
      <p v-if="host.marketLoading" class="hint">{{ i18n.t("extensions.loading") }}</p>
      <p v-else-if="host.marketHits.length === 0" class="empty">
        <PuzzlePieceIcon class="w-6 h-6" />
        <span>{{ host.marketError ? "" : i18n.t("extensions.marketEmpty") }}</span>
      </p>
      <ul v-else class="list">
        <li v-for="hit in host.marketHits" :key="hit.name" class="item">
          <div class="item-main">
            <div class="item-title">
              <span class="id">{{ hit.title || hit.name }}</span>
              <span class="version">v{{ hit.version }}</span>
              <span v-if="hit.installed" class="badge">
                {{ i18n.t("extensions.marketInstalled") }}
              </span>
            </div>
            <div class="item-sub">{{ hit.name }} · {{ hit.author ?? "" }} · {{ sizeLabel(hit.size) }}</div>
            <div v-if="hit.description" class="item-desc">{{ hit.description }}</div>
          </div>
          <div class="item-actions">
            <button
              type="button"
              class="ghost primary"
              :disabled="busy === hit.name"
              @click="installHit(hit)"
            >
              {{
                hit.updateAvailable
                  ? i18n.t("extensions.updateTo", { version: hit.version })
                  : i18n.t("extensions.installFromMarket")
              }}
            </button>
          </div>
        </li>
      </ul>
      <div class="source-row">
        <span class="row-label">{{ i18n.t("extensions.marketSource") }}</span>
        <input v-model="sourceDraft" class="field" spellcheck="false" />
        <button type="button" class="ghost" @click="saveSource">
          {{ i18n.t("extensions.marketSaveSource") }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* 侧边栏宽度会在 280–520px 之间被拖动，所以按「容器宽度」自适应，
   不按窗口宽度（窗口宽不代表这个面板宽）。 */
.extensions {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  height: 100%;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.tabs {
  display: flex;
  gap: 4px;
  min-width: 0;
}
.tab {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  background: transparent;
}
.tab.on {
  color: var(--md-sys-color-on-primary-container);
  background: var(--md-sys-color-primary-container);
}
.install {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--md-sys-color-on-primary-container);
  background: var(--md-sys-color-primary-container);
}
.notice,
.empty {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.notice {
  color: var(--md-sys-color-error);
}
.search-row,
.source-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.source-row {
  flex-wrap: wrap;
}
.field {
  flex: 1 1 120px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface);
  background: var(--md-sys-color-surface-container-high);
}
.row-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.item {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container);
}
.item-main {
  flex: 1 1 160px;
  min-width: 0;
}
.item-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.id {
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
  color: var(--md-sys-color-on-surface);
}
.version {
  flex: 0 0 auto;
  color: var(--md-sys-color-on-surface-variant);
}
.item-sub,
.item-desc {
  font-size: 10px;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.item-desc {
  margin-top: 2px;
}
.badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--md-sys-color-on-secondary-container);
  background: var(--md-sys-color-secondary-container);
}
.badge.warn {
  color: var(--md-sys-color-on-error-container);
  background: var(--md-sys-color-error-container);
}
.error {
  font-size: 11px;
  color: var(--md-sys-color-error);
  margin-top: 2px;
  overflow-wrap: anywhere;
}
.item-actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-left: auto;
}
.ghost {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--md-sys-color-on-surface);
  background: transparent;
}
.ghost.primary {
  color: var(--md-sys-color-on-primary-container);
  background: var(--md-sys-color-primary-container);
}
.ghost.danger {
  color: var(--md-sys-color-error);
}
.failures {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  overflow-wrap: anywhere;
  color: var(--md-sys-color-error);
}
.hint {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.warn-text {
  color: var(--md-sys-color-error);
}

/* 窄面板：图标按钮代替文字、操作行落到下一行。 */
@container (max-width: 340px) {
  .extensions {
    padding: 10px;
    gap: 10px;
  }
  .install span {
    display: none;
  }
  .item {
    flex-direction: column;
    align-items: stretch;
  }
  .item-actions {
    justify-content: flex-end;
    margin-left: 0;
  }
  .tab {
    padding: 4px 8px;
  }
}
</style>
