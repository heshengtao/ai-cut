<script setup lang="ts">
/**
 * 剧集平铺卡片：封面、名字、统计与悬浮工具。
 *
 * 单击只是选中，**双击**或右下角「预览」按钮才进预览；拖拽换序仍决定默认时间链。
 */
import { computed, nextTick, ref } from "vue";
import {
  CheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlayIcon,
  QueueListIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { episodeDuration } from "@/core/ops/episodes";
import { assetThumbnailUrl } from "@/core/thumbnails";
import type { Episode } from "@/types/project";

const props = defineProps<{
  episode: Episode;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  dropBefore: boolean;
  draggable: boolean;
  branchCount: number;
  orphan: boolean;
  canRemove: boolean;
}>();

const emit = defineEmits<{
  (e: "open"): void;
  (e: "select"): void;
  (e: "rename", name: string): void;
  (e: "duplicate"): void;
  (e: "remove"): void;
  (e: "dragstart", event: DragEvent): void;
  (e: "dragover", event: DragEvent): void;
  (e: "drop", event: DragEvent): void;
  (e: "dragend"): void;
}>();

const i18n = useI18n();
const project = useProjectStore();

const renaming = ref(false);
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
const duration = computed(() => episodeDuration(props.episode));

/** 封面：第一条有缩略图的片段所属素材。 */
const cover = computed<string | null>(() => {
  for (const track of props.episode.tracks) {
    for (const clip of track.clips) {
      const asset = project.doc.assets.find((item) => item.id === clip.assetId);
      const url = asset ? assetThumbnailUrl(asset) : null;
      if (url) return url;
    }
  }
  return null;
});

const clipCount = computed(() =>
  props.episode.tracks.reduce((sum, track) => sum + track.clips.length, 0),
);

/** 卡片上的时长：mm:ss（超过一小时带小时）。 */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function startRename(): void {
  renaming.value = true;
  renameDraft.value = props.episode.name;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function commitRename(): void {
  if (!renaming.value) return;
  renaming.value = false;
  emit("rename", renameDraft.value);
}
</script>

<template>
  <article
    class="series-card"
    :class="{
      current: active,
      selected,
      dragging,
      'drop-before': dropBefore,
    }"
    :draggable="draggable"
    :aria-current="active ? 'true' : undefined"
    @click="emit('select')"
    @dblclick="emit('open')"
    @dragstart="emit('dragstart', $event)"
    @dragover="emit('dragover', $event)"
    @drop="emit('drop', $event)"
    @dragend="emit('dragend')"
  >
    <div class="series-cover">
      <img v-if="cover" :src="cover" :alt="episode.name" loading="lazy" draggable="false" />
      <div v-else class="series-cover-empty" aria-hidden="true">
        <QueueListIcon />
      </div>
      <span v-if="active" class="series-badge">
        <CheckIcon />
        {{ i18n.t("series.current") }}
      </span>
      <span class="series-time">{{ clock(duration) }}</span>
      <span v-if="branchCount > 1" class="series-branch">
        {{ i18n.t("series.branchCount", { count: branchCount }) }}
      </span>
      <span v-else-if="orphan" class="series-branch">{{ i18n.t("series.orphan") }}</span>
      <button
        type="button"
        class="series-preview"
        :title="i18n.t('series.preview')"
        :aria-label="i18n.t('series.preview')"
        @click.stop="emit('open')"
      >
        <PlayIcon />
      </button>
    </div>

    <div class="series-meta">
      <div class="series-name-row">
        <input
          v-if="renaming"
          ref="renameInput"
          v-model="renameDraft"
          class="series-rename"
          type="text"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = false"
          @blur="commitRename"
        />
        <h3 v-else class="series-name" :title="episode.name">{{ episode.name }}</h3>
      </div>
      <p class="series-stats">
        <span>{{ i18n.t("series.tracks", { count: episode.tracks.length }) }}</span>
        <span class="series-dot" aria-hidden="true">·</span>
        <span>{{ i18n.t("series.clips", { count: clipCount }) }}</span>
      </p>

      <div class="series-tools">
        <button
          type="button"
          :title="i18n.t('common.rename')"
          :aria-label="i18n.t('common.rename')"
          @click.stop="startRename"
        >
          <PencilSquareIcon />
        </button>
        <button
          type="button"
          :title="i18n.t('series.duplicate')"
          :aria-label="i18n.t('series.duplicate')"
          @click.stop="emit('duplicate')"
        >
          <DocumentDuplicateIcon />
        </button>
        <button
          type="button"
          class="danger"
          :title="i18n.t('common.delete')"
          :aria-label="i18n.t('common.delete')"
          :disabled="!canRemove"
          @click.stop="emit('remove')"
        >
          <TrashIcon />
        </button>
        <span class="series-clock">
          <ClockIcon />
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
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
.series-card.selected {
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.55);
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
  top: 8px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background-color: rgb(0 0 0 / 0.55);
}
.series-branch {
  position: absolute;
  left: 8px;
  bottom: 8px;
  height: 18px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 10px;
  line-height: 18px;
  color: rgb(var(--md-on-secondary-container));
  background-color: rgb(var(--md-secondary-container) / 0.92);
}
/* 右下角常驻的预览按钮：不用悬停也能看见、能点。 */
.series-preview {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.92);
  color: rgb(var(--md-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.series-preview:hover {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.series-preview :deep(svg) {
  width: 15px;
  height: 15px;
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
