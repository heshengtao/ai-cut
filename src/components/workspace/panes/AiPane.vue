<script setup lang="ts">
/** AI 助手面板：对话式剪辑入口（原型占位，不接后端）。 */
import { ref } from "vue";
import { PaperAirplaneIcon, SparklesIcon } from "@heroicons/vue/24/outline";

const draft = ref("");
const suggestions = ["自动粗剪", "去除静音", "生成字幕", "配一段音乐"];
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">AI 助手</h2>
        <p class="pane-sub">描述你想要的成片，我来动手剪</p>
      </div>
      <span class="beta">BETA</span>
    </header>

    <div class="pane-scroll chat">
      <div class="msg">
        <div class="avatar"><SparklesIcon class="w-4 h-4" /></div>
        <div class="bubble">
          <p>
            告诉我你想剪成什么样。比如：<span class="em">把「海边日落」放在开头，配一段轻快的音乐，总长控制在 30 秒。</span>
          </p>
          <p>我会先给出粗剪方案，再按你的反馈调整节奏与转场。</p>
        </div>
      </div>

      <div class="suggestions">
        <button v-for="s in suggestions" :key="s" class="suggestion">{{ s }}</button>
      </div>

      <div class="hint">
        <span class="dot" />
        原型阶段：对话与剪辑能力尚未接入
      </div>
    </div>

    <div class="composer">
      <input v-model="draft" class="composer-field" placeholder="描述你想要的剪辑…" />
      <button class="send" :disabled="!draft.trim()" aria-label="发送">
        <PaperAirplaneIcon class="w-[17px] h-[17px]" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.beta {
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
}
.chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 2px;
}
.msg {
  display: flex;
  gap: 9px;
  align-items: flex-start;
}
.avatar {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: linear-gradient(140deg, rgb(var(--md-primary)), rgb(var(--md-tertiary)));
  color: rgb(var(--md-on-primary));
  box-shadow: var(--md-elevation-1);
}
.bubble {
  padding: 10px 12px;
  border-radius: 4px 16px 16px 16px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  line-height: 1.6;
}
.bubble p {
  margin: 0;
}
.bubble p + p {
  margin-top: 8px;
  color: rgb(var(--md-on-surface-variant));
}
.em {
  color: rgb(var(--md-primary));
  font-weight: 500;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 37px;
}
.suggestion {
  height: 28px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.85);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.suggestion:hover {
  background-color: rgb(var(--md-primary) / 0.08);
  color: rgb(var(--md-primary));
}
.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 37px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
}
.composer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 12px;
  padding: 6px 6px 6px 12px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
}
.composer:focus-within {
  border-color: rgb(var(--md-primary) / 0.7);
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.16);
}
.composer-field {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  outline: none;
}
.composer-field::placeholder {
  color: rgb(var(--md-on-surface-muted));
}
.send {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.send:disabled {
  opacity: 0.35;
  cursor: default;
}
.send:not(:disabled):active {
  transform: scale(0.94);
}
</style>
