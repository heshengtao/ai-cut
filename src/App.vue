<script setup lang="ts">
/** 应用根：布局初始化 + 自动保存 + 启动时检查恢复草稿 + 全局快捷键。 */
import { onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "@/components/layout/AppShell.vue";
import Logo from "@/components/common/Logo.vue";
import Toast from "@/components/common/Toast.vue";
import AiTaskHud from "@/components/common/AiTaskHud.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ExportModal from "@/components/common/ExportModal.vue";
import CutSettingsDialog from "@/components/common/CutSettingsDialog.vue";
import ProjectHistoryDialog from "@/components/common/ProjectHistoryDialog.vue";
import ShortcutsDialog from "@/components/common/ShortcutsDialog.vue";
import WelcomeDialog from "@/components/onboarding/WelcomeDialog.vue";
import GuidedTour from "@/components/onboarding/GuidedTour.vue";
import type { WelcomeStart } from "@/types/onboarding";
import { releaseNotesUrl, takeUpdateNotice } from "@/core/updateNotice";
import { useLayoutStore } from "@/stores/layout";
import { useOnboardingStore } from "@/stores/onboarding";
import { useAgentStore } from "@/stores/agent";
import { useUpdaterStore } from "@/stores/updater";
import { useProjectActions } from "@/composables/useProjectActions";
import { useMediaImport } from "@/composables/useMediaImport";
import { restoreLastSession, startAutosave } from "@/core/autosave";
import { installShortcuts } from "@/core/shortcuts";
import { initProjectBridge } from "@/core/mcpBridge";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";
import { isTauri } from "@/utils/platform";

const layout = useLayoutStore();
const onboarding = useOnboardingStore();
const agent = useAgentStore();
const updater = useUpdaterStore();
const actions = useProjectActions();
const { importMedia } = useMediaImport();
const i18n = useI18n();

/**
 * 欢迎页的起点：动作需要借用主窗口的对话框 / 面板，所以集中在根部执行。
 * `import` 直接打开系统文件选择框；`blank` 走「新建工程」的未保存确认；
 * `resume` 不用做事——上次工程在启动时已经静默恢复，关掉欢迎页就回到了它。
 */
function onWelcomeStart(action: WelcomeStart): void {
  if (action === "resume") return;
  if (action === "ai") layout.openTab("agent");
  else if (action === "import") void importMedia();
  else if (action === "open") void actions.openProject();
  else if (action === "history") layout.historyOpen = true;
  else if (action === "blank") void actions.newProject();
}

let uninstall: (() => void) | null = null;
/** 恢复上次工程可能读一大段 JSON：超过 280ms 才铺占位，避免正常启动闪一下。 */
const restoring = ref(true);
const restoreOverlay = ref(false);
let restoreTimer: number | undefined;

function openReleaseNotes(version: string): void {
  const url = releaseNotesUrl(version);
  void invoke("open_external_url", { url }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

function onWindowResize(): void {
  layout.clampPanes();
}

onMounted(() => {
  layout.clampPanes();
  window.addEventListener("resize", onWindowResize);
  restoreTimer = window.setTimeout(() => {
    if (restoring.value) restoreOverlay.value = true;
  }, 280);
  // 重启后直接回到上次的工程，不再询问；恢复完成后再开始自动保存 / 弹欢迎页。
  void restoreLastSession().finally(() => {
    restoring.value = false;
    restoreOverlay.value = false;
    window.clearTimeout(restoreTimer);
    startAutosave();
    // 欢迎页：等首屏真的画出来再弹（首帧就盖遮罩会显得应用「卡住了」）。
    if (onboarding.welcomeOnStart) {
      window.setTimeout(() => onboarding.openWelcome(), 220);
    }
  });
  uninstall = installShortcuts();
  initProjectBridge();
  // 智能体事件订阅放在根组件：切到别的面板时不丢流式内容。
  void agent.start().catch(() => undefined);
  // 启动时静默查一次更新；查不到（还没发过 release）或连不上都当作「已是最新」。
  if (isTauri()) {
    // 版本号与上次记录不同，说明刚完成更新：右下角提示一次。
    void updater.loadVersion().then((current) => {
      const from = takeUpdateNotice(current);
      if (!from) return;
      toast(i18n.t("update.notice.message", { from, version: current }), "info", {
        timeout: 10000,
        action: {
          label: i18n.t("update.notice.viewNotes"),
          run: () => openReleaseNotes(current),
        },
      });
    });
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
  window.clearTimeout(restoreTimer);
  uninstall?.();
});
</script>

<template>
  <AppShell />
  <Transition name="restore">
    <div v-if="restoreOverlay" class="restore-overlay" role="status">
      <Logo :size="44" class="restore-mark" />
      <p class="restore-text">{{ i18n.t("app.restoring") }}</p>
      <div class="restore-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
  </Transition>
  <Toast />
  <AiTaskHud />
  <ConfirmDialog />
  <ExportModal />
  <CutSettingsDialog />
  <ProjectHistoryDialog v-model:open="layout.historyOpen" />
  <ShortcutsDialog v-model:open="layout.shortcutsOpen" />
  <!-- 启动时的欢迎页与聚光灯引导：挂在根部，任何视图上都能浮起来 -->
  <WelcomeDialog @start="onWelcomeStart" @tour="onboarding.startTour()" />
  <GuidedTour />
</template>

<style scoped>
/* 恢复上次工程时的占位：只在真的慢（> 280ms）时出现，避免正常启动闪一下。 */
.restore-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background-color: var(--app-bg);
  background-image: var(--app-wash);
}
.restore-mark {
  animation: restore-breathe 1.8s ease-in-out infinite;
}
.restore-text {
  margin: 0;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface-variant));
}
.restore-dots {
  display: flex;
  gap: 6px;
}
.restore-dots span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  opacity: 0.35;
  animation: restore-pulse 1.2s ease-in-out infinite;
}
.restore-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.restore-dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes restore-breathe {
  0%,
  100% {
    opacity: 0.82;
    transform: scale(0.97);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes restore-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.9;
  }
}
.restore-enter-active,
.restore-leave-active {
  transition: opacity var(--md-duration-short-2) var(--md-ease-standard);
}
.restore-enter-from,
.restore-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .restore-mark,
  .restore-dots span {
    animation: none;
  }
}
</style>
