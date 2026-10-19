<script setup lang="ts">
/**
 * 视频预览区：16:9 画面 + 走带控制（原型占位，未接播放内核）。
 * 画面用 CSS 拼一个「日落海边」的假帧，只为让原型有真实的空间感。
 */
import {
  PlayIcon,
  BackwardIcon,
  ForwardIcon,
  SpeakerWaveIcon,
  ArrowsPointingOutIcon,
  Squares2X2Icon,
} from "@heroicons/vue/24/outline";
</script>

<template>
  <section class="preview">
    <header class="preview-head">
      <div class="head-left">
        <span class="head-title">预览</span>
        <span class="res-chip tabular">1920 × 1080 · 30 fps</span>
      </div>
      <div class="head-actions">
        <button class="icon-btn" aria-label="参考线">
          <Squares2X2Icon class="w-[17px] h-[17px]" />
        </button>
        <button class="icon-btn" aria-label="全屏预览">
          <ArrowsPointingOutIcon class="w-[17px] h-[17px]" />
        </button>
      </div>
    </header>

    <div class="stage-wrap">
      <div class="stage">
        <div class="frame">
          <!-- 假帧：天空 / 太阳 / 海面 -->
          <div class="sky" />
          <div class="sun" />
          <div class="sun-glow" />
          <div class="sea" />
          <div class="sea-line l1" />
          <div class="sea-line l2" />
          <div class="hill" />
          <div class="vignette" />

          <div class="frame-top">
            <span class="frame-chip tabular">00:00:12:08</span>
            <span class="frame-chip">片段 1 / 6</span>
          </div>

          <button class="big-play" aria-label="播放">
            <PlayIcon class="w-6 h-6" />
          </button>

          <div class="frame-bottom">
            <span class="frame-name">海边日落.mp4</span>
            <span class="frame-chip">1080p</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="transport">
      <div class="tc-block">
        <span class="tc-now tabular">00:00:12:08</span>
        <span class="tc-total tabular">/ 00:00:32:12</span>
      </div>

      <div class="transport-center">
        <button class="icon-btn" aria-label="上一帧">
          <BackwardIcon class="w-[17px] h-[17px]" />
        </button>
        <button class="play-btn" aria-label="播放">
          <PlayIcon class="w-[19px] h-[19px]" />
        </button>
        <button class="icon-btn" aria-label="下一帧">
          <ForwardIcon class="w-[17px] h-[17px]" />
        </button>
      </div>

      <div class="transport-right">
        <SpeakerWaveIcon class="vol-icon" />
        <input class="md3-range vol-range" type="range" min="0" max="100" value="72" aria-label="音量" />
        <button class="icon-btn" aria-label="全屏">
          <ArrowsPointingOutIcon class="w-[17px] h-[17px]" />
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--app-inset);
}

/* ---- 顶部小工具条 ---- */
.preview-head {
  flex: 0 0 auto;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 0 16px;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.head-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-variant));
}
.res-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* ---- 画面 ---- */
.stage-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px 10px;
  container-type: size;
}
.stage {
  width: min(100%, calc(100cqh * 16 / 9));
  max-height: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  background-color: #0b0910;
  box-shadow: var(--md-elevation-3), 0 0 0 1px rgb(var(--md-outline-variant) / 0.25);
}
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.sky {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #241a44 0%, #4d2a5e 32%, #9a4a6b 56%, #d97f6c 74%, #f0b183 88%);
}
.sun {
  position: absolute;
  left: 60%;
  top: 46%;
  width: 54px;
  height: 54px;
  border-radius: 999px;
  background: radial-gradient(circle at 40% 38%, #fff3d6 0%, #ffd9a1 55%, #ffb877 100%);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 60px 18px rgba(255, 190, 130, 0.45);
}
.sun-glow {
  position: absolute;
  left: 60%;
  top: 46%;
  width: 300px;
  height: 300px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 196, 140, 0.35) 0%, rgba(255, 160, 120, 0.12) 42%, transparent 70%);
  filter: blur(6px);
}
.sea {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 30%;
  background: linear-gradient(180deg, #8c4666 0%, #4e2b52 42%, #241632 100%);
}
.sea-line {
  position: absolute;
  height: 1px;
  background: rgba(255, 214, 176, 0.35);
  filter: blur(0.3px);
}
.sea-line.l1 {
  left: 6%;
  right: 22%;
  bottom: 21%;
}
.sea-line.l2 {
  left: 34%;
  right: 8%;
  bottom: 13%;
  opacity: 0.6;
}
.hill {
  position: absolute;
  left: -8%;
  bottom: 27%;
  width: 46%;
  height: 12%;
  background: #1b1229;
  border-radius: 50% 60% 0 0;
  transform: rotate(-2deg);
  opacity: 0.92;
}
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 48%, transparent 42%, rgba(0, 0, 0, 0.42) 100%);
  pointer-events: none;
}

.frame-top,
.frame-bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  z-index: 2;
}
.frame-top {
  top: 12px;
}
.frame-bottom {
  bottom: 12px;
}
.frame-chip {
  padding: 3px 8px;
  border-radius: 7px;
  background: rgba(12, 9, 18, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
  backdrop-filter: blur(10px);
}
.frame-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}
.big-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 62px;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 3px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(18, 14, 26, 0.4);
  color: #fff;
  backdrop-filter: blur(12px);
  cursor: pointer;
  z-index: 2;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
  transition: background-color 0.18s ease, transform 0.18s var(--md-spring-fast);
}
.big-play:hover {
  background: rgba(18, 14, 26, 0.58);
  transform: translate(-50%, -50%) scale(1.04);
}
.big-play:active {
  transform: translate(-50%, -50%) scale(0.97);
}

/* ---- 走带 ---- */
.transport {
  flex: 0 0 auto;
  height: 52px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  padding: 0 16px 6px;
}
.tc-block {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.tc-now {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.tc-total {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.transport-center {
  display: flex;
  align-items: center;
  gap: 6px;
}
.play-btn {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.play-btn:hover {
  box-shadow: 0 4px 14px rgb(var(--md-primary) / 0.35);
}
.play-btn:active {
  transform: scale(0.95);
}
.transport-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}
.vol-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
}
.vol-range {
  width: 84px;
}
</style>
