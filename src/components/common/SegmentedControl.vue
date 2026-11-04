<script setup lang="ts">
/**
 * MD3 分段按钮（滑块风格）：活动胶囊由 DOM 量出来，带弹簧动画。
 *
 * 与 ai-daw 的 `Md3Segmented` 同一套交互：设置页「ONNX Runtime 后端」、视频后端
 * （CPU / Vulkan / CUDA 12）都用它——选中项是那颗会滑过去的「手柄」，不是下拉框。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    options: { value: string; label: string; title?: string; disabled?: boolean }[];
    ariaLabel?: string;
    /** `md`（30px，设置页） / `sm`（24px，右侧 AI 面板）。 */
    size?: "md" | "sm";
  }>(),
  { size: "md" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const root = ref<HTMLElement | null>(null);
const buttons = ref<(HTMLElement | null)[]>([]);
const pill = ref({ left: "0px", width: "0px" });

const activeIndex = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
);

let resizeObserver: ResizeObserver | null = null;

function updatePill(): void {
  void nextTick(() => {
    const el = activeIndex.value >= 0 ? buttons.value[activeIndex.value] : null;
    if (el) pill.value = { left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px` };
  });
}

watch(
  [activeIndex, () => props.options.map((option) => `${option.value}:${option.label}`).join("|")],
  updatePill,
);

onMounted(() => {
  updatePill();
  window.addEventListener("resize", updatePill);
  // 容器自身变宽 / 变窄（侧栏、窗口、字体回退）时按钮宽度都会变，只监听 window 不够。
  if (root.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(updatePill);
    resizeObserver.observe(root.value);
  }
  // Web 字体换上之后按钮会重新排版，此时量出来的胶囊位置 / 宽度已经过期。
  void document.fonts?.ready.then(updatePill);
});

onUnmounted(() => {
  window.removeEventListener("resize", updatePill);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="root" class="m3-seg" :class="size" role="group" :aria-label="ariaLabel || undefined">
    <div
      v-if="activeIndex >= 0"
      class="m3-seg-pill"
      :style="{ left: pill.left, width: pill.width }"
    />
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(el) => { if (el) buttons[index] = el as HTMLElement }"
      type="button"
      class="m3-seg-btn"
      :class="{ on: activeIndex === index }"
      :aria-pressed="activeIndex === index"
      :disabled="option.disabled"
      :title="option.title"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.m3-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  /* 窄容器里不换行、也不裁掉最后一项：保持一条，必要时横向滚动。 */
  max-width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.m3-seg::-webkit-scrollbar {
  display: none;
}
.m3-seg.sm {
  padding: 2px;
}
.m3-seg-pill {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  box-shadow: var(--md-elevation-1);
  pointer-events: none;
  transition:
    left 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
    width 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.m3-seg.sm .m3-seg-pill {
  top: 2px;
  bottom: 2px;
  box-shadow: none;
}
.m3-seg.sm .m3-seg-btn {
  height: 24px;
  padding: 0 9px;
  font-size: 11px;
}
.m3-seg-btn {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.2s ease;
}
.m3-seg-btn:hover:not(:disabled) {
  color: rgb(var(--md-on-surface));
}
.m3-seg-btn.on {
  color: rgb(var(--md-on-secondary-container));
}
.m3-seg-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.m3-seg-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .m3-seg-pill,
  .m3-seg-btn {
    transition: none;
  }
}
</style>
