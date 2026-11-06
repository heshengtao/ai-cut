<script setup lang="ts">
/**
 * 带图标与快捷键提示的弹出菜单（顶栏「文件」「帮助」用它）。
 *
 * 为什么不是一排图标按钮：顶栏挤了十几个只有图标的入口，新用户得逐个悬停才知道
 * 那是什么。收进菜单后，每一项都能写全名和快捷键，入口反而更好找。
 *
 * 交互按 MD3 menu 的基本要求：点外部 / Escape 关闭、↑↓ 移动、Enter 选中、
 * 打开时焦点落在第一项、关闭后焦点还给触发按钮。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { MenuItem, MenuSection } from "./menu";

const props = withDefaults(
  defineProps<{
    open: boolean;
    sections: MenuSection[];
    /** 面板贴着触发按钮的哪一边。顶栏右端用 `end`。 */
    align?: "start" | "end";
    label?: string;
  }>(),
  { align: "end", label: "" },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "select", id: string): void;
}>();

const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
const trigger = ref<HTMLElement | null>(null);

/** 拍平成一个数组，键盘上下移动按它算；分隔线不参与。 */
const flat = computed(() =>
  props.sections.flatMap((section) => section.items).filter((item) => !item.disabled),
);

function setOpen(value: boolean): void {
  emit("update:open", value);
}

function toggle(): void {
  setOpen(!props.open);
}

function close(restoreFocus = false): void {
  setOpen(false);
  // 焦点还给触发按钮（`trigger` 是插槽外壳，真正的按钮在它里面）。
  if (restoreFocus) trigger.value?.querySelector<HTMLElement>("button")?.focus();
}

function choose(item: MenuItem): void {
  if (item.disabled) return;
  emit("select", item.id);
  close(true);
}

/** 焦点落在菜单第一项上，随后用上下键在项之间走。 */
function focusItem(index: number): void {
  const items = panel.value?.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)");
  if (!items || items.length === 0) return;
  const clamped = Math.max(0, Math.min(index, items.length - 1));
  activeIndex.value = clamped;
  items[clamped]?.focus();
}

function onKey(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close(true);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusItem(activeIndex.value + 1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    focusItem(activeIndex.value - 1);
  }
}

function onDocPointerDown(e: PointerEvent): void {
  if (!props.open) return;
  const target = e.target as Node;
  if (root.value?.contains(target)) return;
  close();
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    focusItem(0);
  },
);

/** 触发按钮自己的引用：外层把 button 渲染在 `#trigger` 里，这里用 closest 兜底找回来。 */
function onTriggerClick(e: MouseEvent): void {
  trigger.value = (e.currentTarget as HTMLElement) ?? null;
  toggle();
}

onMounted(() => {
  window.addEventListener("pointerdown", onDocPointerDown, true);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointerDown, true);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="menu-root">
    <div class="trigger-slot" @click="onTriggerClick">
      <slot name="trigger" :open="open" :toggle="toggle" />
    </div>

    <transition name="menu">
      <div
        v-if="open"
        ref="panel"
        class="panel"
        :class="align"
        role="menu"
        :aria-label="label"
        data-no-drag
      >
        <div v-for="(section, si) in sections" :key="si" class="section">
          <div v-if="section.title" class="section-title">{{ section.title }}</div>
          <button
            v-for="item in section.items"
            :key="item.id"
            class="menu-item"
            :class="{ danger: item.danger }"
            role="menuitem"
            :disabled="item.disabled"
            @click="choose(item)"
            @pointerenter="activeIndex = flat.findIndex((f) => f.id === item.id)"
          >
            <component :is="item.icon" v-if="item.icon" class="item-icon" />
            <span class="item-label">{{ item.label }}</span>
            <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.menu-root {
  position: relative;
  display: inline-flex;
}
.trigger-slot {
  display: inline-flex;
}
.panel {
  position: absolute;
  top: calc(100% + 8px);
  z-index: 70;
  min-width: 248px;
  padding: 6px;
  border-radius: 18px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  box-shadow:
    var(--md-elevation-3),
    0 16px 40px -18px rgb(var(--md-scrim) / 0.5);
  transform-origin: top right;
}
.panel.end {
  right: 0;
}
.panel.start {
  left: 0;
  transform-origin: top left;
}
.section + .section {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.35);
}
.section-title {
  padding: 6px 10px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-muted));
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--md-duration-short-2) var(--md-ease-standard);
}
.menu-item:hover,
.menu-item:focus-visible {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  outline: none;
}
.menu-item:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--md-primary) / 0.8);
}
.menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.menu-item.danger {
  color: rgb(var(--md-error));
}
.menu-item.danger:hover {
  background-color: rgb(var(--md-error) / 0.1);
}
.item-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
}
.menu-item.danger .item-icon {
  color: rgb(var(--md-error));
}
.item-label {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-hint {
  flex: 0 0 auto;
  font-size: 10.5px;
  letter-spacing: 0.3px;
  color: rgb(var(--md-on-surface-muted));
  font-variant-numeric: tabular-nums;
}

.menu-enter-active {
  /* 弹簧只给缓动，时长单独写：两个时间值相邻时后者会被 CSS 当成 delay。 */
  transition:
    opacity var(--md-duration-short-2) var(--md-ease-standard),
    transform var(--md-duration-medium-1) var(--md-ease-spring-fast);
}
.menu-leave-active {
  transition:
    opacity var(--md-duration-short-1) var(--md-ease-standard),
    transform var(--md-duration-short-1) var(--md-ease-standard);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .menu-enter-active,
  .menu-leave-active {
    transition-duration: 1ms;
  }
}
</style>
