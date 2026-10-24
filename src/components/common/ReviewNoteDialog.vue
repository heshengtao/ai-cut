<script setup lang="ts">
/** 审片批注对话框：名称、备注、严重程度与 resolved 状态。 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { XMarkIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import type { Marker, ReviewSeverity } from "@/types/project";
import type { MarkerPatch } from "@/core/ops";

const props = defineProps<{
  open: boolean;
  marker?: Marker | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "submit", patch: MarkerPatch): void;
}>();

const i18n = useI18n();
const name = ref("");
const note = ref("");
const severity = ref<ReviewSeverity | "">("");
const resolved = ref(false);
const noteEl = ref<HTMLTextAreaElement | null>(null);

const titleText = computed(() => i18n.t("marker.editTitle"));

function severityOptions(): Array<{ value: ReviewSeverity | ""; label: string }> {
  return [
    { value: "", label: i18n.t("marker.severity.none") },
    { value: "blocker", label: i18n.t("marker.severity.blocker") },
    { value: "high", label: i18n.t("marker.severity.high") },
    { value: "medium", label: i18n.t("marker.severity.medium") },
    { value: "low", label: i18n.t("marker.severity.low") },
  ];
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const marker = props.marker;
    name.value = marker?.name ?? "";
    note.value = marker?.note ?? "";
    severity.value = marker?.severity ?? "";
    resolved.value = marker?.resolved === true;
    void nextTick(() => noteEl.value?.focus());
  },
);

function close(): void {
  emit("update:open", false);
}

function submit(): void {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  emit("submit", {
    name: trimmed,
    note: note.value.trim(),
    severity: severity.value === "" ? null : severity.value,
    resolved: resolved.value,
  });
  close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="open" class="scrim" @pointerdown.self="close">
        <div class="dialog" role="dialog" aria-modal="true" :aria-label="titleText">
          <header class="head">
            <h2 class="title">{{ titleText }}</h2>
            <button class="icon-btn" :aria-label="i18n.t('common.close')" @click="close">
              <XMarkIcon class="w-[18px] h-[18px]" />
            </button>
          </header>

          <div class="body">
            <label class="field-label" for="review-name">{{ i18n.t("marker.nameLabel") }}</label>
            <input
              id="review-name"
              v-model="name"
              class="field md3-field"
              type="text"
              spellcheck="false"
              :placeholder="i18n.t('marker.namePlaceholder')"
              @keydown.enter.prevent="submit"
            />

            <label class="field-label" for="review-note">{{ i18n.t("marker.noteLabel") }}</label>
            <textarea
              id="review-note"
              ref="noteEl"
              v-model="note"
              class="field textarea md3-field"
              rows="3"
              spellcheck="false"
              :placeholder="i18n.t('marker.notePlaceholder')"
            />

            <div class="row">
              <label class="field-label" for="review-severity">
                {{ i18n.t("marker.severityLabel") }}
              </label>
              <select id="review-severity" v-model="severity" class="field select md3-field">
                <option v-for="option in severityOptions()" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>

            <label class="check">
              <input v-model="resolved" type="checkbox" />
              <span>{{ i18n.t("marker.resolvedLabel") }}</span>
            </label>
          </div>

          <footer class="foot">
            <button class="btn-text" @click="close">{{ i18n.t("common.cancel") }}</button>
            <button class="btn-filled" :disabled="!name.trim()" @click="submit">
              {{ i18n.t("common.save") }}
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
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(var(--md-scrim) / 0.42);
}
.dialog {
  width: 440px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px 22px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.icon-btn {
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
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 22px 8px;
}
.field-label {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.field {
  width: 100%;
  padding: 0 14px;
  font-size: 14px;
  color: rgb(var(--md-on-surface));
}
input.field,
select.field {
  height: 40px;
}
.textarea {
  padding: 10px 14px;
  resize: vertical;
  min-height: 84px;
  line-height: 1.45;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 13px;
  color: rgb(var(--md-on-surface));
}
.foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
}
.btn-text,
.btn-filled {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn-text {
  background: transparent;
  color: rgb(var(--md-primary));
}
.btn-text:hover {
  background-color: rgb(var(--md-primary) / 0.08);
}
.btn-filled {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.btn-filled:disabled {
  opacity: 0.4;
  cursor: default;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
