<script setup lang="ts">
/**
 * 应用外壳：标题栏（横跨整个窗口）+ 主体（[预览 / 时间线] | 右侧面板）。
 *
 * 标题栏里的标签栏宽度与右侧面板一致，视觉上连成一条竖线——这就是「标签页延伸到标题栏」。
 * macOS 保留原生红绿灯（Overlay 标题栏）；Windows / Linux 无边框，窗口按钮由前端自绘。
 */
import TopBar from "./TopBar.vue";
import WindowControls from "./WindowControls.vue";
import PanelResizer from "@/components/workspace/PanelResizer.vue";
import RightPanel from "@/components/workspace/RightPanel.vue";
import PreviewStage from "@/components/workspace/PreviewStage.vue";
import TimelinePane from "@/components/workspace/TimelinePane.vue";
import { useLayoutStore } from "@/stores/layout";
import { isLinux, isTauri, isWindows } from "@/utils/platform";

const layout = useLayoutStore();

/** 只有 Windows / Linux 需要自绘窗口按钮。 */
const showWindowControls = isTauri() && (isWindows() || isLinux());
</script>

<template>
  <div class="app-root" :class="{ win: showWindowControls }">
    <!-- 窗口按钮：固定在窗口右上角，独立于各栏布局 -->
    <WindowControls v-if="showWindowControls" class="win-layer" />

    <TopBar />

    <div class="app-row">
      <!-- 中：预览（上）+ 时间线（下） -->
      <main class="app-main">
        <PreviewStage />
        <PanelResizer side="bottom" @resize="layout.resizeTimeline" />
        <TimelinePane :style="{ height: `${layout.timelineHeight}px` }" />
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
  --win-reserve: 138px;
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
</style>
