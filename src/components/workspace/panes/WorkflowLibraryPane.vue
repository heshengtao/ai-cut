<script setup lang="ts">
/**
 * 工作流库面板：默认工作流 + 用户保存的工作流（带版本）。
 *
 * 交互对齐素材库：卡片可以直接拖到画布上，也可以点「插入」；用户工作流可展开
 * 历史版本、恢复旧版本、改名、删除。保存当前画布在面板顶部与画布工具栏都有入口。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  Square3Stack3DIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import ProjectDialog from "@/components/common/ProjectDialog.vue";
import Md3Chip from "@/components/common/Md3Chip.vue";
import { clearDragPayload, setDragPayload } from "@/core/dragPayload";
import { useWorkflowLibrary, type WorkflowFilter } from "@/composables/useWorkflowLibrary";
import { useBoardStore } from "@/stores/board";
import { useI18n } from "@/i18n";
import { isKnownMessageKey } from "@/i18n/translate";
import type { WorkflowGroup, WorkflowVersion } from "@/types/workflow";

const i18n = useI18n();
const board = useBoardStore();
const library = useWorkflowLibrary();

const expanded = ref<Set<string>>(new Set());
const renameOpen = ref(false);
const renameTarget = ref<WorkflowGroup | null>(null);

const FILTERS: { id: WorkflowFilter; labelKey: string }[] = [
  { id: "all", labelKey: "board.library.filterAll" },
  { id: "builtin", labelKey: "board.library.filterBuiltin" },
  { id: "mine", labelKey: "board.library.filterMine" },
  { id: "subworkflow", labelKey: "board.library.filterWorkflow" },
  { id: "api", labelKey: "board.library.filterApi" },
];

const sourceLabel = computed(() => {
  const source = board.source;
  if (!source?.name) return "";
  return source.version
    ? i18n.t("board.library.currentVersion", { name: source.name, version: source.version })
    : source.name;
});

onMounted(() => {
  void library.refresh();
});

/** 工作流名：空名 / 历史泄漏的 i18n key 都显示成「未命名工作流」。 */
function displayName(group: WorkflowGroup): string {
  const name = group.name?.trim();
  if (!name || isKnownMessageKey(name)) return i18n.t("board.library.untitledWorkflow");
  return name;
}

function toggleVersions(rootId: string): void {
  const next = new Set(expanded.value);
  if (next.has(rootId)) next.delete(rootId);
  else next.add(rootId);
  expanded.value = next;
}

function onDragStart(event: DragEvent, group: WorkflowGroup, version?: WorkflowVersion): void {
  const target = version ?? group.latest;
  setDragPayload({ kind: "workflow", id: group.rootId, versionId: target.id });
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "copy";
    // 某些 WebView 只有在 setData 之后才允许拖拽。
    event.dataTransfer.setData("text/plain", target.name);
  }
}

function use(group: WorkflowGroup, version?: WorkflowVersion): void {
  void library.insertWorkflow(group, version);
}

function openRename(group: WorkflowGroup): void {
  if (group.builtin) return;
  renameTarget.value = group;
  renameOpen.value = true;
}

function submitRename(name: string): void {
  const group = renameTarget.value;
  renameTarget.value = null;
  if (group) void library.renameGroup(group, name);
}

function formatDate(value: number): string {
  if (!value) return i18n.t("board.library.builtinBadge");
  return new Date(value).toLocaleDateString(i18n.locale.value === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

function metaOf(group: WorkflowGroup): string {
  const latest = group.latest;
  return i18n.t("board.library.meta", {
    nodes: latest.nodeCount,
    edges: latest.edgeCount,
    date: formatDate(latest.updatedAt),
  });
}
</script>

<template>
  <div class="pane workflow-library">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">{{ i18n.t("board.library.title") }}</h2>
        <p class="pane-sub">{{ i18n.t("board.library.sub") }}</p>
      </div>
      <button
        class="save-pill"
        type="button"
        :disabled="library.saving.value || board.nodes.length === 0"
        :title="i18n.t('board.library.saveCurrent')"
        @click="library.openSave()"
      >
        <PlusIcon />
        <span>{{ i18n.t("board.library.save") }}</span>
      </button>
    </header>

    <p v-if="sourceLabel" class="source-line">
      <Square3Stack3DIcon />
      <span>{{ sourceLabel }}</span>
    </p>

    <div class="search-row">
      <MagnifyingGlassIcon class="search-icon" />
      <input
        v-model="library.query.value"
        class="search-field"
        type="search"
        :placeholder="i18n.t('board.library.search')"
        :aria-label="i18n.t('board.library.search')"
      />
    </div>

    <div class="filter-row" role="group">
      <Md3Chip
        v-for="item in FILTERS"
        :key="item.id"
        size="sm"
        :selected="library.filter.value === item.id"
        @click="library.filter.value = item.id"
      >
        {{ i18n.t(item.labelKey) }}
      </Md3Chip>
    </div>

    <div class="workflow-list">
      <p v-if="library.loading.value && library.visibleGroups.value.length === 0" class="library-empty">
        {{ i18n.t("board.library.loading") }}
      </p>
      <div v-else-if="library.visibleGroups.value.length === 0" class="library-empty">
        <Square3Stack3DIcon class="empty-icon" />
        <strong>{{ i18n.t("board.library.empty") }}</strong>
        <span>{{ i18n.t("board.library.emptyHint") }}</span>
      </div>

      <article
        v-for="group in library.visibleGroups.value"
        :key="group.rootId"
        class="workflow-card"
        :data-builtin="group.builtin ? 'true' : 'false'"
        draggable="true"
        @dragstart="onDragStart($event, group)"
        @dragend="clearDragPayload()"
        @dblclick="use(group)"
      >
        <div class="card-top">
          <span class="card-icon"><Square3Stack3DIcon /></span>
          <div class="card-title-wrap">
            <h3 class="card-title">{{ displayName(group) }}</h3>
            <p class="card-badges">
              <span class="badge" :data-kind="group.builtin ? 'builtin' : 'mine'">
                {{ group.builtin ? i18n.t("board.library.builtinBadge") : i18n.t("board.library.mineBadge") }}
              </span>
              <span class="badge version">v{{ group.latest.version }}</span>
              <span v-if="group.tags.includes('subworkflow')" class="badge publication">
                {{ i18n.t("board.library.badgeWorkflow") }}
              </span>
              <span v-if="group.tags.includes('api')" class="badge publication api">
                {{ i18n.t("board.library.badgeApi") }}
              </span>
              <span v-if="library.currentGroup.value?.rootId === group.rootId" class="badge current">
                {{ i18n.t("board.library.currentBadge") }}
              </span>
            </p>
          </div>
          <div class="card-actions">
            <button
              class="icon-btn"
              type="button"
              :title="i18n.t('board.library.insert')"
              :aria-label="i18n.t('board.library.insert')"
              @click.stop="use(group)"
            >
              <ArrowDownTrayIcon />
            </button>
            <button
              v-if="!group.builtin"
              class="icon-btn"
              type="button"
              :title="i18n.t('board.library.rename')"
              :aria-label="i18n.t('board.library.rename')"
              @click.stop="openRename(group)"
            >
              <PencilSquareIcon />
            </button>
            <button
              v-if="!group.builtin"
              class="icon-btn danger"
              type="button"
              :title="i18n.t('board.library.delete')"
              :aria-label="i18n.t('board.library.delete')"
              @click.stop="library.removeGroup(group)"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        <p v-if="group.description" class="card-desc">{{ group.description }}</p>

        <button class="card-meta" type="button" @click.stop="toggleVersions(group.rootId)">
          <ClockIcon />
          <span>{{ metaOf(group) }}</span>
          <ChevronDownIcon
            class="chevron"
            :class="{ open: expanded.has(group.rootId) }"
          />
        </button>

        <div v-if="expanded.has(group.rootId)" class="version-list">
          <div
            v-for="version in group.versions"
            :key="version.id"
            class="version-row"
          >
            <span class="version-tag">v{{ version.version }}</span>
            <span class="version-name">{{ version.name }}</span>
            <span class="version-date">{{ formatDate(version.updatedAt) }}</span>
            <button
              class="version-use"
              type="button"
              :title="i18n.t('board.library.insertVersion')"
              @click.stop="use(group, version)"
            >
              {{ i18n.t("board.library.restore") }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <ProjectDialog
      v-model:open="renameOpen"
      :initial-name="renameTarget?.name ?? ''"
      :title="i18n.t('board.library.renameTitle')"
      :label="i18n.t('board.library.nameLabel')"
      :confirm-text="i18n.t('board.library.rename')"
      @submit="submitRename"
    />
  </div>
</template>

<style scoped>
.workflow-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: 16px 14px 18px;
  gap: 10px;
  overflow: hidden;
}
.pane-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.pane-title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  color: rgb(var(--md-on-surface));
}
.pane-sub {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-variant));
}
.save-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.save-pill svg {
  width: 14px;
  height: 14px;
}
.save-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.source-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 10px;
  border-radius: 10px;
  background-color: rgb(var(--md-primary) / 0.1);
  color: rgb(var(--md-primary));
  font-size: 11px;
  font-weight: 550;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.source-line svg {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.search-row {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  width: 15px;
  height: 15px;
  color: rgb(var(--md-on-surface-variant));
  pointer-events: none;
}
.search-field {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 31px;
  border: 0;
  border-radius: 11px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  outline: none;
}
.search-field:focus {
  box-shadow: inset 0 0 0 1.5px rgb(var(--md-primary));
}
.filter-row {
  display: flex;
  gap: 6px;
}
.filter-chip {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
}
.filter-chip.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-weight: 600;
}
.workflow-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-bottom: 4px;
}
.library-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 28px 6px;
  text-align: center;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  line-height: 1.5;
}
.library-empty strong {
  color: rgb(var(--md-on-surface));
  font-size: 12.5px;
}
.empty-icon {
  width: 30px;
  height: 30px;
  opacity: 0.6;
}
.workflow-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 11px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  cursor: grab;
}
.workflow-card[data-builtin="true"] {
  background-color: rgb(var(--md-surface-container));
}
.workflow-card:active {
  cursor: grabbing;
}
.card-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.card-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background-color: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
  flex: 0 0 auto;
}
.card-icon svg {
  width: 15px;
  height: 15px;
}
.card-title-wrap {
  flex: 1 1 auto;
  min-width: 0;
}
.card-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 650;
  color: rgb(var(--md-on-surface));
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 0;
}
.badge {
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 9.5px;
  font-weight: 600;
}
.badge[data-kind="builtin"] {
  background-color: rgb(var(--md-tertiary-container) / 0.7);
}
.badge.version {
  font-family: var(--md-font-mono, ui-monospace, monospace);
}
.badge.current {
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
}
.card-actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}
.icon-btn {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}
.icon-btn.danger:hover {
  color: rgb(var(--md-error));
}
.icon-btn svg {
  width: 14px;
  height: 14px;
}
.card-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
}
.card-meta svg {
  width: 12px;
  height: 12px;
}
.card-meta .chevron {
  margin-left: auto;
  transition: transform 0.16s ease;
}
.card-meta .chevron.open {
  transform: rotate(180deg);
}
.version-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 5px;
  border-top: 1px dashed rgb(var(--md-outline-variant) / 0.6);
}
.version-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 2px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.version-tag {
  flex: 0 0 auto;
  font-family: var(--md-font-mono, ui-monospace, monospace);
  font-weight: 650;
  color: rgb(var(--md-primary));
}
.version-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.version-date {
  flex: 0 0 auto;
}
.version-use {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 10px;
  cursor: pointer;
}
.version-use:hover {
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
}

.workflow-card .badge.publication {
  background: color-mix(in srgb, rgb(var(--md-primary)) 18%, transparent);
  color: rgb(var(--md-primary));
}

.workflow-card .badge.publication.api {
  background: color-mix(in srgb, rgb(var(--md-tertiary)) 20%, transparent);
  color: rgb(var(--md-tertiary));
}
</style>
