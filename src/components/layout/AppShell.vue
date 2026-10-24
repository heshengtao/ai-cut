<script setup lang="ts">
/**
 * 应用外壳：标题栏（横跨整个窗口）+ 主体（[预览 / 时间线] | 右侧面板）。
 *
 * 标题栏里的标签栏宽度与右侧面板一致，视觉上连成一条竖线——这就是「标签页延伸到标题栏」。
 * macOS 保留原生红绿灯（Overlay 标题栏）；Windows / Linux 无边框，窗口按钮由前端自绘。
 */
import { computed } from "vue";
import TopBar from "./TopBar.vue";
import WindowControls from "./WindowControls.vue";
import PanelResizer from "@/components/workspace/PanelResizer.vue";
import RightPanel from "@/components/workspace/RightPanel.vue";
import PreviewStage from "@/components/workspace/PreviewStage.vue";
import TimelinePane from "@/components/workspace/TimelinePane.vue";
import SettingsView from "@/components/settings/SettingsView.vue";
import { useLayoutStore } from "@/stores/layout";
import { isLinux, isTauri, isWindows } from "@/utils/platform";

const layout = useLayoutStore();

/** 竖屏时间线：面板打开时用持久化高度；只显示时间线时铺满右栏。 */
const portraitTimelineStyle = computed(() => {
  if (layout.showPanel) {
    return { height: `${layout.timelineHeight}px`, flex: "0 0 auto", minHeight: "120px" };
  }
  return { flex: "1 1 auto", minHeight: "0" };
});

/** 只有 Windows / Linux 需要自绘窗口按钮。 */
const showWindowControls = isTauri() && (isWindows() || isLinux());
</script>

<template>
  <div class="app-root" :class="{ win: showWindowControls }">
    <!-- 窗口按钮：固定在窗口右上角，独立于各栏布局 -->
    <WindowControls v-if="showWindowControls" class="win-layer" />

    <TopBar />

    <div v-if="layout.settingsOpen" class="settings-main">
      <SettingsView />
    </div>

    <!-- 竖屏：左侧预览（可拖动），右侧上下分栏（上：标签页面板，下：时间线） -->
    <div v-else-if="layout.layoutMode === 'portrait'" class="app-row portrait">
      <main class="portrait-preview" :style="{ flexBasis: `${layout.previewRatio * 100}%` }">
        <PreviewStage />
      </main>

      <PanelResizer side="left" @resize="layout.resizePreview" />

      <div class="portrait-stack">
        <div v-if="layout.showPanel" class="portrait-panel-wrap">
          <RightPanel :style="{ flex: '1 1 auto', width: '100%', height: 'auto', minHeight: 0 }" />
        </div>

        <template v-if="layout.showPanel && layout.showTimeline">
          <PanelResizer side="bottom" @resize="layout.resizeTimeline" />
        </template>

        <TimelinePane v-if="layout.showTimeline" :style="portraitTimelineStyle" />
      </div>
    </div>

    <div v-else class="app-row">
      <!-- 中：预览（上）+ 时间线（下） -->
      <main class="app-main">
        <PreviewStage />
        <template v-if="layout.showTimeline">
          <PanelResizer side="bottom" @resize="layout.resizeTimeline" />
          <TimelinePane :style="{ height: `${layout.timelineHeight}px` }" />
        </template>
      </main>

      <!-- 右：标签页面板（全高，标签栏在顶栏里） -->
      <template v-if="layout.showPanel">
        <PanelResizer side="right" @resize="layout.resizePanel" />
        <RightPanel :style="{ width: `${layout.panelWidth}px` }" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background-color: var(--app-bg);
  color: rgb(var(--md-on-surface));
  /* 窗口按钮占位宽度：由 .win 打开 */
  --win-reserve: 0px;
}
.app-root.win {
  /* 三个 34px 圆形按钮 + 两个 1px 间距 + 右侧 12px 内边距 */
  --win-reserve: 116px;
}
/* 窗口按钮层：贴窗口右上角，压在所有面板之上 */
.win-layer {
  position: absolute;
  top: 0;
  right: 0;
  height: 52px;
  z-index: 60;
}
.app-row {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.settings-main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
}
.app-main {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--app-card);
}
/* 竖屏左栏：宽度由 previewRatio 控制，拖动分隔线时更新 */
.portrait-preview {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  overflow: hidden;
  background-color: var(--app-inset);
}
/* 竖屏右栏：上下分栏——上面是标签页面板，下面是时间线 */
.portrait-stack {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.portrait-panel-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
</style>
