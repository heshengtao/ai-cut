<script setup lang="ts">
/**
 * 右侧面板：只负责渲染当前标签的内容。
 * 标签栏（标签 / 「+」/ 开关）在标题栏里，与本面板同宽、同一行。
 */
import { computed } from "vue";
import {
  RectangleStackIcon,
  AdjustmentsHorizontalIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  ListBulletIcon,
  PuzzlePieceIcon,
} from "@heroicons/vue/24/outline";
import MediaPane from "./panes/MediaPane.vue";
import InspectorPane from "./panes/InspectorPane.vue";
import OpsPane from "./panes/OpsPane.vue";
import AiPane from "./panes/AiPane.vue";
import ModelsPane from "./panes/ModelsPane.vue";
import PluginsPane from "./panes/PluginsPane.vue";
import PluginEditorPane from "./panes/PluginEditorPane.vue";
import ClipAgentPanel from "./agent/ClipAgentPanel.vue";
import { PANES, useLayoutStore, type PaneId } from "@/stores/layout";
import { useI18n } from "@/i18n";

const layout = useLayoutStore();
const i18n = useI18n();

const ICONS: Record<PaneId, unknown> = {
  media: RectangleStackIcon,
  inspector: AdjustmentsHorizontalIcon,
  ops: ListBulletIcon,
  agent: ChatBubbleLeftRightIcon,
  ai: SparklesIcon,
  models: CpuChipIcon,
  plugins: PuzzlePieceIcon,
  pluginEditor: AdjustmentsHorizontalIcon,
};

const panes = computed(() => PANES.filter((pane) => !pane.hidden));
</script>

<template>
  <aside class="right-panel">
    <div class="pane-body">
      <!-- 没有标签时：列出所有可以打开的面板 -->
      <div v-if="layout.tabs.length === 0" class="empty">
        <p class="empty-title">{{ i18n.t("panel.emptyTitle") }}</p>
        <p class="empty-sub">{{ i18n.t("panel.emptySub") }}</p>
        <ul class="empty-list">
          <li v-for="p in panes" :key="p.id">
            <button class="empty-item" @click="layout.openTab(p.id)">
              <component :is="ICONS[p.id]" class="empty-icon" />
              <span class="empty-text">
                <span class="empty-label">{{ i18n.t(p.labelKey) }}</span>
                <span class="empty-hint">{{ i18n.t(p.hintKey) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <MediaPane v-else-if="layout.activeTab === 'media'" />
      <InspectorPane v-else-if="layout.activeTab === 'inspector'" />
      <OpsPane v-else-if="layout.activeTab === 'ops'" />
      <ClipAgentPanel v-else-if="layout.activeTab === 'agent'" />
      <AiPane v-else-if="layout.activeTab === 'ai'" />
      <ModelsPane v-else-if="layout.activeTab === 'models'" />
      <PluginsPane v-else-if="layout.activeTab === 'plugins'" />
      <PluginEditorPane v-else-if="layout.activeTab === 'pluginEditor'" />
    </div>
  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  flex: 0 0 auto;
  background-color: var(--app-card);
  overflow: hidden;
}
.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

/* ---- 空态：可打开面板列表 ---- */
.empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 30px 16px;
  overflow-y: auto;
}
.empty-title {
  margin: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.empty-sub {
  margin: 4px 0 18px;
  text-align: center;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.empty-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.empty-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.empty-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.empty-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
}
.empty-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.empty-label {
  font-size: 13px;
  font-weight: 500;
}
.empty-hint {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
</style>
