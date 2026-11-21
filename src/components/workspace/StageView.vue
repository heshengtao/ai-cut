<script setup lang="ts">
/**
 * 主舞台：按顶栏视图切换「预览台 / 无限画布 / 剧集总览」。
 *
 * 只替换**预览台这一块**——右侧面板不受影响；时间线只属于预览界面，
 * 画布 / 剧集视图里由 AppShell 隐藏，切回预览时恢复原来的显示 / 隐藏状态。
 */
import PreviewStage from "./PreviewStage.vue";
import BoardView from "@/components/board/BoardView.vue";
import SeriesView from "@/components/series/SeriesView.vue";
import { useViewStore } from "@/stores/view";

const view = useViewStore();
</script>

<template>
  <div class="stage" :data-stage="view.view">
    <PreviewStage v-if="view.view === 'preview'" />
    <BoardView v-else-if="view.view === 'board'" />
    <SeriesView v-else />
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
}
.stage > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
