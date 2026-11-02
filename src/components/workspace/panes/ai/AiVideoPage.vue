<script setup lang="ts">
/**
 * **AI 视频生成（MiniMax-H3）**：侧栏里的整页表单。
 *
 * 从 AI 功能列表的卡片进来，左上角返回。和 AI DAW 的写歌页同一套形态：
 * 引擎（sd.cpp）与模型（H3 四件套）各自一段状态，缺什么就只给那一步的按钮，
 * 不让用户对着一个永远点不动的「生成」猜。
 *
 * 生成是**单段**的：H3 的帧数必须是 `17k + 5`，10 秒 = 243 帧。16 GB 显存下
 * 480p 单段现实上限约 175 帧（7.3 秒），更长的片子要在时间线上分段生成再拼。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ArrowLeftIcon } from "@heroicons/vue/24/outline";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { addAsset, addClip, addTrack } from "@/core/ops";
import { createClip } from "@/core/factory";
import { fileUrl, importAssetAt } from "@/core/media";
import { useI18n } from "@/i18n";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSdcppStore } from "@/stores/sdcpp";
import { useVideoGenStore } from "@/stores/videoGen";
import { useModelChoice } from "@/composables/useModelChoice";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { humanSize, missingBytes } from "@/utils/size";
import { framesForSeconds, type VideoGenResult } from "@/types/videoGen";

const emit = defineEmits<{ (e: "back"): void }>();

const i18n = useI18n();
const layout = useLayoutStore();
const models = useModelsStore();
const sdcpp = useSdcppStore();
const videoGen = useVideoGenStore();
const project = useProjectStore();
const playback = usePlaybackStore();

const prompt = ref("");
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

const RESOLUTIONS = [
  { id: "480p", width: 864, height: 480, label: "480p · 864×480" },
  { id: "720p", width: 1280, height: 736, label: "720p · 1280×736" },
  { id: "360p", width: 608, height: 352, label: "360p · 608×352" },
] as const;

const resolution = computed(
  () => RESOLUTIONS.find((item) => item.id === resolutionId.value) ?? RESOLUTIONS[0],
);
const frames = computed(() => framesForSeconds(duration.value));
const actualSeconds = computed(() => frames.value / 24);
const framesText = computed(() =>
  i18n.t("aiVideo.frames", {
    frames: frames.value,
    seconds: actualSeconds.value.toFixed(2),
  }),
);

const {
  list: videoModels,
  current: chosenModel,
  id: modelId,
} = useModelChoice(
  "video-gen",
  () => models.catalog.filter((model) => model.feature === "video-gen"),
  (list) => list.find((model) => model.installed) ?? list.find((model) => model.recommended) ?? list[0] ?? null,
);

const modelOptions = computed<SelectOption[]>(() =>
  videoModels.value.map((model) => ({
    id: model.id,
    label: model.name,
    hint: model.installed
      ? i18n.t("aiVideo.modelReady", { size: humanSize(model.approx_bytes) })
      : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
  })),
);

const modelMissing = computed(() =>
  chosenModel.value ? missingBytes(chosenModel.value) : 0,
);

// ---- 引擎 / 后端 ----
const enginePacks = computed(() => sdcpp.items);
const installedPacks = computed(() => enginePacks.value.filter((pack) => pack.installed));
const engineReady = computed(() => installedPacks.value.length > 0);
const engineDownloading = computed(() => sdcpp.busyId !== null);

const engineLabel = computed(() => {
  const active = enginePacks.value.find((pack) => pack.selected);
  if (active?.installed) return i18n.t(active.label);
  const installed = installedPacks.value[0];
  if (installed) return i18n.t(installed.label);
  return i18n.t("aiVideo.engineMissing");
});

const backendOptions = computed<SelectOption[]>(() =>
  (sdcpp.info?.options ?? [])
    .filter((option) => option.available)
    .map((option) => ({
      id: option.kind,
      label: i18n.t(option.label),
      hint:
        option.kind === "auto"
          ? i18n.t(option.note)
          : option.installed
            ? i18n.t("sdcpp.installed")
            : i18n.t("sdcpp.downloadSize", { size: humanSize(option.bytes) }),
    })),
);

const backendId = computed<string | null>({
  get: () => sdcpp.info?.preference ?? null,
  set: (value) => {
    if (value) void pickBackend(value);
  },
});

async function pickBackend(kind: string): Promise<void> {
  if (backendBusy.value) return;
  const option = sdcpp.info?.options.find((item) => item.kind === kind);
  if (!option) return;
  if (!option.installed) {
    if (kind === "auto") {
      openEngineManager();
      return;
    }
    const accepted = await confirm({
      title: i18n.t("aiVideo.engineMissingTitle"),
      message: i18n.t("aiVideo.engineDownloadBody", {
        name: i18n.t(option.label),
        size: humanSize(option.bytes),
      }),
      confirmText: i18n.t("settings.ai.runtimeMissingGo"),
    });
    if (accepted) openEngineManager(kind);
    return;
  }
  backendBusy.value = true;
  try {
    await sdcpp.setBackend(kind);
    toast(i18n.t("aiVideo.backendSwitched", { name: i18n.t(option.label) }));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    backendBusy.value = false;
  }
}

function openEngineManager(kind?: string): void {
  const target =
    kind && kind !== "auto"
      ? kind
      : sdcpp.info?.recommended ?? sdcpp.info?.preference ?? "cpu";
  sdcpp.requestFocus(`sdcpp-${target}`);
  layout.openTab("models");
}

async function downloadModel(): Promise<void> {
  const model = chosenModel.value;
  if (!model || model.installed) return;
  const accepted = await confirm({
    title: i18n.t("aiVideo.downloadModelTitle"),
    message: i18n.t("aiVideo.downloadModelBody", {
      name: model.name,
      size: humanSize(modelMissing.value),
    }),
    confirmText: i18n.t("dialog.downloadModelOk"),
  });
  if (!accepted) return;
  // 30 GB 的权重交给下载管理器：它有续传、源切换与取消，页面只负责生成。
  layout.openTab("models");
}

const modelDownloading = computed(() => models.busyId === chosenModel.value?.id);

// ---- 动作 ----
type PrimaryKind = "engine" | "model" | "generate" | "stop";
const primaryKind = computed<PrimaryKind>(() => {
  if (videoGen.running) return "stop";
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

async function runPrimary(): Promise<void> {
  switch (primaryKind.value) {
    case "stop":
      await videoGen.cancel();
      return;
    case "engine":
      openEngineManager();
      return;
    case "model":
      await downloadModel();
      return;
    default:
      await generate();
  }
}

async function generate(): Promise<void> {
  const model = chosenModel.value;
  if (!model || !model.installed) return;
  if (!prompt.value.trim()) {
    toast(i18n.t("aiVideo.needPrompt"));
    return;
  }
  const created = await videoGen.start({
    modelId: model.id,
    prompt: prompt.value.trim(),
    width: resolution.value.width,
    height: resolution.value.height,
    seconds: duration.value,
    steps: steps.value,
    seed: seed.value,
    cfgScale: cfg.value,
    flowShift: flowShift.value,
    offloadToCpu: offload.value,
    vaeTiling: vaeTiling.value,
  });
  if (!created) {
    if (videoGen.error) toast(videoGen.error, "error");
    return;
  }
  await addToTimeline(created);
}

async function addToTimeline(result: VideoGenResult): Promise<void> {
  try {
    const asset = await importAssetAt(result.path);
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
  if (resolution.value.id === "720p" && frames.value > 73) {
    return i18n.t("aiVideo.vram720Warning");
  }
  if (resolution.value.id === "480p" && frames.value > 175) {
    return i18n.t("aiVideo.vramWarning");
  }
  return "";
});

const statusLine = computed(() => {
  if (videoGen.running) {
    return i18n.t("aiVideo.elapsed", { seconds: Math.round(videoGen.elapsed) });
  }
  if (modelDownloading.value) return i18n.t("aiVideo.downloading");
  if (!engineReady.value) return i18n.t("aiVideo.engineMissingHint");
  if (chosenModel.value?.installed !== true) return i18n.t("aiVideo.modelMissingHint");
  return engineLabel.value;
});

onMounted(async () => {
  videoGen.watch();
  await Promise.all([models.load(), sdcpp.load(), sdcpp.loadInfo()]);
});

onUnmounted(() => {
  videoGen.unwatch();
});
</script>

<template>
  <div class="video-page">
    <header class="head">
      <button class="icon-btn" type="button" :aria-label="i18n.t('common.back')" @click="emit('back')">
        <ArrowLeftIcon class="w-[15px] h-[15px]" />
      </button>
      <h1 class="title">{{ i18n.t("aiVideo.title") }}</h1>
      <span class="badge" :class="{ on: engineReady }">{{ engineLabel }}</span>
    </header>

    <!-- 引擎：sd.cpp 的 CPU / Vulkan / CUDA 后端 -->
    <section class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.engine") }}</span>
          <span class="card-sub">{{ statusLine }}</span>
        </div>
        <button v-if="!engineReady" class="text-btn" type="button" @click="openEngineManager()">
          {{ i18n.t("aiVideo.downloadEngine") }}
        </button>
        <button v-else class="text-btn" type="button" @click="openEngineManager()">
          {{ i18n.t("aiVideo.manageEngine") }}
        </button>
      </div>
      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.backend") }}</span>
        <Md3Select
          v-model="backendId"
          :options="backendOptions"
          :label="i18n.t('aiVideo.backend')"
          :disabled="backendBusy || videoGen.running"
        />
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

    <!-- 模型：四个文件一起装 -->
    <section class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.model") }}</span>
          <span class="card-sub">
            {{
              chosenModel?.installed
                ? i18n.t("aiVideo.modelReady", { size: humanSize(chosenModel.approx_bytes) })
                : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(modelMissing) })
            }}
          </span>
        </div>
      </div>
      <Md3Select
        v-model="modelId"
        :options="modelOptions"
        :label="i18n.t('aiVideo.model')"
        :empty="i18n.t('aiVideo.noModel')"
        :disabled="videoGen.running || modelDownloading"
      />
      <div v-if="modelDownloading" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: models.progressPct === null }"
          :style="models.progressPct === null ? undefined : { width: `${models.progressPct}%` }"
        />
      </div>
      <p v-if="models.error" class="hint warn">{{ models.error }}</p>
      <p class="hint">{{ i18n.t("aiVideo.modelHint") }}</p>
    </section>

    <!-- 提示词与参数 -->
    <section class="card">
      <div class="card-head">
        <div>
          <span class="card-title">{{ i18n.t("aiVideo.prompt") }}</span>
        </div>
      </div>
      <textarea
        v-model="prompt"
        class="prompt"
        rows="4"
        spellcheck="false"
        :placeholder="i18n.t('aiVideo.promptPlaceholder')"
        :disabled="videoGen.running"
      />

      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.resolution") }}</span>
        <Md3Select
          v-model="resolutionId"
          :options="RESOLUTIONS.map((item) => ({ id: item.id, label: item.label }))"
          :label="i18n.t('aiVideo.resolution')"
          :disabled="videoGen.running"
        />
      </div>
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
            :disabled="videoGen.running"
          />
          <span class="value">{{ i18n.t("aiVideo.seconds", { value: duration }) }}</span>
        </div>
      </div>
      <p class="hint">{{ framesText }}</p>
      <p v-if="warning" class="hint warn">{{ warning }}</p>

      <div class="row">
        <span class="row-label">{{ i18n.t("aiVideo.steps") }}</span>
        <Md3Select
          v-model="stepsId"
          :options="stepOptions"
          :label="i18n.t('aiVideo.steps')"
          :disabled="videoGen.running"
        />
      </div>
      <p class="hint">{{ i18n.t("aiVideo.stepsHint") }}</p>

      <details class="advanced">
        <summary>{{ i18n.t("aiVideo.advanced") }}</summary>
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.seed") }}</span>
          <NumberField
            v-model="seed"
            :sr-label="i18n.t('aiVideo.seed')"
            :min="-1"
            :max="2147483647"
            input-width="88px"
            :disabled="videoGen.running"
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
            :disabled="videoGen.running"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.flowShift") }}</span>
          <NumberField
            v-model="flowShift"
            :sr-label="i18n.t('aiVideo.flowShift')"
            :min="0"
            :max="30"
            :step="0.5"
            :decimals="1"
            input-width="52px"
            :disabled="videoGen.running"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.offload") }}</span>
          <ToggleSwitch v-model="offload" :label="i18n.t('aiVideo.offload')" :disabled="videoGen.running" />
        </div>
        <div class="row">
          <span class="row-label">{{ i18n.t("aiVideo.vaeTiling") }}</span>
          <ToggleSwitch v-model="vaeTiling" :label="i18n.t('aiVideo.vaeTiling')" :disabled="videoGen.running" />
        </div>
      </details>

      <div v-if="videoGen.running" class="progress">
        <div
          class="progress-fill"
          :class="{ indeterminate: videoGen.progressPct === null }"
          :style="videoGen.progressPct === null ? undefined : { width: `${videoGen.progressPct}%` }"
        />
      </div>
      <p v-if="videoGen.error" class="hint warn">{{ videoGen.error }}</p>

      <div class="actions">
        <span v-if="videoGen.message" class="hint">{{ videoGen.message }}</span>
        <span class="spacer" />
        <button class="run-btn" type="button" :disabled="primaryDisabled" @click="runPrimary">
          {{ primaryLabel }}
        </button>
      </div>
    </section>

    <!-- 结果 -->
    <section v-if="videoGen.result" class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("aiVideo.result") }}</span>
        <button class="text-btn" type="button" @click="addToTimeline(videoGen.result)">
          {{ i18n.t("aiVideo.addToTimeline") }}
        </button>
      </div>
      <video class="preview" :src="fileUrl(videoGen.result.path)" controls playsinline />
      <p class="hint">
        {{ videoGen.result.width }}×{{ videoGen.result.height }} ·
        {{ videoGen.result.frames }} {{ i18n.t("aiVideo.framesUnit") }} ·
        {{ videoGen.result.duration.toFixed(2) }}s
      </p>
    </section>
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
.advanced summary {
  cursor: pointer;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
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
  border: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
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
