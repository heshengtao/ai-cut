<script setup lang="ts">
/**
 * 画布检查器（未选中节点时）：多画布列表。
 *
 * 点画布空白处就会回到这里：切换 / 新建 / 改名 / 复制 / 删除画布；每行有一个
 * 显眼的「发布」按钮，点开模态框配置签名用途后发布成子工作流 / API。
 *
 * 视觉对齐工作流库面板：同一套 MD3 卡片层级（surface-container-highest 行 +
 * outline-variant 描边 + 14px 圆角）、同一套字号 / 徽章比例；图标全部显式给尺寸
 * （Heroicons 默认不带 width/height，不写就会撑成巨大一块）。
 */
import { computed, onMounted, ref } from "vue";
import {
  ArrowUpTrayIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  Squares2X2Icon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useBoardStore } from "@/stores/board";
import { useWorkflowLibrary } from "@/composables/useWorkflowLibrary";
import { useCanvasPublish } from "@/composables/useCanvasPublish";
import { useBoardLabels } from "@/composables/useBoardLabels";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { canvasWorkflow, workflowProblems } from "@/core/board/workflowNodes";
import type { BoardCanvas } from "@/types/board";

const i18n = useI18n();
const board = useBoardStore();
const library = useWorkflowLibrary();
const publish = useCanvasPublish();
const { canvasTitle } = useBoardLabels();

const renamingId = ref("");
const renameText = ref("");

/**
 * 每张画布的轻量元信息（节点数、签名、校验问题、来源工作流、是否已发布）。
 *
 * 活动画布用 store 里的**实时**节点：画布文档是防抖落盘的，直接读 `canvas.doc`
 * 会看到 350ms 前的旧状态（刚加的工作流开始 / 结束还没出现在校验里）。
 */
function metaOf(canvas: BoardCanvas) {
  const live = canvas.id === board.activeCanvasId;
  const nodes = live ? board.nodes : (canvas.doc.nodes ?? []);
  const edges = live ? board.edges : (canvas.doc.edges ?? []);
  const workflow = canvasWorkflow(nodes);
  const source = live ? board.source : canvas.doc.source;
  const group = source?.rootId
    ? library.groups.value.find((item) => item.rootId === source.rootId)
    : undefined;
  return {
    nodeCount: nodes.length,
    inputs: workflow.signature.inputs,
    outputs: workflow.signature.outputs,
    problems: workflowProblems(nodes, edges),
    source: source?.name ?? "",
    published: Boolean(
      group && (group.tags.includes("api") || group.tags.includes("subworkflow")),
    ),
  };
}

const rows = computed(() =>
  board.canvases.map((canvas, index) => ({
    canvas,
    meta: metaOf(canvas),
    active: canvas.id === board.activeCanvasId,
    // 没起名字的画布用「画布 N」：按当前语言渲染，不把语言写进文档。
    title: canvasTitle(canvas, index),
  })),
);

onMounted(() => {
  void library.refresh();
});

function switchTo(canvasId: string): void {
  board.openCanvas(canvasId);
}

function startRename(canvas: BoardCanvas): void {
  renamingId.value = canvas.id;
  // 自动名（空标题）留空输入框，占位显示「画布 N」；显式名字直接带出来编辑。
  renameText.value = canvas.title?.trim() ?? "";
}

/** 清空输入 = 回到自动名（「画布 N」）。 */
function commitRename(): void {
  if (!renamingId.value) return;
  board.renameCanvas(renamingId.value, renameText.value);
  renamingId.value = "";
}

function newCanvas(): void {
  board.newCanvas();
}

async function duplicate(canvas: BoardCanvas): Promise<void> {
  board.duplicateCanvas(canvas.id);
  toast(i18n.t("board.canvas.copySuffix"));
}

async function remove(canvas: BoardCanvas, title: string): Promise<void> {
  if (board.canvases.length <= 1) return;
  const accepted = await confirm({
    title: i18n.t("board.canvas.deleteTitle"),
    message: i18n.t("board.canvas.deleteMessage", { name: title }),
    confirmText: i18n.t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;
  board.removeCanvas(canvas.id);
}

function signatureText(row: { meta: { inputs: unknown[]; outputs: unknown[] } }): string {
  if (row.meta.inputs.length === 0 && row.meta.outputs.length === 0) {
    return i18n.t("board.canvas.signatureNone");
  }
  return i18n.t("board.canvas.signatureSummary", {
    inputs: row.meta.inputs.length,
    outputs: row.meta.outputs.length,
  });
}
</script>

<template>
  <div class="canvas-inspector">
    <header class="ci-head">
      <div class="ci-head-copy">
        <h2>{{ i18n.t("board.canvas.list") }}</h2>
        <span class="ci-count">{{ i18n.t("board.canvas.count", { count: rows.length }) }}</span>
      </div>
      <button
        class="ci-new"
        type="button"
        :title="i18n.t('board.canvas.new')"
        :aria-label="i18n.t('board.canvas.new')"
        @click="newCanvas"
      >
        <PlusIcon />
        <span>{{ i18n.t("board.canvas.new") }}</span>
      </button>
    </header>

    <p class="ci-hint">{{ i18n.t("board.canvas.emptyHint") }}</p>

    <div class="ci-list" role="list" :aria-label="i18n.t('board.canvas.list')">
      <div
        v-for="row in rows"
        :key="row.canvas.id"
        class="ci-item"
        :data-active="row.active ? 'true' : 'false'"
        role="listitem"
        :aria-current="row.active ? 'true' : undefined"
        tabindex="0"
        @click="switchTo(row.canvas.id)"
        @keydown.enter.prevent="switchTo(row.canvas.id)"
        @keydown.space.prevent="switchTo(row.canvas.id)"
      >
        <span class="ci-item-icon"><Squares2X2Icon /></span>

        <div class="ci-item-main">
          <input
            v-if="renamingId === row.canvas.id"
            v-model="renameText"
            class="ci-rename"
            :placeholder="row.title"
            :aria-label="i18n.t('board.canvas.rename')"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renamingId = ''"
            @blur="commitRename"
          />
          <div v-else class="ci-item-title">
            <strong :title="row.title">{{ row.title }}</strong>
            <span v-if="row.active" class="ci-chip current">
              {{ i18n.t("board.canvas.current") }}
            </span>
          </div>

          <div class="ci-item-meta">
            <span>{{ i18n.t("board.canvas.nodeCount", { count: row.meta.nodeCount }) }}</span>
            <span class="ci-sep" aria-hidden="true">·</span>
            <span>{{ signatureText(row) }}</span>
          </div>

          <div v-if="row.meta.source || row.meta.problems.length || row.meta.published" class="ci-item-tags">
            <span v-if="row.meta.source" class="ci-chip">{{ row.meta.source }}</span>
            <span v-if="row.meta.published" class="ci-chip published">
              {{ i18n.t("board.canvas.publishedBadge") }}
            </span>
            <span v-if="row.meta.problems.length" class="ci-chip warn">
              {{ i18n.t("board.canvas.problemCount", { count: row.meta.problems.length }) }}
            </span>
          </div>
        </div>

        <div class="ci-trailing" @click.stop>
          <button
            class="ci-publish"
            type="button"
            :title="i18n.t('board.canvas.publish')"
            :aria-label="i18n.t('board.canvas.publish')"
            @click="publish.openPublish(row.canvas.id)"
          >
            <ArrowUpTrayIcon />
            <span>{{ i18n.t("board.canvas.publish") }}</span>
          </button>
          <div class="ci-actions">
            <button
              class="ci-icon-btn"
              type="button"
              :title="i18n.t('board.canvas.rename')"
              :aria-label="i18n.t('board.canvas.rename')"
              @click="startRename(row.canvas)"
            >
              <PencilSquareIcon />
            </button>
            <button
              class="ci-icon-btn"
              type="button"
              :title="i18n.t('board.canvas.duplicate')"
              :aria-label="i18n.t('board.canvas.duplicate')"
              @click="duplicate(row.canvas)"
            >
              <DocumentDuplicateIcon />
            </button>
            <button
              class="ci-icon-btn danger"
              type="button"
              :disabled="rows.length <= 1"
              :title="i18n.t('board.canvas.delete')"
              :aria-label="i18n.t('board.canvas.delete')"
              @click="remove(row.canvas, row.title)"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================
   画布列表（MD3）
   - 列表项 = surface-container-highest；描边 outline-variant / 0.4
   - 字号：标题 13/600、正文 12、辅助 10.5、徽章 9.5/600
   - 状态层：hover = on-surface / 0.06，选中 = primary / 0.14
   - 图标：Heroicons 默认无尺寸，这里全部显式给 13–16px
   ============================================================ */
.canvas-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}

/* 兜底：任何漏写尺寸的图标都不会撑成巨块（后面更具体的规则再覆盖）。 */
.canvas-inspector svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.ci-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ci-head-copy {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.ci-head-copy h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.1px;
  color: rgb(var(--md-on-surface));
}

.ci-count {
  padding: 1px 7px;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
}

.ci-new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--md-duration-short-2) var(--md-ease-standard);
}

.ci-new:hover {
  background-color: color-mix(
    in srgb,
    rgb(var(--md-on-secondary-container)) 10%,
    rgb(var(--md-secondary-container))
  );
}

.ci-new:focus-visible,
.ci-icon-btn:focus-visible,
.ci-publish:focus-visible,
.ci-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}

.ci-new svg {
  width: 14px;
  height: 14px;
}

.ci-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-muted));
}

.ci-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ci-item {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px 9px 9px 10px;
  border-radius: 14px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.4);
  /* 面板底色是 app-card，深色下等于 container-high：列表项要高一层才看得出来。 */
  background-color: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    border-color var(--md-duration-short-2) var(--md-ease-standard);
}

.ci-item:hover {
  background-color: color-mix(
    in srgb,
    rgb(var(--md-on-surface)) 6%,
    rgb(var(--md-surface-container-highest))
  );
}

.ci-item[data-active="true"] {
  border-color: rgb(var(--md-primary) / 0.5);
  background-color: color-mix(
    in srgb,
    rgb(var(--md-primary)) 14%,
    rgb(var(--md-surface-container-highest))
  );
}

.ci-item-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background-color: rgb(var(--md-primary-container) / 0.62);
  color: rgb(var(--md-on-primary-container));
}

.ci-item-icon svg {
  width: 16px;
  height: 16px;
}

.ci-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ci-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ci-item-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: rgb(var(--md-on-surface));
}

.ci-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 10.5px;
  line-height: 15px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ci-sep {
  opacity: 0.6;
}

.ci-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 1px;
}

.ci-rename {
  width: 100%;
  height: 26px;
  padding: 0 7px;
  border: 1px solid rgb(var(--md-primary) / 0.6);
  border-radius: var(--md-shape-corner-sm);
  background-color: rgb(var(--md-surface-container-lowest));
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  font-weight: 600;
  outline: none;
}

.ci-trailing {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
}

/* 「发布」是这一页最常用的动作：给一个实心/tonal 按钮，不藏在图标里。 */
.ci-publish {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    filter var(--md-duration-short-2) var(--md-ease-standard);
}

.ci-publish:hover {
  filter: brightness(1.06);
}

.ci-publish svg {
  width: 13px;
  height: 13px;
}

.ci-item[data-active="true"] .ci-publish {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}

.ci-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0.62;
  transition: opacity var(--md-duration-short-2) var(--md-ease-standard);
}

.ci-item:hover .ci-actions,
.ci-item:focus-within .ci-actions,
.ci-item[data-active="true"] .ci-actions {
  opacity: 1;
}

/* 触屏没有 hover：操作按钮常显。 */
@media (hover: none) {
  .ci-actions {
    opacity: 1;
  }
}

.ci-icon-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--md-shape-corner-full);
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition:
    background-color var(--md-duration-short-2) var(--md-ease-standard),
    color var(--md-duration-short-2) var(--md-ease-standard);
}

.ci-icon-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  color: rgb(var(--md-on-surface));
}

.ci-icon-btn.danger:hover:not(:disabled) {
  color: rgb(var(--md-error));
}

.ci-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ci-icon-btn svg {
  width: 13px;
  height: 13px;
}

.ci-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 9.5px;
  font-weight: 600;
  line-height: 16px;
}

.ci-chip.current {
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
}

.ci-chip.published {
  background-color: rgb(var(--md-tertiary-container) / 0.7);
  color: rgb(var(--md-on-tertiary-container));
}

.ci-chip.warn {
  background-color: rgb(var(--md-error-container) / 0.55);
  color: rgb(var(--md-on-error-container));
}

/* 窄面板：元信息行允许换行，避免把标题挤没。 */
@media (max-width: 340px) {
  .ci-item-meta {
    white-space: normal;
  }
}
</style>
