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
  ScissorsIcon,
} from "@heroicons/vue/24/outline";
import MediaPane from "./panes/MediaPane.vue";
import InspectorPane from "./panes/InspectorPane.vue";
import OpsPane from "./panes/OpsPane.vue";
import AiPane from "./panes/AiPane.vue";
import ModelsPane from "./panes/ModelsPane.vue";
import PluginsPane from "./panes/PluginsPane.vue";
import PluginEditorPane from "./panes/PluginEditorPane.vue";
import ClipAgentPanel from "./agent/ClipAgentPanel.vue";
import CutReviewPane from "./panes/CutReviewPane.vue";
import EmptyPanels from "@/components/onboarding/EmptyPanels.vue";
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
  cutReview: ScissorsIcon,
  pluginEditor: AdjustmentsHorizontalIcon,
};

const panes = computed(() => PANES.filter((pane) => !pane.hidden));

/** 没有标签时给出空态；有标签时按 activeTab 换页。 */
const activeKey = computed(() =>
  layout.tabs.length === 0 ? "empty" : layout.activeTab,
);
</script>

<template>
  <aside class="right-panel" data-tour="panels">
    <div class="pane-body">
      <Transition name="pane" mode="out-in">
        <div :key="activeKey" class="pane-slot">
          <!-- 没有标签时：插图 + 所有可以打开的面板 -->
          <div v-if="layout.tabs.length === 0" class="empty">
            <EmptyPanels class="empty-art" />
            <p class="empty-title">{{ i18n.t("panel.emptyTitle") }}</p>
            <p class="empty-sub">{{ i18n.t("panel.emptySub") }}</p>
            <ul class="empty-list anim-stagger">
              <li
                v-for="(p, i) in panes"
                :key="p.id"
                :style="{ '--i': i }"
              >
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
          <CutReviewPane v-else-if="layout.activeTab === 'cutReview'" />
          <PluginEditorPane v-else-if="layout.activeTab === 'pluginEditor'" />
        </div>
      </Transition>
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
  background-image: var(--app-wash);
  overflow: hidden;
}
.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.pane-slot {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
}

/* ---- 空态：插图 + 可打开面板列表 ---- */
.empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 26px 16px 30px;
  overflow-y: auto;
  animation: m3-rise var(--md-duration-medium-2) var(--md-ease-emphasized-decel) both;
}
.empty-art {
  margin-bottom: 8px;
}
.empty-title {
  margin: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.empty-sub {
  margin: 4px 0 18px;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
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
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    transform var(--md-duration-short-2) var(--md-ease-standard);
}
.empty-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  transform: translateX(2px);
}
.empty-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
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

@media (prefers-reduced-motion: reduce) {
  .empty {
    animation: none;
  }
  .empty-item {
    transition: none;
  }
  .empty-item:hover {
    transform: none;
  }
}
</style>
