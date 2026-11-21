<script setup lang="ts">
/** 剧集播放到分叉结尾时的选项浮层：只有按钮，像互动游戏一样盖在画面底部。 */
import { computed } from "vue";
import { useI18n } from "@/i18n";
import type { SeriesOption } from "@/types/project";

const props = withDefaults(
  defineProps<{
    options: SeriesOption[];
    /** 画面宽度 / 基准宽度：按钮随预览画布缩放。 */
    scale?: number;
  }>(),
  { scale: 1 },
);

const emit = defineEmits<{ (e: "choose", edgeId: string): void }>();

const i18n = useI18n();

const rootStyle = computed(() => ({
  "--choice-scale": String(Math.max(0.8, Math.min(1.8, props.scale))),
}));

function labelOf(option: SeriesOption, index: number): string {
  return option.unnamed
    ? i18n.t("series.choice.unnamed", { index: index + 1 })
    : option.label;
}
</script>

<template>
  <div class="series-choices" :style="rootStyle" role="group" @pointerdown.stop @click.stop>
    <button
      v-for="(option, index) in props.options"
      :key="option.edgeId"
      type="button"
      class="series-choice"
      @click="emit('choose', option.edgeId)"
    >
      {{ labelOf(option, index) }}
    </button>
  </div>
</template>

<style scoped>
/* 没有外框 / 标题 / 副标题：就是画面底部一排按钮。 */
.series-choices {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 9%;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: calc(12px * var(--choice-scale));
  padding: 0 8%;
  pointer-events: none;
}
.series-choice {
  pointer-events: auto;
  min-width: calc(150px * var(--choice-scale));
  min-height: calc(44px * var(--choice-scale));
  padding: calc(8px * var(--choice-scale)) calc(24px * var(--choice-scale));
  border: 1px solid rgb(255 255 255 / 0.38);
  border-radius: 999px;
  background-color: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: calc(16px * var(--choice-scale));
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.series-choice:hover {
  background-color: rgb(var(--md-primary));
  border-color: transparent;
  transform: translateY(-1px);
}
.series-choice:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
</style>
