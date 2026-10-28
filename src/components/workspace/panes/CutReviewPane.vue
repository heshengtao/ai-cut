<script setup lang="ts">
/**
 * 剪口播审查面板（剪映式）：文稿是主画布，剪掉的字划掉，点一下还原。
 *
 * 剪口落在工程文档里（`cutScopes`），这里只负责显示与派发：
 * - 点划掉的字 → 删掉那条剪口，时间线还原；
 * - 拖选文字 → 直接剪掉（手动剪口）；
 * - 双击文字 → 改错别字（只改词表，不动时间线，所以不会触发剪切）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ScissorsIcon } from "@heroicons/vue/24/outline";
import { useCutReviewStore } from "@/stores/cutReview";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { toast } from "@/composables/useToast";
import { useI18n } from "@/i18n";
import { cutSourceRange } from "@/core/cuts";
import { humanSize, missingBytes } from "@/utils/size";
import { confirm } from "@/composables/useConfirm";
import type { CutRecord } from "@/types/project";

const cut = useCutReviewStore();
const models = useModelsStore();
const project = useProjectStore();
const selection = useSelectionStore();
const playback = usePlaybackStore();
const layout = useLayoutStore();
const i18n = useI18n();

const scroller = ref<HTMLElement | null>(null);
const dragging = ref(false);
const anchor = ref<number | null>(null);
const focus = ref<number | null>(null);
const moved = ref(false);
const editing = ref<number | null>(null);
const editText = ref("");

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

/** 当前片段里落在两个词之间的剪口（停顿类）。 */
function pauseCutsBetween(
  previous: { end: number },
  next: { start: number },
): CutRecord[] {
  const scope = cut.scope;
  if (!scope) return [];
  return scope.cuts.filter(
    (item) => item.srcStart >= previous.end - 1e-6 && item.srcEnd <= next.start + 1e-6,
  );
}

/** 段落 → 带全局下标的词 + 停顿剪口。 */
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

/** 当前选中的片段与素材。 */
const target = computed(() => {
  const id = selection.selectedClipIds[0];
  if (!id) return null;
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (!clip) continue;
    if (!clip.assetId) return null;
    const asset = project.doc.assets.find((candidate) => candidate.id === clip.assetId);
    if (!asset) return null;
    return { clip, asset };
  }
  return null;
});

/** 该用的识别模型（没装也返回，按钮据此显示「下载 XX MB」）。 */
const model = computed(() => cut.candidateModel());
const modelReady = computed(() => Boolean(model.value?.installed));
const modelMissing = computed(() => (model.value ? missingBytes(model.value) : 0));

// 打开工程或换选片段时，把工程里存的词表接回来。
watch(
  target,
  (current) => {
    if (current) cut.adopt(current.clip);
  },
  { immediate: true },
);

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

/** 词 → 落在它上面的剪口。 */
function cutOfWord(word: { start: number; end: number }): CutRecord | null {
  const scope = cut.scope;
  if (!scope) return null;
  const middle = (word.start + word.end) / 2;
  return scope.cuts.find((item) => middle >= item.srcStart && middle < item.srcEnd) ?? null;
}

function wordIndexFromEvent(event: PointerEvent): number | null {
  const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-index]");
  if (!element) return null;
  const raw = Number(element.dataset.index);
  return Number.isFinite(raw) ? raw : null;
}

function onPointerDown(event: PointerEvent, index: number): void {
  if (editing.value !== null || event.button !== 0) return;
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
  if (!moved.value && index !== null) {
    const current = range.value;
    anchor.value = null;
    focus.value = null;
    if (current) onWordClick(index);
  }
}

/** 单击：划掉的字 = 还原；普通字 = 跳到那一句。 */
function onWordClick(index: number): void {
  const word = cut.words[index];
  if (!word) return;
  const hit = cutOfWord(word);
  if (hit) {
    cut.restoreCut(hit.id);
    return;
  }
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

function startDrag(): void {
  anchor.value = null;
  focus.value = null;
}

/** 把当前选中的词剪掉。 */
function cutSelection(): void {
  const picked = selectedWords.value;
  const clip = target.value?.clip;
  if (picked.length === 0 || !clip) return;
  const from = picked[0].start;
  const to = picked[picked.length - 1].end;
  project.dispatch(
    (doc) =>
      cutSourceRange(
        doc,
        clip.id,
        from,
        to,
        "manual",
        picked.map((word) => word.text).join(""),
      ),
    {
      kind: "ui.dispatch",
      actor: "human",
      label: i18n.t("cutReview.cutSelection", { value: seconds(to - from) }),
    },
  );
  startDrag();
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.key === "Delete" || event.key === "Backspace") && selectedWords.value.length > 0) {
    event.preventDefault();
    cutSelection();
  }
  if (event.key === "Escape") startDrag();
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
    // 与 AI 面板其它卡片一致：缺模型先确认再下载，下完继续识别。
    const accepted = await confirm({
      title: i18n.t("dialog.downloadModelTitle"),
      message: i18n.t("dialog.downloadModelMessage", {
        name: model.value.name,
        size: humanSize(modelMissing.value),
      }),
      confirmText: i18n.t("dialog.downloadModelOk"),
      cancelText: i18n.t("common.cancel"),
    });
    if (!accepted) return;
    layout.openTab("models");
    try {
      await models.download(model.value.id);
    } catch {
      return;
    }
  }
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
    toast(
      i18n.t("cutReview.done", { count, seconds: seconds(cut.removedSeconds) }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(i18n.t("cutReview.failed", { error: message }), "error");
  }
}

function restoreAll(): void {
  cut.restoreAll();
}

/** 双击改字：只改词表，不改时间线，所以不会触发剪切。 */
function beginEdit(event: MouseEvent, index: number): void {
  event.stopPropagation();
  startDrag();
  editing.value = index;
  editText.value = cut.words[index].text;
  void nextTick(() => {
    const input = scroller.value?.querySelector<HTMLInputElement>(".word-input");
    input?.focus();
    input?.select();
  });
}

function commitEdit(): void {
  const index = editing.value;
  if (index === null) return;
  const value = editText.value.trim();
  if (value) cut.renameWord(index, value);
  editing.value = null;
}

function seconds(value: number): string {
  return i18n.t("cutReview.seconds", { value: value.toFixed(1) });
}

onMounted(() => window.addEventListener("pointerup", onPointerUp));
onBeforeUnmount(() => window.removeEventListener("pointerup", onPointerUp));
</script>

<template>
  <div class="cut-pane">
    <header class="head">
      <div class="head-text">
        <h2>{{ i18n.t("cutReview.title") }}</h2>
        <p class="hint">{{ i18n.t("cutReview.hint") }}</p>
      </div>
    </header>

    <div class="stats">
      <span>
        {{
          i18n.t("cutReview.emptyCount", {
            count: cut.cuts.length,
            seconds: seconds(cut.removedSeconds),
          })
        }}
      </span>
      <button v-if="cut.cuts.length > 0" class="text-btn" @click="restoreAll">
        {{ i18n.t("cutReview.removedAll") }}
      </button>
    </div>

    <div v-if="cut.running" class="progress">
      <div class="progress-fill" :style="{ width: `${cut.progressPct}%` }" />
    </div>

    <div v-if="!cut.timed && cut.words.length > 0" class="warn">
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
      <p v-if="!modelReady" class="empty-note">{{ i18n.t("cutReview.noModel") }}</p>
    </div>

    <div
      v-else
      ref="scroller"
      class="transcript"
      tabindex="0"
      @pointermove="onPointerMove"
      @pointercancel="onPointerUp"
      @keydown="onKeydown"
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

          <input
            v-if="editing === entry.index"
            v-model="editText"
            class="word-input"
            @keydown.enter.prevent="commitEdit"
            @keydown.esc.prevent="editing = null"
            @blur="commitEdit"
            @click.stop
          />
          <span
            v-else
            class="word"
            :data-index="entry.index"
            :class="{
              cut: cutOfWord(entry.word),
              selected: range && entry.index >= range.from && entry.index <= range.to,
            }"
            :title="
              cutOfWord(entry.word)
                ? i18n.t('cutReview.restoreOne')
                : entry.word.start.toFixed(2) + 's'
            "
            @pointerdown="onPointerDown($event, entry.index)"
            @dblclick="beginEdit($event, entry.index)"
          >{{ entry.word.text }}</span>
        </template>
      </p>
    </div>

    <div v-if="range && !dragging" class="action-bar">
      <span class="selection">
        {{
          i18n.t("cutReview.selectionHint", {
            count: selectedWords.length,
            value: seconds(selectedSeconds),
          })
        }}
      </span>
      <button class="run-btn small" @click="cutSelection">
        {{ i18n.t("cutReview.cutSelection", { value: seconds(selectedSeconds) }) }}
      </button>
      <button class="text-btn" @click="startDrag">{{ i18n.t("common.cancel") }}</button>
    </div>

    <footer v-if="cut.words.length > 0" class="foot">
      <button class="run-btn small" :disabled="cut.running" @click="run">
        {{
          cut.running
            ? i18n.t("cutReview.running")
            : modelReady
              ? i18n.t("cutReview.rerun")
              : i18n.t("audio.downloadModel", { size: humanSize(modelMissing) })
        }}
      </button>
      <span class="foot-hint">{{ i18n.t("cutReview.selectHint") }}</span>
    </footer>
  </div>
</template>

<style scoped>
.cut-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: rgb(var(--md-surface-container-low));
  color: rgb(var(--md-on-surface));
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 14px 6px;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.hint {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}

.stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px 8px;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}

.text-btn {
  border: none;
  background: transparent;
  padding: 0;
  color: rgb(var(--md-primary));
  font-size: 11.5px;
  cursor: pointer;
}

.text-btn:hover {
  text-decoration: underline;
}

.progress {
  height: 3px;
  margin: 0 14px 8px;
  border-radius: 2px;
  background: rgb(var(--md-surface-container-high));
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: rgb(var(--md-primary));
  transition: width 0.2s ease;
}

.warn {
  margin: 0 14px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--md-on-tertiary-container));
  background: rgb(var(--md-tertiary-container));
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.empty p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}

.empty-icon {
  width: 26px;
  height: 26px;
  color: rgb(var(--md-on-surface-muted));
}

.empty-note {
  margin: 0;
  max-width: 30em;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
}

.link-btn {
  border: none;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
}

.transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 14px 16px;
  outline: none;
  user-select: none;
  cursor: text;
}

.paragraph {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 2;
  color: rgb(var(--md-on-surface));
}

.word {
  border-radius: 3px;
  padding: 1px 0;
  cursor: pointer;
}

.word:hover {
  background: rgb(var(--md-surface-container-high));
}

.word.selected {
  background: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
}

/* 剪掉的字：划掉 + 退灰，点一下还原。 */
.word.cut {
  color: rgb(var(--md-on-surface-muted));
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: rgb(var(--md-error) / 0.7);
  background: rgb(var(--md-error-container) / 0.45);
}

.word.cut:hover {
  background: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}

.pause-chip {
  margin: 0 3px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
  color: rgb(var(--md-error));
  background: rgb(var(--md-error-container) / 0.45);
  cursor: pointer;
}

.word-input {
  width: 6em;
  max-width: 100%;
  padding: 0 4px;
  border: 1px solid rgb(var(--md-primary));
  border-radius: 4px;
  background: rgb(var(--md-surface));
  color: rgb(var(--md-on-surface));
  font: inherit;
  outline: none;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.6);
  background: rgb(var(--md-surface-container));
}

.selection {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-btn {
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  background: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 12px;
  cursor: pointer;
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.run-btn.small {
  padding: 4px 10px;
  font-size: 11px;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 12px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.6);
}

.foot-hint {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgb(var(--md-on-surface-muted));
}
</style>
