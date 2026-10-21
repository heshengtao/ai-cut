<script setup lang="ts">
/** 一条「思考」行：收起只露一行摘要，点开看全文。 */
import { computed, ref, watch } from "vue";
import { ChevronRightIcon, LightBulbIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { renderMarkdown } from "./markdown";

const props = defineProps<{
  text: string;
  running?: boolean;
}>();

const i18n = useI18n();
const expanded = ref(false);

const RENDER_THROTTLE_MS = 240;
const renderText = ref(props.text);
let renderTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.text,
  (text) => {
    if (!props.running) {
      renderText.value = text;
      return;
    }
    if (renderTimer === undefined) {
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
        renderText.value = props.text;
      }, RENDER_THROTTLE_MS);
    }
  },
);

watch(
  () => props.running,
  (running) => {
    if (!running) {
      if (renderTimer !== undefined) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      renderText.value = props.text;
    }
  },
);

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function latestCompletedParagraphFirstLine(text: string): string {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd =
      nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

const summary = computed(() => {
  const raw = props.running ? latestCompletedParagraphFirstLine(props.text) : firstLine(props.text);
  return raw.replaceAll("**", "").trim();
});

const html = computed(() => renderMarkdown(renderText.value));
</script>

<template>
  <div class="reasoning" :data-running="running || undefined">
    <button class="row" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="leading" aria-hidden="true">
        <LightBulbIcon class="activity" />
        <ChevronRightIcon class="chevron" :class="{ open: expanded }" />
      </span>
      <span class="title">{{ i18n.t("agent.think") }}</span>
      <template v-if="!expanded && summary">
        <span class="sep" aria-hidden="true" />
        <span class="summary">{{ summary }}</span>
      </template>
    </button>
    <div v-if="expanded" class="body learn-markdown" v-html="html" />
  </div>
</template>

<style scoped>
.reasoning {
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
  color: rgb(var(--md-on-surface-muted));
  text-align: left;
  cursor: pointer;
}
.row:hover {
  color: rgb(var(--md-on-surface-variant));
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
.title {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
}
.reasoning[data-running] .title {
  color: rgb(var(--md-primary));
}
.sep {
  flex: 0 0 auto;
  width: 2px;
  height: 2px;
  border-radius: 1px;
  margin: 0 2px;
  background-color: currentColor;
  opacity: 0.55;
}
.summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
  color: rgb(var(--md-on-surface-muted));
}
.reasoning[data-running] .summary {
  mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent);
}
.body {
  min-width: 0;
  max-height: 320px;
  overflow-y: auto;
  padding: 2px 0 6px 22px;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface-variant));
}
</style>