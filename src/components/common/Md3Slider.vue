<script setup lang="ts">
/**
 * MD3 滑块：完全自绘（轨道 + 手柄 + 状态层），支持指针拖拽与键盘。
 * 与 ai-daw 的同名组件保持同一套尺寸与交互。
 */
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    disabled?: boolean;
  }>(),
  { min: 0, max: 100, step: 1, disabled: false },
);
const emit = defineEmits<{ (e: "update:modelValue", v: number): void }>();

const root = ref<HTMLElement | null>(null);
const dragging = ref(false);

const ratio = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (props.modelValue - props.min) / span));
});

function quantize(value: number): number {
  const stepped = Math.round((value - props.min) / props.step) * props.step + props.min;
  return Number(stepped.toFixed(6));
}

function emitValue(value: number): void {
  const next = Math.min(props.max, Math.max(props.min, quantize(value)));
  if (next !== props.modelValue) emit("update:modelValue", next);
}

function valueFromClientX(clientX: number): void {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  emitValue(props.min + r * (props.max - props.min));
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return;
  dragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  valueFromClientX(event.clientX);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  valueFromClientX(event.clientX);
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
}

function onKey(event: KeyboardEvent): void {
  if (props.disabled) return;
  const big = props.step * 10;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      next = props.modelValue + props.step;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = props.modelValue - props.step;
      break;
    case "PageUp":
      next = props.modelValue + big;
      break;
    case "PageDown":
      next = props.modelValue - big;
      break;
    case "Home":
      next = props.min;
      break;
    case "End":
      next = props.max;
      break;
    default:
      return;
  }
  event.preventDefault();
  emitValue(next);
}
</script>

<template>
  <div
    ref="root"
    class="slider"
    :class="{ disabled, dragging }"
    role="slider"
    :tabindex="disabled ? -1 : 0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-disabled="disabled || undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKey"
  >
    <span class="track" aria-hidden="true" />
    <span class="fill" :style="{ width: `${ratio * 100}%` }" aria-hidden="true" />
    <span class="thumb" :style="{ left: `${ratio * 100}%` }" aria-hidden="true" />
  </div>
</template>

<style scoped>
.slider {
  position: relative;
  height: 32px;
  width: 200px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  outline: none;
}
.slider.disabled {
  opacity: 0.45;
  cursor: default;
}
.track {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.thumb {
  position: absolute;
  width: 18px;
  height: 18px;
  margin-left: -9px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  box-shadow: var(--md-elevation-1);
  transition: transform 0.14s ease;
}
.slider:hover .thumb,
.slider.dragging .thumb {
  transform: scale(1.12);
}
.slider:focus-visible .thumb {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .thumb {
    transition: none;
  }
}
</style>
