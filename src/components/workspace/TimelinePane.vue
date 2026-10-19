<script setup lang="ts">
/**
 * 剪辑轨道区：标尺 + 轨道头 + 片段车道 + 播放头（原型占位，不可拖拽）。
 * 片段的显示方式（按用户要求）：
 * - 文字轨道：块上直接显示文字内容；
 * - 图片 / 视频轨道：块上铺首帧图像（object-fit: cover，拉伸变形只裁切）；
 * - 视频块 / 音频块：下半部分是音频音量波形。
 */
import {
  CursorArrowRaysIcon,
  ScissorsIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  FilmIcon,
  PhotoIcon,
  DocumentTextIcon,
  MusicalNoteIcon,
  SpeakerWaveIcon,
} from "@heroicons/vue/24/outline";

/** 片段的类型。 */
type ClipKind = "video" | "image" | "audio" | "text";

interface Clip {
  name: string;
  kind: ClipKind;
  left: number;
  width: number;
  /** 首帧 / 图片素材（public/frames 下的静态资源，播放时由解码器替换成真实首帧）。 */
  frame?: string;
  /** 文字轨道：直接显示在块上的文案。 */
  text?: string;
  /** 音量波形。 */
  wave?: number[];
}

interface Track {
  id: string;
  name: string;
  kind: ClipKind | "audio";
  icon: unknown;
  tone: "primary" | "tertiary" | "image" | "text" | "audio";
  clips: Clip[];
}

/** 固定的假波形：用正弦叠加，长度稳定，不随渲染变化。 */
function wave(seed: number, count = 56): number[] {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.52 + seed) * 0.62 + Math.sin(i * 1.31 + seed * 2) * 0.3);
    return Math.round(16 + v * 78);
  });
}

const tracks: Track[] = [
  {
    id: "t1",
    name: "文字 1",
    kind: "text",
    icon: DocumentTextIcon,
    tone: "text",
    clips: [
      { name: "字幕 01", kind: "text", left: 4, width: 16, text: "夏天，海边的风" },
      { name: "字幕 02", kind: "text", left: 36, width: 12, text: "城市夜归人" },
    ],
  },
  {
    id: "v2",
    name: "视频 2",
    kind: "video",
    icon: FilmIcon,
    tone: "tertiary",
    clips: [
      { name: "转场素材", kind: "video", left: 60, width: 14, frame: "frames/aurora.svg", wave: wave(1.3) },
    ],
  },
  {
    id: "v1",
    name: "视频 1",
    kind: "video",
    icon: FilmIcon,
    tone: "primary",
    clips: [
      { name: "海边日落", kind: "video", left: 0, width: 30, frame: "frames/beach.svg", wave: wave(0.4) },
      { name: "城市夜景", kind: "video", left: 33, width: 23, frame: "frames/city.svg", wave: wave(2.1) },
      { name: "产品特写", kind: "video", left: 58, width: 14, frame: "frames/product.svg", wave: wave(3.6) },
    ],
  },
  {
    id: "p1",
    name: "图片 1",
    kind: "image",
    icon: PhotoIcon,
    tone: "image",
    clips: [{ name: "封面.png", kind: "image", left: 0, width: 24, frame: "frames/lake.svg" }],
  },
  {
    id: "a1",
    name: "音频 1",
    kind: "audio",
    icon: MusicalNoteIcon,
    tone: "audio",
    clips: [{ name: "背景音乐.wav", kind: "audio", left: 0, width: 72, wave: wave(0.4) }],
  },
  {
    id: "a2",
    name: "音频 2",
    kind: "audio",
    icon: SpeakerWaveIcon,
    tone: "audio",
    clips: [
      { name: "旁白.wav", kind: "audio", left: 10, width: 34, wave: wave(2.1) },
      { name: "环境声.wav", kind: "audio", left: 50, width: 18, wave: wave(4.7) },
    ],
  },
];

/** 标尺：60 秒，每 5 秒一个刻度，每 10 秒一个数字。 */
const ticks = Array.from({ length: 13 }, (_, i) => {
  const seconds = i * 5;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return {
    pos: (i / 12) * 100,
    label: `${mm}:${ss}`,
    major: i % 2 === 0,
    first: i === 0,
    last: i === 12,
  };
});

/** 播放头位置（%）：与预览时间码呼应。 */
const playhead = 36;
</script>

<template>
  <section class="timeline">
    <header class="tl-head">
      <span class="tl-title">时间线</span>

      <div class="tl-tools">
        <button class="icon-btn on" aria-label="选择工具">
          <CursorArrowRaysIcon class="w-[16px] h-[16px]" />
        </button>
        <button class="icon-btn" aria-label="切割工具">
          <ScissorsIcon class="w-[16px] h-[16px]" />
        </button>
      </div>

      <div class="tl-spacer" />

      <span class="tl-time tabular">00:00:12:08</span>

      <div class="zoom">
        <button class="icon-btn" aria-label="缩小">
          <MagnifyingGlassMinusIcon class="w-[16px] h-[16px]" />
        </button>
        <input class="md3-range zoom-range" type="range" min="0" max="100" value="38" aria-label="时间线缩放" />
        <button class="icon-btn" aria-label="放大">
          <MagnifyingGlassPlusIcon class="w-[16px] h-[16px]" />
        </button>
      </div>
    </header>

    <div class="tl-body">
      <!-- 左：轨道头（固定） -->
      <div class="headers">
        <div class="corner"><span>轨道</span></div>
        <div v-for="t in tracks" :key="t.id" class="track-head">
          <div class="th-main">
            <component :is="t.icon" class="th-icon" />
            <span class="th-name">{{ t.name }}</span>
          </div>
          <div class="th-btns">
            <button class="th-btn" :aria-label="`${t.name} 静音`">M</button>
            <button class="th-btn" :aria-label="`${t.name} 独奏`">S</button>
          </div>
        </div>
      </div>

      <!-- 右：标尺 + 车道 -->
      <div class="scroll">
        <div class="ruler">
          <div
            v-for="(tk, i) in ticks"
            :key="i"
            class="tick"
            :class="{ major: tk.major }"
            :style="{ left: `${tk.pos}%` }"
          >
            <span
              v-if="tk.major"
              class="tick-label tabular"
              :class="{ first: tk.first, last: tk.last }"
            >{{ tk.label }}</span>
          </div>
        </div>

        <div class="lanes">
          <div v-for="t in tracks" :key="t.id" class="lane">
            <div
              v-for="c in t.clips"
              :key="c.name"
              class="clip"
              :class="[`tone-${t.tone}`, `k-${c.kind}`]"
              :style="{ left: `${c.left}%`, width: `${c.width}%` }"
            >
              <!-- 首帧图像 / 图片：铺满整块，等比裁切不变形 -->
              <img v-if="c.frame" class="clip-frame" :src="c.frame" alt="" draggable="false" />

              <!-- 文字轨道：显示文字内容 -->
              <template v-else-if="c.kind === 'text'">
                <component :is="t.icon" class="clip-kind-icon" />
                <span class="clip-text">{{ c.text }}</span>
              </template>

              <!-- 其余（音频等）：显示素材名 -->
              <span v-if="c.kind !== 'text'" class="clip-name">{{ c.name }}</span>

              <!-- 下半部分：音频音量波形（视频与音频块） -->
              <div v-if="c.wave" class="wave" :class="{ media: c.kind === 'video' }">
                <span v-for="(h, i) in c.wave" :key="i" :style="{ height: `${h}%` }" />
              </div>
            </div>
          </div>
        </div>

        <!-- 播放头：贯穿标尺与所有车道 -->
        <div class="playhead" :style="{ left: `${playhead}%` }">
          <span class="ph-cap" />
          <span class="ph-line" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline {
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--app-card);
  overflow: hidden;
}

/* ---- 顶部工具条 ---- */
.tl-head {
  flex: 0 0 auto;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
}
.tl-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-variant));
  flex: 0 0 auto;
}
.tl-tools {
  display: flex;
  align-items: center;
  gap: 1px;
  padding-left: 4px;
}
.tl-spacer {
  flex: 1;
}
.tl-time {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  padding: 3px 9px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high));
  flex: 0 0 auto;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.zoom-range {
  width: 76px;
}

/* ---- 主体 ---- */
.tl-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 轨道头 */
.headers {
  width: 168px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgb(var(--md-outline-variant) / 0.4);
  background-color: var(--app-card);
}
.corner {
  height: 28px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: rgb(var(--md-on-surface-muted));
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
}
.track-head {
  height: 54px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.th-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.th-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-muted));
}
.th-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-btns {
  display: flex;
  gap: 3px;
  flex: 0 0 auto;
}
.th-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.th-btn:hover {
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
}

/* 标尺 + 车道 */
.scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--app-card);
}
.ruler {
  position: relative;
  height: 28px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: rgb(var(--md-surface-container-low) / 0.5);
}
.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgb(var(--md-outline-variant) / 0.45);
}
.tick.major {
  background-color: rgb(var(--md-outline) / 0.45);
}
.tick-label {
  position: absolute;
  top: 6px;
  left: 0;
  transform: translateX(-50%);
  padding: 0 3px;
  font-size: 9.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface-muted));
  white-space: nowrap;
}
.tick-label.first {
  transform: translateX(0);
}
.tick-label.last {
  transform: translateX(-100%);
}

.lanes {
  display: flex;
  flex-direction: column;
}
.lane {
  position: relative;
  height: 54px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
  background-image: linear-gradient(
    to right,
    rgb(var(--md-outline-variant) / 0.28) 0 1px,
    transparent 1px 100%
  );
  background-size: 8.333% 100%;
}
.lane:nth-child(odd) {
  background-color: rgb(var(--md-surface-container-low) / 0.35);
}

/* ---- 片段 ---- */
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
  transition: box-shadow 0.15s ease, filter 0.15s ease;
}
.clip:hover {
  filter: brightness(1.04);
  box-shadow: var(--md-elevation-1);
}
.clip:active {
  cursor: grabbing;
}
.tone-primary {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
  border-color: rgb(var(--md-primary) / 0.28);
}
.tone-tertiary {
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
  border-color: rgb(var(--md-tertiary) / 0.28);
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
.tone-audio {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  border-color: rgb(var(--md-secondary) / 0.28);
}

/* 首帧图像 / 图片：铺满整块，等比裁切 */
.clip-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  opacity: 0.95;
  pointer-events: none;
  user-select: none;
}
/* 图像上的暗角，保证文字可读 */
.k-video::before,
.k-image::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgb(8 6 12 / 0.55) 0%, transparent 46%),
    linear-gradient(to top, rgb(8 6 12 / 0.5) 0%, transparent 42%);
  pointer-events: none;
}

/* 文字轨道：直接显示文案 */
.clip-kind-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0.75;
}
.clip-text {
  position: relative;
  z-index: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 素材名：纯色块上居中，图像块上浮在左上角 */
.clip-name {
  position: relative;
  z-index: 1;
  min-width: 0;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  text-shadow: 0 1px 0 rgb(var(--md-surface) / 0.25);
}
.k-video .clip-name,
.k-image .clip-name {
  position: absolute;
  top: 3px;
  left: 7px;
  right: 7px;
  flex: none;
  color: rgb(255 255 255 / 0.95);
  font-size: 10px;
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.75);
}

/* 音频音量波形：占据块的下半部分 */
.wave {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 50%;
  bottom: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.55;
  pointer-events: none;
}
.wave span {
  flex: 1;
  min-width: 1px;
  border-radius: 1px;
  background-color: currentColor;
}
/* 图像块上的波形用白色，保证对比 */
.wave.media {
  opacity: 0.9;
}
.wave.media span {
  background-color: rgb(255 255 255 / 0.88);
}
.clip.audio .clip-name {
  align-self: flex-start;
  margin-top: 3px;
  font-size: 10px;
}

/* 播放头 */
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  z-index: 5;
  pointer-events: none;
}
.ph-cap {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 12px;
  background-color: rgb(var(--md-primary));
  border-radius: 0 0 3px 3px;
  clip-path: polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%);
}
.ph-line {
  position: absolute;
  top: 10px;
  bottom: 0;
  left: 50%;
  width: 1.5px;
  transform: translateX(-50%);
  background-color: rgb(var(--md-primary));
  box-shadow: 0 0 6px rgb(var(--md-primary) / 0.45);
}
</style>
