<script setup lang="ts">
/** 顶栏右侧的工程动作按钮：历史 / 新建 / 打开 / 保存 / 导出 + 快捷键、布局与设置。 */
import { ref } from "vue";
import {
  ClockIcon,
  PlusIcon,
  FolderOpenIcon,
  ArrowUpTrayIcon,
  Cog6ToothIcon,
} from "@heroicons/vue/24/outline";
import Tooltip from "@/components/common/Tooltip.vue";
import FloppyDiskIcon from "@/components/common/icons/FloppyDiskIcon.vue";
import KeyboardIcon from "@/components/common/icons/KeyboardIcon.vue";
import ProjectHistoryDialog from "@/components/common/ProjectHistoryDialog.vue";
import ShortcutsDialog from "@/components/common/ShortcutsDialog.vue";
import LayoutMenu from "./LayoutMenu.vue";
import { useLayoutStore } from "@/stores/layout";
import { useProjectActions } from "@/composables/useProjectActions";
import { useI18n } from "@/i18n";

const layout = useLayoutStore();
const actions = useProjectActions();
const i18n = useI18n();

const shortcutsOpen = ref(false);
const historyOpen = ref(false);
</script>

<template>
  <div class="bar-actions">
    <Tooltip :text="i18n.t('topbar.history')" align="end">
      <button
        class="bar-btn"
        :class="{ on: historyOpen }"
        :aria-label="i18n.t('topbar.historyLabel')"
        @click="historyOpen = true"
      >
        <ClockIcon class="bar-icon" />
      </button>
    </Tooltip>
    <Tooltip :text="i18n.t('topbar.new')" align="end">
      <button class="bar-btn" :aria-label="i18n.t('topbar.newLabel')" @click="actions.newProject">
        <PlusIcon class="bar-icon" />
      </button>
    </Tooltip>
    <Tooltip :text="i18n.t('topbar.open')" align="end">
      <button class="bar-btn" :aria-label="i18n.t('topbar.openLabel')" @click="actions.openProject">
        <FolderOpenIcon class="bar-icon" />
      </button>
    </Tooltip>
    <Tooltip :text="i18n.t('topbar.save')" align="end">
      <button class="bar-btn" :aria-label="i18n.t('topbar.saveLabel')" @click="actions.saveProject">
        <FloppyDiskIcon class="bar-icon" />
      </button>
    </Tooltip>
    <Tooltip :text="i18n.t('topbar.export')" align="end">
      <button class="bar-btn" :aria-label="i18n.t('topbar.exportLabel')" @click="actions.exportVideo">
        <ArrowUpTrayIcon class="bar-icon" />
      </button>
    </Tooltip>

    <span class="bar-sep" />

    <Tooltip :text="i18n.t('topbar.shortcuts')" align="end">
      <button
        class="bar-btn"
        :class="{ on: shortcutsOpen }"
        :aria-label="i18n.t('topbar.shortcuts')"
        @click="shortcutsOpen = true"
      >
        <KeyboardIcon class="bar-icon" />
      </button>
    </Tooltip>

    <LayoutMenu />

    <span class="bar-sep" />

    <Tooltip :text="i18n.t('topbar.settings')" align="end">
      <button
        class="bar-btn"
        :class="{ on: layout.settingsOpen }"
        :aria-label="i18n.t('topbar.settings')"
        :aria-expanded="layout.settingsOpen"
        @click="actions.toggleSettings"
      >
        <Cog6ToothIcon class="bar-icon" />
      </button>
    </Tooltip>
  </div>

  <ShortcutsDialog v-model:open="shortcutsOpen" />
  <ProjectHistoryDialog v-model:open="historyOpen" />
</template>

<style scoped>
.bar-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  margin-left: auto;
}
.bar-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background-color: rgb(var(--md-outline-variant) / 0.55);
  flex: 0 0 auto;
}
.bar-btn {
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
  transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.bar-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.bar-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.bar-btn:active {
  transform: scale(0.94);
}
.bar-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.bar-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
@media (prefers-reduced-motion: reduce) {
  .bar-btn {
    transition: none;
  }
  .bar-btn:active {
    transform: none;
  }
}
</style>
