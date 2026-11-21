<script setup lang="ts">
/**
 * 剧集播放到分叉结尾时的选项浮层：只有按钮，像互动游戏一样盖在画面底部。
 *
 * 排布规则：
 * - 1–3 个：先试一排占满；放不下（按钮最小宽度装不下）就自动换行。
 * - 4 个：2×2。
 * - 5 个：3+2。
 * - 6 个：3×2。
 * - 更多：一行 4 个。
 */
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

const count = computed(() => props.options.length);
const fixed = computed(() => count.value >= 4);

const rootStyle = computed(() => {
  const scale = Math.max(0.8, Math.min(1.8, props.scale));
  const basis =
    count.value >= 7
      ? "calc((100% - var(--choice-gap) * 3) / 4)"
      : count.value >= 5
        ? "calc((100% - var(--choice-gap) * 2) / 3)"
        : "calc((100% - var(--choice-gap)) / 2)";
  const maxWidth =
    count.value <= 1 ? "46%" : count.value === 2 ? "80%" : "100%";
  return {
    "--choice-scale": String(scale),
    "--choice-basis": basis,
    "max-width": maxWidth,
  };
});

function labelOf(option: SeriesOption, index: number): string {
  return option.unnamed
    ? i18n.t("series.choice.unnamed", { index: index + 1 })
    : option.label;
}
</script>

<template>
  <div
    class="series-choices"
    :class="{ fixed: fixed }"
    :style="rootStyle"
    role="group"
    @pointerdown.stop
    @click.stop
  >
    <button
      v-for="(option, index) in props.options"
      :key="option.edgeId"
      type="button"
      class="series-choice"
      :title="labelOf(option, index)"
      @click="emit('choose', option.edgeId)"
    >
      {{ labelOf(option, index) }}
    </button>
  </div>
</template>

<style scoped>
/* 没有外框 / 标题 / 副标题：就是画面底部一排按钮。 */
.series-choices {
  --choice-gap: calc(12px * var(--choice-scale));
  position: absolute;
  left: 0;
  right: 0;
  bottom: 9%;
  z-index: 30;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: center;
  gap: var(--choice-gap);
  padding: 0 8%;
  pointer-events: none;
}
.series-choice {
  pointer-events: auto;
  /* 1–3 个：先按内容宽度并排，能占满就占满；装不下由 flex-wrap 换行。
     `min-content` 保证按钮不会被压到截断文字，而是整行换行。 */
  flex: 1 1 auto;
  min-width: max(calc(150px * var(--choice-scale)), min-content);
  max-width: 100%;
  min-height: calc(44px * var(--choice-scale));
  padding: calc(8px * var(--choice-scale)) calc(24px * var(--choice-scale));
  border: 1px solid rgb(255 255 255 / 0.38);
  border-radius: 999px;
  background-color: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: calc(16px * var(--choice-scale));
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
/* 4 个以上：按固定列宽排（4=2×2，5=3+2，6=3×2，更多=4 列）。 */
.series-choices.fixed .series-choice {
  flex: 0 0 var(--choice-basis);
  min-width: 0;
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
