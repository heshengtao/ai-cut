<script setup lang="ts">
/**
 * 启动时的欢迎页：给人一个**明确的起点**，而不是把一屏按钮丢过去。
 *
 * 结构上分两半：左边是插图与品牌（只负责「这是个什么工具」），
 * 右边是一组起步动作 + 一个「先看看界面」的引导入口。第一格永远是推荐项：
 * 有上次的工程就推「打开上次工程」，否则推「打开空白工程」。
 * 默认每次启动都会自动弹出；不想看就在「设置 → 通用 → 启动」里关掉。
 */
import { computed, onMounted, onUnmounted, ref, type Component } from "vue";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ClockIcon,
  DocumentPlusIcon,
  FolderOpenIcon,
  SparklesIcon,
  SquaresPlusIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import HeroCut from "./HeroCut.vue";
import Logo from "@/components/common/Logo.vue";
import { useOnboardingStore } from "@/stores/onboarding";
import { useProjectStore } from "@/stores/project";
import { useI18n } from "@/i18n";
import { displayProjectName } from "@/utils/projectName";
import type { WelcomeStart } from "@/types/onboarding";

const emit = defineEmits<{
  /** 用户选了某个起步动作（由 `App.vue` 执行，因为它才拿得到各种对话框）。 */
  (e: "start", action: WelcomeStart): void;
  (e: "tour"): void;
}>();

const onboarding = useOnboardingStore();
const project = useProjectStore();
const i18n = useI18n();

const root = ref<HTMLElement | null>(null);

const open = computed(() => onboarding.welcomeOpen);

/** 未命名工程按当前语言显示，不把 `untitled` 直接抛给用户。 */
const projectName = computed(() => displayProjectName(project.doc.name));

/** 工程里已经有东西了：标题换个说法，不再说「从零开始」。 */
const hasContent = computed(
  () =>
    project.doc.assets.length > 0 ||
    project.doc.tracks.some((track) => track.clips.length > 0),
);

/**
 * 这次启动有没有「上次的工程」。
 *
 * 启动时会静默恢复上次会话，所以恢复标记最直接；再兜一层文档内容与文件路径，保证从命令行 /
 * 深链直接打开工程时也认得出来。它同时决定标题用「欢迎回来」还是「从零开始」，以及推荐项
 * 是「打开上次工程」还是「打开空白工程」。
 */
const hasLastProject = computed(
  () => project.restoredFromSession || hasContent.value || project.filePath !== null,
);

interface Starter {
  id: WelcomeStart;
  icon: Component;
  title: string;
  sub: string;
  featured: boolean;
}

const starters = computed<Starter[]>(() => {
  const last = hasLastProject.value;

  // 有上次的工程就推荐接着剪；没有就推荐开一张空时间线。两者都放在第一格并标「推荐」。
  const primary: Starter = last
    ? {
        id: "resume",
        icon: ArrowPathIcon,
        title: i18n.t("onboarding.startResume"),
        sub: i18n.t("onboarding.startResumeHint", { name: projectName.value }),
        featured: true,
      }
    : {
        id: "blank",
        icon: DocumentPlusIcon,
        title: i18n.t("onboarding.startBlank"),
        sub: i18n.t("onboarding.startBlankHint"),
        featured: true,
      };

  const rest: Starter[] = [];
  if (last) {
    rest.push({
      id: "blank",
      icon: DocumentPlusIcon,
      title: i18n.t("onboarding.startBlank"),
      sub: i18n.t("onboarding.startBlankHint"),
      featured: false,
    });
  }
  rest.push(
    {
      id: "import",
      icon: ArrowDownTrayIcon,
      title: i18n.t("onboarding.startImport"),
      sub: i18n.t("onboarding.startImportHint"),
      featured: false,
    },
    {
      id: "ai",
      icon: SparklesIcon,
      title: i18n.t("onboarding.startAi"),
      sub: i18n.t("onboarding.startAiHint"),
      featured: false,
    },
    {
      id: "open",
      icon: FolderOpenIcon,
      title: i18n.t("onboarding.startOpen"),
      sub: i18n.t("onboarding.startOpenHint"),
      featured: false,
    },
  );
  if (!last) {
    rest.push({
      id: "history",
      icon: ClockIcon,
      title: i18n.t("onboarding.startHistory"),
      sub: i18n.t("onboarding.startHistoryHint"),
      featured: false,
    });
  }
  return [primary, ...rest];
});

function close(): void {
  onboarding.closeWelcome();
}

function start(action: WelcomeStart): void {
  onboarding.closeWelcome();
  emit("start", action);
}

function startTour(): void {
  emit("tour");
}

/** Tab 在弹窗内循环：不把焦点漏到背后那层已经「不能用」的界面上。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== "Tab") return;
  const box = root.value;
  if (!box) return;
  const focusables = Array.from(
    box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  // 焦点落在第一个起步入口上：键盘用户按一下回车就能开始。
  window.setTimeout(() => root.value?.querySelector<HTMLElement>(".starter")?.focus(), 60);
  window.addEventListener("keydown", onKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <transition name="welcome">
      <div v-if="open" class="scrim" @pointerdown.self="close">
        <div
          ref="root"
          class="card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
        >
          <!-- 左：插图 + 品牌 -->
          <div class="art-panel">
            <div class="brand">
              <Logo :size="26" />
              <span class="brand-name">AI Cut</span>
            </div>
            <HeroCut class="hero" />
            <p class="art-note">
              <SparklesIcon class="art-note-icon" />
              {{ i18n.t("onboarding.heroNote") }}
            </p>
          </div>

          <!-- 右：起点 -->
          <div class="content">
            <button class="close" :aria-label="i18n.t('onboarding.skip')" @click="close">
              <XMarkIcon class="w-[18px] h-[18px]" />
            </button>

            <p class="eyebrow">
              {{ hasLastProject ? i18n.t("onboarding.eyebrowBack") : i18n.t("onboarding.eyebrow") }}
            </p>
            <h1 id="onboarding-title" class="title">
              {{ hasLastProject ? i18n.t("onboarding.titleBack") : i18n.t("onboarding.title") }}
            </h1>
            <p class="subtitle">
              {{ hasLastProject ? i18n.t("onboarding.subBack") : i18n.t("onboarding.subtitle") }}
            </p>

            <div class="starters">
              <button
                v-for="(s, i) in starters"
                :key="s.id"
                class="starter"
                :class="{ featured: s.featured }"
                :style="{ '--i': i }"
                @click="start(s.id)"
              >
                <span class="starter-icon">
                  <component :is="s.icon" class="w-[20px] h-[20px]" />
                </span>
                <span class="starter-text">
                  <span class="starter-title">
                    {{ s.title }}
                    <span v-if="s.featured" class="badge">{{ i18n.t("onboarding.recommended") }}</span>
                  </span>
                  <span class="starter-sub">{{ s.sub }}</span>
                </span>
                <ArrowRightIcon class="starter-arrow" />
              </button>
            </div>

            <div class="project-note">
              <span class="dot" aria-hidden="true" />
              <span class="project-name">
                {{ i18n.t("onboarding.projectNote", { name: projectName }) }}
              </span>
            </div>

            <div class="foot">
              <button class="link" @click="close">{{ i18n.t("onboarding.later") }}</button>
              <button class="tour-btn" @click="startTour">
                <SquaresPlusIcon class="w-[17px] h-[17px]" />
                {{ i18n.t("onboarding.tourCta") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(var(--md-scrim) / 0.5);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.card {
  width: min(960px, 100%);
  max-height: min(660px, 100%);
  display: grid;
  grid-template-columns: 400px minmax(0, 1fr);
  border-radius: 32px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  box-shadow:
    var(--md-elevation-3),
    0 24px 70px -20px rgb(var(--md-scrim) / 0.45);
}

/* ---- 左栏 ---- */
.art-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 22px 18px;
  background:
    radial-gradient(120% 90% at 0% 0%, rgb(var(--md-primary) / 0.16), transparent 62%),
    rgb(var(--md-surface-container));
  border-right: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}
.brand-name {
  font-family: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: rgb(var(--md-on-surface));
}
.hero {
  margin: auto 0;
  border-radius: 24px;
  box-shadow: var(--md-elevation-2);
}
.art-note {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-variant));
}
.art-note-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: rgb(var(--md-primary));
}

/* ---- 右栏 ---- */
.content {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 34px 30px 22px 30px;
  overflow-y: auto;
}
.close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color var(--md-duration-short-2) var(--md-ease-standard);
}
.close:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.close:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--md-primary));
}
.title {
  margin: 0;
  font-size: 27px;
  line-height: 1.22;
  font-weight: 600;
  letter-spacing: -0.4px;
  color: rgb(var(--md-on-surface));
}
.subtitle {
  margin: 8px 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
  max-width: 42ch;
}

.starters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.starter {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 12px 13px 12px;
  border-radius: 18px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  animation: starter-in var(--md-duration-medium-2) var(--md-ease-emphasized-decel) both;
  animation-delay: calc(var(--i) * 28ms + 60ms);
  transition:
    transform var(--md-duration-medium-1) var(--md-ease-standard-decel),
    border-color var(--md-duration-medium-1) var(--md-ease-standard),
    box-shadow var(--md-duration-medium-1) var(--md-ease-standard),
    background-color var(--md-duration-medium-1) var(--md-ease-standard);
}
.starter:hover {
  transform: translateY(-2px);
  border-color: rgb(var(--md-primary) / 0.55);
  box-shadow: var(--md-elevation-2);
}
.starter:active {
  transform: translateY(0) scale(0.995);
}
.starter:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
/* 推荐项：占满整行，底色调成主色容器，一眼看出「先点这个」。 */
.starter.featured {
  grid-column: 1 / -1;
  padding: 15px 14px;
  background-color: rgb(var(--md-primary-container));
  border-color: transparent;
  color: rgb(var(--md-on-primary-container));
}
.starter.featured .starter-title {
  font-size: 14px;
}
.starter.featured .starter-sub {
  font-size: 12px;
  color: rgb(var(--md-on-primary-container) / 0.75);
}
.starter.featured .starter-icon {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-on-primary-container));
}
.starter-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  transition: transform var(--md-duration-medium-1) var(--md-ease-spring-fast);
}
.starter:hover .starter-icon {
  transform: scale(1.06) rotate(-3deg);
}
.starter-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.starter-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1px;
}
.starter-sub {
  font-size: 11.5px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-variant));
}
.badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.starter-arrow {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  align-self: center;
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity var(--md-duration-short-2) var(--md-ease-standard),
    transform var(--md-duration-medium-1) var(--md-ease-spring-fast);
}
.starter:hover .starter-arrow,
.starter:focus-visible .starter-arrow {
  opacity: 1;
  transform: translateX(0);
}

.project-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
  min-width: 0;
}
.project-note .dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.6);
}
.project-note span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 18px;
}
.link {
  border: 0;
  background: transparent;
  padding: 6px 2px;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  border-radius: 8px;
  transition: color var(--md-duration-short-2) var(--md-ease-standard);
}
.link:hover {
  color: rgb(var(--md-on-surface));
  text-decoration: underline;
}
.link:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.tour-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    filter var(--md-duration-short-2) var(--md-ease-standard),
    transform var(--md-duration-short-2) var(--md-ease-standard);
}
.tour-btn:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}
.tour-btn:active {
  transform: scale(0.98);
}
.tour-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}

@keyframes starter-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 过渡：遮罩淡入 + 卡片轻微上浮放大 */
.welcome-enter-active,
.welcome-leave-active {
  transition: opacity var(--md-duration-medium-1) var(--md-ease-standard);
}
.welcome-enter-active .card,
.welcome-leave-active .card {
  transition: transform var(--md-duration-medium-2) var(--md-ease-emphasized-decel);
}
.welcome-enter-from,
.welcome-leave-to {
  opacity: 0;
}
.welcome-enter-from .card,
.welcome-leave-to .card {
  transform: translateY(10px) scale(0.985);
}

/* 窄窗口：插图收起来，优先把「起点」露出来 */
@media (max-width: 860px) {
  .card {
    grid-template-columns: minmax(0, 1fr);
  }
  .art-panel {
    display: none;
  }
  .starters {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .starter {
    animation: none;
  }
  .welcome-enter-active,
  .welcome-leave-active,
  .welcome-enter-active .card,
  .welcome-leave-active .card {
    transition-duration: 1ms;
  }
}
</style>
