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
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import type { Clip, ClipTransform, MediaAsset, Project } from "@/types/project";
import { activeClipsAt, isVisible, projectDuration } from "@/core/playback/activeClips";
import { PlaybackEngine } from "@/core/playback/engine";
import { fileUrl, pickExportPath } from "@/core/media";
import { renderFrame } from "@/core/export/frame";
import { safeFileName } from "@/core/export/escape";
import { toast } from "@/composables/useToast";
import { useMediaImport } from "@/composables/useMediaImport";
import { useTimelineMenus } from "@/composables/useTimelineMenus";
import { patchClipTransform } from "./previewTransform";
import { formatTimecode } from "@/core/time";
import { containSize } from "@/core/transform";
import { clipColorCss } from "@/core/clipColor";
import { transitionState } from "@/core/clipTransition";
import { opacityAt, resolveTransformAt } from "@/core/keyframes";
import {
  fontStackOf,
  hexToRgba,
  outerStrokeWidth,
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
  TEXT_BACKGROUND_PADDING_X,
  TEXT_BACKGROUND_PADDING_Y,
  TEXT_BACKGROUND_RADIUS,
} from "@/core/clipStyle";
import {
  clipEffectSpecs,
  clipHasEffects,
  OFX_RETIMER_CONTEXT,
} from "@/core/effects";
import {
  ofxRenderPreview,
  ofxRenderTransition,
  ofxSourceTime,
} from "@/core/ofxApi";
import {
  activeOfxTransition,
  transitionProgress,
  type OfxTransitionSide,
} from "@/core/ofxTransition";
import { isTauri } from "@/utils/platform";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useOnboardingStore } from "@/stores/onboarding";
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
import ContextMenu from "@/components/common/ContextMenu.vue";
import SeriesChoices from "@/components/series/SeriesChoices.vue";
import type { MenuItem } from "@/components/common/contextMenu";
import { useI18n } from "@/i18n";
import { useSeriesPlayback } from "@/composables/useSeriesPlayback";

const project = useProjectStore();
const playback = usePlaybackStore();
const effectRender = useEffectRenderStore();
const selection = useSelectionStore();
const layout = useLayoutStore();
const onboarding = useOnboardingStore();
const { importing, importMedia } = useMediaImport();
const i18n = useI18n();
const series = useSeriesPlayback();
const seriesPending = series.pending;
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

const PLAY_MODES = computed<SelectOption[]>(() => [
  {
    id: "single",
    label: i18n.t("preview.playMode.single"),
    hint: i18n.t("preview.playMode.singleHint"),
  },
  {
    id: "series",
    label: i18n.t("preview.playMode.series"),
    hint: i18n.t("preview.playMode.seriesHint"),
  },
]);

function setPlayMode(value: string): void {
  layout.setSeriesPlayMode(value === "series" ? "series" : "single");
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
        const outcome = series.onEnded();
        if (outcome === "advance") {
          engine?.seek(0);
          engine?.sync();
          engine?.play();
          return;
        }
        playback.playing = false;
      },
    });
    engine.sync();
  }
  series.resetRun();

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
    // 开始播放 = 新的一轮：清掉选项浮层与上一轮的访问记录（全局空格快捷键也会走到这里）。
    if (playing) series.resetRun();
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
    series.onUserSeek();
    engine.seek(seconds);
  },
);

watch(
  () => project.doc,
  () => engine?.sync(),
);

watch(
  () => layout.seriesPlayMode,
  () => series.resetRun(),
);

// ---------------------------------------------------------------------------
// 画布尺寸 / 缩放 / 平移
// ---------------------------------------------------------------------------

const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 4;

const viewportSize = ref({ width: 0, height: 0 });
/** 视口在 `.preview` 里的左上角：选择框浮层贴着它放，坐标才和画面一致。 */
const viewportOrigin = ref({ left: 0, top: 0 });
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

/**
 * 画布四周留白（视口像素）。
 *
 * 选择框的角点、旋转点画在片段包围盒外面：不留白时画面会顶满视口，
 * 旋转点直接落在视口外被裁掉、角点只剩半个 —— 看起来就是「缩放点够不着」，
 * 片段一旦放大到出画就更明显。留出这点边距后默认 100% 就能抓全。
 */
const STAGE_MARGIN = 44;

const stageSize = computed(() => {
  const { width: availableW, height: availableH } = viewportSize.value;
  if (!(availableW > 0 && availableH > 0)) return { width: 0, height: 0 };
  const fitW = Math.max(1, availableW - STAGE_MARGIN * 2);
  const fitH = Math.max(1, availableH - STAGE_MARGIN * 2);
  const ratio = aspectRatio.value;
  let width = fitW;
  let height = width / ratio;
  if (height > fitH) {
    height = fitH;
    width = height * ratio;
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
});

const zoomPercent = computed(() => Math.round(zoom.value * 100));

/** 选项按钮随画面缩放（基准 1100px 宽）。 */
const choiceScale = computed(() => stageSize.value.width / 900);

const stageStyle = computed(() => ({
  width: `${stageSize.value.width}px`,
  height: `${stageSize.value.height}px`,
  transform: `translate(-50%, -50%) translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));

/**
 * 选择框 SVG 的盒子：画布范围与选择框的并集，再各留 `SELECTION_PAD`。
 *
 * 两个原因必须把盒子做大：
 * 1. WebKit 只对**盒子内部**的元素做命中测试 —— 片段拖出画面后角点在盒子外就点不到；
 * 2. 角点圆点正好压在盒子边界上时，命中测试会落到 svg 根节点而不是 circle。
 * 盒子按选择框实时扩大后，缩放点永远落在根节点内部，两边的 `elementFromPoint` 一致。
 */
const SELECTION_PAD = 32;

const selectionBox = computed(() => {
  const pad = SELECTION_PAD;
  let minX = -pad;
  let minY = -pad;
  let maxX = stageSize.value.width + pad;
  let maxY = stageSize.value.height + pad;
  const geometry = selectionGeometry.value;
  if (geometry) {
    for (const point of [...geometry.corners, geometry.rotateHandle]) {
      minX = Math.min(minX, point.x - pad);
      minY = Math.min(minY, point.y - pad);
      maxX = Math.max(maxX, point.x + pad);
      maxY = Math.max(maxY, point.y + pad);
    }
  }
  return {
    minX,
    minY,
    viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
    width: maxX - minX,
    height: maxY - minY,
  };
});

/**
 * SVG 与 `.stage` 完全重合：位置按平移 / 缩放算出来而不是写 transform。
 *
 * SVG 根节点一旦带 CSS transform，WebKit 对内部 circle 的命中测试会失效
 * （elementFromPoint 只返回 svg 本身），缩放点就点不到了；按坐标布局则两边一致。
 */
const selectionLayerStyle = computed(() => {
  const box = selectionBox.value;
  const width = box.width * zoom.value;
  const height = box.height * zoom.value;
  // 浮层铺满整个预览区，视口再往里缩：这里要把视口偏移加回来。
  const stageLeft =
    viewportOrigin.value.left +
    viewportSize.value.width / 2 +
    pan.value.x -
    (stageSize.value.width * zoom.value) / 2;
  const stageTop =
    viewportOrigin.value.top +
    viewportSize.value.height / 2 +
    pan.value.y -
    (stageSize.value.height * zoom.value) / 2;
  return {
    left: `${stageLeft + box.minX * zoom.value}px`,
    top: `${stageTop + box.minY * zoom.value}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
});

function measureViewport(): void {
  const el = viewportEl.value;
  if (!el) return;
  viewportSize.value = { width: el.clientWidth, height: el.clientHeight };
  viewportOrigin.value = { left: el.offsetLeft, top: el.offsetTop };
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

/** 带 OFX 效果的图片优先使用已烘焙的 PNG；烘焙期间退回原图。 */
function imageSource(item: VisualItem): string {
  if (!item.asset) return "";
  const baked = effectRender.sourceFor(item.clip.id);
  return fileUrl(baked ?? item.asset.src);
}
const textItems = computed(() =>
  visualItems.value.filter((item) => item.kind === "text"),
);

// ---------------------------------------------------------------------------
// OFX 效果预览（暂停时渲一帧；播放交给整段烘焙文件）
// ---------------------------------------------------------------------------

interface EffectPreview {
  url: string;
  /** 渲染时的播放头时间。 */
  time: number;
}

const effectPreview = ref<Record<string, EffectPreview>>({});
let effectToken = 0;
let effectTimer: number | null = null;
let effectRendering = false;
let effectQueued = false;

/**
 * 暂停时的单帧预览：视频用当前帧，图片用静态帧。
 * 播放时不再逐帧渲染（逐帧 OFX 只能到几帧每秒，画面会变成 PPT），
 * 而是等后台整段烘焙完成后由引擎直接播烘焙文件；烘焙进度显示在片段下边缘。
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
  const pending = effectRender.pendingJobs;
  if (pending.length > 0) {
    if (!pending.some((job) => job.status === "rendering")) {
      return i18n.t("effects.renderQueued");
    }
    return i18n.t("effects.rendering", { pct: effectRender.progress?.pct ?? 0 });
  }
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

/** 当前播放头对应的效果帧；时间对不上就不显示，避免闪回旧画面。 */
function effectUrl(item: VisualItem): string | null {
  const preview = effectPreview.value[item.clip.id];
  if (!preview) return null;
  if (Math.abs(playback.playhead - preview.time) > 1e-3) return null;
  return preview.url;
}

/** 渲染某个片段在 `at` 时刻的效果帧；失败返回 null，不打断编辑。 */
async function renderEffectItem(
  item: VisualItem,
  width: number,
  height: number,
  at: number,
): Promise<EffectPreview | null> {
  const asset = item.asset;
  if (!asset) return null;

  const local = Math.max(0, at - item.clip.start);
  let sourceTime =
    item.kind === "image" ? 0 : (item.clip.in ?? 0) + local * (item.clip.speed ?? 1);
  let retimerSourceTime: number | null = null;
  const specs = clipEffectSpecs(item.clip);
  // Retimer 决定源时间：必须在解码前问插件要哪一帧。只支持链首的 retimer。
  const retimer = specs[0];
  if (retimer && retimer.context === OFX_RETIMER_CONTEXT && item.kind !== "image") {
    try {
      const mapped = await ofxSourceTime({
        bundle: retimer.bundle,
        plugin: retimer.plugin,
        context: retimer.context,
        time: local,
        duration: item.clip.duration,
        fps: project.doc.fps,
        width,
        height,
        params: retimer.params ?? {},
      });
      sourceTime = (item.clip.in ?? 0) + mapped;
      if (asset.duration > 0) {
        sourceTime = Math.min(asset.duration - 0.001, Math.max(0, sourceTime));
      }
      retimerSourceTime = mapped;
    } catch (error) {
      console.warn("OFX SourceTime failed", error);
    }
  }

  try {
    const frame = await ofxRenderPreview({
      source: asset.src,
      sourceTime,
      time: local,
      width,
      height,
      isImage: item.kind === "image",
      fit: "contain",
      fps: project.doc.fps,
      duration: item.clip.duration,
      retimerSourceTime,
      effects: specs,
    });
    return {
      url: `data:image/png;base64,${frame.pngBase64}`,
      time: at,
    };
  } catch (error) {
    // 预览失败不应该打断编辑；导出阶段会给出明确错误。
    console.warn("OFX preview failed", error);
    return null;
  }
}

/** 暂停时的单帧：按工程分辨率渲染，方便放大看细节。 */
async function renderEffectPreviews(): Promise<void> {
  if (effectRendering) {
    effectQueued = true;
    return;
  }
  if (!isTauri()) {
    effectPreview.value = {};
    return;
  }
  if (playback.playing) return;
  const items = effectItems.value;
  if (items.length === 0) {
    effectPreview.value = {};
    return;
  }
  effectRendering = true;
  try {
    const token = ++effectToken;
    const at = playback.playhead;
    const next: Record<string, EffectPreview> = {};
    for (const item of items) {
      const preview = await renderEffectItem(
        item,
        project.doc.width,
        project.doc.height,
        at,
      );
      if (token !== effectToken) break;
      if (preview) next[item.clip.id] = preview;
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

// ---------------------------------------------------------------------------
// OFX 转场预览（暂停时叠加整帧转场，播放时交给烘焙文件 / 暂不叠加）
// ---------------------------------------------------------------------------

interface TransitionPreview {
  key: string;
  url: string;
  time: number;
}

const transitionPreview = ref<TransitionPreview | null>(null);
let transitionToken = 0;
let transitionTimer: number | null = null;
let transitionRendering = false;
let transitionQueued = false;

const activeTransition = computed(() =>
  activeOfxTransition(project.doc, playback.playhead),
);

const transitionSignature = computed(() => {
  const range = activeTransition.value;
  if (!range) return "";
  return JSON.stringify({
    clipId: range.clipId,
    edge: range.edge,
    start: range.start,
    end: range.end,
    effect: range.effect,
    from: range.from?.asset?.src ?? "",
    to: range.to?.asset?.src ?? "",
  });
});

function transitionSideArgs(side: OfxTransitionSide | null) {
  if (!side?.asset || side.asset.offline) return null;
  // 片段自身的效果已经烘焙好时，转场应该吃最终画面而不是原始素材。
  const baked = effectRender.sourceFor(side.clip.id);
  if (baked) {
    return {
      source: baked,
      sourceIn: 0,
      start: side.clip.start,
      speed: 1,
      assetDuration: side.clip.duration,
      isImage: side.asset.kind === "image",
    };
  }
  return {
    source: side.asset.src,
    sourceIn: side.clip.in ?? 0,
    start: side.clip.start,
    speed: side.clip.speed ?? 1,
    assetDuration: side.asset.duration ?? 0,
    isImage: side.asset.kind === "image",
  };
}

async function renderTransitionPreview(): Promise<void> {
  if (transitionRendering) {
    transitionQueued = true;
    return;
  }
  if (!isTauri() || playback.playing) {
    transitionPreview.value = null;
    return;
  }
  const range = activeTransition.value;
  if (!range) {
    transitionPreview.value = null;
    return;
  }
  transitionRendering = true;
  try {
    const token = ++transitionToken;
    const fromSide = range.from;
    const toSide = range.to;
    const from = transitionSideArgs(fromSide);
    const to = transitionSideArgs(toSide);
    if (!from && !to) {
      transitionPreview.value = null;
      return;
    }
    const frame = await ofxRenderTransition({
      bundle: range.effect.bundle,
      plugin: range.effect.plugin,
      context: range.effect.context ?? "OfxImageEffectContextTransition",
      params: { ...range.effect.params },
      from,
      to,
      timelineTime: playback.playhead,
      progress: transitionProgress(range, playback.playhead),
      duration: range.duration,
      width: project.doc.width,
      height: project.doc.height,
      fps: project.doc.fps,
      fit: "contain",
    });
    if (token !== transitionToken || playback.playing) return;
    transitionPreview.value = {
      key: `${range.clipId}:${range.edge}`,
      url: `data:image/png;base64,${frame.pngBase64}`,
      time: playback.playhead,
    };
  } catch (error) {
    // 单帧失败不打断编辑；导出时会明确报错。
    console.warn("OFX transition preview failed", error);
  } finally {
    transitionRendering = false;
    if (transitionQueued) {
      transitionQueued = false;
      void renderTransitionPreview();
    }
  }
}

const transitionPreviewLayer = computed(
  () => activeTransition.value?.layer ?? 9999,
);

const transitionPreviewUrl = computed(() => {
  const preview = transitionPreview.value;
  if (!preview || playback.playing) return null;
  if (Math.abs(preview.time - playback.playhead) > 1e-3) return null;
  return preview.url;
});

watch(
  [
    () => playback.playhead,
    () => playback.playing,
    () => transitionSignature.value,
    () => project.doc.width,
    () => project.doc.height,
  ],
  () => {
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    if (playback.playing || !activeTransition.value) {
      transitionPreview.value = null;
      return;
    }
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      void renderTransitionPreview();
    }, 120);
  },
  { immediate: true },
);

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

  // 外描边：`-webkit-text-stroke` 以字形轮廓为中心画，内半边会盖住填充色。这里把
  // 描边交给一层透明填充的 `::before`（宽度取两倍），实色文字压在上面，只露外侧。
  const strokeWidth = outerStrokeWidth(stroke, scale);
  if (strokeWidth > 0) {
    result["--text-stroke"] = `${strokeWidth}px ${stroke.color}`;
  }

  return result;
}

/** 文字片段是否有描边（决定要不要铺那层外描边）。 */
function hasTextStroke(item: VisualItem): boolean {
  return outerStrokeWidth(resolveStroke(item.clip)) > 0;
}

const videoLayerStyle = computed<Record<string, string | number>>(() => {
  const item = videoItem.value;
  if (!item) {
    // 没有视频片段时把变量重置掉，避免上一段的位移 / 缩放留在引擎的 <video> 上。
    return {
      zIndex: 0,
      opacity: 1,
      mixBlendMode: "normal",
      filter: "none",
      "--media-transform": "none",
      "--media-radius": "0px",
      "--media-shadow": "none",
    };
  }
  const localTime = playback.playhead - item.clip.start;
  const transform = transformAt(item.clip);
  const transition = transitionState(item.clip, localTime);
  const offsetX = ((transform.x + transition.offsetX) / 100) * stageSize.value.width;
  const offsetY = ((transform.y + transition.offsetY) / 100) * stageSize.value.height;
  const effect = mediaEffectStyle(item);
  // 位移 / 旋转 / 缩放写在 <video> 自己身上（见下面 `.media-layer :deep(video)` 的说明）：
  // WebKit 里视频是独立合成层，只改祖先的 transform 时，暂停中的画面不会跟着重绘，
  // 用户看到的就是「选中框动了、画面不动」。
  return {
    zIndex: item.layer,
    opacity: opacityAt(item.clip, localTime) * transition.opacity,
    mixBlendMode: resolveBlendMode(item.clip),
    filter: clipColorCss(item.clip) ?? "none",
    "--media-transform":
      `translate(${offsetX}px, ${offsetY}px) ` +
      `rotate(${transform.rotation}deg) scale(${transform.scale})`,
    "--media-radius": effect.borderRadius ?? "0px",
    "--media-shadow": effect.boxShadow ?? "none",
  };
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
  const mutate = (doc: Project): Project =>
    patchClipTransform(doc, clipId, patch, playback.playhead);
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
  if (isClipLocked(item.clip.id)) {
    toast(i18n.t("timeline.locked"), "error");
    return;
  }

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
  if (isClipLocked(geometry.item.clip.id)) {
    toast(i18n.t("timeline.locked"), "error");
    return;
  }

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
  if (isClipLocked(geometry.item.clip.id)) {
    toast(i18n.t("timeline.locked"), "error");
    return;
  }

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
// 右键菜单
// ---------------------------------------------------------------------------

/**
 * 预览画面里的元素右键菜单直接复用时间线那套（AI 智能 / 编辑 / 音频 / 画面 …），
 * 目标模型也一致：`clip` 按片段类型裁剪，空白画面用 `lane` 的「从无到有」生成组。
 * 两份菜单内容必须来自同一个构建器，避免预览和时间线出现两套行为。
 */
const menus = useTimelineMenus();
const previewMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

function openPreviewMenu(event: MouseEvent, item: VisualItem | null): void {
  event.preventDefault();
  event.stopPropagation();

  if (item) {
    // 多选中的片段保持整组选中，右键单点才收缩。
    if (!selection.isSelected(item.clip.id)) selection.select(item.clip.id);
    selection.setActiveTrack(item.trackId);
  }

  const items = item
    ? menus.build({ kind: "clip", clipId: item.clip.id })
    : menus.build({
        kind: "lane",
        trackId: null,
        index: project.doc.tracks.length,
        time: playback.playhead,
      });
  if (items.length === 0) return;
  previewMenu.value = { x: event.clientX, y: event.clientY, items };
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
  if (next) series.resetRun();
  playback.playing = next;
  // 在用户手势内直接驱动引擎，确保 WebView 的自动播放策略不会拦截音频。
  if (next) engine?.play();
  else engine?.pause();
}

function chooseSeriesOption(edgeId: string): void {
  if (!series.choose(edgeId)) return;
  engine?.seek(0);
  engine?.sync();
  engine?.play();
  playback.playing = true;
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
    data-tour="preview"
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
          @contextmenu.prevent.self="openPreviewMenu($event, null)"
        >
          <!-- 引擎把 <video>/<audio> 挂在这里 -->
          <div ref="mediaLayer" class="media-layer" :style="videoLayerStyle" />

          <img
            v-for="item in imageItems"
            :key="item.clip.id"
            class="overlay-image"
            :src="imageSource(item)"
            :style="imageStyle(item)"
            alt=""
            draggable="false"
            @pointerdown="onElementPointerDown(item, $event)"
            @contextmenu.prevent.stop="openPreviewMenu($event, item)"
          />

          <div
            v-for="item in textItems"
            :key="item.clip.id"
            :ref="(el) => setTextEl(item.clip.id, el)"
            class="overlay-text"
            :style="textStyle(item)"
            :data-text="item.clip.text"
            :data-stroke="hasTextStroke(item) ? '' : null"
            @pointerdown="onElementPointerDown(item, $event)"
            @contextmenu.prevent.stop="openPreviewMenu($event, item)"
          >
            {{ item.clip.text }}
          </div>

          <div
            v-if="videoItem"
            class="video-hit"
            :style="videoHitStyle ?? undefined"
            @pointerdown="onElementPointerDown(videoItem, $event)"
            @contextmenu.prevent.stop="openPreviewMenu($event, videoItem)"
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

          <img
            v-if="transitionPreviewUrl"
            class="effect-overlay ofx-transition-overlay"
            :style="{ zIndex: transitionPreviewLayer }"
            :src="transitionPreviewUrl"
            alt=""
            draggable="false"
          />

          <div v-if="projectIsEmpty && !onboarding.coachDismissed" class="black-frame">
            <div class="empty-coach">
              <button
                class="coach-close"
                :aria-label="i18n.t('onboarding.later')"
                @click="onboarding.dismissCoach()"
              >
                <XMarkIcon class="w-[15px] h-[15px]" />
              </button>
              <svg class="coach-art" viewBox="0 0 180 90" aria-hidden="true" focusable="false">
                <rect
                  x="10"
                  y="20"
                  width="160"
                  height="52"
                  rx="12"
                  fill="none"
                  stroke="rgba(255,255,255,0.28)"
                  stroke-width="1.5"
                  stroke-dasharray="7 6"
                />
                <g fill="rgba(255,255,255,0.2)">
                  <rect x="30" y="42" width="3" height="24" rx="1.5" />
                  <rect x="43" y="49" width="3" height="20" rx="1.5" />
                  <rect x="56" y="38" width="3" height="28" rx="1.5" />
                  <rect x="69" y="46" width="3" height="22" rx="1.5" />
                  <rect x="82" y="52" width="3" height="18" rx="1.5" />
                  <rect x="95" y="40" width="3" height="26" rx="1.5" />
                  <rect x="108" y="48" width="3" height="20" rx="1.5" />
                  <rect x="121" y="36" width="3" height="30" rx="1.5" />
                  <rect x="134" y="46" width="3" height="22" rx="1.5" />
                  <rect x="147" y="50" width="3" height="18" rx="1.5" />
                </g>
                <circle cx="90" cy="46" r="16" fill="rgba(255,255,255,0.12)" />
                <path d="M85 39l13 7-13 7z" fill="rgba(255,255,255,0.75)" />
              </svg>
              <p class="coach-title">{{ i18n.t("preview.emptyTitle") }}</p>
              <p class="coach-sub">{{ i18n.t("preview.emptySub") }}</p>
              <div class="coach-actions">
                <button
                  class="coach-primary"
                  :disabled="importing"
                  @click="importMedia({ insertToTimeline: true })"
                >
                  {{ importing ? i18n.t("media.importing") : i18n.t("media.importAndPlace") }}
                </button>
                <button class="coach-ghost" @click="layout.openTab('ai')">
                  {{ i18n.t("preview.emptyAi") }}
                </button>
              </div>
              <p class="coach-note">{{ i18n.t("preview.emptyNote") }}</p>
            </div>
          </div>

          <SeriesChoices
            v-if="seriesPending"
            :options="seriesPending.options"
            :scale="choiceScale"
            @choose="chooseSeriesOption"
          />
        </div>

      </div>
    </div>

    <!--
      选择框 / 吸附线画在视口外面：片段放大或移出画面时，角点仍然抓得到，
      不会被 .stage-viewport 的 overflow 裁掉（裁掉就等于「无法缩放」）。
    -->
    <div class="selection-overlay">
      <svg
        v-if="selectionGeometry"
        class="selection-layer"
        :viewBox="selectionBox.viewBox"
        :width="selectionBox.width"
        :height="selectionBox.height"
        :style="selectionLayerStyle"
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

    <footer class="transport">
      <div class="transport-left">
        <div class="tc-block">
          <span class="tc-now tabular">{{ nowLabel }}</span>
          <span class="tc-total tabular">/ {{ totalLabel }}</span>
        </div>

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
      </div>

      <div class="transport-center">
        <button
          class="play-btn"
          :class="{ playing: playback.playing }"
          :aria-label="playback.playing ? i18n.t('preview.pause') : i18n.t('preview.play')"
          @click="togglePlay"
        >
          <PauseIcon v-if="playback.playing" class="w-[19px] h-[19px]" />
          <PlayIcon v-else class="w-[19px] h-[19px]" />
        </button>
      </div>

      <div class="transport-right">
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

        <Md3Select
          class="footer-select play-mode-select"
          compact
          :model-value="layout.seriesPlayMode"
          :options="PLAY_MODES"
          :label="i18n.t('preview.playMode')"
          @update:model-value="setPlayMode"
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

    <ContextMenu
      :open="previewMenu !== null"
      :x="previewMenu?.x ?? 0"
      :y="previewMenu?.y ?? 0"
      :items="previewMenu?.items ?? []"
      @close="previewMenu = null"
    />
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
  pointer-events: none;
  overflow: hidden;
}
/* 引擎注入的元素铺满画面。
   transform / 圆角 / 描边阴影作用在 <video> 自身上而不是外层容器：视频在 WebKit 里是
   独立合成层，改祖先的 transform 时暂停帧不会跟着重绘（选择框动了、画面不动）。 */
.media-layer :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  transform: var(--media-transform, none);
  transform-origin: center;
  border-radius: var(--media-radius, 0px);
  box-shadow: var(--media-shadow, none);
  will-change: transform;
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
/* 外描边层：只画轮廓、不画填充，由实质文字盖住内侧的一半。
   放在 z-index:-1 让它落在文字的填充色下面（父级有 transform，已经是层叠上下文）。 */
.overlay-text[data-stroke]::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  padding: inherit;
  z-index: -1;
  color: transparent;
  -webkit-text-stroke: var(--text-stroke);
  text-shadow: none;
  pointer-events: none;
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

/* 转场输出已经是整帧合成结果，不再按单个片段变换。 */
.ofx-transition-overlay {
  object-fit: contain;
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
  padding: 16px;
  color: rgb(255 255 255 / 0.42);
  font-size: 12px;
  pointer-events: none;
  background:
    radial-gradient(120% 90% at 50% 0%, rgb(103 80 164 / 0.22), transparent 65%),
    #000;
}
.empty-coach {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 360px;
  text-align: center;
  pointer-events: auto;
  animation: m3-rise var(--md-duration-medium-2) var(--md-ease-emphasized-decel) both;
}
.coach-close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.1);
  color: rgb(255 255 255 / 0.75);
  cursor: pointer;
}
.coach-close:hover {
  background: rgb(255 255 255 / 0.18);
  color: #fff;
}
.coach-art {
  width: min(208px, 66%);
  height: auto;
  margin-bottom: 6px;
  opacity: 0.9;
}
.coach-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.1px;
  color: rgb(255 255 255 / 0.94);
}
.coach-sub {
  margin: 5px 0 14px;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgb(255 255 255 / 0.62);
}
.coach-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.coach-primary,
.coach-ghost {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform var(--md-duration-short-2) var(--md-ease-standard),
    filter var(--md-duration-short-2) var(--md-ease-standard),
    background-color var(--md-duration-short-2) var(--md-ease-standard);
}
.coach-primary {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  box-shadow: 0 2px 12px -3px rgb(var(--md-primary) / 0.7);
}
.coach-primary:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.coach-primary:disabled {
  opacity: 0.55;
  cursor: default;
}
.coach-ghost {
  background-color: rgb(255 255 255 / 0.12);
  color: rgb(255 255 255 / 0.9);
}
.coach-ghost:hover {
  background-color: rgb(255 255 255 / 0.18);
}
.coach-primary:active,
.coach-ghost:active {
  transform: scale(0.97);
}
.coach-primary:focus-visible,
.coach-ghost:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.coach-note {
  margin: 12px 0 0;
  font-size: 10.5px;
  color: rgb(255 255 255 / 0.42);
}

/* ---- 选择框 ---- */
/* 选择框浮层：铺满整个预览区（含顶部小工具条 / 走带条），本身不吃事件。
   铺满而不是只盖住视口，是因为 WebKit 只对浮层盒子内的元素做命中测试：
   只盖视口时，被拖到画面外的角点就点不到，等于「无法缩放」。 */
.selection-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}
.selection-layer {
  position: absolute;
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
.transport-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
  border: 0;
  border-radius: 20px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition:
    border-radius var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    box-shadow var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.play-btn.playing {
  padding-left: 0;
  border-radius: 12px;
}
.play-btn:hover {
  box-shadow: 0 4px 14px rgb(var(--md-primary) / 0.35);
  transform: scale(1.04);
}
.play-btn:active {
  border-radius: 10px;
  transform: scale(0.92);
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
    "left play"
    "right right";
  height: auto;
  row-gap: 2px;
  padding: 0 12px 8px;
}
.preview.portrait .transport-left {
  grid-area: left;
  gap: 6px;
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
/* 三个下拉都按内容宽度收口（不再给画质 / 比例留固定宽度），左右留白一致。 */

@media (prefers-reduced-motion: reduce) {
  .play-btn {
    transition: none;
  }
  .play-btn:active {
    transform: none;
  }
}
</style>
