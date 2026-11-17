<script setup lang="ts">
/**
 * 剧集界面：工程内所有分P 的总览。
 *
 * 一个工程 = 一部剧，分P = 工程内的一条独立时间线（素材 / 画布工程级共享）。
 * 点卡片 = 切到该分P 并回到预览界面，播放头归零。
 */
import { computed, nextTick, ref } from "vue";
import {
  CheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  QueueListIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { useViewStore } from "@/stores/view";
import {
  addEpisode,
  duplicateEpisode,
  episodeDuration,
  moveEpisode,
  removeEpisode,
  renameEpisode,
} from "@/core/ops";
import { assetThumbnailUrl } from "@/core/thumbnails";
import PanelIcon from "@/components/common/PanelIcon.vue";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import type { Episode } from "@/types/project";

type SortMode = "manual" | "duration";

const i18n = useI18n();
const project = useProjectStore();
const playback = usePlaybackStore();
const layout = useLayoutStore();
const view = useViewStore();

const query = ref("");
const sort = ref<SortMode>("manual");
const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
const draggingId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);

const episodes = computed(() => project.doc.episodes);
const activeId = computed(() => project.doc.activeEpisodeId);

const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  const list = text
    ? episodes.value.filter((episode) => episode.name.toLowerCase().includes(text))
    : [...episodes.value];
  if (sort.value === "duration") {
    return [...list].sort((a, b) => episodeDuration(b) - episodeDuration(a));
  }
  return list;
});

/** 分P 封面：第一条有缩略图的片段所属素材。 */
function cover(episode: Episode): string | null {
  for (const track of episode.tracks) {
    for (const clip of track.clips) {
      const asset = project.doc.assets.find((item) => item.id === clip.assetId);
      const url = asset ? assetThumbnailUrl(asset) : null;
      if (url) return url;
    }
  }
  return null;
}

function clipCount(episode: Episode): number {
  return episode.tracks.reduce((sum, track) => sum + track.clips.length, 0);
}

/** 卡片上的时长：mm:ss（超过一小时带小时）。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function defaultEpisodeName(): string {
  return i18n.t("series.newEpisodeName", { index: episodes.value.length + 1 });
}

/** 点击卡片：切分P + 回预览 + 播放头归零（当前分P 只做后两步）。 */
function open(episode: Episode): void {
  if (renamingId.value === episode.id) return;
  if (episode.id !== activeId.value) project.switchEpisode(episode.id);
  playback.setPlayhead(0);
  view.setView("preview");
}

function createEpisode(): void {
  project.dispatch((doc) => addEpisode(doc, defaultEpisodeName()));
}

function duplicate(episode: Episode): void {
  project.dispatch((doc) =>
    duplicateEpisode(doc, episode.id, i18n.t("series.duplicateSuffix", { name: episode.name })),
  );
}

function startRename(episode: Episode): void {
  renamingId.value = episode.id;
  renameDraft.value = episode.name;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function commitRename(): void {
  const id = renamingId.value;
  renamingId.value = null;
  if (!id) return;
  project.dispatch((doc) => renameEpisode(doc, id, renameDraft.value));
}

async function remove(episode: Episode): Promise<void> {
  if (episodes.value.length <= 1) {
    toast(i18n.t("series.keepLast"), "info");
    return;
  }
  const accepted = await confirm({
    title: i18n.t("series.deleteTitle"),
    message: i18n.t("series.deleteMessage", { name: episode.name }),
    confirmText: i18n.t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;
  project.dispatch((doc) => removeEpisode(doc, episode.id));
}

function onDragStart(episode: Episode, event: DragEvent): void {
  if (sort.value !== "manual") return;
  draggingId.value = episode.id;
  event.dataTransfer?.setData("text/plain", episode.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(index: number, event: DragEvent): void {
  if (!draggingId.value || sort.value !== "manual") return;
  event.preventDefault();
  dropIndex.value = index;
}

function onDrop(index: number, event: DragEvent): void {
  event.preventDefault();
  const id = draggingId.value;
  draggingId.value = null;
  dropIndex.value = null;
  if (!id) return;
  project.dispatch((doc) => moveEpisode(doc, id, index));
}

function onDragEnd(): void {
  draggingId.value = null;
  dropIndex.value = null;
}

const totalDuration = computed(() =>
  episodes.value.reduce((sum, episode) => sum + episodeDuration(episode), 0),
);
</script>

<template>
  <section class="series-view" data-view="series">
    <header class="series-head">
      <div class="series-title">
        <QueueListIcon class="series-title-icon" />
        <h2>{{ i18n.t("series.title") }}</h2>
        <span class="series-count">
          {{ i18n.t("series.total", { count: episodes.length }) }}
        </span>
        <span class="series-duration">{{ clock(totalDuration) }}</span>
      </div>

      <div class="series-actions">
        <label class="series-search">
          <MagnifyingGlassIcon class="series-search-icon" />
          <input
            v-model="query"
            type="search"
            :placeholder="i18n.t('series.search')"
            :aria-label="i18n.t('series.search')"
          />
        </label>
        <div class="series-sort" role="group" :aria-label="i18n.t('series.sort')">
          <button
            type="button"
            :class="{ on: sort === 'manual' }"
            @click="sort = 'manual'"
          >
            {{ i18n.t("series.sortManual") }}
          </button>
          <button
            type="button"
            :class="{ on: sort === 'duration' }"
            @click="sort = 'duration'"
          >
            {{ i18n.t("series.sortDuration") }}
          </button>
        </div>
        <button
          class="series-timeline"
          type="button"
          :class="{ on: layout.showTimeline }"
          :title="layout.showTimeline ? i18n.t('board.hideTimeline') : i18n.t('board.showTimeline')"
          :aria-label="layout.showTimeline ? i18n.t('board.hideTimeline') : i18n.t('board.showTimeline')"
          :aria-expanded="layout.showTimeline"
          @click="layout.showTimeline = !layout.showTimeline"
        >
          <PanelIcon side="bottom" :filled="layout.showTimeline" />
          <span>{{ i18n.t("series.timeline") }}</span>
        </button>
        <button class="series-new" type="button" @click="createEpisode">
          <PlusIcon class="series-new-icon" />
          <span>{{ i18n.t("series.newEpisode") }}</span>
        </button>
      </div>
    </header>

    <div v-if="episodes.length === 0" class="series-empty">
      <p class="series-empty-title">{{ i18n.t("series.empty") }}</p>
      <p class="series-empty-hint">{{ i18n.t("series.emptyHint") }}</p>
      <button class="series-new" type="button" @click="createEpisode">
        <PlusIcon class="series-new-icon" />
        <span>{{ i18n.t("series.newEpisode") }}</span>
      </button>
    </div>

    <div v-else-if="visible.length === 0" class="series-empty">
      <p class="series-empty-title">{{ i18n.t("series.emptySearch") }}</p>
    </div>

    <div v-else class="series-grid">
      <article
        v-for="(episode, index) in visible"
        :key="episode.id"
        class="series-card"
        :class="{
          current: episode.id === activeId,
          dragging: draggingId === episode.id,
          'drop-before': dropIndex === index && sort === 'manual',
        }"
        :draggable="sort === 'manual'"
        @click="open(episode)"
        @dragstart="onDragStart(episode, $event)"
        @dragover="onDragOver(index, $event)"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      >
        <div class="series-cover">
          <img v-if="cover(episode)" :src="cover(episode)!" :alt="episode.name" loading="lazy" />
          <div v-else class="series-cover-empty" aria-hidden="true">
            <QueueListIcon />
          </div>
          <span v-if="episode.id === activeId" class="series-badge">
            <CheckIcon />
            {{ i18n.t("series.current") }}
          </span>
          <span class="series-time">{{ clock(episodeDuration(episode)) }}</span>
        </div>

        <div class="series-meta">
          <div class="series-name-row">
            <input
              v-if="renamingId === episode.id"
              ref="renameInput"
              v-model="renameDraft"
              class="series-rename"
              type="text"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="renamingId = null"
              @blur="commitRename"
            />
            <h3 v-else class="series-name" :title="episode.name">{{ episode.name }}</h3>
          </div>
          <p class="series-stats">
            <span>{{ i18n.t("series.tracks", { count: episode.tracks.length }) }}</span>
            <span class="series-dot" aria-hidden="true">·</span>
            <span>{{ i18n.t("series.clips", { count: clipCount(episode) }) }}</span>
          </p>

          <div class="series-tools">
            <button
              type="button"
              :title="i18n.t('common.rename')"
              :aria-label="i18n.t('common.rename')"
              @click.stop="startRename(episode)"
            >
              <PencilSquareIcon />
            </button>
            <button
              type="button"
              :title="i18n.t('series.duplicate')"
              :aria-label="i18n.t('series.duplicate')"
              @click.stop="duplicate(episode)"
            >
              <DocumentDuplicateIcon />
            </button>
            <button
              type="button"
              class="danger"
              :title="i18n.t('common.delete')"
              :aria-label="i18n.t('common.delete')"
              :disabled="episodes.length <= 1"
              @click.stop="remove(episode)"
            >
              <TrashIcon />
            </button>
            <span class="series-clock">
              <ClockIcon />
            </span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.series-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--app-bg);
  background-image: var(--app-wash);
}
.series-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.4);
}
.series-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.series-title-icon {
  width: 18px;
  height: 18px;
  color: rgb(var(--md-primary));
}
.series-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.series-count,
.series-duration {
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
}
.series-duration {
  font-variant-numeric: tabular-nums;
}
.series-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.series-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background-color: rgb(var(--md-on-surface-variant) / 0.08);
}
.series-search-icon {
  width: 15px;
  height: 15px;
  color: rgb(var(--md-on-surface-variant));
}
.series-search input {
  width: 140px;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
}
.series-sort {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-on-surface-variant) / 0.08);
}
.series-sort button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.series-sort button.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.series-timeline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  cursor: pointer;
}
.series-timeline.on {
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container));
  border-color: transparent;
}
.series-timeline:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.1);
}
.series-timeline :deep(svg) {
  width: 15px;
  height: 15px;
}
.series-new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary));
  cursor: pointer;
}
.series-new:hover {
  filter: brightness(1.05);
}
.series-new-icon {
  width: 15px;
  height: 15px;
}
.series-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}
.series-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.series-empty-hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface-variant));
}
.series-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 28px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}
.series-card {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.series-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.12);
  border-color: rgb(var(--md-primary) / 0.45);
}
.series-card.current {
  border-color: rgb(var(--md-primary));
}
.series-card.dragging {
  opacity: 0.55;
}
.series-card.drop-before::before {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  top: -7px;
  height: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.series-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-color: rgb(var(--md-surface-container-highest));
}
.series-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.series-cover-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgb(var(--md-on-surface-variant) / 0.5);
}
.series-cover-empty :deep(svg) {
  width: 26px;
  height: 26px;
}
.series-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--md-on-primary));
  background-color: rgb(var(--md-primary) / 0.92);
}
.series-badge :deep(svg) {
  width: 12px;
  height: 12px;
}
.series-time {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background-color: rgb(0 0 0 / 0.55);
}
.series-meta {
  padding: 9px 10px 8px;
}
.series-name-row {
  min-height: 20px;
}
.series-name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-rename {
  width: 100%;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-primary));
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: rgb(var(--md-on-surface));
  outline: none;
}
.series-stats {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.series-dot {
  margin: 0 4px;
}
.series-tools {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.95);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.series-card:hover .series-tools,
.series-card:focus-within .series-tools {
  opacity: 1;
}
.series-tools button {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.series-tools button:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.series-tools button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.series-tools button.danger:hover {
  color: rgb(var(--md-error));
}
.series-tools button :deep(svg) {
  width: 14px;
  height: 14px;
}
.series-clock {
  display: none;
}
</style>
