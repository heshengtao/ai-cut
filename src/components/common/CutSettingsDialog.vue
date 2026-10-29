<script setup lang="ts">
/**
 * 剪口播设置（MD3 模态框）：过滤词、停顿与切点适配。
 *
 * AI 功能里的入口和剪口播面板右上角的齿轮打开的是同一个模态框；
 * 所有改动即时写进 cutReview store（并持久化），不需要「保存」。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowUturnLeftIcon, PlusIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { defaultFillerWords } from "@/core/cutAnalysis";
import type { CutReviewOptions } from "@/core/cutOptions";
import { useCutReviewStore } from "@/stores/cutReview";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";

const cut = useCutReviewStore();
const i18n = useI18n();

const dialogEl = ref<HTMLElement | null>(null);
const draft = ref("");

/** 内置默认词：中英合并，按「直接剪 / 有停顿才剪」分组。 */
const defaults = defaultFillerWords();
const customWords = computed(() => cut.options.custom);
const canRestoreWords = computed(
  () => cut.options.custom.length > 0 || cut.options.disabled.length > 0,
);
const removedDefaults = computed(() => cut.options.disabled.length);
const trimMs = computed(() => Math.round(cut.options.trimPad * 1000));

function secondsLabel(value: number): string {
  return i18n.t("cutReview.settings.seconds", { value: value.toFixed(1) });
}

function trimLabel(value: number): string {
  return i18n.t("cutReview.settings.trimPadValue", { value: Math.round(value * 1000) });
}

/** 滑杆已填充部分的比例：MD3 的轨道从 0 到当前值是主色。 */
function fill(value: number, min: number, max: number): string {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

function addWord(): void {
  const value = draft.value.trim();
  if (!value) return;
  if (!cut.addCustomWord(value)) {
    toast(i18n.t("cutReview.settings.duplicate"), "info");
    return;
  }
  draft.value = "";
  toast(i18n.t("cutReview.settings.added", { word: value }));
}

function onEnter(event: KeyboardEvent): void {
  // 中文输入法选字时的回车不能当成「添加」。
  if (event.isComposing) return;
  event.preventDefault();
  addWord();
}

function removeWord(word: string): void {
  cut.removeWord(word);
}

function restoreWords(): void {
  cut.restoreDefaultWords();
  toast(i18n.t("cutReview.settings.wordsRestored"));
}

function resetAll(): void {
  cut.resetOptions();
  toast(i18n.t("cutReview.settings.allReset"));
}

function close(): void {
  cut.closeSettings();
}

function onRange(key: "minPause" | "keep" | "sentenceKeep", event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  cut.setOptions({ [key]: value } as Partial<CutReviewOptions>);
}

function onTrim(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  cut.setOptions({ trimPad: value / 1000 });
}

function onSoftCut(value: boolean): void {
  cut.setOptions({ includeSoft: value });
}

function onKeyDown(event: KeyboardEvent): void {
  if (!cut.settingsOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

watch(
  () => cut.settingsOpen,
  async (open) => {
    if (!open) {
      draft.value = "";
      return;
    }
    await nextTick();
    dialogEl.value?.focus();
  },
);

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="cut.settingsOpen" class="scrim" @pointerdown.self="close">
        <div
          ref="dialogEl"
          class="dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="i18n.t('cutReview.settings')"
          tabindex="-1"
        >
          <header class="head">
            <div class="head-text">
              <h2 class="title">{{ i18n.t("cutReview.settings") }}</h2>
              <p class="subtitle">{{ i18n.t("cutReview.settings.subtitle") }}</p>
            </div>
            <button class="icon-btn" :aria-label="i18n.t('common.close')" @click="close">
              <XMarkIcon class="icon" />
            </button>
          </header>

          <div class="body">
            <!-- 过滤词 -->
            <section class="section">
              <div class="section-head">
                <h3 class="section-title">{{ i18n.t("cutReview.filterWords") }}</h3>
              </div>
              <p class="section-desc">{{ i18n.t("cutReview.filterWordsHint") }}</p>

              <div class="field-head">
                <span class="field-label">{{ i18n.t("cutReview.settings.custom") }}</span>
                <span class="count">{{ customWords.length }}</span>
              </div>
              <div class="chips">
                <button
                  v-for="word in customWords"
                  :key="word"
                  class="chip custom"
                  type="button"
                  :title="i18n.t('common.remove')"
                  @click="removeWord(word)"
                >
                  <span class="chip-text">{{ word }}</span>
                  <XMarkIcon class="chip-icon" />
                </button>
                <span v-if="customWords.length === 0" class="empty-hint">
                  {{ i18n.t("cutReview.settings.customEmpty") }}
                </span>
              </div>

              <div class="add-row">
                <input
                  v-model="draft"
                  class="add-input md3-field"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  :placeholder="i18n.t('cutReview.filterPlaceholder')"
                  :aria-label="i18n.t('cutReview.settings.custom')"
                  @keydown.enter="onEnter"
                />
                <button class="btn-tonal" :disabled="!draft.trim()" @click="addWord">
                  <PlusIcon class="btn-icon" />
                  {{ i18n.t("cutReview.settings.add") }}
                </button>
              </div>

              <div class="field-head defaults-head">
                <span class="field-label">{{ i18n.t("cutReview.settings.defaultWords") }}</span>
                <button
                  class="btn-text small"
                  :disabled="!canRestoreWords"
                  @click="restoreWords"
                >
                  <ArrowUturnLeftIcon class="btn-icon" />
                  {{ i18n.t("cutReview.settings.restoreWords") }}
                </button>
              </div>

              <p class="group-label">{{ i18n.t("cutReview.settings.hardGroup") }}</p>
              <div class="chips">
                <button
                  v-for="word in defaults.hard"
                  :key="`hard-${word}`"
                  class="chip default"
                  type="button"
                  :title="i18n.t('common.remove')"
                  @click="removeWord(word)"
                >
                  <span class="chip-text">{{ word }}</span>
                  <XMarkIcon class="chip-icon" />
                </button>
              </div>

              <p class="group-label">{{ i18n.t("cutReview.settings.softGroup") }}</p>
              <div class="chips">
                <button
                  v-for="word in defaults.soft"
                  :key="`soft-${word}`"
                  class="chip default"
                  type="button"
                  :title="i18n.t('common.remove')"
                  @click="removeWord(word)"
                >
                  <span class="chip-text">{{ word }}</span>
                  <XMarkIcon class="chip-icon" />
                </button>
              </div>

              <p v-if="removedDefaults > 0" class="removed-note">
                {{ i18n.t("cutReview.settings.removedDefaults", { count: removedDefaults }) }}
              </p>
            </section>

            <!-- 停顿 -->
            <section class="section">
              <h3 class="section-title">{{ i18n.t("cutReview.settings.pause") }}</h3>

              <div class="setting">
                <div class="setting-text">
                  <span class="setting-label">{{ i18n.t("cutReview.settings.minPause") }}</span>
                  <span class="setting-hint">{{ i18n.t("cutReview.settings.minPauseHint") }}</span>
                </div>
                <span class="value-pill">{{ secondsLabel(cut.options.minPause) }}</span>
              </div>
              <input
                class="md3-range"
                type="range"
                min="0.2"
                max="3"
                step="0.1"
                :value="cut.options.minPause"
                :style="{ '--range-fill': fill(cut.options.minPause, 0.2, 3) }"
                :aria-label="i18n.t('cutReview.settings.minPause')"
                @input="onRange('minPause', $event)"
              />

              <div class="setting">
                <div class="setting-text">
                  <span class="setting-label">{{ i18n.t("cutReview.settings.keep") }}</span>
                  <span class="setting-hint">{{ i18n.t("cutReview.settings.keepHint") }}</span>
                </div>
                <span class="value-pill">{{ secondsLabel(cut.options.keep) }}</span>
              </div>
              <input
                class="md3-range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="cut.options.keep"
                :style="{ '--range-fill': fill(cut.options.keep, 0, 1) }"
                :aria-label="i18n.t('cutReview.settings.keep')"
                @input="onRange('keep', $event)"
              />

              <div class="setting">
                <div class="setting-text">
                  <span class="setting-label">{{ i18n.t("cutReview.settings.sentenceKeep") }}</span>
                  <span class="setting-hint">
                    {{ i18n.t("cutReview.settings.sentenceKeepHint") }}
                  </span>
                </div>
                <span class="value-pill">{{ secondsLabel(cut.options.sentenceKeep) }}</span>
              </div>
              <input
                class="md3-range"
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                :value="cut.options.sentenceKeep"
                :style="{ '--range-fill': fill(cut.options.sentenceKeep, 0, 1.5) }"
                :aria-label="i18n.t('cutReview.settings.sentenceKeep')"
                @input="onRange('sentenceKeep', $event)"
              />

              <div class="setting switch-row">
                <div class="setting-text">
                  <span class="setting-label">{{ i18n.t("cutReview.settings.includeSoft") }}</span>
                  <span class="setting-hint">{{ i18n.t("cutReview.settings.includeSoftHint") }}</span>
                </div>
                <ToggleSwitch
                  :model-value="cut.options.includeSoft"
                  :label="i18n.t('cutReview.settings.includeSoft')"
                  @update:model-value="onSoftCut"
                />
              </div>
            </section>

            <!-- 切点适配 -->
            <section class="section">
              <h3 class="section-title">{{ i18n.t("cutReview.settings.trim") }}</h3>
              <div class="setting">
                <div class="setting-text">
                  <span class="setting-label">{{ i18n.t("cutReview.settings.trimPad") }}</span>
                  <span class="setting-hint">{{ i18n.t("cutReview.settings.trimPadHint") }}</span>
                </div>
                <span class="value-pill">{{ trimLabel(cut.options.trimPad) }}</span>
              </div>
              <input
                class="md3-range"
                type="range"
                min="0"
                max="300"
                step="10"
                :value="trimMs"
                :style="{ '--range-fill': fill(trimMs, 0, 300) }"
                :aria-label="i18n.t('cutReview.settings.trimPad')"
                @input="onTrim"
              />
            </section>
          </div>

          <footer class="foot">
            <button class="btn-text" @click="resetAll">
              {{ i18n.t("cutReview.settings.resetAll") }}
            </button>
            <button class="btn-filled" @click="close">
              {{ i18n.t("cutReview.settings.done") }}
            </button>
          </footer>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 320;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(var(--md-scrim) / 0.42);
}

.dialog {
  width: 560px;
  max-width: 100%;
  max-height: min(82vh, 780px);
  display: flex;
  flex-direction: column;
  border-radius: 28px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
  overflow: hidden;
  color: rgb(var(--md-on-surface));
  outline: none;
}

.head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 18px 8px 24px;
}

.head-text {
  flex: 1 1 auto;
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0.1px;
  color: rgb(var(--md-on-surface));
}

.subtitle {
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}

.icon {
  width: 18px;
  height: 18px;
}

.icon-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}

.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}

.icon-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 24px 8px;
}

.section {
  padding: 14px 0 16px;
}

.section + .section {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.55);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: rgb(var(--md-on-surface));
}

.section-desc {
  margin: 4px 0 12px;
  font-size: 12px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-variant));
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.defaults-head {
  margin-top: 18px;
}

.field-label {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface-variant));
}

.count {
  min-width: 20px;
  height: 18px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.chip {
  height: 30px;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 11px;
  border: 1px solid rgb(var(--md-outline-variant));
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.chip:hover {
  border-color: rgb(var(--md-error) / 0.5);
  background-color: rgb(var(--md-error-container) / 0.4);
  color: rgb(var(--md-on-error-container));
}

.chip:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

.chip.custom {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}

.chip.custom:hover {
  background-color: rgb(var(--md-error-container) / 0.6);
  color: rgb(var(--md-on-error-container));
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0.65;
}

.chip:hover .chip-icon {
  opacity: 1;
}

.empty-hint {
  font-size: 11.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
}

.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}

.add-input {
  flex: 1 1 auto;
  min-width: 0;
}

.btn-tonal {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.14s ease;
}

.btn-tonal:hover:not(:disabled) {
  filter: brightness(1.04);
}

.btn-tonal:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-icon {
  width: 13px;
  height: 13px;
}

.group-label {
  margin: 12px 0 6px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: rgb(var(--md-on-surface-muted));
}

.removed-note {
  margin: 10px 0 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}

.setting {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
}

.setting:first-of-type {
  margin-top: 0;
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}

.setting-hint {
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
}

.value-pill {
  flex: 0 0 auto;
  min-width: 60px;
  padding: 3px 9px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.switch-row {
  align-items: center;
  margin-top: 18px;
}

.md3-range {
  display: block;
  margin-top: 4px;
}

/* 已选轨道用主色填充；未选部分沿用全局的 22% 主色。 */
.md3-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    rgb(var(--md-primary)) 0,
    rgb(var(--md-primary)) var(--range-fill, 0%),
    rgb(var(--md-primary) / 0.22) var(--range-fill, 0%),
    rgb(var(--md-primary) / 0.22) 100%
  );
}

.md3-range:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 4px;
  border-radius: 999px;
}

.foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 18px 18px 24px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.4);
}

.btn-text {
  height: 36px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.14s ease;
}

.btn-text:hover:not(:disabled) {
  background-color: rgb(var(--md-primary) / 0.08);
}

.btn-text:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-text.small {
  height: 26px;
  padding: 0 8px;
  font-size: 11px;
}

.btn-filled {
  height: 38px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.14s ease;
}

.btn-filled:hover {
  filter: brightness(1.06);
}

.btn-text:focus-visible,
.btn-filled:focus-visible,
.btn-tonal:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .chip,
  .icon-btn,
  .btn-text,
  .btn-filled,
  .btn-tonal,
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
