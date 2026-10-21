<script setup lang="ts">
/**
 * 历史工程：宽模态框里铺一排工程卡片，封面用工程里第一段视频 / 图片的缩略图。
 *
 * 每次打开都先等落盘队列清空再取列表——刚才被替换掉的工程这时才出现在历史里。
 * 点卡片直接恢复；恢复前后端会把当前工程也记入历史，所以来回切换不会丢东西。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ClockIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import type { ProjectHistoryEntry } from "@/types/project";
import { fileUrl } from "@/core/media";
import {
  deleteProjectHistory,
  flushHistoryRecords,
  listProjectHistory,
} from "@/core/history";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useI18n } from "@/i18n";
import { displayProjectName } from "@/utils/projectName";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const i18n = useI18n();
const project = useProjectStore();
const playback = usePlaybackStore();
const selection = useSelectionStore();

const entries = ref<ProjectHistoryEntry[]>([]);
const loading = ref(false);
const restoring = ref<string | null>(null);
const deleting = ref<string | null>(null);
const failedThumbs = ref<string[]>([]);

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(i18n.locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
);

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
);

function close(): void {
  emit("update:open", false);
}

async function load(): Promise<void> {
  loading.value = true;
  failedThumbs.value = [];
  try {
    await flushHistoryRecords();
    entries.value = await listProjectHistory();
  } catch (error) {
    toast(
      i18n.t("history.failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    loading.value = false;
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updatedAt(entry: ProjectHistoryEntry): string {
  return dateFormat.value.format(new Date(entry.saved_at));
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function meta(entry: ProjectHistoryEntry): string {
  return [
    formatDuration(entry.duration),
    i18n.t("history.tracks", { count: entry.track_count }),
    i18n.t("history.clips", { count: entry.clip_count }),
  ].join(" · ");
}

function cover(entry: ProjectHistoryEntry): string | null {
  if (!entry.thumbnail || failedThumbs.value.includes(entry.id)) return null;
  return fileUrl(entry.thumbnail);
}

function onCoverError(entry: ProjectHistoryEntry): void {
  failedThumbs.value = [...failedThumbs.value, entry.id];
}

async function choose(entry: ProjectHistoryEntry): Promise<void> {
  if (restoring.value || deleting.value) return;
  restoring.value = entry.id;
  try {
    playback.playing = false;
    await project.restoreHistory(entry.id);
    selection.clear();
    selection.setActiveTrack(null);
    playback.setPlayhead(0);
    toast(i18n.t("history.restored", { name: displayProjectName(entry.name) }));
    close();
  } catch (error) {
    toast(
      i18n.t("history.restoreFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    restoring.value = null;
  }
}

async function remove(entry: ProjectHistoryEntry): Promise<void> {
  if (restoring.value || deleting.value) return;
  const accepted = await confirm({
    title: i18n.t("history.deleteTitle"),
    message: i18n.t("history.deleteMessage", {
      name: displayProjectName(entry.name),
    }),
    confirmText: i18n.t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;

  deleting.value = entry.id;
  try {
    await deleteProjectHistory(entry.id);
    entries.value = entries.value.filter((item) => item.id !== entry.id);
    toast(i18n.t("history.deleted"));
  } catch (error) {
    toast(
      i18n.t("history.deleteFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    deleting.value = null;
  }
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
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="i18n.t('history.title')"
          :aria-busy="loading || restoring !== null"
          tabindex="-1"
        >
          <div
            v-if="loading || restoring"
            class="top-progress"
            role="progressbar"
            :aria-label="i18n.t('history.loading')"
          >
            <div class="top-progress-fill" />
          </div>

          <header class="head">
            <h2 class="title">{{ i18n.t("history.title") }}</h2>
            <button class="icon-btn" :aria-label="i18n.t('common.close')" @click="close">
              <XMarkIcon class="w-[18px] h-[18px]" />
            </button>
          </header>

          <div class="body">
            <div v-if="loading" class="state">
              <p>{{ i18n.t("history.loading") }}</p>
            </div>

            <div v-else-if="entries.length === 0" class="state">
              <ClockIcon class="w-8 h-8 state-icon" />
              <p class="state-title">{{ i18n.t("history.empty") }}</p>
              <p class="state-hint">{{ i18n.t("history.emptyHint") }}</p>
            </div>

            <div v-else class="grid">
              <div
                v-for="entry in entries"
                :key="entry.id"
                class="card"
                :class="{
                  restoring: restoring === entry.id,
                  busy: restoring !== null || deleting !== null,
                }"
              >
                <button
                  class="card-open"
                  type="button"
                  :disabled="restoring !== null || deleting !== null"
                  :aria-label="displayProjectName(entry.name)"
                  @click="choose(entry)"
                >
                  <span class="thumb">
                    <img
                      v-if="cover(entry)"
                      class="thumb-img"
                      :src="cover(entry) ?? undefined"
                      :alt="displayProjectName(entry.name)"
                      @error="onCoverError(entry)"
                    />
                    <span v-else class="thumb-empty">
                      <FilmIcon class="w-7 h-7" />
                    </span>

                    <span v-if="entry.dirty" class="unsaved-badge">
                      {{ i18n.t("history.dirty") }}
                    </span>
                  </span>

                  <span class="card-body">
                    <span class="name-row">
                      <span class="name">{{ displayProjectName(entry.name) }}</span>
                      <span v-if="entry.dirty" class="dirty-dot" aria-hidden="true" />
                    </span>
                    <span class="meta">{{ meta(entry) }}</span>
                    <span class="foot-row">
                      <span class="date">{{ updatedAt(entry) }}</span>
                      <span class="path" :title="entry.path ?? undefined">
                        {{ entry.path ? fileName(entry.path) : i18n.t("history.unsaved") }}
                      </span>
                    </span>
                  </span>
                </button>

                <button
                  class="delete-btn"
                  type="button"
                  :disabled="restoring !== null || deleting !== null"
                  :aria-label="i18n.t('history.delete')"
                  :title="i18n.t('history.delete')"
                  @click="remove(entry)"
                >
                  <TrashIcon class="w-[15px] h-[15px]" />
                </button>
              </div>
            </div>
          </div>

          <footer v-if="entries.length > 0 && !loading" class="foot">
            <ExclamationTriangleIcon class="foot-icon" />
            <span>{{ i18n.t("history.hint") }}</span>
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
  position: relative;
  width: min(1100px, calc(100vw - 48px));
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
  overflow: hidden;
}
.top-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 2;
  overflow: hidden;
  background-color: rgb(var(--md-primary) / 0.14);
}
.top-progress-fill {
  width: 38%;
  height: 100%;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  animation: history-progress 1.1s ease-in-out infinite;
}
@keyframes history-progress {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(365%);
  }
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 10px 22px;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 22px 18px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}
.card {
  position: relative;
  border: 1px solid rgb(var(--md-outline-variant) / 0.55);
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container));
  overflow: hidden;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.card:hover {
  transform: translateY(-2px);
  border-color: rgb(var(--md-primary) / 0.65);
  box-shadow: var(--md-elevation-2);
}
.card.busy:hover {
  transform: none;
  border-color: rgb(var(--md-outline-variant) / 0.55);
  box-shadow: none;
}
.card.restoring {
  border-color: rgb(var(--md-primary) / 0.65);
}
.card.restoring:hover {
  border-color: rgb(var(--md-primary) / 0.65);
}
.card-open {
  display: flex;
  width: 100%;
  flex-direction: column;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.card-open:disabled {
  cursor: default;
}
.card-open:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: -2px;
}
.delete-btn {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background-color: rgba(10, 8, 13, 0.62);
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.14s ease, background-color 0.14s ease, color 0.14s ease;
  backdrop-filter: blur(4px);
}
.card:hover .delete-btn,
.delete-btn:focus-visible {
  opacity: 1;
}
.delete-btn:hover {
  background-color: rgb(var(--md-error));
  color: rgb(var(--md-on-error));
}
.delete-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.delete-btn:disabled {
  opacity: 0;
  cursor: default;
}
.thumb {
  position: relative;
  display: flex;
  width: 100%;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 130% at 12% 0%, rgb(var(--md-primary) / 0.16), transparent 58%),
    linear-gradient(150deg, #1d1a24, #141218 72%);
  overflow: hidden;
}
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-empty {
  color: rgba(255, 255, 255, 0.32);
}
.unsaved-badge {
  position: absolute;
  top: 7px;
  left: 7px;
  padding: 2px 7px;
  border-radius: 999px;
  background-color: rgba(10, 8, 13, 0.68);
  color: rgba(255, 255, 255, 0.86);
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.2px;
  backdrop-filter: blur(4px);
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px 11px;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.name {
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dirty-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.meta {
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.foot-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.date {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant) / 0.85);
  white-space: nowrap;
}
.path {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant) / 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 280px;
  color: rgb(var(--md-on-surface-variant));
}
.state p {
  margin: 0;
  font-size: 12.5px;
}
.state-icon {
  opacity: 0.55;
}
.state .state-title {
  font-size: 14px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.state-hint {
  max-width: 380px;
  text-align: center;
  line-height: 1.5;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 22px 14px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.4);
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.foot-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
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
  .card {
    transition: none;
  }
  .top-progress-fill {
    animation: none;
    width: 100%;
    opacity: 0.7;
  }
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
