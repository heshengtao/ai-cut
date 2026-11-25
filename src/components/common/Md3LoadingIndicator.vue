<script setup lang="ts">
/**
 * M3 Expressive 变形几何加载器：在 8 瓣扇贝 / 四叶草 / 六瓣花 / 圆角方之间平滑变形旋转。
 * `prefers-reduced-motion: reduce` 下保持静态几何体，不启动 rAF。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { buildMorphPolygonPath, sampleMorphLoaderPath } from "@/core/md3/shapes";

const props = withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
    contained?: boolean;
    label?: string;
  }>(),
  { size: "md", contained: true, label: undefined },
);

const pathD = ref(buildMorphPolygonPath(8, 20, 15.5, 0));
let rafId: number | null = null;

const boxPx = computed(() => (props.size === "sm" ? 22 : props.size === "lg" ? 48 : 34));
const svgPx = computed(() => (props.size === "sm" ? 15 : props.size === "lg" ? 30 : 22));

onMounted(() => {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  const start = performance.now();
  const loop = (now: number) => {
    pathD.value = sampleMorphLoaderPath((now - start) / 1000);
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
  <span
    class="m3-loader"
    :class="{ contained }"
    :style="{ width: `${boxPx}px`, height: `${boxPx}px` }"
    role="progressbar"
    :aria-label="label"
  >
    <svg
      class="m3-loader-svg"
      :style="{ width: `${svgPx}px`, height: `${svgPx}px` }"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path :d="pathD" fill="currentColor" />
    </svg>
  </span>
</template>

<style scoped>
.m3-loader {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 999px;
  color: rgb(var(--md-primary));
}
.m3-loader.contained {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
}
.m3-loader-svg {
  display: block;
  animation: m3-loader-spin 4.4s linear infinite;
}
@keyframes m3-loader-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .m3-loader-svg {
    animation: none;
  }
}
</style>
