<script setup lang="ts">
/**
 * 主舞台：按顶栏视图切换「预览台 / 无限画布 / 剧集总览」。
 *
 * 只替换**预览台这一块**——右侧面板不受影响；时间线只属于预览界面，
 * 画布 / 剧集视图里由 AppShell 平滑收起，切回预览时恢复原来的显示 / 隐藏状态。
 *
 * 切换动效采用并行重叠的 M3 Shared Axis X（无 out-in 空白等待，不缩放重画布，
 * 全程纯 GPU translate3d + opacity），与顶栏 ViewSwitcher 胶囊方向保持一致。
 */
import { ref, watch } from "vue";
import PreviewStage from "./PreviewStage.vue";
import BoardView from "@/components/board/BoardView.vue";
import SeriesView from "@/components/series/SeriesView.vue";
import { useViewStore, type AppView } from "@/stores/view";

const VIEW_ORDER: Record<AppView, number> = {
  preview: 0,
  board: 1,
  series: 2,
};

const view = useViewStore();
const transitionName = ref<"stage-fwd" | "stage-back">("stage-fwd");

watch(
  () => view.view,
  (next, prev) => {
    if (!prev || next === prev) return;
    transitionName.value = VIEW_ORDER[next] >= VIEW_ORDER[prev] ? "stage-fwd" : "stage-back";
  },
);
</script>

<template>
  <div class="stage" :data-stage="view.view">
    <Transition :name="transitionName">
      <PreviewStage v-if="view.view === 'preview'" key="preview" class="stage-view" />
      <BoardView v-else-if="view.view === 'board'" key="board" class="stage-view" />
      <SeriesView v-else key="series" class="stage-view" />
    </Transition>
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
.stage-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* 并行重叠过渡：退场层绝对定位留在底层，入场层同步滑入，零空白闪烁。 */
.stage-fwd-enter-active,
.stage-back-enter-active {
  position: relative;
  z-index: 2;
  transition:
    opacity 220ms cubic-bezier(0.2, 0, 0, 1),
    transform 300ms cubic-bezier(0.05, 0.7, 0.1, 1);
  will-change: opacity, transform;
}
.stage-fwd-leave-active,
.stage-back-leave-active {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transition:
    opacity 160ms cubic-bezier(0.2, 0, 0, 1),
    transform 240ms cubic-bezier(0.2, 0, 0, 1);
  will-change: opacity, transform;
}

.stage-fwd-enter-from {
  opacity: 0;
  transform: translate3d(28px, 0, 0);
}
.stage-fwd-leave-to {
  opacity: 0;
  transform: translate3d(-20px, 0, 0);
}

.stage-back-enter-from {
  opacity: 0;
  transform: translate3d(-28px, 0, 0);
}
.stage-back-leave-to {
  opacity: 0;
  transform: translate3d(20px, 0, 0);
}

@media (prefers-reduced-motion: reduce) {
  .stage-fwd-enter-active,
  .stage-fwd-leave-active,
  .stage-back-enter-active,
  .stage-back-leave-active {
    transition-duration: 1ms;
  }
}
</style>
