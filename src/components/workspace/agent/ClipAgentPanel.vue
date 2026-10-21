<script setup lang="ts">
/** 剪辑智能体面板：对话列表 + 输入框 + 历史。 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ClockIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useAgentStore } from "@/stores/agent";
import { useLayoutStore } from "@/stores/layout";
import { useI18n } from "@/i18n";
import { buildTurns } from "./turns";
import AgentTurn from "./AgentTurn.vue";
import AgentComposer from "./AgentComposer.vue";

const store = useAgentStore();
const layout = useLayoutStore();
const i18n = useI18n();

const listRef = ref<HTMLElement | null>(null);
const historyOpen = ref(false);
const historyQuery = ref("");

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

function stopClock(): void {
  if (clock !== undefined) {
    clearInterval(clock);
    clock = undefined;
  }
}

watch(
  () => store.running,
  (running) => {
    stopClock();
    if (!running) return;
    now.value = Date.now();
    clock = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  },
  { immediate: true },
);

const turns = computed(() =>
  buildTurns({
    path: store.activePath,
    running: store.running,
    stopped: store.stopped,
    streamingNodeId: store.streamingNodeId,
    streamingContent: store.streamingContent,
    streamingReasoning: store.streamingReasoning,
    toolRuns: store.toolRuns,
    branchesOf: store.branchesOf,
  }),
);

const filteredSessions = computed(() => {
  const q = historyQuery.value.trim().toLowerCase();
  if (!q) return store.sessions;
  return store.sessions.filter((s) => s.title.toLowerCase().includes(q));
});

function scrollToBottom(): void {
  void nextTick(() => {
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(
  () => [
    turns.value.length,
    store.streamingContent,
    store.streamingReasoning,
    store.toolTick,
    store.running,
  ],
  scrollToBottom,
);

function goSettings(): void {
  layout.openSettings("ai");
}

function onEdit(nodeId: string, text: string): void {
  void store.editAndResend(nodeId, text);
}

function onBranch(nodeId: string): void {
  void store.setHead(nodeId);
}

async function openHistory(): Promise<void> {
  historyOpen.value = true;
  await store.loadSessions();
}

async function pickSession(id: string): Promise<void> {
  historyOpen.value = false;
  await store.openSession(id);
  scrollToBottom();
}

async function removeSession(id: string): Promise<void> {
  await store.removeSession(id);
}

onMounted(async () => {
  await store.loadConfig();
  await store.loadSessions();
  await store.start();
  await store.syncRunning();
  scrollToBottom();
});

onUnmounted(() => {
  stopClock();
});
</script>

<template>
  <section class="agent">
    <header class="head">
      <span class="head-title">{{ store.session?.title || i18n.t("agent.title") }}</span>
      <button v-if="store.configured" class="model-chip" @click="goSettings">
        <span class="model-dot" />
        <span class="model-name">{{ store.config?.model || i18n.t("agent.config") }}</span>
      </button>
      <div class="head-actions">
        <button
          class="icon-btn"
          :disabled="store.running"
          :title="i18n.t('agent.newChat')"
          :aria-label="i18n.t('agent.newChat')"
          @click="store.newSession()"
        >
          <PlusIcon class="w-[15px] h-[15px]" />
        </button>
        <button
          class="icon-btn"
          :disabled="store.running"
          :title="i18n.t('agent.history')"
          :aria-label="i18n.t('agent.history')"
          @click="openHistory"
        >
          <ClockIcon class="w-[15px] h-[15px]" />
        </button>
      </div>
    </header>

    <div v-if="!store.configured" class="empty">
      <SparklesIcon class="empty-icon" />
      <p class="empty-title">{{ i18n.t("agent.unconfiguredTitle") }}</p>
      <p class="empty-hint">{{ i18n.t("agent.unconfiguredHint") }}</p>
      <button class="btn-filled" @click="goSettings">{{ i18n.t("agent.goSettings") }}</button>
    </div>

    <template v-else>
      <div ref="listRef" class="list">
        <div v-if="!turns.length" class="list-empty">{{ i18n.t("agent.emptyHint") }}</div>
        <AgentTurn
          v-for="turn in turns"
          :key="turn.key"
          :turn="turn"
          :live-now="turn.running ? now : undefined"
          @edit="onEdit"
          @branch="onBranch"
        />
      </div>

      <AgentComposer :running="store.running" @send="store.send" @stop="store.stop" />
    </template>

    <Teleport to="body">
      <div v-if="historyOpen" class="agent-scrim" @pointerdown.self="historyOpen = false">
        <div class="dialog" role="dialog" :aria-label="i18n.t('agent.historyTitle')">
          <div class="dialog-head">
            <span class="dialog-title">{{ i18n.t("agent.historyTitle") }}</span>
            <button
              class="icon-btn"
              :aria-label="i18n.t('agent.close')"
              @click="historyOpen = false"
            >
              <XMarkIcon class="w-[15px] h-[15px]" />
            </button>
          </div>
          <input
            v-model="historyQuery"
            class="search"
            :placeholder="i18n.t('agent.historySearch')"
          />
          <div class="history">
            <p v-if="!filteredSessions.length" class="history-empty">
              {{ historyQuery ? i18n.t("agent.historyNoMatch") : i18n.t("agent.historyEmpty") }}
            </p>
            <button
              v-for="s in filteredSessions"
              :key="s.id"
              class="history-item"
              :class="{ on: s.id === store.session?.id }"
              @click="pickSession(s.id)"
            >
              <span class="history-main">
                <span class="history-title">{{ s.title || i18n.t("agent.title") }}</span>
                <span class="history-sub">{{ i18n.t("agent.historyCount", { count: s.count }) }}</span>
              </span>
              <span class="history-del" @click.stop="removeSession(s.id)">
                <TrashIcon class="w-[14px] h-[14px]" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.agent {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--app-card);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.5);
}
.head-title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  margin-left: auto;
}
.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
  background: transparent;
}
.model-chip {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
}
.model-chip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
}
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 12px 20px;
}
.list-empty {
  margin: auto;
  text-align: center;
  font-size: 12px;
  color: rgb(var(--md-on-surface-muted));
}
.empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}
.empty-icon {
  width: 32px;
  height: 32px;
  color: rgb(var(--md-on-surface-muted));
}
.empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.empty-hint {
  margin: 0 0 8px;
  max-width: 260px;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.dialog {
  width: 420px;
  max-width: calc(100vw - 48px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 24px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.agent-scrim {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(var(--md-scrim) / 0.32);
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.search {
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  outline: none;
}
.search:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.history {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.history-empty {
  margin: 24px 0;
  text-align: center;
  font-size: 12px;
  color: rgb(var(--md-on-surface-muted));
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
}
.history-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.history-item.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.history-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.history-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-sub {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.history-del {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  color: rgb(var(--md-on-surface-variant));
}
.history-del:hover {
  color: rgb(var(--md-error));
  background-color: rgb(var(--md-error) / 0.12);
}
</style>