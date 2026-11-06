<script setup lang="ts">
/**
 * 聚光灯引导：一次只讲一件事，指到界面上的真实位置。
 *
 * 在目标元素外面套一个镂空的矩形，矩形用一圈巨大的 `box-shadow` 把四周压暗
 * （比「四块遮罩拼接」简单，也不会在圆角处露缝）。换步骤时矩形与说明卡都做位置过渡。
 *
 * 目标用 `data-tour="..."` 找：组件内部类名随时可能改，这种标记是给引导用的契约。
 * 找不到就居中显示说明卡（例如面板被收起来了），引导不会卡死。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowLeftIcon, ArrowRightIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import { useOnboardingStore } from "@/stores/onboarding";
import { useLayoutStore } from "@/stores/layout";
import { useI18n } from "@/i18n";

interface TourStep {
  /** `data-tour` 的值。 */
  target: string;
  titleKey: string;
  bodyKey: string;
  placement: "right" | "left" | "below" | "above";
  /** 进入这一步之前要保证的状态（例如打开面板）。 */
  before?: () => void;
}

/** 顺序就是讲故事的顺序：我在哪 → 素材在哪 → 在哪剪 → AI 帮什么 → 怎么保存。 */
const STEPS: TourStep[] = [
  {
    target: "preview",
    titleKey: "onboarding.tour.previewTitle",
    bodyKey: "onboarding.tour.previewBody",
    placement: "left",
  },
  {
    target: "panels",
    titleKey: "onboarding.tour.panelsTitle",
    bodyKey: "onboarding.tour.panelsBody",
    placement: "left",
    before: () => {
      const layout = useLayoutStore();
      layout.showPanel = true;
    },
  },
  {
    target: "timeline",
    titleKey: "onboarding.tour.timelineTitle",
    bodyKey: "onboarding.tour.timelineBody",
    placement: "above",
  },
  {
    target: "ai",
    titleKey: "onboarding.tour.aiTitle",
    bodyKey: "onboarding.tour.aiBody",
    placement: "below",
  },
  {
    target: "file",
    titleKey: "onboarding.tour.fileTitle",
    bodyKey: "onboarding.tour.fileBody",
    placement: "below",
  },
  {
    target: "settings",
    titleKey: "onboarding.tour.settingsTitle",
    bodyKey: "onboarding.tour.settingsBody",
    placement: "below",
  },
];

const onboarding = useOnboardingStore();
const i18n = useI18n();

const CARD_W = 340;
/** 镂空框相对目标外扩的像素：留一点呼吸，也让描边不压住目标自身的边。 */
const HOLE_PAD = 8;

const open = computed(() => onboarding.tourOpen);
const stepIndex = computed(() => onboarding.step);
const step = computed(() => STEPS[Math.min(stepIndex.value, STEPS.length - 1)]!);

const box = ref<{ left: number; top: number; width: number; height: number } | null>(null);
const cardPos = ref<{ left: number; top: number }>({ left: 0, top: 0 });
const missing = ref(false);

/** 当前目标元素（找不到时返回 null）。 */
function targetEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${step.value.target}"]`);
}

/**
 * 量一次位置：先把它滚进视野（只滚最近的可滚祖先），再取矩形。
 * 视口可能比目标还小（小窗 + 大面板），所以最终位置一律往视口里夹。
 */
function measure(): void {
  const el = targetEl();
  if (!el) {
    missing.value = true;
    box.value = null;
    return;
  }
  missing.value = false;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });

  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;

  const left = Math.max(pad, r.left - HOLE_PAD);
  const top = Math.max(pad, r.top - HOLE_PAD);
  const width = Math.min(vw - pad * 2, r.width + HOLE_PAD * 2);
  const height = Math.min(vh - pad * 2, r.height + HOLE_PAD * 2);
  box.value = { left, top, width, height };

  // 说明卡：按 step 声明的方向贴在镂空框外面，再夹进视口。
  const gap = 16;
  let x = left + width + gap;
  let y = top + Math.min(height / 2, 200) - 60;
  if (step.value.placement === "left") x = left - CARD_W - gap;
  if (step.value.placement === "below") {
    x = left + Math.min(width / 2 - CARD_W / 2, width - CARD_W);
    y = top + height + gap;
  }
  if (step.value.placement === "above") {
    x = left + Math.min(width / 2 - CARD_W / 2, width - CARD_W);
    y = top - gap - 190;
  }
  x = Math.max(12, Math.min(x, vw - CARD_W - 12));
  y = Math.max(12, Math.min(y, vh - 200));
  cardPos.value = { left: x, top: y };
}

/** 换步骤后等 DOM 稳定（面板展开 / 视图切换）再量。 */
function remeasure(): void {
  step.value.before?.();
  requestAnimationFrame(() => {
    measure();
    // 有些容器（右侧面板）宽度变化晚一帧，再补量一次。
    window.setTimeout(measure, 140);
  });
}

watch([stepIndex, open], async ([, isOpen]) => {
  if (!isOpen) return;
  await nextTick();
  remeasure();
  focusNext();
});

const isLast = computed(() => stepIndex.value >= STEPS.length - 1);

/** 「下一步」按钮：打开与换步时把焦点放在这里，键盘用户不用 Tab 摸半天。 */
const nextBtn = ref<HTMLElement | null>(null);

function focusNext(): void {
  requestAnimationFrame(() => nextBtn.value?.focus());
}

function next(): void {
  if (isLast.value) finish();
  else onboarding.goStep(stepIndex.value + 1);
}

function prev(): void {
  if (stepIndex.value > 0) onboarding.goStep(stepIndex.value - 1);
}

function finish(): void {
  onboarding.endTour();
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    finish();
  } else if (e.key === "ArrowRight" || e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    next();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    e.stopPropagation();
    prev();
  } else if (e.code === "Space") {
    // 引导期间按空格不该开始播放：把它吃掉。
    e.preventDefault();
    e.stopPropagation();
  }
}

function onResize(): void {
  if (open.value) measure();
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  if (open.value) remeasure();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onResize);
});

const spotStyle = computed(() =>
  box.value
    ? {
        left: `${box.value.left}px`,
        top: `${box.value.top}px`,
        width: `${box.value.width}px`,
        height: `${box.value.height}px`,
      }
    : { display: "none" },
);

const cardStyle = computed(() =>
  missing.value
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : { left: `${cardPos.value.left}px`, top: `${cardPos.value.top}px` },
);
</script>

<template>
  <Teleport to="body">
    <transition name="tour">
      <div
        v-if="open"
        class="tour"
        role="dialog"
        aria-modal="true"
        :aria-label="i18n.t('onboarding.tour.title')"
      >
        <!-- 暗色拦截层：点空白处 = 下一步，不会误触到底下的界面 -->
        <div class="blocker" @pointerdown="next" />

        <!-- 镂空框：一圈巨大的投影把四周压暗 -->
        <div class="spot" :style="spotStyle" aria-hidden="true" />

        <div class="card" :style="cardStyle">
          <div class="card-head">
            <span class="counter">
              {{ i18n.t("onboarding.tour.counter", { n: stepIndex + 1, total: STEPS.length }) }}
            </span>
            <button class="skip" :aria-label="i18n.t('onboarding.tour.skip')" @click="finish">
              <XMarkIcon class="w-[15px] h-[15px]" />
            </button>
          </div>

          <h3 class="card-title">{{ i18n.t(step.titleKey) }}</h3>
          <p class="card-body">{{ i18n.t(step.bodyKey) }}</p>

          <div class="card-foot">
            <div class="dots" aria-hidden="true">
              <span
                v-for="(_, i) in STEPS"
                :key="i"
                class="dot"
                :class="{ on: i === stepIndex, done: i < stepIndex }"
              />
            </div>
            <div class="actions">
              <button v-if="stepIndex > 0" class="nav ghost" @click="prev">
                <ArrowLeftIcon class="w-[15px] h-[15px]" />
                {{ i18n.t("onboarding.tour.prev") }}
              </button>
              <button ref="nextBtn" class="nav primary" @click="next">
                {{ isLast ? i18n.t("onboarding.tour.done") : i18n.t("onboarding.tour.next") }}
                <ArrowRightIcon v-if="!isLast" class="w-[15px] h-[15px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 150;
}
.blocker {
  position: absolute;
  inset: 0;
  cursor: default;
}
.spot {
  position: fixed;
  border-radius: 16px;
  box-shadow:
    0 0 0 2px rgb(var(--md-primary) / 0.9),
    0 0 0 100vmax rgb(var(--md-scrim) / 0.62);
  pointer-events: none;
  transition:
    left var(--md-duration-medium-2) var(--md-ease-emphasized-decel),
    top var(--md-duration-medium-2) var(--md-ease-emphasized-decel),
    width var(--md-duration-medium-2) var(--md-ease-emphasized-decel),
    height var(--md-duration-medium-2) var(--md-ease-emphasized-decel);
}
.spot::after {
  /* 呼吸的描边：提示「就是这里」，但不遮挡内容 */
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  border: 2px solid rgb(var(--md-primary));
  animation: spot-pulse 2.4s ease-in-out infinite;
}
@keyframes spot-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 0.9;
  }
}

.card {
  position: fixed;
  width: 340px;
  padding: 14px 16px 12px;
  border-radius: 20px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  box-shadow:
    var(--md-elevation-3),
    0 18px 46px -18px rgb(var(--md-scrim) / 0.5);
  pointer-events: auto;
  transition:
    left var(--md-duration-medium-2) var(--md-ease-emphasized-decel),
    top var(--md-duration-medium-2) var(--md-ease-emphasized-decel);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.counter {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.6px;
  color: rgb(var(--md-primary));
}
.skip {
  width: 26px;
  height: 26px;
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
.skip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.skip:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.card-title {
  margin: 2px 0 6px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.1px;
  color: rgb(var(--md-on-surface));
}
.card-body {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dots {
  display: flex;
  align-items: center;
  gap: 5px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-on-surface-variant) / 0.3);
  transition:
    width var(--md-duration-medium-1) var(--md-ease-emphasized),
    background-color var(--md-duration-medium-1) var(--md-ease-standard);
}
.dot.done {
  background-color: rgb(var(--md-primary) / 0.5);
}
.dot.on {
  width: 18px;
  background-color: rgb(var(--md-primary));
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nav {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    filter var(--md-duration-short-2) var(--md-ease-standard);
}
.nav.primary {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.nav.primary:hover {
  filter: brightness(1.08);
}
.nav.ghost {
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
}
.nav.ghost:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.nav:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}

.tour-enter-active {
  transition: opacity var(--md-duration-medium-1) var(--md-ease-standard);
}
.tour-leave-active {
  transition: opacity var(--md-duration-short-2) var(--md-ease-standard);
}
.tour-enter-from,
.tour-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .spot,
  .card {
    transition: none;
  }
  .spot::after {
    animation: none;
    opacity: 0.6;
  }
}
</style>
