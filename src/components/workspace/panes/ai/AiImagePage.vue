<script setup lang="ts">
/**
 * **AI 画图 / 图像编辑**：侧栏里的整页表单，一个 `mode` 一个页面。
 *
 * 画图 = txt2img；图像编辑 = 从素材库选一张图，涂抹 mask（白色 = 重绘）后按强度
 * 局部重绘，或直接让 FLUX Kontext / Qwen-Image-Edit 按指令整图改。两种结果都通过
 * `insertGeneratedImage` 插到**新开的最上层轨道**，压在原画面之上，方便继续做叠加。
 *
 * 画图与编辑在 AI 面板里是两个入口：这里用 `mode` 决定页标题、模型清单
 * （只改图的模型不会出现在画图页）以及是否显示原图 / mask 区块。
 *
 * 模型清单按体积从小到大排（SD 1.5 → Z-Image → SDXL → FLUX schnell → Kontext →
 * Qwen-Image → Qwen-Image-Edit），每档的默认步数 / CFG / flow shift 与宽高对齐
 * 单位都在 `types/imageGen.ts` 的规格表里。
 *
 * 布局约定（窄侧栏优先）：
 * - 模型是主要选择，常驻；引擎 / 后端属于「配置一次就不动」，收进 MD3 折叠面板。
 * - 原图用下拉框（带缩略图）而不是横向缩略图条：侧栏再窄也只显示当前选中的那张。
 * - 生成按钮固定在底部，长表单滚动时不用来回找。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  PaintBrushIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import AiSetupDialog from "@/components/ai/AiSetupDialog.vue";
import DownloadStrip from "@/components/ai/DownloadStrip.vue";
import Md3Expansion from "@/components/common/Md3Expansion.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import MaskCanvas from "@/components/workspace/panes/ai/MaskCanvas.vue";
import { addAsset } from "@/core/ops";
import { importAssetAt, kindFromPath, pickMediaFiles, fileUrl } from "@/core/media";
import { insertGeneratedImage } from "@/core/imageInsert";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { useI18n } from "@/i18n";
import { useDeviceStore } from "@/stores/device";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSdcppStore } from "@/stores/sdcpp";
import { useImageGenStore } from "@/stores/imageGen";
import { useCloudGenStore } from "@/stores/cloudGen";
import { useEngineSetup } from "@/composables/useAiSetup";
import { useImageModelSource } from "@/composables/useImageModelSource";
import { toast } from "@/composables/useToast";
import { humanSize } from "@/utils/size";
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import { CLOUD_GEN_CONFIG_ACTION } from "@/utils/cloudGen";
import {
  IMAGE_PRESETS,
  alignImageSize,
  editSizeFromSource,
  imageModelSpec,
  type ImageGenMode,
} from "@/types/imageGen";

const emit = defineEmits<{ (e: "back"): void }>();

/**
 * 这一页只做一件事：`draw` = 文生图，`edit` = 图像编辑（图生图 / 局部重绘 / 指令改图）。
 * 两页各自独立挂载，模型清单、记住的选择和准备向导都不混在一起。
 */
const props = defineProps<{
  mode?: ImageGenMode;
  initialPrompt?: string;
  initialSourceId?: string;
}>();

const i18n = useI18n();
const layout = useLayoutStore();
const models = useModelsStore();
const sdcpp = useSdcppStore();
const device = useDeviceStore();
const imageGen = useImageGenStore();
const cloudGen = useCloudGenStore();
const project = useProjectStore();
const playback = usePlaybackStore();

const mode = computed<ImageGenMode>(() => props.mode ?? "draw");
const prompt = ref("");
const promptEl = ref<HTMLTextAreaElement | null>(null);
const negative = ref("");
const presetId = ref("1024");
const steps = ref(8);
const seed = ref(-1);
const cfg = ref(1);
const strength = ref(0.6);
const offload = ref(true);
const vaeTiling = ref(true);
const brush = ref(40);
const erasing = ref(false);
const backendBusy = ref(false);
const importing = ref(false);
const sourceAssetId = ref<string | null>(null);
/** 「运行环境」默认收起；缺引擎时自动展开（见 onMounted）。 */
const runtimeOpen = ref(false);

function setErase(value: boolean): void {
  erasing.value = value;
}

function onMaskDirty(value: boolean): void {
  maskDirty.value = value;
}

// ---- 模型：画图页只列能画图的档，编辑页只列能改图的档 ----
const cloudProviders = ref<CloudGenProvider[]>([]);
const cloudPresets = ref<CloudGenPreset[]>([]);

const picker = useImageModelSource({
  mode: props.mode ?? "draw",
  providers: () => cloudProviders.value,
  presets: () => cloudPresets.value,
});
const chosenModel = picker.choice.current;
const modelSourceOptions = picker.options;
const cloudProvider = picker.cloudProvider;
const cloudSelected = picker.cloudSelected;
const sourceId = picker.sourceId;
const modelMissing = picker.missing;
const modelDownloading = picker.downloading;
const busy = computed(() => imageGen.running || cloudGen.running);

/** 未知家族按 Z-Image 兜底（文案 key 也因此稳定）。 */
const family = computed(() => chosenModel.value?.family ?? "z_image_turbo");
const spec = computed(() => imageModelSpec(family.value));

function onSourceAction(id: string): void {
  if (id === CLOUD_GEN_CONFIG_ACTION) layout.openSettings("gen");
}

/** 切换模型：换成该家族官方建议的默认步数 / CFG；画图时挑一档合适的分辨率。 */
watch(
  () => chosenModel.value?.id,
  () => {
    const model = chosenModel.value;
    if (!model) return;
    const preset = imageModelSpec(model.family);
    steps.value = preset.steps;
    cfg.value = preset.cfg;
    if (mode.value === "draw") {
      presetId.value = model.family === "sd15" ? "512" : "1024";
    }
  },
  { immediate: true },
);

// ---- 尺寸 ----
/** 云端服务不要求 32/64 对齐，统一按 16 取整即可。 */
const sizeMultiple = computed(() => (cloudSelected.value ? 16 : spec.value.multiple));
const drawSize = computed(() => {
  const preset = IMAGE_PRESETS.find((item) => item.id === presetId.value) ?? IMAGE_PRESETS[2];
  return {
    width: alignImageSize(preset.width, sizeMultiple.value),
    height: alignImageSize(preset.height, sizeMultiple.value),
  };
});

const imageAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "image" && !asset.offline),
);
const sourceAsset = computed(
  () => imageAssets.value.find((asset) => asset.id === sourceAssetId.value) ?? null,
);

/** 原图下拉：每项带缩略图 / 尺寸，收起时只显示当前那张。 */
const sourceOptions = computed<SelectOption[]>(() =>
  imageAssets.value.map((asset) => ({
    id: asset.id,
    label: asset.name,
    hint:
      asset.width && asset.height
        ? `${asset.width} × ${asset.height}`
        : i18n.t("media.kind.image"),
    thumb: assetThumbnailUrl(asset) ?? undefined,
  })),
);

const sourceSize = ref<{ width: number; height: number } | null>(null);
const maskReady = ref(false);
const maskDirty = ref(false);
const maskRef = ref<InstanceType<typeof MaskCanvas> | null>(null);

/**
 * 原图尺寸优先用素材元数据；元数据缺失时用画布 `ready` 回报的（已按长边 1536 缩放）。
 * 生成尺寸跟随原图比例，避免把竖屏图拉成方图。
 */
const editSize = computed(() => {
  const source = sourceAsset.value;
  const fromAsset = editSizeFromSource(
    source?.width ?? sourceSize.value?.width,
    source?.height ?? sourceSize.value?.height,
    sizeMultiple.value,
  );
  return fromAsset ?? { width: 1024, height: 1024 };
});

const outputSize = computed(() => (mode.value === "draw" ? drawSize.value : editSize.value));

/** 卡片副标题：当前原图的尺寸（比重复文件名有用）。 */
const sourceMeta = computed(() => {
  const source = sourceAsset.value;
  if (!source) return i18n.t("aiImage.noSource");
  const width = source.width ?? sourceSize.value?.width;
  const height = source.height ?? sourceSize.value?.height;
  return width && height ? `${width} × ${height}` : source.name;
});

watch([mode, imageAssets], () => {
  if (mode.value !== "edit") return;
  if (sourceAssetId.value && imageAssets.value.some((asset) => asset.id === sourceAssetId.value)) {
    return;
  }
  sourceAssetId.value = imageAssets.value[0]?.id ?? null;
});

watch(
  () => sourceAsset.value?.id,
  () => {
    sourceSize.value = null;
    maskReady.value = false;
    maskDirty.value = false;
  },
);

function onMaskReady(size: { width: number; height: number }): void {
  sourceSize.value = size;
  maskReady.value = true;
}

async function importImages(): Promise<void> {
  if (importing.value) return;
  const paths = await pickMediaFiles();
  const images = paths.filter((path) => kindFromPath(path) === "image");
  if (images.length === 0) return;
  importing.value = true;
  let added = 0;
  let firstId: string | null = null;
  for (const path of images) {
    try {
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      added += 1;
      if (!firstId) firstId = asset.id;
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
  if (firstId) sourceAssetId.value = firstId;
  if (added > 0) toast(i18n.t("media.imported", { count: added }));
}

const presetOptions: SelectOption[] = IMAGE_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.label,
}));

// ---- 引擎 / 后端（与视频页、设置页同一套 sd.cpp） ----
const enginePacks = computed(() => sdcpp.items);
const installedPacks = computed(() => enginePacks.value.filter((pack) => pack.installed));
const engineReady = computed(() => installedPacks.value.length > 0);
const engineDownloading = computed(() => sdcpp.busyId !== null);

/**
 * 「准备运行环境」：缺引擎 / 缺模型时弹向导，确认后跳管理器**真的开始下载**。
 *
 * 以前这两个按钮只是 `openTab("models")`，用户跳过去还得自己找卡片再点一次；
 * 管理器又默认停在「已安装」页签，未装的条目压根不显示 —— 看起来就是「点了没反应」。
 */
const setup = useEngineSetup(
  props.mode === "edit" ? "image-edit" : "image",
  () => chosenModel.value,
);
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

/** 只列本机真能跑的后端：AMD 机器上不摆 CUDA，免得白下 900 MB。 */
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

/**
 * 切后端：已装好就直接切；没装就弹「准备」向导（只算引擎那一项），
 * 确认后跳管理器下载，装完自动切过去。
 */
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
      return i18n.t("aiImage.stop");
    case "engine":
      return i18n.t("aiVideo.downloadEngine");
    case "model":
      return modelDownloading.value
        ? i18n.t("aiVideo.downloading")
        : i18n.t("aiVideo.downloadModel", { size: humanSize(modelMissing.value) });
    default:
      return i18n.t("aiImage.generate");
  }
});
const primaryDisabled = computed(() => {
  if (primaryKind.value === "stop") return false;
  if (primaryKind.value === "engine") return engineDownloading.value;
  if (primaryKind.value === "model") return modelDownloading.value || !chosenModel.value;
  if (prompt.value.trim().length === 0) return true;
  if (mode.value === "edit" && !sourceAsset.value) return true;
  return false;
});

/** 固定在底部的状态行：缺什么就提示什么，都就绪时显示输出尺寸。 */
const dockHint = computed(() => {
  if (cloudSelected.value) {
    return `${cloudHintText.value} · ${sizeHint.value}`;
  }
  if (primaryKind.value === "engine") return i18n.t("aiVideo.engineMissingHint");
  if (primaryKind.value === "model") {
    return i18n.t("aiVideo.modelMissingHint", { size: humanSize(modelMissing.value) });
  }
  return sizeHint.value;
});

/** 结果 / 进度 / 错误：本地与云端各一套，界面只看当前来源那一套。 */
const activeResult = computed(() =>
  cloudSelected.value ? cloudGen.imageResult : imageGen.result,
);
const activeElapsed = computed(() =>
  cloudGen.running ? cloudGen.elapsed : imageGen.elapsed,
);
const activeProgressPct = computed(() =>
  cloudGen.running ? cloudGen.progressPct : imageGen.progressPct,
);
const activeMessage = computed(() =>
  cloudSelected.value ? cloudGen.message : imageGen.message,
);
const activeError = computed(() =>
  cloudSelected.value ? cloudGen.error : imageGen.error,
);

async function runPrimary(): Promise<void> {
  switch (primaryKind.value) {
    case "stop":
      if (cloudGen.running) await cloudGen.cancel();
      else await imageGen.cancel();
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
    toast(i18n.t("aiImage.needPrompt"));
    return;
  }
  if (mode.value === "edit" && !sourceAsset.value) {
    toast(i18n.t("aiImage.needSource"));
    return;
  }
  const size = outputSize.value;
  const provider = cloudProvider.value;
  if (provider) {
    const created = await cloudGen.startImage({
      providerId: provider.id,
      mode: mode.value,
      prompt: prompt.value.trim(),
      negativePrompt: negative.value.trim() || undefined,
      width: size.width,
      height: size.height,
      initImage: mode.value === "edit" ? sourceAsset.value?.src : undefined,
      // 目前只有 OpenAI 的编辑接口吃 mask；其余服务按整图参考改。
      maskPng:
        mode.value === "edit" && provider.kind === "openai"
          ? (maskRef.value?.exportMask() ?? undefined)
          : undefined,
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
  const mask = mode.value === "edit" ? (maskRef.value?.exportMask() ?? undefined) : undefined;
  const created = await imageGen.start({
    modelId: model.id,
    prompt: prompt.value.trim(),
    negativePrompt: spec.value.negative ? negative.value.trim() || undefined : undefined,
    width: size.width,
    height: size.height,
    steps: steps.value,
    seed: seed.value,
    cfgScale: cfg.value,
    flowShift: spec.value.flowShift ?? undefined,
    initImage: mode.value === "edit" ? sourceAsset.value?.src : undefined,
    maskPng: mask,
    strength: strength.value,
    offloadToCpu: offload.value,
    vaeTiling: vaeTiling.value,
  });
  if (!created) {
    if (imageGen.error) toast(imageGen.error, "error");
    return;
  }
  await addToTimeline(created.path);
}

async function addToTimeline(path: string): Promise<void> {
  try {
    const asset = await importAssetAt(path);
    const label = i18n.t(mode.value === "draw" ? "aiImage.trackDraw" : "aiImage.trackEdit");
    project.dispatch(
      (doc) => insertGeneratedImage(doc, asset, playback.playhead, label),
      { kind: "ui.dispatch", actor: "human", label },
    );
    toast(i18n.t("aiImage.done"));
  } catch (error) {
    toast(i18n.t("aiImage.addFailed", { error: String(error) }), "error");
  }
}

/** 云端服务里只有 OpenAI 的编辑接口吃 mask；其余只按整图参考改。 */
const cloudMaskSupported = computed(() => cloudProvider.value?.kind === "openai");
/** 云端的说明按页面分开：画图页说生成，编辑页说要改什么 / mask 支持。 */
const cloudHintText = computed(() =>
  i18n.t(mode.value === "edit" ? "aiImage.cloudEditHint" : "aiImage.cloudHint"),
);
const showMask = computed(() => !cloudSelected.value || cloudMaskSupported.value);

const maskHint = computed(() => {
  if (cloudSelected.value) return i18n.t("aiImage.cloudEditHint");
  if (!spec.value.refEdit) {
    return maskDirty.value ? i18n.t("aiImage.maskHint") : i18n.t("aiImage.maskEmpty");
  }
  return maskDirty.value ? i18n.t("aiImage.refEditMaskHint") : i18n.t("aiImage.refEditHint");
});

const sizeHint = computed(() => {
  const size = outputSize.value;
  if (mode.value === "edit" && !sourceAsset.value) return "";
  return i18n.t("aiImage.sizeHint", { width: size.width, height: size.height });
});

const statusLine = computed(() => {
  if (cloudGen.running) {
    return i18n.t("aiImage.elapsed", { seconds: Math.round(cloudGen.elapsed) });
  }
  if (imageGen.running) {
    return i18n.t("aiImage.elapsed", { seconds: Math.round(imageGen.elapsed) });
  }
  if (cloudProvider.value) {
    const provider = cloudProvider.value;
    const model =
      mode.value === "edit" ? provider.edit_model || provider.image_model : provider.image_model;
    return `${provider.name}${model ? ` · ${model}` : ""}`;
  }
  if (modelDownloading.value) return i18n.t("aiVideo.downloading");
  if (!engineReady.value) return i18n.t("aiVideo.engineMissingHint");
  if (!chosenModel.value) {
    return i18n.t(mode.value === "edit" ? "aiImage.noEditModel" : "aiImage.noModel");
  }
  if (chosenModel.value.installed !== true) {
    return i18n.t("aiVideo.modelMissingHint", { size: humanSize(modelMissing.value) });
  }
  return i18n.t("aiVideo.engineReady");
});

function clearMask(): void {
  maskRef.value?.clear();
}

function undoMask(): void {
  maskRef.value?.undo();
}

onMounted(async () => {
  if (props.mode === "edit" && props.initialSourceId && imageAssets.value.some((asset) => asset.id === props.initialSourceId)) {
    sourceAssetId.value = props.initialSourceId;
  }
  if (props.initialPrompt) prompt.value = props.initialPrompt;
  promptEl.value?.focus();
  imageGen.watch();
  cloudGen.watch();
  await Promise.all([
    models.load(),
    sdcpp.load(),
    sdcpp.loadInfo(),
    device.load(),
    imageGen.refreshBusy(),
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
  // 缺引擎时把「运行环境」展开：主按钮的「下载引擎」需要有上下文。
  if (!engineReady.value) runtimeOpen.value = true;
  // 首次进来缺引擎 / 缺模型：自动弹一次「准备」向导（同一后端只弹一次）。
  if (!cloudSelected.value) setup.maybePrompt();
});

onUnmounted(() => {
  imageGen.unwatch();
  cloudGen.unwatch();
});
</script>

<template>
  <div class="image-page">
    <header class="head">
      <button class="icon-btn" type="button" :aria-label="i18n.t('common.back')" @click="emit('back')">
        <ArrowLeftIcon class="w-[15px] h-[15px]" />
      </button>
      <div class="head-text">
        <h1 class="title">{{ i18n.t(mode === "edit" ? "aiImage.editTitle" : "aiImage.drawTitle") }}</h1>
        <p class="sub">{{ statusLine }}</p>
      </div>
      <span class="badge" :class="{ on: cloudSelected || engineReady }">
        {{ cloudProvider ? cloudProvider.name : engineLabel }}
      </span>
    </header>

    <!-- 后台下载（「在后台下载」选的就是这条）：不跳管理器，进度留在这页 -->
    <DownloadStrip />

    <!-- 模型：整组权重一起装。主要选择常驻，引擎 / 后端收进下面的折叠面板。 -->
    <section class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("aiVideo.model") }}</span>
        <span class="card-sub">
          {{
            cloudProvider
              ? cloudHintText
              : chosenModel?.installed
                ? i18n.t("aiVideo.modelReady", { size: humanSize(chosenModel.approx_bytes) })
                : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(modelMissing) })
          }}
        </span>
      </div>
      <Md3Select
        v-model="sourceId"
        :options="modelSourceOptions"
        :label="i18n.t('aiVideo.model')"
        :empty="i18n.t(mode === 'edit' ? 'aiImage.noEditModel' : 'aiImage.noModel')"
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
      <p v-if="!cloudSelected && chosenModel && chosenModel.installed !== true" class="hint">
        {{ i18n.t(`aiImage.modelHint.${family}`) }}
      </p>
      <p v-else-if="cloudProvider" class="hint">{{ cloudHintText }}</p>
    </section>

    <!-- 运行环境：引擎 / 后端属于「配置一次就不动」，收起后不占版面 -->
    <Md3Expansion
      v-if="!cloudSelected"
      :title="i18n.t('aiImage.runtime')"
      :summary="engineLabel"
      :open="runtimeOpen"
      @update:open="runtimeOpen = $event"
    >
      <div v-if="backendSegOptions.length > 1" class="field">
        <span class="field-label">{{ i18n.t("aiVideo.backend") }}</span>
        <SegmentedControl
          :model-value="backendKind"
          :options="backendSegOptions"
          :aria-label="i18n.t('aiVideo.backend')"
          size="sm"
          @update:model-value="pickBackend"
        />
      </div>
      <p class="hint">{{ i18n.t("aiVideo.backendHint") }}</p>
      <div class="runtime-actions">
        <button v-if="!engineReady" class="text-btn" type="button" @click="setup.ensure()">
          {{ i18n.t("aiVideo.downloadEngine") }}
        </button>
        <button v-else class="text-btn" type="button" @click="layout.openDownloads('models')">
          {{ i18n.t("aiVideo.manageEngine") }}
        </button>
      </div>
      <div v-if="sdcpp.busyId" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: sdcpp.progressPct === null }"
          :style="sdcpp.progressPct === null ? undefined : { width: `${sdcpp.progressPct}%` }"
        />
      </div>
    </Md3Expansion>

    <!-- 原图：只影响图像编辑。下拉框里每项带缩略图，收起时只显示选中的那张。 -->
    <section v-if="mode === 'edit'" class="card">
      <div class="card-head">
        <div class="card-heading">
          <span class="card-title">{{ i18n.t("aiImage.source") }}</span>
          <span class="card-sub">{{ sourceMeta }}</span>
        </div>
        <button class="text-btn" type="button" :disabled="importing" @click="importImages">
          <PlusIcon class="w-3 h-3" />
          {{ importing ? i18n.t("media.importing") : i18n.t("aiImage.importImage") }}
        </button>
      </div>

      <div v-if="imageAssets.length === 0" class="empty">
        <PhotoIcon class="w-4 h-4" />
        <span>{{ i18n.t("aiImage.noImageAssets") }}</span>
      </div>
      <Md3Select
        v-else
        v-model="sourceAssetId"
        :options="sourceOptions"
        :label="i18n.t('aiImage.source')"
        :placeholder="i18n.t('aiImage.noSource')"
        :disabled="busy"
      />

      <template v-if="sourceAsset">
        <template v-if="showMask">
          <MaskCanvas
            ref="maskRef"
            :src="fileUrl(sourceAsset.src)"
            :brush="brush"
            :erase="erasing"
            :disabled="busy"
            @ready="onMaskReady"
            @dirty="onMaskDirty"
          />
          <div class="mask-tools">
            <button
              class="tool-btn"
              :class="{ on: !erasing }"
              type="button"
              :disabled="busy"
              @click="setErase(false)"
            >
              <PaintBrushIcon class="w-3 h-3" />
              {{ i18n.t("aiImage.maskBrush") }}
            </button>
            <button
              class="tool-btn"
              :class="{ on: erasing }"
              type="button"
              :disabled="busy"
              @click="setErase(true)"
            >
              {{ i18n.t("aiImage.maskErase") }}
            </button>
            <NumberField
              v-model="brush"
              :sr-label="i18n.t('aiImage.maskBrush')"
              :min="4"
              :max="240"
              :step="4"
              input-width="46px"
              :disabled="busy"
            />
            <span class="spacer" />
            <button
              class="tool-btn"
              type="button"
              :disabled="busy || !maskDirty"
              @click="undoMask"
            >
              <ArrowUturnLeftIcon class="w-3 h-3" />
              {{ i18n.t("aiImage.maskUndo") }}
            </button>
            <button
              class="tool-btn"
              type="button"
              :disabled="busy || !maskDirty"
              @click="clearMask"
            >
              <TrashIcon class="w-3 h-3" />
              {{ i18n.t("aiImage.maskClear") }}
            </button>
          </div>
          <p class="hint" :class="{ warn: spec.refEdit && !maskDirty }">{{ maskHint }}</p>
          <p v-if="!maskReady" class="hint">{{ i18n.t("aiImage.maskLoading") }}</p>
        </template>
        <p v-else class="hint">{{ i18n.t("aiImage.cloudEditHint") }}</p>
      </template>
    </section>

    <!-- 提示词与参数 -->
    <section class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("aiImage.prompt") }}</span>
      </div>
      <textarea
        ref="promptEl"
        v-model="prompt"
        class="prompt"
        rows="4"
        spellcheck="false"
        :placeholder="
          i18n.t(mode === 'edit' ? 'aiImage.promptPlaceholderEdit' : 'aiImage.promptPlaceholder')
        "
        :disabled="busy"
      />

      <textarea
        v-if="spec.negative && !cloudSelected"
        v-model="negative"
        class="prompt negative"
        rows="2"
        spellcheck="false"
        :placeholder="i18n.t('aiImage.negativePlaceholder')"
        :disabled="busy"
      />

      <div v-if="mode === 'draw'" class="field">
        <span class="field-label">{{ i18n.t("aiImage.resolution") }}</span>
        <Md3Select
          v-model="presetId"
          :options="presetOptions"
          :label="i18n.t('aiImage.resolution')"
          :disabled="busy"
        />
      </div>
      <p class="hint">{{ sizeHint }}</p>

      <div v-if="!cloudSelected" class="row">
        <span class="row-label">{{ i18n.t("aiImage.steps") }}</span>
        <NumberField
          v-model="steps"
          :sr-label="i18n.t('aiImage.steps')"
          :min="1"
          :max="60"
          input-width="46px"
          :disabled="busy"
        />
      </div>

      <div v-if="!cloudSelected && mode === 'edit' && (!spec.refEdit || maskDirty)" class="row">
        <span class="row-label">{{ i18n.t("aiImage.strength") }}</span>
        <div class="row-control">
          <NumberField
            v-model="strength"
            :sr-label="i18n.t('aiImage.strength')"
            :min="0.05"
            :max="1"
            :step="0.05"
            :decimals="2"
            input-width="52px"
            :disabled="busy"
          />
          <span class="value">{{ Math.round(strength * 100) }}%</span>
        </div>
      </div>
      <p
        v-if="!cloudSelected && mode === 'edit' && (!spec.refEdit || maskDirty)"
        class="hint"
      >
        {{ i18n.t("aiImage.strengthHint") }}
      </p>

      <Md3Expansion v-if="!cloudSelected" variant="flat" :title="i18n.t('aiVideo.advanced')">
        <div class="rows">
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
              :max="20"
              :step="0.1"
              :decimals="1"
              input-width="52px"
              :disabled="busy"
            />
          </div>
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.offload") }}</span>
            <ToggleSwitch
              v-model="offload"
              :label="i18n.t('aiVideo.offload')"
              :disabled="busy"
            />
          </div>
          <div class="row">
            <span class="row-label">{{ i18n.t("aiVideo.vaeTiling") }}</span>
            <ToggleSwitch
              v-model="vaeTiling"
              :label="i18n.t('aiVideo.vaeTiling')"
              :disabled="busy"
            />
          </div>
        </div>
        <p class="hint">{{ i18n.t("aiImage.vramHint") }}</p>
      </Md3Expansion>
    </section>

    <!-- 结果 -->
    <section v-if="activeResult" class="card">
      <div class="card-head">
        <div class="card-heading">
          <span class="card-title">{{ i18n.t("aiImage.result") }}</span>
          <span class="card-sub">
            {{ activeResult.width }} × {{ activeResult.height }} ·
            {{ i18n.t("aiImage.insertedTop") }}
          </span>
        </div>
        <button class="text-btn" type="button" @click="addToTimeline(activeResult.path)">
          {{ i18n.t("aiVideo.addToTimeline") }}
        </button>
      </div>
      <img class="preview" :src="fileUrl(activeResult.path)" alt="" />
    </section>

    <!-- 固定在底部的生成区：长表单滚动时按钮始终在手边 -->
    <div class="run-dock">
      <div v-if="busy" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: activeProgressPct === null }"
          :style="activeProgressPct === null ? undefined : { width: `${activeProgressPct}%` }"
        />
      </div>
      <p v-if="activeError" class="hint warn">{{ activeError }}</p>
      <div class="run-row">
        <span class="run-hint">
          {{
            busy
              ? i18n.t("aiImage.elapsed", { seconds: Math.round(activeElapsed) })
              : activeMessage || dockHint
          }}
        </span>
        <button class="run-btn" type="button" :disabled="primaryDisabled" @click="runPrimary">
          {{ primaryLabel }}
        </button>
      </div>
    </div>

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
.image-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
  padding: 10px 12px 0;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.head-text {
  flex: 1 1 auto;
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.1px;
}
.sub {
  margin: 2px 0 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.icon-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.icon-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.badge {
  flex: 0 0 auto;
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
  padding: 12px;
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container));
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.card-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1px;
}
.card-sub {
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.field-label {
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.2px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
}
.row-label {
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
}
.row-control {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.value {
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.prompt {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
}
.prompt.negative {
  font-size: 11px;
}
.prompt:focus-visible {
  border-color: rgb(var(--md-primary));
  outline: 2px solid rgb(var(--md-primary) / 0.22);
  outline-offset: 0;
}
.hint {
  margin: 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  line-height: 1.5;
}
.hint.warn {
  color: rgb(var(--md-error, 220 80 80));
}
.runtime-actions {
  display: flex;
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
  font-size: 10.5px;
  font-weight: 500;
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
  animation: image-slide 1.2s ease-in-out infinite;
}
@keyframes image-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.preview {
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  border-radius: 12px;
  background: #000;
}
.empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
}
.mask-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid rgb(var(--md-outline-variant));
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  cursor: pointer;
}
.tool-btn.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.tool-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.run-dock {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 -12px;
  padding: 10px 12px 14px;
  background: linear-gradient(to top, var(--app-card) 62%, rgb(0 0 0 / 0));
}
.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.run-hint {
  flex: 1 1 auto;
  min-width: 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  line-height: 1.4;
}
.run-btn {
  flex: 0 0 auto;
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1px;
  white-space: nowrap;
  box-shadow: var(--md-elevation-1);
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}
.run-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}
.run-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.run-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.run-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
</style>
