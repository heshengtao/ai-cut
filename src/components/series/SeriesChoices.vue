<script setup lang="ts">
/** 剧集播放到分叉结尾时的选项浮层（叠在预览画面底部）。 */
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import type { SeriesOption } from "@/types/project";

const props = defineProps<{ options: SeriesOption[] }>();
const emit = defineEmits<{ (e: "choose", edgeId: string): void }>();

const i18n = useI18n();
const project = useProjectStore();

function nameOf(id: string): string {
  return project.doc.episodes.find((episode) => episode.id === id)?.name ?? "";
}

function labelOf(option: SeriesOption, index: number): string {
  return option.unnamed
    ? i18n.t("series.choice.unnamed", { index: index + 1 })
    : option.label;
}
</script>

<template>
  <div
    class="series-choices"
    role="group"
    :aria-label="i18n.t('series.choices.title')"
    @pointerdown.stop
    @click.stop
  >
    <p class="series-choices-title">{{ i18n.t("series.choices.title") }}</p>
    <div class="series-choices-list">
      <button
        v-for="(option, index) in props.options"
        :key="option.edgeId"
        type="button"
        class="series-choice"
        @click="emit('choose', option.edgeId)"
      >
        <span class="series-choice-label">{{ labelOf(option, index) }}</span>
        <span class="series-choice-target">{{ nameOf(option.to) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.series-choices {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 6;
  width: min(420px, calc(100% - 32px));
  max-height: 46%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container-high) / 0.96);
  box-shadow: var(--md-elevation-2);
  backdrop-filter: blur(10px);
}
.series-choices-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-variant));
  text-align: center;
}
.series-choices-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.series-choice {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  border-radius: 10px;
  background-color: rgb(var(--md-surface-container-low));
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.series-choice:hover {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.08);
}
.series-choice-label {
  font-weight: 600;
}
.series-choice-target {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
