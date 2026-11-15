<script setup lang="ts">
/**
 * 无限画布（骨架）。
 *
 * 本阶段只落地"视图可切换、主窗口不被时间线挤压"：点阵背景 + 工具栏占位 + 空态。
 * 画布内核（Vue Flow、节点、检查器、执行队列）在后续阶段填入本文件。
 */
import { computed } from "vue";
import {
  CursorArrowRaysIcon,
  PlusIcon,
  MinusIcon,
  SquaresPlusIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";

const i18n = useI18n();

const zoomLabel = computed(() => i18n.t("board.zoom", { value: 100 }));
</script>

<template>
  <section class="board-view" data-view="board">
    <div class="board-grid" aria-hidden="true" />

    <div class="board-empty">
      <div class="board-empty-mark" aria-hidden="true">
        <SquaresPlusIcon />
      </div>
      <h2 class="board-empty-title">{{ i18n.t("board.emptyTitle") }}</h2>
      <p class="board-empty-hint">{{ i18n.t("board.emptyHint") }}</p>
      <button class="board-empty-action" type="button" disabled>
        <PlusIcon class="board-empty-icon" />
        <span>{{ i18n.t("board.addNode") }}</span>
      </button>
    </div>

    <div class="board-toolbar" role="toolbar" :aria-label="i18n.t('board.toolbar')">
      <button class="board-tool" type="button" disabled :title="i18n.t('board.addNode')">
        <PlusIcon />
      </button>
      <button class="board-tool" type="button" disabled :title="i18n.t('board.pan')">
        <CursorArrowRaysIcon />
      </button>
      <span class="board-sep" aria-hidden="true" />
      <button class="board-tool" type="button" disabled :title="i18n.t('board.zoomOut')">
        <MinusIcon />
      </button>
      <span class="board-zoom">{{ zoomLabel }}</span>
    </div>
  </section>
</template>

<style scoped>
.board-view {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background-color: var(--app-inset);
}
/* 双层点阵：与 ai-board 同一套观感（细网格 22px / 粗网格 110px）。 */
.board-grid {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgb(var(--md-outline) / 0.55) 1px, transparent 1px),
    radial-gradient(rgb(var(--md-outline) / 0.35) 1.5px, transparent 1.5px);
  background-size: 22px 22px, 110px 110px;
  background-position: 0 0, 0 0;
}
.board-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
}
.board-empty-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.1);
}
.board-empty-mark :deep(svg) {
  width: 26px;
  height: 26px;
}
.board-empty-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.board-empty-hint {
  margin: 0;
  max-width: 420px;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.board-empty-action {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface-variant));
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  cursor: not-allowed;
}
.board-empty-icon {
  width: 16px;
  height: 16px;
}
/* 浮动工具栏：贴底部居中，与 ai-board 的位置一致。 */
.board-toolbar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.92);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
}
.board-tool {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: not-allowed;
  opacity: 0.6;
}
.board-tool :deep(svg) {
  width: 17px;
  height: 17px;
}
.board-sep {
  width: 1px;
  height: 16px;
  background-color: rgb(var(--md-outline-variant) / 0.6);
}
.board-zoom {
  padding: 0 6px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--md-on-surface-variant));
}
</style>
