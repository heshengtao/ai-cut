<script setup lang="ts">
/**
 * 主舞台：按顶栏视图切换「预览台 / 无限画布 / 剧集总览」。
 *
 * 只替换**预览台这一块**——右侧面板不受影响；时间线只属于预览界面，
 * 画布 / 剧集视图里由 AppShell 隐藏，切回预览时恢复原来的显示 / 隐藏状态。
 *
 * 切换动效采用 M3 Shared Axis X：按视图顺序（预览 0 → 画布 1 → 剧集 2）自动决定
 * 水平滑入方向，与顶栏 ViewSwitcher 滑动胶囊方向保持一致。
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
    <Transition :name="transitionName" mode="out-in">
      <PreviewStage v-if="view.view === 'preview'" key="preview" />
      <BoardView v-else-if="view.view === 'board'" key="board" />
      <SeriesView v-else key="series" />
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
.stage > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.stage-fwd-enter-active,
.stage-back-enter-active {
  transition:
    opacity var(--md-dur-effects-default) var(--md-spring-effects-default),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-default);
  will-change: opacity, transform;
}
.stage-fwd-leave-active,
.stage-back-leave-active {
  transition:
    opacity 90ms var(--md-spring-effects-fast),
    transform 90ms var(--md-spring-effects-fast);
  will-change: opacity, transform;
}
.stage-fwd-enter-from {
  opacity: 0;
  transform: translateX(22px) scale(0.988);
}
.stage-fwd-leave-to {
  opacity: 0;
  transform: translateX(-14px) scale(0.992);
}
.stage-back-enter-from {
  opacity: 0;
  transform: translateX(-22px) scale(0.988);
}
.stage-back-leave-to {
  opacity: 0;
  transform: translateX(14px) scale(0.992);
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
