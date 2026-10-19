<script setup lang="ts">
/** 窗口按钮：Windows / Linux 无边框窗口自绘的最小化 / 最大化 / 关闭。 */
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  <div class="flex items-center">
    <button class="window-control-btn" title="最小化" @click="appWindow.minimize()">
      <svg width="11" height="11" viewBox="0 0 11 11">
        <rect x="0.5" y="5" width="10" height="1" fill="currentColor" rx="0.5" />
      </svg>
    </button>
    <button
      class="window-control-btn"
      :title="isMaximized ? '还原' : '最大化'"
      @click="appWindow.toggleMaximize()"
    >
      <svg v-if="isMaximized" width="11" height="11" viewBox="0 0 11 11">
        <rect x="2.5" y="0.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
        <rect
          x="0.5"
          y="2.5"
          width="8"
          height="8"
          rx="1"
          fill="rgb(var(--md-surface))"
          stroke="currentColor"
          stroke-width="1"
        />
      </svg>
      <svg v-else width="11" height="11" viewBox="0 0 11 11">
        <rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>
    <button class="window-control-btn window-control-close" title="关闭" @click="appWindow.close()">
      <svg width="11" height="11" viewBox="0 0 11 11">
        <path d="M1 1l9 9M10 1L1 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-control-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: default;
  transition: background-color 0.15s;
}
.window-control-btn:hover {
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
}
.window-control-close:hover {
  background-color: #c42b1c;
  color: #fff !important;
}
</style>
