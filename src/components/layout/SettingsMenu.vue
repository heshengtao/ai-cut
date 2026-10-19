<script setup lang="ts">
/**
 * 设置菜单：顶栏齿轮按钮弹出的 MD3 菜单。
 * 目前只有「外观」是活的（浅色 / 深色 / 跟随系统），其余是原型占位。
 */
import { onMounted, onUnmounted, ref } from "vue";
import { Cog6ToothIcon, SunIcon, MoonIcon, ComputerDesktopIcon } from "@heroicons/vue/24/outline";
import Tooltip from "@/components/common/Tooltip.vue";
import { themeMode, setTheme, type ThemeMode } from "@/composables/useTheme";

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const themes: { id: ThemeMode; label: string; icon: unknown }[] = [
  { id: "light", label: "浅色", icon: SunIcon },
  { id: "dark", label: "深色", icon: MoonIcon },
  { id: "system", label: "跟随系统", icon: ComputerDesktopIcon },
];

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
  <div ref="root" class="settings-root">
    <Tooltip text="设置" align="end" :disabled="open">
      <button
        class="bar-btn"
        :class="{ on: open }"
        aria-label="设置"
        :aria-expanded="open"
        @click="open = !open"
      >
        <Cog6ToothIcon class="bar-icon" />
      </button>
    </Tooltip>

    <transition name="pop">
      <div v-if="open" class="menu" role="menu">
        <div class="menu-title">设置</div>

        <div class="menu-section-label">外观</div>
        <div class="theme-row" role="group" aria-label="外观">
          <button
            v-for="t in themes"
            :key="t.id"
            class="theme-btn"
            :class="{ on: themeMode === t.id }"
            :aria-pressed="themeMode === t.id"
            @click="setTheme(t.id)"
          >
            <component :is="t.icon" class="theme-icon" />
            <span>{{ t.label }}</span>
          </button>
        </div>

        <div class="menu-divider" />

        <button class="menu-item" role="menuitem" disabled>
          <span>快捷键</span>
          <span class="menu-kbd">⌘ /</span>
        </button>
        <button class="menu-item" role="menuitem" disabled>
          <span>偏好设置</span>
          <span class="menu-muted">即将推出</span>
        </button>

        <div class="menu-divider" />

        <div class="menu-about">
          <span class="about-name">AI Cut</span>
          <span class="menu-muted">原型 · v0.1.0</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.settings-root {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

/* MD3 图标按钮：圆形，无原生外观 */
.bar-btn {
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
.bar-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.bar-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.bar-btn:active {
  transform: scale(0.94);
}
.bar-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.bar-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}

/* ---- 菜单 ---- */
.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 80;
  width: 268px;
  padding: 10px;
  border-radius: 20px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  box-shadow: var(--md-elevation-3);
}
.menu-title {
  padding: 4px 8px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.menu-section-label {
  padding: 2px 8px 7px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: rgb(var(--md-on-surface-muted));
}
.theme-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 0 2px 8px;
}
.theme-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 9px 4px 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.theme-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.theme-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  border-color: rgb(var(--md-outline-variant) / 0.5);
}
.theme-icon {
  width: 17px;
  height: 17px;
}
.menu-divider {
  height: 1px;
  margin: 4px 6px;
  background-color: rgb(var(--md-outline-variant) / 0.45);
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.menu-item:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.menu-item:disabled {
  cursor: default;
  opacity: 0.65;
}
.menu-kbd {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.menu-muted {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.menu-about {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 8px 4px;
}
.about-name {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
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
  .bar-btn,
  .theme-btn,
  .menu-item,
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
