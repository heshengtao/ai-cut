<script setup lang="ts">
/**
 * 顶栏右侧的动作区：**只留最常用的**，其余收进「文件」「帮助」菜单。
 *
 * 以前这里是一排十多个纯图标按钮（历史 / 新建 / 打开 / 保存 / 导出 / 快捷键 /
 * 布局 / GitHub / 设置），新用户得逐个悬停才知道是什么。现在：
 * - 明面上只留：AI 剪辑、保存、文件、帮助、布局、设置；
 * - 文件类动作进「文件」菜单，每一项都有全名和快捷键；
 * - 「帮助」里放快速上手 / 快捷键 / 仓库。
 */
import { computed, ref } from "vue";
import { openExternal } from "@/platform/tauri";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  Cog6ToothIcon,
  FolderOpenIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  SparklesIcon,
  SquaresPlusIcon,
} from "@heroicons/vue/24/outline";
import Tooltip from "@/components/common/Tooltip.vue";
import MenuButton from "@/components/common/MenuButton.vue";
import type { MenuSection } from "@/components/common/menu";
import FloppyDiskIcon from "@/components/common/icons/FloppyDiskIcon.vue";
import GitHubIcon from "@/components/common/icons/GitHubIcon.vue";
import KeyboardIcon from "@/components/common/icons/KeyboardIcon.vue";
import LayoutMenu from "./LayoutMenu.vue";
import { useLayoutStore } from "@/stores/layout";
import { useOnboardingStore } from "@/stores/onboarding";
import { useProjectActions } from "@/composables/useProjectActions";
import { useMediaImport } from "@/composables/useMediaImport";
import { useI18n } from "@/i18n";
import { isMacOS } from "@/utils/platform";

const layout = useLayoutStore();
const onboarding = useOnboardingStore();
const actions = useProjectActions();
const { importMedia } = useMediaImport();
const i18n = useI18n();

const REPO_URL = "https://github.com/heshengtao/ai-cut";

const fileOpen = ref(false);
const helpOpen = ref(false);

const mod = computed(() => (isMacOS() ? "⌘" : "Ctrl"));
const shift = computed(() => (isMacOS() ? "⇧" : "Shift"));

/** 「文件」菜单：动作、名称、快捷键一次说清。 */
const fileSections = computed<MenuSection[]>(() => [
  {
    items: [
      { id: "new", label: i18n.t("topbar.menu.new"), icon: PlusIcon },
      { id: "open", label: i18n.t("topbar.menu.open"), icon: FolderOpenIcon },
      { id: "import", label: i18n.t("topbar.menu.import"), icon: ArrowDownTrayIcon },
      { id: "history", label: i18n.t("topbar.menu.history"), icon: ClockIcon },
    ],
  },
  {
    title: i18n.t("topbar.menu.saveGroup"),
    items: [
      {
        id: "save",
        label: i18n.t("topbar.menu.save"),
        hint: `${mod.value}+S`,
        icon: FloppyDiskIcon,
      },
      {
        id: "saveAs",
        label: i18n.t("topbar.menu.saveAs"),
        hint: `${shift.value}+${mod.value}+S`,
        icon: FloppyDiskIcon,
      },
      { id: "export", label: i18n.t("topbar.menu.export"), icon: ArrowUpTrayIcon },
    ],
  },
]);

const helpSections = computed<MenuSection[]>(() => [
  {
    items: [
      { id: "tour", label: i18n.t("topbar.menu.quickStart"), icon: SquaresPlusIcon },
      { id: "shortcuts", label: i18n.t("topbar.menu.shortcuts"), icon: KeyboardIcon },
    ],
  },
  {
    items: [{ id: "github", label: i18n.t("topbar.menu.github"), icon: GitHubIcon }],
  },
]);

function onFileAction(id: string): void {
  if (id === "new") void actions.newProject();
  else if (id === "open") void actions.openProject();
  else if (id === "import") void importMedia();
  else if (id === "history") layout.historyOpen = true;
  else if (id === "save") void actions.saveProject();
  else if (id === "saveAs") void actions.saveProjectAs();
  else if (id === "export") actions.exportVideo();
}

function onHelpAction(id: string): void {
  if (id === "tour") {
    // 引导的锚点在工作区；设置页里启动时先回到工作区，等界面切换完再量位置。
    if (layout.settingsOpen) {
      layout.closeSettings();
      window.setTimeout(() => onboarding.startTour(), 260);
    } else {
      onboarding.startTour();
    }
  } else if (id === "shortcuts") layout.shortcutsOpen = true;
  else if (id === "github") openRepository();
}

/** 在系统浏览器里打开 GitHub 仓库（浏览器调试时退回新标签页）。 */
function openRepository(): void {
  openExternal(REPO_URL);
}

/** AI 剪辑 = 打开右侧的智能体面板。它是这个应用的主张，给它唯一的实心按钮。 */
function openAgent(): void {
  layout.openTab("agent");
}
</script>

<template>
  <div class="bar-actions">
    <Tooltip :text="i18n.t('topbar.aiEditHint')" align="end" :delay="400">
      <button class="ai-cta" data-tour="ai" @click="openAgent">
        <SparklesIcon class="ai-icon" />
        <span class="ai-label">{{ i18n.t("topbar.aiEdit") }}</span>
      </button>
    </Tooltip>

    <Tooltip :text="i18n.t('topbar.save')" align="end">
      <button class="bar-btn" :aria-label="i18n.t('topbar.saveLabel')" @click="actions.saveProject">
        <FloppyDiskIcon class="bar-icon" />
      </button>
    </Tooltip>

    <MenuButton
      v-model:open="fileOpen"
      data-tour="file"
      :sections="fileSections"
      :label="i18n.t('topbar.menu.file')"
      align="end"
      @select="onFileAction"
    >
      <template #trigger="{ open }">
        <Tooltip :text="i18n.t('topbar.menu.file')" align="end">
          <button
            class="bar-btn"
            :class="{ on: open }"
            :aria-label="i18n.t('topbar.menu.file')"
            :aria-expanded="open"
            aria-haspopup="menu"
          >
            <FolderOpenIcon class="bar-icon" />
          </button>
        </Tooltip>
      </template>
    </MenuButton>

    <MenuButton
      v-model:open="helpOpen"
      :sections="helpSections"
      :label="i18n.t('topbar.menu.help')"
      align="end"
      @select="onHelpAction"
    >
      <template #trigger="{ open }">
        <Tooltip :text="i18n.t('topbar.menu.help')" align="end">
          <button
            class="bar-btn"
            :class="{ on: open }"
            :aria-label="i18n.t('topbar.menu.help')"
            :aria-expanded="open"
            aria-haspopup="menu"
          >
            <QuestionMarkCircleIcon class="bar-icon" />
          </button>
        </Tooltip>
      </template>
    </MenuButton>

    <LayoutMenu />

    <Tooltip
      :text="layout.settingsOpen ? i18n.t('topbar.backToWorkspace') : i18n.t('topbar.settings')"
      align="end"
    >
      <button
        class="bar-btn"
        data-tour="settings"
        :class="{ on: layout.settingsOpen }"
        :aria-label="layout.settingsOpen ? i18n.t('topbar.backToWorkspace') : i18n.t('topbar.settings')"
        :aria-expanded="layout.settingsOpen"
        :aria-current="layout.settingsOpen ? 'page' : undefined"
        @click="actions.toggleSettings"
      >
        <Cog6ToothIcon class="bar-icon" />
      </button>
    </Tooltip>
  </div>
</template>

<style scoped>
.bar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  margin-left: auto;
}
/* AI 剪辑：顶栏唯一的实心按钮——它是这个应用的主张，值得占位置。 */
.ai-cta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 15px 0 12px;
  margin-right: 4px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.1px;
  cursor: pointer;
  box-shadow: 0 2px 10px -2px rgb(var(--md-primary) / 0.55);
  transition:
    transform var(--md-duration-short-2) var(--md-ease-standard),
    box-shadow var(--md-duration-medium-1) var(--md-ease-standard),
    filter var(--md-duration-short-2) var(--md-ease-standard);
}
.ai-cta:hover {
  filter: brightness(1.06);
  box-shadow: 0 4px 16px -2px rgb(var(--md-primary) / 0.6);
  transform: translateY(-1px);
}
.ai-cta:active {
  transform: scale(0.97);
}
.ai-cta:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.ai-icon {
  width: 17px;
  height: 17px;
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
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    color var(--md-duration-short-2) var(--md-ease-standard),
    transform var(--md-duration-short-2) var(--md-ease-standard);
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

/* 窄窗口：先把 AI 的文字收起来，保住图标和点击区 */
@media (max-width: 1180px) {
  .ai-label {
    display: none;
  }
  .ai-cta {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar-btn,
  .ai-cta {
    transition: none;
  }
  .bar-btn:active,
  .ai-cta:hover,
  .ai-cta:active {
    transform: none;
  }
}
</style>
