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
    /** 浮起数值气泡的格式化函数；缺省直接展示数字。 */
    formatValue?: (value: number) => string;
    /** 是否在悬停/拖拽时显示 M3 浮起数值气泡。 */
    showBubble?: boolean;
  }>(),
  { min: 0, max: 100, step: 1, disabled: false, formatValue: undefined, showBubble: true },
);
const emit = defineEmits<{ (e: "update:modelValue", v: number): void }>();

const root = ref<HTMLElement | null>(null);
const dragging = ref(false);

const ratio = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (props.modelValue - props.min) / span));
});

const bubbleText = computed(() =>
  props.formatValue ? props.formatValue(props.modelValue) : String(props.modelValue),
);

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
    <span
      class="track-active"
      :style="{ width: `max(0px, calc(${ratio * 100}% - 6px))` }"
      aria-hidden="true"
    />
    <span
      class="track-inactive"
      :style="{ width: `max(0px, calc(${(1 - ratio) * 100}% - 6px))` }"
      aria-hidden="true"
    />
    <span v-if="ratio < 0.96" class="stop-dot" aria-hidden="true" />
    <span class="handle" :style="{ left: `${ratio * 100}%` }" aria-hidden="true" />
    <span
      v-if="showBubble"
      class="value-bubble tabular"
      :style="{ left: `${ratio * 100}%` }"
      aria-hidden="true"
    >
      {{ bubbleText }}
    </span>
  </div>
</template>

<style scoped>
.slider {
  position: relative;
  height: 36px;
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
.track-active {
  position: absolute;
  left: 0;
  height: 12px;
  border-radius: 6px 2.5px 2.5px 6px;
  background-color: rgb(var(--md-primary));
  pointer-events: none;
}
.track-inactive {
  position: absolute;
  right: 0;
  height: 12px;
  border-radius: 2.5px 6px 6px 2.5px;
  background-color: rgb(var(--md-secondary-container));
  pointer-events: none;
}
.stop-dot {
  position: absolute;
  right: 4px;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  transform: translateY(-50%);
  background-color: rgb(var(--md-primary));
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 28px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  transform: translate(-50%, -50%);
  pointer-events: none;
  transition:
    width var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    height var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy);
}
.slider:hover .handle {
  height: 31px;
}
.slider.dragging .handle {
  width: 2.5px;
  height: 34px;
}
.slider:focus-visible .handle {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 3px;
}
.value-bubble {
  position: absolute;
  bottom: calc(100% + 2px);
  padding: 4px 9px;
  border-radius: 999px;
  background-color: rgb(var(--md-inverse-surface));
  color: rgb(var(--md-inverse-on-surface));
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, 6px) scale(0.6);
  transition:
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    opacity var(--md-dur-effects-fast) var(--md-spring-effects-fast);
}
.slider:hover:not(.disabled) .value-bubble,
.slider.dragging .value-bubble {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
@media (prefers-reduced-motion: reduce) {
  .handle,
  .value-bubble {
    transition: none;
  }
}
</style>
