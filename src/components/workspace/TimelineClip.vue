<script setup lang="ts">
/** 单个片段块：显示首帧/文字/波形，并提供左右裁剪把手（交互由父层处理）。 */
import { computed, watch } from "vue";
import { DocumentTextIcon } from "@heroicons/vue/24/outline";
import type { Clip, MediaAsset } from "@/types/project";
import { fileUrl } from "@/core/media";
import { cachedWaveform, ensureWaveform } from "@/core/waveform";
import { cachedThumbnail } from "@/core/thumbnails";
import { useProjectStore } from "@/stores/project";
import ClipWaveform from "@/components/common/ClipWaveform.vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  clip: Clip;
  asset: MediaAsset | undefined;
  selected: boolean;
  pxPerSecond: number;
}>();

const emit = defineEmits<{
  (e: "grab", payload: { clipId: string; event: PointerEvent; mode: "move" | "trim-start" | "trim-end" }): void;
  (e: "delete", clipId: string): void;
}>();

const left = computed(() => props.clip.start * props.pxPerSecond);
const width = computed(() => Math.max(2, props.clip.duration * props.pxPerSecond));
const keyframeTimes = computed(() =>
  (props.clip.keyframes ?? []).map((frame) => frame.time),
);
function keyframePercent(time: number): number {
  const duration = Math.max(props.clip.duration, 1e-6);
  return Math.max(0, Math.min(100, (time / duration) * 100));
}
const isText = computed(() => props.clip.assetId === "");
const isAudioOnly = computed(() => props.clip.audioOnly === true);
const thumbUrl = computed(() => {
  const asset = props.asset;
  if (!asset || isAudioOnly.value) return null;
  const thumb = asset.thumb ?? cachedThumbnail(asset.id);
  if (thumb) return fileUrl(thumb);
  // 图片没有缓存缩略图时直接显示原图，保证媒体库与轨道上都有预览。
  return asset.kind === "image" ? fileUrl(asset.src) : null;
});
const isUnavailable = computed(() => props.asset !== undefined && props.asset.offline === true);
const tone = computed(() => {
  if (isText.value) return "tone-text";
  if (isAudioOnly.value || props.asset?.kind === "audio") return "tone-audio";
  if (props.asset?.kind === "image") return "tone-image";
  if (props.asset?.kind === "video") return "tone-primary";
  return "tone-primary";
});

/** 波形数据：优先用本次会话生成的高分辨率版本。 */
const wavePeaks = computed(() => {
  const asset = props.asset;
  if (!asset) return undefined;
  return cachedWaveform(asset.id) ?? asset.wave;
});

/** 是否绘制波形：只有带音频的素材才有。 */
const showWave = computed(() => {
  const asset = props.asset;
  if (!asset || !asset.duration || !wavePeaks.value?.length) return false;
  if (isAudioOnly.value) return true;
  return asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio !== false);
});

const waveClass = computed(() =>
  isAudioOnly.value || props.asset?.kind === "audio" ? "wave-audio" : "wave-video",
);

// 旧工程里的波形只有 64 桶：按需重新生成一次，显示真实的音量起伏。
const project = useProjectStore();
const i18n = useI18n();
watch(
  () => props.asset,
  (asset) => {
    if (!asset) return;
    void ensureWaveform(asset, (wave) => project.setAssetWaveform(asset.id, wave));
    project.backfillThumbnails();
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="clip"
    :class="[
      tone,
      {
        selected,
        unavailable: isUnavailable,
        'has-thumb': !!thumbUrl,
      },
    ]"
    :style="{ left: `${left}px`, width: `${width}px` }"
    @pointerdown="emit('grab', { clipId: clip.id, event: $event, mode: 'move' })"
    @contextmenu.prevent="emit('delete', clip.id)"
  >
    <img
      v-if="thumbUrl"
      class="clip-frame"
      :src="thumbUrl"
      alt=""
      draggable="false"
    />

    <template v-if="isText">
      <DocumentTextIcon class="clip-kind-icon" />
      <span class="clip-text">{{ clip.text }}</span>
    </template>
    <span v-else class="clip-name">{{ asset?.name ?? i18n.t("timeline.missingAsset") }}</span>

    <div v-if="showWave" class="wave" :class="waveClass">
      <ClipWaveform
        :peaks="wavePeaks!"
        :source-duration="asset!.duration"
        :in-point="clip.in"
        :duration="clip.duration"
      />
    </div>

    <span
      v-for="time in keyframeTimes"
      :key="time"
      class="clip-keyframe"
      :style="{ left: `${keyframePercent(time)}%` }"
    />

    <span
      class="handle handle-start"
      @pointerdown.stop="emit('grab', { clipId: clip.id, event: $event, mode: 'trim-start' })"
    />
    <span
      class="handle handle-end"
      @pointerdown.stop="emit('grab', { clipId: clip.id, event: $event, mode: 'trim-end' })"
    />
  </div>
</template>

<style scoped>
.clip {
  position: absolute;
  top: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border-radius: 9px;
  overflow: hidden;
  cursor: grab;
  border: 1px solid transparent;
  user-select: none;
  isolation: isolate;
}
.clip.selected {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: -1px;
}
.clip.unavailable {
  background-image: repeating-linear-gradient(
    45deg,
    rgb(var(--md-error) / 0.18) 0 6px,
    transparent 6px 12px
  );
}
.tone-primary {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
  border-color: rgb(var(--md-primary) / 0.28);
}
.tone-audio {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  border-color: rgb(var(--md-secondary) / 0.28);
}
.tone-image {
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  border-color: rgb(var(--md-outline-variant) / 0.55);
}
.tone-text {
  background-color: rgb(var(--md-tertiary-container) / 0.92);
  color: rgb(var(--md-on-tertiary-container));
  border-color: rgb(var(--md-tertiary) / 0.32);
}
.clip-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.95;
  pointer-events: none;
}
.clip-kind-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0.75;
}
.clip-text,
.clip-name {
  position: relative;
  z-index: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clip-name {
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  color: rgb(255 255 255 / 0.95);
}
/* 视频 / 图片有缩略图时，名称与画面做差值混合：深色画面变浅，浅色画面变深。 */
.clip.has-thumb .clip-name {
  color: #fff;
  text-shadow: none;
  mix-blend-mode: difference;
}
.tone-audio .clip-name,
.tone-text .clip-text {
  color: inherit;
  text-shadow: none;
}
/* 原型里音频片段的名字在左上角，把下半部分留给音量图。 */
.tone-audio .clip-name {
  align-self: flex-start;
  margin-top: 4px;
  font-size: 10px;
}
/* 音量图：和原型一致，占据片段下半部分。 */
.wave {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 50%;
  bottom: 4px;
  opacity: 0.55;
  pointer-events: none;
  overflow: hidden;
}
.wave-audio {
  color: currentColor;
}
/* 视频缩略图上的音量柱：与画面做差值混合——深色画面上变浅，浅色画面上变深。 */
.wave-video {
  opacity: 0.8;
  color: #fff;
  mix-blend-mode: difference;
  filter: none;
}
.clip-keyframe {
  position: absolute;
  bottom: 3px;
  width: 7px;
  height: 7px;
  transform: translateX(-50%) rotate(45deg);
  border: 1px solid rgb(0 0 0 / 0.5);
  border-radius: 1px;
  background-color: #fff;
  box-shadow: 0 0 2px rgb(0 0 0 / 0.45);
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: min(10px, 45%);
  cursor: ew-resize;
  background: transparent;
}
.handle-start {
  left: 0;
}
.handle-end {
  right: 0;
}
/* 悬停时露出裁剪把手：细线 + 圆角端点，和剪辑软件的视觉接近。 */
.clip:hover .handle::after,
.clip.selected .handle::after {
  content: "";
  position: absolute;
  top: 22%;
  bottom: 22%;
  width: 2px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 999px;
  background-color: rgb(255 255 255 / 0.9);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.18);
}
.clip:hover .handle {
  background: rgb(var(--md-primary) / 0.28);
}
</style>
