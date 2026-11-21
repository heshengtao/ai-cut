<script setup lang="ts">
/**
 * 剧集连线：一条有向贝塞尔曲线；有选项名时在中间显示胶囊。
 *
 * 选中态由 SeriesGraph 通过 `data.active` 传进来（不依赖 Vue Flow 内部的 selected，
 * 因为边数组是随工程文档重建的）。
 */
import { computed } from "vue";
import { EdgeLabelRenderer, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const label = computed(() => {
  const value = (props.data as { label?: string } | undefined)?.label;
  return value ?? "";
});

const active = computed(() =>
  Boolean((props.data as { active?: boolean } | undefined)?.active),
);

const path = computed(() => {
  const gap = Math.abs(props.targetX - props.sourceX);
  const distance = Math.max(40, Math.min(160, gap * 0.55));
  return `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + distance} ${props.sourceY}, ${props.targetX - distance} ${props.targetY}, ${props.targetX} ${props.targetY}`;
});

const labelX = computed(() => (props.sourceX + props.targetX) / 2);
const labelY = computed(() => (props.sourceY + props.targetY) / 2);
</script>

<template>
  <g class="series-edge" :data-active="active ? 'true' : undefined">
    <path class="series-edge-line" :d="path" />
    <path class="series-edge-hit" :d="path" />
  </g>
  <EdgeLabelRenderer v-if="label">
    <div
      class="series-edge-label"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
    >
      {{ label }}
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.series-edge-line {
  fill: none;
  stroke: rgb(var(--md-outline) / 0.85);
  stroke-width: 1.6;
  stroke-linecap: round;
  transition: stroke 0.14s ease, stroke-width 0.14s ease;
}
.series-edge[data-active="true"] .series-edge-line {
  stroke: rgb(var(--md-primary));
  stroke-width: 2.6;
}
.series-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: pointer;
}
.series-edge-label {
  position: absolute;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container) / 0.95);
  pointer-events: none;
}
</style>
