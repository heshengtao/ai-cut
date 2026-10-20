<script setup lang="ts">
/**
 * 音频音量图：按素材内时间采样真实峰值，画成 **离散的圆角音量柱**。
 * 与连续波形不同，柱子的间距 / 宽度固定，缩放和裁剪只改变可见的柱子数量，不会把图形拉扁。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { peakBetween } from "@/core/waveform";

const props = defineProps<{
  /** 整段素材的峰值（0..100）。 */
  peaks: number[];
  /** 素材总时长（秒）。 */
  sourceDuration: number;
  /** 片段在素材内的入点（秒）。 */
  inPoint: number;
  /** 片段时长（秒）。 */
  duration: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let observer: ResizeObserver | null = null;

/** 单块 canvas 的最大像素宽度，避免超长时间线生成超大画布。 */
const MAX_CANVAS_WIDTH = 4096;
/** 柱间距 / 柱宽（CSS px），不随缩放变化。 */
const BAR_PITCH = 4;
const BAR_WIDTH = 2;

function draw(): void {
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cssWidth = rect.width;
  const cssHeight = rect.height;
  if (cssWidth < 1 || cssHeight < 1) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.min(MAX_CANVAS_WIDTH, Math.max(1, Math.round(cssWidth * dpr)));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (el.width !== width) el.width = width;
  if (el.height !== height) el.height = height;

  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const { peaks, sourceDuration, inPoint, duration } = props;
  if (peaks.length === 0 || !(sourceDuration > 0) || !(duration > 0)) return;

  // 片段只在素材的有效区间里取音量。
  const from = Math.max(0, inPoint);
  const to = Math.min(sourceDuration, inPoint + duration);
  if (!(to > from)) return;

  ctx.fillStyle = getComputedStyle(el).color || "#fff";
  const mid = height / 2;
  const maxAmp = mid * 0.92;
  const span = to - from;

  // 柱子数量按 **CSS 宽度**决定，保证缩放时柱距不变（不拉伸）。
  const count = Math.max(1, Math.min(4096, Math.floor(cssWidth / BAR_PITCH)));
  // 画布可能因宽度上限被压缩，按比例换算回内部坐标。
  const slot = width / count;
  const barWidth = Math.max(1, slot * (BAR_WIDTH / BAR_PITCH));

  for (let i = 0; i < count; i += 1) {
    const t0 = from + (i / count) * span;
    const t1 = from + ((i + 1) / count) * span;
    const peak = peakBetween(peaks, sourceDuration, t0, t1);
    // 柱高跟随真实音量；静音时保留 1px 细线。
    const amp = Math.max(barWidth * 0.5, (peak / 100) * maxAmp);
    const x = i * slot + (slot - barWidth) / 2;
    const y = mid - amp;

    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, barWidth, amp * 2, barWidth / 2);
    } else {
      ctx.rect(x, y, barWidth, amp * 2);
    }
    ctx.fill();
  }
}

watch(
  () => [props.peaks, props.sourceDuration, props.inPoint, props.duration],
  draw,
  { flush: "post" },
);

onMounted(() => {
  observer = new ResizeObserver(draw);
  if (canvas.value) observer.observe(canvas.value);
  draw();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <canvas ref="canvas" class="clip-waveform" aria-hidden="true" />
</template>

<style scoped>
.clip-waveform {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
