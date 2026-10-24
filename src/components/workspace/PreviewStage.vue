<script setup lang="ts">
/**
 * 视频预览：
 * - 时间线画面合成（视频 / 图片 / 文字按轨道层级叠加）
 * - 点击画面元素获得焦点，显示可拖拽的包围盒与缩放 / 旋转控制点
 * - 画布缩放（滚轮 / 触控板）、平移、比例、画质与全屏
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
} from "vue";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  CameraIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/vue/24/outline";
import type { Clip, ClipTransform, MediaAsset, Project } from "@/types/project";
import { activeClipsAt, isVisible, projectDuration } from "@/core/playback/activeClips";
import { PlaybackEngine } from "@/core/playback/engine";
import { fileUrl, pickExportPath } from "@/core/media";
import { renderFrame } from "@/core/export/frame";
import { safeFileName } from "@/core/export/escape";
import { toast } from "@/composables/useToast";
import { formatTimecode } from "@/core/time";
import { containSize } from "@/core/transform";
import { clipColorCss } from "@/core/clipColor";
import { transitionState } from "@/core/clipTransition";
import {
  opacityAt,
  resolveTransformAt,
  upsertKeyframe,
} from "@/core/keyframes";
import {
  fontStackOf,
  hexToRgba,
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
  TEXT_BACKGROUND_PADDING_X,
  TEXT_BACKGROUND_PADDING_Y,
  TEXT_BACKGROUND_RADIUS,
} from "@/core/clipStyle";
import { setClipKeyframes, setClipTransform } from "@/core/ops";
import { clipEffectSpecs, clipHasEffects } from "@/core/effects";
import { ofxRenderPreview } from "@/core/ofxApi";
import { isTauri } from "@/utils/platform";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useEffectRenderStore } from "@/stores/effectRender";
import {
  useLayoutStore,
  type PreviewAspect,
  type PreviewQuality,
} from "@/stores/layout";
import { useSelectionStore } from "@/stores/selection";
import PanelIcon from "@/components/common/PanelIcon.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const playback = usePlaybackStore();
const effectRender = useEffectRenderStore();
const selection = useSelectionStore();
const layout = useLayoutStore();
const i18n = useI18n();
const frameBusy = ref(false);

async function exportFrame(): Promise<void> {
  if (frameBusy.value) return;
  const stamp = formatTimecode(playback.playhead, project.doc.fps).replace(/[^0-9]/g, "-");
  const path = await pickExportPath(
    `${safeFileName(project.doc.name)}-${stamp}`,
    "png",
    i18n.t("preview.frameFilter"),
  );
  if (!path) return;

  frameBusy.value = true;
  try {
    const result = await renderFrame(project.doc, {
      time: playback.playhead,
      outputPath: path,
    });
    toast(i18n.t("preview.frameExported", { path: result.path }));
  } catch (error) {
    toast(
      i18n.t("preview.frameFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    frameBusy.value = false;
  }
}

const previewEl = ref<HTMLElement | null>(null);
const viewportEl = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const mediaLayer = ref<HTMLElement | null>(null);

const ASPECTS = computed<SelectOption[]>(() => [
  {
    id: "project",
    label: i18n.t("preview.aspect.project"),
    group: i18n.t("preview.aspect.group.auto"),
  },
  {
    id: "16:9",
    label: "16:9",
    ratio: 16 / 9,
    group: i18n.t("preview.aspect.group.landscape"),
  },
  {
    id: "1.85:1",
    label: "1.85:1",
    ratio: 1.85,
    group: i18n.t("preview.aspect.group.landscape"),
  },
  {
    id: "2:1",
    label: "2:1",
    ratio: 2,
    group: i18n.t("preview.aspect.group.landscape"),
  },
  {
    id: "2.35:1",
    label: "2.35:1",
    ratio: 2.35,
    group: i18n.t("preview.aspect.group.landscape"),
  },
  {
    id: "4:3",
    label: "4:3",
    ratio: 4 / 3,
    group: i18n.t("preview.aspect.group.landscape"),
  },
  {
    id: "1:1",
    label: "1:1",
    ratio: 1,
    group: i18n.t("preview.aspect.group.square"),
  },
  {
    id: "3:4",
    label: "3:4",
    ratio: 3 / 4,
    group: i18n.t("preview.aspect.group.portrait"),
  },
  {
    id: "9:16",
    label: "9:16",
    ratio: 9 / 16,
    group: i18n.t("preview.aspect.group.portrait"),
  },
  {
    id: "1:2",
    label: "1:2",
    ratio: 1 / 2,
    group: i18n.t("preview.aspect.group.portrait"),
  },
]);

const QUALITIES = computed<SelectOption[]>(() => [
  {
    id: "auto",
    label: i18n.t("preview.quality.auto"),
    hint: i18n.t("preview.quality.autoHint"),
  },
  {
    id: "high",
    label: i18n.t("preview.quality.high"),
    hint: i18n.t("preview.quality.highHint"),
  },
  {
    id: "medium",
    label: i18n.t("preview.quality.medium"),
    hint: i18n.t("preview.quality.mediumHint"),
  },
  {
    id: "low",
    label: i18n.t("preview.quality.low"),
    hint: i18n.t("preview.quality.lowHint"),
  },
]);

function setAspect(value: string): void {
  layout.previewAspect = value as PreviewAspect;
}

function setQuality(value: string): void {
  layout.previewQuality = value as PreviewQuality;
}

// ---------------------------------------------------------------------------
// 播放引擎
// ---------------------------------------------------------------------------

let engine: PlaybackEngine | null = null;
/** 引擎最近一次主动上报的时间：用来区分「引擎推进」与「用户拖动」。 */
let engineDrivenTime = -1;

/** 用户手势里重试播放，避免被浏览器的自动播放策略挂起。 */
function onUserGesture(): void {
  engine?.retryVideo();
  engine?.retryAudio();
}

function onGlobalPointerDown(): void {
  onUserGesture();
}

function onGlobalKeyDown(): void {
  onUserGesture();
}

onMounted(() => {
  if (mediaLayer.value) {
    engine = new PlaybackEngine({
      container: mediaLayer.value,
      getDoc: () => project.doc,
      getEffectSource: (clipId) => effectRender.sourceFor(clipId),
      onTime: (seconds) => {
        engineDrivenTime = seconds;
        playback.setPlayhead(seconds);
      },
      onEnded: () => {
        playback.playing = false;
      },
    });
    engine.sync();
  }

  window.addEventListener("pointerdown", onGlobalPointerDown, true);
  window.addEventListener("keydown", onGlobalKeyDown, true);
  document.addEventListener("fullscreenchange", onFullscreenChange);

  const el = viewportEl.value;
  if (el) {
    resizeObserver = new ResizeObserver(measureViewport);
    resizeObserver.observe(el);
  }
  measureViewport();
  requestAnimationFrame(measureViewport);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onGlobalPointerDown, true);
  window.removeEventListener("keydown", onGlobalKeyDown, true);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  window.removeEventListener("pointermove", onInteractionMove);
  window.removeEventListener("pointerup", onInteractionEnd);
  window.removeEventListener("pointercancel", onInteractionEnd);
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", onPanEnd);
  resizeObserver?.disconnect();
  resizeObserver = null;
  engine?.dispose();
  engine = null;
  if (effectTimer !== null) {
    window.clearTimeout(effectTimer);
    effectTimer = null;
  }
  effectPreview.value = {};
});

watch(
  () => effectRender.revision,
  () => {
    // 预渲染完成：让引擎重新比较画面签名并换成烘焙文件。
    engine?.sync();
  },
);

watch(
  () => playback.playing,
  (playing) => {
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  },
);

watch(
  () => playback.playhead,
  (seconds) => {
    if (!engine) return;
    if (Math.abs(seconds - engineDrivenTime) < 1e-4) return;
    engine.seek(seconds);
  },
);

watch(
  () => project.doc,
  () => engine?.sync(),
);

// ---------------------------------------------------------------------------
// 画布尺寸 / 缩放 / 平移
// ---------------------------------------------------------------------------

const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 4;

const viewportSize = ref({ width: 0, height: 0 });
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const isFullscreen = ref(false);

let resizeObserver: ResizeObserver | null = null;

const aspectRatio = computed(() => {
  switch (layout.previewAspect) {
    case "16:9":
      return 16 / 9;
    case "1.85:1":
      return 1.85;
    case "2:1":
      return 2;
    case "2.35:1":
      return 2.35;
    case "9:16":
      return 9 / 16;
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "3:4":
      return 3 / 4;
    case "1:2":
      return 1 / 2;
    default:
      return project.doc.width / project.doc.height || 16 / 9;
  }
});

const stageSize = computed(() => {
  const { width: availableW, height: availableH } = viewportSize.value;
  if (!(availableW > 0 && availableH > 0)) return { width: 0, height: 0 };
  const ratio = aspectRatio.value;
  let width = availableW;
  let height = width / ratio;
  if (height > availableH) {
    height = availableH;
    width = height * ratio;
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
});

const zoomPercent = computed(() => Math.round(zoom.value * 100));

const stageStyle = computed(() => ({
  width: `${stageSize.value.width}px`,
  height: `${stageSize.value.height}px`,
  transform: `translate(-50%, -50%) translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));

function measureViewport(): void {
  const el = viewportEl.value;
  if (!el) return;
  viewportSize.value = { width: el.clientWidth, height: el.clientHeight };
  clampPan();
}

function clampZoom(value: number): number {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value));
}

function clampPan(): void {
  const viewportW = viewportSize.value.width;
  const viewportH = viewportSize.value.height;
  const scaledW = stageSize.value.width * zoom.value;
  const scaledH = stageSize.value.height * zoom.value;
  const maxX = Math.max(0, (scaledW - viewportW) / 2);
  const maxY = Math.max(0, (scaledH - viewportH) / 2);
  const x = Math.min(maxX, Math.max(-maxX, pan.value.x));
  const y = Math.min(maxY, Math.max(-maxY, pan.value.y));
  if (x !== pan.value.x || y !== pan.value.y) pan.value = { x, y };
}

/** 以某个屏幕锚点（默认视口中心）缩放画布。 */
function applyZoom(nextZoom: number, anchorX?: number, anchorY?: number): void {
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const targetX = anchorX ?? centerX;
  const targetY = anchorY ?? centerY;

  const offsetX = targetX - (centerX + pan.value.x);
  const offsetY = targetY - (centerY + pan.value.y);
  const contentX = offsetX / zoom.value;
  const contentY = offsetY / zoom.value;

  const next = clampZoom(nextZoom);
  pan.value = {
    x: targetX - contentX * next - centerX,
    y: targetY - contentY * next - centerY,
  };
  zoom.value = next;
  clampPan();
}

function zoomIn(): void {
  applyZoom(zoom.value * 1.2);
}

function zoomOut(): void {
  applyZoom(zoom.value / 1.2);
}

function resetZoom(): void {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

/** 鼠标滚轮 / 触控板双指缩放，以光标位置为锚点。 */
function onWheel(event: WheelEvent): void {
  event.preventDefault();
  // 触控板捏合会带 ctrl 键，步长比鼠标滚轮更细腻。
  const sensitivity = event.ctrlKey ? 0.008 : 0.0018;
  const factor = Math.exp(-event.deltaY * sensitivity);
  applyZoom(zoom.value * factor, event.clientX, event.clientY);
}

interface PanSession {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
}

let panSession: PanSession | null = null;

function startPan(event: PointerEvent): void {
  panSession = {
    startX: event.clientX,
    startY: event.clientY,
    startPanX: pan.value.x,
    startPanY: pan.value.y,
  };
  event.preventDefault();
  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", onPanEnd);
  window.addEventListener("pointercancel", onPanEnd);
}

function onPanMove(event: PointerEvent): void {
  const state = panSession;
  if (!state) return;
  pan.value = {
    x: state.startPanX + (event.clientX - state.startX),
    y: state.startPanY + (event.clientY - state.startY),
  };
  clampPan();
}

function onPanEnd(): void {
  panSession = null;
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", onPanEnd);
  window.removeEventListener("pointercancel", onPanEnd);
}

/** 画布外的空白区：左键拖动平移；中键在任意位置平移。 */
function onViewportPointerDown(event: PointerEvent): void {
  if (event.button === 1) {
    startPan(event);
    return;
  }
  if (event.button !== 0 || event.target !== viewportEl.value) return;
  selection.clear();
  startPan(event);
}

/** 画面空白处：清除选择；缩放后拖动可平移。 */
function onFramePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  selection.clear();
  startPan(event);
}

// ---------------------------------------------------------------------------
// 当前时间点的画面元素
// ---------------------------------------------------------------------------

type VisualKind = "video" | "image" | "text";

interface VisualItem {
  clip: Clip;
  trackId: string;
  asset?: MediaAsset;
  kind: VisualKind;
  /** 轨道层级：上方轨道数值更大，渲染在上层。 */
  layer: number;
}

const active = computed(() => activeClipsAt(project.doc, playback.playhead));

const visualItems = computed<VisualItem[]>(() => {
  const items: VisualItem[] = [];
  project.doc.tracks.forEach((track, index) => {
    if (!isVisible(track)) return;
    const clip = active.value.get(track.id);
    if (!clip || clip.audioOnly) return;

    const asset =
      clip.assetId === ""
        ? undefined
        : project.doc.assets.find((candidate) => candidate.id === clip.assetId);
    const kind: VisualKind | null =
      clip.assetId === ""
        ? "text"
        : asset?.kind === "image"
          ? "image"
          : asset?.kind === "video"
            ? "video"
            : null;
    if (!kind) return;

    items.push({
      clip,
      trackId: track.id,
      asset,
      kind,
      layer: project.doc.tracks.length - index,
    });
  });
  return items;
});

/** 当前时间点最上方的视频片段（引擎只渲染这一条视频轨）。 */
const videoItem = computed(
  () => visualItems.value.find((item) => item.kind === "video") ?? null,
);
const imageItems = computed(() =>
  visualItems.value.filter((item) => item.kind === "image"),
);
const textItems = computed(() =>
  visualItems.value.filter((item) => item.kind === "text"),
);

// ---------------------------------------------------------------------------
// OFX 效果预览（暂停时渲染当前帧，播放时隐藏）
// ---------------------------------------------------------------------------

interface EffectPreview {
  url: string;
  time: number;
}

const effectPreview = ref<Record<string, EffectPreview>>({});
let effectToken = 0;
let effectTimer: number | null = null;
let effectRendering = false;
let effectQueued = false;

/**
 * 暂停时的单帧预览：视频用当前帧（整段烘焙可能还没跑完），图片用静态帧。
 * 播放时由引擎直接播已烘焙的文件，这里的叠加层会隐藏。
 */
const effectItems = computed(() =>
  visualItems.value.filter((item) => {
    if (!item.asset || !clipHasEffects(item.clip)) return false;
    // 整段烘焙已就绪：引擎直接播烘焙文件，不用再逐帧渲染叠加层。
    if (effectRender.sourceFor(item.clip.id)) return false;
    if (item.kind === "video") return item === videoItem.value;
    return item.kind === "image";
  }),
);

/** 预渲染状态：进度显示在预览标题旁。 */
const effectRenderLabel = computed(() => {
  const progress = effectRender.progress;
  if (progress) return i18n.t("effects.rendering", { pct: progress.pct });
  if (effectRender.failed) return i18n.t("preview.fxFailed");
  return null;
});

const effectSignature = computed(() =>
  effectItems.value
    .map(
      (item) =>
        `${item.clip.id}:${item.asset?.src ?? ""}:${item.clip.start}:` +
        `${item.clip.duration}:${item.clip.in}:${item.clip.speed ?? 1}:` +
        `${JSON.stringify(item.clip.effects ?? [])}`,
    )
    .join("|"),
);

function effectUrl(item: VisualItem): string | null {
  const preview = effectPreview.value[item.clip.id];
  if (!preview) return null;
  if (Math.abs(preview.time - playback.playhead) > 1e-3) return null;
  return preview.url;
}

async function renderEffectPreviews(): Promise<void> {
  if (effectRendering) {
    effectQueued = true;
    return;
  }
  if (!isTauri() || playback.playing) {
    effectPreview.value = {};
    return;
  }
  const items = effectItems.value;
  if (items.length === 0) {
    effectPreview.value = {};
    return;
  }
  effectRendering = true;
  try {
    const token = ++effectToken;
    const width = project.doc.width;
    const height = project.doc.height;
    const next: Record<string, EffectPreview> = {};
    for (const item of items) {
      const asset = item.asset;
      if (!asset) continue;
      const local = Math.max(0, playback.playhead - item.clip.start);
      const sourceTime =
        item.kind === "image" ? 0 : (item.clip.in ?? 0) + local * (item.clip.speed ?? 1);
      try {
        const frame = await ofxRenderPreview({
          source: asset.src,
          sourceTime,
          time: local,
          width,
          height,
          isImage: item.kind === "image",
          fit: "contain",
          effects: clipEffectSpecs(item.clip),
        });
        if (token !== effectToken) break;
        next[item.clip.id] = {
          url: `data:image/png;base64,${frame.pngBase64}`,
          time: playback.playhead,
        };
      } catch (error) {
        // 预览失败不应该打断编辑；导出阶段会给出明确错误。
        console.warn("OFX preview failed", error);
      }
    }
    if (token === effectToken && !playback.playing) effectPreview.value = next;
  } finally {
    effectRendering = false;
    if (effectQueued) {
      effectQueued = false;
      void renderEffectPreviews();
    }
  }
}

watch(
  [
    () => playback.playhead,
    () => playback.playing,
    () => effectSignature.value,
    () => project.doc.width,
    () => project.doc.height,
  ],
  () => {
    if (effectTimer !== null) {
      window.clearTimeout(effectTimer);
      effectTimer = null;
    }
    if (playback.playing || effectItems.value.length === 0) {
      effectPreview.value = {};
      return;
    }
    effectTimer = window.setTimeout(() => {
      effectTimer = null;
      void renderEffectPreviews();
    }, 160);
  },
  { immediate: true },
);

function effectOverlayStyle(item: VisualItem): Record<string, string | number> {
  const localTime = playback.playhead - item.clip.start;
  const transform = transformAt(item.clip);
  const transition = transitionState(item.clip, localTime);
  const offsetX = ((transform.x + transition.offsetX) / 100) * stageSize.value.width;
  const offsetY = ((transform.y + transition.offsetY) / 100) * stageSize.value.height;
  return {
    transform:
      `translate(${offsetX}px, ${offsetY}px) ` +
      `rotate(${transform.rotation}deg) scale(${transform.scale})`,
    opacity: opacityAt(item.clip, localTime) * transition.opacity,
    zIndex: item.layer,
    mixBlendMode: resolveBlendMode(item.clip),
    filter: clipColorCss(item.clip) ?? "none",
  };
}

function findClipById(id: string): Clip | null {
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (clip) return clip;
  }
  return null;
}

const selectedClip = computed(() =>
  selection.selectedClipIds.length === 1
    ? findClipById(selection.selectedClipIds[0])
    : null,
);

const selectedItem = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return null;
  const item = visualItems.value.find((candidate) => candidate.clip.id === clip.id);
  if (!item) return null;
  // 下层的视频轨不会被引擎渲染，因此不显示选择框。
  if (item.kind === "video" && item !== videoItem.value) return null;
  return item;
});

// ---------------------------------------------------------------------------
// 元素几何 / 样式
// ---------------------------------------------------------------------------

/** 工程像素 → 当前画布像素。 */
const projectScale = computed(() =>
  project.doc.height > 0 ? stageSize.value.height / project.doc.height : 1,
);

const textEls = new Map<string, HTMLElement>();
const textBoxSizes = ref<Record<string, { width: number; height: number }>>({});

function setTextEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) textEls.set(id, el);
  else textEls.delete(id);
}

function measureTextEls(): void {
  if (textEls.size === 0) return;
  const next = { ...textBoxSizes.value };
  let changed = false;
  for (const [id, el] of textEls) {
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const prev = next[id];
    if (
      !prev ||
      Math.abs(prev.width - width) > 0.5 ||
      Math.abs(prev.height - height) > 0.5
    ) {
      next[id] = { width, height };
      changed = true;
    }
  }
  if (changed) textBoxSizes.value = next;
}

onUpdated(measureTextEls);

watch(
  [
    () => textItems.value.map((item) => `${item.clip.id}:${item.clip.text ?? ""}`).join("|"),
    () => stageSize.value.width,
    () => stageSize.value.height,
  ],
  async () => {
    await nextTick();
    measureTextEls();
  },
  { immediate: true },
);

function baseBox(item: VisualItem): { width: number; height: number } {
  const frameW = stageSize.value.width;
  const frameH = stageSize.value.height;
  if (item.kind === "text") {
    const measured = textBoxSizes.value[item.clip.id];
    if (measured) {
      return {
        width: Math.min(measured.width, frameW * 0.88),
        height: measured.height,
      };
    }
    const style = resolveTextStyle(item.clip);
    return {
      width: frameW * 0.88,
      height: Math.max(1, style.fontSize * projectScale.value * style.lineHeight),
    };
  }
  const asset = item.asset;
  if (asset?.width && asset.height) {
    return containSize(asset.width, asset.height, frameW, frameH);
  }
  return { width: frameW, height: frameH };
}

function transformAt(clip: Clip): ClipTransform {
  return resolveTransformAt(clip, playback.playhead - clip.start);
}

function elementStyle(item: VisualItem): Record<string, string | number> {
  const localTime = playback.playhead - item.clip.start;
  const transform = transformAt(item.clip);
  const transition = transitionState(item.clip, localTime);
  const offsetX = ((transform.x + transition.offsetX) / 100) * stageSize.value.width;
  const offsetY = ((transform.y + transition.offsetY) / 100) * stageSize.value.height;
  return {
    transform:
      `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) ` +
      `rotate(${transform.rotation}deg) scale(${transform.scale})`,
    opacity: opacityAt(item.clip, localTime) * transition.opacity,
    zIndex: item.layer,
    mixBlendMode: resolveBlendMode(item.clip),
    filter: clipColorCss(item.clip) ?? "none",
  };
}

/** 图片 / 视频的描边与阴影用 box-shadow 表达；描边是外圈实色。 */
function mediaEffectStyle(item: VisualItem): Record<string, string> {
  const scale = projectScale.value;
  const shadow = resolveShadow(item.clip);
  const stroke = resolveStroke(item.clip);
  const shadows: string[] = [];
  if (shadow.enabled) {
    shadows.push(
      `${shadow.offsetX * scale}px ${shadow.offsetY * scale}px ${shadow.blur * scale}px ` +
        hexToRgba(shadow.color, shadow.opacity),
    );
  }
  if (stroke.enabled && stroke.width > 0) {
    shadows.push(`0 0 0 ${stroke.width * scale}px ${stroke.color}`);
  }
  return {
    borderRadius: `${resolveCornerRadius(item.clip) * scale}px`,
    boxShadow: shadows.length > 0 ? shadows.join(", ") : "none",
  };
}

function imageStyle(item: VisualItem): Record<string, string | number> {
  const box = baseBox(item);
  return {
    ...elementStyle(item),
    ...mediaEffectStyle(item),
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
}

function textStyle(item: VisualItem): Record<string, string | number> {
  const style = resolveTextStyle(item.clip);
  const stroke = resolveStroke(item.clip);
  const shadow = resolveShadow(item.clip);
  const scale = projectScale.value;
  const shadows: string[] = [];

  if (shadow.enabled) {
    shadows.push(
      `${shadow.offsetX * scale}px ${shadow.offsetY * scale}px ${shadow.blur * scale}px ` +
        hexToRgba(shadow.color, shadow.opacity),
    );
  }
  if (style.glowEnabled) {
    const blur = style.glowBlur * scale;
    const color = hexToRgba(style.glowColor, style.glowOpacity);
    shadows.push(`0 0 ${blur * 0.5}px ${color}`, `0 0 ${blur}px ${color}`);
  }

  const result: Record<string, string | number> = {
    ...elementStyle(item),
    // 宽度跟随文字内容：选中框紧贴文字，不再固定占满 88% 画布。
    width: "max-content",
    maxWidth: `${stageSize.value.width * 0.88}px`,
    fontFamily: fontStackOf(style.fontFamily),
    fontSize: `${style.fontSize * scale}px`,
    fontWeight: 600,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing * scale}px`,
    color: style.color,
    textAlign: style.align,
    textShadow: shadows.length > 0 ? shadows.join(", ") : "none",
  };

  if (style.backgroundEnabled) {
    result.backgroundColor = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    result.padding = `${TEXT_BACKGROUND_PADDING_Y * scale}px ${TEXT_BACKGROUND_PADDING_X * scale}px`;
    result.borderRadius = `${TEXT_BACKGROUND_RADIUS * scale}px`;
  } else {
    result.backgroundColor = "transparent";
    result.padding = "0";
  }

  result.WebkitTextStroke =
    stroke.enabled && stroke.width > 0
      ? `${stroke.width * scale}px ${stroke.color}`
      : "0 transparent";

  return result;
}

const videoLayerStyle = computed<Record<string, string | number>>(() => {
  const item = videoItem.value;
  if (!item) {
    const empty: Record<string, string | number> = {
      zIndex: 0,
      opacity: 1,
      transform: "none",
      mixBlendMode: "normal",
      filter: "none",
      borderRadius: "0%",
      boxShadow: "none",
    };
    return empty;
  }
  const localTime = playback.playhead - item.clip.start;
  const transform = transformAt(item.clip);
  const transition = transitionState(item.clip, localTime);
  const offsetX = ((transform.x + transition.offsetX) / 100) * stageSize.value.width;
  const offsetY = ((transform.y + transition.offsetY) / 100) * stageSize.value.height;
  const style: Record<string, string | number> = {
    zIndex: item.layer,
    opacity: opacityAt(item.clip, localTime) * transition.opacity,
    transform:
      `translate(${offsetX}px, ${offsetY}px) ` +
      `rotate(${transform.rotation}deg) scale(${transform.scale})`,
    mixBlendMode: resolveBlendMode(item.clip),
    filter: clipColorCss(item.clip) ?? "none",
    ...mediaEffectStyle(item),
  };
  return style;
});

const videoHitStyle = computed<Record<string, string | number> | null>(() => {
  const item = videoItem.value;
  if (!item) return null;
  const box = baseBox(item);
  return {
    ...elementStyle(item),
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
});

// ---------------------------------------------------------------------------
// 选择框与拖拽交互
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface SelectionGeometry {
  item: VisualItem;
  center: Point;
  corners: Point[];
  topCenter: Point;
  rotateHandle: Point;
}

const selectionGeometry = computed<SelectionGeometry | null>(() => {
  const item = selectedItem.value;
  if (!item) return null;
  const frameW = stageSize.value.width;
  const frameH = stageSize.value.height;
  if (frameW <= 0 || frameH <= 0) return null;

  const transform = transformAt(item.clip);
  const box = baseBox(item);
  const centerX = frameW / 2 + (transform.x / 100) * frameW;
  const centerY = frameH / 2 + (transform.y / 100) * frameH;
  const angle = (transform.rotation * Math.PI) / 180;
  const halfW = (box.width / 2) * transform.scale;
  const halfH = (box.height / 2) * transform.scale;

  const point = (x: number, y: number): Point => ({
    x: centerX + x * Math.cos(angle) - y * Math.sin(angle),
    y: centerY + x * Math.sin(angle) + y * Math.cos(angle),
  });

  return {
    item,
    center: { x: centerX, y: centerY },
    corners: [
      point(-halfW, -halfH),
      point(halfW, -halfH),
      point(halfW, halfH),
      point(-halfW, halfH),
    ],
    topCenter: point(0, -halfH),
    rotateHandle: point(0, -halfH - 28 / zoom.value),
  };
});

const selectionPoints = computed(() =>
  selectionGeometry.value
    ? selectionGeometry.value.corners.map((point) => `${point.x},${point.y}`).join(" ")
    : "",
);

const handleRadius = computed(() => 5.5 / zoom.value);
const outlineWidth = computed(() => 1.5 / zoom.value);
const snapGuideWidth = computed(() => 1 / zoom.value);

/** 吸附阈值（屏幕像素）：换算到画布坐标时要除以缩放。 */
const SNAP_THRESHOLD_PX = 8;

interface Aabb {
  centerX: number;
  centerY: number;
  halfW: number;
  halfH: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 元素在画布坐标系里的轴对齐包围盒（已考虑旋转）。 */
function itemAabb(item: VisualItem): Aabb {
  const frameW = stageSize.value.width;
  const frameH = stageSize.value.height;
  const transform = transformAt(item.clip);
  const box = baseBox(item);
  const angle = (transform.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width * transform.scale;
  const height = box.height * transform.scale;
  const halfW = (width * cos + height * sin) / 2;
  const halfH = (width * sin + height * cos) / 2;
  const centerX = frameW / 2 + (transform.x / 100) * frameW;
  const centerY = frameH / 2 + (transform.y / 100) * frameH;
  return {
    centerX,
    centerY,
    halfW,
    halfH,
    left: centerX - halfW,
    right: centerX + halfW,
    top: centerY - halfH,
    bottom: centerY + halfH,
  };
}

/** 吸附目标：画布边 / 中心 / 三分线，以及其它画面元素的边与中心。 */
function snapTargets(excludeClipId: string): { x: number[]; y: number[] } {
  const frameW = stageSize.value.width;
  const frameH = stageSize.value.height;
  const x = [0, frameW / 3, frameW / 2, (frameW * 2) / 3, frameW];
  const y = [0, frameH / 3, frameH / 2, (frameH * 2) / 3, frameH];
  for (const item of visualItems.value) {
    if (item.clip.id === excludeClipId) continue;
    const box = itemAabb(item);
    x.push(box.left, box.centerX, box.right);
    y.push(box.top, box.centerY, box.bottom);
  }
  return { x, y };
}

interface AxisSnap {
  value: number;
  line: number | null;
}

function snapAxis(
  proposed: number,
  halfExtent: number,
  targets: number[],
  threshold: number,
): AxisSnap {
  let best: AxisSnap = { value: proposed, line: null };
  let bestDistance = threshold;
  for (const target of targets) {
    // 元素中心 / 左缘 / 右缘分别对齐到目标线。
    for (const candidate of [target, target + halfExtent, target - halfExtent]) {
      const distance = Math.abs(candidate - proposed);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { value: candidate, line: target };
      }
    }
  }
  return best;
}

const snapGuides = ref<{ x: number[]; y: number[] }>({ x: [], y: [] });

function clearSnapGuides(): void {
  snapGuides.value = { x: [], y: [] };
}

interface InteractionState {
  mode: "move" | "resize" | "rotate";
  clipId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startScale: number;
  startRotation: number;
  centerX: number;
  centerY: number;
  startDistance: number;
  startAngle: number;
}

let interaction: InteractionState | null = null;

function canvasPoint(event: PointerEvent): Point {
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: (event.clientX - rect.left) / zoom.value,
    y: (event.clientY - rect.top) / zoom.value,
  };
}

function isClipLocked(clipId: string): boolean {
  const track = project.doc.tracks.find((candidate) =>
    candidate.clips.some((clip) => clip.id === clipId),
  );
  return track?.locked === true;
}

function applyClipTransform(
  clipId: string,
  patch: Partial<ClipTransform>,
  coalesce: boolean,
): void {
  const mutate = (doc: Project) => {
    for (const track of doc.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return doc;
      if (!clip.keyframes?.length) return setClipTransform(doc, clipId, patch);
      const time = Math.max(
        0,
        Math.min(clip.duration, playback.playhead - clip.start),
      );
      return setClipKeyframes(doc, clipId, upsertKeyframe(clip, time, patch));
    }
    return doc;
  };
  if (coalesce) project.dispatchCoalesced(mutate, `transform:${clipId}`);
  else project.dispatch(mutate);
}

function beginInteractionListeners(): void {
  window.addEventListener("pointermove", onInteractionMove);
  window.addEventListener("pointerup", onInteractionEnd);
  window.addEventListener("pointercancel", onInteractionEnd);
}

function onElementPointerDown(item: VisualItem, event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  selection.select(item.clip.id, event.shiftKey);
  selection.setActiveTrack(item.trackId);
  clearSnapGuides();
  if (isClipLocked(item.clip.id)) return;

  const transform = transformAt(item.clip);
  interaction = {
    mode: "move",
    clipId: item.clip.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: transform.x,
    startY: transform.y,
    startScale: transform.scale,
    startRotation: transform.rotation,
    centerX: 0,
    centerY: 0,
    startDistance: 0,
    startAngle: 0,
  };
  beginInteractionListeners();
}

function onResizeStart(event: PointerEvent): void {
  const geometry = selectionGeometry.value;
  if (!geometry) return;
  if (isClipLocked(geometry.item.clip.id)) return;

  const transform = transformAt(geometry.item.clip);
  const point = canvasPoint(event);
  const distance = Math.hypot(
    point.x - geometry.center.x,
    point.y - geometry.center.y,
  );

  interaction = {
    mode: "resize",
    clipId: geometry.item.clip.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: transform.x,
    startY: transform.y,
    startScale: transform.scale,
    startRotation: transform.rotation,
    centerX: geometry.center.x,
    centerY: geometry.center.y,
    startDistance: Math.max(1, distance),
    startAngle: 0,
  };
  beginInteractionListeners();
}

function onRotateStart(event: PointerEvent): void {
  const geometry = selectionGeometry.value;
  if (!geometry) return;
  if (isClipLocked(geometry.item.clip.id)) return;

  const transform = transformAt(geometry.item.clip);
  const point = canvasPoint(event);
  const angle = (Math.atan2(
    point.y - geometry.center.y,
    point.x - geometry.center.x,
  ) *
    180) /
    Math.PI;

  interaction = {
    mode: "rotate",
    clipId: geometry.item.clip.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: transform.x,
    startY: transform.y,
    startScale: transform.scale,
    startRotation: transform.rotation,
    centerX: geometry.center.x,
    centerY: geometry.center.y,
    startDistance: 0,
    startAngle: angle,
  };
  beginInteractionListeners();
}

function normalizeRotation(value: number): number {
  let angle = value % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

function onInteractionMove(event: PointerEvent): void {
  const state = interaction;
  if (!state) return;
  const frameW = stageSize.value.width;
  const frameH = stageSize.value.height;
  if (!(frameW > 0 && frameH > 0)) return;

  if (state.mode === "move") {
    const deltaX = (event.clientX - state.startClientX) / zoom.value;
    const deltaY = (event.clientY - state.startClientY) / zoom.value;
    const movingItem = visualItems.value.find((item) => item.clip.id === state.clipId);
    const threshold = SNAP_THRESHOLD_PX / zoom.value;

    let x = state.startX;
    let y = state.startY;

    if (movingItem) {
      const proposedX = frameW / 2 + (state.startX / 100) * frameW + deltaX;
      const proposedY = frameH / 2 + (state.startY / 100) * frameH + deltaY;
      const box = itemAabb(movingItem);
      const targets = snapTargets(state.clipId);
      const snappedX = snapAxis(proposedX, box.halfW, targets.x, threshold);
      const snappedY = snapAxis(proposedY, box.halfH, targets.y, threshold);
      x = ((snappedX.value - frameW / 2) / frameW) * 100;
      y = ((snappedY.value - frameH / 2) / frameH) * 100;
      snapGuides.value = {
        x: snappedX.line === null ? [] : [snappedX.line],
        y: snappedY.line === null ? [] : [snappedY.line],
      };
    } else {
      x += (deltaX / frameW) * 100;
      y += (deltaY / frameH) * 100;
    }

    applyClipTransform(
      state.clipId,
      {
        x: Math.round(Math.min(300, Math.max(-300, x)) * 10) / 10,
        y: Math.round(Math.min(300, Math.max(-300, y)) * 10) / 10,
      },
      true,
    );
    return;
  }

  if (state.mode === "resize") {
    const point = canvasPoint(event);
    const distance = Math.hypot(point.x - state.centerX, point.y - state.centerY);
    const proposed = Math.min(
      5,
      Math.max(0.05, (state.startScale * distance) / state.startDistance),
    );

    // 缩放时也吸附到画布与其它元素的边 / 中心线。
    let scale = proposed;
    const item = visualItems.value.find((candidate) => candidate.clip.id === state.clipId);
    if (item) {
      const target = transformAt(item.clip);
      const box = baseBox(item);
      const angle = (target.rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      // 旋转后的包围盒半宽 / 半高与 scale 成线性关系。
      const kx = (box.width * cos + box.height * sin) / 2;
      const ky = (box.width * sin + box.height * cos) / 2;
      const threshold = SNAP_THRESHOLD_PX / zoom.value;
      const targets = snapTargets(state.clipId);

      let bestDistance = threshold;
      let guideX: number | null = null;
      let guideY: number | null = null;
      const consider = (candidate: number, line: number, axis: "x" | "y"): void => {
        if (!(candidate > 0)) return;
        const extent = axis === "x" ? kx : ky;
        const distancePx = Math.abs(candidate - proposed) * extent;
        if (distancePx > bestDistance) return;
        bestDistance = distancePx;
        scale = candidate;
        if (axis === "x") guideX = line;
        else guideY = line;
      };

      if (kx > 0) {
        for (const line of targets.x) {
          consider((state.centerX - line) / kx, line, "x");
          consider((line - state.centerX) / kx, line, "x");
        }
      }
      if (ky > 0) {
        for (const line of targets.y) {
          consider((state.centerY - line) / ky, line, "y");
          consider((line - state.centerY) / ky, line, "y");
        }
      }
      snapGuides.value = {
        x: guideX === null ? [] : [guideX],
        y: guideY === null ? [] : [guideY],
      };
    }

    applyClipTransform(
      state.clipId,
      { scale: Math.round(Math.min(5, Math.max(0.05, scale)) * 1000) / 1000 },
      true,
    );
    return;
  }

  const point = canvasPoint(event);
  const angle =
    (Math.atan2(point.y - state.centerY, point.x - state.centerX) * 180) /
    Math.PI;
  let rotation = state.startRotation + (angle - state.startAngle);
  if (event.shiftKey) {
    rotation = Math.round(rotation / 15) * 15;
  } else {
    // 不按 Shift 时也轻微吸附到 45° 的整数倍，方便快速摆正。
    const normalized = normalizeRotation(rotation);
    const nearest = Math.round(normalized / 45) * 45;
    if (Math.abs(normalized - nearest) <= 5) rotation = nearest;
  }
  applyClipTransform(
    state.clipId,
    { rotation: Math.round(normalizeRotation(rotation) * 10) / 10 },
    true,
  );
}

function onInteractionEnd(): void {
  interaction = null;
  clearSnapGuides();
  project.endCoalesce();
  window.removeEventListener("pointermove", onInteractionMove);
  window.removeEventListener("pointerup", onInteractionEnd);
  window.removeEventListener("pointercancel", onInteractionEnd);
}

// ---------------------------------------------------------------------------
// 全屏 / 播放控制
// ---------------------------------------------------------------------------

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === previewEl.value;
  void nextTick(measureViewport);
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await previewEl.value?.requestFullscreen();
  } catch {
    /* 某些 WebView 不支持全屏 API：静默忽略 */
  }
}

const total = computed(() => projectDuration(project.doc));
const fps = computed(() => project.doc.fps);
const nowLabel = computed(() => formatTimecode(playback.playhead, fps.value));
const totalLabel = computed(() => formatTimecode(total.value, fps.value));

/** 工程完全为空（没有素材，也没有任何片段）时才显示导入提示。 */
const projectIsEmpty = computed(
  () =>
    project.doc.assets.length === 0 &&
    project.doc.tracks.every((track) => track.clips.length === 0),
);

function togglePlay(): void {
  const next = !playback.playing;
  playback.playing = next;
  // 在用户手势内直接驱动引擎，确保 WebView 的自动播放策略不会拦截音频。
  if (next) engine?.play();
  else engine?.pause();
}

watch(
  () => layout.previewAspect,
  async () => {
    resetZoom();
    await nextTick();
    measureViewport();
  },
);

watch(
  () => stageSize.value.width,
  () => clampPan(),
);
</script>

<template>
  <section
    ref="previewEl"
    class="preview"
    :class="{ portrait: layout.layoutMode === 'portrait' }"
  >
    <header class="preview-head">
      <div class="head-left">
        <span class="head-title">{{ i18n.t("preview.title") }}</span>
        <span class="res-chip tabular">
          {{
            i18n.t("preview.resolution", {
              width: project.doc.width,
              height: project.doc.height,
              fps,
            })
          }}
        </span>
        <span v-if="effectRenderLabel" class="fx-chip">
          {{ effectRenderLabel }}
        </span>
      </div>
    </header>

    <div
      ref="viewportEl"
      class="stage-viewport"
      @wheel.prevent="onWheel"
      @pointerdown="onViewportPointerDown"
    >
      <div ref="stageEl" class="stage" :style="stageStyle">
        <div
          class="frame"
          :data-quality="layout.previewQuality"
          @pointerdown.self="onFramePointerDown"
        >
          <!-- 引擎把 <video>/<audio> 挂在这里 -->
          <div ref="mediaLayer" class="media-layer" :style="videoLayerStyle" />

          <img
            v-for="item in imageItems"
            :key="item.clip.id"
            class="overlay-image"
            :src="item.asset ? fileUrl(item.asset.src) : ''"
            :style="imageStyle(item)"
            alt=""
            draggable="false"
            @pointerdown="onElementPointerDown(item, $event)"
          />

          <div
            v-for="item in textItems"
            :key="item.clip.id"
            :ref="(el) => setTextEl(item.clip.id, el)"
            class="overlay-text"
            :style="textStyle(item)"
            @pointerdown="onElementPointerDown(item, $event)"
          >
            {{ item.clip.text }}
          </div>

          <div
            v-if="videoItem"
            class="video-hit"
            :style="videoHitStyle ?? undefined"
            @pointerdown="onElementPointerDown(videoItem, $event)"
          />

          <template v-for="item in effectItems" :key="`fx-${item.clip.id}`">
            <img
              v-if="!playback.playing && effectUrl(item)"
              class="effect-overlay"
              :src="effectUrl(item) ?? ''"
              :style="effectOverlayStyle(item)"
              alt=""
              draggable="false"
            />
          </template>

          <div v-if="projectIsEmpty" class="black-frame">
            <span>{{ i18n.t("preview.importHint") }}</span>
          </div>
        </div>

        <!-- 选择框放在 frame 外面，避免被画面裁切 -->
        <svg
          v-if="selectionGeometry"
          class="selection-layer"
          :viewBox="`0 0 ${stageSize.width} ${stageSize.height}`"
          :width="stageSize.width"
          :height="stageSize.height"
          aria-hidden="true"
        >
          <line
            v-for="x in snapGuides.x"
            :key="`snap-x-${x}`"
            class="snap-line"
            :x1="x"
            y1="0"
            :x2="x"
            :y2="stageSize.height"
            :stroke-width="snapGuideWidth"
          />
          <line
            v-for="y in snapGuides.y"
            :key="`snap-y-${y}`"
            class="snap-line"
            x1="0"
            :y1="y"
            :x2="stageSize.width"
            :y2="y"
            :stroke-width="snapGuideWidth"
          />
          <polygon
            class="sel-outline"
            :points="selectionPoints"
            :stroke-width="outlineWidth"
          />
          <line
            class="sel-outline"
            :x1="selectionGeometry.topCenter.x"
            :y1="selectionGeometry.topCenter.y"
            :x2="selectionGeometry.rotateHandle.x"
            :y2="selectionGeometry.rotateHandle.y"
            :stroke-width="outlineWidth"
          />
          <circle
            v-for="(point, index) in selectionGeometry.corners"
            :key="index"
            class="sel-handle"
            :class="`corner-${index}`"
            :cx="point.x"
            :cy="point.y"
            :r="handleRadius"
            :stroke-width="outlineWidth"
            @pointerdown.stop.prevent="onResizeStart"
          />
          <circle
            class="sel-handle sel-rotate"
            :cx="selectionGeometry.rotateHandle.x"
            :cy="selectionGeometry.rotateHandle.y"
            :r="handleRadius"
            :stroke-width="outlineWidth"
            @pointerdown.stop.prevent="onRotateStart"
          />
        </svg>
      </div>
    </div>

    <footer class="transport">
      <div class="tc-block">
        <span class="tc-now tabular">{{ nowLabel }}</span>
        <span class="tc-total tabular">/ {{ totalLabel }}</span>
      </div>

      <div class="transport-center">
        <button
          class="play-btn"
          :aria-label="playback.playing ? i18n.t('preview.pause') : i18n.t('preview.play')"
          @click="togglePlay"
        >
          <PauseIcon v-if="playback.playing" class="w-[19px] h-[19px]" />
          <PlayIcon v-else class="w-[19px] h-[19px]" />
        </button>
      </div>

      <div class="transport-right">
        <div class="zoom-pill">
          <button
            class="mini-icon"
            :aria-label="i18n.t('preview.zoomOut')"
            @click="zoomOut"
          >
            <MagnifyingGlassMinusIcon class="w-[14px] h-[14px]" />
          </button>
          <button
            class="zoom-value tabular"
            :title="i18n.t('preview.zoomReset')"
            :aria-label="i18n.t('preview.zoomReset')"
            @click="resetZoom"
          >
            {{ zoomPercent }}%
          </button>
          <button
            class="mini-icon"
            :aria-label="i18n.t('preview.zoomIn')"
            @click="zoomIn"
          >
            <MagnifyingGlassPlusIcon class="w-[14px] h-[14px]" />
          </button>
        </div>

        <Md3Select
          class="footer-select quality-select"
          compact
          :model-value="layout.previewQuality"
          :options="QUALITIES"
          :label="i18n.t('preview.quality')"
          @update:model-value="setQuality"
        />

        <Md3Select
          class="footer-select aspect-select"
          compact
          :model-value="layout.previewAspect"
          :options="ASPECTS"
          :label="i18n.t('preview.aspect')"
          @update:model-value="setAspect"
        />

        <Tooltip :text="i18n.t('preview.exportFrame')" align="end">
          <button
            class="icon-btn"
            :disabled="frameBusy"
            :aria-label="i18n.t('preview.exportFrame')"
            @click="exportFrame"
          >
            <CameraIcon class="w-[17px] h-[17px]" />
          </button>
        </Tooltip>

        <Tooltip
          :text="isFullscreen ? i18n.t('preview.exitFullscreen') : i18n.t('preview.fullscreen')"
          align="end"
        >
          <button class="icon-btn" :aria-label="isFullscreen ? i18n.t('preview.exitFullscreen') : i18n.t('preview.fullscreen')" @click="toggleFullscreen">
            <ArrowsPointingInIcon v-if="isFullscreen" class="w-[17px] h-[17px]" />
            <ArrowsPointingOutIcon v-else class="w-[17px] h-[17px]" />
          </button>
        </Tooltip>

        <Tooltip
          :text="layout.showTimeline ? i18n.t('preview.hideTimeline') : i18n.t('preview.showTimeline')"
          align="end"
        >
          <button
            class="icon-btn"
            :aria-label="layout.showTimeline ? i18n.t('preview.hideTimeline') : i18n.t('preview.showTimeline')"
            :aria-expanded="layout.showTimeline"
            @click="layout.showTimeline = !layout.showTimeline"
          >
            <PanelIcon side="bottom" :filled="layout.showTimeline" class="w-[17px] h-[17px]" />
          </button>
        </Tooltip>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.preview {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--app-inset);
  /* 预览内的层级（文字、选择框）不外溢到模态框之上。 */
  isolation: isolate;
}
.preview:fullscreen {
  background-color: var(--app-inset);
}

/* ---- 顶部小工具条 ---- */
.preview-head {
  flex: 0 0 auto;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 0 16px;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.head-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-variant));
}
.res-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.fx-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

/* ---- 画布视口：缩放 / 平移都发生在这里 ---- */
.stage-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
}
.stage {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
  will-change: transform;
}
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 16px;
  background-color: #000;
  box-shadow: var(--md-elevation-3), 0 0 0 1px rgb(var(--md-outline-variant) / 0.25);
  isolation: isolate;
}

/* 画质：低画质关闭平滑缩放，减少大画布下的渲染压力。 */
.frame[data-quality="low"] :deep(video),
.frame[data-quality="low"] .overlay-image {
  image-rendering: pixelated;
}
.frame[data-quality="medium"] :deep(video),
.frame[data-quality="medium"] .overlay-image {
  image-rendering: high-quality;
}
.frame[data-quality="high"] :deep(video),
.frame[data-quality="high"] .overlay-image {
  image-rendering: auto;
}

.media-layer {
  position: absolute;
  inset: 0;
  transform-origin: center;
  will-change: transform;
  pointer-events: none;
  overflow: hidden;
}
/* 引擎注入的元素铺满画面 */
.media-layer :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
}
/* 音频元素不参与画面，但保持可加载 / 可播放（不用 display:none，规避 WebKit 的加载降级）。 */
.media-layer :deep(audio) {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.overlay-image {
  position: absolute;
  left: 50%;
  top: 50%;
  object-fit: contain;
  overflow: hidden;
  pointer-events: auto;
  cursor: move;
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}
.overlay-text {
  position: absolute;
  left: 50%;
  top: 50%;
  width: max-content;
  max-width: 88%;
  text-align: center;
  font-weight: 600;
  line-height: 1.25;
  min-height: 1.25em;
  color: #fff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  pointer-events: auto;
  cursor: move;
  user-select: none;
  will-change: transform;
}
.effect-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: center;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}

.video-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  background: transparent;
  cursor: move;
  will-change: transform;
}
.black-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255 255 255 / 0.42);
  font-size: 12px;
  pointer-events: none;
}

/* ---- 选择框 ---- */
.selection-layer {
  position: absolute;
  inset: 0;
  z-index: 50;
  overflow: visible;
  pointer-events: none;
}
.sel-outline {
  fill: none;
  stroke: rgb(var(--md-primary));
  stroke-linejoin: round;
  stroke-dasharray: none;
  filter: drop-shadow(0 0 2px rgb(0 0 0 / 0.45));
}
.snap-line {
  stroke: rgb(var(--md-tertiary));
  stroke-dasharray: 6 5;
  filter: drop-shadow(0 0 2px rgb(0 0 0 / 0.35));
}
.sel-handle {
  fill: #fff;
  stroke: rgb(var(--md-primary));
  pointer-events: auto;
}
/* 左上 / 右下：↖↘；右上 / 左下：↗↙ */
.sel-handle.corner-0,
.sel-handle.corner-2 {
  cursor: nwse-resize;
}
.sel-handle.corner-1,
.sel-handle.corner-3 {
  cursor: nesw-resize;
}
/* 旋转点：自绘旋转箭头光标（白色箭头 + 黑色描边，深色画面上也能看清） */
.sel-rotate {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M12 4a8 8 0 1 0 7.2 4.5' fill='none' stroke='%23000' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M12 4a8 8 0 1 0 7.2 4.5' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M15.5 2.5 20 8.4 12.9 8.2Z' fill='%23fff' stroke='%23000' stroke-width='.7'/%3E%3C/svg%3E")
      12 12,
    grab;
}
.sel-rotate:active {
  cursor: grabbing;
}

/* ---- 走带 ---- */
.transport {
  flex: 0 0 auto;
  height: 52px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  padding: 0 16px 6px;
}
.tc-block {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.tc-now {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.tc-total {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
}
.transport-center {
  display: flex;
  align-items: center;
  gap: 6px;
}
.play-btn {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.play-btn:hover {
  box-shadow: 0 4px 14px rgb(var(--md-primary) / 0.35);
}
.play-btn:active {
  transform: scale(0.95);
}
.transport-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
/* 竖屏左栏更窄：时间码 / 播放键一行，控件另起一行并靠右 */
.preview.portrait .transport {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "time play"
    "right right";
  height: auto;
  row-gap: 2px;
  padding: 0 12px 8px;
}
.preview.portrait .tc-block {
  grid-area: time;
  overflow: hidden;
}
.preview.portrait .transport-center {
  grid-area: play;
}
.preview.portrait .transport-right {
  grid-area: right;
}
.zoom-pill {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline-variant) / 0.45);
  flex: 0 0 auto;
}
.mini-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.mini-icon:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.zoom-value {
  min-width: 40px;
  height: 24px;
  padding: 0 2px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.zoom-value:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.footer-select {
  flex: 0 0 auto;
}
.quality-select {
  width: 92px;
}
.aspect-select {
  width: 112px;
}

@media (prefers-reduced-motion: reduce) {
  .play-btn {
    transition: none;
  }
  .play-btn:active {
    transform: none;
  }
}
</style>
