<script setup lang="ts">
/** 属性面板：选中片段的变换 / 音频 / 合成参数（原型占位）。 */
import { EllipsisHorizontalIcon, FilmIcon } from "@heroicons/vue/24/outline";
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">属性</h2>
        <p class="pane-sub">当前选中：视频片段</p>
      </div>
      <button class="icon-btn" aria-label="更多操作">
        <EllipsisHorizontalIcon class="w-[18px] h-[18px]" />
      </button>
    </header>

    <div class="pane-scroll">
      <div class="selected">
        <div class="selected-thumb">
          <FilmIcon class="w-4 h-4" />
        </div>
        <div class="selected-text">
          <span class="selected-name">海边日落.mp4</span>
          <span class="selected-meta">视频 1 · 00:12 · 1080p</span>
        </div>
      </div>

      <div class="section-label">变换</div>
      <div class="group">
        <div class="prop-row">
          <span>缩放</span>
          <span class="prop-value">100%</span>
        </div>
        <input class="md3-range" type="range" min="10" max="200" value="100" aria-label="缩放" />

        <div class="prop-row">
          <span>旋转</span>
          <span class="prop-value">0°</span>
        </div>
        <input class="md3-range" type="range" min="-180" max="180" value="0" aria-label="旋转" />

        <div class="prop-row two">
          <span>位置</span>
          <span class="pair">
            <span class="prop-value">X 0</span>
            <span class="prop-value">Y 0</span>
          </span>
        </div>
      </div>

      <div class="section-label">合成</div>
      <div class="group">
        <div class="prop-row">
          <span>不透明度</span>
          <span class="prop-value">100%</span>
        </div>
        <input class="md3-range" type="range" min="0" max="100" value="100" aria-label="不透明度" />

        <div class="prop-row">
          <span>混合模式</span>
          <span class="prop-value">正常</span>
        </div>
      </div>

      <div class="section-label">音频</div>
      <div class="group">
        <div class="prop-row">
          <span>音量</span>
          <span class="prop-value">−6.0 dB</span>
        </div>
        <input class="md3-range" type="range" min="-48" max="12" value="-6" aria-label="音量" />

        <div class="prop-row two">
          <span>淡入 / 淡出</span>
          <span class="pair">
            <span class="prop-value">0.5s</span>
            <span class="prop-value">0.8s</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  margin-bottom: 2px;
}
.selected-thumb {
  width: 46px;
  height: 34px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(140deg, #2c1f4d 0%, #7c4a76 50%, #e79a76 100%);
  color: rgba(255, 255, 255, 0.9);
}
.selected-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.selected-name {
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.selected-meta {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.group {
  padding: 2px 0 4px;
}
.group + .section-label {
  margin-top: 18px;
}
.prop-row.two {
  align-items: center;
}
.pair {
  display: inline-flex;
  gap: 5px;
}
</style>
