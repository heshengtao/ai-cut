<script setup lang="ts">
/** 时间线：标尺 + 轨道头 + 片段车道 + 播放头。数据来自 project store。 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  TrashIcon,
  DocumentTextIcon,
  FolderOpenIcon,
} from "@heroicons/vue/24/outline";
import TimelineRuler from "./TimelineRuler.vue";
import TrackHeader from "./TrackHeader.vue";
import TimelineClip from "./TimelineClip.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import CutIcon from "@/components/common/CutIcon.vue";
import { useProjectStore } from "@/stores/project";
import { MAX_ZOOM, MIN_ZOOM, usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useLayoutStore } from "@/stores/layout";
import { projectDuration } from "@/core/playback/activeClips";
import { formatTimecode, snapToFrame } from "@/core/time";
import {
  addClip,
  addTrack,
  addTrackAt,
  moveClips,
  moveTrack,
  removeClips,
  removeTrack,
  setTrackFlag,
  trimClip,
} from "@/core/ops";
import { createClip } from "@/core/factory";
import { snapEdge, snapMove } from "@/core/snapping";
import { resolveTextStyle } from "@/core/clipStyle";
import { useTimelineActions } from "@/composables/useTimelineActions";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { baseName } from "@/core/media";
import { clearDragPayload, getDragPayload } from "@/core/dragPayload";
import { useTextPresetsStore } from "@/stores/textPresets";
import { TEXT_PRESET_SECONDS } from "@/core/textPresets";
import type { Clip, ClipTextStyle, MediaAsset, Project } from "@/types/project";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const playback = usePlaybackStore();
const selection = useSelectionStore();
const layout = useLayoutStore();
const actions = useTimelineActions();
const textPresets = useTextPresetsStore();
const i18n = useI18n();

/** 横向滚动容器：缩放锚点与滚动位置都以它为准。 */
const scrollEl = ref<HTMLElement | null>(null);
/** 可视区宽度：保证时间线内容至少铺满视口，缩放后不会出现没有刻度的空白。 */
const viewportWidth = ref(0);
/** 纵向滚动量：轨道头没有自己的滚动条，靠它跟随右侧轨道一起上下移动。 */
const scrollTop = ref(0);

function onScroll(): void {
  scrollTop.value = scrollEl.value?.scrollTop ?? 0;
}
let resizeObserver: ResizeObserver | null = null;

/**
 * 拖拽期间的临时文档。非空时时间线渲染它而非真实文档——
 * 这样预览用的是与提交完全相同的 ops，所见即所得。
 */
const draft = ref<Project | null>(null);
/** 渲染用文档。 */
const shownDoc = computed(() => draft.value ?? project.doc);

/** 时间线可视总时长：至少留 30 秒空白，并保证播放头可见。 */
const duration = computed(() =>
  Math.max(30, projectDuration(shownDoc.value) + 10, playback.playhead + 5),
);
/** 内容宽度至少铺满视口；标尺始终覆盖整个可视宽度。 */
const contentWidth = computed(() => Math.max(viewportWidth.value, duration.value * playback.zoom));
/** 标尺需要覆盖的时间范围（按当前缩放换算）。 */
const rulerDuration = computed(() => contentWidth.value / playback.zoom);

/** 没有任何轨道时显示拖拽占位。 */
const hasNoTracks = computed(() => shownDoc.value.tracks.length === 0);

const playheadX = computed(() => playback.playhead * playback.zoom);

function assetOf(assetId: string): MediaAsset | undefined {
  return shownDoc.value.assets.find((a) => a.id === assetId);
}

/** 播放头位置的时间码。 */
const playheadLabel = computed(() => formatTimecode(playback.playhead, project.doc.fps));

/** 缩放滑杆值：把对数刻度映射回 0..100。 */
const zoomSlider = computed(
  () => (Math.log(playback.zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 100,
);

function zoomBy(factor: number): void {
  playback.setZoom(playback.zoom * factor);
}

function onZoomInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  // 滑杆 0..100 映射到对数刻度，低倍率也有足够行程。
  playback.setZoom(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** (value / 100));
}

/** ⌘/Ctrl + 滚轮：以光标处为锚点缩放，光标下的时间保持不动。 */
function onWheelZoom(event: WheelEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  const host = scrollEl.value;
  if (!host) return;

  const rect = host.getBoundingClientRect();
  const x = event.clientX - rect.left + host.scrollLeft;
  const anchorSeconds = x / playback.zoom;

  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  playback.setZoom(playback.zoom * factor);

  // 缩放后把同一时间点挪回光标下
  const after = host.getBoundingClientRect();
  const cursorX = event.clientX - after.left;
  host.scrollLeft = anchorSeconds * playback.zoom - cursorX;
}

/** 吸附阈值（屏幕像素）。 */
const SNAP_THRESHOLD_PX = 6;
/** 轨道行高，需与 CSS 的 .lane 高度一致。 */
const LANE_HEIGHT = 54;
/** 标尺高度，框选矩形需要从轨道区域下方开始。 */
const RULER_HEIGHT = 28;

interface DragState {
  mode: "move" | "trim-start" | "trim-end";
  clipId: string;
  movingIds: string[];
  clientX0: number;
  originDoc: Project;
  targetTrackId: string | null;
  delta: number;
  edgeTime: number;
  guide: number | null;
}

const drag = ref<DragState | null>(null);

/** 指针 X → 时间线时间（秒）。 */
function timeFromClientX(clientX: number): number {
  const host = scrollEl.value;
  if (!host) return 0;
  const rect = host.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left + host.scrollLeft) / playback.zoom);
}

/** 指针 Y → 命中的轨道 id。 */
function trackIdFromClientY(clientY: number): string | null {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  if (!lanes) return null;
  const rect = lanes.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / LANE_HEIGHT);
  return shownDoc.value.tracks[index]?.id ?? null;
}

/** 指针 Y → 夹紧到有效范围的轨道序号（框选用）。 */
function laneIndexFromClientY(clientY: number): number {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  if (!lanes) return 0;
  const rect = lanes.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / LANE_HEIGHT);
  return Math.min(Math.max(index, 0), Math.max(0, shownDoc.value.tracks.length - 1));
}

interface MarqueeState {
  startClientX: number;
  startClientY: number;
  startTime: number;
  startLane: number;
  currentTime: number;
  currentLane: number;
  moved: boolean;
}

const marquee = ref<MarqueeState | null>(null);

/** 框选矩形覆盖到的片段 id。 */
function clipsInMarquee(state: MarqueeState): string[] {
  const minTime = Math.min(state.startTime, state.currentTime);
  const maxTime = Math.max(state.startTime, state.currentTime);
  const minLane = Math.min(state.startLane, state.currentLane);
  const maxLane = Math.max(state.startLane, state.currentLane);
  const ids: string[] = [];
  shownDoc.value.tracks.forEach((track, index) => {
    if (index < minLane || index > maxLane) return;
    for (const clip of track.clips) {
      if (clip.start < maxTime && clip.start + clip.duration > minTime) ids.push(clip.id);
    }
  });
  return ids;
}

function onMarqueeMove(event: PointerEvent): void {
  const state = marquee.value;
  if (!state) return;
  if (
    Math.abs(event.clientX - state.startClientX) +
      Math.abs(event.clientY - state.startClientY) >
    3
  ) {
    state.moved = true;
  }
  state.currentTime = timeFromClientX(event.clientX);
  state.currentLane = laneIndexFromClientY(event.clientY);
  if (state.moved) selection.selectMany(clipsInMarquee(state));
}

function onMarqueeEnd(): void {
  marquee.value = null;
  window.removeEventListener("pointermove", onMarqueeMove);
}

/** 在空白轨道区域按下左键开始框选。 */
function onMarqueeStart(event: PointerEvent): void {
  if (event.button !== 0) return;
  const startTime = timeFromClientX(event.clientX);
  const startLane = laneIndexFromClientY(event.clientY);
  selection.clear();
  marquee.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startTime,
    startLane,
    currentTime: startTime,
    currentLane: startLane,
    moved: false,
  };
  window.addEventListener("pointermove", onMarqueeMove);
  window.addEventListener("pointerup", onMarqueeEnd, { once: true });
  event.preventDefault();
}

const marqueeStyle = computed(() => {
  const state = marquee.value;
  if (!state) return null;
  const minTime = Math.min(state.startTime, state.currentTime);
  const maxTime = Math.max(state.startTime, state.currentTime);
  const minLane = Math.min(state.startLane, state.currentLane);
  const maxLane = Math.max(state.startLane, state.currentLane);
  return {
    left: `${minTime * playback.zoom}px`,
    width: `${Math.max(1, (maxTime - minTime) * playback.zoom)}px`,
    top: `${RULER_HEIGHT + minLane * LANE_HEIGHT}px`,
    height: `${(maxLane - minLane + 1) * LANE_HEIGHT}px`,
  };
});

/** 双击片段：选中并切到检查器。 */
function onClipDoubleClick(clipId: string): void {
  selection.select(clipId);
  layout.openTab("inspector");
}

function onClipGrab(payload: {
  clipId: string;
  event: PointerEvent;
  mode: "move" | "trim-start" | "trim-end";
}): void {
  const { clipId, event, mode } = payload;
  if (event.button !== 0) return;

  const track = shownDoc.value.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track || track.locked) return;

  // 未选中 → 单击选中；已选中且按 ⇧ → 切换；否则保持现有多选（便于整体拖动）
  if (!selection.isSelected(clipId)) selection.select(clipId, event.shiftKey);
  else if (event.shiftKey) selection.toggle(clipId);

  const movingIds =
    mode === "move" && selection.isSelected(clipId) ? [...selection.selectedClipIds] : [clipId];

  const moving = shownDoc.value.tracks
    .flatMap((t) => t.clips)
    .filter((c) => movingIds.includes(c.id));
  if (moving.length === 0) return;
  const edgeTime = mode === "trim-start" ? moving[0].start : moving[0].start + moving[0].duration;

  drag.value = {
    mode,
    clipId,
    movingIds,
    clientX0: event.clientX,
    originDoc: project.doc,
    targetTrackId: track.id,
    delta: 0,
    edgeTime,
    guide: null,
  };
  draft.value = project.doc;

  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd, { once: true });
  event.preventDefault();
}

function onDragMove(event: PointerEvent): void {
  const state = drag.value;
  if (!state) return;
  const thresholdSec = SNAP_THRESHOLD_PX / playback.zoom;
  const fps = state.originDoc.fps;

  if (state.mode === "move") {
    const rawDelta = (event.clientX - state.clientX0) / playback.zoom;
    const snapped = snapMove(state.originDoc, new Set(state.movingIds), rawDelta, thresholdSec, playback.playhead);
    // 落点统一吸附到帧网格
    state.delta = snapToFrame(snapped.delta, fps);
    state.guide = snapped.guide;
    const candidateTrackId = trackIdFromClientY(event.clientY);
    if (candidateTrackId) {
      const candidate = state.originDoc.tracks.find((t) => t.id === candidateTrackId);
      if (candidate && !candidate.locked) state.targetTrackId = candidateTrackId;
    }
    draft.value = moveClips(
      state.originDoc,
      state.movingIds,
      state.delta,
      state.targetTrackId ?? undefined,
    );
    return;
  }

  const rawTime = timeFromClientX(event.clientX);
  const snapped = snapEdge(state.originDoc, state.clipId, rawTime, thresholdSec, playback.playhead);
  state.guide = snapped.guide;
  state.edgeTime = snapToFrame(snapped.time, fps);
  draft.value = trimClip(
    state.originDoc,
    state.clipId,
    state.mode === "trim-start" ? "start" : "end",
    state.edgeTime,
  );
}

function onDragEnd(): void {
  const state = drag.value;
  drag.value = null;
  draft.value = null;
  window.removeEventListener("pointermove", onDragMove);
  if (!state) return;

  // 用与预览完全相同的 op 提交一次 → 一步历史
  project.dispatch((doc) =>
    state.mode === "move"
      ? moveClips(doc, state.movingIds, state.delta, state.targetTrackId ?? undefined)
      : trimClip(doc, state.clipId, state.mode === "trim-start" ? "start" : "end", state.edgeTime),
  );
}

onMounted(() => {
  const host = scrollEl.value;
  if (!host) return;
  viewportWidth.value = host.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    viewportWidth.value = host.clientWidth;
  });
  resizeObserver.observe(host);
  window.addEventListener("dragend", clearDropTarget);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointermove", onMarqueeMove);
  window.removeEventListener("pointerup", onMarqueeEnd);
  window.removeEventListener("pointermove", onTrackDragMove);
  window.removeEventListener("pointerup", onTrackDragEnd);
  window.removeEventListener("pointercancel", onTrackDragEnd);
  window.removeEventListener("dragend", clearDropTarget);
  resizeObserver?.disconnect();
});

function onToggleFlag(trackId: string, flag: "muted" | "visible" | "locked"): void {
  const track = project.doc.tracks.find((t) => t.id === trackId);
  if (!track) return;
  project.dispatch((doc) => setTrackFlag(doc, trackId, flag, !track[flag]));
}

/** 点击轨道头：一键选中该轨道上的所有片段。 */
function onSelectTrack(trackId: string): void {
  const track = shownDoc.value.tracks.find((candidate) => candidate.id === trackId);
  selection.setActiveTrack(trackId);
  if (!track || track.clips.length === 0) return;
  selection.selectMany(track.clips.map((clip) => clip.id));
}

async function onRemoveTrack(trackId: string): Promise<void> {
  const track = project.doc.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const count = track.clips.length;
  if (count > 0) {
    const index = project.doc.tracks.findIndex((t) => t.id === trackId);
    const ok = await confirm({
      title: i18n.t("timeline.confirmDeleteTrack"),
      message: i18n.t("timeline.confirmDeleteTrackMessage", { n: index + 1, count }),
      confirmText: i18n.t("confirm.delete"),
      cancelText: i18n.t("confirm.cancel"),
      destructive: true,
    });
    if (!ok) return;
  }
  project.dispatch((doc) => removeTrack(doc, trackId));
  selection.clear();
}

/** 右键删除：若点中的片段在选中集合里，就删除整个选中集合。 */
function onDeleteClip(clipId: string): void {
  const ids = selection.isSelected(clipId) ? [...selection.selectedClipIds] : [clipId];
  project.dispatch((doc) => removeClips(doc, ids));
  selection.clear();
}

/** 拖放位置：落在某条轨道上，或在两条轨道之间插入新轨。 */
type DropPlacement = { kind: "lane"; trackId: string } | { kind: "insert"; index: number };

/** 轨道上下边缘的吸附带宽度（px），落在其中表示「在此插入新轨」。 */
const DROP_EDGE_PX = 14;

const dropTarget = ref<DropPlacement | null>(null);

/** 拖拽取消 / 结束（无论是否落在时间线上）时清除提示。 */
function clearDropTarget(): void {
  dropTarget.value = null;
}

/** 指针 Y → 拖放位置。 */
function dropPlacementFromClientY(clientY: number): DropPlacement {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  const tracks = shownDoc.value.tracks;
  if (!lanes || tracks.length === 0) return { kind: "insert", index: 0 };

  const rect = lanes.getBoundingClientRect();
  const y = clientY - rect.top;
  if (y <= 0) return { kind: "insert", index: 0 };
  if (y >= tracks.length * LANE_HEIGHT) return { kind: "insert", index: tracks.length };

  const index = Math.floor(y / LANE_HEIGHT);
  const offset = y - index * LANE_HEIGHT;
  if (offset < DROP_EDGE_PX) return { kind: "insert", index };
  if (offset > LANE_HEIGHT - DROP_EDGE_PX) return { kind: "insert", index: index + 1 };
  return { kind: "lane", trackId: tracks[index].id };
}

// ---------------------------------------------------------------------------
// 轨道排序：按住轨道头左侧的图标拖动整条轨道
// ---------------------------------------------------------------------------

interface TrackDragState {
  trackId: string;
  /** 插入位置（0..tracks.length，基于拖动前的数组）。 */
  index: number;
  startY: number;
  moved: boolean;
}

const trackDrag = ref<TrackDragState | null>(null);

/** 指针 Y → 轨道插入位置。 */
function trackInsertIndexFromClientY(clientY: number): number {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  const tracks = shownDoc.value.tracks;
  if (!lanes || tracks.length === 0) return 0;
  const rect = lanes.getBoundingClientRect();
  const y = clientY - rect.top;
  return Math.min(tracks.length, Math.max(0, Math.round(y / LANE_HEIGHT)));
}

function onTrackReorderStart(trackId: string, event: PointerEvent): void {
  if (event.button !== 0) return;
  const index = shownDoc.value.tracks.findIndex((t) => t.id === trackId);
  if (index < 0) return;
  trackDrag.value = { trackId, index, startY: event.clientY, moved: false };
  window.addEventListener("pointermove", onTrackDragMove);
  window.addEventListener("pointerup", onTrackDragEnd);
  window.addEventListener("pointercancel", onTrackDragEnd);
}

function onTrackDragMove(event: PointerEvent): void {
  const state = trackDrag.value;
  if (!state) return;
  if (!state.moved && Math.abs(event.clientY - state.startY) < 4) return;
  state.moved = true;
  state.index = trackInsertIndexFromClientY(event.clientY);
}

function onTrackDragEnd(): void {
  const state = trackDrag.value;
  trackDrag.value = null;
  window.removeEventListener("pointermove", onTrackDragMove);
  window.removeEventListener("pointerup", onTrackDragEnd);
  window.removeEventListener("pointercancel", onTrackDragEnd);
  if (!state) return;

  const tracks = project.doc.tracks;
  const from = tracks.findIndex((t) => t.id === state.trackId);
  if (from < 0 || !state.moved) return;

  // 插入下标 → 移除后的目标下标
  let to = state.index;
  if (to > from) to -= 1;
  to = Math.min(Math.max(0, to), tracks.length - 1);
  if (to === from) return;
  project.dispatch((doc) => moveTrack(doc, state.trackId, to));
}

// ---------------------------------------------------------------------------
// 拖放素材：落到轨道上 / 在轨道之间插入新轨
// ---------------------------------------------------------------------------

/** 解析拖放目标；需要新轨时在指定位置创建。 */
function resolveDropTrack(
  doc: Project,
  placement: DropPlacement,
): { doc: Project; trackId: string | null } {
  if (placement.kind === "lane") {
    const track = doc.tracks.find((t) => t.id === placement.trackId);
    return { doc, trackId: track && !track.locked ? track.id : null };
  }
  const next = addTrackAt(doc, placement.index);
  return { doc: next, trackId: next.tracks[placement.index].id };
}

/**
 * 让新片段落到不与已有片段重叠的位置：与任何片段相交时顺延到其右缘。
 * 片段按 start 升序，顺延只会让 start 变大，一遍即可。
 */
function placeWithoutOverlap(startSec: number, duration: number, clips: Clip[], fps: number): number {
  let start = snapToFrame(Math.max(0, startSec), fps);
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  for (const clip of sorted) {
    const overlaps = start < clip.start + clip.duration && clip.start < start + duration;
    if (!overlaps) continue;
    start = snapToFrame(clip.start + clip.duration, fps);
  }
  return start;
}

/**
 * 在指定时间插入文字片段，并打开属性面板。
 * 有拖放目标时严格落到目标轨道（越界则新建）；否则用第一条未锁定轨道，必要时新建。
 */
function insertTextClip(
  rawStart: number,
  text: string,
  duration = 15,
  placement?: DropPlacement,
  textStyle?: ClipTextStyle,
): void {
  const holder: { clip: Clip | null } = { clip: null };
  let locked = false;

  project.dispatch((doc) => {
    let next = doc;
    let trackId: string | null = null;

    if (placement) {
      const resolved = resolveDropTrack(next, placement);
      next = resolved.doc;
      trackId = resolved.trackId;
    } else {
      const track = next.tracks.find((t) => !t.locked);
      if (track) {
        trackId = track.id;
      } else {
        next = addTrack(next);
        trackId = next.tracks[next.tracks.length - 1].id;
      }
    }

    if (!trackId) {
      locked = true;
      return doc;
    }

    const track = next.tracks.find((t) => t.id === trackId);
    if (!track) return doc;

    const fps = next.fps;
    const start = placeWithoutOverlap(rawStart, duration, track.clips, fps);

    const clip = createClip({
      assetId: "",
      trackId: track.id,
      start,
      duration,
      text,
      ...(textStyle ? { textStyle } : {}),
    });
    holder.clip = clip;
    return addClip(next, track.id, clip);
  });

  if (locked) {
    toast(i18n.t("timeline.locked"), "error");
    return;
  }
  if (holder.clip) {
    if (textStyle) textPresets.rememberStyle(textStyle);
    selection.select(holder.clip.id);
    layout.openTab("inspector");
  }
}

/** 在播放头处加一个文字片段：优先复用当前选中文字片段的样式，其次上一次操作的样式。 */
function addTextAtPlayhead(): void {
  const selectedText =
    selection.selectedClipIds.length === 1
      ? shownDoc.value.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === selection.selectedClipIds[0] && clip.assetId === "")
      : undefined;
  const style = selectedText ? resolveTextStyle(selectedText) : textPresets.lastStyle;
  insertTextClip(
    playback.playhead,
    i18n.t("textPreset.default.text"),
    TEXT_PRESET_SECONDS,
    undefined,
    style,
  );
}

/** 图片 / 文字拖入的默认时长；音视频按完整源时长插入。 */
const DEFAULT_INSERT_SECONDS = 15;

function onLaneDragOver(event: DragEvent): void {
  const payload = getDragPayload();
  const types = event.dataTransfer?.types;
  const list = types ? Array.from(types) : [];
  // WebKit 的第一次 dragover 可能拿不到 types，因此内存载荷才是主判据。
  if (
    !payload &&
    !list.includes("application/x-ai-cut-asset") &&
    !list.includes("application/x-ai-cut-text")
  ) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dropTarget.value = dropPlacementFromClientY(event.clientY);
}

function onLaneDragLeave(event: DragEvent): void {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  const related = event.relatedTarget as Node | null;
  if (lanes && related && lanes.contains(related)) return;
  dropTarget.value = null;
}

/** 拖入素材或文本预设：落到指定轨道，或在轨道之间插入一条新轨道。 */
function onLaneDrop(event: DragEvent): void {
  const payload = getDragPayload();
  const textPresetId = payload
    ? payload.kind === "text"
      ? payload.id
      : ""
    : event.dataTransfer?.getData("application/x-ai-cut-text");
  if (textPresetId) {
    const preset = textPresets.presets.find((p) => p.id === textPresetId);
    if (!preset) {
      dropTarget.value = null;
      clearDragPayload();
      return;
    }
    event.preventDefault();
    const placement = dropTarget.value ?? dropPlacementFromClientY(event.clientY);
    dropTarget.value = null;
    clearDragPayload();
    insertTextClip(
      timeFromClientX(event.clientX),
      i18n.t("textPreset.default.text"),
      TEXT_PRESET_SECONDS,
      placement,
      preset.textStyle,
    );
    return;
  }

  const assetId = payload
    ? payload.kind === "asset"
      ? payload.id
      : ""
    : event.dataTransfer?.getData("application/x-ai-cut-asset");
  if (!assetId) {
    dropTarget.value = null;
    return;
  }
  event.preventDefault();
  clearDragPayload();

  const placement = dropTarget.value ?? dropPlacementFromClientY(event.clientY);
  dropTarget.value = null;

  const asset = project.doc.assets.find((a) => a.id === assetId);
  if (!asset) return;
  // 音视频按**完整源时长**插入（之前统一截成 5 秒，看起来像是“片段不完整”）。
  const duration = asset.kind === "image" ? DEFAULT_INSERT_SECONDS : asset.duration;
  if (!(duration > 0)) {
    toast(i18n.t("timeline.noDuration", { name: baseName(asset.src) }), "error");
    return;
  }

  const rawStart = timeFromClientX(event.clientX);
  const holder: { clip: Clip | null } = { clip: null };
  let locked = false;

  project.dispatch((doc) => {
    const resolved = resolveDropTrack(doc, placement);
    const next = resolved.doc;
    if (!resolved.trackId) {
      locked = true;
      return doc;
    }
    const track = next.tracks.find((t) => t.id === resolved.trackId);
    if (!track) return doc;

    const fps = next.fps;
    // 完整长度的片段可能与落点之后的片段重叠：顺延到所有冲突片段之后。
    const start = placeWithoutOverlap(rawStart, duration, track.clips, fps);

    const clip = createClip({
      assetId: asset.id,
      trackId: track.id,
      start,
      duration,
    });
    holder.clip = clip;
    return addClip(next, track.id, clip);
  });

  if (locked) {
    toast(i18n.t("timeline.locked"), "error");
    return;
  }
  if (holder.clip) selection.select(holder.clip.id);
}
</script>

<template>
  <section class="timeline">
    <header class="tl-head">
      <span class="tl-title">{{ i18n.t("timeline.title") }}</span>

      <div class="tl-tools">
        <Tooltip :text="i18n.t('timeline.undo')">
          <button
            class="icon-btn"
            :disabled="!project.canUndo"
            :aria-label="i18n.t('timeline.undoLabel')"
            @click="project.undo()"
          >
            <ArrowUturnLeftIcon class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('timeline.redo')">
          <button
            class="icon-btn"
            :disabled="!project.canRedo"
            :aria-label="i18n.t('timeline.redoLabel')"
            @click="project.redo()"
          >
            <ArrowUturnRightIcon class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>

        <span class="tool-sep" />

        <Tooltip :text="i18n.t('timeline.split')">
          <button
            class="icon-btn"
            :disabled="!actions.canSplit"
            :aria-label="i18n.t('timeline.splitLabel')"
            @click="actions.splitAtPlayhead"
          >
            <CutIcon mode="split" class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('timeline.trimLeft')">
          <button
            class="icon-btn"
            :disabled="!actions.canTrim"
            :aria-label="i18n.t('timeline.trimLeftLabel')"
            @click="actions.trimToPlayhead('start')"
          >
            <CutIcon mode="left" class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('timeline.trimRight')">
          <button
            class="icon-btn"
            :disabled="!actions.canTrim"
            :aria-label="i18n.t('timeline.trimRightLabel')"
            @click="actions.trimToPlayhead('end')"
          >
            <CutIcon mode="right" class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('timeline.delete')">
          <button
            class="icon-btn"
            :disabled="!actions.canDelete"
            :aria-label="i18n.t('timeline.deleteLabel')"
            @click="actions.deleteSelected"
          >
            <TrashIcon class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
        <Tooltip :text="i18n.t('timeline.addText')">
          <button class="icon-btn" :aria-label="i18n.t('timeline.addTextLabel')" @click="addTextAtPlayhead">
            <DocumentTextIcon class="w-[16px] h-[16px]" />
          </button>
        </Tooltip>
      </div>

      <div class="tl-spacer" />

      <span class="tl-time tabular">{{ playheadLabel }}</span>

      <div class="zoom">
        <button class="icon-btn" :aria-label="i18n.t('timeline.zoomOut')" @click="zoomBy(1 / 1.4)">
          <MagnifyingGlassMinusIcon class="w-[16px] h-[16px]" />
        </button>
        <input
          class="md3-range zoom-range"
          type="range"
          min="0"
          max="100"
          :value="zoomSlider"
          :aria-label="i18n.t('timeline.zoom')"
          @input="onZoomInput"
        />
        <button class="icon-btn" :aria-label="i18n.t('timeline.zoomIn')" @click="zoomBy(1.4)">
          <MagnifyingGlassPlusIcon class="w-[16px] h-[16px]" />
        </button>
      </div>
    </header>

    <div class="tl-body">
      <div class="headers">
        <div class="corner">
          <span>{{ i18n.t("timeline.tracks") }}</span>
        </div>
        <div class="header-list" :style="{ transform: `translateY(-${scrollTop}px)` }">
          <TrackHeader
            v-for="(track, index) in shownDoc.tracks"
            :key="track.id"
            :track="track"
            :index="index"
            :dragging="trackDrag?.trackId === track.id"
            @toggle-flag="onToggleFlag"
            @select="onSelectTrack"
            @remove="onRemoveTrack"
            @reorder="onTrackReorderStart"
          />
        </div>
        <div
          v-if="trackDrag"
          class="track-insert"
          :style="{ top: `${RULER_HEIGHT + trackDrag.index * LANE_HEIGHT - scrollTop}px` }"
        />
      </div>

      <div ref="scrollEl" class="scroll" @wheel="onWheelZoom" @scroll.passive="onScroll">
        <div class="content" :style="{ width: `${contentWidth}px` }">
          <TimelineRuler
            :duration="rulerDuration"
            :px-per-second="playback.zoom"
            :fps="project.doc.fps"
            :playhead-x="playheadX"
            @seek="playback.setPlayhead"
          />

          <div
            class="lanes"
            @pointerdown.self="onMarqueeStart"
            @contextmenu.prevent
            @dragover="onLaneDragOver"
            @dragleave="onLaneDragLeave"
            @drop="onLaneDrop($event)"
          >
            <div
              v-for="track in shownDoc.tracks"
              :key="track.id"
              class="lane"
              :class="{
                'drop-lane': dropTarget?.kind === 'lane' && dropTarget.trackId === track.id,
              }"
              @pointerdown.self="onMarqueeStart"
            >
              <TimelineClip
                v-for="clip in track.clips"
                :key="clip.id"
                :clip="clip"
                :asset="assetOf(clip.assetId)"
                :selected="selection.isSelected(clip.id)"
                :px-per-second="playback.zoom"
                @grab="onClipGrab"
                @delete="onDeleteClip"
                @dblclick="onClipDoubleClick(clip.id)"
              />
            </div>

            <div
              v-if="dropTarget?.kind === 'insert'"
              class="insert-line"
              :style="{ top: `${dropTarget.index * LANE_HEIGHT}px` }"
            >
              <span class="insert-dot" />
            </div>

            <div
              v-if="trackDrag"
              class="insert-line track-insert-line"
              :style="{ top: `${trackDrag.index * LANE_HEIGHT}px` }"
            >
              <span class="insert-dot" />
            </div>

            <div v-if="hasNoTracks" class="empty-lanes">
              <FolderOpenIcon class="w-[18px] h-[18px]" />
              <span>{{ i18n.t("timeline.dropHint") }}</span>
            </div>
          </div>

          <div class="playhead" :style="{ left: `${playheadX}px` }">
            <span class="ph-line" />
          </div>

          <div
            v-if="drag?.guide !== null && drag?.guide !== undefined"
            class="snap-guide"
            :style="{ left: `${drag.guide * playback.zoom}px` }"
          />

          <div v-if="marqueeStyle" class="marquee" :style="marqueeStyle" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline {
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--app-card);
  overflow: hidden;
}

/* ---- 顶部工具条 ---- */
.tl-head {
  flex: 0 0 auto;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
}
.tl-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-variant));
  flex: 0 0 auto;
}
.tl-tools {
  display: flex;
  align-items: center;
  gap: 1px;
  padding-left: 4px;
}
.tl-tools .icon-btn:disabled {
  opacity: 0.35;
  pointer-events: none;
}
.tool-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background-color: rgb(var(--md-outline-variant) / 0.55);
  flex: 0 0 auto;
}
.tl-spacer {
  flex: 1;
}
.tl-time {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
  padding: 3px 9px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high));
  flex: 0 0 auto;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.zoom-range {
  width: 76px;
}

/* ---- 主体 ---- */
.tl-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 轨道头 */
.headers {
  position: relative;
  width: 188px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgb(var(--md-outline-variant) / 0.4);
  background-color: var(--app-card);
  overflow: hidden;
}
/* 跟随 .scroll 的 scrollTop 平移，保持左右轨道一一对齐。 */
.header-list {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  will-change: transform;
}
.track-insert {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 12;
  background-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-primary) / 0.25);
  pointer-events: none;
}
.corner {
  height: 28px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: rgb(var(--md-on-surface-muted));
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
}

/* 标尺 + 车道 */
.scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background-color: var(--app-card);
}
.content {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.lanes {
  position: relative;
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  user-select: none;
}
.lane {
  position: relative;
  height: 54px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.lane:nth-child(odd) {
  background-color: rgb(var(--md-surface-container-low) / 0.35);
}
.lane.drop-lane {
  background-color: rgb(var(--md-primary) / 0.12);
  box-shadow: inset 0 0 0 1.5px rgb(var(--md-primary) / 0.55);
}
.insert-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 8;
  background-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 1px rgb(var(--md-primary) / 0.25);
  pointer-events: none;
}
.insert-dot {
  position: absolute;
  left: 4px;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  transform: translateY(-50%);
  background-color: rgb(var(--md-primary));
}
.empty-lanes {
  position: absolute;
  inset: 8px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed rgb(var(--md-outline) / 0.45);
  border-radius: 12px;
  color: rgb(var(--md-on-surface-muted));
  font-size: 12px;
  pointer-events: none;
}
.marquee {
  position: absolute;
  z-index: 7;
  border: 1px solid rgb(var(--md-primary) / 0.8);
  border-radius: 4px;
  background-color: rgb(var(--md-primary) / 0.12);
  pointer-events: none;
}

/* 播放头 */
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  z-index: 5;
  pointer-events: none;
}
.ph-line {
  position: absolute;
  top: 10px;
  bottom: 0;
  left: 50%;
  width: 1.5px;
  transform: translateX(-50%);
  background-color: rgb(var(--md-primary));
  box-shadow: 0 0 6px rgb(var(--md-primary) / 0.45);
}

.snap-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgb(var(--md-tertiary));
  z-index: 6;
  pointer-events: none;
}
</style>
