<script setup lang="ts">
/**
 * MD3 颜色字段：色块 + 十六进制值，点击打开自绘的 MD3 取色器。
 * 不使用原生 `<input type="color">`，饱和面 / 色相条 / 预设色板全部重写。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { CheckIcon } from "@heroicons/vue/24/outline";
import {
  hexToHsv,
  hsvToHex,
  hueColor,
  normalizeHex,
  type Hsv,
} from "@/core/color";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** 读屏名称。 */
    label: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  /** 一次连续调整结束（用于收尾合并历史）。 */
  (e: "commit"): void;
}>();

const i18n = useI18n();

/** 预设色板：中性色 + MD3 主色/辅助色/错误色 + 常用色相。 */
const SWATCHES = [
  "#ffffff",
  "#f2f0f7",
  "#cac4d0",
  "#79747e",
  "#49454f",
  "#1c1b1f",
  "#000000",
  "#6750a4",
  "#d0bcff",
  "#e8def8",
  "#7d5260",
  "#ffd8e4",
  "#b3261e",
  "#f9dedc",
  "#386a20",
  "#c6f6d5",
  "#1a6cff",
  "#dbe1ff",
  "#bd8900",
  "#ffdfa0",
];

const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popoverEl = ref<HTMLElement | null>(null);
const svEl = ref<HTMLElement | null>(null);
const hueEl = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const hsv = ref<Hsv>(hexToHsv(props.modelValue));
const hexDraft = ref(normalizeHex(props.modelValue) ?? "#000000");
const dragMode = ref<"sv" | "hue" | null>(null);

const shownHex = computed(() => normalizeHex(props.modelValue) ?? "#000000");
const hueBackground = computed(
  () =>
    "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, " +
    "#0000ff 67%, #ff00ff 83%, #ff0000 100%)",
);
const svBackground = computed(
  () =>
    `linear-gradient(to top, #000, transparent), ` +
    `linear-gradient(to right, #fff, ${hueColor(hsv.value.h)})`,
);

function syncFromValue(value: string): void {
  const normalized = normalizeHex(value) ?? "#000000";
  hsv.value = hexToHsv(normalized);
  hexDraft.value = normalized;
}

watch(
  () => props.modelValue,
  (value) => {
    if (dragMode.value) return;
    syncFromValue(value);
  },
);

function place(): void {
  const el = triggerEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 236;
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
  popoverStyle.value = {
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    ...(openUp
      ? { bottom: `${window.innerHeight - rect.top + 6}px` }
      : { top: `${rect.bottom + 6}px` }),
  };
}

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    syncFromValue(props.modelValue);
    void nextTick(place);
  }
}

function close(): void {
  open.value = false;
  dragMode.value = null;
  stopDrag();
}

function emitHsv(commit: boolean): void {
  const hex = hsvToHex(hsv.value);
  hexDraft.value = hex;
  emit("update:modelValue", hex);
  if (commit) emit("commit");
}

function onSvPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragMode.value = "sv";
  updateSv(event);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
}

function updateSv(event: PointerEvent): void {
  const rect = svEl.value?.getBoundingClientRect();
  if (!rect) return;
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
  const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
  hsv.value = {
    h: hsv.value.h,
    s: rect.width > 0 ? x / rect.width : 0,
    v: rect.height > 0 ? 1 - y / rect.height : 0,
  };
  emitHsv(false);
}

function onHuePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragMode.value = "hue";
  updateHue(event);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
}

function updateHue(event: PointerEvent): void {
  const rect = hueEl.value?.getBoundingClientRect();
  if (!rect) return;
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
  hsv.value = { ...hsv.value, h: rect.width > 0 ? (x / rect.width) * 360 : 0 };
  emitHsv(false);
}

function onDragMove(event: PointerEvent): void {
  if (dragMode.value === "sv") updateSv(event);
  else if (dragMode.value === "hue") updateHue(event);
}

function onDragEnd(): void {
  if (!dragMode.value) return;
  dragMode.value = null;
  stopDrag();
  emit("commit");
}

function stopDrag(): void {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragEnd);
}

function pickSwatch(color: string): void {
  syncFromValue(color);
  emit("update:modelValue", color);
  emit("commit");
}

function commitHex(): void {
  const normalized = normalizeHex(hexDraft.value);
  if (!normalized) {
    hexDraft.value = shownHex.value;
    return;
  }
  syncFromValue(normalized);
  emit("update:modelValue", normalized);
  emit("commit");
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value) return;
  const target = event.target as Node;
  if (triggerEl.value?.contains(target) || popoverEl.value?.contains(target)) return;
  close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.stopPropagation();
    close();
  }
}

function onViewportChange(): void {
  if (open.value) place();
}

watch(open, (isOpen) => {
  if (!isOpen) {
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    return;
  }
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
});

onMounted(() => {
  window.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
  stopDrag();
});
</script>

<template>
  <button
    ref="triggerEl"
    class="color-field"
    :class="{ disabled, open }"
    type="button"
    :disabled="disabled"
    :aria-label="label"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click="toggle"
  >
    <span class="swatch" :style="{ backgroundColor: shownHex }" />
    <span class="hex">{{ shownHex.toUpperCase() }}</span>
  </button>

  <Teleport to="body">
    <transition name="pop">
      <div
        v-if="open"
        ref="popoverEl"
        class="color-popover"
        :style="popoverStyle"
        role="dialog"
        :aria-label="label"
      >
        <div
          ref="svEl"
          class="sv"
          :style="{ background: svBackground }"
          @pointerdown="onSvPointerDown"
        >
          <span
            class="sv-dot"
            :style="{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              backgroundColor: shownHex,
            }"
          />
        </div>

        <div class="slider-row">
          <div
            ref="hueEl"
            class="hue"
            :style="{ background: hueBackground }"
            @pointerdown="onHuePointerDown"
          >
            <span class="hue-dot" :style="{ left: `${(hsv.h / 360) * 100}%` }" />
          </div>
          <div class="hex-box">
            <span class="hash">#</span>
            <input
              v-model="hexDraft"
              class="hex-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :aria-label="i18n.t('color.hex')"
              maxlength="7"
              @change="commitHex"
              @keydown.enter.prevent="commitHex"
            />
          </div>
        </div>

        <div class="swatches" role="group" :aria-label="i18n.t('color.swatches')">
          <button
            v-for="color in SWATCHES"
            :key="color"
            class="swatch-btn"
            type="button"
            :style="{ backgroundColor: color }"
            :aria-label="color"
            :aria-pressed="color === shownHex"
            @click="pickSwatch(color)"
          >
            <CheckIcon v-if="color === shownHex" class="check" />
          </button>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.color-field {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px 0 5px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.color-field:hover:not(:disabled) {
  border-color: rgb(var(--md-primary) / 0.75);
}
.color-field.open,
.color-field:focus-visible {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
  outline: none;
}
.color-field.disabled {
  opacity: 0.45;
  cursor: default;
}
.swatch {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.28), 0 1px 2px rgb(0 0 0 / 0.22);
}
.hex {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.color-popover {
  position: fixed;
  z-index: 340;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: 20px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.sv {
  position: relative;
  height: 168px;
  border-radius: 12px;
  cursor: crosshair;
  touch-action: none;
}
.sv-dot {
  position: absolute;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 4px rgb(0 0 0 / 0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hue {
  position: relative;
  flex: 1 1 auto;
  height: 12px;
  border-radius: 999px;
  cursor: ew-resize;
  touch-action: none;
}
.hue-dot {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid #fff;
  background: transparent;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.32);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.hex-box {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 82px;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
}
.hash {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.hex-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
}
.swatch-btn {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  cursor: pointer;
  transition: transform 0.12s ease;
}
.swatch-btn:hover {
  transform: scale(1.14);
}
.swatch-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.check {
  width: 11px;
  height: 11px;
  color: #fff;
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.8));
}
.pop-enter-active {
  transition: opacity 0.14s ease, transform 0.18s cubic-bezier(0.34, 1.42, 0.5, 1);
}
.pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .color-field,
  .swatch-btn,
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
