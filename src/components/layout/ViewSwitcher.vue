<script setup lang="ts">
/**
 * 三视图切换：圆角轨道槽 + 滑动胶囊（与 ai-daw 的 Md3Segmented 同一套几何）。
 *
 * 胶囊位置由 DOM 实测量出（不是按百分比算），带弹簧过渡；容器自身变宽变窄、
 * Web 字体换上、窗口缩放都会重新量一次。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

export interface ViewSwitcherOption {
  value: string;
  label: string;
  title?: string;
  /** 组件（Heroicons 图标），可选。 */
  icon?: unknown;
}

const props = defineProps<{
  modelValue: string;
  options: ViewSwitcherOption[];
  ariaLabel?: string;
}>();

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const root = ref<HTMLElement | null>(null);
const buttons = ref<(HTMLElement | null)[]>([]);
const pill = ref({ left: "0px", width: "0px" });
const activeIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue));

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
  if (root.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(updatePill);
    resizeObserver.observe(root.value);
  }
  void document.fonts?.ready.then(updatePill);
});

onUnmounted(() => {
  window.removeEventListener("resize", updatePill);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="root" class="view-switcher" role="group" :aria-label="ariaLabel">
    <div v-if="activeIndex >= 0" class="vs-pill" :style="{ left: pill.left, width: pill.width }" />
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(el) => { if (el) buttons[index] = el as HTMLElement }"
      v-ripple
      type="button"
      class="vs-btn"
      :class="{ on: activeIndex === index }"
      :title="option.title"
      :aria-pressed="activeIndex === index"
      @click="emit('update:modelValue', option.value)"
    >
      <component :is="option.icon" v-if="option.icon" class="vs-icon" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
/* 轨道槽：比按钮外扩 4px，胶囊在槽里滑动（几何与 ai-daw Md3Segmented 一致）。 */
.view-switcher {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  flex-wrap: nowrap;
  max-width: 100%;
  overflow: hidden;
}
.vs-pill {
  position: absolute;
  top: 4px;
  bottom: 4px;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  box-shadow: var(--md-elevation-1);
  pointer-events: none;
  transition:
    left var(--md-dur-spatial-default) var(--md-spring-spatial-fast),
    width var(--md-dur-spatial-default) var(--md-spring-spatial-fast);
}
.vs-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: color var(--md-duration-short-2) var(--md-ease-spring-fast);
}
.vs-btn:hover {
  color: rgb(var(--md-on-surface));
}
.vs-btn.on {
  color: rgb(var(--md-on-secondary-container));
}
.vs-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
@media (prefers-reduced-motion: reduce) {
  .vs-pill {
    transition: none;
  }
}
</style>
