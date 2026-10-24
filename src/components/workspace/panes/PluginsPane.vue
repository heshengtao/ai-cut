<script setup lang="ts">
/**
 * OFX 插件面板：只展示**已安装**的插件，并打开它们的界面。
 *
 * 安装、导入、搜索、筛选、更新、删除都在下载管理器里；这里不做文件管理。
 */
import { computed, onMounted } from "vue";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  PuzzlePieceIcon,
} from "@heroicons/vue/24/outline";
import { usePluginsStore } from "@/stores/plugins";
import { useOfxStore } from "@/stores/ofx";
import { useLayoutStore } from "@/stores/layout";
import { useI18n } from "@/i18n";
import PluginList from "./PluginList.vue";
import type { PluginStatus } from "@/types/plugins";

const plugins = usePluginsStore();
const ofx = useOfxStore();
const layout = useLayoutStore();
const i18n = useI18n();

function typeLabel(type: string): string {
  const key = `plugins.type.${type}`;
  const label = i18n.t(key);
  return label === key ? type : label;
}

const groups = computed(() => {
  const map = new Map<string, PluginStatus[]>();
  for (const plugin of plugins.installedPlugins) {
    const type = plugin.plugin_types[0] ?? "general";
    const list = map.get(type) ?? [];
    list.push(plugin);
    map.set(type, list);
  }
  return [...map.entries()].map(([type, items]) => ({
    type,
    label: typeLabel(type),
    items,
  }));
});

function openInterface(slug: string): void {
  const plugin = plugins.installedPlugins.find((item) => item.slug === slug);
  if (!plugin?.installed_path) return;
  ofx.openPluginTarget({
    bundle: plugin.installed_path,
    plugin: "",
    name: plugin.name,
  });
  layout.openTab("pluginEditor");
}

onMounted(() => {
  void plugins.loadInstalled();
});
</script>

<template>
  <div class="pane">
    <header class="head">
      <div class="head-main">
        <h2 class="title">
          <PuzzlePieceIcon class="title-icon" />
          {{ i18n.t("plugins.title") }}
        </h2>
        <p class="sub">
          {{ i18n.t("plugins.installedSub", { count: plugins.installedCount }) }}
        </p>
      </div>
      <div class="head-actions">
        <button
          class="icon-btn"
          :title="i18n.t('plugins.refresh')"
          :aria-label="i18n.t('plugins.refresh')"
          :disabled="plugins.installedLoading"
          @click="plugins.loadInstalled()"
        >
          <ArrowPathIcon
            class="icon"
            :class="{ spinning: plugins.installedLoading }"
          />
        </button>
        <button class="manage-btn" @click="layout.openDownloads('plugins')">
          <ArrowTopRightOnSquareIcon class="btn-icon" />
          {{ i18n.t("plugins.manage") }}
        </button>
      </div>
    </header>

    <div v-if="plugins.error" class="banner">
      <ExclamationTriangleIcon class="banner-icon" />
      <span class="banner-text">{{ plugins.error }}</span>
      <button class="banner-close" @click="plugins.error = null">×</button>
    </div>

    <div v-if="plugins.installedLoading && plugins.installedPlugins.length === 0" class="empty">
      <ArrowPathIcon class="empty-icon spinning" />
      <p class="empty-text">{{ i18n.t("common.loading") }}</p>
    </div>

    <template v-else-if="groups.length > 0">
      <section v-for="group in groups" :key="group.type" class="group">
        <div class="group-title">{{ group.label }}</div>
        <PluginList :plugins="group.items" mode="use" @use="openInterface" />
      </section>
    </template>

    <div v-else class="empty">
      <PuzzlePieceIcon class="empty-icon" />
      <p class="empty-text">{{ i18n.t("plugins.noInstalled") }}</p>
      <p class="empty-hint">{{ i18n.t("plugins.noInstalledHint") }}</p>
      <button class="manage-btn" @click="layout.openDownloads('plugins')">
        <ArrowTopRightOnSquareIcon class="btn-icon" />
        {{ i18n.t("plugins.manage") }}
      </button>
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
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.title-icon {
  width: 16px;
  height: 16px;
  color: rgb(var(--md-on-surface-variant));
}
.sub {
  margin: 3px 0 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
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
.icon {
  width: 16px;
  height: 16px;
}
.manage-btn {
  height: 28px;
  padding: 0 12px;
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
}
.manage-btn:hover {
  filter: brightness(1.08);
}
.btn-icon {
  width: 13px;
  height: 13px;
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
.group {
  margin-top: 12px;
}
.group-title {
  padding: 0 14px 2px;
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant));
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 44px 16px;
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
.spinning {
  animation: spin 0.9s linear infinite;
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
