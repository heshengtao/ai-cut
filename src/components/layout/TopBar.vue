<script setup lang="ts">
/**
 * 标题栏（MD3）：去掉原生标题栏后，应用自己的顶栏。
 *
 * 左：应用标识 + 工程名；右：右侧面板的标签栏（与下方面板同宽、同一行）+ 面板开关。
 * 标签栏横跨到窗口最右端，因此开关按钮位置固定，展开/收起时鼠标不用移动。
 * macOS 用 Overlay 标题栏（保留红绿灯），左侧留出安全区；Windows / Linux 完全无边框。
 */
import { computed } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Logo from "@/components/common/Logo.vue";
import PanelIcon from "@/components/common/PanelIcon.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import PanelTabs from "@/components/workspace/PanelTabs.vue";
import SettingsMenu from "./SettingsMenu.vue";
import { useLayoutStore } from "@/stores/layout";
import { isMacOS, isTauri } from "@/utils/platform";

const layout = useLayoutStore();

/** macOS 的 Overlay 标题栏下，红绿灯压在内容上：顶栏左侧要给它让位。 */
const padMac = computed(() => isTauri() && isMacOS());

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
    <!-- 左：应用标识 + 工程名 -->
    <div class="bar-main">
      <Logo :size="26" class="brand-mark" />
      <span class="brand-name">AI Cut</span>

      <span class="bar-sep" />

      <div class="name-block">
        <span class="name-strong">未命名项目</span>
        <span class="name-dirty" title="有未保存的改动" aria-hidden="true" />
      </div>
      <span class="name-meta">草稿</span>

      <div class="flex-1" />
    </div>

    <!-- 右：右侧面板的标签栏（与下方面板同宽、同一行）+ 设置 + 面板开关 -->
    <div
      class="bar-tabs"
      :class="{ 'has-panel': layout.showPanel }"
      :style="layout.showPanel ? { width: `${layout.panelWidth}px` } : undefined"
    >
      <PanelTabs v-if="layout.showPanel" />

      <div class="tabs-actions">
        <SettingsMenu />

        <Tooltip
          :text="layout.showPanel ? '收起右侧边栏' : '展开右侧边栏'"
          align="end"
        >
          <button
            class="bar-btn"
            :class="{ on: layout.showPanel }"
            :aria-label="layout.showPanel ? '收起右侧边栏' : '展开右侧边栏'"
            :aria-expanded="layout.showPanel"
            @click="layout.showPanel = !layout.showPanel"
          >
            <PanelIcon side="right" :filled="layout.showPanel" class="bar-icon" />
          </button>
        </Tooltip>
      </div>
    </div>
  </header>
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
.bar-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
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
}
/* 未保存标记：紧贴工程名的小圆点 */
.name-dirty {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.name-meta {
  padding: 2px 7px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.3px;
  white-space: nowrap;
  flex: 0 0 auto;
}

/* ---- 右侧面板的标签区 ---- */
.bar-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  /* 顶栏右端始终是窗口右端：右内边距恒为 12px + 窗口按钮预留 */
  padding-right: calc(12px + var(--win-reserve));
}
.bar-tabs.has-panel {
  padding-left: 8px;
  border-left: 1px solid rgb(var(--md-outline-variant) / 0.4);
}
/* 设置 + 开关永远贴在这一段的最右 */
.tabs-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

/* MD3 图标按钮：圆形，无原生外观 */
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
