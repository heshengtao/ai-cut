<script setup lang="ts">
/**
 * 画布视频播放器：显示节点的整张卡和模型节点（含插件节点）的输出附件共用这一套。
 *
 * 之前两处是两套实现——显示节点自绘播放条，输出附件卡直接用浏览器原生
 * `<video controls>`——所以同一个视频在两处的播放条、留白、圆角都对不上。
 *
 * 两个必须一起做的事：
 * 1. **首帧**：`preload="metadata"` 只取时长 / 尺寸，不解码画面，元素默认是一块黑。
 *    这里先用素材缩略图当 `poster` 垫着，元数据到了再把时间定位到 0 之后的第一帧，
 *    浏览器才会把画面画出来。只做一次，用户暂停 / 拖动后不再抢回 0。
 * 2. **铺满**：`fill` 为真时播放器铺满父容器（显示节点整卡，圆角由卡片裁），
 *    为假时按画面比例自适应（输出附件卡，宽度跟着卡片走）。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import {
  ArrowsPointingOutIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/vue/24/outline";

const props = withDefaults(
  defineProps<{
    src: string;
    /** 素材缩略图：元数据到达前先垫一帧，避免默认黑屏。 */
    poster?: string | null;
    /** 铺满父容器（显示节点的整张卡）；false = 按画面比例自适应（附件卡）。 */
    fill?: boolean;
  }>(),
  { poster: null, fill: false },
);

const emit = defineEmits<{
  /** 元数据到了：宽高给父级按素材比例改节点尺寸，时长给播放条。 */
  meta: [meta: { width: number; height: number; duration: number }];
  error: [];
}>();

const i18n = useI18n();
const videoEl = ref<HTMLVideoElement | null>(null);
const playing = ref(false);
const muted = ref(false);
const time = ref(0);
const duration = ref(0);
/** 首帧是否已经定位过：同一个 src 只做一次。 */
let framed = false;

const progress = computed(() =>
  duration.value > 0 ? Math.min(100, (time.value / duration.value) * 100) : 0,
);

function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function onMeta(): void {
  const el = videoEl.value;
  if (!el) return;
  if (Number.isFinite(el.duration)) duration.value = el.duration;
  emit("meta", { width: el.videoWidth, height: el.videoHeight, duration: el.duration });
  // 首帧：定位到 0 之后的一点点，逼浏览器解码并画出第一帧（poster 只是兜底）。
  if (framed || !el.paused) return;
  framed = true;
  if (el.currentTime > 0.001) return;
  try {
    el.currentTime = 0.001;
  } catch {
    /* 不支持定位的容器：停在 poster 上，至少不是黑屏 */
  }
}

function onTime(): void {
  const el = videoEl.value;
  if (el) time.value = el.currentTime;
}

function toggle(): void {
  const el = videoEl.value;
  if (!el) return;
  if (el.paused) void el.play().catch(() => undefined);
  else el.pause();
}

function seek(event: MouseEvent): void {
  const el = videoEl.value;
  if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
  el.currentTime = ratio * el.duration;
  time.value = el.currentTime;
}

function toggleMute(): void {
  const el = videoEl.value;
  if (!el) return;
  el.muted = !el.muted;
  muted.value = el.muted;
}

function fullscreen(): void {
  const stage = videoEl.value?.parentElement;
  void stage?.requestFullscreen?.().catch(() => undefined);
}

// 换片：重置进度与首帧标记，新视频重新垫 poster、重新定位第一帧。
watch(
  () => props.src,
  () => {
    framed = false;
    playing.value = false;
    time.value = 0;
    duration.value = 0;
  },
);

// 组件销毁（收起附件 / 切换节点）时停掉播放，别让声音留在后台。
onBeforeUnmount(() => videoEl.value?.pause());
</script>

<template>
  <div class="bv-stage" :data-playing="playing ? 'true' : 'false'" :data-fill="fill ? 'true' : 'false'">
    <video
      ref="videoEl"
      :src="src"
      :poster="poster ?? undefined"
      preload="metadata"
      playsinline
      @click="toggle"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @loadedmetadata="onMeta"
      @timeupdate="onTime"
      @error="emit('error')"
    />
    <button
      v-if="!playing"
      class="bv-orb"
      type="button"
      :aria-label="i18n.t('board.node.play')"
      @pointerdown.stop
      @click.stop="toggle"
    >
      <PlayIcon />
    </button>
    <div class="bv-controls nodrag" @pointerdown.stop>
      <button
        class="bv-control bv-control-primary"
        type="button"
        :aria-label="playing ? i18n.t('board.node.pause') : i18n.t('board.node.play')"
        @click.stop="toggle"
      >
        <component :is="playing ? PauseIcon : PlayIcon" />
      </button>
      <span class="bv-time">{{ clockText(time) }} / {{ clockText(duration) }}</span>
      <div class="bv-track" @click.stop="seek">
        <span class="bv-track-rail" />
        <span class="bv-track-fill" :style="{ width: `${progress}%` }" />
        <span class="bv-track-thumb" :style="{ left: `clamp(6px, ${progress}%, calc(100% - 6px))` }" />
      </div>
      <button
        class="bv-control"
        type="button"
        :aria-label="muted ? i18n.t('board.node.unmute') : i18n.t('board.node.mute')"
        @click.stop="toggleMute"
      >
        <component :is="muted ? SpeakerXMarkIcon : SpeakerWaveIcon" />
      </button>
      <button
        class="bv-control"
        type="button"
        :aria-label="i18n.t('board.node.fullscreen')"
        @click.stop="fullscreen"
      >
        <ArrowsPointingOutIcon />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 舞台：显示节点的整卡（fill）或附件卡里的一段（自适应高度）。 */
.bv-stage {
  position: relative;
  display: block;
  width: 100%;
  border-radius: inherit;
  overflow: hidden;
  background: rgb(8 6 12 / 0.92);
}
.bv-stage[data-fill="true"] {
  position: absolute;
  inset: 0;
  height: 100%;
}
.bv-stage video {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(560px, 76vh);
  /* 视频默认就是 contain；显式写出来，附件卡与原卡片行为一致。 */
  object-fit: contain;
  background: #000;
  cursor: pointer;
}
.bv-stage[data-fill="true"] video {
  height: 100%;
  max-height: none;
}

/* 播放球：未播放时压在画面正中。 */
.bv-orb {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 999px;
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  display: grid;
  place-items: center;
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.18);
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bv-orb:hover {
  transform: translate(-50%, -50%) scale(1.06);
}
.bv-orb :deep(svg) {
  width: 24px;
  height: 24px;
  margin-left: 2px;
}

/* 自绘播放条：显示节点与输出附件卡共用同一套几何（左右 / 底部各 10px）。 */
.bv-controls {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  height: 46px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-high) / 0.9);
  border: 1px solid rgb(var(--md-outline-variant) / 0.55);
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.08);
  color: rgb(var(--md-on-surface));
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.bv-stage[data-playing="true"] .bv-controls {
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
}
.bv-stage[data-playing="true"]:hover .bv-controls,
.bv-stage[data-playing="true"]:focus-within .bv-controls {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.bv-control {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
}
.bv-control:hover {
  background: rgb(var(--md-on-surface) / 0.08);
  color: rgb(var(--md-on-surface));
}
.bv-control:active {
  transform: scale(0.92);
}
.bv-control :deep(svg) {
  width: 16px;
  height: 16px;
}
.bv-control-primary {
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  box-shadow: 0 2px 8px rgb(var(--md-primary) / 0.28);
}
.bv-control-primary:hover {
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  filter: brightness(1.06);
}
.bv-time {
  flex: 0 0 auto;
  min-width: 52px;
  text-align: center;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  opacity: 0.72;
}
.bv-track {
  position: relative;
  flex: 1 1 auto;
  min-width: 36px;
  height: 20px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.bv-track-rail,
.bv-track-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 999px;
  pointer-events: none;
}
.bv-track-rail {
  right: 0;
  background: rgb(var(--md-on-surface) / 0.16);
}
.bv-track-fill {
  background: rgb(var(--md-primary));
}
.bv-track-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: rgb(var(--md-primary));
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px rgb(var(--md-surface-container-high) / 0.95);
  pointer-events: none;
}
</style>
