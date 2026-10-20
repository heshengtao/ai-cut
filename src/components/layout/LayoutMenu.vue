<script setup lang="ts">
/** 布局模式下拉：横屏（预览上 / 时间线下）与竖屏（预览左 / 时间线右）。 */
import { onMounted, onUnmounted, ref } from "vue";
import { CheckIcon } from "@heroicons/vue/24/outline";
import { useLayoutStore, type LayoutMode } from "@/stores/layout";
import { useI18n } from "@/i18n";

const layout = useLayoutStore();
const i18n = useI18n();

const MODES: { id: LayoutMode; labelKey: string; hintKey: string }[] = [
  { id: "landscape", labelKey: "topbar.layout.landscape", hintKey: "topbar.layout.landscapeHint" },
  { id: "portrait", labelKey: "topbar.layout.portrait", hintKey: "topbar.layout.portraitHint" },
];

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function pick(mode: LayoutMode): void {
  layout.setLayoutMode(mode);
  open.value = false;
}

function onDocPointer(e: PointerEvent): void {
  if (!open.value) return;
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && open.value) open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="layout-menu">
    <button
      class="menu-btn"
      :class="{ on: open }"
      :aria-label="i18n.t('topbar.layout')"
      :title="i18n.t('topbar.layout')"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        class="menu-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="M10 4.5v15" />
        <path d="M10 12h11" />
      </svg>
    </button>

    <transition name="pop">
      <div v-if="open" class="menu" role="menu" :aria-label="i18n.t('topbar.layout')">
        <div class="menu-title">{{ i18n.t("topbar.layout") }}</div>
        <button
          v-for="mode in MODES"
          :key="mode.id"
          class="menu-item"
          :class="{ on: layout.layoutMode === mode.id }"
          role="menuitemradio"
          :aria-checked="layout.layoutMode === mode.id"
          @click="pick(mode.id)"
        >
          <span class="mode-shape" :class="mode.id" aria-hidden="true" />
          <span class="item-text">
            <span class="item-label">{{ i18n.t(mode.labelKey) }}</span>
            <span class="item-hint">{{ i18n.t(mode.hintKey) }}</span>
          </span>
          <CheckIcon v-if="layout.layoutMode === mode.id" class="item-check" />
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.layout-menu {
  position: relative;
  flex: 0 0 auto;
}
.menu-btn {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.menu-btn:hover,
.menu-btn.on {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.menu-btn:active {
  transform: scale(0.94);
}
.menu-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.menu-icon {
  width: 18px;
  height: 18px;
}
.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 90;
  width: 248px;
  padding: 8px;
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  box-shadow: var(--md-elevation-3);
}
.menu-title {
  padding: 4px 8px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: rgb(var(--md-on-surface-muted));
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.menu-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.menu-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.mode-shape {
  flex: 0 0 auto;
  border: 1.5px solid rgb(var(--md-on-surface-muted));
  border-radius: 3px;
}
.mode-shape.landscape {
  width: 24px;
  height: 15px;
}
.mode-shape.portrait {
  width: 15px;
  height: 24px;
}
.item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}
.item-label {
  font-size: 13px;
  font-weight: 500;
}
.item-hint {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.item-check {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: rgb(var(--md-primary));
}
.pop-enter-active {
  transition: opacity 0.16s ease, transform 0.22s cubic-bezier(0.34, 1.42, 0.5, 1);
}
.pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .menu-btn,
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
