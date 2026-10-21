<script setup lang="ts">
/** 一批工具调用：收起成一行，点开看每条。 */
import { computed, ref } from "vue";
import { BoltIcon, ChevronRightIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import type { ToolCard } from "./types";
import ToolRow from "./ToolRow.vue";

const props = defineProps<{
  tools: ToolCard[];
  running?: boolean;
  settled?: boolean;
}>();

const i18n = useI18n();
const expanded = ref(false);

const failed = computed(() => props.tools.filter((t) => t.ok === false).length);

const activeName = computed(() => {
  const active = props.tools.find((t) => t.ok === null);
  return (active ?? props.tools[props.tools.length - 1])?.name ?? "";
});

const label = computed(() => {
  if (props.running && activeName.value) {
    return i18n.t("agent.process.toolsRunning", { name: activeName.value });
  }
  return i18n.t("agent.process.tools", { count: props.tools.length });
});
</script>

<template>
  <div class="group">
    <button class="row" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="leading" aria-hidden="true">
        <BoltIcon class="activity" />
        <ChevronRightIcon class="chevron" :class="{ open: expanded }" />
      </span>
      <span class="label" :data-running="running || undefined">{{ label }}</span>
      <span v-if="failed" class="failed">
        {{ i18n.t("agent.process.toolsFailed", { count: failed }) }}
      </span>
    </button>
    <div v-if="expanded" class="body">
      <ToolRow v-for="tool in tools" :key="tool.id" :tool="tool" :settled="settled" />
    </div>
  </div>
</template>

<style scoped>
.group {
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
.label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.label[data-running] {
  color: rgb(var(--md-primary));
}
.failed {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: rgb(var(--md-error));
}
.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-left: 7px;
  padding-left: 9px;
  border-left: 1px solid rgb(var(--md-outline-variant) / 0.6);
}
</style>