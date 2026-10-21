<script setup lang="ts">
/** 一条工具调用：单行摘要（名称 + 参数），点开看输入 / 输出。 */
import { computed, ref } from "vue";
import { ChevronRightIcon, WrenchScrewdriverIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import type { ToolCard } from "./types";

const props = defineProps<{
  tool: ToolCard;
  settled?: boolean;
}>();

const i18n = useI18n();
const expanded = ref(false);

const state = computed<"running" | "ok" | "fail" | "pending">(() => {
  if (props.tool.ok === true) return "ok";
  if (props.tool.ok === false) return "fail";
  return props.settled ? "pending" : "running";
});

const statusLabel = computed(() => {
  switch (state.value) {
    case "ok":
      return i18n.t("agent.toolOk");
    case "fail":
      return i18n.t("agent.toolFail");
    case "pending":
      return i18n.t("agent.toolPending");
    default:
      return i18n.t("agent.toolRunning");
  }
});

const summary = computed(() => {
  const args = props.tool.args;
  if (args == null) return "";
  try {
    const text = typeof args === "string" ? args : JSON.stringify(args);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  } catch {
    return "";
  }
});

const inputText = computed(() => {
  const args = props.tool.args;
  if (args == null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
});
</script>

<template>
  <div class="tool" :data-state="state">
    <button class="row" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="leading" aria-hidden="true">
        <WrenchScrewdriverIcon class="activity" />
        <ChevronRightIcon class="chevron" :class="{ open: expanded }" />
      </span>
      <span class="name">{{ tool.name }}</span>
      <template v-if="summary">
        <span class="sep" aria-hidden="true" />
        <span class="summary">{{ summary }}</span>
      </template>
      <span class="status">{{ statusLabel }}</span>
    </button>
    <div v-if="expanded" class="body">
      <div v-if="inputText" class="io">
        <span class="io-label">{{ i18n.t("agent.toolInput") }}</span>
        <pre class="io-text">{{ inputText }}</pre>
      </div>
      <div v-if="tool.output" class="io">
        <span class="io-label">{{ i18n.t("agent.toolOutput") }}</span>
        <pre class="io-text">{{ tool.output }}</pre>
      </div>
      <p v-if="!inputText && !tool.output" class="io-empty">—</p>
    </div>
  </div>
</template>

<style scoped>
.tool {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.row {
  width: 100%;
  min-width: 0;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  text-align: left;
  cursor: pointer;
}
.row:hover {
  color: rgb(var(--md-on-surface));
}
.leading {
  position: relative;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.activity,
.chevron {
  position: absolute;
  inset: 0;
  width: 14px;
  height: 14px;
  margin: auto;
  transition: opacity 0.12s ease, transform 0.15s ease;
}
.chevron {
  opacity: 0;
}
.row:hover .activity,
.row[aria-expanded="true"] .activity {
  opacity: 0;
}
.row:hover .chevron,
.row[aria-expanded="true"] .chevron {
  opacity: 1;
}
.chevron.open {
  transform: rotate(90deg);
}
.name {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sep {
  flex: 0 0 auto;
  width: 2px;
  height: 2px;
  border-radius: 1px;
  margin: 0 2px;
  background-color: currentColor;
  opacity: 0.5;
}
.summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-muted));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.status {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.tool[data-state="ok"] .status {
  color: rgb(var(--md-primary));
}
.tool[data-state="fail"] .status {
  color: rgb(var(--md-error));
}
.tool[data-state="fail"] .summary {
  color: rgb(var(--md-error));
}
.tool[data-state="running"] .status {
  color: rgb(var(--md-primary));
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
.body {
  margin: 2px 0 6px 22px;
  padding: 8px 10px;
  border-radius: 10px;
  background-color: var(--app-inset);
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  max-height: 260px;
  overflow-y: auto;
}
.io + .io {
  margin-top: 8px;
}
.io-label {
  display: block;
  margin-bottom: 2px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.io-text {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-variant));
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.io-empty {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
@media (prefers-reduced-motion: reduce) {
  .activity,
  .chevron {
    transition: none;
  }
  .tool[data-state="running"] .status {
    animation: none;
  }
}
</style>