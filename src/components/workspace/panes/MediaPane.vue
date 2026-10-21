<script setup lang="ts">
/** 媒体库面板：真实素材 + 文本预设，原生导入，拖拽到时间线。 */
import { computed, ref } from "vue";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PaintBrushIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import type { AssetKind, Clip, ClipTextStyle, MediaAsset } from "@/types/project";
import { fileUrl, importAssetAt, pickMediaFiles } from "@/core/media";
import { addAsset, addClip, addTrack, removeAsset, setClipTextStyle } from "@/core/ops";
import { createClip } from "@/core/factory";
import { snapToFrame } from "@/core/time";
import { TEXT_PRESET_SECONDS, type TextPreset } from "@/core/textPresets";
import { clearDragPayload, setDragPayload } from "@/core/dragPayload";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useLayoutStore } from "@/stores/layout";
import { useTextPresetsStore } from "@/stores/textPresets";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const playback = usePlaybackStore();
const selection = useSelectionStore();
const layout = useLayoutStore();
const textPresets = useTextPresetsStore();
const i18n = useI18n();

/** 图片 / 文字的默认插入时长（秒）。 */
const DEFAULT_INSERT_SECONDS = 15;

/** 让新片段落在不与已有片段重叠的位置。 */
function placeWithoutOverlap(
  startSec: number,
  duration: number,
  clips: Clip[],
  fps: number,
): number {
  let start = snapToFrame(Math.max(0, startSec), fps);
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    if (start < clip.start + clip.duration && clip.start < start + duration) {
      start = snapToFrame(clip.start + clip.duration, fps);
    }
  }
  return start;
}

/** 双击素材：插入到播放头处，并切到检查器编辑属性。 */
function insertAtPlayhead(
  assetId: string,
  duration: number,
  text?: string,
  textStyle?: ClipTextStyle,
): void {
  const holder: { clip: Clip | null } = { clip: null };
  project.dispatch((doc) => {
    let next = doc;
    let trackId = next.tracks.find((track) => !track.locked)?.id ?? null;
    if (!trackId) {
      next = addTrack(next);
      trackId = next.tracks[next.tracks.length - 1].id;
    }
    const track = next.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return doc;

    const start = placeWithoutOverlap(playback.playhead, duration, track.clips, next.fps);
    const clip = createClip({
      assetId,
      trackId: track.id,
      start,
      duration,
      ...(text !== undefined ? { text } : {}),
      ...(textStyle !== undefined ? { textStyle } : {}),
    });
    holder.clip = clip;
    return addClip(next, track.id, clip);
  });

  if (holder.clip) {
    if (textStyle) textPresets.rememberStyle(textStyle);
    selection.select(holder.clip.id);
    layout.openTab("inspector");
  }
}

function onAssetDoubleClick(asset: MediaAsset): void {
  if (asset.offline) {
    toast(i18n.t("inspector.offline"), "error");
    return;
  }
  const duration = asset.kind === "image" ? DEFAULT_INSERT_SECONDS : asset.duration;
  if (!(duration > 0)) {
    toast(i18n.t("timeline.noDuration", { name: asset.name }), "error");
    return;
  }
  insertAtPlayhead(asset.id, duration);
}

function onTextDoubleClick(preset: TextPreset): void {
  insertAtPlayhead(
    "",
    TEXT_PRESET_SECONDS,
    i18n.t("textPreset.default.text"),
    preset.textStyle,
  );
}

/** 当前选中的文字片段：预设样式只应用到这些片段。 */
const selectedTextClipIds = computed(() => {
  const ids = new Set(selection.selectedClipIds);
  return project.doc.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId === "" && ids.has(clip.id))
    .map((clip) => clip.id);
});

/** 一键把预设样式应用到所有选中的文字片段（不改变文案与时长）。 */
function onApplyPreset(preset: TextPreset): void {
  const ids = selectedTextClipIds.value;
  if (ids.length === 0) {
    toast(i18n.t("media.applyPresetEmpty"), "error");
    return;
  }
  project.dispatch((doc) => {
    let next = doc;
    for (const id of ids) next = setClipTextStyle(next, id, preset.textStyle);
    return next;
  });
  textPresets.rememberStyle(preset.textStyle);
  toast(i18n.t("media.applyPresetDone", { count: ids.length }));
}

type FilterId = "all" | AssetKind | "text";

const filters: { id: FilterId; labelKey: string }[] = [
  { id: "all", labelKey: "media.filter.all" },
  { id: "video", labelKey: "media.filter.video" },
  { id: "audio", labelKey: "media.filter.audio" },
  { id: "image", labelKey: "media.filter.image" },
  { id: "text", labelKey: "media.filter.text" },
];

type LibraryEntry =
  | { key: string; type: "asset"; asset: MediaAsset }
  | { key: string; type: "text"; preset: TextPreset };

const activeFilter = ref<FilterId>("all");
const query = ref("");
const importing = ref(false);

const entries = computed<LibraryEntry[]>(() => {
  const keyword = query.value.trim().toLowerCase();
  const showAssets = activeFilter.value !== "text";
  const showText = activeFilter.value === "all" || activeFilter.value === "text";

  const assetEntries: LibraryEntry[] = showAssets
    ? project.doc.assets
        .filter((asset) => {
          if (activeFilter.value !== "all" && asset.kind !== activeFilter.value) return false;
          if (keyword && !asset.name.toLowerCase().includes(keyword)) return false;
          return true;
        })
        .map((asset) => ({ key: asset.id, type: "asset", asset }))
    : [];

  const textEntries: LibraryEntry[] = showText
    ? textPresets.presets
        .filter((preset) => !keyword || preset.name.toLowerCase().includes(keyword))
        .map((preset) => ({ key: `text-${preset.id}`, type: "text", preset }))
    : [];

  return [...textEntries, ...assetEntries];
});

const kindIcon = { video: FilmIcon, audio: MusicalNoteIcon, image: PhotoIcon };

const textThumb = {
  background: "linear-gradient(140deg, #3a2440 0%, #6750a4 52%, #b69df8 100%)",
};

/** 素材缩略图 / 占位渐变；图片没有缓存缩略图时直接用原图。 */
function thumbStyle(asset: MediaAsset): Record<string, string> {
  if (asset.kind === "image") {
    // 用 cover 填满预览框：比例不一致时裁切边缘，不拉伸也不留黑边。
    return {
      backgroundImage: `url("${fileUrl(asset.thumb ?? asset.src)}")`,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    };
  }
  if (asset.thumb) return { backgroundImage: `url("${fileUrl(asset.thumb)}")` };
  return { background: "linear-gradient(140deg, #2c1f4d 0%, #7c4a76 45%, #e79a76 100%)" };
}

function durationLabel(asset: MediaAsset): string {
  if (asset.kind === "image") return "—";
  const total = Math.round(asset.duration);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function infoLabel(asset: MediaAsset): string {
  if (asset.kind === "audio")
    return asset.hasAudio === false ? i18n.t("media.noAudioStream") : i18n.t("media.kind.audio");
  if (asset.kind === "image")
    return asset.width ? `${asset.width} × ${asset.height}` : i18n.t("media.kind.image");
  const size =
    asset.width && asset.height
      ? `${asset.width} × ${asset.height}`
      : i18n.t("media.kind.video");
  return asset.fps ? `${size} · ${Math.round(asset.fps)}fps` : size;
}

/** 预设不带时长，插入时间线时统一用固定时长。 */
function textDuration(): string {
  const total = Math.round(TEXT_PRESET_SECONDS);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function importMedia(): Promise<void> {
  if (importing.value) return;
  const paths = await pickMediaFiles();
  if (paths.length === 0) return;

  importing.value = true;
  let added = 0;
  for (const path of paths) {
    try {
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      added += 1;
    } catch (error) {
      toast(
        i18n.t("media.importFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }
  importing.value = false;
  if (added > 0) toast(i18n.t("media.imported", { count: added }));
}

function onDragStart(event: DragEvent, asset: MediaAsset): void {
  setDragPayload({ kind: "asset", id: asset.id });
  event.dataTransfer?.setData("application/x-ai-cut-asset", asset.id);
  // Safari 需要至少一种标准类型，首次拖拽才稳定。
  event.dataTransfer?.setData("text/plain", asset.name);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

function onTextDragStart(event: DragEvent, preset: TextPreset): void {
  setDragPayload({ kind: "text", id: preset.id });
  event.dataTransfer?.setData("application/x-ai-cut-text", preset.id);
  event.dataTransfer?.setData("text/plain", preset.name);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

function onDragEnd(): void {
  clearDragPayload();
}

/** 删除素材：连带删除时间线上引用它的片段（先确认）。 */
async function onDeleteAsset(asset: MediaAsset): Promise<void> {
  const count = project.doc.tracks.reduce(
    (sum, track) => sum + track.clips.filter((clip) => clip.assetId === asset.id).length,
    0,
  );
  const ok = await confirm({
    title: i18n.t("media.confirmDelete"),
    message:
      count > 0
        ? i18n.t("media.confirmDeleteMessage", { name: asset.name, count })
        : i18n.t("media.confirmDeleteEmpty", { name: asset.name }),
    confirmText: i18n.t("confirm.delete"),
    cancelText: i18n.t("confirm.cancel"),
    destructive: true,
  });
  if (!ok) return;
  project.dispatch((doc) => removeAsset(doc, asset.id));
  selection.clear();
  toast(i18n.t("media.deleted", { name: asset.name }));
}

/** 删除用户保存的文字预设；内置预设不显示删除按钮。 */
async function onDeletePreset(preset: TextPreset): Promise<void> {
  if (preset.builtin) return;
  const ok = await confirm({
    title: i18n.t("media.confirmDeletePreset"),
    message: i18n.t("media.confirmDeletePresetMessage", { name: preset.name }),
    confirmText: i18n.t("confirm.delete"),
    cancelText: i18n.t("confirm.cancel"),
    destructive: true,
  });
  if (!ok) return;
  textPresets.removePreset(preset.id);
  toast(i18n.t("media.presetDeleted", { name: preset.name }));
}
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">{{ i18n.t("media.title") }}</h2>
        <p class="pane-sub">
          {{
            i18n.t("media.sub", {
              assets: project.doc.assets.length,
              texts: textPresets.presets.length,
            })
          }}
        </p>
      </div>
      <button
        class="import-pill"
        :disabled="importing"
        :aria-label="i18n.t('media.import')"
        @click="importMedia"
      >
        <PlusIcon class="w-[15px] h-[15px]" />
        <span>{{ importing ? i18n.t("media.importing") : i18n.t("media.import") }}</span>
      </button>
    </header>

    <div class="search-row">
      <div class="search">
        <MagnifyingGlassIcon class="search-icon" />
        <input v-model="query" class="md3-field search-field" :placeholder="i18n.t('media.search')" />
      </div>
    </div>

    <div class="chips" role="group" :aria-label="i18n.t('media.filterGroup')">
      <button
        v-for="f in filters"
        :key="f.id"
        class="chip"
        :class="{ on: activeFilter === f.id }"
        :aria-pressed="activeFilter === f.id"
        @click="activeFilter = f.id"
      >
        {{ i18n.t(f.labelKey) }}
      </button>
    </div>

    <div class="pane-scroll">
      <p v-if="entries.length === 0" class="empty-hint">
        {{
          activeFilter === "all" && project.doc.assets.length === 0
            ? i18n.t("media.empty")
            : i18n.t("media.noMatch")
        }}
      </p>

      <div class="grid">
        <template v-for="entry in entries" :key="entry.key">
          <article
            v-if="entry.type === 'asset'"
            class="asset"
            :class="{ offline: entry.asset.offline }"
            draggable="true"
            @dragstart="onDragStart($event, entry.asset)"
            @dragend="onDragEnd"
            @dblclick="onAssetDoubleClick(entry.asset)"
          >
            <div class="thumb" :style="thumbStyle(entry.asset)">
              <component :is="kindIcon[entry.asset.kind]" class="thumb-icon" />
              <span class="duration tabular">{{ durationLabel(entry.asset) }}</span>
              <span v-if="entry.asset.offline" class="offline-badge">
                <ExclamationTriangleIcon class="w-3 h-3" />
                {{ i18n.t("media.offline") }}
              </span>
              <button
                class="delete-btn"
                type="button"
                draggable="false"
                :aria-label="i18n.t('media.deleteNamed', { name: entry.asset.name })"
                @dragstart.stop.prevent
                @pointerdown.stop
                @click.stop="onDeleteAsset(entry.asset)"
              >
                <TrashIcon class="w-3 h-3" />
              </button>
            </div>
            <div class="asset-text">
              <span class="asset-name">{{ entry.asset.name }}</span>
              <span class="asset-info">{{ infoLabel(entry.asset) }}</span>
            </div>
          </article>

          <article
            v-else
            class="asset"
            draggable="true"
            @dragstart="onTextDragStart($event, entry.preset)"
            @dragend="onDragEnd"
            @dblclick="onTextDoubleClick(entry.preset)"
          >
            <div class="thumb text-thumb" :style="textThumb">
              <DocumentTextIcon class="thumb-icon" />
              <span class="text-preview">{{ entry.preset.name }}</span>
              <span class="duration tabular">{{ textDuration() }}</span>
              <button
                class="apply-btn"
                type="button"
                draggable="false"
                :aria-label="i18n.t('media.applyPresetNamed', { name: entry.preset.name })"
                :title="
                  i18n.t('media.applyPresetHint', { count: selectedTextClipIds.length })
                "
                @dragstart.stop.prevent
                @pointerdown.stop
                @click.stop="onApplyPreset(entry.preset)"
              >
                <PaintBrushIcon class="w-3 h-3" />
              </button>
              <button
                v-if="!entry.preset.builtin"
                class="delete-btn"
                type="button"
                draggable="false"
                :aria-label="i18n.t('media.deleteNamed', { name: entry.preset.name })"
                @dragstart.stop.prevent
                @pointerdown.stop
                @click.stop="onDeletePreset(entry.preset)"
              >
                <TrashIcon class="w-3 h-3" />
              </button>
            </div>
            <div class="asset-text">
              <span class="asset-name">{{ entry.preset.name }}</span>
              <span class="asset-info">
                {{ i18n.t("media.textInfo", { seconds: TEXT_PRESET_SECONDS }) }}
              </span>
            </div>
          </article>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-row {
  padding: 0 16px 10px;
}
.search {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 11px;
  width: 15px;
  height: 15px;
  color: rgb(var(--md-on-surface-muted));
  pointer-events: none;
}
.search-field {
  width: 100%;
  padding-left: 33px;
}
.chips {
  display: flex;
  gap: 6px;
  padding: 0 16px 12px;
  flex-wrap: wrap;
}
.chip {
  height: 26px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.chip.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}

.empty-hint {
  margin: 4px 0 14px;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-muted));
}
.grid {
  display: grid;
  /* 自适应列数 + 最小列宽：窄栏保持 2 列，宽栏（竖屏）自动变成多列，素材不会变得过大。 */
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 10px;
  align-content: start;
}
.asset {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.asset:hover {
  background-color: rgb(var(--md-on-surface) / 0.05);
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
}
.thumb::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.35), transparent 55%);
}
.thumb-icon {
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.82);
}
.text-thumb {
  flex-direction: column;
  gap: 4px;
}
.text-preview {
  position: relative;
  z-index: 1;
  max-width: 86%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
}
.duration {
  position: absolute;
  right: 5px;
  top: 5px;
  z-index: 1;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.delete-btn {
  position: absolute;
  right: 5px;
  bottom: 5px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0.72;
  transition: opacity 0.14s ease, background-color 0.14s ease, transform 0.14s ease;
}
.asset:hover .delete-btn,
.delete-btn:focus-visible {
  opacity: 1;
  background: rgb(var(--md-error) / 0.9);
}
.delete-btn:active {
  transform: scale(0.9);
}
.delete-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.apply-btn {
  position: absolute;
  left: 5px;
  bottom: 5px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0.72;
  transition: opacity 0.14s ease, background-color 0.14s ease, transform 0.14s ease;
}
.asset:hover .apply-btn,
.apply-btn:focus-visible {
  opacity: 1;
  background: rgb(var(--md-primary) / 0.9);
}
.apply-btn:active {
  transform: scale(0.9);
}
.apply-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.asset.offline .thumb {
  filter: grayscale(1) brightness(0.7);
}
.offline-badge {
  position: absolute;
  left: 5px;
  bottom: 5px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgb(var(--md-error) / 0.85);
  color: rgb(var(--md-on-error));
  font-size: 9.5px;
  font-weight: 600;
}
.asset-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 0 2px;
}
.asset-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-info {
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 媒体库右上角的导入按钮：MD3 tonal 药丸，替代原来的裸 + 图标。 */
.import-pill {
  flex: 0 0 auto;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px 0 10px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, filter 0.15s ease, transform 0.15s ease;
}
.import-pill:hover:not(:disabled) {
  filter: brightness(1.06);
}
.import-pill:active:not(:disabled) {
  transform: scale(0.97);
}
.import-pill:disabled {
  opacity: 0.55;
  cursor: default;
}
.import-pill:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
</style>
