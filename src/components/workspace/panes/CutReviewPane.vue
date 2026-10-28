<script setup lang="ts">
/**
 * 剪口播审查面板（剪映式）：文稿是主画布，剪掉的字划掉，点一下还原。
 *
 * - 点划掉的字 → 还原那处剪口；
 * - 点普通字 → 选中它（同时把播放头移过去），Delete 剪掉；拖选可以一次剪一段；
 * - 文字修改不在这一层做：剪完会生成「口播字幕」轨，改字去时间线上的字幕片段改。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowPathIcon, ArrowUturnLeftIcon, ScissorsIcon } from "@heroicons/vue/24/outline";
import Tooltip from "@/components/common/Tooltip.vue";
import { useCutReviewStore } from "@/stores/cutReview";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { useI18n } from "@/i18n";
import { humanSize } from "@/utils/size";
import type { CutRecord } from "@/types/project";

const cut = useCutReviewStore();
const models = useModelsStore();
const project = useProjectStore();
const selection = useSelectionStore();
const playback = usePlaybackStore();
const layout = useLayoutStore();
const i18n = useI18n();

const dragging = ref(false);
const anchor = ref<number | null>(null);
const focus = ref<number | null>(null);
const moved = ref(false);

/** 该用的识别模型（没装也返回，按钮据此显示「下载 XX MB」）。 */
const model = computed(() => cut.candidateModel());
const aligner = computed(() => cut.alignerModel());
const modelReady = computed(() => Boolean(model.value?.installed) && cut.alignerReady());
const modelMissing = computed(() => cut.missingBytesNow());

interface Entry {
  word: { id: string; text: string; start: number; end: number };
  index: number;
}

interface Gap {
  cuts: CutRecord[];
  label: string;
}

interface Row {
  entries: Entry[];
  /** 与 `entries` 同长：这一格前面夹着的停顿剪口（第 0 格为 null）。 */
  gaps: (Gap | null)[];
}

/** 当前选中的片段与素材（只在启动识别时用）。 */
const target = computed(() => {
  const id = selection.selectedClipIds[0];
  if (!id) return null;
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (!clip?.assetId) continue;
    const asset = project.doc.assets.find((candidate) => candidate.id === clip.assetId);
    if (asset) return { clip, asset };
  }
  return null;
});

const range = computed(() => {
  if (anchor.value === null || focus.value === null) return null;
  return {
    from: Math.min(anchor.value, focus.value),
    to: Math.max(anchor.value, focus.value),
  };
});

const selectedWords = computed(() => {
  const current = range.value;
  if (!current) return [];
  return cut.words.slice(current.from, current.to + 1);
});

const selectedSeconds = computed(() => {
  const picked = selectedWords.value;
  if (picked.length === 0) return 0;
  return Math.max(0, picked[picked.length - 1].end - picked[0].start);
});

function seconds(value: number): string {
  return i18n.t("cutReview.seconds", { value: value.toFixed(1) });
}

/** 词 → 落在它上面的剪口。 */
function cutOfWord(word: { start: number; end: number }): CutRecord | null {
  const scope = cut.scope;
  if (!scope) return null;
  const middle = (word.start + word.end) / 2;
  return scope.cuts.find((item) => middle >= item.srcStart && middle < item.srcEnd) ?? null;
}

/** 落在两个词之间的停顿剪口。 */
function pauseCutsBetween(previous: { end: number }, next: { start: number }): CutRecord[] {
  const scope = cut.scope;
  if (!scope) return [];
  return scope.cuts.filter(
    (item) => item.srcStart >= previous.end - 1e-6 && item.srcEnd <= next.start + 1e-6,
  );
}

const rows = computed<Row[]>(() => {
  let cursor = 0;
  return cut.paragraphs.map((paragraph) => {
    const entries = paragraph.map((word) => ({ word, index: cursor++ }));
    const gaps = entries.map((entry, index) => {
      if (index === 0) return null;
      const found = pauseCutsBetween(entries[index - 1].word, entry.word);
      if (found.length === 0) return null;
      const removed = found.reduce((sum, item) => sum + (item.srcEnd - item.srcStart), 0);
      return { cuts: found, label: seconds(removed) };
    });
    return { entries, gaps };
  });
});

function wordIndexFromEvent(event: PointerEvent): number | null {
  const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-index]");
  if (!element) return null;
  const raw = Number(element.dataset.index);
  return Number.isFinite(raw) ? raw : null;
}

function onPointerDown(event: PointerEvent, index: number): void {
  if (event.button !== 0) return;
  dragging.value = true;
  moved.value = false;
  anchor.value = index;
  focus.value = index;
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const index = wordIndexFromEvent(event);
  if (index === null || index === focus.value) return;
  focus.value = index;
  moved.value = true;
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  const index = focus.value;
  if (moved.value || index === null) return;
  // 单击：划掉的字 = 还原，其余 = 选中这一个字并把播放头移过去。
  const word = cut.words[index];
  if (!word) return;
  const hit = cutOfWord(word);
  if (hit) {
    anchor.value = null;
    focus.value = null;
    cut.restoreCut(hit.id);
    return;
  }
  anchor.value = index;
  focus.value = index;
  seekTo(word.start);
}

/** 素材时间 → 时间线时间（按当前剪口投影折算）。 */
function seekTo(sourceTime: number): void {
  const scope = cut.scope;
  if (!scope) return;
  for (const piece of project.doc.tracks.flatMap((track) => track.clips)) {
    if (!scope.pieces.includes(piece.id)) continue;
    const speed = piece.speed ?? 1;
    const span = piece.duration * speed;
    if (sourceTime >= piece.in - 1e-6 && sourceTime <= piece.in + span + 1e-6) {
      playback.setPlayhead(piece.start + (sourceTime - piece.in) / speed);
      return;
    }
  }
}

function clearSelection(): void {
  anchor.value = null;
  focus.value = null;
}

/** 剪掉当前选中的词。用的是「这次识别的片段」，不是时间线上当前选中的片段。 */
function cutSelection(): void {
  const picked = selectedWords.value;
  if (picked.length === 0) return;
  const from = picked[0].start;
  const to = picked[picked.length - 1].end;
  const changed = cut.cutWords(from, to, picked.map((word) => word.text).join(""));
  clearSelection();
  if (!changed) toast(i18n.t("cutReview.cutNoop"));
}

/** 定位到选区开头（不剪）。 */
function locateSelection(): void {
  const picked = selectedWords.value;
  if (picked.length > 0) seekTo(picked[0].start);
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (target?.isContentEditable) return;
  if ((event.key === "Delete" || event.key === "Backspace") && selectedWords.value.length > 0) {
    event.preventDefault();
    event.stopPropagation();
    cutSelection();
    return;
  }
  if (event.key === "Escape") clearSelection();
}

async function run(): Promise<void> {
  const current = target.value;
  if (!current) {
    toast(i18n.t("cutReview.selectClip"));
    return;
  }
  if (!model.value) {
    toast(i18n.t("cutReview.noModel"), "error");
    layout.openTab("models");
    return;
  }
  if (!modelReady.value) {
    const targets = [model.value, aligner.value].filter(
      (entry): entry is NonNullable<typeof entry> => Boolean(entry) && !entry!.installed,
    );
    const accepted = await confirm({
      title: i18n.t("dialog.downloadModelTitle"),
      message: i18n.t("cutReview.downloadMany", {
        names: targets.map((entry) => entry.name).join(i18n.t("common.listSeparator")),
        size: humanSize(modelMissing.value),
      }),
      confirmText: i18n.t("dialog.downloadModelOk"),
      cancelText: i18n.t("common.cancel"),
    });
    if (!accepted) return;
    layout.openTab("models");
    for (const entry of targets) {
      try {
        await models.download(entry.id);
      } catch {
        return;
      }
    }
  }
  clearSelection();
  try {
    const count = await cut.run(current.asset, current.clip);
    if (cut.words.length === 0) {
      toast(i18n.t("cutReview.noSpeech"));
      return;
    }
    if (count === 0) {
      toast(i18n.t("cutReview.nothingFound"));
      return;
    }
    toast(i18n.t("cutReview.done", { count, seconds: seconds(cut.removedSeconds) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(i18n.t("cutReview.failed", { error: message }), "error");
  }
}

function restoreAll(): void {
  cut.restoreAll();
}

// 换选片段时把工程里存的词表接回来；点到字幕片段（不在剪口组里）不动当前审查。
watch(
  target,
  (current) => {
    if (current) cut.adopt(current.clip);
  },
  { immediate: true },
);

onMounted(() => {
  // 面板自己拉一次模型清单：否则「模型已就绪 / 下载 XX MB」会算成 0B。
  if (models.catalog.length === 0) void models.load();
  window.addEventListener("keydown", onKeydown, true);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <div class="cut-pane">
    <header class="head">
      <div class="head-text">
        <span class="head-title">{{ i18n.t("cutReview.title") }}</span>
        <p class="head-sub">
          {{
            i18n.t("cutReview.emptyCount", {
              count: cut.cuts.length,
              seconds: seconds(cut.removedSeconds),
            })
          }}
        </p>
      </div>
      <div class="head-actions">
        <Tooltip :text="i18n.t('cutReview.rerun')">
          <button class="icon-btn" :disabled="cut.running" @click="run">
            <ArrowPathIcon class="icon" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('cutReview.removedAll')">
          <button class="icon-btn" :disabled="cut.cuts.length === 0" @click="restoreAll">
            <ArrowUturnLeftIcon class="icon" />
          </button>
        </Tooltip>
      </div>
    </header>

    <div v-if="cut.running" class="progress">
      <div class="progress-fill" :style="{ width: `${cut.progressPct}%` }" />
    </div>

    <div v-if="!cut.timed && cut.words.length > 0" class="notice">
      {{ i18n.t("cutReview.estimated") }}
    </div>

    <div v-if="cut.words.length === 0" class="empty">
      <ScissorsIcon class="empty-icon" />
      <p>{{ i18n.t("cutReview.empty") }}</p>
      <button class="run-btn" :disabled="cut.running" @click="run">
        {{
          cut.running
            ? i18n.t("cutReview.running")
            : modelReady
              ? i18n.t("cutReview.start")
              : i18n.t("audio.downloadModel", { size: humanSize(modelMissing) })
        }}
      </button>
    </div>

    <div
      v-else
      class="transcript"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <p v-for="(row, pIndex) in rows" :key="pIndex" class="paragraph">
        <template v-for="(entry, wIndex) in row.entries" :key="entry.index">
          <span
            v-if="wIndex > 0 && row.gaps[wIndex]"
            class="pause-chip"
            :title="i18n.t('cutReview.restoreOne')"
            @click.stop="row.gaps[wIndex]?.cuts.forEach((item) => cut.restoreCut(item.id))"
          >
            ◷ {{ row.gaps[wIndex]?.label }}
          </span>
          <span
            class="word"
            :data-index="entry.index"
            :class="{
              cut: cutOfWord(entry.word),
              selected: range && entry.index >= range.from && entry.index <= range.to,
            }"
            :title="cutOfWord(entry.word) ? i18n.t('cutReview.restoreOne') : ''"
            @pointerdown="onPointerDown($event, entry.index)"
          >{{ entry.word.text }}</span>
        </template>
      </p>
    </div>

    <div v-if="range" class="action-bar">
      <span class="selection">
        {{
          i18n.t("cutReview.selectionHint", {
            count: selectedWords.length,
            value: seconds(selectedSeconds),
          })
        }}
      </span>
      <button class="text-btn" @click="locateSelection">{{ i18n.t("cutReview.locate") }}</button>
      <button class="run-btn small" @click="cutSelection">
        {{ i18n.t("cutReview.cutSelection", { value: seconds(selectedSeconds) }) }}
      </button>
      <button class="icon-btn" :title="i18n.t('common.cancel')" @click="clearSelection">
        ✕
      </button>
    </div>

    <footer v-else class="foot">
      <span class="foot-hint">{{ i18n.t("cutReview.selectHint") }}</span>
    </footer>
  </div>
</template>

<style scoped>
.cut-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: rgb(var(--md-on-surface));
}

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

.head-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
}

.head-sub {
  margin: 2px 0 0;
  font-size: 12px;
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
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  background: rgb(var(--md-on-surface) / 0.08);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.icon {
  width: 17px;
  height: 17px;
}

.progress {
  flex: 0 0 auto;
  height: 3px;
  margin: 0 12px 6px;
  border-radius: 2px;
  overflow: hidden;
  background: rgb(var(--md-surface-container-high));
}

.progress-fill {
  height: 100%;
  background: rgb(var(--md-primary));
  transition: width 0.2s ease;
}

.notice {
  flex: 0 0 auto;
  margin: 0 12px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--md-on-tertiary-container));
  background: rgb(var(--md-tertiary-container));
}

.empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 16px;
  text-align: center;
}

.empty p {
  margin: 0;
  max-width: 26em;
  font-size: 13px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}

.empty-icon {
  width: 24px;
  height: 24px;
  color: rgb(var(--md-on-surface-muted));
}

.transcript {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 12px 12px;
  user-select: none;
}

.paragraph {
  margin: 0 0 12px;
  font-size: 15.5px;
  line-height: 2.05;
}

.word {
  padding: 1px 0;
  border-radius: 3px;
  cursor: pointer;
}

.word:hover {
  background: rgb(var(--md-on-surface) / 0.08);
}

.word.selected {
  background: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
}

/* 剪掉的字：划掉 + 退灰，点一下还原。 */
.word.cut {
  color: rgb(var(--md-on-surface-muted));
  background: rgb(var(--md-error-container) / 0.35);
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: rgb(var(--md-error) / 0.7);
}

.word.cut:hover {
  background: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}

.pause-chip {
  margin: 0 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11.5px;
  color: rgb(var(--md-error));
  background: rgb(var(--md-error-container) / 0.35);
  cursor: pointer;
}

.action-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 10px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.5);
}

.selection {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}

.text-btn {
  border: 0;
  background: transparent;
  padding: 0 4px;
  color: rgb(var(--md-primary));
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}

.text-btn:hover {
  text-decoration: underline;
}

.run-btn {
  flex: 0 0 auto;
  height: 32px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.14s ease;
}

.run-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.run-btn.small {
  height: 28px;
  padding: 0 13px;
  font-size: 12.5px;
}

.foot {
  flex: 0 0 auto;
  padding: 6px 12px 10px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.5);
}

.foot-hint {
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--md-on-surface-muted));
}
</style>
