<script setup lang="ts">
/**
 * 标题栏（MD3）：去掉原生标题栏后，应用自己的顶栏。
 *
 * 横屏：工程按钮组 → 标签栏（与右侧面板同宽）→ 面板开关（永远贴窗口最右）。
 * 竖屏：标题 → 标签栏（居中）→ 工程按钮组 → 面板开关（永远贴窗口最右）。
 */
import { computed, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PencilSquareIcon } from "@heroicons/vue/24/outline";
import Logo from "@/components/common/Logo.vue";
import PanelIcon from "@/components/common/PanelIcon.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import ProjectDialog from "@/components/common/ProjectDialog.vue";
import PanelTabs from "@/components/workspace/PanelTabs.vue";
import BarActions from "./BarActions.vue";
import { useLayoutStore } from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { useProjectActions } from "@/composables/useProjectActions";
import { displayProjectName, isUntitled } from "@/utils/projectName";
import { useI18n } from "@/i18n";
import { isMacOS, isTauri } from "@/utils/platform";

const layout = useLayoutStore();
const project = useProjectStore();
const actions = useProjectActions();
const i18n = useI18n();

const projectDialogOpen = ref(false);

/** 显示用工程名：未命名工程按当前语言显示。 */
const projectName = computed(() => displayProjectName(project.doc.name));

const isPortrait = computed(() => layout.layoutMode === "portrait");
const panelTabsVisible = computed(() => !layout.settingsOpen && layout.showPanel);

/**
 * 竖屏：标题区宽度与左侧预览一致，标签栏正好从预览分隔线开始。
 * 拖动预览分隔线时 `previewRatio` 变化，标签栏会跟着移动。
 */
const portraitLeadStyle = computed(() =>
  isPortrait.value && !layout.settingsOpen
    ? { width: `calc(${layout.previewRatio * 100}% + 1px)` }
    : undefined,
);

/** macOS 的 Overlay 标题栏下，红绿灯压在内容上：顶栏左侧要给它让位。 */
const padMac = computed(() => isTauri() && isMacOS());

function openRename(): void {
  projectDialogOpen.value = true;
}

function onRenameSubmit(name: string): void {
  actions.renameProject(name);
}

/** 顶栏空白处拖动窗口；双击最大化。按钮/输入框上不抢事件。 */
function onMouseDown(e: MouseEvent): void {
  if (!isTauri()) return;
  if (e.buttons !== 1) return;
  const target = e.target as HTMLElement;
  if (target.closest("button, a, input, select, textarea")) return;
  const win = getCurrentWindow();
  if (e.detail === 2) {
    void win.toggleMaximize();
  } else {
    void win.startDragging();
  }
}
</script>

<template>
  <header class="top-bar" :class="{ 'pad-mac': padMac }" @mousedown="onMouseDown">
    <div
      v-if="project.busy"
      class="activity-progress"
      role="progressbar"
      :aria-label="i18n.t('common.loading')"
    >
      <span class="activity-progress-fill" />
    </div>
    <!-- 左：应用标识 + 工程名（横屏时动作按钮也在这里） -->
    <div
      class="bar-main"
      :class="{ 'bar-main-portrait': isPortrait && !layout.settingsOpen }"
      :style="portraitLeadStyle"
    >
      <Logo :size="26" class="brand-mark" />
      <span class="brand-name">AI Cut</span>

      <span class="bar-sep" />

      <div class="name-block">
        <span class="name-strong" @dblclick="openRename">{{ projectName }}</span>
        <span v-if="project.dirty" class="name-dirty" :title="i18n.t('topbar.unsaved')" aria-hidden="true" />
      </div>
      <Tooltip :text="i18n.t('topbar.rename')">
        <button class="bar-btn name-edit" :aria-label="i18n.t('topbar.renameLabel')" @click="openRename">
          <PencilSquareIcon class="bar-icon" />
        </button>
      </Tooltip>

      <div class="flex-1" />
      <BarActions v-if="!isPortrait" />
    </div>

    <!-- 横屏：标签栏与右侧面板同宽，面板开关贴在窗口最右 -->
    <template v-if="!isPortrait">
      <div
        class="bar-right"
        :style="panelTabsVisible ? { width: `${layout.panelWidth}px` } : undefined"
      >
        <div v-if="panelTabsVisible" class="bar-tabs">
          <PanelTabs />
        </div>
        <Tooltip
          v-if="!layout.settingsOpen"
          :text="layout.showPanel ? i18n.t('topbar.hidePanel') : i18n.t('topbar.showPanel')"
          align="end"
        >
          <button
            class="bar-btn tabs-toggle"
            :class="{ on: layout.showPanel }"
            :aria-label="layout.showPanel ? i18n.t('topbar.hidePanel') : i18n.t('topbar.showPanel')"
            :aria-expanded="layout.showPanel"
            @click="layout.showPanel = !layout.showPanel"
          >
            <PanelIcon side="right" :filled="layout.showPanel" class="bar-icon" />
          </button>
        </Tooltip>
      </div>
    </template>

    <!-- 竖屏：标题 → 标签栏 → 动作按钮 → 面板开关 -->
    <template v-else>
      <div v-if="!layout.settingsOpen" class="bar-tabs portrait-tabs">
        <PanelTabs v-if="layout.showPanel" />
      </div>
      <BarActions />
      <Tooltip
        v-if="!layout.settingsOpen"
        :text="layout.showPanel ? i18n.t('topbar.hidePanel') : i18n.t('topbar.showPanel')"
        align="end"
      >
        <button
          class="bar-btn tabs-toggle portrait-toggle"
          :class="{ on: layout.showPanel }"
          :aria-label="layout.showPanel ? i18n.t('topbar.hidePanel') : i18n.t('topbar.showPanel')"
          :aria-expanded="layout.showPanel"
          @click="layout.showPanel = !layout.showPanel"
        >
          <PanelIcon side="right" :filled="layout.showPanel" class="bar-icon" />
        </button>
      </Tooltip>
    </template>
  </header>

  <ProjectDialog
    v-model:open="projectDialogOpen"
    :initial-name="isUntitled(project.doc.name) ? '' : project.doc.name"
    @submit="onRenameSubmit"
  />
</template>

<style scoped>
.top-bar {
  height: 52px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0;
  background-color: var(--app-card);
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.4);
  user-select: none;
  position: relative;
  z-index: 30;
}
/* 打开 / 恢复工程时的顶部线性进度条（不挡住窗口按钮）。 */
.activity-progress {
  position: absolute;
  left: 0;
  right: var(--win-reserve);
  bottom: 0;
  height: 2px;
  overflow: hidden;
  z-index: 2;
  background-color: rgb(var(--md-primary) / 0.14);
}
.activity-progress-fill {
  display: block;
  width: 34%;
  height: 100%;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  animation: top-activity 1.05s ease-in-out infinite;
}
@keyframes top-activity {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(395%);
  }
}
.bar-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
}
/* 竖屏：标题区宽度与左侧预览一致（宽度由内联 previewRatio 控制） */
.bar-main.bar-main-portrait {
  flex: 0 0 auto;
  overflow: hidden;
}
/* macOS Overlay 标题栏：红绿灯占位 */
.top-bar.pad-mac .bar-main {
  padding-left: 78px;
}

.brand-mark {
  margin-right: 1px;
}
.brand-name {
  font-family: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.1px;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
}

.bar-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background-color: rgb(var(--md-outline-variant) / 0.55);
  flex: 0 0 auto;
}

.name-block {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 0 1 auto;
}
.name-strong {
  font-weight: 500;
  font-size: 13px;
  letter-spacing: -0.1px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}
/* 未保存标记：紧贴工程名的小圆点 */
.name-dirty {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}

/* ---- 右侧区域：宽度跟随面板，按钮固定在最右 ---- */
.bar-right {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-right: calc(12px + var(--win-reserve));
}

/* ---- 右侧面板的标签区 ---- */
.bar-tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border-left: 1px solid rgb(var(--md-outline-variant) / 0.4);
}
/* 竖屏：标签栏从预览分隔线开始，向左对齐；分隔线继续延伸到顶栏 */
.portrait-tabs {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  padding-left: 0;
  border-left: 1px solid rgb(var(--md-outline-variant) / 0.4);
}
.portrait-toggle {
  margin-right: calc(12px + var(--win-reserve));
}

/* 重命名按钮比普通图标按钮稍小，紧跟在工程名后面 */
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
.bar-btn.name-edit {
  width: 28px;
  height: 28px;
}
.bar-btn.name-edit .bar-icon {
  width: 16px;
  height: 16px;
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
  .activity-progress-fill {
    width: 100%;
    animation: none;
    opacity: 0.7;
  }
}
</style>
