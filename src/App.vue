<script setup lang="ts">
/** 应用根：布局初始化 + 自动保存 + 启动时检查恢复草稿 + 全局快捷键。 */
import { onMounted, onUnmounted } from "vue";
import AppShell from "@/components/layout/AppShell.vue";
import Toast from "@/components/common/Toast.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ExportModal from "@/components/common/ExportModal.vue";
import { useLayoutStore } from "@/stores/layout";
import { checkRecovery, startAutosave } from "@/core/autosave";
import { installShortcuts } from "@/core/shortcuts";

const layout = useLayoutStore();

let uninstall: (() => void) | null = null;

function onWindowResize(): void {
  layout.clampPanes();
}

onMounted(() => {
  layout.clampPanes();
  window.addEventListener("resize", onWindowResize);
  startAutosave();
  void checkRecovery();
  uninstall = installShortcuts();
});

onUnmounted(() => {
  window.removeEventListener("resize", onWindowResize);
  uninstall?.();
});
</script>

<template>
  <AppShell />
  <Toast />
  <ConfirmDialog />
  <ExportModal />
</template>
