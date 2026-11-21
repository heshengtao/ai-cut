<script setup lang="ts">
/**
 * 剧集界面：工程内所有分P 的总览。
 *
 * 两种形态：平铺（网格，拖拽换序仍决定默认时间链）与连线（自由画布，见 SeriesGraph）。
 * 平铺下单击选中、双击 / 右下预览按钮进入预览。
 */
import { computed, ref } from "vue";
import { MagnifyingGlassIcon, PlusIcon, QueueListIcon } from "@heroicons/vue/24/outline";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import SeriesTile from "./SeriesTile.vue";
import SeriesGraph from "./SeriesGraph.vue";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { useEpisodeOpen } from "@/composables/useEpisodeOpen";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import {
  addEpisode,
  duplicateEpisode,
  episodeDuration,
  moveEpisode,
  removeEpisode,
  renameEpisode,
} from "@/core/ops";
import { incoming, isDerived, outgoing } from "@/core/series/graph";
import type { Episode } from "@/types/project";

type SeriesMode = "tile" | "graph";

const i18n = useI18n();
const project = useProjectStore();
const openEpisode = useEpisodeOpen();

const mode = ref<SeriesMode>("tile");
const query = ref("");
const selectedId = ref<string | null>(null);
const draggingId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);

const episodes = computed(() => project.doc.episodes);
const activeId = computed(() => project.doc.activeEpisodeId);

const modes = computed(() => [
  { value: "tile", label: i18n.t("series.view.tile") },
  { value: "graph", label: i18n.t("series.view.graph") },
]);

const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text
    ? episodes.value.filter((episode) => episode.name.toLowerCase().includes(text))
    : [...episodes.value];
});

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

function setMode(value: string): void {
  mode.value = value === "graph" ? "graph" : "tile";
}

function open(episode: Episode): void {
  openEpisode(episode.id);
}

function createEpisode(): void {
  project.dispatch((doc) => addEpisode(doc, defaultEpisodeName()));
}

function duplicate(episode: Episode): void {
  project.dispatch((doc) =>
    duplicateEpisode(doc, episode.id, i18n.t("series.duplicateSuffix", { name: episode.name })),
  );
}

function rename(episode: Episode, name: string): void {
  project.dispatch((doc) => renameEpisode(doc, episode.id, name));
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

/** 出边数：≥2 说明这一集有分叉。 */
function branchCount(episode: Episode): number {
  return outgoing(project.doc, episode.id).length;
}

/** 自定义图里既没有入边也没有出边的孤立分P。 */
function orphan(episode: Episode): boolean {
  if (isDerived(project.doc) || episodes.value.length <= 1) return false;
  return (
    incoming(project.doc, episode.id).length === 0 &&
    outgoing(project.doc, episode.id).length === 0
  );
}

function onDragStart(episode: Episode, event: DragEvent): void {
  if (mode.value !== "tile") return;
  draggingId.value = episode.id;
  event.dataTransfer?.setData("text/plain", episode.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(index: number, event: DragEvent): void {
  if (!draggingId.value || mode.value !== "tile") return;
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
        <label v-if="mode === 'tile'" class="series-search">
          <MagnifyingGlassIcon class="series-search-icon" />
          <input
            v-model="query"
            type="search"
            :placeholder="i18n.t('series.search')"
            :aria-label="i18n.t('series.search')"
          />
        </label>
        <SegmentedControl
          :model-value="mode"
          :options="modes"
          :aria-label="i18n.t('series.viewMode')"
          size="sm"
          @update:model-value="setMode"
        />
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

    <div v-else-if="mode === 'tile' && visible.length === 0" class="series-empty">
      <p class="series-empty-title">{{ i18n.t("series.emptySearch") }}</p>
    </div>

    <div v-else-if="mode === 'tile'" class="series-grid">
      <SeriesTile
        v-for="(episode, index) in visible"
        :key="episode.id"
        :episode="episode"
        :active="episode.id === activeId"
        :selected="selectedId === episode.id"
        :dragging="draggingId === episode.id"
        :drop-before="dropIndex === index"
        :draggable="true"
        :branch-count="branchCount(episode)"
        :orphan="orphan(episode)"
        :can-remove="episodes.length > 1"
        @select="selectedId = episode.id"
        @open="open(episode)"
        @rename="(name) => rename(episode, name)"
        @duplicate="duplicate(episode)"
        @remove="remove(episode)"
        @dragstart="onDragStart(episode, $event)"
        @dragover="onDragOver(index, $event)"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      />
    </div>

    <SeriesGraph v-else @open="openEpisode" />
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
</style>
