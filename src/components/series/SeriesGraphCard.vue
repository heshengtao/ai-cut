<script setup lang="ts">
/**
 * 连线画布上的一张分P 卡片。
 *
 * 左右各一个 Handle：左边接入、右边拖出下一步。节点拖拽与双击由 SeriesGraph 统一处理，
 * 卡片只负责展示与「预览」按钮。
 */
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { PlayIcon, QueueListIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { useEpisodeOpen } from "@/composables/useEpisodeOpen";
import { episodeDuration } from "@/core/ops/episodes";
import { assetThumbnailUrl } from "@/core/thumbnails";

const props = defineProps<{
  id?: string;
  data?: { episodeId?: string };
}>();

const i18n = useI18n();
const project = useProjectStore();
const openEpisode = useEpisodeOpen();

const episode = computed(
  () => project.doc.episodes.find((item) => item.id === props.data?.episodeId) ?? null,
);

const cover = computed<string | null>(() => {
  const target = episode.value;
  if (!target) return null;
  for (const track of target.tracks) {
    for (const clip of track.clips) {
      const asset = project.doc.assets.find((item) => item.id === clip.assetId);
      const url = asset ? assetThumbnailUrl(asset) : null;
      if (url) return url;
    }
  }
  return null;
});

const clipCount = computed(() =>
  episode.value
    ? episode.value.tracks.reduce((sum, track) => sum + track.clips.length, 0)
    : 0,
);

const duration = computed(() => (episode.value ? episodeDuration(episode.value) : 0));

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function open(): void {
  if (episode.value) openEpisode(episode.value.id);
}
</script>

<template>
  <article class="series-node" :class="{ current: episode?.id === project.doc.activeEpisodeId }">
    <Handle id="in" type="target" :position="Position.Left" class="series-handle series-handle-in" />
    <Handle id="out" type="source" :position="Position.Right" class="series-handle series-handle-out" />

    <div class="series-node-cover">
      <img v-if="cover" :src="cover" :alt="episode?.name ?? ''" loading="lazy" draggable="false" />
      <div v-else class="series-node-cover-empty" aria-hidden="true">
        <QueueListIcon />
      </div>
      <span class="series-node-time">{{ clock(duration) }}</span>
    </div>

    <div class="series-node-meta">
      <h3 :title="episode?.name">{{ episode?.name }}</h3>
      <p>{{ i18n.t("series.clips", { count: clipCount }) }}</p>
    </div>

    <button
      type="button"
      class="series-node-preview nodrag"
      :title="i18n.t('series.preview')"
      :aria-label="i18n.t('series.preview')"
      @click.stop="open"
    >
      <PlayIcon />
    </button>
  </article>
</template>

<style scoped>
.series-node {
  position: relative;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-low));
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  color: rgb(var(--md-on-surface));
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.series-node.current {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-primary) / 0.5);
}
/* Vue Flow 给选中节点加的类名（库默认），这里只强调描边。 */
:global(.vue-flow__node.selected) .series-node {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.45);
}
.series-node-cover {
  position: relative;
  height: 108px;
  background-color: rgb(var(--md-surface-container-highest));
}
.series-node-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.series-node-cover-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgb(var(--md-on-surface-variant) / 0.5);
}
.series-node-cover-empty :deep(svg) {
  width: 22px;
  height: 22px;
}
.series-node-time {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background-color: rgb(0 0 0 / 0.55);
}
.series-node-meta {
  padding: 7px 9px 8px;
}
.series-node-meta h3 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-node-meta p {
  margin: 2px 0 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.series-node-preview {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high) / 0.95);
  color: rgb(var(--md-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
}
.series-node-preview:hover {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.series-node-preview :deep(svg) {
  width: 14px;
  height: 14px;
}
.series-handle {
  width: 10px;
  height: 10px;
  border: 2px solid rgb(var(--md-surface));
  background-color: rgb(var(--md-primary));
}
.series-handle-in {
  left: -6px;
}
.series-handle-out {
  right: -6px;
}
</style>
