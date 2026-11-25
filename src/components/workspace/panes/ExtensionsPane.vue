<script setup lang="ts">
/**
 * 画布插件面板：**已安装**与**发现**两件事分开做。
 *
 * 视觉与交互沿用「下载管理器」（`ModelsPane`）那一套：同一套卡片 / 标签 / 胶囊类名、
 * 同一套 MD3 token，窄面板里自动换行。索引源不在这里改——它属于设置项，
 * 面板只放一个跳转胶囊（和「下载源」胶囊同一形态）。
 */
import { computed, onMounted, ref } from "vue";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
} from "@heroicons/vue/24/outline";
import { usePluginHostStore } from "@/stores/pluginHost";
import { useLayoutStore } from "@/stores/layout";
import { importPluginModule } from "@/core/plugins/importer";
import { useI18n } from "@/i18n";
import Md3Chip from "@/components/common/Md3Chip.vue";
import type { MarketSearchHit } from "@/types/pluginMarket";

const host = usePluginHostStore();
const layout = useLayoutStore();
const i18n = useI18n();
const tab = ref<"installed" | "discover">("installed");
const query = ref("");
const busy = ref<string | null>(null);
const notice = ref<string | null>(null);

const entries = computed(() => host.plugins);
/** 已装插件里可更新的：id → 目标版本。 */
const updateFor = computed(() => {
  const map = new Map<string, string>();
  for (const hit of host.marketHits) {
    if (hit.updateAvailable) map.set(hit.name, hit.version);
  }
  return map;
});

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
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

async function install(name: string, version: string): Promise<void> {
  busy.value = name;
  notice.value = null;
  try {
    await host.installFromMarket(name, version);
    await host.loadEnabled(importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

function installHit(hit: MarketSearchHit): Promise<void> {
  return install(hit.name, hit.version);
}

async function search(force = false): Promise<void> {
  await host.searchMarket(query.value, force);
}

async function refreshAll(): Promise<void> {
  busy.value = "reload";
  try {
    // 「刷新」= 重新读名册 + 把 rev 变了的插件热替换掉（改了 client.js 不用重启）。
    await host.reloadAll(importPluginModule);
    if (tab.value === "discover") await search(true);
  } finally {
    busy.value = null;
  }
}

async function reloadOne(id: string): Promise<void> {
  busy.value = id;
  notice.value = null;
  try {
    await host.reload(id, importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  void host.refresh();
  void search(false);
});
</script>

<template>
  <div class="pane">
    <header class="head">
      <div class="head-main">
        <h2 class="title">{{ i18n.t("extensions.title") }}</h2>
        <p class="sub">
          {{
            tab === "installed"
              ? i18n.t("extensions.subInstalled", { count: entries.length })
              : i18n.t("extensions.subDiscover", { count: host.marketTotal })
          }}
        </p>
      </div>
      <button
        class="icon-btn"
        :title="i18n.t('extensions.refresh')"
        :aria-label="i18n.t('extensions.refresh')"
        :disabled="host.loading || host.marketLoading"
        @click="refreshAll"
      >
        <ArrowPathIcon class="w-[16px] h-[16px]" :class="{ spinning: host.marketLoading }" />
      </button>
    </header>

    <div class="manager-bar">
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ on: tab === 'installed' }"
          role="tab"
          :aria-selected="tab === 'installed'"
          @click="tab = 'installed'"
        >
          {{ i18n.t("extensions.tabInstalled") }}
          <span v-if="entries.length" class="tab-count">{{ entries.length }}</span>
        </button>
        <button
          class="tab"
          :class="{ on: tab === 'discover' }"
          role="tab"
          :aria-selected="tab === 'discover'"
          @click="tab = 'discover'"
        >
          {{ i18n.t("extensions.tabDiscover") }}
          <span v-if="host.marketTotal" class="tab-count">{{ host.marketTotal }}</span>
        </button>
      </div>
      <button
        v-if="tab === 'installed'"
        class="mini-btn primary"
        type="button"
        :disabled="busy !== null"
        @click="importFolder"
      >
        <FolderOpenIcon class="w-[13px] h-[13px]" />
        {{ i18n.t("extensions.install") }}
      </button>
    </div>

    <p v-if="notice" class="banner">
      <span class="banner-text">{{ notice }}</span>
    </p>

    <!-- 已安装 -->
    <template v-if="tab === 'installed'">
      <p v-if="entries.length === 0" class="empty">
        <PuzzlePieceIcon class="w-[18px] h-[18px]" />
        <span>{{ i18n.t("extensions.empty") }}</span>
      </p>
      <ul v-else class="list">
        <li v-for="entry in entries" :key="entry.id" class="card">
          <div class="card-top">
            <span class="card-name">{{ entry.id }}</span>
            <span class="badge">v{{ entry.version }}</span>
            <span v-if="entry.enabled" class="badge ok">
              {{ i18n.t("extensions.enabled") }}
            </span>
            <span v-else class="badge">{{ i18n.t("extensions.disabled") }}</span>
            <span v-if="!entry.compatible" class="badge warn">
              {{ i18n.t("extensions.incompatible") }}
            </span>
            <span v-if="entry.kind === 'store'" class="badge source">
              {{ i18n.t("extensions.kindStore") }}
            </span>
            <span v-else class="badge source">{{ i18n.t("extensions.kindLinked") }}</span>
          </div>
          <p class="card-files" :title="entry.dir">{{ entry.dir }}</p>
          <p v-if="entry.lastError" class="card-error">{{ entry.lastError }}</p>
          <div class="card-actions">
            <button
              v-if="updateFor.get(entry.id)"
              class="mini-btn primary"
              type="button"
              :disabled="busy === entry.id"
              @click="install(entry.id, updateFor.get(entry.id) ?? '')"
            >
              {{ i18n.t("extensions.updateTo", { version: updateFor.get(entry.id) ?? "" }) }}
            </button>
            <button
              class="mini-btn"
              type="button"
              :disabled="busy === entry.id || !entry.compatible || !entry.enabled"
              @click="reloadOne(entry.id)"
            >
              {{ i18n.t("extensions.reload") }}
            </button>
            <button
              class="mini-btn"
              type="button"
              :disabled="busy === entry.id || !entry.compatible"
              @click="toggle(entry.id, !entry.enabled)"
            >
              {{ entry.enabled ? i18n.t("extensions.disable") : i18n.t("extensions.enable") }}
            </button>
            <button
              class="mini-btn danger"
              type="button"
              :disabled="busy === entry.id"
              @click="remove(entry.id)"
            >
              {{ i18n.t("common.remove") }}
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
      <input
        v-model="query"
        class="search"
        type="search"
        :placeholder="i18n.t('extensions.search')"
        :aria-label="i18n.t('extensions.search')"
        @keyup.enter="search(false)"
      />

      <div class="chips" role="group" :aria-label="i18n.t('extensions.marketSource')">
        <span class="chip status">
          {{
            host.marketSource === "network"
              ? i18n.t("extensions.marketOnline")
              : host.marketSource === "cache"
                ? i18n.t("extensions.marketCached")
                : host.marketSource === "stale-cache"
                  ? i18n.t("extensions.marketStale")
                  : i18n.t("extensions.marketUnknown")
          }}
        </span>
        <Md3Chip
          size="sm"
          variant="assist"
          @click="layout.openSettings('network')"
        >
          <AdjustmentsHorizontalIcon class="w-[13px] h-[13px]" />
          {{ i18n.t("extensions.marketSourceSettings") }}
        </Md3Chip>
      </div>

      <p v-if="host.marketError" class="banner">
        <span class="banner-text">{{ host.marketError }}</span>
      </p>
      <p v-else-if="host.marketLoading" class="empty">{{ i18n.t("extensions.loading") }}</p>
      <p v-else-if="host.marketHits.length === 0" class="empty">
        <PuzzlePieceIcon class="w-[18px] h-[18px]" />
        <span>{{ i18n.t("extensions.marketEmpty") }}</span>
      </p>

      <ul v-else class="list">
        <li v-for="hit in host.marketHits" :key="hit.name" class="card">
          <div class="card-top">
            <span class="card-name">{{ hit.title || hit.name }}</span>
            <span class="badge">v{{ hit.version }}</span>
            <span v-if="hit.installed" class="badge ok">
              {{ i18n.t("extensions.marketInstalled") }}
            </span>
            <span v-if="hit.updateAvailable" class="badge source">
              {{ i18n.t("extensions.marketUpdate") }}
            </span>
          </div>
          <p class="card-meta">
            {{ hit.name }}<template v-if="hit.author"> · {{ hit.author }}</template>
            · {{ sizeLabel(hit.size) }}
          </p>
          <p v-if="hit.description" class="card-desc">{{ hit.description }}</p>
          <div class="card-actions">
            <button
              class="mini-btn primary"
              type="button"
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
    </template>
  </div>
</template>

<style scoped>
/* 视觉基线来自「下载管理器」（ModelsPane）：同一套类名与 MD3 token。 */
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
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
.tabs {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 3px;
  min-width: 0;
}
.tab {
  height: 30px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 7px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  flex: 0 0 auto;
  cursor: pointer;
  transition:
    border-radius var(--md-dur-effects-default) var(--md-spring-effects-default),
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.tab:first-child {
  border-radius: 15px 7px 7px 15px;
}
.tab:last-child {
  border-radius: 7px 15px 15px 7px;
}
.tab:hover:not(.on) {
  color: rgb(var(--md-on-surface));
  filter: brightness(1.06);
}
.tab:active {
  border-radius: 11px;
}
.tab.on {
  border-radius: 15px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-weight: 600;
}
.tab-count {
  padding: 1px 6px;
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
.search {
  flex: 0 0 auto;
  height: 32px;
  min-height: 32px;
  margin: 10px 14px 0;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip.status {
  cursor: default;
}
.chip.source-chip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
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
.banner-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.empty {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
  overflow-wrap: anywhere;
}
.list {
  list-style: none;
  margin: 10px 14px 0;
  padding: 0;
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
  min-width: 0;
}
.card-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.card-name {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
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
.card-meta,
.card-files,
.card-desc,
.card-error {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
  overflow-wrap: anywhere;
}
.card-files {
  font-size: 10.5px;
  word-break: break-all;
}
.card-desc {
  color: rgb(var(--md-on-surface-variant));
}
.card-error {
  color: rgb(var(--md-error));
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
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.mini-btn.primary {
  border-color: transparent;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.mini-btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}
.mini-btn.danger {
  color: rgb(var(--md-error));
  border-color: rgb(var(--md-error) / 0.4);
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.failures {
  list-style: none;
  margin: 10px 14px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  overflow-wrap: anywhere;
  color: rgb(var(--md-error));
}
</style>
