<script setup lang="ts">
/** 窗口按钮：Windows / Linux 无边框窗口自绘的最小化 / 最大化 / 关闭。 */
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Tooltip from "@/components/common/Tooltip.vue";
import { useI18n } from "@/i18n";

const i18n = useI18n();
const isMaximized = ref(false);
const appWindow = getCurrentWindow();

let unlisten: (() => void) | null = null;

onMounted(async () => {
  isMaximized.value = await appWindow.isMaximized();
  unlisten = await appWindow.onResized(() => {
    void appWindow.isMaximized().then((v) => (isMaximized.value = v));
  });
});

onUnmounted(() => {
  unlisten?.();
});
</script>

<template>
  <div class="window-controls">
    <Tooltip :text="i18n.t('window.minimize')" align="end">
      <button
        class="window-control-btn"
        :aria-label="i18n.t('window.minimize')"
        @click="appWindow.minimize()"
      >
        <svg width="12" height="12" viewBox="0 0 11 11" aria-hidden="true">
          <rect x="0.5" y="5" width="10" height="1" fill="currentColor" rx="0.5" />
        </svg>
      </button>
    </Tooltip>
    <Tooltip
      :text="isMaximized ? i18n.t('window.restore') : i18n.t('window.maximize')"
      align="end"
    >
      <button
        class="window-control-btn"
        :aria-label="isMaximized ? i18n.t('window.restore') : i18n.t('window.maximize')"
        @click="appWindow.toggleMaximize()"
      >
        <svg v-if="isMaximized" width="12" height="12" viewBox="0 0 11 11" aria-hidden="true">
          <rect
            x="1"
            y="4"
            width="6.4"
            height="6.4"
            rx="1"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
          <path
            d="M4 4V2a1 1 0 0 1 1-1h4.4a1 1 0 0 1 1 1v4.4a1 1 0 0 1-1 1H7.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 11 11" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="9"
            height="9"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
      </button>
    </Tooltip>
    <Tooltip :text="i18n.t('window.close')" align="end">
      <button
        class="window-control-btn window-control-close"
        :aria-label="i18n.t('window.close')"
        @click="appWindow.close()"
      >
        <svg width="12" height="12" viewBox="0 0 11 11" aria-hidden="true">
          <path
            d="M1 1l9 9M10 1L1 10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </Tooltip>
  </div>
</template>

<style scoped>
.window-controls {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 1px;
  padding-right: 12px;
}
.window-control-btn {
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
.window-control-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.window-control-btn:active {
  transform: scale(0.94);
}
.window-control-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.window-control-close:hover {
  background-color: rgb(var(--md-error) / var(--md-state-hover-alpha));
  color: rgb(var(--md-error));
}
.window-control-btn svg {
  display: block;
}

@media (prefers-reduced-motion: reduce) {
  .window-control-btn {
    transition: none;
  }
  .window-control-btn:active {
    transform: none;
  }
}
</style>
