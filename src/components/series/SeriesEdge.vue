<script setup lang="ts">
/**
 * 剧集连线：对齐画布的「渐变主曲线 + 主题色辉光 + 流动亮色虚线 + 两端圆点」。
 *
 * 有选项名时在中间显示胶囊。选中态由 SeriesGraph 通过 `data.active` 传进来
 * （不依赖 Vue Flow 内部的 selected，因为边数组是随工程文档重建的）。
 */
import { computed, useId } from "vue";
import { EdgeLabelRenderer, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const gradientId = `series-edge-${String(useId()).replace(/[^a-zA-Z0-9_-]/g, "")}`;

const label = computed(() => {
  const value = (props.data as { label?: string } | undefined)?.label;
  return value ?? "";
});

const active = computed(() =>
  Boolean((props.data as { active?: boolean } | undefined)?.active),
);

const path = computed(() => {
  const gap = Math.abs(props.targetX - props.sourceX);
  const distance = Math.max(36, Math.min(170, gap * 0.58));
  return `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + distance} ${props.sourceY}, ${props.targetX - distance} ${props.targetY}, ${props.targetX} ${props.targetY}`;
});

const labelX = computed(() => (props.sourceX + props.targetX) / 2);
const labelY = computed(() => (props.sourceY + props.targetY) / 2);
</script>

<template>
  <g class="series-edge" :data-active="active ? 'true' : undefined">
    <defs>
      <linearGradient
        :id="gradientId"
        gradientUnits="userSpaceOnUse"
        :x1="sourceX"
        :y1="sourceY"
        :x2="targetX"
        :y2="targetY"
      >
        <stop offset="0%" class="series-edge-stop-primary" />
        <stop offset="100%" class="series-edge-stop-tertiary" />
      </linearGradient>
    </defs>
    <path class="series-edge-glow" :d="path" />
    <path class="series-edge-core" :d="path" :stroke="`url(#${gradientId})`" />
    <path class="series-edge-flow" :d="path" />
    <circle class="series-edge-dot" :cx="sourceX" :cy="sourceY" r="3.4" />
    <circle class="series-edge-dot" :cx="targetX" :cy="targetY" r="3.4" />
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
.series-edge-glow {
  fill: none;
  stroke: rgb(var(--md-primary));
  stroke-width: 13;
  opacity: 0.2;
  filter: blur(3.2px);
  pointer-events: none;
  animation: series-edge-glow 3.2s ease-in-out infinite;
}
.series-edge-core {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px rgb(var(--md-primary) / 0.62));
  pointer-events: none;
  transition: stroke-width 0.14s ease, filter 0.14s ease;
}
.series-edge-flow {
  fill: none;
  stroke: rgb(255 255 255 / 0.9);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-dasharray: 2 14;
  opacity: 0.85;
  pointer-events: none;
  animation: series-edge-flow 1.5s linear infinite;
}
.series-edge-dot {
  fill: rgb(var(--md-primary));
  stroke: rgb(var(--md-surface) / 0.9);
  stroke-width: 1.4;
  filter: drop-shadow(0 0 5px rgb(var(--md-primary) / 0.8));
  pointer-events: none;
}
.series-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: pointer;
}
.series-edge-stop-primary {
  stop-color: rgb(var(--md-primary));
}
.series-edge-stop-tertiary {
  stop-color: rgb(var(--md-tertiary));
}
.series-edge:hover .series-edge-core {
  stroke-width: 3.6;
  filter: drop-shadow(0 0 7px rgb(var(--md-primary) / 0.75));
}
.series-edge[data-active="true"] .series-edge-core {
  stroke-width: 3.8;
  filter: drop-shadow(0 0 9px rgb(var(--md-primary) / 0.85));
}
.series-edge[data-active="true"] .series-edge-glow {
  opacity: 0.34;
}
.series-edge[data-active="true"] .series-edge-dot {
  r: 4.2px;
}
.series-edge-label {
  position: absolute;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container) / 0.95);
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  pointer-events: none;
}
@keyframes series-edge-flow {
  to {
    stroke-dashoffset: -32;
  }
}
@keyframes series-edge-glow {
  0%,
  100% {
    opacity: 0.13;
  }
  50% {
    opacity: 0.26;
  }
}
@media (prefers-reduced-motion: reduce) {
  .series-edge-flow,
  .series-edge-glow {
    animation: none;
  }
}
</style>
