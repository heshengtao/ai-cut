<script setup lang="ts">
/**
 * **AI 视频生成**：侧栏里的整页表单。
 *
 * 从 AI 功能列表的卡片进来，左上角返回。和 AI DAW 的写歌页同一套形态：
 * 引擎（sd.cpp）与模型各自一段状态，缺什么就只给那一步的按钮，不让用户对着一个
 * 永远点不动的「生成」猜。
 *
 * 支持 7 个模型家族（帧率 / 帧数网格 / 文本编码器都不一样，见 `types/videoGen.ts`）：
 * - Wan2.1 T2V 1.3B：16 fps、帧数 `4k + 1`、只有画面，最轻量，默认选中；
 * - Wan2.2 TI2V 5B：24 fps、帧数 `4k + 1`、只有画面，比 1.3B 新一代；
 * - Wan2.2 T2V A14B：16 fps、帧数 `4k + 1`、双专家（high + low noise）；
 * - LTX-2.3：24 fps、帧数 `8k + 1`、画面 + 音频（Gemma 3 文本编码器）；
 * - HunyuanVideo 1.5：24 fps、帧数 `4k + 1`、Qwen2.5-VL + ByT5 双文本编码器；
 * - MiniMax-H3：24 fps、帧数 `17k + 5`、画面 + 立体声音频；
 * - LTX-2.5：24 fps、帧数 `8k + 1`、画面 + 音频（Gemma 4 文本编码器）。
 *
 * 生成是**单段**的：16 GB 显存下 H3 480p 单段现实上限约 175 帧（7.3 秒），更长的片子
 * 要在时间线上分段生成再拼。
 *
 * 画幅 / 分辨率按 `types/videoGen.ts` 的档位取（横屏、竖屏、方形都是 32 的倍数）。
 * 参考图：H3 / LTX-2 支持首帧 + 尾帧，Wan2.2 TI2V 只支持首帧；纯 T2V 家族不显示这一栏。
 * Ref2VA 档反过来：只吃参考图 / 参考音频（可多选，顺序对应提示词里的 <Picture N>）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/vue/24/outline";
import AiSetupDialog from "@/components/ai/AiSetupDialog.vue";
import DownloadStrip from "@/components/ai/DownloadStrip.vue";
import Md3Expansion from "@/components/common/Md3Expansion.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { addAsset, addClip, addTrack } from "@/core/ops";
import { createClip } from "@/core/factory";
import { fileUrl, importAssetAt, kindFromPath, pickMediaFiles } from "@/core/media";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { useI18n } from "@/i18n";
import type { MediaAsset } from "@/types/project";
import { useDeviceStore } from "@/stores/device";
import { useLayoutStore } from "@/stores/layout";
import { useModelChoiceStore } from "@/stores/modelChoice";
import { useModelsStore } from "@/stores/models";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSdcppStore } from "@/stores/sdcpp";
import { useVideoGenStore } from "@/stores/videoGen";
import { useCloudGenStore } from "@/stores/cloudGen";
import { useModelChoice } from "@/composables/useModelChoice";
import { useEngineSetup } from "@/composables/useAiSetup";
import { toast } from "@/composables/useToast";
import { humanSize, missingBytes } from "@/utils/size";
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import {
  CLOUD_GEN_CONFIG_ACTION,
  providersForCapability,
  sourceIdFor,
  splitSourceId,
  supportsCapability,
} from "@/utils/cloudGen";
import {
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  aspectFromSize,
  framesForSeconds,
  videoModelSpec,
  videoResolution,
  type VideoAspect,
} from "@/types/videoGen";

const emit = defineEmits<{ (e: "back"): void }>();

/** 从时间线右键菜单进来时预填的提示词 / 首帧参考图。 */
const props = defineProps<{
  initialPrompt?: string;
  initialImageId?: string;
}>();

const i18n = useI18n();
const layout = useLayoutStore();
const models = useModelsStore();
const sdcpp = useSdcppStore();
const device = useDeviceStore();
const videoGen = useVideoGenStore();
const cloudGen = useCloudGenStore();
const modelChoice = useModelChoiceStore();
const project = useProjectStore();
const playback = usePlaybackStore();

const prompt = ref("");
const promptEl = ref<HTMLTextAreaElement | null>(null);
const aspectId = ref<string>(aspectFromSize(project.doc.width, project.doc.height));
const resolutionId = ref("480p");
const duration = ref(5);
const steps = ref(6);
const seed = ref(-1);
const cfg = ref(1);
const flowShift = ref(12);

const stepOptions: SelectOption[] = [
  { id: "4", label: i18n.t("aiVideo.steps4") },
  { id: "6", label: i18n.t("aiVideo.steps6") },
  { id: "8", label: i18n.t("aiVideo.steps8") },
  { id: "10", label: i18n.t("aiVideo.steps10") },
  { id: "20", label: i18n.t("aiVideo.steps20") },
];
const stepsId = computed<string>({
  get: () => String(steps.value),
  set: (value) => {
    steps.value = Number(value);
  },
});
const offload = ref(true);
const vaeTiling = ref(true);
const backendBusy = ref(false);

const aspectOptions: SelectOption[] = VIDEO_ASPECTS.map((item) => ({
  id: item.id,
  label: item.label,
  ratio: item.ratio,
}));

const resolutionOptions = computed<SelectOption[]>(() =>
  VIDEO_RESOLUTIONS.map((tier) => {
    const size = tier.sizes[aspectId.value as VideoAspect];
    return { id: tier.id, label: `${tier.label} · ${size.width}×${size.height}` };
  }),
);

const resolution = computed(() =>
  videoResolution(resolutionId.value, aspectId.value as VideoAspect),
);
const size = computed(() => resolution.value.size);
/** 生成画幅与工程输出不一致时提示：导出会按工程尺寸缩放 / 加边。 */
const aspectMismatch = computed(
  () => aspectFromSize(project.doc.width, project.doc.height) !== aspectId.value,
);

const {
  list: videoModels,
  current: chosenModel,
} = useModelChoice(
  "video-gen",
  () => models.catalog.filter((model) => model.feature === "video-gen"),
  (list) => list.find((model) => model.installed) ?? list.find((model) => model.recommended) ?? list[0] ?? null,
);

// ---- 云端服务：与本地模型共用同一个下拉框 ----
const cloudProviders = ref<CloudGenProvider[]>([]);
const cloudPresets = ref<CloudGenPreset[]>([]);
const CLOUD_CHOICE_KEY = "video-gen-cloud";
const cloudChoices = computed(() =>
  providersForCapability(cloudProviders.value, "t2v", cloudPresets.value),
);
const cloudProviderId = computed<string | null>({
  get: () => {
    const saved = modelChoice.get(CLOUD_CHOICE_KEY);
    return saved && cloudChoices.value.some((provider) => provider.id === saved) ? saved : null;
  },
  set: (value) => modelChoice.set(CLOUD_CHOICE_KEY, value),
});
const cloudProvider = computed(
  () => cloudChoices.value.find((provider) => provider.id === cloudProviderId.value) ?? null,
);
const cloudSelected = computed(() => cloudProvider.value !== null);
/** 云端服务能不能接首帧（图生视频）。 */
const cloudSupportsFrame = computed(
  () =>
    cloudProvider.value !== null &&
    supportsCapability(cloudProvider.value, "i2v", cloudPresets.value),
);
const busy = computed(() => videoGen.running || cloudGen.running);

const sourceId = computed<string | null>({
  get: () => {
    if (cloudProvider.value) return sourceIdFor("cloud", cloudProvider.value.id);
    return chosenModel.value ? sourceIdFor("local", chosenModel.value.id) : null;
  },
  set: (value) => {
    const parsed = splitSourceId(value);
    if (!parsed) return;
    if (parsed.kind === "cloud") {
      modelChoice.set(CLOUD_CHOICE_KEY, parsed.id);
    } else {
      modelChoice.set(CLOUD_CHOICE_KEY, null);
      modelChoice.set("video-gen", parsed.id);
    }
  },
});

function onSourceAction(id: string): void {
  if (id === CLOUD_GEN_CONFIG_ACTION) layout.openSettings("gen");
}

/** 未知家族按 H3 兜底（文案 key 也因此稳定）。 */
const family = computed(() => chosenModel.value?.family ?? "minimax_h3");
/** 帧率 / 帧数网格 / 默认参数都由模型家族决定（规格表在 `types/videoGen.ts`）。 */
const spec = computed(() => videoModelSpec(family.value));
/** H3 / LTX-2.3 连音频一起生成，其余家族只有画面；云端由服务商决定。 */
const hasAudio = computed(() => !cloudSelected.value && spec.value.audio);
const frames = computed(() => framesForSeconds(duration.value, spec.value));
/** 未按单段上限截短之前，用户「想要」的帧数。 */
const requestedFrames = computed(() => Math.round(duration.value * spec.value.fps));
const actualSeconds = computed(() => frames.value / spec.value.fps);
const framesText = computed(() =>
  i18n.t("aiVideo.frames", {
    frames: frames.value,
    seconds: actualSeconds.value.toFixed(2),
    grid: i18n.t("aiVideo.grid", { step: spec.value.step, offset: spec.value.offset }),
  }),
);

/** 切换模型时换成该家族官方建议的默认值（步数 / CFG / flow shift）。 */
watch(
  () => chosenModel.value?.id,
  () => {
    const model = chosenModel.value;
    if (!model) return;
    const preset = videoModelSpec(model.family);
    steps.value = preset.steps;
    cfg.value = preset.cfg;
    flowShift.value = preset.flowShift ?? 0;
  },
  { immediate: true },
);

/**
 * 下拉列表：开头「配置生成服务…」，下面按「本地模型 / 云端服务」分组。
 * 云端条目显示接口类型与视频模型名。
 */
const modelSourceOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = [
    {
      id: CLOUD_GEN_CONFIG_ACTION,
      label: i18n.t("aiVideo.configure"),
      hint: i18n.t("aiVideo.configureHint"),
      action: true,
    },
  ];
  for (const model of videoModels.value) {
    options.push({
      id: sourceIdFor("local", model.id),
      label: model.name,
      group: i18n.t("aiVideo.groupLocal"),
      hint: model.installed
        ? i18n.t("aiVideo.modelReady", { size: humanSize(model.approx_bytes) })
        : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
    });
  }
  for (const provider of cloudChoices.value) {
    options.push({
      id: sourceIdFor("cloud", provider.id),
      label: provider.name,
      group: i18n.t("aiVideo.groupCloud"),
      hint: `${i18n.t(`settings.gen.kind.${provider.kind}`)}${provider.video_model ? ` · ${provider.video_model}` : ""}`,
    });
  }
  return options;
});

const modelMissing = computed(() =>
  chosenModel.value ? missingBytes(chosenModel.value) : 0,
);

// ---- 参考图：首帧 / 尾帧（I2V / FLF2V；不同家族能力不同） ----
const imageAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "image" && !asset.offline),
);
const firstFrameId = ref("");
const lastFrameId = ref("");
const importingImages = ref(false);
const importingAudio = ref(false);
const firstFrameAsset = computed(
  () => imageAssets.value.find((asset) => asset.id === firstFrameId.value) ?? null,
);
const lastFrameAsset = computed(
  () => imageAssets.value.find((asset) => asset.id === lastFrameId.value) ?? null,
);
const supportsFirstFrame = computed(() =>
  cloudSelected.value ? cloudSupportsFrame.value : spec.value.initImage,
);
const supportsLastFrame = computed(() => !cloudSelected.value && spec.value.endImage);
const supportsRefImage = computed(() => !cloudSelected.value && spec.value.refImage);
const supportsRefAudio = computed(() => !cloudSelected.value && spec.value.refAudio);

// ---- Ref2VA：参考图 / 参考音频（可多选，顺序对应提示词里的 <Picture N>） ----
const audioAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "audio" && !asset.offline),
);
const refImageIds = ref<string[]>([]);
const refAudioIds = ref<string[]>([]);
const refImageAssets = computed<MediaAsset[]>(() =>
  refImageIds.value
    .map((id) => imageAssets.value.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset)),
);
const refAudioAssets = computed<MediaAsset[]>(() =>
  refAudioIds.value
    .map((id) => audioAssets.value.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset)),
);
const refImageAddOptions = computed<SelectOption[]>(() =>
  imageAssets.value
    .filter((asset) => !refImageIds.value.includes(asset.id))
    .map((asset) => ({
      id: asset.id,
      label: asset.name,
      hint:
        asset.width && asset.height
          ? `${asset.width} × ${asset.height}`
          : i18n.t("media.kind.image"),
      thumb: assetThumbnailUrl(asset) ?? undefined,
    })),
);
const refAudioAddOptions = computed<SelectOption[]>(() =>
  audioAssets.value
    .filter((asset) => !refAudioIds.value.includes(asset.id))
    .map((asset) => ({ id: asset.id, label: asset.name })),
);

function addRefImage(id: string): void {
  if (id && !refImageIds.value.includes(id)) refImageIds.value = [...refImageIds.value, id];
}
function removeRefImage(id: string): void {
  refImageIds.value = refImageIds.value.filter((current) => current !== id);
}
function addRefAudio(id: string): void {
  if (id && !refAudioIds.value.includes(id)) refAudioIds.value = [...refAudioIds.value, id];
}
function removeRefAudio(id: string): void {
  refAudioIds.value = refAudioIds.value.filter((current) => current !== id);
}

const frameOptions = computed<SelectOption[]>(() => [
  { id: "", label: i18n.t("aiVideo.refImageNone") },
  ...imageAssets.value.map((asset) => ({
    id: asset.id,
    label: asset.name,
    hint:
      asset.width && asset.height ? `${asset.width} × ${asset.height}` : i18n.t("media.kind.image"),
    thumb: assetThumbnailUrl(asset) ?? undefined,
  })),
]);

/** 当前模型不支持某个参考入口（或素材被删）时清掉选择，避免把无效路径发给 sd-cli。 */
watch(
  () => [chosenModel.value?.id, imageAssets.value, audioAssets.value] as const,
  () => {
    if (!supportsFirstFrame.value) firstFrameId.value = "";
    if (!supportsLastFrame.value) lastFrameId.value = "";
    if (!supportsRefImage.value) refImageIds.value = [];
    if (!supportsRefAudio.value) refAudioIds.value = [];
    if (firstFrameId.value && !firstFrameAsset.value) firstFrameId.value = "";
    if (lastFrameId.value && !lastFrameAsset.value) lastFrameId.value = "";
    refImageIds.value = refImageIds.value.filter((id) =>
      imageAssets.value.some((asset) => asset.id === id),
    );
    refAudioIds.value = refAudioIds.value.filter((id) =>
      audioAssets.value.some((asset) => asset.id === id),
    );
  },
);
watch(firstFrameId, (id) => {
  if (!id) lastFrameId.value = "";
});

/** 从磁盘导入图片 / 音频到素材库；返回成功导入的素材。 */
async function importReferenceMedia(kind: "image" | "audio"): Promise<MediaAsset[]> {
  const paths = await pickMediaFiles();
  const wanted = paths.filter((path) => kindFromPath(path) === kind);
  if (wanted.length === 0) return [];
  const imported: MediaAsset[] = [];
  for (const path of wanted) {
    try {
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      imported.push(asset);
    } catch (error) {
      toast(
        i18n.t("media.importFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }
  if (imported.length > 0) toast(i18n.t("media.imported", { count: imported.length }));
  return imported;
}

async function importReferenceImages(): Promise<void> {
  if (importingImages.value) return;
  importingImages.value = true;
  try {
    const imported = await importReferenceMedia("image");
    if (imported.length === 0) return;
    if (supportsRefImage.value) {
      for (const asset of imported) addRefImage(asset.id);
    } else {
      firstFrameId.value = imported[0].id;
    }
  } finally {
    importingImages.value = false;
  }
}

async function importReferenceAudio(): Promise<void> {
  if (importingAudio.value) return;
  importingAudio.value = true;
  try {
    const imported = await importReferenceMedia("audio");
    for (const asset of imported) addRefAudio(asset.id);
  } finally {
    importingAudio.value = false;
  }
}

// ---- 引擎 / 后端 ----
const enginePacks = computed(() => sdcpp.items);
const installedPacks = computed(() => enginePacks.value.filter((pack) => pack.installed));
const engineReady = computed(() => installedPacks.value.length > 0);
const engineDownloading = computed(() => sdcpp.busyId !== null);

/**
 * 「准备运行环境」：缺引擎 / 缺模型时弹向导，确认后跳管理器**真的开始下载**。
 * 以前这两个按钮只是 `openTab("models")`，跳过去还停在「已安装」页签，什么都不下。
 */
const setup = useEngineSetup("video", () => chosenModel.value);
const setupOpen = setup.open;
const setupPlan = setup.plan;
const setupForced = setup.forced;

/**
 * 关掉「准备」向导。首次引导（强制）时顺便退回列表：
 * 功能一个字节都没装，留在这页也只是对着点不动的按钮。
 */
function cancelSetup(): void {
  const forced = setupForced.value;
  setup.cancel();
  if (forced) emit("back");
}

const engineLabel = computed(() => {
  const active = enginePacks.value.find((pack) => pack.selected);
  if (active?.installed) return i18n.t(active.label);
  const installed = installedPacks.value[0];
  if (installed) return i18n.t(installed.label);
  return i18n.t("aiVideo.engineMissing");
});

/** 视频后端：和设置页 / AI 面板同一套分段按钮（不是下拉框）。只列本机能跑的。 */
const backendChoices = computed(() =>
  (sdcpp.info?.options ?? []).filter((option) => option.usable),
);

const backendKind = computed(() => {
  const options = backendChoices.value;
  const preferred = sdcpp.info?.preference;
  if (preferred && options.some((option) => option.kind === preferred)) return preferred;
  const current = sdcpp.info?.current;
  if (current && options.some((option) => option.kind === current)) return current;
  return options.find((option) => option.recommended)?.kind ?? options[0]?.kind ?? "cpu";
});

const backendSegOptions = computed(() =>
  backendChoices.value.map((option) => ({
    value: option.kind,
    label: i18n.t(option.label),
    title: option.installed
      ? i18n.t(option.note)
      : i18n.t("sdcpp.downloadSize", { size: humanSize(option.bytes) }),
    disabled: backendBusy.value || busy.value,
  })),
);

/** 切后端：已装好直接切；没装就弹「准备」向导（只算引擎），装完自动切过去。 */
async function pickBackend(kind: string): Promise<void> {
  if (backendBusy.value) return;
  if (sdcpp.info?.preference === kind && sdcpp.info?.options.some((o) => o.kind === kind && o.installed)) {
    return;
  }
  backendBusy.value = true;
  try {
    await setup.prepareEngine(kind);
  } finally {
    backendBusy.value = false;
  }
}

const modelDownloading = computed(() => models.busyId === chosenModel.value?.id);

// ---- 动作 ----
type PrimaryKind = "engine" | "model" | "generate" | "stop";
const primaryKind = computed<PrimaryKind>(() => {
  if (busy.value) return "stop";
  // 云端服务不需要引擎 / 本地权重：选它就只剩「生成」。
  if (cloudSelected.value) return "generate";
  if (!engineReady.value) return "engine";
  if (chosenModel.value?.installed !== true) return "model";
  return "generate";
});
const primaryLabel = computed(() => {
  switch (primaryKind.value) {
    case "stop":
      return i18n.t("aiVideo.stop");
    case "engine":
      return i18n.t("aiVideo.downloadEngine");
    case "model":
      return modelDownloading.value
        ? i18n.t("aiVideo.downloading")
        : i18n.t("aiVideo.downloadModel", { size: humanSize(modelMissing.value) });
    default:
      return i18n.t("aiVideo.generate");
  }
});
const primaryDisabled = computed(() => {
  if (primaryKind.value === "stop") return false;
  if (primaryKind.value === "engine") return engineDownloading.value;
  if (primaryKind.value === "model") return modelDownloading.value;
  return prompt.value.trim().length === 0;
});

/** 结果 / 进度 / 错误：本地与云端各一套，界面只看当前来源那一套。 */
const activeResult = computed(() =>
  cloudSelected.value ? cloudGen.videoResult : videoGen.result,
);
const activeProgressPct = computed(() =>
  cloudGen.running ? cloudGen.progressPct : videoGen.progressPct,
);
const activeMessage = computed(() =>
  cloudSelected.value ? cloudGen.message : videoGen.message,
);
const activeError = computed(() =>
  cloudSelected.value ? cloudGen.error : videoGen.error,
);
/** 云端结果没有帧数，只有本地 sd.cpp 的产物才有。 */
const activeFrames = computed<number | null>(() =>
  cloudSelected.value ? null : (videoGen.result?.frames ?? null),
);
const durationHint = computed(() =>
  cloudSelected.value ? i18n.t("aiVideo.cloudFrameNote") : framesText.value,
);

async function runPrimary(): Promise<void> {
  switch (primaryKind.value) {
    case "stop":
      if (cloudGen.running) await cloudGen.cancel();
      else await videoGen.cancel();
      return;
    case "engine":
    case "model":
      // 缺什么补什么：弹向导 → 跳管理器 → 自动下载 → 装完自动切后端。
      setup.ensure();
      return;
    default:
      await generate();
  }
}

async function generate(): Promise<void> {
  if (!prompt.value.trim()) {
    toast(i18n.t("aiVideo.needPrompt"));
    return;
  }
  const provider = cloudProvider.value;
  if (provider) {
    const created = await cloudGen.startVideo({
      providerId: provider.id,
      prompt: prompt.value.trim(),
      width: size.value.width,
      height: size.value.height,
      seconds: duration.value,
      initImage: cloudSupportsFrame.value ? firstFrameAsset.value?.src : undefined,
    });
    if (!created) {
      if (cloudGen.error) toast(cloudGen.error, "error");
      return;
    }
    await addToTimeline(created.path);
    return;
  }
  const model = chosenModel.value;
  if (!model || !model.installed) return;
  const created = await videoGen.start({
    modelId: model.id,
    prompt: prompt.value.trim(),
    width: size.value.width,
    height: size.value.height,
    seconds: duration.value,
    steps: steps.value,
    seed: seed.value,
    cfgScale: cfg.value,
    flowShift: flowShift.value,
    offloadToCpu: offload.value,
    vaeTiling: vaeTiling.value,
    initImage: supportsFirstFrame.value ? firstFrameAsset.value?.src ?? null : null,
    endImage:
      supportsLastFrame.value && firstFrameAsset.value
        ? lastFrameAsset.value?.src ?? null
        : null,
    refImages: supportsRefImage.value ? refImageAssets.value.map((asset) => asset.src) : [],
    refAudios: supportsRefAudio.value ? refAudioAssets.value.map((asset) => asset.src) : [],
  });
  if (!created) {
    if (videoGen.error) toast(videoGen.error, "error");
    return;
  }
  await addToTimeline(created.path);
}

async function addToTimeline(path: string): Promise<void> {
  try {
    const asset = await importAssetAt(path);
    const label = i18n.t("aiVideo.track");
    project.dispatch(
      (doc) => {
        let next = addAsset(doc, asset);
        next = addTrack(next, label);
        const track = next.tracks[next.tracks.length - 1];
        return addClip(
          next,
          track.id,
          createClip({
            assetId: asset.id,
            trackId: track.id,
            start: playback.playhead,
            duration: asset.duration,
          }),
        );
      },
      { kind: "ui.dispatch", actor: "human", label },
    );
    toast(i18n.t("aiVideo.done"));
  } catch (error) {
    toast(i18n.t("aiVideo.addFailed", { error: String(error) }), "error");
  }
}

const warning = computed(() => {
  if (cloudSelected.value) return "";
  // 每个家族的单段帧数上限不一样：请求的时长超了就直接截短，要明说。
  if (requestedFrames.value > spec.value.maxFrames) {
    return i18n.t("aiVideo.clampedWarning", {
      frames: spec.value.maxFrames,
      seconds: (spec.value.maxFrames / spec.value.fps).toFixed(1),
    });
  }
  if (resolution.value.tier.id === "720p" && frames.value > 73) {
    return i18n.t("aiVideo.vram720Warning");
  }
  // 每个家族都有单段训练窗口（Wan 1.3B / A14B 是 81 帧，其余 121 / 175 帧）。
  if (frames.value > spec.value.softFrames) {
    return i18n.t("aiVideo.chunkWarning", {
      frames: spec.value.softFrames,
      seconds: (spec.value.softFrames / spec.value.fps).toFixed(1),
    });
  }
  if (resolution.value.tier.id === "480p" && frames.value > 175) {
    return i18n.t("aiVideo.vramWarning");
  }
  return "";
});

const statusLine = computed(() => {
  if (cloudGen.running) {
    return i18n.t("aiVideo.elapsed", { seconds: Math.round(cloudGen.elapsed) });
  }
  if (videoGen.running) {
    return i18n.t("aiVideo.elapsed", { seconds: Math.round(videoGen.elapsed) });
  }
  if (cloudProvider.value) {
    const provider = cloudProvider.value;
    return `${provider.name}${provider.video_model ? ` · ${provider.video_model}` : ""}`;
  }
  if (modelDownloading.value) return i18n.t("aiVideo.downloading");
  if (!engineReady.value) return i18n.t("aiVideo.engineMissingHint");
  if (!chosenModel.value) return i18n.t("aiVideo.noModel");
  if (chosenModel.value.installed !== true) {
    return i18n.t("aiVideo.modelMissingHint", {
      size: humanSize(modelMissing.value),
    });
  }
  return engineLabel.value;
});

onMounted(async () => {
  if (props.initialPrompt) prompt.value = props.initialPrompt;
  promptEl.value?.focus();
  videoGen.watch();
  cloudGen.watch();
  await Promise.all([
    models.load(),
    sdcpp.load(),
    sdcpp.loadInfo(),
    device.load(),
    cloudGen.refreshBusy(),
    cloudGenConfig()
      .then((config) => {
        cloudProviders.value = config.providers;
      })
      .catch(() => {
        cloudProviders.value = [];
      }),
    cloudGenPresets()
      .then((presets) => {
        cloudPresets.value = presets;
      })
      .catch(() => {
        cloudPresets.value = [];
      }),
  ]);
  // 从「图生视频」进来：当前模型不支持首帧时，自动换一个已安装的 I2V 家族，
  // 否则参考图会被 watch 清掉，用户看到的还是一个纯文生视频表单。
  if (props.initialImageId) {
    const exists = imageAssets.value.some((asset) => asset.id === props.initialImageId);
    if (exists) {
      if (!supportsFirstFrame.value) {
        const candidate = videoModels.value.find(
          (model) => model.installed && videoModelSpec(model.family).initImage,
        );
        if (candidate) sourceId.value = sourceIdFor("local", candidate.id);
      }
      if (supportsFirstFrame.value) firstFrameId.value = props.initialImageId;
    }
  }
  // 首次进来缺引擎 / 缺模型：自动弹一次「准备」向导（同一后端只弹一次）。
  if (!cloudSelected.value) setup.maybePrompt();
});

onUnmounted(() => {
  videoGen.unwatch();
  cloudGen.unwatch();
});
</script>

<template>
  <div class="video-page">
    <header class="head">
      <button class="icon-btn" type="button" :aria-label="i18n.t('common.back')" @click="emit('back')">
        <ArrowLeftIcon class="w-[15px] h-[15px]" />
      </button>
      <h1 class="title">{{ i18n.t("aiVideo.title") }}</h1>
      <span class="badge" :class="{ on: cloudSelected || engineReady }">
        {{ cloudProvider ? cloudProvider.name : engineLabel }}
      </span>
    </header>

    <!-- 后台下载（「在后台下载」选的就是这条）：不跳管理器，进度留在这页 -->
    <DownloadStrip />

    <!-- 引擎：sd.cpp 的 CPU / Vulkan / CUDA 后端 -->
    <section v-if="!cloudSelected" class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.engine") }}</span>
          <span class="card-sub">{{ statusLine }}</span>
        </div>
        <button v-if="!engineReady" class="text-btn" type="button" @click="setup.ensure()">
          {{ i18n.t("aiVideo.downloadEngine") }}
        </button>
        <button v-else class="text-btn" type="button" @click="layout.openDownloads('models')">
          {{ i18n.t("aiVideo.manageEngine") }}
        </button>
      </div>
      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.backend") }}</span>
        <div class="row-control backend-slider">
          <SegmentedControl
            :model-value="backendKind"
            :options="backendSegOptions"
            :aria-label="i18n.t('aiVideo.backend')"
            size="sm"
            @update:model-value="pickBackend"
          />
        </div>
      </div>
      <p class="hint">{{ i18n.t("aiVideo.backendHint") }}</p>
      <div v-if="sdcpp.busyId" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: sdcpp.progressPct === null }"
          :style="sdcpp.progressPct === null ? undefined : { width: `${sdcpp.progressPct}%` }"
        />
      </div>
    </section>

    <!-- 模型：整组权重一起装（3 ~ 5 个文件） -->
    <section class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.model") }}</span>
          <span class="card-sub">
            {{
              cloudProvider
                ? i18n.t("aiVideo.cloudHint")
                : chosenModel?.installed
                  ? i18n.t("aiVideo.modelReady", { size: humanSize(chosenModel.approx_bytes) })
                  : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(modelMissing) })
            }}
          </span>
        </div>
      </div>
      <Md3Select
        v-model="sourceId"
        :options="modelSourceOptions"
        :label="i18n.t('aiVideo.model')"
        :empty="i18n.t('aiVideo.noModel')"
        :disabled="busy || modelDownloading"
        @action="onSourceAction"
      />
      <div v-if="!cloudSelected && modelDownloading" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: models.progressPct === null }"
          :style="models.progressPct === null ? undefined : { width: `${models.progressPct}%` }"
        />
      </div>
      <p v-if="!cloudSelected && models.error" class="hint warn">{{ models.error }}</p>
      <p v-if="!cloudSelected" class="hint">{{ i18n.t(`aiVideo.modelHint.${family}`) }}</p>
      <p v-else class="hint">{{ i18n.t("aiVideo.cloudHint") }}</p>
    </section>

    <!-- 参考图：首帧 / 尾帧（I2V / FLF2V，只有部分家族支持） -->
    <section v-if="supportsFirstFrame || supportsLastFrame" class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.refImage") }}</span>
          <span class="card-sub">
            {{
              supportsLastFrame
                ? i18n.t("aiVideo.refImageSubBoth")
                : i18n.t("aiVideo.refImageSubFirst")
            }}
          </span>
        </div>
        <button
          class="text-btn"
          type="button"
          :disabled="importingImages"
          @click="importReferenceImages"
        >
          <PlusIcon class="w-3 h-3" />
          {{ importingImages ? i18n.t("media.importing") : i18n.t("aiVideo.importImage") }}
        </button>
      </div>

      <p v-if="imageAssets.length === 0" class="hint">
        {{ i18n.t("aiVideo.noImageAssets") }}
      </p>
      <template v-else>
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.firstFrame") }}</span>
          <Md3Select
            v-model="firstFrameId"
            :options="frameOptions"
            :label="i18n.t('aiVideo.firstFrame')"
            :disabled="busy"
          />
        </div>
        <div v-if="supportsLastFrame" class="row">
          <span class="row-label">{{ i18n.t("aiVideo.lastFrame") }}</span>
          <Md3Select
            v-model="lastFrameId"
            :options="frameOptions"
            :label="i18n.t('aiVideo.lastFrame')"
            :disabled="busy || !firstFrameAsset"
          />
        </div>
        <p v-if="supportsLastFrame && !firstFrameAsset" class="hint">
          {{ i18n.t("aiVideo.lastFrameNeedsFirst") }}
        </p>
      </template>
      <p class="hint">
        {{ cloudSelected ? i18n.t("aiVideo.cloudFrameNote") : i18n.t("aiVideo.refImageHint") }}
      </p>
    </section>

    <!-- Ref2VA：参考图 / 参考音频（可多选，顺序对应提示词里的 <Picture N>） -->
    <section v-if="supportsRefImage || supportsRefAudio" class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.refConditions") }}</span>
          <span class="card-sub">{{ i18n.t("aiVideo.refConditionsSub") }}</span>
        </div>
      </div>

      <template v-if="supportsRefImage">
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.refImages") }}</span>
          <div class="row-control ref-tools">
            <Md3Select
              :model-value="''"
              :options="refImageAddOptions"
              :label="i18n.t('aiVideo.addRefImage')"
              :placeholder="i18n.t('aiVideo.addRefImage')"
              :disabled="busy || refImageAddOptions.length === 0"
              @select="addRefImage"
            />
            <button
              class="icon-add"
              type="button"
              :aria-label="i18n.t('aiVideo.importImage')"
              :disabled="busy || importingImages"
              @click="importReferenceImages"
            >
              <PlusIcon class="w-3 h-3" />
            </button>
          </div>
        </div>
        <ul v-if="refImageAssets.length > 0" class="ref-list">
          <li v-for="(asset, index) in refImageAssets" :key="asset.id" class="ref-item">
            <img
              v-if="assetThumbnailUrl(asset)"
              class="ref-thumb"
              :src="assetThumbnailUrl(asset) ?? ''"
              alt=""
            />
            <span class="ref-index">{{ index + 1 }}</span>
            <span class="ref-name">{{ asset.name }}</span>
            <button
              class="ref-remove"
              type="button"
              :aria-label="i18n.t('common.remove')"
              :disabled="busy"
              @click="removeRefImage(asset.id)"
            >
              ×
            </button>
          </li>
        </ul>
        <p v-else class="hint">{{ i18n.t("aiVideo.noRefImages") }}</p>
      </template>

      <template v-if="supportsRefAudio">
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.refAudios") }}</span>
          <div class="row-control ref-tools">
            <Md3Select
              :model-value="''"
              :options="refAudioAddOptions"
              :label="i18n.t('aiVideo.addRefAudio')"
              :placeholder="i18n.t('aiVideo.addRefAudio')"
              :disabled="busy || refAudioAddOptions.length === 0"
              @select="addRefAudio"
            />
            <button
              class="icon-add"
              type="button"
              :aria-label="i18n.t('aiVideo.importAudio')"
              :disabled="busy || importingAudio"
              @click="importReferenceAudio"
            >
              <PlusIcon class="w-3 h-3" />
            </button>
          </div>
        </div>
        <ul v-if="refAudioAssets.length > 0" class="ref-list">
          <li v-for="asset in refAudioAssets" :key="asset.id" class="ref-item">
            <span class="ref-index">音</span>
            <span class="ref-name">{{ asset.name }}</span>
            <button
              class="ref-remove"
              type="button"
              :aria-label="i18n.t('common.remove')"
              :disabled="busy"
              @click="removeRefAudio(asset.id)"
            >
              ×
            </button>
          </li>
        </ul>
        <p v-else class="hint">{{ i18n.t("aiVideo.noRefAudios") }}</p>
      </template>

      <p class="hint">{{ i18n.t("aiVideo.refConditionsHint") }}</p>
    </section>

    <!-- 提示词与参数 -->
    <section class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.prompt") }}</span>
        </div>
      </div>
      <textarea
        ref="promptEl"
        v-model="prompt"
        class="prompt"
        rows="4"
        spellcheck="false"
        :placeholder="
          i18n.t(hasAudio ? 'aiVideo.promptPlaceholder' : 'aiVideo.promptPlaceholderSilent')
        "
        :disabled="busy"
      />

      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.aspect") }}</span>
        <Md3Select
          v-model="aspectId"
          :options="aspectOptions"
          :label="i18n.t('aiVideo.aspect')"
          :disabled="busy"
        />
      </div>
      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.resolution") }}</span>
        <Md3Select
          v-model="resolutionId"
          :options="resolutionOptions"
          :label="i18n.t('aiVideo.resolution')"
          :disabled="busy"
        />
      </div>
      <p v-if="aspectMismatch" class="hint">{{ i18n.t("aiVideo.aspectHint") }}</p>
      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.duration") }}</span>
        <div class="row-control">
          <NumberField
            v-model="duration"
            :sr-label="i18n.t('aiVideo.duration')"
            :min="1"
            :max="10"
            :step="1"
            input-width="52px"
            :disabled="busy"
          />
          <span class="value">{{ i18n.t("aiVideo.seconds", { value: duration }) }}</span>
        </div>
      </div>
      <p class="hint">{{ durationHint }}</p>
      <p v-if="warning" class="hint warn">{{ warning }}</p>

      <div v-if="!cloudSelected" class="row">
        <span class="row-label">{{ i18n.t("aiVideo.steps") }}</span>
        <Md3Select
          v-model="stepsId"
          :options="stepOptions"
          :label="i18n.t('aiVideo.steps')"
          :disabled="busy"
        />
      </div>
      <p v-if="!cloudSelected" class="hint">{{ i18n.t("aiVideo.stepsHint") }}</p>

      <Md3Expansion v-if="!cloudSelected" variant="flat" :title="i18n.t('aiVideo.advanced')">
        <div class="advanced">
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.seed") }}</span>
            <NumberField
              v-model="seed"
              :sr-label="i18n.t('aiVideo.seed')"
              :min="-1"
              :max="2147483647"
              input-width="88px"
              :disabled="busy"
            />
          </div>
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.cfg") }}</span>
            <NumberField
              v-model="cfg"
              :sr-label="i18n.t('aiVideo.cfg')"
              :min="0"
              :max="10"
              :step="0.1"
              :decimals="1"
              input-width="52px"
              :disabled="busy"
            />
          </div>
          <div v-if="spec.flowShift !== null" class="row">
            <span class="row-label">{{ i18n.t("aiVideo.flowShift") }}</span>
            <NumberField
              v-model="flowShift"
              :sr-label="i18n.t('aiVideo.flowShift')"
              :min="0"
              :max="30"
              :step="0.5"
              :decimals="1"
              input-width="52px"
              :disabled="busy"
            />
          </div>
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.offload") }}</span>
            <ToggleSwitch v-model="offload" :label="i18n.t('aiVideo.offload')" :disabled="busy" />
          </div>
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.vaeTiling") }}</span>
            <ToggleSwitch v-model="vaeTiling" :label="i18n.t('aiVideo.vaeTiling')" :disabled="busy" />
          </div>
        </div>
      </Md3Expansion>

      <div v-if="busy" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: activeProgressPct === null }"
          :style="activeProgressPct === null ? undefined : { width: `${activeProgressPct}%` }"
        />
      </div>
      <p v-if="activeError" class="hint warn">{{ activeError }}</p>

      <div class="actions">
        <span v-if="activeMessage" class="hint">{{ activeMessage }}</span>
        <span class="spacer" />
        <button class="run-btn" type="button" :disabled="primaryDisabled" @click="runPrimary">
          {{ primaryLabel }}
        </button>
      </div>
    </section>

    <!-- 结果 -->
    <section v-if="activeResult" class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("aiVideo.result") }}</span>
        <button class="text-btn" type="button" @click="addToTimeline(activeResult.path)">
          {{ i18n.t("aiVideo.addToTimeline") }}
        </button>
      </div>
      <video class="preview" :src="fileUrl(activeResult.path)" controls playsinline />
      <p class="hint">
        {{ activeResult.width }}×{{ activeResult.height }} ·
        <template v-if="activeFrames !== null">
          {{ activeFrames }} {{ i18n.t("aiVideo.framesUnit") }} ·
        </template>
        {{ activeResult.duration.toFixed(2) }}s
      </p>
    </section>

    <!-- 缺引擎 / 缺模型：一次确认，跳管理器并自动开始下载 -->
    <AiSetupDialog
      v-if="!cloudSelected"
      :open="setupOpen"
      :plan="setupPlan"
      :dismissible="!setupForced"
      @update:open="(value: boolean) => (value ? undefined : cancelSetup())"
      @cancel="cancelSetup"
      @confirm="setup.confirm()"
      @background="setup.confirmBackground()"
      @choose="setup.choose"
    />
  </div>
</template>

<style scoped>
.video-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 24px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
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
  background-color: rgb(var(--md-surface-container-high));
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
  white-space: nowrap;
}
.badge.on {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container));
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.card-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
}
.card-sub {
  display: block;
  margin-top: 2px;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
  line-height: 1.4;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.row-label {
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
}
.row-control {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* 视频后端分段按钮：占满标签右侧的剩余宽度，并靠右对齐（和设置页一致）。 */
.row-control.backend-slider {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
}
.value {
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
}
.prompt {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid rgb(var(--md-outline-variant));
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-highest));
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
}
.prompt:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.hint {
  margin: 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
  line-height: 1.45;
}
.hint.warn {
  color: rgb(var(--md-error, 220 80 80));
}
.advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.spacer {
  flex: 1;
}
.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px;
  margin-right: -6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}
.text-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-primary) / var(--md-state-hover-alpha));
}
.text-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.text-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.ref-tools {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
}
.icon-add {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-add:hover:not(:disabled) {
  color: rgb(var(--md-primary));
}
.icon-add:disabled {
  opacity: 0.5;
  cursor: default;
}
.ref-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ref-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-highest));
}
.ref-thumb {
  width: 28px;
  height: 21px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 5px;
  background-color: rgb(var(--md-surface-container));
}
.ref-index {
  width: 16px;
  flex: 0 0 auto;
  color: rgb(var(--md-primary));
  font-size: 10px;
  text-align: center;
}
.ref-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.ref-remove {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.ref-remove:hover:not(:disabled) {
  background-color: rgb(var(--md-error, 220 80 80) / 0.12);
  color: rgb(var(--md-error, 220 80 80));
}
.ref-remove:disabled {
  opacity: 0.5;
  cursor: default;
}
.run-btn {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.run-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.progress {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.progress-fill {
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.progress-fill.indeterminate {
  width: 35%;
  animation: video-slide 1.2s ease-in-out infinite;
}
@keyframes video-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.preview {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
</style>
