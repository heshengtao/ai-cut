<script setup lang="ts">
/**
 * AI 功能：MCP 服务器、剪辑智能体入口，以及按「画面 / 音频 / 文字」分类的 AI 能力。
 *
 * 当前落地的是「一键生成字幕」与「AI 朗读」：
 * - 字幕：选择本地 ASR 模型 → 自动下载缺失权重 → 后端 VAD 切段识别 →
 *   前端把结果插入一条新的字幕轨道（一次事务、可撤销）。
 * - 朗读：选择 MOSS-TTS-Nano → 下载 TTS / 音频 Tokenizer 权重 →
 *   后端按文字片段合成 48 kHz 语音 → 前端按原起点放回时间线，
 *   重叠时自动拆到新的朗读轨道。
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  BoltIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentIcon,
  CpuChipIcon,
} from "@heroicons/vue/24/outline";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import type { McpStatus } from "@/types/agent";
import type { AudioStem, ModelStatus, TtsAudio, TtsVoice } from "@/types/models";
import type { Clip, MediaAsset } from "@/types/project";
import { mcpStatus, setMcpConfig } from "@/core/agentApi";
import { audioExtractReference } from "@/core/audioAiApi";
import { addStemTracks, applyProcessedAudio } from "@/core/audioEdit";
import { importAssetAt } from "@/core/media";
import { replaceClipVideo } from "@/core/videoEdit";
import { mapCueToTimeline, type TimelineSubtitle } from "@/core/subtitles";
import { addAsset, addClip, addTrackAt, setClipMuted } from "@/core/ops";
import { createClip } from "@/core/factory";
import { placeVoiceover } from "@/core/voiceover";
import { useAsrStore } from "@/stores/asr";
import { useAudioAiStore } from "@/stores/audioAi";
import { useCutReviewStore } from "@/stores/cutReview";
import { useModelsStore } from "@/stores/models";
import { useVideoAiStore } from "@/stores/videoAi";
import { useTtsStore } from "@/stores/tts";
import { useLayoutStore } from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useI18n } from "@/i18n";
import { copyText } from "@/utils/clipboard";
import { humanSize, missingBytes } from "@/utils/size";
import { regionsLabel, sourceKindLabel } from "@/utils/modelSource";
import { ttsVoiceGroup, ttsVoiceName } from "@/utils/voiceLabel";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import type { VideoAiAspect, VideoAiSubject, VideoProcessed } from "@/types/video";

type AiTag = "all" | "visual" | "audio" | "text";

/** 标签筛选：全部 / 画面 / 音频 / 文本。 */
const TAG_FILTERS: AiTag[] = ["all", "visual", "audio", "text"];

const layout = useLayoutStore();
const i18n = useI18n();
const project = useProjectStore();
const selection = useSelectionStore();
const models = useModelsStore();
const asr = useAsrStore();
const tts = useTtsStore();
const audioAi = useAudioAiStore();
const videoAi = useVideoAiStore();

const activeTag = ref<AiTag>("all");

// ---- 智能剪口播 ----
const cutReview = useCutReviewStore();

/** 当前选中的片段与它引用的素材；没有选中就返回 null。 */
const cutTarget = computed(() => {
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

const cutModelReady = computed(() => cutReview.pickModel() !== null);

/** 识别 → 剪口落地 → 跳到审查面板。 */
async function startCutReview(): Promise<void> {
  const target = cutTarget.value;
  if (!target) {
    toast(i18n.t("cutReview.selectClip"));
    return;
  }
  layout.openTab("cutReview");
  if (!cutModelReady.value) {
    toast(i18n.t("cutReview.noModel"), "error");
    layout.openTab("models");
    return;
  }
  try {
    const count = await cutReview.run(target.asset, target.clip);
    if (cutReview.words.length === 0) {
      toast(i18n.t("cutReview.noSpeech"));
      return;
    }
    if (count === 0) {
      toast(i18n.t("cutReview.nothingFound"));
      return;
    }
    toast(
      i18n.t("cutReview.done", {
        count,
        seconds: i18n.t("cutReview.seconds", { value: cutReview.removedSeconds.toFixed(1) }),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(i18n.t("cutReview.failed", { error: message }), "error");
  }
}

// ---- MCP ----
const status = ref<McpStatus | null>(null);
const saving = ref(false);
const mcpOn = computed(() => status.value?.enabled ?? false);
const endpoint = computed(() => status.value?.url ?? null);

async function refresh(): Promise<void> {
  try {
    status.value = await mcpStatus();
  } catch {
    status.value = null;
  }
}

async function toggleMcp(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    status.value = await setMcpConfig(!mcpOn.value, status.value?.port ?? 50563);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    saving.value = false;
  }
}

async function copyEndpoint(): Promise<void> {
  const url = endpoint.value;
  if (!url) return;
  if (await copyText(url)) toast(i18n.t("ai.copied"));
  else toast(i18n.t("ai.copyFailed"), "error");
}

function openAgent(): void {
  layout.openTab("agent");
}

function openCliSettings(): void {
  layout.openSettings("cli");
}

// ---- 字幕素材 ----

function findClip(id: string): Clip | null {
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (clip) return clip;
  }
  return null;
}

function usableAsset(asset: MediaAsset | null | undefined): asset is MediaAsset {
  if (!asset || asset.offline) return false;
  if (asset.kind === "audio") return true;
  return asset.kind === "video" && asset.hasAudio !== false;
}

const selectedClip = computed<Clip | null>(() =>
  selection.selectedClipIds.length === 1 ? findClip(selection.selectedClipIds[0]) : null,
);

const selectedAsset = computed<MediaAsset | null>(() => {
  const clip = selectedClip.value;
  if (!clip || !clip.assetId) return null;
  return project.doc.assets.find((asset) => asset.id === clip.assetId) ?? null;
});

const selectedVideo = computed<{ clip: Clip; asset: MediaAsset } | null>(() => {
  const clip = selectedClip.value;
  const asset = selectedAsset.value;
  if (
    !clip ||
    clip.audioOnly ||
    !asset ||
    asset.offline ||
    asset.kind !== "video" ||
    clip.duration <= 0
  ) {
    return null;
  }
  return { clip, asset };
});

/** 当前可转写的目标：优先选中的片段，其次时间线上第一个有音轨的素材，最后媒体库里的第一个。 */
const target = computed<{ asset: MediaAsset; clip: Clip | null } | null>(() => {
  if (selectedClip.value && usableAsset(selectedAsset.value)) {
    return { asset: selectedAsset.value, clip: selectedClip.value };
  }
  for (const track of project.doc.tracks) {
    for (const clip of track.clips) {
      if (!clip.assetId) continue;
      const asset = project.doc.assets.find((candidate) => candidate.id === clip.assetId);
      if (usableAsset(asset)) return { asset, clip };
    }
  }
  const asset = project.doc.assets.find((candidate) => usableAsset(candidate));
  return asset ? { asset, clip: null } : null;
});

const sourceLabel = computed(() => {
  const current = target.value;
  if (!current) return i18n.t("ai.subtitleNoSource");
  return i18n.t("ai.subtitleSource", { name: current.asset.name });
});

// ---- 字幕模型 ----

const asrModels = computed(() => models.catalog.filter((model) => model.feature === "asr"));
const vadModel = computed(() => models.catalog.find((model) => model.feature === "vad") ?? null);
const selectedModelId = ref<string | null>(null);
const selectedModel = computed(
  () => asrModels.value.find((model) => model.id === selectedModelId.value) ?? null,
);

watch(
  asrModels,
  (list) => {
    if (list.length === 0) return;
    if (!selectedModelId.value || !list.some((model) => model.id === selectedModelId.value)) {
      // 默认选推荐模型：已下载就立刻用它，否则优先沿用用户已经装好的模型。
      const recommended = list.find((model) => model.recommended);
      const preferred =
        (recommended?.installed ? recommended : undefined) ??
        list.find((model) => model.installed) ??
        recommended ??
        list[0];
      selectedModelId.value = preferred.id;
    }
  },
  { immediate: true },
);

const modelOptions = computed<SelectOption[]>(() =>
  asrModels.value.map((model) => {
    const source = regionsLabel(i18n.t, model.regions);
    return {
      id: model.id,
      label: model.name,
      hint: model.installed
        ? `${i18n.t("ai.modelReady")} · ${source}`
        : `${i18n.t("ai.modelNeedsDownload", {
            size: humanSize(missingBytes(model)),
          })} · ${source}`,
    };
  }),
);

const missing = computed(() => {
  const modelMissing = selectedModel.value ? missingBytes(selectedModel.value) : 0;
  const vadMissing = vadModel.value ? missingBytes(vadModel.value) : 0;
  return modelMissing + vadMissing;
});

const ready = computed(
  () => Boolean(selectedModel.value?.installed && vadModel.value?.installed),
);

/** 只有「生成字幕」这一项在跑；参考音频转写用自己的进度条，不能串到字幕上。 */
const subtitleRunning = ref(false);

const downloadSource = computed(() =>
  sourceKindLabel(
    i18n.t,
    models.progress?.source_kind ?? null,
    models.progress?.source ?? null,
  ),
);

/**
 * 缺模型时与 AI DAW 一致：先弹确认框，确认后跳到下载管理器并开始下载。
 * 下载完成后用户回到这里再点「生成字幕」，不在后台偷偷串起识别。
 */
async function requestModelDownload(): Promise<void> {
  const model = selectedModel.value;
  if (!model) return;
  const vad = vadModel.value;
  const pending = !model.installed ? model : vad && !vad.installed ? vad : null;
  if (!pending) return;

  const accepted = await confirm({
    title: i18n.t("dialog.downloadModelTitle"),
    message: i18n.t("dialog.downloadModelMessage", {
      name: pending.name,
      size: humanSize(missing.value),
    }),
    confirmText: i18n.t("dialog.downloadModelOk"),
    cancelText: i18n.t("common.cancel"),
  });
  if (!accepted) return;

  layout.openTab("models");
  try {
    if (!model.installed) await models.download(model.id);
    if (vad && !vad.installed) await models.download(vad.id);
  } catch {
    // 错误已写进 models.error，下载管理器会显示。
  }
}

async function generateSubtitles(): Promise<void> {
  if (subtitleRunning.value) return;

  const current = target.value;
  if (!current) {
    toast(i18n.t("ai.subtitleNoSource"));
    return;
  }

  const model = selectedModel.value;
  if (!model) {
    toast(i18n.t("ai.subtitleNoModel"));
    layout.openTab("models");
    return;
  }

  if (asr.running) {
    toast(i18n.t("ai.asrBusy"));
    return;
  }

  if (!ready.value) {
    await requestModelDownload();
    return;
  }

  subtitleRunning.value = true;
  try {
    const cues = await asr.generate(current.asset.src, model.id, "auto");
    if (cues.length === 0) {
      toast(i18n.t("ai.subtitleEmpty"));
      return;
    }

    const fps = project.doc.fps;
    const timelineCues = cues
      .map((cue) => mapCueToTimeline(cue, current.clip, fps))
      .filter((cue): cue is { start: number; duration: number; text: string } => cue !== null);

    if (timelineCues.length === 0) {
      toast(i18n.t("ai.subtitleEmpty"));
      return;
    }

    const baseName = i18n.t("ai.subtitleTrack");
    project.dispatch(
      (doc) => {
        let name = baseName;
        let index = 2;
        while (doc.tracks.some((track) => track.name === name)) {
          name = `${baseName} ${index++}`;
        }
        let next = addTrackAt(doc, 0, name);
        const trackId = next.tracks[0].id;
        for (const cue of timelineCues) {
          const clip = createClip({
            assetId: "",
            trackId,
            start: cue.start,
            duration: cue.duration,
            text: cue.text,
          });
          next = addClip(next, trackId, clip);
        }
        return next;
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("ai.subtitles") },
    );
    toast(i18n.t("ai.subtitleDone", { count: timelineCues.length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("已取消")) {
      toast(i18n.t("ai.subtitleCancelled"));
      return;
    }
    toast(i18n.t("ai.subtitleFailed", { error: message }), "error");
  } finally {
    subtitleRunning.value = false;
  }
}

async function stop(): Promise<void> {
  if (asr.running) await asr.cancel();
  if (tts.running) await tts.cancel();
  if (audioAi.running) await audioAi.cancel();
  if (videoAi.running) await videoAi.cancel();
}

// ---- AI 朗读 ----

const LOCAL_TTS = "local:";
const CLOUD_TTS = "cloud:";
const TTS_SETTINGS_ACTION = "tts-settings";

const ttsModels = computed(() => models.catalog.filter((model) => model.feature === "tts"));
const ttsCodec = computed(
  () => models.catalog.find((model) => model.feature === "tts-codec") ?? null,
);
const cloudProviders = computed(() => tts.providers.filter((provider) => provider.enabled));

const selectedTtsModelId = ref<string | null>(null);
const selectedTtsKind = computed<"local" | "cloud">(() =>
  selectedTtsModelId.value?.startsWith(CLOUD_TTS) ? "cloud" : "local",
);
const selectedTtsSourceId = computed(() => {
  const value = selectedTtsModelId.value ?? "";
  if (value.startsWith(CLOUD_TTS)) return value.slice(CLOUD_TTS.length);
  if (value.startsWith(LOCAL_TTS)) return value.slice(LOCAL_TTS.length);
  return value;
});
const selectedTtsModel = computed(() =>
  selectedTtsKind.value === "local"
    ? ttsModels.value.find((model) => model.id === selectedTtsSourceId.value) ?? null
    : null,
);
const selectedCloudProvider = computed(() =>
  selectedTtsKind.value === "cloud"
    ? cloudProviders.value.find((provider) => provider.id === selectedTtsSourceId.value) ?? null
    : null,
);

watch(
  [ttsModels, cloudProviders],
  () => {
    const options = [
      ...ttsModels.value.map((model) => `${LOCAL_TTS}${model.id}`),
      ...cloudProviders.value.map((provider) => `${CLOUD_TTS}${provider.id}`),
    ];
    if (selectedTtsModelId.value && options.includes(selectedTtsModelId.value)) return;
    // 首次进入优先选已经装好的本地模型，其次才用云端服务。
    const installed = ttsModels.value.find((model) => model.installed);
    selectedTtsModelId.value = installed
      ? `${LOCAL_TTS}${installed.id}`
      : cloudProviders.value[0]
        ? `${CLOUD_TTS}${cloudProviders.value[0].id}`
        : ttsModels.value[0]
          ? `${LOCAL_TTS}${ttsModels.value[0].id}`
          : null;
  },
  { immediate: true },
);

const needsReferenceText = computed(
  () => selectedTtsKind.value === "local" && selectedTtsModel.value?.family === "zipvoice",
);
const ttsCodecRequired = computed(
  () => selectedTtsKind.value === "local" && selectedTtsModel.value?.family === "moss_tts_nano",
);

const ttsMissing = computed(() => {
  if (selectedTtsKind.value === "cloud") return 0;
  const modelMissing = selectedTtsModel.value ? missingBytes(selectedTtsModel.value) : 0;
  const codecMissing =
    ttsCodecRequired.value && ttsCodec.value ? missingBytes(ttsCodec.value) : 0;
  return modelMissing + codecMissing;
});

const ttsReady = computed(() => {
  if (selectedTtsKind.value === "cloud") return Boolean(selectedCloudProvider.value);
  return Boolean(
    selectedTtsModel.value?.installed &&
      (!ttsCodecRequired.value || ttsCodec.value?.installed),
  );
});
const ttsDownloading = computed(
  () =>
    selectedTtsKind.value === "local" &&
    (models.busyId === selectedTtsModel.value?.id ||
      (ttsCodecRequired.value &&
        ttsCodec.value !== null &&
        models.busyId === ttsCodec.value.id)),
);
const ttsBusy = computed(() => tts.running);

const ttsModelOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = [
    {
      id: TTS_SETTINGS_ACTION,
      label: i18n.t("ai.ttsSettings"),
      hint: i18n.t("ai.ttsSettingsHint"),
      action: true,
    },
  ];
  for (const model of ttsModels.value) {
    options.push({
      id: `${LOCAL_TTS}${model.id}`,
      label: model.name,
      group: i18n.t("ai.voiceoverLocal"),
      hint: model.installed
        ? i18n.t("ai.modelReady")
        : i18n.t("ai.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
    });
  }
  for (const provider of cloudProviders.value) {
    options.push({
      id: `${CLOUD_TTS}${provider.id}`,
      label: provider.name,
      group: i18n.t("ai.voiceoverCloud"),
      hint: provider.voice
        ? i18n.t("ai.voiceoverCloudVoice", { voice: provider.voice })
        : i18n.t("ai.voiceoverCloudHint"),
    });
  }
  return options;
});

function onTtsSelectAction(id: string): void {
  if (id === TTS_SETTINGS_ACTION) layout.openSettings("tts");
}

function openTtsSettings(): void {
  layout.openSettings("tts");
}

/** 选中的文字片段：朗读只处理这些，并按时间线顺序合成。 */
const textClips = computed<Clip[]>(() => {
  const picked: Clip[] = [];
  for (const id of selection.selectedClipIds) {
    const clip = findClip(id);
    if (clip && clip.assetId === "" && clip.text?.trim()) picked.push(clip);
  }
  return picked.sort((a, b) => a.start - b.start);
});

type VoiceMode = "builtin" | "reference";
const voiceMode = ref<VoiceMode>("builtin");
const ttsVoiceList = ref<TtsVoice[]>([]);
const selectedVoiceId = ref<string | null>(null);
const referenceAssetId = ref<string | null>(null);
const loadingVoices = ref(false);

const audioAssets = computed(() =>
  project.doc.assets.filter(
    (asset) =>
      !asset.offline &&
      (asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio !== false)),
  ),
);

const builtinVoiceOptions = computed<SelectOption[]>(() =>
  ttsVoiceList.value.map((voice) => ({
    id: voice.id,
    // 本地 MOSS 的 name 是参考音频的示例文案，只能用 id；云端音色才用展示名。
    label:
      selectedTtsKind.value === "cloud"
        ? voice.name || voice.id
        : ttsVoiceName(i18n.t, voice),
    group: ttsVoiceGroup(i18n.t, voice.group),
  })),
);

const referenceOptions = computed<SelectOption[]>(() =>
  audioAssets.value.map((asset) => ({ id: asset.id, label: asset.name })),
);

const referenceAsset = computed(
  () => audioAssets.value.find((asset) => asset.id === referenceAssetId.value) ?? null,
);

/** ZipVoice 需要参考音频的准确文本；ASR 模型存在时可自动转写。 */
const referenceText = ref("");
const referenceAsrRunning = ref(false);
const referenceAsrAssetId = ref<string | null>(null);
const asrModel = computed(
  () => models.catalog.find((model) => model.feature === "asr" && model.installed) ?? null,
);

async function transcribeReference(asset: MediaAsset | null): Promise<void> {
  const model = asrModel.value;
  if (!asset || !model || referenceAsrRunning.value) return;
  referenceAsrAssetId.value = asset.id;
  referenceAsrRunning.value = true;
  try {
    const cues = await asr.generate(asset.src, model.id, "auto");
    const text = cues
      .map((cue) => cue.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) referenceText.value = text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("已取消")) {
      toast(i18n.t("ai.voiceoverTranscribeFailed", { error: message }), "error");
    }
  } finally {
    referenceAsrRunning.value = false;
  }
}

watch(referenceAssetId, () => {
  referenceText.value = "";
  referenceAsrAssetId.value = null;
});

watch(
  [voiceMode, referenceAssetId, needsReferenceText, asrModel],
  () => {
    if (!needsReferenceText.value || voiceMode.value !== "reference") return;
    const asset = referenceAsset.value;
    if (!asset || referenceText.value.trim() || !asrModel.value) return;
    if (referenceAsrAssetId.value === asset.id) return;
    void transcribeReference(asset);
  },
  { immediate: true },
);

watch(
  [
    () => selectedTtsKind.value,
    () => selectedTtsSourceId.value,
    () => selectedTtsModel.value?.installed,
    () => selectedCloudProvider.value?.id,
  ],
  async () => {
    const provider = selectedCloudProvider.value;
    if (provider) {
      loadingVoices.value = true;
      try {
        const list = await tts.providerVoices(provider);
        ttsVoiceList.value = list;
        if (!list.some((voice) => voice.id === selectedVoiceId.value)) {
          selectedVoiceId.value =
            (provider.voice && list.some((voice) => voice.id === provider.voice)
              ? provider.voice
              : list[0]?.id) ?? null;
        }
      } finally {
        loadingVoices.value = false;
      }
      return;
    }
    const model = selectedTtsModel.value;
    if (!model?.installed) {
      ttsVoiceList.value = [];
      selectedVoiceId.value = null;
      return;
    }
    loadingVoices.value = true;
    try {
      const list = await tts.voices(model.id);
      ttsVoiceList.value = list;
      if (!list.some((voice) => voice.id === selectedVoiceId.value)) {
        selectedVoiceId.value = list[0]?.id ?? null;
      }
    } finally {
      loadingVoices.value = false;
    }
  },
  { immediate: true },
);

watch(voiceMode, (mode) => {
  if (mode === "reference" && !referenceAssetId.value) {
    referenceAssetId.value = audioAssets.value[0]?.id ?? null;
  }
});

watch(selectedCloudProvider, (provider) => {
  if (provider) voiceMode.value = "builtin";
});

watch(referenceOptions, (options) => {
  if (referenceAssetId.value && !options.some((option) => option.id === referenceAssetId.value)) {
    referenceAssetId.value = options[0]?.id ?? null;
  }
});

function chooseReferenceMode(): void {
  if (referenceOptions.value.length === 0) {
    toast(i18n.t("ai.voiceoverReferenceEmpty"));
    layout.openTab("media");
    return;
  }
  voiceMode.value = "reference";
}

const ttsNote = computed(() => {
  if (referenceAsrRunning.value && voiceMode.value === "reference" && needsReferenceText.value) {
    return i18n.t("ai.voiceoverTranscribing");
  }
  if (ttsDownloading.value) {
    return i18n.t("ai.voiceoverDownloadingModel", { source: downloadSource.value });
  }
  if (tts.running && tts.message) return tts.message;
  if (selectedCloudProvider.value) {
    const provider = selectedCloudProvider.value;
    const voice = selectedVoiceId.value || provider.voice;
    return voice
      ? i18n.t("ai.voiceoverCloudNote", { name: provider.name, voice })
      : i18n.t("ai.voiceoverCloudNoteNoVoice", { name: provider.name });
  }
  if (!ttsReady.value) {
    return i18n.t("ai.modelNeedsDownload", { size: humanSize(ttsMissing.value) });
  }
  return textClips.value.length > 0
    ? i18n.t("ai.voiceoverSelected", { count: textClips.value.length })
    : i18n.t("ai.voiceoverNoText");
});

async function requestTtsModelDownload(): Promise<void> {
  const model = selectedTtsModel.value;
  if (!model) return;
  const codec = ttsCodecRequired.value ? ttsCodec.value : null;
  const pending = !model.installed ? model : codec && !codec.installed ? codec : null;
  if (!pending) return;

  const accepted = await confirm({
    title: i18n.t("dialog.downloadModelTitle"),
    message: i18n.t("dialog.downloadModelMessage", {
      name: pending.name,
      size: humanSize(ttsMissing.value),
    }),
    confirmText: i18n.t("dialog.downloadModelOk"),
    cancelText: i18n.t("common.cancel"),
  });
  if (!accepted) return;

  layout.openTab("models");
  try {
    if (!model.installed) await models.download(model.id);
    if (codec && !codec.installed) await models.download(codec.id);
  } catch {
    // 错误已写进 models.error，下载管理器会显示。
  }
}

async function placeTtsResults(results: TtsAudio[], clips: Clip[]): Promise<void> {
  if (results.length === 0) return;

  const imported: { result: TtsAudio; asset: MediaAsset }[] = [];
  for (const result of results) {
    imported.push({ result, asset: await importAssetAt(result.path) });
  }

  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  project.dispatch(
    (doc) => {
      let next = doc;
      for (const { result, asset } of imported) {
        const spoken = (byId.get(result.id)?.text ?? "").trim().replace(/\s+/g, " ");
        next = addAsset(next, spoken ? { ...asset, name: spoken.slice(0, 30) } : asset);
      }
      return placeVoiceover(
        next,
        imported.map(({ result, asset }) => {
          const text = byId.get(result.id);
          return {
            id: result.id,
            assetId: asset.id,
            start: text?.start ?? 0,
            duration: result.duration,
          };
        }),
        i18n.t("ai.voiceoverTrack"),
      );
    },
    { kind: "ui.dispatch", actor: "human", label: i18n.t("ai.voiceover") },
  );
  toast(i18n.t("ai.voiceoverDone", { count: imported.length }));
}

function handleVoiceoverError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("已取消")) {
    toast(i18n.t("ai.voiceoverCancelled"));
    return;
  }
  toast(i18n.t("ai.voiceoverFailed", { error: message }), "error");
}

async function generateVoiceover(): Promise<void> {
  if (ttsBusy.value) return;

  const cloudProvider = selectedCloudProvider.value;
  const localModel = selectedTtsModel.value;
  if (!cloudProvider && !localModel) return;
  if (!ttsReady.value) {
    await requestTtsModelDownload();
    return;
  }

  const clips = textClips.value;
  if (clips.length === 0) {
    toast(i18n.t("ai.voiceoverNoText"));
    return;
  }

  const items = clips.map((clip) => ({ id: clip.id, text: (clip.text ?? "").trim() }));

  if (cloudProvider) {
    try {
      const results = await tts.synthesizeCloud(
        cloudProvider.id,
        items,
        selectedVoiceId.value,
      );
      await placeTtsResults(results, clips);
    } catch (error) {
      handleVoiceoverError(error);
    }
    return;
  }

  if (!localModel) return;

  const reference = voiceMode.value === "reference" ? referenceAsset.value : null;
  if (voiceMode.value === "reference" && !reference) {
    toast(i18n.t("ai.voiceoverReferenceMissing"), "error");
    return;
  }

  if (needsReferenceText.value && voiceMode.value === "reference") {
    if (!referenceText.value.trim() && reference && asrModel.value) {
      await transcribeReference(reference);
    }
    if (!referenceText.value.trim()) {
      if (referenceAsrRunning.value) toast(i18n.t("ai.voiceoverTranscribing"));
      else toast(i18n.t("ai.voiceoverReferenceTextMissing"), "error");
      return;
    }
  }

  try {
    const results = await tts.synthesize(
      localModel.id,
      items,
      voiceMode.value === "builtin" ? selectedVoiceId.value : null,
      reference?.src ?? null,
      needsReferenceText.value && voiceMode.value === "reference"
        ? referenceText.value.trim()
        : null,
    );
    await placeTtsResults(results, clips);
  } catch (error) {
    handleVoiceoverError(error);
  }
}

// ---- 音频 AI：降噪 / 分离 / 翻译 ----

/** 音频处理只作用于明确选中的片段，避免误改时间线上的第一段。 */
const selectedAudio = computed<{ clip: Clip; asset: MediaAsset } | null>(() => {
  const clip = selectedClip.value;
  const asset = selectedAsset.value;
  if (!clip || !usableAsset(asset) || clip.duration <= 0) return null;
  return { clip, asset };
});

function audioErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleAudioError(error: unknown): void {
  const message = audioErrorText(error);
  if (message.includes("已取消")) {
    toast(i18n.t("audio.cancelled"));
    return;
  }
  toast(message, "error");
}

/** 缺模型时确认 → 跳到下载管理器 → 下载完成后再回到调用方。 */
async function ensureInstalled(model: ModelStatus | null, size: number): Promise<boolean> {
  if (!model) return false;
  if (model.installed) return true;
  const accepted = await confirm({
    title: i18n.t("dialog.downloadModelTitle"),
    message: i18n.t("dialog.downloadModelMessage", {
      name: model.name,
      size: humanSize(size),
    }),
    confirmText: i18n.t("dialog.downloadModelOk"),
    cancelText: i18n.t("common.cancel"),
  });
  if (!accepted) return false;
  layout.openTab("models");
  try {
    await models.download(model.id);
    return true;
  } catch {
    return false;
  }
}

// 降噪
const denoiseModel = computed(
  () => models.catalog.find((model) => model.feature === "enhance") ?? null,
);
const denoiseReady = computed(() => Boolean(denoiseModel.value?.installed));
const denoiseMissing = computed(() =>
  denoiseModel.value ? missingBytes(denoiseModel.value) : 0,
);

async function generateDenoise(): Promise<void> {
  const current = selectedAudio.value;
  if (!current) {
    toast(i18n.t("audio.selectClip"));
    return;
  }
  const model = denoiseModel.value;
  if (!model) {
    toast(i18n.t("audio.noDenoiseModel"));
    layout.openTab("models");
    return;
  }
  if (!(await ensureInstalled(model, denoiseMissing.value))) return;

  try {
    const result = await audioAi.denoise(
      current.asset.src,
      current.clip.in ?? 0,
      current.clip.duration,
      model.id,
    );
    const generated = await importAssetAt(result.path);
    project.dispatch(
      (doc) => {
        const withAsset = addAsset(doc, generated);
        return applyProcessedAudio(
          withAsset,
          current.clip,
          generated.id,
          result.duration,
          current.asset.kind,
          i18n.t("audio.aiDenoiseTrack"),
        );
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("audio.aiDenoise") },
    );
    toast(i18n.t("audio.denoiseDone"));
  } catch (error) {
    handleAudioError(error);
  }
}

// 人声分离
const separateModels = computed(() =>
  models.catalog.filter((model) => model.feature === "separate"),
);
const selectedSeparateId = ref<string | null>(null);

watch(
  separateModels,
  (list) => {
    if (list.length === 0) return;
    if (
      selectedSeparateId.value &&
      list.some((model) => model.id === selectedSeparateId.value)
    ) {
      return;
    }
    // 视频剪辑优先用 UVR 做人声/伴奏提取；HTDemucs 留给音乐分轨。
    // 已安装的模型先用（其中 UVR 优先），都没有时才默认推荐 UVR Voc_FT。
    const preferred =
      list.find((model) => model.family === "uvr" && model.installed) ??
      list.find((model) => model.installed) ??
      list.find((model) => model.id === "uvr-mdx-voc-ft") ??
      list.find((model) => model.family === "uvr") ??
      list[0];
    selectedSeparateId.value = preferred.id;
  },
  { immediate: true },
);

const separateModel = computed(
  () => separateModels.value.find((model) => model.id === selectedSeparateId.value) ?? null,
);
const separateReady = computed(() => Boolean(separateModel.value?.installed));
const separateMissing = computed(() =>
  separateModel.value ? missingBytes(separateModel.value) : 0,
);
const separateOptions = computed<SelectOption[]>(() =>
  separateModels.value.map((model) => ({
    id: model.id,
    label: model.name,
    hint: model.installed
      ? i18n.t("ai.modelReady")
      : i18n.t("ai.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
  })),
);

function stemLabel(name: string): string {
  const key = `audio.stem.${name}`;
  const label = i18n.t(key);
  return label === key ? name : label;
}

async function generateSeparation(): Promise<void> {
  const current = selectedAudio.value;
  if (!current) {
    toast(i18n.t("audio.selectClip"));
    return;
  }
  const model = separateModel.value;
  if (!model) {
    toast(i18n.t("audio.noSeparateModel"));
    layout.openTab("models");
    return;
  }
  if (!(await ensureInstalled(model, separateMissing.value))) return;

  try {
    const stems = await audioAi.separate(
      current.asset.src,
      current.clip.in ?? 0,
      current.clip.duration,
      model.id,
    );
    const imported: { stem: AudioStem; asset: MediaAsset }[] = [];
    for (const stem of stems) {
      imported.push({ stem, asset: await importAssetAt(stem.path) });
    }
    project.dispatch(
      (doc) => {
        let next = doc;
        for (const item of imported) next = addAsset(next, item.asset);
        return addStemTracks(
          next,
          current.clip,
          imported.map(({ stem, asset }) => ({
            label: stemLabel(stem.name),
            assetId: asset.id,
            duration: stem.duration,
          })),
          i18n.t("audio.stemTrack"),
          true,
        );
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("audio.separate") },
    );
    toast(i18n.t("audio.separateDone", { count: stems.length }));
  } catch (error) {
    handleAudioError(error);
  }
}

// 音频翻译（ASR → LLM → 可选 TTS 配音）
const TRANSLATE_LANGUAGES = [
  { id: "en", labelKey: "audio.lang.en", prompt: "English" },
  { id: "zh", labelKey: "audio.lang.zh", prompt: "Simplified Chinese" },
  { id: "ja", labelKey: "audio.lang.ja", prompt: "Japanese" },
  { id: "ko", labelKey: "audio.lang.ko", prompt: "Korean" },
  { id: "es", labelKey: "audio.lang.es", prompt: "Spanish" },
  { id: "fr", labelKey: "audio.lang.fr", prompt: "French" },
  { id: "de", labelKey: "audio.lang.de", prompt: "German" },
] as const;

const translateLanguage = ref<string>("en");
const translateDub = ref(false);
const translationRunning = ref(false);
const translateOptions = computed<SelectOption[]>(() =>
  TRANSLATE_LANGUAGES.map((language) => ({
    id: language.id,
    label: i18n.t(language.labelKey),
  })),
);
const translatePrompt = computed(
  () =>
    TRANSLATE_LANGUAGES.find((language) => language.id === translateLanguage.value)
      ?.prompt ?? "English",
);
const dubModel = computed(() => ttsModels.value.find((model) => model.installed) ?? null);
const translationBusy = computed(
  () => translationRunning.value || asr.running || tts.running || audioAi.running,
);
const translationProgress = computed(() =>
  asr.running ? asr.progressPct : tts.running ? tts.progressPct : audioAi.progressPct,
);

async function generateTranslation(): Promise<void> {
  if (translationBusy.value) return;
  const current = selectedAudio.value;
  if (!current) {
    toast(i18n.t("audio.selectClip"));
    return;
  }
  const model = selectedModel.value;
  if (!model) {
    toast(i18n.t("ai.subtitleNoModel"));
    layout.openTab("models");
    return;
  }
  if (!ready.value) {
    await requestModelDownload();
    return;
  }
  const dub = dubModel.value;
  const wantDub = translateDub.value && dub !== null;
  if (translateDub.value && !wantDub) {
    // 没有本地朗读模型时不阻断翻译：先出译文字幕。
    toast(i18n.t("audio.dubNoModel"));
  }

  translationRunning.value = true;
  try {
    const cues = await asr.generate(current.asset.src, model.id, "auto");
    const fps = project.doc.fps;
    const mapped = cues
      .map((cue) => mapCueToTimeline(cue, current.clip, fps))
      .filter((cue): cue is TimelineSubtitle => cue !== null);
    if (mapped.length === 0) {
      toast(i18n.t("ai.subtitleEmpty"));
      return;
    }

    const translated = await audioAi.translate(
      mapped.map((cue) => cue.text),
      translatePrompt.value,
    );
    if (translated.length !== mapped.length) {
      throw new Error(i18n.t("audio.translateCountMismatch"));
    }

    // 1) 译文字幕轨
    const subtitleBase = i18n.t("audio.translatedSubtitleTrack");
    project.dispatch(
      (doc) => {
        let name = subtitleBase;
        let index = 2;
        while (doc.tracks.some((track) => track.name === name)) {
          name = `${subtitleBase} ${index++}`;
        }
        let next = addTrackAt(doc, 0, name);
        const trackId = next.tracks[0].id;
        mapped.forEach((cue, index) => {
          next = addClip(
            next,
            trackId,
            createClip({
              assetId: "",
              trackId,
              start: cue.start,
              duration: cue.duration,
              text: translated[index],
            }),
          );
        });
        return next;
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("audio.translate") },
    );

    // 2) 可选配音：默认用原片前 10 秒做参考音色
    if (wantDub && dub) {
      try {
        const referenceText = mapped
          .filter((cue) => cue.start - current.clip.start < 10)
          .map((cue) => cue.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const reference = referenceText
          ? await audioExtractReference(
              current.asset.src,
              current.clip.in ?? 0,
              Math.min(current.clip.duration, 10),
            )
          : null;
        const items = translated.map((text, index) => ({
          id: String(index),
          text,
        }));
        const audios = await tts.synthesize(
          dub.id,
          items,
          null,
          reference?.path ?? null,
          referenceText || null,
        );
        const imported: { audio: TtsAudio; asset: MediaAsset }[] = [];
        for (const audio of audios) {
          imported.push({ audio, asset: await importAssetAt(audio.path) });
        }
        project.dispatch(
          (doc) => {
            let next = doc;
            for (const item of imported) next = addAsset(next, item.asset);
            // 译制配音时关掉原声（视频画面保留）。
            next = setClipMuted(next, current.clip.id, true);
            return placeVoiceover(
              next,
              imported.map(({ audio, asset }) => ({
                id: audio.id,
                assetId: asset.id,
                start: mapped[Number(audio.id)]?.start ?? current.clip.start,
                duration: audio.duration,
              })),
              i18n.t("audio.dubTrack"),
            );
          },
          { kind: "ui.dispatch", actor: "human", label: i18n.t("audio.dub") },
        );
        toast(i18n.t("audio.translateDoneDub", { count: translated.length }));
      } catch (error) {
        toast(
          i18n.t("audio.dubFailed", { error: audioErrorText(error) }),
          "error",
        );
      }
    } else {
      toast(i18n.t("audio.translateDone", { count: translated.length }));
    }
  } catch (error) {
    handleAudioError(error);
  } finally {
    translationRunning.value = false;
  }
}

// ---- 画面 AI：超分 / 补帧 / 智能裁剪 / 镜头追踪 ----

const videoSourceLabel = computed(() =>
  selectedVideo.value
    ? i18n.t("videoAi.source", { name: selectedVideo.value.asset.name })
    : i18n.t("videoAi.selectClip"),
);

const superresModels = computed(() =>
  models.catalog.filter((model) => model.feature === "superres"),
);
const interpolateModel = computed(
  () => models.catalog.find((model) => model.feature === "interpolate") ?? null,
);
const trackModel = computed(
  () => models.catalog.find((model) => model.feature === "track") ?? null,
);
const faceModel = computed(
  () => models.catalog.find((model) => model.feature === "reframe") ?? null,
);

const selectedUpscaleId = ref<string | null>(null);
watch(
  superresModels,
  (list) => {
    if (list.length === 0) return;
    if (
      selectedUpscaleId.value &&
      list.some((model) => model.id === selectedUpscaleId.value)
    ) {
      return;
    }
    const preferred =
      list.find((model) => model.installed) ??
      list.find((model) => model.id === "realesr-general-x4v3") ??
      list[0];
    selectedUpscaleId.value = preferred.id;
  },
  { immediate: true },
);

const upscaleModel = computed(
  () => superresModels.value.find((model) => model.id === selectedUpscaleId.value) ?? null,
);
const upscaleOptions = computed<SelectOption[]>(() =>
  superresModels.value.map((model) => ({
    id: model.id,
    label: model.name,
    hint: model.installed
      ? i18n.t("ai.modelReady")
      : i18n.t("ai.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
  })),
);
const upscaleScale = ref(2);
const upscaleReady = computed(() => Boolean(upscaleModel.value?.installed));
const upscaleMissing = computed(() =>
  upscaleModel.value ? missingBytes(upscaleModel.value) : 0,
);

const interpolateFactor = ref(2);
const interpolateReady = computed(() => Boolean(interpolateModel.value?.installed));
const interpolateMissing = computed(() =>
  interpolateModel.value ? missingBytes(interpolateModel.value) : 0,
);

const cropSubject = ref<string>("face");
const cropAspect = ref<string>("9:16");
const cropHeight = ref<string>("1080");
const cropSmooth = ref<string>("0.6");

const trackSubject = ref<string>("person");
const trackAspect = ref<string>("9:16");
const trackHeight = ref<string>("1080");
const trackSmooth = ref<string>("0.6");

const subjectOptions = computed<SelectOption[]>(() => [
  { id: "face", label: i18n.t("videoAi.subjectFace") },
  { id: "person", label: i18n.t("videoAi.subjectPerson") },
  { id: "auto", label: i18n.t("videoAi.subjectAuto") },
  { id: "center", label: i18n.t("videoAi.subjectCenter") },
]);
const cropSubjectOptions = computed(() =>
  subjectOptions.value.filter((option) => option.id !== "person"),
);
const trackSubjectOptions = computed(() =>
  subjectOptions.value.filter((option) => option.id !== "auto"),
);
const aspectOptions = computed<SelectOption[]>(() => [
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "source", label: i18n.t("videoAi.aspectSource") },
]);
const heightOptions: SelectOption[] = [
  { id: "720", label: "720p" },
  { id: "1080", label: "1080p" },
  { id: "1440", label: "1440p" },
];
const smoothOptions = computed<SelectOption[]>(() => [
  { id: "0.3", label: i18n.t("videoAi.smoothLow") },
  { id: "0.6", label: i18n.t("videoAi.smoothMedium") },
  { id: "0.85", label: i18n.t("videoAi.smoothHigh") },
]);

function reframeReady(subject: string): boolean {
  if (subject === "center") return true;
  if (subject === "face") return Boolean(faceModel.value?.installed);
  if (subject === "person") return Boolean(trackModel.value?.installed);
  return Boolean(faceModel.value?.installed && trackModel.value?.installed);
}

function reframeMissing(subject: string): number {
  let total = 0;
  if ((subject === "face" || subject === "auto") && faceModel.value) {
    total += missingBytes(faceModel.value);
  }
  if ((subject === "person" || subject === "auto") && trackModel.value) {
    total += missingBytes(trackModel.value);
  }
  return total;
}

const cropReady = computed(() => reframeReady(cropSubject.value));
const trackReady = computed(() => reframeReady(trackSubject.value));
const cropMissing = computed(() => reframeMissing(cropSubject.value));
const trackMissing = computed(() => reframeMissing(trackSubject.value));
const runningReframe = ref<"crop" | "track" | null>(null);

async function ensureReframeModels(subject: string): Promise<boolean> {
  if (subject === "center") return true;
  const needed: ModelStatus[] = [];
  if (subject === "face" || subject === "auto") {
    if (!faceModel.value) return false;
    if (!faceModel.value.installed) needed.push(faceModel.value);
  }
  if (subject === "person" || subject === "auto") {
    if (!trackModel.value) return false;
    if (!trackModel.value.installed) needed.push(trackModel.value);
  }
  for (const model of needed) {
    if (!(await ensureInstalled(model, missingBytes(model)))) return false;
  }
  return true;
}

function handleVideoError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("已取消")) {
    toast(i18n.t("videoAi.cancelled"));
    return;
  }
  toast(i18n.t("videoAi.failed", { error: message }), "error");
}

async function applyVideoResult(
  result: VideoProcessed,
  clip: Clip,
  sourceName: string,
  label: string,
): Promise<void> {
  const generated = await importAssetAt(result.path);
  const asset = { ...generated, name: `${sourceName} · ${label}` };
  project.dispatch(
    (doc) => {
      const withAsset = addAsset(doc, asset);
      return replaceClipVideo(
        withAsset,
        clip.id,
        asset.id,
        result.duration,
        clip.duration,
      );
    },
    { kind: "ui.dispatch", actor: "human", label },
  );
  toast(i18n.t("videoAi.done", { name: label }));
}

async function applyUpscale(): Promise<void> {
  const current = selectedVideo.value;
  if (!current) {
    toast(i18n.t("videoAi.selectClip"));
    return;
  }
  const model = upscaleModel.value;
  if (!model) {
    toast(i18n.t("videoAi.noModel"));
    layout.openTab("models");
    return;
  }
  if (!(await ensureInstalled(model, missingBytes(model)))) return;

  try {
    const result = await videoAi.upscale(
      current.asset.src,
      current.clip.in ?? 0,
      current.clip.duration,
      current.asset.fps ?? project.doc.fps,
      model.id,
      upscaleScale.value,
    );
    await applyVideoResult(
      result,
      current.clip,
      current.asset.name,
      i18n.t("videoAi.upscale"),
    );
  } catch (error) {
    handleVideoError(error);
  }
}

async function applyInterpolate(): Promise<void> {
  const current = selectedVideo.value;
  if (!current) {
    toast(i18n.t("videoAi.selectClip"));
    return;
  }
  const model = interpolateModel.value;
  if (!model) {
    toast(i18n.t("videoAi.noModel"));
    layout.openTab("models");
    return;
  }
  if (!(await ensureInstalled(model, missingBytes(model)))) return;

  try {
    const result = await videoAi.interpolate(
      current.asset.src,
      current.clip.in ?? 0,
      current.clip.duration,
      current.asset.fps ?? project.doc.fps,
      model.id,
      interpolateFactor.value,
    );
    await applyVideoResult(
      result,
      current.clip,
      current.asset.name,
      i18n.t("videoAi.interpolate"),
    );
  } catch (error) {
    handleVideoError(error);
  }
}

async function applyReframe(mode: "crop" | "track"): Promise<void> {
  const current = selectedVideo.value;
  if (!current) {
    toast(i18n.t("videoAi.selectClip"));
    return;
  }
  const subject = mode === "crop" ? cropSubject.value : trackSubject.value;
  const aspect = mode === "crop" ? cropAspect.value : trackAspect.value;
  const height = Number(mode === "crop" ? cropHeight.value : trackHeight.value);
  const smooth = Number(mode === "crop" ? cropSmooth.value : trackSmooth.value);
  if (!(await ensureReframeModels(subject))) {
    if (!faceModel.value && !trackModel.value) {
      toast(i18n.t("videoAi.noModel"));
      layout.openTab("models");
    }
    return;
  }

  runningReframe.value = mode;
  try {
    const result = await videoAi.reframe(
      current.asset.src,
      current.clip.in ?? 0,
      current.clip.duration,
      current.asset.fps ?? project.doc.fps,
      trackModel.value?.id ?? null,
      faceModel.value?.id ?? null,
      subject as VideoAiSubject,
      aspect as VideoAiAspect,
      height,
      smooth,
    );
    await applyVideoResult(
      result,
      current.clip,
      current.asset.name,
      i18n.t(mode === "crop" ? "videoAi.crop" : "videoAi.track"),
    );
  } catch (error) {
    handleVideoError(error);
  } finally {
    runningReframe.value = null;
  }
}

onMounted(() => {
  void refresh();
  models.watchProgress();
  tts.watch();
  audioAi.watch();
  videoAi.watch();
  void tts.loadProviders(true);
  if (models.catalog.length === 0) void models.load();
});
</script>

<template>
  <div class="pane">
    <div class="tags" role="group" :aria-label="i18n.t('ai.tagFilter')">
      <button
        v-for="tag in TAG_FILTERS"
        :key="tag"
        class="chip"
        :class="{ on: activeTag === tag }"
        :aria-pressed="activeTag === tag"
        @click="activeTag = tag"
      >
        {{ i18n.t(`ai.tags.${tag}`) }}
      </button>
    </div>

    <!-- 基础设施：只在「全部」里出现，避免在具体能力标签下干扰阅读。 -->
    <ul v-if="activeTag === 'all'" class="list">
      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">{{ i18n.t("ai.agent") }}</span>
            <span class="item-note">{{ i18n.t("ai.agentHint") }}</span>
          </div>
          <button class="run-btn" @click="openAgent">
            <ChatBubbleLeftRightIcon class="w-[14px] h-[14px]" />
            {{ i18n.t("ai.run") }}
          </button>
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">{{ i18n.t("ai.mcpServer") }}</span>
            <span class="item-note">
              {{ mcpOn ? i18n.t("ai.mcpOn") : i18n.t("ai.mcpOff") }}
            </span>
          </div>
          <button
            class="switch"
            role="switch"
            :class="{ on: mcpOn }"
            :aria-checked="mcpOn"
            :disabled="saving"
            :aria-label="mcpOn ? i18n.t('ai.mcpToggleOff') : i18n.t('ai.mcpToggleOn')"
            @click="toggleMcp"
          >
            <span class="knob" />
          </button>
        </div>
        <div v-if="endpoint" class="item-row">
          <div class="item-main">
            <span class="item-note">{{ i18n.t("ai.endpoint") }}</span>
            <span class="item-name endpoint">{{ endpoint }}</span>
          </div>
          <button class="iface-btn" @click="copyEndpoint">
            <ClipboardDocumentIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("ai.copy") }}
          </button>
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">{{ i18n.t("ai.cli") }}</span>
            <span class="item-note">{{ i18n.t("ai.cliHint") }}</span>
          </div>
          <button class="iface-btn" @click="openCliSettings">
            <BoltIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("ai.openCli") }}
          </button>
        </div>
      </li>
    </ul>

    <div v-if="activeTag === 'all'" class="section-label">{{ i18n.t("ai.textFeatures") }}</div>

    <ul v-if="activeTag === 'all' || activeTag === 'text'" class="list">
      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("ai.subtitles") }}
              <span class="badge" :class="{ on: ready }">
                {{ i18n.t(ready ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ sourceLabel }}</span>
          </div>
          <button v-if="subtitleRunning" class="run-btn" @click="stop">
            {{ i18n.t("ai.stop") }}
          </button>
          <button v-else class="run-btn" @click="generateSubtitles">
            {{
              ready
                ? i18n.t("ai.subtitleGenerate")
                : i18n.t("ai.subtitleDownloadModel", { size: humanSize(missing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("ai.subtitleModel") }}</span>
          <Md3Select
            v-model="selectedModelId"
            :options="modelOptions"
            :label="i18n.t('ai.subtitleModel')"
            :disabled="asr.running"
          />
        </div>

        <div class="item-row">
          <div class="item-main">
            <span class="item-note">{{ i18n.t("ai.subtitleHint") }}</span>
          </div>
          <button class="iface-btn" @click="layout.openTab('models')">
            <CpuChipIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("ai.manageModels") }}
          </button>
        </div>

        <div v-if="subtitleRunning" class="progress">
          <div class="progress-fill" :style="{ width: `${asr.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("ai.voiceover") }}
              <span class="badge" :class="{ on: ttsReady }">
                {{ i18n.t(ttsReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ ttsNote }}</span>
          </div>
          <button v-if="ttsBusy" class="run-btn" @click="stop">
            {{ i18n.t("ai.stop") }}
          </button>
          <button v-else class="run-btn" :disabled="referenceAsrRunning" @click="generateVoiceover">
            {{
              ttsReady
                ? i18n.t("ai.voiceoverGenerate")
                : i18n.t("ai.voiceoverDownloadModel", { size: humanSize(ttsMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("ai.voiceoverModel") }}</span>
          <Md3Select
            v-model="selectedTtsModelId"
            :options="ttsModelOptions"
            :label="i18n.t('ai.voiceoverModel')"
            :disabled="ttsBusy"
            @action="onTtsSelectAction"
          />
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("ai.voiceoverVoice") }}</span>
          <div class="voice-modes" role="group" :aria-label="i18n.t('ai.voiceoverVoice')">
            <button
              class="chip"
              :class="{ on: voiceMode === 'builtin' }"
              :aria-pressed="voiceMode === 'builtin'"
              :disabled="ttsBusy || ttsVoiceList.length === 0"
              @click="voiceMode = 'builtin'"
            >
              {{ i18n.t("ai.voiceoverVoiceBuiltin") }}
            </button>
            <button
              class="chip"
              :class="{ on: voiceMode === 'reference' }"
              :aria-pressed="voiceMode === 'reference'"
              :disabled="ttsBusy || !!selectedCloudProvider"
              @click="chooseReferenceMode"
            >
              {{ i18n.t("ai.voiceoverVoiceReference") }}
            </button>
          </div>
        </div>

        <div v-if="voiceMode === 'builtin'" class="param-field">
          <span class="param-name">{{ i18n.t("ai.voiceoverTimbre") }}</span>
          <Md3Select
            v-model="selectedVoiceId"
            :options="builtinVoiceOptions"
            :label="i18n.t('ai.voiceoverTimbre')"
            :disabled="ttsBusy || loadingVoices"
          />
        </div>

        <div v-else class="param-field">
          <span class="param-name">{{ i18n.t("ai.voiceoverReference") }}</span>
          <Md3Select
            v-model="referenceAssetId"
            :options="referenceOptions"
            :label="i18n.t('ai.voiceoverReference')"
            :disabled="ttsBusy || referenceAsrRunning"
          />
        </div>

        <template v-if="voiceMode === 'reference' && needsReferenceText">
          <div class="param-field">
            <span class="param-name">{{ i18n.t("ai.voiceoverReferenceText") }}</span>
            <input
              v-model="referenceText"
              class="ref-text-input"
              :placeholder="i18n.t('ai.voiceoverReferenceTextPlaceholder')"
              :disabled="ttsBusy || referenceAsrRunning"
            />
          </div>
          <div class="item-row">
            <div class="item-main">
              <span class="item-note">
                {{
                  asrModel
                    ? i18n.t("ai.voiceoverReferenceTextHint")
                    : i18n.t("ai.voiceoverReferenceTextNoAsr")
                }}
              </span>
            </div>
            <button
              class="iface-btn"
              :disabled="ttsBusy || referenceAsrRunning || !referenceAsset || !asrModel"
              @click="transcribeReference(referenceAsset)"
            >
              {{
                referenceAsrRunning
                  ? i18n.t("ai.voiceoverTranscribing")
                  : i18n.t("ai.voiceoverTranscribe")
              }}
            </button>
          </div>
        </template>

        <div class="item-row">
          <div class="item-main">
            <span class="item-note">{{ i18n.t("ai.voiceoverHint") }}</span>
          </div>
          <button
            class="iface-btn"
            @click="selectedCloudProvider ? openTtsSettings() : layout.openTab('models')"
          >
            <CpuChipIcon class="w-[13px] h-[13px]" />
            {{
              i18n.t(
                selectedCloudProvider ? "ai.ttsSettings" : "ai.manageModels",
              )
            }}
          </button>
        </div>

        <div v-if="tts.running" class="progress">
          <div class="progress-fill" :style="{ width: `${tts.progressPct}%` }" />
        </div>
        <div v-else-if="referenceAsrRunning" class="progress">
          <div class="progress-fill" :style="{ width: `${asr.progressPct}%` }" />
        </div>
      </li>
    </ul>

    <!-- 画面 AI：超分 / 补帧 / 智能裁剪 / 镜头追踪 -->
    <div v-if="activeTag === 'all'" class="section-label">
      {{ i18n.t("videoAi.section") }}
    </div>
    <ul v-if="activeTag === 'all' || activeTag === 'visual'" class="list">
      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("videoAi.upscale") }}
              <span class="badge" :class="{ on: upscaleReady }">
                {{ i18n.t(upscaleReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ videoSourceLabel }}</span>
          </div>
          <button
            v-if="videoAi.running && videoAi.task === 'upscale'"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="videoAi.running"
            @click="applyUpscale"
          >
            {{
              upscaleReady
                ? i18n.t("videoAi.apply")
                : i18n.t("videoAi.downloadModel", { size: humanSize(upscaleMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.model") }}</span>
          <Md3Select
            v-model="selectedUpscaleId"
            :options="upscaleOptions"
            :label="i18n.t('videoAi.model')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.scale") }}</span>
          <div class="param-chips">
            <button
              v-for="scale in [2, 4]"
              :key="scale"
              class="chip"
              :class="{ on: upscaleScale === scale }"
              :disabled="videoAi.running"
              @click="upscaleScale = scale"
            >
              {{ scale }}x
            </button>
          </div>
        </div>
        <div class="item-row">
          <div class="item-main">
            <span class="item-note">{{ i18n.t("videoAi.upscaleHint") }}</span>
          </div>
        </div>
        <div v-if="videoAi.running && videoAi.task === 'upscale'" class="progress">
          <div class="progress-fill" :style="{ width: `${videoAi.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("videoAi.interpolate") }}
              <span class="badge" :class="{ on: interpolateReady }">
                {{ i18n.t(interpolateReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">
              {{ interpolateModel?.name ?? videoSourceLabel }}
            </span>
          </div>
          <button
            v-if="videoAi.running && videoAi.task === 'interpolate'"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="videoAi.running"
            @click="applyInterpolate"
          >
            {{
              interpolateReady
                ? i18n.t("videoAi.apply")
                : i18n.t("videoAi.downloadModel", { size: humanSize(interpolateMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.factor") }}</span>
          <div class="param-chips">
            <button
              v-for="factor in [2, 4]"
              :key="factor"
              class="chip"
              :class="{ on: interpolateFactor === factor }"
              :disabled="videoAi.running"
              @click="interpolateFactor = factor"
            >
              {{ factor }}x
            </button>
          </div>
        </div>
        <div class="item-row">
          <div class="item-main">
            <span class="item-note">{{ i18n.t("videoAi.interpolateHint") }}</span>
          </div>
        </div>
        <div v-if="videoAi.running && videoAi.task === 'interpolate'" class="progress">
          <div class="progress-fill" :style="{ width: `${videoAi.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("videoAi.crop") }}
              <span class="badge" :class="{ on: cropReady }">
                {{ i18n.t(cropReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("videoAi.cropHint") }}</span>
          </div>
          <button
            v-if="videoAi.running && videoAi.task === 'reframe' && runningReframe === 'crop'"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="videoAi.running"
            @click="applyReframe('crop')"
          >
            {{
              cropReady
                ? i18n.t("videoAi.apply")
                : i18n.t("videoAi.downloadModel", { size: humanSize(cropMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.subject") }}</span>
          <Md3Select
            v-model="cropSubject"
            :options="cropSubjectOptions"
            :label="i18n.t('videoAi.subject')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.aspect") }}</span>
          <Md3Select
            v-model="cropAspect"
            :options="aspectOptions"
            :label="i18n.t('videoAi.aspect')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.height") }}</span>
          <Md3Select
            v-model="cropHeight"
            :options="heightOptions"
            :label="i18n.t('videoAi.height')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.smooth") }}</span>
          <Md3Select
            v-model="cropSmooth"
            :options="smoothOptions"
            :label="i18n.t('videoAi.smooth')"
            :disabled="videoAi.running"
          />
        </div>
        <div
          v-if="videoAi.running && videoAi.task === 'reframe' && runningReframe === 'crop'"
          class="progress"
        >
          <div class="progress-fill" :style="{ width: `${videoAi.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("videoAi.track") }}
              <span class="badge" :class="{ on: trackReady }">
                {{ i18n.t(trackReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("videoAi.trackHint") }}</span>
          </div>
          <button
            v-if="videoAi.running && videoAi.task === 'reframe' && runningReframe === 'track'"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="videoAi.running"
            @click="applyReframe('track')"
          >
            {{
              trackReady
                ? i18n.t("videoAi.apply")
                : i18n.t("videoAi.downloadModel", { size: humanSize(trackMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.subject") }}</span>
          <Md3Select
            v-model="trackSubject"
            :options="trackSubjectOptions"
            :label="i18n.t('videoAi.subject')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.aspect") }}</span>
          <Md3Select
            v-model="trackAspect"
            :options="aspectOptions"
            :label="i18n.t('videoAi.aspect')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.height") }}</span>
          <Md3Select
            v-model="trackHeight"
            :options="heightOptions"
            :label="i18n.t('videoAi.height')"
            :disabled="videoAi.running"
          />
        </div>
        <div class="param-field">
          <span class="param-name">{{ i18n.t("videoAi.smooth") }}</span>
          <Md3Select
            v-model="trackSmooth"
            :options="smoothOptions"
            :label="i18n.t('videoAi.smooth')"
            :disabled="videoAi.running"
          />
        </div>
        <div
          v-if="videoAi.running && videoAi.task === 'reframe' && runningReframe === 'track'"
          class="progress"
        >
          <div class="progress-fill" :style="{ width: `${videoAi.progressPct}%` }" />
        </div>
      </li>
    </ul>

    <!-- 音频 AI：降噪 / 提取 / 翻译 -->
    <div v-if="activeTag === 'all'" class="section-label">
      {{ i18n.t("ai.audioFeatures") }}
    </div>
    <ul v-if="activeTag === 'all' || activeTag === 'audio'" class="list">
      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("audio.aiDenoise") }}
              <span class="badge" :class="{ on: denoiseReady }">
                {{ i18n.t(denoiseReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("audio.aiDenoiseHint") }}</span>
          </div>
          <button
            v-if="audioAi.running && audioAi.task === 'denoise' && audioAi.cancellable"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else-if="audioAi.running && audioAi.task === 'denoise'"
            class="run-btn"
            disabled
          >
            {{ i18n.t("audio.processing") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="audioAi.running"
            @click="generateDenoise"
          >
            {{
              denoiseReady
                ? i18n.t("audio.apply")
                : i18n.t("audio.downloadModel", { size: humanSize(denoiseMissing) })
            }}
          </button>
        </div>
        <div v-if="audioAi.running && audioAi.task === 'denoise'" class="progress">
          <div class="progress-fill" :style="{ width: `${audioAi.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("audio.separate") }}
              <span class="badge" :class="{ on: separateReady }">
                {{ i18n.t(separateReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("audio.separateHint") }}</span>
          </div>
          <button
            v-if="audioAi.running && audioAi.task === 'separate' && audioAi.cancellable"
            class="run-btn"
            @click="stop"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else-if="audioAi.running && audioAi.task === 'separate'"
            class="run-btn"
            disabled
          >
            {{ i18n.t("audio.processing") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="audioAi.running"
            @click="generateSeparation"
          >
            {{
              separateReady
                ? i18n.t("audio.apply")
                : i18n.t("audio.downloadModel", { size: humanSize(separateMissing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("audio.separateModel") }}</span>
          <Md3Select
            v-model="selectedSeparateId"
            :options="separateOptions"
            :label="i18n.t('audio.separateModel')"
            :disabled="audioAi.running"
          />
        </div>

        <div v-if="audioAi.running && audioAi.task === 'separate'" class="progress">
          <div class="progress-fill" :style="{ width: `${audioAi.progressPct}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("audio.translate") }}
              <span class="badge" :class="{ on: ready }">
                {{ i18n.t(ready ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("audio.translateHint") }}</span>
          </div>
          <button v-if="translationRunning" class="run-btn" @click="stop">
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="translationBusy"
            @click="generateTranslation"
          >
            {{
              ready
                ? i18n.t("audio.translateApply")
                : i18n.t("ai.subtitleDownloadModel", { size: humanSize(missing) })
            }}
          </button>
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("audio.targetLanguage") }}</span>
          <Md3Select
            v-model="translateLanguage"
            :options="translateOptions"
            :label="i18n.t('audio.targetLanguage')"
            :disabled="translationBusy"
          />
        </div>

        <div class="param-field">
          <span class="param-name">{{ i18n.t("audio.dub") }}</span>
          <ToggleSwitch
            :model-value="translateDub"
            :label="i18n.t('audio.dub')"
            @update:model-value="translateDub = $event"
          />
        </div>

        <div class="item-row">
          <div class="item-main">
            <span class="item-note">
              {{
                translateDub && !dubModel
                  ? i18n.t("audio.dubNoModel")
                  : i18n.t("audio.translateVoiceNote")
              }}
            </span>
          </div>
          <button class="iface-btn" @click="layout.openTab('models')">
            <CpuChipIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("ai.manageModels") }}
          </button>
        </div>

        <div v-if="translationRunning" class="progress">
          <div class="progress-fill" :style="{ width: `${translationProgress}%` }" />
        </div>
      </li>

      <li class="item">
        <div class="item-row">
          <div class="item-main">
            <span class="item-name">
              {{ i18n.t("audio.cutFillers") }}
              <span class="badge" :class="{ on: cutModelReady }">
                {{ i18n.t(cutModelReady ? "ai.modelReady" : "ai.modelMissing") }}
              </span>
            </span>
            <span class="item-note">{{ i18n.t("audio.cutFillersHint") }}</span>
          </div>
          <button
            v-if="cutReview.running"
            class="run-btn"
            @click="cutReview.cancel()"
          >
            {{ i18n.t("ai.stop") }}
          </button>
          <button
            v-else
            class="run-btn"
            :disabled="asr.running || tts.running || audioAi.running"
            @click="startCutReview"
          >
            {{
              cutReview.cuts.length > 0
                ? i18n.t("audio.cutFillersReview")
                : i18n.t("audio.cutFillersRun")
            }}
          </button>
        </div>
        <div v-if="cutReview.running" class="progress">
          <div class="progress-fill" :style="{ width: `${cutReview.progressPct}%` }" />
        </div>
      </li>
    </ul>

  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 0 12px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 12px 10px;
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
.chip:disabled {
  opacity: 0.45;
  cursor: default;
}
.voice-modes {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.ref-text-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
}
.ref-text-input::placeholder {
  color: rgb(var(--md-on-surface-muted));
}
.ref-text-input:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.ref-text-input:disabled {
  opacity: 0.55;
}
.section-label {
  padding: 4px 14px 6px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: rgb(var(--md-on-surface-muted));
}
.list {
  list-style: none;
  margin: 0;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.list + .list {
  margin-top: 8px;
}
.list + .section-label {
  margin-top: 8px;
}
.item {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background-color: var(--app-inset);
}
.item-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.item-name {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.item-note {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.endpoint {
  font-weight: 400;
  word-break: break-all;
  font-size: 12px;
}
.badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  vertical-align: 1px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
}
.badge.on {
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.param-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.param-name {
  flex: 0 0 auto;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
}
.param-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.switch {
  flex: 0 0 auto;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: background-color 0.16s ease;
}
.switch.on {
  background-color: rgb(var(--md-primary));
}
.switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.switch .knob {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface));
  box-shadow: var(--md-elevation-1);
  transform: translateX(0);
  transition: transform 0.16s ease;
}
.switch.on .knob {
  transform: translateX(18px);
}
.switch:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.run-btn {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.14s ease;
}
.run-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.run-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.iface-btn {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease;
}
.iface-btn:hover {
  background-color: rgb(var(--md-primary) / 0.08);
}
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background-color: rgb(var(--md-primary) / 0.15);
}
.progress-fill {
  height: 100%;
  width: 0;
  background-color: rgb(var(--md-primary));
  transition: width 120ms linear;
}
.run-btn:focus-visible,
.iface-btn:focus-visible,
.chip:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch .knob,
  .run-btn,
  .iface-btn,
  .chip,
  .progress-fill {
    transition: none;
  }
}
</style>
