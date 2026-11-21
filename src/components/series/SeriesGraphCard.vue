<script setup lang="ts">
/**
 * 连线画布上的一张分P 卡片（对齐画布卡片的外观与交互）。
 *
 * 左右各一个 Handle：左边接入、右边拖出下一步。悬停 / 选中时右上角浮出交互工具栏，
 * 双击节点由 SeriesGraph 统一处理；卡片本身只负责展示与调用传进来的动作。
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Handle, Position } from "@vue-flow/core";
import {
  DocumentDuplicateIcon,
  PauseIcon,
  PencilIcon,
  PencilSquareIcon,
  PlayIcon,
  QueueListIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import { episodeDuration } from "@/core/ops/episodes";
import { fileUrl } from "@/core/media";
import { claimSeriesNodePlayback, releaseSeriesNodePlayback } from "@/composables/useSeriesNodePlayback";
import { toast } from "@/composables/useToast";
import { assetThumbnailUrl } from "@/core/thumbnails";

interface SeriesNodeActions {
  open: (episodeId: string) => void;
  rename: (episodeId: string) => void;
  duplicate: (episodeId: string) => void;
  remove: (episodeId: string) => void;
}

const props = defineProps<{
  id?: string;
  data?: { episodeId?: string; actions?: SeriesNodeActions };
}>();

const i18n = useI18n();
const project = useProjectStore();

const actions = computed(() => props.data?.actions);
const episodeId = computed(() => props.data?.episodeId ?? props.id ?? "");

const episode = computed(
  () => project.doc.episodes.find((item) => item.id === episodeId.value) ?? null,
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

/** 节点内联播放：这一集最早出现的那条视频片段。 */
const primaryClip = computed(() => {
  const target = episode.value;
  if (!target) return null;
  const clips = target.tracks.flatMap((track) => track.clips);
  const video = clips
    .map((clip) => ({ clip, asset: project.doc.assets.find((item) => item.id === clip.assetId) }))
    .filter((item) => item.asset?.kind === "video" && !item.asset.offline)
    .sort((a, b) => a.clip.start - b.clip.start);
  const first = video[0];
  if (!first || !first.asset) return null;
  return {
    src: fileUrl(first.asset.src),
    in: Math.max(0, first.clip.in),
    /** 源文件上要播多久：时间线时长 × 播放速度。 */
    length: Math.max(0.05, first.clip.duration * (first.clip.speed ?? 1)),
    speed: first.clip.speed ?? 1,
  };
});

const player = ref<HTMLVideoElement | null>(null);
const playing = ref(false);
const progress = ref(0);
let stopThis: (() => void) | null = null;

function stopPlayback(): void {
  player.value?.pause();
  playing.value = false;
  progress.value = 0;
  if (stopThis) releaseSeriesNodePlayback(stopThis);
  stopThis = null;
}

async function togglePlayback(): Promise<void> {
  if (playing.value) {
    stopPlayback();
    return;
  }
  const source = primaryClip.value;
  if (!source) {
    toast(i18n.t("series.noVideo"), "info");
    return;
  }
  stopThis = stopPlayback;
  claimSeriesNodePlayback(stopThis);
  playing.value = true;
  progress.value = 0;
  await nextTick();
  const element = player.value;
  if (!element) {
    stopPlayback();
    return;
  }
  element.playbackRate = source.speed;
  try {
    element.currentTime = source.in;
  } catch {
    /* 元数据还没到时 currentTime 可能被拒；loadedmetadata 后会落到默认位置 */
  }
  void element.play().catch(() => stopPlayback());
}

function onTimeUpdate(): void {
  const element = player.value;
  const source = primaryClip.value;
  if (!element || !source) return;
  const offset = Math.max(0, element.currentTime - source.in);
  progress.value = Math.min(1, offset / source.length);
  if (offset >= source.length) stopPlayback();
}

function onEnded(): void {
  stopPlayback();
}

onBeforeUnmount(() => {
  stopPlayback();
});

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}
</script>

<template>
  <article
    class="series-node"
    :class="{ current: episode?.id === project.doc.activeEpisodeId, playing }"
  >
    <Handle id="in" type="target" :position="Position.Left" class="series-handle series-handle-in" />
    <Handle id="out" type="source" :position="Position.Right" class="series-handle series-handle-out" />

    <!--
      交互工具栏：和画布节点一样浮在卡片右上角外侧。
      `series-node-hover` 向下多留 10px 并和卡片重叠 6px —— 鼠标从卡片移向工具栏时
      始终落在同一个 hover 区里，不会掉出去点不到。
    -->
    <div v-if="actions" class="series-node-hover nodrag" @pointerdown.stop @click.stop>
      <div class="series-node-tools">
        <button
          type="button"
          :title="playing ? i18n.t('series.pause') : i18n.t('series.play')"
          :aria-label="playing ? i18n.t('series.pause') : i18n.t('series.play')"
          @click="togglePlayback"
        >
          <PauseIcon v-if="playing" />
          <PlayIcon v-else />
        </button>
        <button
          type="button"
          :title="i18n.t('series.edit')"
          :aria-label="i18n.t('series.edit')"
          @click="actions.open(episodeId)"
        >
          <PencilSquareIcon />
        </button>
        <button
          type="button"
          :title="i18n.t('common.rename')"
          :aria-label="i18n.t('common.rename')"
          @click="actions.rename(episodeId)"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          :title="i18n.t('series.duplicate')"
          :aria-label="i18n.t('series.duplicate')"
          @click="actions.duplicate(episodeId)"
        >
          <DocumentDuplicateIcon />
        </button>
        <button
          type="button"
          class="danger"
          :title="i18n.t('common.delete')"
          :aria-label="i18n.t('common.delete')"
          :disabled="project.doc.episodes.length <= 1 || project.readOnly"
          @click="actions.remove(episodeId)"
        >
          <TrashIcon />
        </button>
      </div>
    </div>

    <div class="series-node-cover">
      <video
        v-if="playing && primaryClip"
        ref="player"
        class="series-node-video"
        :src="primaryClip.src"
        playsinline
        preload="auto"
        draggable="false"
        @timeupdate="onTimeUpdate"
        @ended="onEnded"
      />
      <img
        v-else-if="cover"
        :src="cover"
        :alt="episode?.name ?? ''"
        loading="lazy"
        draggable="false"
      />
      <div v-else class="series-node-cover-empty" aria-hidden="true">
        <QueueListIcon />
      </div>
      <span class="series-node-time">{{ clock(duration) }}</span>
      <span v-if="playing" class="series-node-progress" aria-hidden="true">
        <span :style="{ width: `${Math.round(progress * 100)}%` }" />
      </span>
    </div>

    <div class="series-node-meta">
      <h3 :title="episode?.name">{{ episode?.name }}</h3>
      <p>{{ i18n.t("series.clips", { count: clipCount }) }}</p>
    </div>
  </article>
</template>

<style scoped>
.series-node {
  position: relative;
  width: 100%;
  /* 不要 overflow:hidden：左右 Handle 画在卡片外面，裁掉就抓不到连线。 */
  border-radius: 20px;
  background: var(--node-surface-bg, rgb(var(--md-surface-container-low)));
  border: 1px solid var(--node-surface-border, rgb(var(--md-outline-variant) / 0.38));
  box-shadow: var(--node-surface-shadow, none);
  color: rgb(var(--md-on-surface));
  transition: border-color 0.15s ease;
}
.series-node.current {
  border-color: rgb(var(--md-primary) / 0.9);
}
/* 选中框贴着圆角画，不用 Vue Flow 的直角 outline。 */
.series-node::after {
  content: "";
  position: absolute;
  inset: -3px;
  z-index: 8;
  border: 1.5px solid transparent;
  border-radius: 23px;
  pointer-events: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
:global(.vue-flow__node.selected) .series-node::after {
  border-color: rgb(var(--md-primary) / 0.9);
  box-shadow: 0 0 0 4px rgb(var(--md-primary) / 0.1);
}
:global(.vue-flow__node) {
  border-radius: 20px;
  outline: none;
}
.series-node-cover {
  position: relative;
  height: 108px;
  overflow: hidden;
  border-radius: 19px 19px 0 0;
  background-color: rgb(var(--md-surface-container-highest));
}
.series-node-cover img,
.series-node-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.series-node-video {
  background-color: #000;
}
.series-node-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background-color: rgb(0 0 0 / 0.35);
}
.series-node-progress > span {
  display: block;
  height: 100%;
  background-color: rgb(var(--md-primary));
  transition: width 0.12s linear;
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
  padding: 7px 9px 9px;
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

/* ============ 交互工具栏（画布同款：卡片右上角外侧） ============ */
.series-node-hover {
  position: absolute;
  right: 2px;
  /* 底部和卡片重叠 6px，剩下的 10px 内边距就是鼠标过渡区。 */
  bottom: calc(100% - 6px);
  z-index: 10;
  padding-bottom: 10px;
  opacity: 0;
  transform: translateY(2px);
  pointer-events: none;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.series-node:hover .series-node-hover,
.series-node.playing .series-node-hover,
:global(.vue-flow__node.selected) .series-node-hover,
.series-node-hover:hover,
.series-node-hover:focus-within {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.series-node-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-high) / 0.96);
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  box-shadow: var(--md-elevation-1);
}
.series-node-tools button {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.series-node-tools button :deep(svg) {
  width: 13px;
  height: 13px;
}
.series-node-tools button:first-child {
  color: rgb(var(--md-primary));
}
.series-node-tools button:hover {
  background: rgb(var(--md-on-surface) / 0.08);
  color: rgb(var(--md-on-surface));
}
.series-node-tools button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.series-node-tools button.danger:hover {
  color: rgb(var(--md-error));
}

/* ============ 端口：和画布一样居中贴在左右边，悬停 / 选中才亮 ============ */
.series-handle {
  width: 12px;
  height: 12px;
  border: 2px solid rgb(var(--md-surface-container-lowest));
  border-radius: 999px;
  background: rgb(var(--md-primary));
  box-shadow:
    0 0 0 1px rgb(var(--md-primary) / 0.55),
    0 0 14px rgb(var(--md-primary) / 0.45);
  opacity: 0;
  transition: opacity 0.14s ease, transform 0.14s ease;
  z-index: 9;
}
.series-node:hover .series-handle,
:global(.vue-flow__node.selected) .series-handle {
  opacity: 1;
}
/* 悬停放大的 transform 必须**保留** Vue Flow 的左右平移（±50%），否则端口会
   朝卡片里跳半个宽度，指针随即离开 → 反复进出 → 看起来像抽搐。 */
.series-node .series-handle-in:hover {
  transform: translate(-50%, -50%) scale(1.18);
}
.series-node .series-handle-out:hover {
  transform: translate(50%, -50%) scale(1.18);
}
</style>
