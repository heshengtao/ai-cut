<script setup lang="ts">
/** 检查器面板：显示选中片段的真实属性，并把不透明度/音量/文字写回文档。 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3Icon,
  EllipsisHorizontalIcon,
  FilmIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import {
  addAsset,
  relinkAsset,
  setClipBlendMode,
  setClipColor,
  setClipCornerRadius,
  setClipFadeIn,
  setClipFadeOut,
  setClipGain,
  setClipKeyframes,
  setClipMuted,
  setClipOpacity,
  setClipPan,
  setClipPitch,
  setClipShadow,
  setClipSpeed,
  setClipStroke,
  setClipText,
  setClipTextStyle,
  setClipTransform,
  setClipTransition,
} from "@/core/ops";
import { fileUrl, importAssetAt, pickMediaFiles } from "@/core/media";
import {
  LOUDNESS_TARGETS,
  applyProcessedAudio,
  extractClipAudio,
  loudnessGain,
  type LoudnessTarget,
} from "@/core/audioEdit";
import type { AudioDspPreset } from "@/types/models";
import type { VideoDspOptions, VideoStrength } from "@/types/video";
import { replaceClipVideo } from "@/core/videoEdit";
import { formatTimecode } from "@/core/time";
import {
  DEFAULT_CLIP_COLOR,
  resolveClipColor,
  type ResolvedClipColor,
} from "@/core/clipColor";
import {
  applyClipAttributes,
  copyClipAttributes,
  resetClipAttributes,
  type ClipAttributes,
} from "@/core/clipAttributes";
import {
  DEFAULT_OFX_TRANSITION_DURATION,
  DEFAULT_TRANSITION_DURATION,
  MAX_OFX_TRANSITION_DURATION,
} from "@/core/clipTransition";
import { defaultEffectParams, isTransitionPlugin } from "@/core/effects";
import type { OfxPluginInfo } from "@/types/plugins";
import {
  keyframeAt,
  keyframeValuesAt,
  opacityAt,
  resolveTransformAt,
  upsertKeyframe,
} from "@/core/keyframes";
import { usePlaybackStore } from "@/stores/playback";
import {
  BLEND_MODES,
  FONT_FAMILIES,
  TEXT_ALIGNS,
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
} from "@/core/clipStyle";
import type {
  BlendMode,
  Clip,
  ClipShadow,
  ClipStroke,
  ClipTextStyle,
  ClipTransform,
  ClipTransition,
  Keyframe,
  MediaAsset,
  Project,
  TextAlign,
} from "@/types/project";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useTextPresetsStore } from "@/stores/textPresets";
import { useAudioAiStore } from "@/stores/audioAi";
import { useVideoDspStore } from "@/stores/videoDsp";
import { useOfxStore } from "@/stores/ofx";
import { usePluginsStore } from "@/stores/plugins";
import { useLayoutStore } from "@/stores/layout";
import { useTimelineActions } from "@/composables/useTimelineActions";
import { toast } from "@/composables/useToast";
import NumberField from "@/components/common/NumberField.vue";
import EffectsSection from "@/components/workspace/panes/EffectsSection.vue";
import ColorField from "@/components/common/ColorField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import ProjectDialog from "@/components/common/ProjectDialog.vue";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const playback = usePlaybackStore();
const selection = useSelectionStore();
const textPresets = useTextPresetsStore();
const audioAi = useAudioAiStore();
const videoDsp = useVideoDspStore();
const ofx = useOfxStore();
const plugins = usePluginsStore();
const layout = useLayoutStore();
const i18n = useI18n();
const timelineActions = useTimelineActions();

/** 标题栏「更多」菜单：Teleport 到 body，避免被右侧面板裁切。 */
const moreOpen = ref(false);
const moreButtonEl = ref<HTMLElement | null>(null);
const moreMenuEl = ref<HTMLElement | null>(null);
const moreMenuStyle = ref<Record<string, string>>({});
const attrClipboard = ref<ClipAttributes | null>(null);

function placeMoreMenu(): void {
  const el = moreButtonEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 188;
  moreMenuStyle.value = {
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: `${rect.bottom + 6}px`,
    width: `${width}px`,
  };
}

function toggleMore(): void {
  moreOpen.value = !moreOpen.value;
  if (moreOpen.value) void nextTick(placeMoreMenu);
}

function closeMore(): void {
  moreOpen.value = false;
}

/** 点菜单项先收起菜单，再执行动作（动作可能打开对话框）。 */
function runMore(action: () => void): void {
  closeMore();
  action();
}

function onMorePointer(event: PointerEvent): void {
  if (!moreOpen.value) return;
  const target = event.target as Node;
  if (moreButtonEl.value?.contains(target) || moreMenuEl.value?.contains(target)) return;
  closeMore();
}

function onMoreKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && moreOpen.value) {
    event.stopPropagation();
    closeMore();
  }
}

function onMoreViewportChange(): void {
  if (moreOpen.value) placeMoreMenu();
}

onMounted(() => {
  window.addEventListener("pointerdown", onMorePointer, true);
  window.addEventListener("keydown", onMoreKey);
  window.addEventListener("resize", onMoreViewportChange);
  window.addEventListener("scroll", onMoreViewportChange, true);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", onMorePointer, true);
  window.removeEventListener("keydown", onMoreKey);
  window.removeEventListener("resize", onMoreViewportChange);
  window.removeEventListener("scroll", onMoreViewportChange, true);
});

function copyAttributes(): void {
  const target = clip.value;
  if (!target) return;
  attrClipboard.value = copyClipAttributes(target);
  toast(i18n.t("inspector.attributesCopied"));
}

function pasteAttributes(): void {
  const attrs = attrClipboard.value;
  if (!attrs) return;
  applySelected((doc, target) => applyClipAttributes(doc, target.id, attrs));
  toast(i18n.t("inspector.attributesPasted"));
}

function resetAttributes(): void {
  applySelected((doc, target) => resetClipAttributes(doc, target.id));
  toast(i18n.t("inspector.attributesReset"));
}

function deleteSelectedClips(): void {
  timelineActions.deleteSelected();
}

const selectedClips = computed<Clip[]>(() => {
  const ids = new Set(selection.selectedClipIds);
  if (ids.size === 0) return [];
  const found: Clip[] = [];
  for (const track of project.doc.tracks) {
    for (const item of track.clips) {
      if (ids.has(item.id)) found.push(item);
    }
  }
  return found;
});
const clip = computed(() => selectedClips.value[0] ?? null);
const selectedCount = computed(() => selectedClips.value.length);

const asset = computed(() =>
  clip.value && clip.value.assetId !== ""
    ? project.doc.assets.find((a) => a.id === clip.value!.assetId)
    : undefined,
);

const isText = computed(() => clip.value?.assetId === "");
const isAudio = computed(
  () => asset.value?.kind === "audio" || clip.value?.audioOnly === true,
);
/** 画面类片段（文字 / 图片 / 视频 / 缺失素材）才显示变换与视觉特效。 */
const isVisual = computed(() => isText.value || !isAudio.value);
/** 只有真实视频片段才显示视频处理（纯音频片段、图片、文字都不显示）。 */
const isVideo = computed(
  () =>
    asset.value?.kind === "video" &&
    !asset.value.offline &&
    clip.value?.audioOnly !== true &&
    (clip.value?.duration ?? 0) > 0,
);
const keyframeLocalTime = computed(() =>
  clip.value
    ? Math.max(0, Math.min(clip.value.duration, playback.playhead - clip.value.start))
    : 0,
);
const opacityPercent = computed(() =>
  clip.value
    ? Math.round(opacityAt(clip.value, keyframeLocalTime.value) * 100)
    : 100,
);
const speed = computed(() => clip.value?.speed ?? 1);
const color = computed<ResolvedClipColor>(() =>
  clip.value ? resolveClipColor(clip.value) : DEFAULT_CLIP_COLOR,
);
const transitionIn = computed(() => clip.value?.transitionIn ?? null);
const transitionOut = computed(() => clip.value?.transitionOut ?? null);
const clipKeyframes = computed(() =>
  (clip.value?.keyframes ?? []).slice().sort((a, b) => a.time - b.time),
);
const keyframeHere = computed(() =>
  keyframeAt(clip.value?.keyframes, keyframeLocalTime.value) !== undefined,
);
const transform = computed(() =>
  clip.value ? resolveTransformAt(clip.value, keyframeLocalTime.value) : null,
);
const scalePercent = computed(() => Math.round((transform.value?.scale ?? 1) * 100));

const textStyle = computed(() => (clip.value ? resolveTextStyle(clip.value) : null));
const stroke = computed(() => (clip.value ? resolveStroke(clip.value) : null));
const shadow = computed(() => (clip.value ? resolveShadow(clip.value) : null));
const blendMode = computed(() => (clip.value ? resolveBlendMode(clip.value) : "normal"));
const cornerRadius = computed(() =>
  clip.value ? resolveCornerRadius(clip.value) : 0,
);

/** 音频相关参数（旧工程缺省为 0）。 */
const fadeIn = computed(() => clip.value?.fadeIn ?? 0);
const fadeOut = computed(() => clip.value?.fadeOut ?? 0);
const pitch = computed(() => clip.value?.pitch ?? 0);
const panPercent = computed(() => Math.round((clip.value?.pan ?? 0) * 100));
const clipMuted = computed(() => clip.value?.muted ?? false);

/** 当前片段是否真的有音轨可处理（音频素材，或带音轨的视频）。 */
const hasAudio = computed(() => {
  const current = asset.value;
  if (!current || current.offline) return false;
  return (
    current.kind === "audio" ||
    (current.kind === "video" && current.hasAudio !== false)
  );
});

// ---- 检查器里的无模型音频处理 ----

const loudnessTarget = ref<LoudnessTarget>("streaming");
const loudnessInfo = ref<string | null>(null);
const loudnessRunning = ref(false);
const denoisePreset = ref<AudioDspPreset>("medium");
const beautifyPreset = ref<AudioDspPreset>("natural");

watch(
  () => clip.value?.id,
  () => {
    loudnessInfo.value = null;
  },
);

const loudnessOptions = computed<SelectOption[]>(() => [
  { id: "streaming", label: i18n.t("audio.loudness.streaming") },
  { id: "podcast", label: i18n.t("audio.loudness.podcast") },
  { id: "broadcast", label: i18n.t("audio.loudness.broadcast") },
]);

const denoiseOptions = computed<SelectOption[]>(() => [
  { id: "light", label: i18n.t("audio.denoise.light") },
  { id: "medium", label: i18n.t("audio.denoise.medium") },
  { id: "strong", label: i18n.t("audio.denoise.strong") },
]);

const beautifyOptions = computed<SelectOption[]>(() => [
  { id: "natural", label: i18n.t("audio.beautify.natural") },
  { id: "bright", label: i18n.t("audio.beautify.bright") },
  { id: "warm", label: i18n.t("audio.beautify.warm") },
]);

function assetOfClip(current: Clip): MediaAsset | null {
  return project.doc.assets.find((candidate) => candidate.id === current.assetId) ?? null;
}

function processableAudio(
  current: Clip,
  currentAsset: MediaAsset | null,
): currentAsset is MediaAsset {
  if (!currentAsset || currentAsset.offline || current.duration <= 0) return false;
  return (
    currentAsset.kind === "audio" ||
    (currentAsset.kind === "video" && currentAsset.hasAudio !== false)
  );
}

function audioTarget(): { clip: Clip; asset: MediaAsset } | null {
  const current = clip.value;
  if (!current) return null;
  const currentAsset = asset.value ?? null;
  if (!processableAudio(current, currentAsset)) return null;
  return { clip: current, asset: currentAsset };
}

/** 收集要统一响度的片段：当前选择，或整个工程里的音频 / 带音轨视频。 */
function collectLoudnessTargets(
  scope: "selection" | "all",
): { clip: Clip; asset: MediaAsset }[] {
  const targets: { clip: Clip; asset: MediaAsset }[] = [];
  const seen = new Set<string>();
  const selected = new Set(selection.selectedClipIds);

  for (const track of project.doc.tracks) {
    // 「全部音频」不碰已静音的轨道；用户明确选中的片段仍然处理。
    if (scope === "all" && track.muted) continue;
    for (const current of track.clips) {
      if (seen.has(current.id)) continue;
      if (scope === "selection" && !selected.has(current.id)) continue;
      const currentAsset = assetOfClip(current);
      if (!processableAudio(current, currentAsset)) continue;
      seen.add(current.id);
      targets.push({ clip: current, asset: currentAsset });
    }
  }
  return targets;
}

const selectedAudioCount = computed(
  () => collectLoudnessTargets("selection").length,
);

function handleAudioError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("已取消")) {
    toast(i18n.t("audio.cancelled"));
    return;
  }
  toast(message, "error");
}

function onLoudnessTarget(value: string): void {
  loudnessTarget.value = value as LoudnessTarget;
}

function onDenoisePreset(value: string): void {
  denoisePreset.value = value as AudioDspPreset;
}

function onBeautifyPreset(value: string): void {
  beautifyPreset.value = value as AudioDspPreset;
}

/**
 * 统一响度：默认处理当前选中的全部片段，也可以处理整个工程。
 *
 * 每个片段量一次积分响度，算出的增益在**一个事务**里写回，撤销一次即可全部回退。
 */
async function normalizeLoudness(scope: "selection" | "all" = "selection"): Promise<void> {
  if (loudnessRunning.value) return;
  const targets = collectLoudnessTargets(scope);
  if (targets.length === 0) {
    toast(i18n.t("audio.noTargets"), "error");
    return;
  }

  loudnessRunning.value = true;
  try {
    const gains: { clipId: string; gain: number }[] = [];
    let skipped = 0;
    let lastError: string | null = null;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      loudnessInfo.value = i18n.t("audio.loudnessProgress", {
        index: index + 1,
        total: targets.length,
      });
      try {
        const report = await audioAi.loudness(
          target.asset.src,
          target.clip.in ?? 0,
          target.clip.duration,
        );
        const gain = loudnessGain(report, LOUDNESS_TARGETS[loudnessTarget.value]);
        if (gain === null) {
          skipped += 1;
          continue;
        }
        gains.push({ clipId: target.clip.id, gain });
      } catch (error) {
        skipped += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (gains.length === 0) {
      loudnessInfo.value = null;
      toast(lastError ?? i18n.t("audio.noSignal"), "error");
      return;
    }

    project.dispatch(
      (doc) => {
        let next = doc;
        for (const item of gains) next = setClipGain(next, item.clipId, item.gain);
        return next;
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("audio.loudness") },
    );
    loudnessInfo.value = i18n.t("audio.loudnessBatchDone", {
      count: gains.length,
    });
    toast(
      skipped > 0
        ? i18n.t("audio.loudnessBatchPartial", {
            count: gains.length,
            skipped,
          })
        : loudnessInfo.value,
    );
  } finally {
    loudnessRunning.value = false;
  }
}

async function applyDsp(
  effect: "denoise" | "beautify",
  preset: AudioDspPreset,
): Promise<void> {
  const target = audioTarget();
  if (!target) return;
  try {
    const result = await audioAi.dsp(
      target.asset.src,
      target.clip.in ?? 0,
      target.clip.duration,
      effect,
      preset,
    );
    const generated = await importAssetAt(result.path);
    project.dispatch(
      (doc) => {
        const withAsset = addAsset(doc, generated);
        return applyProcessedAudio(
          withAsset,
          target.clip,
          generated.id,
          result.duration,
          target.asset.kind,
          i18n.t(`audio.${effect}Track`),
        );
      },
      {
        kind: "ui.dispatch",
        actor: "human",
        label: i18n.t(`audio.${effect}`),
      },
    );
    toast(
      i18n.t(effect === "denoise" ? "audio.denoiseDone" : "audio.beautifyDone"),
    );
  } catch (error) {
    handleAudioError(error);
  }
}

/** 视频片段：把画面和声音快速拆成两条轨道。 */
function separateAudio(): void {
  const target = clip.value;
  const current = asset.value;
  if (!target || !current || current.kind !== "video" || !hasAudio.value) return;

  const holder: { result: ReturnType<typeof extractClipAudio> | null } = { result: null };
  project.dispatch(
    (doc) => {
      holder.result = extractClipAudio(doc, target, i18n.t("inspector.extractAudioTrack"));
      return holder.result.doc;
    },
    {
      kind: "ui.dispatch",
      actor: "human",
      label: i18n.t("inspector.extractAudio"),
    },
  );

  if (!holder.result?.clipId) return;
  selection.select(holder.result.clipId);
  selection.setActiveTrack(holder.result.trackId);
  toast(i18n.t("inspector.extractAudioDone"));
}

// ---- 检查器里的无模型视频处理 ----

const videoStabilize = ref<"off" | VideoStrength>("off");
const videoDenoise = ref<"off" | VideoStrength>("off");
const videoDeflicker = ref<"off" | VideoStrength>("off");
const videoMotionBlur = ref<"off" | VideoStrength>("off");
const videoUpscale = ref<"off" | "1.5" | "2">("off");

/** 运动模糊强度 → 帧混合程度。 */
const MOTION_BLUR_AMOUNT: Record<VideoStrength, number> = {
  light: 0.3,
  medium: 0.6,
  strong: 0.9,
};

const videoStrengthOptions = computed<SelectOption[]>(() => [
  { id: "off", label: i18n.t("video.off") },
  { id: "light", label: i18n.t("video.light") },
  { id: "medium", label: i18n.t("video.medium") },
  { id: "strong", label: i18n.t("video.strong") },
]);

const videoUpscaleOptions = computed<SelectOption[]>(() => [
  { id: "off", label: i18n.t("video.off") },
  { id: "1.5", label: i18n.t("video.upscale.1_5") },
  { id: "2", label: i18n.t("video.upscale.2") },
]);

function onVideoStabilize(value: string): void {
  videoStabilize.value = value as "off" | VideoStrength;
}

function onVideoDenoise(value: string): void {
  videoDenoise.value = value as "off" | VideoStrength;
}

function onVideoDeflicker(value: string): void {
  videoDeflicker.value = value as "off" | VideoStrength;
}

function onVideoMotionBlur(value: string): void {
  videoMotionBlur.value = value as "off" | VideoStrength;
}

function onVideoUpscale(value: string): void {
  videoUpscale.value = value as "off" | "1.5" | "2";
}

/** 只把非关闭的处理项交给后端，关闭项完全不出现在滤镜链里。 */
function buildVideoOptions(): VideoDspOptions {
  const options: VideoDspOptions = {};
  if (videoStabilize.value !== "off") options.stabilize = videoStabilize.value;
  if (videoDenoise.value !== "off") options.denoise = videoDenoise.value;
  if (videoDeflicker.value !== "off") options.deflicker = videoDeflicker.value;
  if (videoMotionBlur.value !== "off") {
    options.motionBlur = MOTION_BLUR_AMOUNT[videoMotionBlur.value];
  }
  if (videoUpscale.value !== "off") options.upscale = Number(videoUpscale.value);
  return options;
}

function videoTarget(): { clip: Clip; asset: MediaAsset } | null {
  const current = clip.value;
  const currentAsset = asset.value ?? null;
  if (!current || !currentAsset || !isVideo.value) return null;
  return { clip: current, asset: currentAsset };
}

async function applyVideoDsp(): Promise<void> {
  if (videoDsp.running) return;
  const target = videoTarget();
  if (!target) {
    toast(i18n.t("video.selectClip"), "error");
    return;
  }
  const options = buildVideoOptions();
  if (Object.keys(options).length === 0) {
    toast(i18n.t("video.noEffects"), "error");
    return;
  }

  try {
    const result = await videoDsp.process(
      target.asset.src,
      target.clip.in ?? 0,
      target.clip.duration,
      target.asset.fps ?? project.doc.fps,
      options,
    );
    const generated = await importAssetAt(result.path);
    project.dispatch(
      (doc) => {
        const withAsset = addAsset(doc, generated);
        return replaceClipVideo(
          withAsset,
          target.clip.id,
          generated.id,
          result.duration,
          target.clip.duration,
        );
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("video.apply") },
    );
    toast(i18n.t("video.done"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("已取消")) toast(i18n.t("video.cancelled"));
    else toast(message, "error");
  }
}

/** 保存文字预设的命名对话框。 */
const presetDialogOpen = ref(false);
const presetInitialName = computed(() => {
  const text = clip.value?.text?.trim() ?? "";
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
});

const fontOptions = computed<SelectOption[]>(() =>
  FONT_FAMILIES.map((font) => ({ id: font.id, label: i18n.t(font.labelKey) })),
);

const blendOptions = computed<SelectOption[]>(() =>
  BLEND_MODES.map((mode) => ({
    id: mode,
    label: i18n.t(`blend.${mode}`),
  })),
);

const ALIGN_ICONS: Record<TextAlign, unknown> = {
  left: Bars3BottomLeftIcon,
  center: Bars3Icon,
  right: Bars3BottomRightIcon,
};

/** 把属性写入所有选中片段：一次手势 = 一个撤销步。 */
function applySelected(
  mutate: (doc: Project, target: Clip) => Project,
  coalesceKey?: string,
): void {
  const targets = selectedClips.value;
  if (targets.length === 0) return;
  const apply = (doc: Project) => {
    let next = doc;
    for (const target of targets) next = mutate(next, target);
    return next;
  };
  if (coalesceKey) {
    project.dispatchCoalesced(
      apply,
      `${coalesceKey}:${targets.map((target) => target.id).join(",")}`,
    );
  } else {
    project.dispatch(apply);
  }
}

/** 片段内相对时间：关键帧统一以片段起点为 0。 */
function localTimeOf(target: Clip): number {
  return Math.max(0, Math.min(target.duration, playback.playhead - target.start));
}

/** 有关键帧时修改参数 = 在当前时间写入/更新关键帧；否则改静态值。 */
function onOpacityInput(value: number): void {
  applySelected((doc, target) => {
    if (!target.keyframes?.length) {
      return setClipOpacity(doc, target.id, value / 100);
    }
    return setClipKeyframes(
      doc,
      target.id,
      upsertKeyframe(target, localTimeOf(target), { opacity: value / 100 }),
    );
  });
}

function onSpeedInput(value: number): void {
  applySelected((doc, target) => setClipSpeed(doc, target.id, value));
}

function onColorInput(patch: Partial<ResolvedClipColor>): void {
  applySelected((doc, target) => setClipColor(doc, target.id, patch));
}

const transitionTypeOptions = computed<SelectOption[]>(() => [
  { id: "none", label: i18n.t("transition.none") },
  { id: "fade", label: i18n.t("transition.fade") },
  { id: "slide", label: i18n.t("transition.slide") },
  // OFX 转场需要两侧都有可解码的画面素材；文字片段只保留内置转场。
  ...(isText.value
    ? []
    : [{ id: "ofx", label: i18n.t("transition.ofx") }]),
]);

const transitionDirectionOptions = computed<SelectOption[]>(() => [
  { id: "left", label: i18n.t("transition.left") },
  { id: "right", label: i18n.t("transition.right") },
  { id: "up", label: i18n.t("transition.up") },
  { id: "down", label: i18n.t("transition.down") },
]);

function onTransition(
  edge: "in" | "out",
  patch: Partial<ClipTransition> | null,
): void {
  applySelected((doc, target) => setClipTransition(doc, target.id, edge, patch));
}

function onTransitionType(edge: "in" | "out", value: string): void {
  if (value === "none") {
    ofxPickEdge.value = null;
    onTransition(edge, null);
    return;
  }
  if (value === "fade" || value === "slide") {
    ofxPickEdge.value = null;
    onTransition(edge, { type: value, duration: DEFAULT_TRANSITION_DURATION });
    return;
  }
  if (value === "ofx") void chooseOfxTransition(edge);
}

interface TransitionCandidate {
  bundle: string;
  info: OfxPluginInfo;
}

const transitionCandidates = ref<TransitionCandidate[]>([]);
const transitionCandidatesLoading = ref(false);
/** 刚选择 ofx、但还没挑插件的那一侧。 */
const ofxPickEdge = ref<"in" | "out" | null>(null);

const transitionPluginOptions = computed<SelectOption[]>(() =>
  transitionCandidates.value.map((candidate) => ({
    id: candidate.info.identifier,
    label:
      candidate.info.label ||
      candidate.info.name ||
      candidate.info.identifier,
    hint: candidate.info.grouping,
  })),
);

function transitionOf(edge: "in" | "out"): ClipTransition | null {
  return edge === "in" ? transitionIn.value : transitionOut.value;
}

function transitionPluginId(edge: "in" | "out"): string | null {
  const transition = transitionOf(edge);
  if (transition?.type !== "ofx") return null;
  return transition.effect?.plugin ?? null;
}

let transitionLoadTask: Promise<void> | null = null;

async function loadTransitionCandidates(): Promise<void> {
  if (transitionCandidates.value.length > 0) return;
  if (transitionLoadTask) return transitionLoadTask;
  transitionLoadTask = (async () => {
    transitionCandidatesLoading.value = true;
    try {
      await plugins.loadInstalled();
      const hinted = plugins.installedPlugins.filter((plugin) => {
        if (!plugin.installed_path) return false;
        const typeHint = plugin.plugin_types.some((type) =>
          type.toLowerCase().includes("transition"),
        );
        const contextHint = plugin.contexts.some((context) =>
          context.toLowerCase().includes("transition"),
        );
        return typeHint || contextHint;
      });
      const targets =
        hinted.length > 0
          ? hinted
          : plugins.installedPlugins.filter((plugin) => plugin.installed_path);
      for (const status of targets) {
        if (!status.installed_path) continue;
        try {
          const found = await ofx.probe(
            status.installed_path,
            false,
            "OfxImageEffectContextTransition",
          );
          for (const info of found) {
            if (!isTransitionPlugin(info)) continue;
            transitionCandidates.value.push({
              bundle: status.installed_path,
              info,
            });
          }
        } catch {
          // 单个插件探测失败不影响其它转场插件。
        }
      }
    } finally {
      transitionCandidatesLoading.value = false;
      transitionLoadTask = null;
    }
  })();
  return transitionLoadTask;
}

async function chooseOfxTransition(edge: "in" | "out"): Promise<void> {
  ofxPickEdge.value = edge;
  try {
    await loadTransitionCandidates();
  } catch (error) {
    ofxPickEdge.value = null;
    toast(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (ofxPickEdge.value !== edge) return;
  if (transitionCandidates.value.length === 0) {
    ofxPickEdge.value = null;
    toast(i18n.t("transition.noOfxPlugins"), "error");
    return;
  }
  if (transitionCandidates.value.length === 1) {
    applyOfxTransition(edge, transitionCandidates.value[0]!);
    return;
  }
  ofxPickEdge.value = edge;
}

function applyOfxTransition(
  edge: "in" | "out",
  candidate: TransitionCandidate,
): void {
  const current = transitionOf(edge);
  const effect = {
    id:
      current?.type === "ofx" && current.effect
        ? current.effect.id
        : crypto.randomUUID(),
    plugin: candidate.info.identifier,
    name:
      candidate.info.label ||
      candidate.info.name ||
      candidate.info.identifier,
    bundle: candidate.bundle,
    context: "OfxImageEffectContextTransition",
    params: defaultEffectParams(candidate.info),
    enabled: true,
  };
  onTransition(edge, {
    type: "ofx",
    duration:
      current?.type === "ofx"
        ? current.duration
        : DEFAULT_OFX_TRANSITION_DURATION,
    effect,
  });
  ofxPickEdge.value = null;
}

function onPickOfxPlugin(edge: "in" | "out", identifier: string): void {
  const current = transitionOf(edge);
  if (
    current?.type === "ofx" &&
    current.effect?.plugin === identifier
  ) {
    ofxPickEdge.value = null;
    return;
  }
  const candidate = transitionCandidates.value.find(
    (item) => item.info.identifier === identifier,
  );
  if (candidate) applyOfxTransition(edge, candidate);
}

watch(
  () => clip.value?.id,
  () => {
    ofxPickEdge.value = null;
  },
);

watch(
  [transitionIn, transitionOut],
  () => {
    if (
      transitionIn.value?.type === "ofx" ||
      transitionOut.value?.type === "ofx"
    ) {
      void loadTransitionCandidates().catch((error) => {
        console.warn("OFX transition plugin probe failed", error);
      });
    }
  },
  { immediate: true },
);

function openTransitionParams(edge: "in" | "out"): void {
  const target = clip.value;
  const transition = transitionOf(edge);
  const effect = transition?.effect;
  if (!target || transition?.type !== "ofx" || !effect) return;
  ofx.openTransitionTarget({
    bundle: effect.bundle,
    plugin: effect.plugin,
    name: effect.name,
    clipId: target.id,
    edge,
  });
  layout.openTab("pluginEditor");
}

function onTransitionDirection(edge: "in" | "out", value: string): void {
  if (value === "left" || value === "right" || value === "up" || value === "down") {
    onTransition(edge, { direction: value });
  }
}

/** 一个关键帧同时记录当前时间点上的全部动画参数。 */
function addKeyframe(): void {
  applySelected((doc, target) => {
    const time = localTimeOf(target);
    return setClipKeyframes(
      doc,
      target.id,
      upsertKeyframe(target, time, keyframeValuesAt(target, time)),
    );
  });
}

function removeKeyframe(time: number): void {
  applySelected((doc, target) => {
    const next = (target.keyframes ?? []).filter(
      (frame) => Math.abs(frame.time - time) > 1e-4,
    );
    return setClipKeyframes(doc, target.id, next.length > 0 ? next : null);
  });
}

function seekToKeyframe(time: number): void {
  const target = clip.value;
  if (!target) return;
  playback.setPlayhead(target.start + time);
}

function keyframeSummary(frame: Keyframe): string {
  return (
    `${Math.round(frame.opacity * 100)}% · ` +
    `${frame.x.toFixed(0)},${frame.y.toFixed(0)} · ` +
    `${Math.round(frame.scale * 100)}% · ${Math.round(frame.rotation)}°`
  );
}

function onBlendMode(value: BlendMode | string): void {
  applySelected((doc, target) => setClipBlendMode(doc, target.id, value));
}

function onTextStyle(patch: Partial<ClipTextStyle>, coalesce = false): void {
  applySelected(
    (doc, target) => setClipTextStyle(doc, target.id, patch),
    coalesce ? "text-style" : undefined,
  );
  const primary = clip.value;
  if (primary) textPresets.rememberStyle(resolveTextStyle(primary));
}

function onStroke(patch: Partial<ClipStroke>, coalesce = false): void {
  applySelected(
    (doc, target) => setClipStroke(doc, target.id, patch),
    coalesce ? "stroke" : undefined,
  );
}

function onShadow(patch: Partial<ClipShadow>, coalesce = false): void {
  applySelected(
    (doc, target) => setClipShadow(doc, target.id, patch),
    coalesce ? "shadow" : undefined,
  );
}

function onRadius(value: number): void {
  applySelected((doc, target) => setClipCornerRadius(doc, target.id, value));
}

function onTransformInput(patch: Partial<ClipTransform>): void {
  applySelected((doc, target) => {
    if (!target.keyframes?.length) {
      return setClipTransform(doc, target.id, patch);
    }
    return setClipKeyframes(
      doc,
      target.id,
      upsertKeyframe(target, localTimeOf(target), patch),
    );
  });
}

function onGainInput(value: number): void {
  applySelected((doc, target) => setClipGain(doc, target.id, value));
}

function onFadeInInput(value: number): void {
  applySelected((doc, target) => setClipFadeIn(doc, target.id, value));
}

function onFadeOutInput(value: number): void {
  applySelected((doc, target) => setClipFadeOut(doc, target.id, value));
}

function onPitchInput(value: number): void {
  applySelected((doc, target) => setClipPitch(doc, target.id, value));
}

function onPanInput(value: number): void {
  applySelected((doc, target) => setClipPan(doc, target.id, value / 100));
}

function onMutedInput(value: boolean): void {
  applySelected((doc, target) => setClipMuted(doc, target.id, value));
}

/** 把当前文字片段的样式保存成媒体库预设（只存样式，不存文案与时长）。 */
function saveTextPreset(name: string): void {
  const target = clip.value;
  if (!target) return;
  const preset = textPresets.savePreset({
    name,
    textStyle: resolveTextStyle(target),
  });
  textPresets.rememberStyle(resolveTextStyle(target));
  toast(i18n.t("textPreset.saved", { name: preset.name }));
}

function onTextInput(event: Event): void {
  const target = clip.value;
  if (!target) return;
  const value = (event.target as HTMLTextAreaElement).value;
  project.dispatchCoalesced((doc) => setClipText(doc, target.id, value), `text:${target.id}`);
}

async function relink(): Promise<void> {
  const target = asset.value;
  if (!target) return;
  const picked = await pickMediaFiles();
  if (picked.length === 0) return;
  project.dispatch((doc) => relinkAsset(doc, target.id, picked[0]));
  toast(i18n.t("inspector.relinked"));
}
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">{{ i18n.t("inspector.title") }}</h2>
        <p class="pane-sub">
          {{
            clip
              ? selectedCount > 1
                ? i18n.t("inspector.multiSelected", { count: selectedCount })
                : isText
                  ? i18n.t("inspector.textSelected")
                  : i18n.t("inspector.mediaSelected")
              : i18n.t("inspector.nothingSelected")
          }}
        </p>
      </div>
      <button
        ref="moreButtonEl"
        class="icon-btn"
        :class="{ on: moreOpen }"
        :aria-label="i18n.t('inspector.more')"
        aria-haspopup="menu"
        :aria-expanded="moreOpen"
        @click="toggleMore"
      >
        <EllipsisHorizontalIcon class="w-[18px] h-[18px]" />
      </button>
      <Teleport to="body">
        <transition name="drop">
          <div
            v-if="moreOpen"
            ref="moreMenuEl"
            class="inspector-menu"
            role="menu"
            :aria-label="i18n.t('inspector.more')"
            :style="moreMenuStyle"
          >
            <button
              class="menu-item"
              role="menuitem"
              :disabled="!clip"
              @click="runMore(copyAttributes)"
            >
              {{ i18n.t("inspector.copyAttributes") }}
            </button>
            <button
              class="menu-item"
              role="menuitem"
              :disabled="!clip || !attrClipboard"
              @click="runMore(pasteAttributes)"
            >
              {{ i18n.t("inspector.pasteAttributes") }}
            </button>
            <div class="menu-sep" role="separator" />
            <button
              class="menu-item"
              role="menuitem"
              :disabled="!clip"
              @click="runMore(resetAttributes)"
            >
              {{ i18n.t("inspector.resetAttributes") }}
            </button>
            <button
              class="menu-item danger"
              role="menuitem"
              :disabled="!clip"
              @click="runMore(deleteSelectedClips)"
            >
              {{ i18n.t("inspector.deleteClip") }}
            </button>
          </div>
        </transition>
      </Teleport>
    </header>

    <div class="pane-scroll">
      <p v-if="!clip" class="hint-empty">{{ i18n.t("inspector.emptyHint") }}</p>

      <template v-else>
        <div class="selected">
          <div
            class="selected-thumb"
            :style="asset?.thumb ? { backgroundImage: `url('${fileUrl(asset.thumb)}')` } : undefined"
          >
            <FilmIcon v-if="!asset?.thumb" class="w-4 h-4" />
          </div>
          <div class="selected-text">
            <span class="selected-name">
              {{ isText ? clip.text || i18n.t("inspector.textClip") : (asset?.name ?? i18n.t("inspector.missingAsset")) }}
            </span>
            <span class="selected-meta">
              {{ formatTimecode(clip.duration, project.doc.fps) }}
            </span>
          </div>
        </div>

        <p v-if="asset?.offline" class="offline-row">
          <ExclamationTriangleIcon class="w-4 h-4" />
          {{ i18n.t("inspector.offline") }}
          <button class="btn-text" @click="relink">{{ i18n.t("inspector.relink") }}</button>
        </p>

        <template v-if="isText">
          <div class="section-label">{{ i18n.t("inspector.text") }}</div>
          <textarea
            class="text-input"
            rows="3"
            :value="clip.text ?? ''"
            @input="onTextInput"
            @change="project.endCoalesce()"
          />

          <div class="section-label">{{ i18n.t("inspector.textStyle") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.font") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="textStyle?.fontFamily ?? ''"
                :options="fontOptions"
                :label="i18n.t('inspector.font')"
                @update:model-value="onTextStyle({ fontFamily: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fontSize") }}</span>
              <NumberField
                :model-value="textStyle?.fontSize ?? 48"
                :min="5"
                :max="400"
                :step="1"
                :sr-label="i18n.t('inspector.fontSize')"
                input-width="44px"
                @update:model-value="onTextStyle({ fontSize: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="textStyle?.color ?? '#ffffff'"
                :label="i18n.t('inspector.color')"
                @update:model-value="onTextStyle({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.letterSpacing") }}</span>
              <NumberField
                :model-value="textStyle?.letterSpacing ?? 0"
                :min="-100"
                :max="200"
                :step="0.5"
                :decimals="1"
                :sr-label="i18n.t('inspector.letterSpacing')"
                input-width="44px"
                @update:model-value="onTextStyle({ letterSpacing: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.lineHeight") }}</span>
              <NumberField
                :model-value="textStyle?.lineHeight ?? 1.25"
                :min="0.5"
                :max="4"
                :step="0.05"
                :decimals="2"
                :sr-label="i18n.t('inspector.lineHeight')"
                input-width="44px"
                @update:model-value="onTextStyle({ lineHeight: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.align") }}</span>
              <div class="align-group" role="group" :aria-label="i18n.t('inspector.align')">
                <button
                  v-for="align in TEXT_ALIGNS"
                  :key="align"
                  class="align-btn"
                  :class="{ on: textStyle?.align === align }"
                  type="button"
                  :aria-pressed="textStyle?.align === align"
                  :aria-label="i18n.t(`inspector.align.${align}`)"
                  @click="onTextStyle({ align })"
                >
                  <component :is="ALIGN_ICONS[align]" class="align-icon" />
                </button>
              </div>
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.background") }}</span>
              <ToggleSwitch
                :model-value="textStyle?.backgroundEnabled ?? false"
                :label="i18n.t('inspector.background')"
                @update:model-value="onTextStyle({ backgroundEnabled: $event })"
              />
            </div>
            <template v-if="textStyle?.backgroundEnabled">
              <div class="prop-row">
                <span>{{ i18n.t("inspector.backgroundColor") }}</span>
                <ColorField
                  :model-value="textStyle?.backgroundColor ?? '#000000'"
                  :label="i18n.t('inspector.backgroundColor')"
                  @update:model-value="onTextStyle({ backgroundColor: $event }, true)"
                  @commit="project.endCoalesce()"
                />
              </div>
              <div class="prop-row">
                <span>{{ i18n.t("inspector.backgroundOpacity") }}</span>
                <NumberField
                  :model-value="Math.round((textStyle?.backgroundOpacity ?? 0.65) * 100)"
                  :min="0"
                  :max="100"
                  :step="1"
                  :sr-label="i18n.t('inspector.backgroundOpacity')"
                  input-width="44px"
                  @update:model-value="onTextStyle({ backgroundOpacity: $event / 100 })"
                />
              </div>
            </template>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.glow") }}</span>
              <ToggleSwitch
                :model-value="textStyle?.glowEnabled ?? false"
                :label="i18n.t('inspector.glow')"
                @update:model-value="onTextStyle({ glowEnabled: $event })"
              />
            </div>
            <template v-if="textStyle?.glowEnabled">
              <div class="prop-row">
                <span>{{ i18n.t("inspector.glowColor") }}</span>
                <ColorField
                  :model-value="textStyle?.glowColor ?? '#ffffff'"
                  :label="i18n.t('inspector.glowColor')"
                  @update:model-value="onTextStyle({ glowColor: $event }, true)"
                  @commit="project.endCoalesce()"
                />
              </div>
              <div class="prop-row">
                <span>{{ i18n.t("inspector.glowBlur") }}</span>
                <NumberField
                  :model-value="textStyle?.glowBlur ?? 16"
                  :min="0"
                  :max="200"
                  :step="1"
                  :sr-label="i18n.t('inspector.glowBlur')"
                  input-width="44px"
                  @update:model-value="onTextStyle({ glowBlur: $event })"
                />
              </div>
            </template>
          </div>

          <div class="section-label">{{ i18n.t("inspector.textPreset") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.textPresetHint") }}</span>
              <button class="preset-btn" type="button" @click="presetDialogOpen = true">
                {{ i18n.t("inspector.saveTextPreset") }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="isVisual">
        <div class="section-label">{{ i18n.t("inspector.transform") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.positionX") }}</span>
            <NumberField
              :model-value="transform?.x ?? 0"
              :min="-300"
              :max="300"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.positionX')"
              input-width="44px"
              @update:model-value="onTransformInput({ x: $event })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.positionY") }}</span>
            <NumberField
              :model-value="transform?.y ?? 0"
              :min="-300"
              :max="300"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.positionY')"
              input-width="44px"
              @update:model-value="onTransformInput({ y: $event })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.scale") }}</span>
            <NumberField
              :model-value="scalePercent"
              :min="5"
              :max="500"
              :step="1"
              :sr-label="i18n.t('inspector.scale')"
              input-width="44px"
              @update:model-value="onTransformInput({ scale: $event / 100 })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.rotation") }}</span>
            <NumberField
              :model-value="transform?.rotation ?? 0"
              :min="-360"
              :max="360"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.rotation')"
              input-width="44px"
              @update:model-value="onTransformInput({ rotation: $event })"
            />
          </div>
        </div>

        <template v-if="!isText && asset?.kind !== 'image'">
          <div class="section-label">{{ i18n.t("inspector.timing") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.speed") }}</span>
              <NumberField
                :model-value="speed"
                :min="0.1"
                :max="4"
                :step="0.05"
                :decimals="2"
                :sr-label="i18n.t('inspector.speed')"
                input-width="44px"
                @update:model-value="onSpeedInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.duration") }}</span>
              <span class="prop-value tabular">{{ formatTimecode(clip.duration, project.doc.fps) }}</span>
            </div>
          </div>
        </template>

        <div class="section-label">{{ i18n.t("inspector.compositing") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.opacity") }}</span>
            <NumberField
              :model-value="opacityPercent"
              :min="0"
              :max="100"
              :step="1"
              :sr-label="i18n.t('inspector.opacity')"
              input-width="44px"
              @update:model-value="onOpacityInput"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.blendMode") }}</span>
            <Md3Select
              class="prop-select"
              :model-value="blendMode"
              :options="blendOptions"
              :label="i18n.t('inspector.blendMode')"
              @update:model-value="onBlendMode"
            />
          </div>
        </div>

        <template v-if="isVisual">
          <div class="section-label">{{ i18n.t("inspector.colorGrade") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.brightness") }}</span>
              <NumberField
                :model-value="Math.round(color.brightness * 100)"
                :min="-100"
                :max="100"
                :step="1"
                :sr-label="i18n.t('inspector.brightness')"
                input-width="44px"
                @update:model-value="onColorInput({ brightness: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.contrast") }}</span>
              <NumberField
                :model-value="Math.round(color.contrast * 100)"
                :min="0"
                :max="200"
                :step="1"
                :sr-label="i18n.t('inspector.contrast')"
                input-width="44px"
                @update:model-value="onColorInput({ contrast: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.saturation") }}</span>
              <NumberField
                :model-value="Math.round(color.saturation * 100)"
                :min="0"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.saturation')"
                input-width="44px"
                @update:model-value="onColorInput({ saturation: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.temperature") }}</span>
              <NumberField
                :model-value="Math.round(color.temperature * 100)"
                :min="-100"
                :max="100"
                :step="1"
                :sr-label="i18n.t('inspector.temperature')"
                input-width="44px"
                @update:model-value="onColorInput({ temperature: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.tint") }}</span>
              <NumberField
                :model-value="Math.round(color.tint * 100)"
                :min="-100"
                :max="100"
                :step="1"
                :sr-label="i18n.t('inspector.tint')"
                input-width="44px"
                @update:model-value="onColorInput({ tint: $event / 100 })"
              />
            </div>
            <button
              class="btn-text"
              type="button"
              @click="onColorInput({ ...DEFAULT_CLIP_COLOR })"
            >
              {{ i18n.t("inspector.reset") }}
            </button>
          </div>
        </template>

        <EffectsSection
          v-if="!isText && (asset?.kind === 'video' || asset?.kind === 'image')"
          :clip="clip"
          :clips="selectedClips"
        />

        <template v-if="isVisual">
          <div class="section-label">{{ i18n.t("inspector.transition") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("transition.in") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="ofxPickEdge === 'in' ? 'ofx' : transitionIn?.type ?? 'none'"
                :options="transitionTypeOptions"
                :label="i18n.t('transition.in')"
                @update:model-value="onTransitionType('in', $event)"
              />
            </div>
            <div
              v-if="ofxPickEdge === 'in' && transitionIn?.type !== 'ofx'"
              class="prop-row"
            >
              <span>{{ i18n.t("transition.ofxPlugin") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="null"
                :options="transitionPluginOptions"
                :label="i18n.t('transition.ofxPlugin')"
                :placeholder="
                  transitionCandidatesLoading
                    ? i18n.t('effects.probing')
                    : i18n.t('transition.ofxPlugin')
                "
                @update:model-value="onPickOfxPlugin('in', $event)"
              />
            </div>
            <template v-if="transitionIn">
              <div class="prop-row">
                <span>{{ i18n.t("transition.duration") }}</span>
                <NumberField
                  :model-value="transitionIn.duration"
                  :min="transitionIn.type === 'ofx' ? 0.1 : 0"
                  :max="
                    transitionIn.type === 'ofx'
                      ? MAX_OFX_TRANSITION_DURATION
                      : clip.duration
                  "
                  :step="0.1"
                  :decimals="2"
                  :sr-label="i18n.t('transition.duration')"
                  input-width="44px"
                  @update:model-value="onTransition('in', { duration: $event })"
                />
              </div>
              <div v-if="transitionIn.type === 'ofx'" class="prop-row">
                <span>{{ i18n.t("transition.ofxPlugin") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="transitionPluginId('in')"
                  :options="transitionPluginOptions"
                  :label="i18n.t('transition.ofxPlugin')"
                  @update:model-value="onPickOfxPlugin('in', $event)"
                />
              </div>
              <div v-if="transitionIn.type === 'ofx'" class="prop-row">
                <span>{{ i18n.t("transition.ofxParams") }}</span>
                <button
                  class="btn-text"
                  type="button"
                  @click="openTransitionParams('in')"
                >
                  {{ i18n.t("effects.openParams") }}
                </button>
              </div>
              <div v-if="transitionIn.type === 'slide'" class="prop-row">
                <span>{{ i18n.t("transition.direction") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="transitionIn.direction ?? 'left'"
                  :options="transitionDirectionOptions"
                  :label="i18n.t('transition.direction')"
                  @update:model-value="onTransitionDirection('in', $event)"
                />
              </div>
            </template>

            <div class="prop-row">
              <span>{{ i18n.t("transition.out") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="ofxPickEdge === 'out' ? 'ofx' : transitionOut?.type ?? 'none'"
                :options="transitionTypeOptions"
                :label="i18n.t('transition.out')"
                @update:model-value="onTransitionType('out', $event)"
              />
            </div>
            <div
              v-if="ofxPickEdge === 'out' && transitionOut?.type !== 'ofx'"
              class="prop-row"
            >
              <span>{{ i18n.t("transition.ofxPlugin") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="null"
                :options="transitionPluginOptions"
                :label="i18n.t('transition.ofxPlugin')"
                :placeholder="
                  transitionCandidatesLoading
                    ? i18n.t('effects.probing')
                    : i18n.t('transition.ofxPlugin')
                "
                @update:model-value="onPickOfxPlugin('out', $event)"
              />
            </div>
            <template v-if="transitionOut">
              <div class="prop-row">
                <span>{{ i18n.t("transition.duration") }}</span>
                <NumberField
                  :model-value="transitionOut.duration"
                  :min="transitionOut.type === 'ofx' ? 0.1 : 0"
                  :max="
                    transitionOut.type === 'ofx'
                      ? MAX_OFX_TRANSITION_DURATION
                      : clip.duration
                  "
                  :step="0.1"
                  :decimals="2"
                  :sr-label="i18n.t('transition.duration')"
                  input-width="44px"
                  @update:model-value="onTransition('out', { duration: $event })"
                />
              </div>
              <div v-if="transitionOut.type === 'ofx'" class="prop-row">
                <span>{{ i18n.t("transition.ofxPlugin") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="transitionPluginId('out')"
                  :options="transitionPluginOptions"
                  :label="i18n.t('transition.ofxPlugin')"
                  @update:model-value="onPickOfxPlugin('out', $event)"
                />
              </div>
              <div v-if="transitionOut.type === 'ofx'" class="prop-row">
                <span>{{ i18n.t("transition.ofxParams") }}</span>
                <button
                  class="btn-text"
                  type="button"
                  @click="openTransitionParams('out')"
                >
                  {{ i18n.t("effects.openParams") }}
                </button>
              </div>
              <div v-if="transitionOut.type === 'slide'" class="prop-row">
                <span>{{ i18n.t("transition.direction") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="transitionOut.direction ?? 'left'"
                  :options="transitionDirectionOptions"
                  :label="i18n.t('transition.direction')"
                  @update:model-value="onTransitionDirection('out', $event)"
                />
              </div>
            </template>
          </div>
        </template>

        <template v-if="isVisual">
          <div class="section-label">{{ i18n.t("inspector.keyframes") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("keyframe.time") }}</span>
              <span class="prop-value tabular">{{ keyframeLocalTime.toFixed(2) }}s</span>
            </div>
            <button class="btn-text" type="button" @click="addKeyframe">
              {{ keyframeHere ? i18n.t("keyframe.update") : i18n.t("keyframe.add") }}
            </button>
            <div v-if="clipKeyframes.length === 0" class="keyframe-empty">
              {{ i18n.t("keyframe.empty") }}
            </div>
            <div
              v-for="frame in clipKeyframes"
              :key="frame.time"
              class="keyframe-row"
            >
              <button
                class="keyframe-time tabular"
                type="button"
                :title="i18n.t('keyframe.seek')"
                @click="seekToKeyframe(frame.time)"
              >
                {{ frame.time.toFixed(2) }}s
              </button>
              <span class="keyframe-values tabular">{{ keyframeSummary(frame) }}</span>
              <button
                class="keyframe-remove"
                type="button"
                :aria-label="i18n.t('keyframe.remove')"
                @click="removeKeyframe(frame.time)"
              >
                ×
              </button>
            </div>
          </div>
        </template>

        <div class="section-label">{{ i18n.t("inspector.stroke") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.stroke") }}</span>
            <ToggleSwitch
              :model-value="stroke?.enabled ?? false"
              :label="i18n.t('inspector.stroke')"
              @update:model-value="onStroke({ enabled: $event })"
            />
          </div>
          <template v-if="stroke?.enabled">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="stroke?.color ?? '#000000'"
                :label="i18n.t('inspector.strokeColor')"
                @update:model-value="onStroke({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.strokeWidth") }}</span>
              <NumberField
                :model-value="stroke?.width ?? 4"
                :min="0"
                :max="80"
                :step="1"
                :decimals="1"
                :sr-label="i18n.t('inspector.strokeWidth')"
                input-width="44px"
                @update:model-value="onStroke({ width: $event })"
              />
            </div>
          </template>
        </div>

        <div class="section-label">{{ i18n.t("inspector.shadow") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.shadow") }}</span>
            <ToggleSwitch
              :model-value="shadow?.enabled ?? false"
              :label="i18n.t('inspector.shadow')"
              @update:model-value="onShadow({ enabled: $event })"
            />
          </div>
          <template v-if="shadow?.enabled">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="shadow?.color ?? '#000000'"
                :label="i18n.t('inspector.shadowColor')"
                @update:model-value="onShadow({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.opacity") }}</span>
              <NumberField
                :model-value="Math.round((shadow?.opacity ?? 0.5) * 100)"
                :min="0"
                :max="100"
                :step="1"
                :sr-label="i18n.t('inspector.shadowOpacity')"
                input-width="44px"
                @update:model-value="onShadow({ opacity: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.blur") }}</span>
              <NumberField
                :model-value="shadow?.blur ?? 16"
                :min="0"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.blur')"
                input-width="44px"
                @update:model-value="onShadow({ blur: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.offsetX") }}</span>
              <NumberField
                :model-value="shadow?.offsetX ?? 0"
                :min="-300"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.offsetX')"
                input-width="44px"
                @update:model-value="onShadow({ offsetX: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.offsetY") }}</span>
              <NumberField
                :model-value="shadow?.offsetY ?? 0"
                :min="-300"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.offsetY')"
                input-width="44px"
                @update:model-value="onShadow({ offsetY: $event })"
              />
            </div>
          </template>
        </div>
        </template>

        <template v-if="isVisual && !isText">
          <div class="section-label">{{ i18n.t("inspector.appearance") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.cornerRadius") }}</span>
              <NumberField
                :model-value="cornerRadius"
                :min="0"
                :max="1000"
                :step="1"
                :sr-label="i18n.t('inspector.cornerRadius')"
                input-width="44px"
                @update:model-value="onRadius"
              />
            </div>
          </div>
        </template>

        <template v-if="isVideo">
          <div class="section-label">{{ i18n.t("video.title") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("video.stabilize") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="videoStabilize"
                :options="videoStrengthOptions"
                :label="i18n.t('video.stabilize')"
                :disabled="videoDsp.running"
                @update:model-value="onVideoStabilize"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("video.denoise") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="videoDenoise"
                :options="videoStrengthOptions"
                :label="i18n.t('video.denoise')"
                :disabled="videoDsp.running"
                @update:model-value="onVideoDenoise"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("video.deflicker") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="videoDeflicker"
                :options="videoStrengthOptions"
                :label="i18n.t('video.deflicker')"
                :disabled="videoDsp.running"
                @update:model-value="onVideoDeflicker"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("video.motionBlur") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="videoMotionBlur"
                :options="videoStrengthOptions"
                :label="i18n.t('video.motionBlur')"
                :disabled="videoDsp.running"
                @update:model-value="onVideoMotionBlur"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("video.upscale") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="videoUpscale"
                :options="videoUpscaleOptions"
                :label="i18n.t('video.upscale')"
                :disabled="videoDsp.running"
                @update:model-value="onVideoUpscale"
              />
            </div>
            <div class="prop-row">
              <span class="audio-hint">{{ i18n.t("video.applyHint") }}</span>
              <button
                class="preset-btn"
                type="button"
                :disabled="videoDsp.running"
                @click="applyVideoDsp"
              >
                {{ i18n.t("video.apply") }}
              </button>
            </div>
          </div>
          <p class="audio-note">{{ i18n.t("video.hint") }}</p>

          <div v-if="videoDsp.running" class="audio-progress-row">
            <div class="audio-progress">
              <div
                class="audio-progress-fill"
                :style="{ width: `${videoDsp.progressPct}%` }"
              />
            </div>
            <button class="btn-text" type="button" @click="videoDsp.cancel()">
              {{ i18n.t("video.cancel") }}
            </button>
          </div>
        </template>

        <template v-if="!isText && (isAudio || asset?.kind === 'video' || !asset)">
          <div class="section-label">{{ i18n.t("inspector.audio") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.volume") }}</span>
              <NumberField
                :model-value="clip.gain ?? 0"
                :min="-60"
                :max="12"
                :step="0.5"
                :decimals="1"
                :sr-label="i18n.t('inspector.volume')"
                input-width="44px"
                @update:model-value="onGainInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fadeIn") }}</span>
              <NumberField
                :model-value="fadeIn"
                :min="0"
                :max="clip.duration"
                :step="0.1"
                :decimals="2"
                :sr-label="i18n.t('inspector.fadeIn')"
                input-width="44px"
                @update:model-value="onFadeInInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fadeOut") }}</span>
              <NumberField
                :model-value="fadeOut"
                :min="0"
                :max="clip.duration"
                :step="0.1"
                :decimals="2"
                :sr-label="i18n.t('inspector.fadeOut')"
                input-width="44px"
                @update:model-value="onFadeOutInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.pitch") }}</span>
              <NumberField
                :model-value="pitch"
                :min="-12"
                :max="12"
                :step="1"
                :sr-label="i18n.t('inspector.pitch')"
                input-width="44px"
                @update:model-value="onPitchInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.pan") }}</span>
              <NumberField
                :model-value="panPercent"
                :min="-100"
                :max="100"
                :step="5"
                :sr-label="i18n.t('inspector.pan')"
                input-width="44px"
                @update:model-value="onPanInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("audio.muteClip") }}</span>
              <ToggleSwitch
                :model-value="clipMuted"
                :label="i18n.t('audio.muteClip')"
                @update:model-value="onMutedInput"
              />
            </div>
          </div>

          <template v-if="hasAudio">
            <template v-if="asset?.kind === 'video' && !clip.audioOnly">
              <div class="section-label">{{ i18n.t("inspector.extractAudio") }}</div>
              <div class="group">
                <div class="prop-row">
                  <span class="audio-hint">{{ i18n.t("inspector.extractAudioHint") }}</span>
                  <button class="preset-btn" type="button" @click="separateAudio">
                    {{ i18n.t("inspector.extractAudio") }}
                  </button>
                </div>
              </div>
            </template>

            <div class="section-label">{{ i18n.t("audio.loudness") }}</div>
            <div class="group">
              <div class="prop-row">
                <span>{{ i18n.t("audio.loudnessTarget") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="loudnessTarget"
                  :options="loudnessOptions"
                  :label="i18n.t('audio.loudnessTarget')"
                  :disabled="audioAi.running"
                  @update:model-value="onLoudnessTarget"
                />
              </div>
              <div class="prop-row">
                <span class="audio-hint">{{ i18n.t("audio.loudnessHint") }}</span>
                <div class="audio-actions">
                  <button
                    class="preset-btn"
                    type="button"
                    :disabled="
                      audioAi.running || loudnessRunning || selectedAudioCount === 0
                    "
                    @click="normalizeLoudness('selection')"
                  >
                    {{
                      i18n.t("audio.loudnessSelection", {
                        count: selectedAudioCount,
                      })
                    }}
                  </button>
                  <button
                    class="btn-text"
                    type="button"
                    :disabled="audioAi.running || loudnessRunning"
                    @click="normalizeLoudness('all')"
                  >
                    {{ i18n.t("audio.loudnessAll") }}
                  </button>
                </div>
              </div>
              <p v-if="loudnessInfo" class="audio-note">{{ loudnessInfo }}</p>
            </div>

            <div class="section-label">{{ i18n.t("audio.denoise") }}</div>
            <div class="group">
              <div class="prop-row">
                <span>{{ i18n.t("audio.strength") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="denoisePreset"
                  :options="denoiseOptions"
                  :label="i18n.t('audio.strength')"
                  :disabled="audioAi.running"
                  @update:model-value="onDenoisePreset"
                />
              </div>
              <div class="prop-row">
                <span class="audio-hint">{{ i18n.t("audio.denoiseHint") }}</span>
                <button
                  class="preset-btn"
                  type="button"
                  :disabled="audioAi.running"
                  @click="applyDsp('denoise', denoisePreset)"
                >
                  {{ i18n.t("audio.apply") }}
                </button>
              </div>
            </div>

            <div class="section-label">{{ i18n.t("audio.beautify") }}</div>
            <div class="group">
              <div class="prop-row">
                <span>{{ i18n.t("audio.preset") }}</span>
                <Md3Select
                  class="prop-select"
                  :model-value="beautifyPreset"
                  :options="beautifyOptions"
                  :label="i18n.t('audio.preset')"
                  :disabled="audioAi.running"
                  @update:model-value="onBeautifyPreset"
                />
              </div>
              <div class="prop-row">
                <span class="audio-hint">{{ i18n.t("audio.beautifyHint") }}</span>
                <button
                  class="preset-btn"
                  type="button"
                  :disabled="audioAi.running"
                  @click="applyDsp('beautify', beautifyPreset)"
                >
                  {{ i18n.t("audio.apply") }}
                </button>
              </div>
            </div>

            <div
              v-if="
                audioAi.running &&
                (audioAi.task === 'dsp' || audioAi.task === 'loudness')
              "
              class="audio-progress-row"
            >
              <div class="audio-progress">
                <div
                  class="audio-progress-fill"
                  :style="{ width: `${audioAi.progressPct}%` }"
                />
              </div>
              <button
                v-if="audioAi.cancellable"
                class="btn-text"
                type="button"
                @click="audioAi.cancel()"
              >
                {{ i18n.t("audio.cancel") }}
              </button>
            </div>
          </template>
        </template>
      </template>
    </div>
  </div>

  <ProjectDialog
    v-model:open="presetDialogOpen"
    :initial-name="presetInitialName"
    :title="i18n.t('textPreset.saveTitle')"
    :label="i18n.t('textPreset.nameLabel')"
    :placeholder="i18n.t('textPreset.namePlaceholder')"
    :confirm-text="i18n.t('textPreset.save')"
    @submit="saveTextPreset"
  />
</template>

<style scoped>
.hint-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  margin-bottom: 2px;
}
.selected-thumb {
  width: 46px;
  height: 34px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(140deg, #2c1f4d 0%, #7c4a76 50%, #e79a76 100%);
  background-size: cover;
  background-position: center;
  color: rgba(255, 255, 255, 0.9);
}
.selected-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.selected-name {
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.selected-meta {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.offline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
  font-size: 11.5px;
}
.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.text-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 10px 6px;
  border-radius: 16px;
  background-color: var(--app-inset);
}
.group + .section-label {
  margin-top: 18px;
}
.prop-row {
  min-height: 38px;
  align-items: center;
}
.prop-select {
  width: 172px;
  flex: 0 0 auto;
}
.prop-value {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.keyframe-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.keyframe-time {
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  text-align: left;
}
.keyframe-time:hover {
  text-decoration: underline;
}
.keyframe-values {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.keyframe-empty {
  padding: 6px 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.keyframe-remove {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.keyframe-remove:hover {
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.align-group {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.align-btn {
  width: 30px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.align-btn:hover {
  color: rgb(var(--md-on-surface));
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.align-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.align-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.align-icon {
  width: 16px;
  height: 16px;
}
.preset-btn {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.14s ease, transform 0.14s ease;
}
.preset-btn:hover {
  filter: brightness(1.06);
}
.preset-btn:active {
  transform: scale(0.96);
}
.preset-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.audio-hint {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.audio-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
.audio-actions .btn-text:disabled {
  opacity: 0.45;
  cursor: default;
}
.audio-note {
  margin: 2px 0 4px;
  font-size: 11px;
  color: rgb(var(--md-primary));
}
.audio-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.audio-progress {
  flex: 1 1 auto;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgb(var(--md-primary) / 0.15);
}
.audio-progress-fill {
  height: 100%;
  background-color: rgb(var(--md-primary));
  transition: width 120ms linear;
}
</style>

<style>
/* 菜单 Teleport 到 body，因此不能写在 scoped 里 */
.inspector-menu {
  position: fixed;
  z-index: 320;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: 16px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.inspector-menu .menu-item {
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.inspector-menu .menu-item:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.inspector-menu .menu-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.inspector-menu .menu-item.danger {
  color: rgb(var(--md-error));
}
.inspector-menu .menu-sep {
  height: 1px;
  margin: 4px 6px;
  background-color: rgb(var(--md-outline-variant) / 0.5);
}
</style>

