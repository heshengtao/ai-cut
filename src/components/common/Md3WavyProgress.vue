<script setup lang="ts">
/**
 * M3 Expressive 波浪线性进度条：支持确定进度（0..1）与不确定流动波浪两种模式。
 * `prefers-reduced-motion: reduce` 下自动退化为平滑直线进度条。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { buildWavyProgressPaths } from "@/core/md3/shapes";

const props = withDefaults(
  defineProps<{
    /** 0..1；不传或为 null 时显示不确定流动进度。 */
    value?: number | null;
    label?: string;
    height?: number;
  }>(),
  { value: null, label: undefined, height: 12 },
);

const VIEW_WIDTH = 280;
const phase = ref(0);
const reduced = ref(false);
let rafId: number | null = null;

const isDeterminate = computed(
  () => typeof props.value === "number" && Number.isFinite(props.value),
);

const normalizedProgress = computed(() => {
  if (!isDeterminate.value) {
    // 不确定模式下，波浪段在 0.35..0.72 之间柔和呼吸。
    return reduced.value ? 0.45 : 0.5 + Math.sin(phase.value * 0.25) * 0.22;
  }
  return Math.min(1, Math.max(0, props.value as number));
});

const paths = computed(() =>
  buildWavyProgressPaths({
    width: VIEW_WIDTH,
    height: props.height,
    progress: normalizedProgress.value,
    phase: phase.value,
    amplitude: reduced.value ? 0 : Math.min(3, props.height * 0.22),
  }),
);

onMounted(() => {
  reduced.value =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced.value) return;

  const start = performance.now();
  const loop = (now: number) => {
    phase.value = ((now - start) / 1000) * 5.2;
    rafId = window.requestAnimationFrame(loop);
  };
  rafId = window.requestAnimationFrame(loop);
});

onUnmounted(() => {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
});
</script>

<template>
  <div
    class="m3-wavy"
    role="progressbar"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="isDeterminate ? Math.round(normalizedProgress * 100) : undefined"
  >
    <svg
      class="m3-wavy-svg"
      :style="{ height: `${height}px` }"
      :viewBox="`0 0 ${VIEW_WIDTH} ${height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        v-if="paths.inactivePath"
        class="m3-wavy-track"
        :d="paths.inactivePath"
      />
      <path
        v-if="paths.activePath"
        class="m3-wavy-active"
        :d="paths.activePath"
      />
    </svg>
  </div>
</template>

<style scoped>
.m3-wavy {
  width: 100%;
  display: flex;
  align-items: center;
}
.m3-wavy-svg {
  width: 100%;
  display: block;
  overflow: visible;
}
.m3-wavy-track {
  fill: none;
  stroke: rgb(var(--md-secondary-container));
  stroke-width: 3.5;
  stroke-linecap: round;
}
.m3-wavy-active {
  fill: none;
  stroke: rgb(var(--md-primary));
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
