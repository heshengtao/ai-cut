<script setup lang="ts">
/**
 * 画布连线：ai-board 的「渐变主曲线 + 主题色辉光 + 流动亮色虚线 + 两端圆点」。
 *
 * 贝塞尔控制点按两端口水平距离收放，短距离不会出现回勾；交互路径单独加宽，
 * 选中 / 右键仍交给 Vue Flow 的 edge wrapper。
 */
import { computed, useId } from "vue";
import type { EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const gradientId = `flow-edge-${String(useId()).replace(/[^a-zA-Z0-9_-]/g, "")}`;

/** 循环开始 / 结束之间的配对线（不参与数据流，用虚线区分）。 */
const isPair = computed(() => Boolean((props.data as { pair?: boolean } | undefined)?.pair));

const path = computed(() => {
  const { sourceX, sourceY, targetX, targetY } = props;
  const gap = Math.abs(targetX - sourceX);
  const distance = Math.max(36, Math.min(170, gap * 0.58));
  return `M ${sourceX} ${sourceY} C ${sourceX + distance} ${sourceY}, ${targetX - distance} ${targetY}, ${targetX} ${targetY}`;
});
</script>

<template>
  <g
    class="flow-edge"
    :data-selected="selected ? 'true' : undefined"
    :data-pair="isPair ? 'true' : undefined"
  >
    <defs>
      <linearGradient
        :id="gradientId"
        gradientUnits="userSpaceOnUse"
        :x1="sourceX"
        :y1="sourceY"
        :x2="targetX"
        :y2="targetY"
      >
        <stop offset="0%" class="flow-edge-stop-primary" />
        <stop offset="100%" class="flow-edge-stop-tertiary" />
      </linearGradient>
    </defs>
    <path class="flow-edge-glow" :d="path" />
    <path class="flow-edge-core" :d="path" :stroke="`url(#${gradientId})`" />
    <path class="flow-edge-flow" :d="path" />
    <circle class="flow-edge-dot" :cx="sourceX" :cy="sourceY" r="3.4" />
    <circle class="flow-edge-dot" :cx="targetX" :cy="targetY" r="3.4" />
    <path class="flow-edge-interaction" :d="path" />
  </g>
</template>

<style scoped>
/* 循环开始 / 结束的配对线：虚线，和不参与数据流这件事一致。 */
.flow-edge[data-pair="true"] .flow-edge-core {
  stroke-dasharray: 7 6;
  opacity: 0.7;
}

.flow-edge[data-pair="true"] .flow-edge-flow {
  display: none;
}

.flow-edge[data-pair="true"] .flow-edge-glow {
  opacity: 0.1;
}

.flow-edge-glow {
  fill: none;
  stroke: rgb(var(--md-primary));
  stroke-width: 13;
  opacity: 0.2;
  filter: blur(3.2px);
  pointer-events: none;
  animation: board-edge-glow 3.2s ease-in-out infinite;
}
.flow-edge-core {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px rgb(var(--md-primary) / 0.62));
  pointer-events: none;
  transition: stroke-width 0.14s ease, filter 0.14s ease;
}
.flow-edge-flow {
  fill: none;
  stroke: rgb(255 255 255 / 0.9);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-dasharray: 2 14;
  opacity: 0.85;
  pointer-events: none;
  animation: board-edge-flow 1.5s linear infinite;
}
.flow-edge-dot {
  fill: rgb(var(--md-primary));
  stroke: rgb(var(--md-surface) / 0.9);
  stroke-width: 1.4;
  filter: drop-shadow(0 0 5px rgb(var(--md-primary) / 0.8));
  pointer-events: none;
}
.flow-edge-interaction {
  fill: none;
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: pointer;
}
.flow-edge-stop-primary {
  stop-color: rgb(var(--md-primary));
}
.flow-edge-stop-tertiary {
  stop-color: rgb(var(--md-tertiary));
}
.flow-edge:hover .flow-edge-core {
  stroke-width: 3.6;
  filter: drop-shadow(0 0 7px rgb(var(--md-primary) / 0.75));
}
.flow-edge[data-selected="true"] .flow-edge-core {
  stroke-width: 3.8;
  filter: drop-shadow(0 0 9px rgb(var(--md-primary) / 0.85));
}
.flow-edge[data-selected="true"] /* 循环开始 / 结束的配对线：虚线，和不参与数据流这件事一致。 */
.flow-edge[data-pair="true"] .flow-edge-core {
  stroke-dasharray: 7 6;
  opacity: 0.7;
}

.flow-edge[data-pair="true"] .flow-edge-flow {
  display: none;
}

.flow-edge[data-pair="true"] .flow-edge-glow {
  opacity: 0.1;
}

.flow-edge-glow {
  opacity: 0.34;
}
.flow-edge[data-selected="true"] .flow-edge-dot {
  r: 4.2px;
}
@keyframes board-edge-flow {
  to {
    stroke-dashoffset: -32;
  }
}
@keyframes board-edge-glow {
  0%,
  100% {
    opacity: 0.13;
  }
  50% {
    opacity: 0.26;
  }
}
@media (prefers-reduced-motion: reduce) {
  .flow-edge-flow,
  /* 循环开始 / 结束的配对线：虚线，和不参与数据流这件事一致。 */
.flow-edge[data-pair="true"] .flow-edge-core {
  stroke-dasharray: 7 6;
  opacity: 0.7;
}

.flow-edge[data-pair="true"] .flow-edge-flow {
  display: none;
}

.flow-edge[data-pair="true"] .flow-edge-glow {
  opacity: 0.1;
}

.flow-edge-glow {
    animation: none;
  }
}
</style>
