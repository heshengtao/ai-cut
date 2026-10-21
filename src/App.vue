<script setup lang="ts">
/** 应用根：布局初始化 + 自动保存 + 启动时检查恢复草稿 + 全局快捷键。 */
import { onMounted, onUnmounted } from "vue";
import AppShell from "@/components/layout/AppShell.vue";
import Toast from "@/components/common/Toast.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ExportModal from "@/components/common/ExportModal.vue";
import { useLayoutStore } from "@/stores/layout";
import { useAgentStore } from "@/stores/agent";
import { useUpdaterStore } from "@/stores/updater";
import { restoreLastSession, startAutosave } from "@/core/autosave";
import { installShortcuts } from "@/core/shortcuts";
import { initProjectBridge } from "@/core/mcpBridge";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";
import { isTauri } from "@/utils/platform";

const layout = useLayoutStore();
const agent = useAgentStore();
const updater = useUpdaterStore();
const i18n = useI18n();

let uninstall: (() => void) | null = null;

function onWindowResize(): void {
  layout.clampPanes();
}

onMounted(() => {
  layout.clampPanes();
  window.addEventListener("resize", onWindowResize);
  // 重启后直接回到上次的工程，不再询问；恢复完成后再开始自动保存。
  void restoreLastSession().finally(() => startAutosave());
  uninstall = installShortcuts();
  initProjectBridge();
  // 智能体事件订阅放在根组件：切到别的面板时不丢流式内容。
  void agent.start().catch(() => undefined);
  // 启动时静默查一次更新；查不到（还没发过 release）或连不上都当作「已是最新」。
  if (isTauri()) {
    void updater.check(true).then((has) => {
      if (has) {
        toast(
          i18n.t("settings.update.availableToast", {
            version: updater.info?.version ?? "",
          }),
        );
      }
    });
  }
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
