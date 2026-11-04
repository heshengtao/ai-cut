<script setup lang="ts">
/**
 * **mask 画布**：原图垫底，上面一层透明画布只画白色涂抹区域。
 *
 * 画布从不绘制原图，因此不会被 asset 协议的跨源图片污染，`toDataURL` 始终可用。
 * 导出时先铺黑底再叠白色笔画：sd.cpp 的约定是**白色 = 重绘**，黑色 = 保持。
 */
import { computed, ref, watch } from "vue";

const props = defineProps<{
  src: string;
  brush: number;
  erase: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "ready", size: { width: number; height: number }): void;
  (e: "dirty", value: boolean): void;
}>();

/** 画布长边上限：再大对 mask 精度没有意义，还会拖慢涂抹。 */
const MAX_SIDE = 1536;
const UNDO_LIMIT = 10;

const canvas = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
const dims = ref({ width: 16, height: 9 });
const ready = ref(false);
const dirty = ref(false);
const undoStack: string[] = [];

const aspect = computed(() => `${dims.value.width} / ${dims.value.height}`);

function context(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext("2d") ?? null;
}

/** 画布上是否还有白色/不透明像素。 */
function hasInk(): boolean {
  const el = canvas.value;
  const ctx = context();
  if (!el || !ctx || el.width === 0 || el.height === 0) return false;
  const data = ctx.getImageData(0, 0, el.width, el.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

function setDirty(value: boolean): void {
  if (dirty.value === value) return;
  dirty.value = value;
  emit("dirty", value);
}

function clearCanvas(): void {
  const el = canvas.value;
  const ctx = context();
  if (!el || !ctx) return;
  ctx.clearRect(0, 0, el.width, el.height);
}

function onImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement;
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;
  const scale = Math.min(1, MAX_SIDE / Math.max(naturalWidth, naturalHeight));
  dims.value = {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
  const el = canvas.value;
  if (el) {
    el.width = dims.value.width;
    el.height = dims.value.height;
  }
  undoStack.length = 0;
  clearCanvas();
  setDirty(false);
  ready.value = true;
  emit("ready", dims.value);
}

watch(
  () => props.src,
  () => {
    ready.value = false;
    undoStack.length = 0;
    clearCanvas();
    setDirty(false);
  },
);

let painting = false;
let last: { x: number; y: number } | null = null;

/** 屏幕坐标 → 画布像素坐标。 */
function pointOf(event: PointerEvent): { x: number; y: number } | null {
  const el = canvas.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((event.clientX - rect.left) * el.width) / rect.width,
    y: ((event.clientY - rect.top) * el.height) / rect.height,
  };
}

/** 笔刷粗细按显示尺寸换算到画布像素。 */
function widthOf(): number {
  const el = canvas.value;
  if (!el) return 1;
  const rect = el.getBoundingClientRect();
  const scale = rect.width > 0 ? el.width / rect.width : 1;
  return Math.max(1, props.brush * scale);
}

function paintStyle(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = props.erase ? "destination-out" : "source-over";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function dot(point: { x: number; y: number }): void {
  const ctx = context();
  if (!ctx) return;
  ctx.save();
  paintStyle(ctx);
  ctx.beginPath();
  ctx.arc(point.x, point.y, widthOf() / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled || !ready.value) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const el = canvas.value;
  const ctx = context();
  if (!el || !ctx) return;
  const point = pointOf(event);
  if (!point) return;
  event.preventDefault();
  el.setPointerCapture(event.pointerId);
  undoStack.push(el.toDataURL());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  painting = true;
  last = point;
  dot(point);
  setDirty(true);
}

function onPointerMove(event: PointerEvent): void {
  if (!painting || props.disabled) return;
  const point = pointOf(event);
  if (!point) return;
  const ctx = context();
  if (!ctx) return;
  event.preventDefault();
  ctx.save();
  paintStyle(ctx);
  ctx.lineWidth = widthOf();
  ctx.beginPath();
  if (last) {
    ctx.moveTo(last.x, last.y);
  } else {
    ctx.moveTo(point.x - 0.01, point.y);
  }
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.restore();
  last = point;
}

function onPointerUp(event: PointerEvent): void {
  if (!painting) return;
  painting = false;
  last = null;
  const el = canvas.value;
  if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  // 整笔都擦掉时 mask 应该回到「没涂」状态，而不是导出一张全黑 mask。
  setDirty(hasInk());
}

/** 清空涂抹区域。 */
function clear(): void {
  const el = canvas.value;
  if (!el) return;
  undoStack.push(el.toDataURL());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  clearCanvas();
  setDirty(false);
}

/** 撤销上一笔。 */
function undo(): void {
  const el = canvas.value;
  const ctx = context();
  const previous = undoStack.pop();
  if (!el || !ctx || !previous) return;
  const image = new Image();
  image.onload = () => {
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(image, 0, 0);
    setDirty(hasInk());
  };
  image.src = previous;
}

/** 导出 sd.cpp 需要的黑底白 mask；没有涂抹时返回 `null`（走整图重绘）。 */
function exportMask(): string | null {
  const el = canvas.value;
  if (!el || !dirty.value || el.width === 0 || el.height === 0) return null;
  const output = document.createElement("canvas");
  output.width = el.width;
  output.height = el.height;
  const ctx = output.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(el, 0, 0);
  return output.toDataURL("image/png");
}

defineExpose({ clear, undo, exportMask, isDirty: computed(() => dirty.value) });
</script>

<template>
  <div ref="stage" class="mask-stage" :style="{ aspectRatio: aspect }">
    <img class="mask-image" :src="src" alt="" draggable="false" @load="onImageLoad" />
    <canvas
      ref="canvas"
      class="mask-canvas"
      :class="{ disabled, erasing: erase }"
      role="img"
      aria-label="mask"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu.prevent
    />
    <span v-if="!ready" class="mask-loading">…</span>
  </div>
</template>

<style scoped>
.mask-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 10px;
  background: rgb(var(--md-surface-container-highest));
  box-shadow: inset 0 0 0 1px rgb(var(--md-outline-variant) / 0.6);
  user-select: none;
}
.mask-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
.mask-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  /* 只影响显示：白色涂抹半透明，导出时仍是纯白（sd.cpp 按 >0.5 判重绘）。 */
  opacity: 0.45;
  touch-action: none;
}
.mask-canvas.disabled {
  cursor: default;
  pointer-events: none;
}
.mask-canvas.erasing {
  cursor: cell;
}
.mask-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
}
</style>
