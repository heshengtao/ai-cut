<script setup lang="ts">
/** 时间线标尺：按缩放生成刻度，点击/拖动定位播放头。 */
import { computed } from "vue";
import type { Marker, ReviewSeverity } from "@/types/project";
import { formatTimecode } from "@/core/time";

const SEVERITY_COLORS: Record<ReviewSeverity, string> = {
  blocker: "#d32f2f",
  high: "#f57c00",
  medium: "#f9a825",
  low: "#1976d2",
};

function markerColor(marker: Marker): string | undefined {
  if (marker.color) return marker.color;
  return marker.severity ? SEVERITY_COLORS[marker.severity] : undefined;
}

function markerTitle(marker: Marker): string {
  const prefix = marker.severity ? `[${marker.severity}] ` : "";
  const note = marker.note ? `\n${marker.note}` : "";
  const resolved = marker.resolved ? "\n✓" : "";
  return `${prefix}${marker.name}${note}${resolved}`;
}

const props = defineProps<{
  duration: number;
  pxPerSecond: number;
  fps: number;
  /** 播放头在内容坐标系里的 X（px）；用标尺自带的播放头帽保证纵向滚动时它不被卷走。 */
  playheadX?: number;
  markers?: Marker[];
}>();
const emit = defineEmits<{
  (e: "seek", seconds: number): void;
  (e: "rename-marker", marker: Marker): void;
  (e: "remove-marker", marker: Marker): void;
}>();

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
    <button
      v-for="marker in markers ?? []"
      :key="marker.id"
      class="marker"
      :style="{
        left: `${marker.time * pxPerSecond}px`,
        opacity: marker.resolved ? 0.45 : 1,
      }"
      :title="markerTitle(marker)"
      :aria-label="marker.name"
      @pointerdown.stop
      @click.stop="emit('seek', marker.time)"
      @dblclick.stop="emit('rename-marker', marker)"
      @contextmenu.prevent.stop="emit('remove-marker', marker)"
    >
      <span
        class="marker-pin"
        :style="markerColor(marker) ? { backgroundColor: markerColor(marker) } : undefined"
      />
      <span class="marker-name">{{ marker.name }}</span>
    </button>
    <span
      v-if="playheadX !== undefined && playheadX >= 0"
      class="ph-cap"
      :style="{ left: `${playheadX}px` }"
    />
  </div>
</template>

<style scoped>
.ruler {
  /* 纵向滚动时标尺锁在视口顶部；横向仍然跟随内容滚动。 */
  position: sticky;
  top: 0;
  z-index: 4;
  height: 28px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: rgb(var(--md-surface-container-low));
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
.marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 3;
}
.marker-pin {
  position: absolute;
  top: 0;
  left: -4px;
  width: 8px;
  height: 8px;
  border-radius: 2px 2px 6px 6px;
  background-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-surface-container-low));
}
.marker-name {
  position: absolute;
  top: 10px;
  left: 4px;
  display: none;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 3px;
  border-radius: 3px;
  background-color: rgb(var(--md-surface-container-highest) / 0.95);
  color: rgb(var(--md-on-surface));
  font-size: 9px;
  font-weight: 500;
}
.marker:hover .marker-name,
.marker:focus-visible .marker-name {
  display: block;
}
/* 播放头帽：属于标尺，纵向滚动时和刻度一起保持可见。 */
.ph-cap {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 10px;
  height: 12px;
  z-index: 2;
  background-color: rgb(var(--md-primary));
  border-radius: 0 0 3px 3px;
  clip-path: polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%);
  pointer-events: none;
}
</style>
