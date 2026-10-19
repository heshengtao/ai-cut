<script setup lang="ts">
/** 导出面板：预设 + 参数摘要 + 导出按钮（原型占位）。 */
import { ref } from "vue";
import { CheckIcon, ChevronRightIcon, ArrowUpTrayIcon } from "@heroicons/vue/24/outline";

const presets = [
  { id: "mp4", name: "MP4 · H.264", hint: "通用，适合分享到社交平台", meta: "1080p · 12 Mbps" },
  { id: "prores", name: "ProRes 422", hint: "高码率中间格式，适合后期", meta: "1080p · 147 Mbps" },
  { id: "gif", name: "GIF", hint: "短循环动图，无声音", meta: "720p · 15fps" },
];

const selected = ref("mp4");
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">导出</h2>
        <p class="pane-sub">选择预设后导出成片</p>
      </div>
    </header>

    <div class="pane-scroll">
      <div class="section-label">预设</div>
      <div class="presets">
        <button
          v-for="p in presets"
          :key="p.id"
          class="preset"
          :class="{ on: selected === p.id }"
          :aria-pressed="selected === p.id"
          @click="selected = p.id"
        >
          <span class="preset-radio">
            <CheckIcon v-if="selected === p.id" class="w-3 h-3" />
          </span>
          <span class="preset-text">
            <span class="preset-name">{{ p.name }}</span>
            <span class="preset-hint">{{ p.hint }}</span>
            <span class="preset-meta tabular">{{ p.meta }}</span>
          </span>
        </button>
      </div>

      <div class="section-label">输出设置</div>
      <div class="rows">
        <button class="row">
          <span>分辨率</span>
          <span class="row-value">1920 × 1080 <ChevronRightIcon class="w-3.5 h-3.5" /></span>
        </button>
        <button class="row">
          <span>帧率</span>
          <span class="row-value">30 fps <ChevronRightIcon class="w-3.5 h-3.5" /></span>
        </button>
        <button class="row">
          <span>音频</span>
          <span class="row-value">AAC · 192 kbps <ChevronRightIcon class="w-3.5 h-3.5" /></span>
        </button>
      </div>

      <div class="estimate">
        <span>预计文件大小</span>
        <span class="estimate-value tabular">186 MB</span>
      </div>
    </div>

    <div class="export-foot">
      <button class="btn-filled export-btn">
        <ArrowUpTrayIcon class="w-[17px] h-[17px]" />
        导出视频
      </button>
      <p class="foot-hint">导出后自动保存到项目文件夹</p>
    </div>
  </div>
</template>

<style scoped>
.presets {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.preset {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.preset:hover {
  background-color: rgb(var(--md-on-surface) / 0.04);
}
.preset.on {
  border-color: rgb(var(--md-primary) / 0.65);
  background-color: rgb(var(--md-primary) / 0.08);
}
.preset-radio {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1.5px solid rgb(var(--md-outline));
  color: rgb(var(--md-on-primary));
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.preset.on .preset-radio {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary));
}
.preset-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.preset-name {
  font-size: 12.5px;
  font-weight: 600;
}
.preset-hint {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.preset-meta {
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}
.rows {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background-color: rgb(var(--md-surface-container-high));
}
.row {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  cursor: pointer;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background-color: rgb(var(--md-on-surface) / 0.04);
}
.row-value {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  font-weight: 500;
}
.estimate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 2px 0;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.estimate-value {
  color: rgb(var(--md-on-surface));
  font-weight: 600;
}
.export-foot {
  flex: 0 0 auto;
  padding: 10px 16px 14px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: var(--app-card);
}
.export-btn {
  width: 100%;
}
.foot-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
</style>
