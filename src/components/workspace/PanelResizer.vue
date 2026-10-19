<script setup lang="ts">
/**
 * 面板之间的可拖拽分隔线：1px 细线，命中区向两侧扩 4px（不占布局宽度）。
 *
 * `side` 指分隔线相邻、尺寸会随拖动变化的那一侧：
 * - `left` / `right`：竖直分隔线，按 X 轴发出增量；
 * - `top` / `bottom`：水平分隔线，按 Y 轴发出增量。
 *
 * 发出的增量一律是「该侧变大」为正。
 */
import { computed, onMounted, onUnmounted } from "vue";

const props = defineProps<{ side: "left" | "right" | "top" | "bottom" }>();
const emit = defineEmits<{ (e: "resize", delta: number): void }>();

const horizontal = computed(() => props.side === "top" || props.side === "bottom");

let dragging = false;
let startX = 0;
let startY = 0;

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
}

function onMove(e: PointerEvent): void {
  if (!dragging) return;
  if (horizontal.value) {
    const delta = e.clientY - startY;
    if (delta === 0) return;
    startY = e.clientY;
    // `top` 的面板在分隔线上方：往下拖变大；`bottom` 反之。
    emit("resize", props.side === "top" ? delta : -delta);
    return;
  }
  const delta = e.clientX - startX;
  if (delta === 0) return;
  startX = e.clientX;
  emit("resize", props.side === "left" ? delta : -delta);
}

function onUp(): void {
  if (!dragging) return;
  dragging = false;
}

onMounted(() => {
  // 指针可能在分隔线之外移动 / 松开：移动与收尾都挂在 window 上，
  // 不依赖 `setPointerCapture`（某些环境里捕获会失败）。
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
});
onUnmounted(() => {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
});
</script>

<template>
  <div
    class="panel-resizer"
    :class="{ horizontal, dragging }"
    role="separator"
    :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
    @pointerdown="onDown"
  />
</template>

<style scoped>
.panel-resizer {
  position: relative;
  flex: 0 0 auto;
  width: 1px;
  align-self: stretch;
  background-color: rgb(var(--md-outline-variant) / 0.4);
  cursor: col-resize;
  touch-action: none;
  transition: background-color 0.15s ease;
}
.panel-resizer.horizontal {
  width: 100%;
  height: 1px;
  align-self: auto;
  cursor: row-resize;
}
/* 命中区向两侧各扩 4px：不占布局宽度，但更容易抓 */
.panel-resizer::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}
.panel-resizer.horizontal::before {
  top: -4px;
  bottom: -4px;
  left: 0;
  right: 0;
}
.panel-resizer:hover,
.panel-resizer.dragging {
  background-color: rgb(var(--md-primary) / 0.85);
}
</style>
