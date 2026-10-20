<script setup lang="ts">
/** 时间线标尺：按缩放生成刻度，点击/拖动定位播放头。 */
import { computed } from "vue";
import { formatTimecode } from "@/core/time";

const props = defineProps<{ duration: number; pxPerSecond: number; fps: number }>();
const emit = defineEmits<{ (e: "seek", seconds: number): void }>();

/** 刻度间隔：随缩放自适应，取 1/2/5/10/30/60 秒里最合适的一档。 */
const step = computed(() => {
  const targetPx = 72;
  const candidates = [0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  return candidates.find((s) => s * props.pxPerSecond >= targetPx) ?? 600;
});

const ticks = computed(() => {
  const count = Math.ceil(props.duration / step.value) + 1;
  return Array.from({ length: count }, (_, i) => {
    const seconds = i * step.value;
    return { seconds, x: seconds * props.pxPerSecond, label: formatTimecode(seconds, props.fps) };
  });
});

function seekFromEvent(event: PointerEvent): void {
  const host = event.currentTarget as HTMLElement;
  const x = event.clientX - host.getBoundingClientRect().left;
  emit("seek", Math.max(0, x / props.pxPerSecond));
}
</script>

<template>
  <div class="ruler" @pointerdown="seekFromEvent" @pointermove="($event.buttons & 1) === 1 && seekFromEvent($event)">
    <div v-for="tick in ticks" :key="tick.seconds" class="tick" :style="{ left: `${tick.x}px` }">
      <span class="tick-label tabular">{{ tick.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.ruler {
  position: relative;
  height: 28px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: rgb(var(--md-surface-container-low) / 0.5);
  cursor: pointer;
  user-select: none;
  touch-action: none;
}
.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgb(var(--md-outline) / 0.4);
}
.tick-label {
  position: absolute;
  top: 5px;
  left: 3px;
  font-size: 9.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface-muted));
  white-space: nowrap;
}
</style>
