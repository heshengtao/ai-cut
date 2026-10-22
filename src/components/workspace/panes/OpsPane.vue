<script setup lang="ts">
/**
 * 操作记录：人类、内置剪辑智能体与外部 AI 的每一步工程改动。
 *
 * 数据直接来自工程 store 的撤销历史，每条记录就是一个撤销步骤，因此
 * 「回撤到此步」= 撤销该步及之后的改动；被撤销的步骤仍留在列表里，
 * 可以再重做到任意一步。AI 的改动和人类一样走同一条历史，完全可控。
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ClockIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  UserIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useProjectStore } from "@/stores/project";
import type { HistoryEntry } from "@/types/events";

type ActorKind = "human" | "builtin" | "external";
type Filter = "all" | ActorKind;

const i18n = useI18n();
const project = useProjectStore();

const filters: { id: Filter; labelKey: string }[] = [
  { id: "all", labelKey: "ops.filter.all" },
  { id: "human", labelKey: "ops.filter.human" },
  { id: "builtin", labelKey: "ops.filter.builtin" },
  { id: "external", labelKey: "ops.filter.external" },
];

const filter = ref<Filter>("all");
const query = ref("");
const listEl = ref<HTMLElement | null>(null);
const busy = ref(false);

/** 内置智能体的会话标识固定为 `chat`，其余 agent 操作都视为外部 AI。 */
function actorKind(entry: HistoryEntry): ActorKind {
  if (entry.actor === "human") return "human";
  return entry.sessionId === "chat" ? "builtin" : "external";
}

function actorLabel(entry: HistoryEntry): string {
  const kind = actorKind(entry);
  if (kind === "human") return i18n.t("ops.actor.human");
  if (kind === "builtin") return i18n.t("ops.actor.builtin");
  return i18n.t("ops.actor.external");
}

function actorIcon(entry: HistoryEntry) {
  const kind = actorKind(entry);
  return kind === "human" ? UserIcon : kind === "builtin" ? SparklesIcon : CpuChipIcon;
}

function kindLabel(entry: HistoryEntry): string {
  const key = `ops.kind.${entry.kind}`;
  const text = i18n.t(key);
  return text === key ? entry.kind : text;
}

function clock(at: number): string {
  return new Intl.DateTimeFormat(i18n.locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(at));
}

function affectedLabel(entry: HistoryEntry): string {
  const { clipIds, trackIds, assetIds } = entry.affected;
  const parts: string[] = [];
  if (clipIds.length > 0) parts.push(i18n.t("ops.clips", { count: clipIds.length }));
  if (trackIds.length > 0) parts.push(i18n.t("ops.tracks", { count: trackIds.length }));
  if (assetIds.length > 0) parts.push(i18n.t("ops.assets", { count: assetIds.length }));
  return parts.join(" · ");
}

const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return project.history.filter((entry) => {
    if (filter.value !== "all" && actorKind(entry) !== filter.value) return false;
    if (!q) return true;
    const hay = `${entry.label} ${kindLabel(entry)} ${actorLabel(entry)}`.toLowerCase();
    return hay.includes(q);
  });
});

const appliedCount = computed(() => project.history.filter((entry) => entry.applied).length);

/** 「当前状态」分隔线：第一条被撤销的操作之前。没有撤销步时放在列表末尾。 */
const dividerIndex = computed(() => visible.value.findIndex((entry) => !entry.applied));

function countOf(id: Filter): number {
  if (id === "all") return project.history.length;
  return project.history.filter((entry) => actorKind(entry) === id).length;
}

/** 回撤这一步会连带撤销多少步（含它自己）。 */
function revertCount(entry: HistoryEntry): number {
  const applied = project.history.filter((item) => item.applied);
  const index = applied.findIndex((item) => item.id === entry.id);
  return index < 0 ? 0 : applied.length - index;
}

/** 重做到这一步会连带重做多少步（含它自己）。 */
function redoCount(entry: HistoryEntry): number {
  const undone = project.history.filter((item) => !item.applied);
  const index = undone.findIndex((item) => item.id === entry.id);
  return index < 0 ? 0 : index + 1;
}

function scrollToNow(smooth = false): void {
  void nextTick(() => {
    const el = listEl.value;
    const row = el?.querySelector<HTMLElement>(".now-row");
    if (!el || !row) return;
    const top = row.offsetTop - el.clientHeight / 2 + row.clientHeight / 2;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  });
}

function undoLast(): void {
  project.undo();
  scrollToNow(true);
}

function redoLast(): void {
  project.redo();
  scrollToNow(true);
}

function revert(entry: HistoryEntry): void {
  if (busy.value) return;
  busy.value = true;
  project.revertTo(entry.id);
  busy.value = false;
  scrollToNow(true);
}

function reapply(entry: HistoryEntry): void {
  if (busy.value) return;
  busy.value = true;
  project.reapplyTo(entry.id);
  busy.value = false;
  scrollToNow(true);
}

watch(() => project.history.length, () => scrollToNow(true));

onMounted(() => scrollToNow(false));
</script>

<template>
  <div class="ops-pane">
    <header class="head">
      <div class="head-text">
        <h2>{{ i18n.t("ops.title") }}</h2>
        <p v-if="project.history.length > 0" class="head-sub">
          {{
            i18n.t("ops.summary", {
              total: project.history.length,
              applied: appliedCount,
              redo: project.history.length - appliedCount,
            })
          }}
        </p>
      </div>
      <div class="head-actions">
        <button
          class="icon-btn"
          type="button"
          :title="i18n.t('ops.undoLast')"
          :aria-label="i18n.t('ops.undoLast')"
          :disabled="!project.canUndo"
          @click="undoLast"
        >
          <ArrowUturnLeftIcon class="head-icon" />
        </button>
        <button
          class="icon-btn"
          type="button"
          :title="i18n.t('ops.redoLast')"
          :aria-label="i18n.t('ops.redoLast')"
          :disabled="!project.canRedo"
          @click="redoLast"
        >
          <ArrowUturnRightIcon class="head-icon" />
        </button>
      </div>
    </header>

    <div class="toolbar">
      <div class="filters" role="group" :aria-label="i18n.t('ops.title')">
        <button
          v-for="item in filters"
          :key="item.id"
          class="chip"
          :class="{ on: filter === item.id }"
          :aria-pressed="filter === item.id"
          @click="filter = item.id"
        >
          {{ i18n.t(item.labelKey) }}
          <span class="chip-count">{{ countOf(item.id) }}</span>
        </button>
      </div>
      <label class="search">
        <MagnifyingGlassIcon class="search-icon" />
        <input
          v-model="query"
          class="search-input"
          type="search"
          :placeholder="i18n.t('ops.search')"
          :aria-label="i18n.t('ops.searchLabel')"
        />
      </label>
    </div>

    <div ref="listEl" class="list">
      <div v-if="visible.length === 0" class="empty">
        <ClockIcon class="empty-icon" />
        <p class="empty-title">
          {{ query.trim() ? i18n.t("ops.emptyFilter") : i18n.t("ops.empty") }}
        </p>
        <p v-if="!query.trim()" class="empty-hint">{{ i18n.t("ops.emptyHint") }}</p>
      </div>

      <template v-for="(entry, index) in visible" :key="entry.id">
        <div v-if="index === dividerIndex" class="now-row">
          <span class="now-line" />
          <span class="now-pill">{{ i18n.t("ops.current") }}</span>
          <span class="now-line" />
        </div>

        <article class="op-row" :class="{ undone: !entry.applied }">
          <div class="rail" :class="actorKind(entry)">
            <span class="rail-line" />
            <span class="rail-dot">
              <component :is="actorIcon(entry)" class="dot-icon" />
            </span>
          </div>

          <div class="op-body">
            <div class="op-top">
              <span class="op-label">{{ entry.label || kindLabel(entry) }}</span>
              <span class="badge" :class="actorKind(entry)">{{ actorLabel(entry) }}</span>
            </div>
            <div class="op-meta">
              <span class="kind">{{ kindLabel(entry) }}</span>
              <span>{{ clock(entry.timestamp) }}</span>
              <span v-if="affectedLabel(entry)">{{ affectedLabel(entry) }}</span>
              <span v-if="!entry.applied" class="meta-undone">{{ i18n.t("ops.undone") }}</span>
            </div>
          </div>

          <button
            v-if="entry.applied"
            class="row-btn"
            type="button"
            :disabled="busy"
            :title="i18n.t('ops.revertHint', { count: revertCount(entry) })"
            :aria-label="i18n.t('ops.revert')"
            @click="revert(entry)"
          >
            <ArrowUturnLeftIcon class="row-icon" />
          </button>
          <button
            v-else
            class="row-btn redo"
            type="button"
            :disabled="busy"
            :title="i18n.t('ops.reapplyHint', { count: redoCount(entry) })"
            :aria-label="i18n.t('ops.reapply')"
            @click="reapply(entry)"
          >
            <ArrowUturnRightIcon class="row-icon" />
          </button>
        </article>
      </template>

      <div v-if="dividerIndex === -1 && visible.length > 0" class="now-row">
        <span class="now-line" />
        <span class="now-pill">{{ i18n.t("ops.current") }}</span>
        <span class="now-line" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: rgb(var(--md-on-surface));
}

/* ---- 头部 ---- */
.head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 12px 6px;
}
.head-text {
  flex: 1 1 auto;
  min-width: 0;
}
.head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
}
.head-sub {
  margin: 2px 0 0;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgb(var(--md-on-surface-muted));
  font-variant-numeric: tabular-nums;
}
.head-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 1px;
}
.icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.icon-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.head-icon {
  width: 15px;
  height: 15px;
}

/* ---- 过滤 / 搜索 ---- */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 12px 8px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.chip:hover {
  color: rgb(var(--md-on-surface));
}
.chip.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.chip-count {
  font-size: 10px;
  opacity: 0.62;
  font-variant-numeric: tabular-nums;
}
.search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
}
.search:focus-within {
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.45);
}
.search-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12px;
}
.search-input::placeholder {
  color: rgb(var(--md-on-surface-muted));
}

/* ---- 时间线 ---- */
.list {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 24px 12px;
  scrollbar-width: thin;
}

.now-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 8px;
  padding-left: 24px;
}
.now-line {
  flex: 1 1 auto;
  height: 1px;
  background-color: rgb(var(--md-primary) / 0.42);
}
.now-pill {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
  font-size: 10px;
  font-weight: 500;
}

.op-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 6px 7px 0;
  border-radius: 10px;
  transition: background-color 0.14s ease;
}
.op-row:hover {
  background-color: rgb(var(--md-on-surface) / 0.035);
}
.op-row.undone .op-label {
  color: rgb(var(--md-on-surface-muted));
  text-decoration: line-through;
  text-decoration-color: rgb(var(--md-on-surface-muted) / 0.45);
}
.op-row.undone .rail-dot {
  opacity: 0.5;
}

.rail {
  position: relative;
  flex: 0 0 auto;
  width: 26px;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background-color: rgb(var(--md-outline-variant) / 0.55);
}
.rail-dot {
  position: relative;
  z-index: 1;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
}
.rail.human .rail-dot {
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.rail.builtin .rail-dot {
  background-color: rgb(var(--md-tertiary) / 0.16);
  color: rgb(var(--md-tertiary));
}
.rail.external .rail-dot {
  background-color: rgb(var(--md-secondary) / 0.18);
  color: rgb(var(--md-secondary));
}
.dot-icon {
  width: 11px;
  height: 11px;
}

.op-body {
  flex: 1 1 auto;
  min-width: 0;
}
.op-top {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.op-label {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface));
  overflow-wrap: anywhere;
}
.badge {
  flex: 0 0 auto;
  margin-top: 1px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
  background-color: rgb(var(--md-surface-container-high));
  white-space: nowrap;
}
.badge.human {
  color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary) / 0.1);
}
.badge.builtin {
  color: rgb(var(--md-tertiary));
  background-color: rgb(var(--md-tertiary) / 0.12);
}
.badge.external {
  color: rgb(var(--md-secondary));
  background-color: rgb(var(--md-secondary) / 0.14);
}
.op-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 2px;
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
  font-variant-numeric: tabular-nums;
}
.op-meta .kind {
  color: rgb(var(--md-on-surface-variant));
}
.meta-undone {
  color: rgb(var(--md-error));
}

.row-btn {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
  cursor: pointer;
  /* 常驻但克制：行操作是这个面板的核心能力，不能藏成「悬停才知道」。 */
  opacity: 0.5;
  transition: opacity 0.14s ease, background-color 0.14s ease, color 0.14s ease;
}
.op-row:hover .row-btn,
.row-btn:focus-visible {
  opacity: 1;
}
.row-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-primary) / 0.1);
  color: rgb(var(--md-primary));
}
.row-btn.redo:hover:not(:disabled) {
  background-color: rgb(var(--md-tertiary) / 0.14);
  color: rgb(var(--md-tertiary));
}
.row-btn:disabled {
  cursor: default;
  opacity: 0.35;
}
.row-icon {
  width: 13px;
  height: 13px;
}

.ops-pane .empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 48px 12px;
  color: rgb(var(--md-on-surface-muted));
  text-align: center;
  font-size: 12px;
}
.empty-icon {
  width: 26px;
  height: 26px;
  opacity: 0.45;
  margin-bottom: 2px;
}
.empty-title {
  margin: 0;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
}
.empty-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  max-width: 220px;
}

@media (hover: none) {
  .row-btn {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon-btn,
  .chip,
  .op-row,
  .row-btn {
    transition: none;
  }
}
</style>
