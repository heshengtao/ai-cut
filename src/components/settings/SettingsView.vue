<script setup lang="ts">
/**
 * 设置页：自带一条侧栏 + 居中内容列，视觉与 ai-daw 一致。
 * 应用内全屏页（layout.settingsOpen），不引入路由。
 */
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeftIcon } from "@heroicons/vue/24/outline";
import NumberField from "@/components/common/NumberField.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import ComboField from "@/components/common/ComboField.vue";
import {
  ACCENTS,
  accent,
  setAccent,
  themeMode,
  setTheme,
  type AccentColor,
  type ThemeMode,
} from "@/composables/useTheme";
import {
  MAX_PANEL_WIDTH,
  MAX_TIMELINE_HEIGHT,
  MIN_PANEL_WIDTH,
  MIN_TIMELINE_HEIGHT,
  useLayoutStore,
  type SettingsSection,
} from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { useAgentStore } from "@/stores/agent";
import { useModelsStore } from "@/stores/models";
import { useUpdaterStore } from "@/stores/updater";
import { displayProjectName } from "@/utils/projectName";
import { useI18n } from "@/i18n";
import type {
  AgentProbe,
  CliStatus,
  McpStatus,
  ProxyMode,
  ProxyProbe,
  ProxyStatus,
} from "@/types/agent";
import type {
  CloudTtsKind,
  CloudTtsProvider,
  CloudTtsTest,
  ModelSourcePreference,
  TtsVoice,
} from "@/types/models";
import {
  agentConfig,
  agentModels,
  agentSetConfig,
  agentTest,
  cliStatus,
  installCli,
  mcpStatus,
  networkConfig,
  networkProbe,
  networkSetConfig,
  networkStatus,
  setMcpConfig,
  uninstallCli,
} from "@/core/agentApi";
import {
  cloudTtsConfig,
  cloudTtsSetConfig,
  cloudTtsTest,
  cloudTtsVoices,
} from "@/core/cloudTtsApi";
import { fileUrl } from "@/core/media";
import {
  CUSTOM_OUTPUT,
  FPS_PRESETS,
  MAX_PROJECT_DIMENSION,
  MAX_PROJECT_FPS,
  MIN_PROJECT_DIMENSION,
  MIN_PROJECT_FPS,
  RESOLUTION_PRESETS,
  matchResolutionPreset,
  resolutionPreset,
} from "@/core/projectOutput";
import { setProjectOutput } from "@/core/ops";
import { copyText } from "@/utils/clipboard";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { isTauri } from "@/utils/platform";

type Section = SettingsSection;

const SECTIONS: { id: Section; labelKey: string; captionKey: string }[] = [
  { id: "general", labelKey: "settings.section.general", captionKey: "settings.section.general.caption" },
  {
    id: "appearance",
    labelKey: "settings.section.appearance",
    captionKey: "settings.section.appearance.caption",
  },
  { id: "layout", labelKey: "settings.section.layout", captionKey: "settings.section.layout.caption" },
  { id: "ai", labelKey: "settings.section.ai", captionKey: "settings.section.ai.caption" },
  { id: "tts", labelKey: "settings.section.tts", captionKey: "settings.section.tts.caption" },
  { id: "network", labelKey: "settings.section.network", captionKey: "settings.section.network.caption" },
  { id: "cli", labelKey: "settings.section.cli", captionKey: "settings.section.cli.caption" },
  { id: "about", labelKey: "settings.section.about", captionKey: "settings.section.about.caption" },
];

const THEMES: { id: ThemeMode; labelKey: string }[] = [
  { id: "light", labelKey: "settings.theme.light" },
  { id: "dark", labelKey: "settings.theme.dark" },
  { id: "system", labelKey: "settings.theme.system" },
];

const PROXY_MODES: { id: ProxyMode; labelKey: string }[] = [
  { id: "direct", labelKey: "settings.proxy.modeDirect" },
  { id: "system", labelKey: "settings.proxy.modeSystem" },
  { id: "manual", labelKey: "settings.proxy.modeManual" },
];

const MODEL_SOURCE_PREFS: { id: ModelSourcePreference; labelKey: string }[] = [
  { id: "auto", labelKey: "settings.store.sourceAuto" },
  { id: "domestic", labelKey: "settings.store.sourceCn" },
  { id: "international", labelKey: "settings.store.sourceIntl" },
];

const APP_VERSION = "0.1.0";

const i18n = useI18n();
const layout = useLayoutStore();
const project = useProjectStore();
const agentStore = useAgentStore();
const models = useModelsStore();
const updater = useUpdaterStore();

const active = ref<Section>(layout.settingsSection ?? "general");
const activeMeta = computed(() => SECTIONS.find((s) => s.id === active.value) ?? SECTIONS[0]);
const projectName = computed(() => displayProjectName(project.doc.name));

// ---- 自动更新 ----
/** 更新行标题：随阶段变化（检查中 / 发现新版本 / 下载中 / 就绪 / 失败）。 */
const updateTitle = computed(() => {
  switch (updater.phase) {
    case "checking":
      return i18n.t("settings.update.status.checking");
    case "available":
      return i18n.t("settings.update.status.available", { version: updater.info?.version ?? "" });
    case "downloading":
      return i18n.t("settings.update.status.downloading", { version: updater.info?.version ?? "" });
    case "ready":
      return i18n.t("settings.update.status.ready");
    case "error":
      return i18n.t("settings.update.status.error", { error: updater.error });
    default:
      return i18n.t("settings.update.title");
  }
});

/** 更新行说明：空闲给「已是最新」，下载中给百分比，就绪提示重启，其余给来源提示。 */
const updateMessage = computed(() => {
  if (updater.phase === "idle") return i18n.t("settings.update.status.idle");
  if (updater.phase === "ready") return i18n.t("settings.update.status.restartHint");
  if (updater.phase === "downloading") {
    return i18n.t("settings.update.downloading", { percent: Math.round(updater.progress * 100) });
  }
  return i18n.t("settings.update.hint");
});

// ---- 工程输出设置 ----
const resolutionPresetId = computed(() =>
  matchResolutionPreset(project.doc.width, project.doc.height),
);
const resolutionOptions = computed<SelectOption[]>(() => [
  ...RESOLUTION_PRESETS.map((preset) => ({
    id: preset.id,
    label: i18n.t(preset.labelKey),
  })),
  { id: CUSTOM_OUTPUT, label: i18n.t("settings.output.custom") },
]);
const fpsPresetId = computed(() =>
  FPS_PRESETS.includes(project.doc.fps) ? String(project.doc.fps) : CUSTOM_OUTPUT,
);
const fpsOptions = computed<SelectOption[]>(() => [
  ...FPS_PRESETS.map((fps) => ({ id: String(fps), label: `${fps} fps` })),
  { id: CUSTOM_OUTPUT, label: i18n.t("settings.output.custom") },
]);

function applyOutput(patch: { width?: number; height?: number; fps?: number }): void {
  project.dispatch((doc) => setProjectOutput(doc, patch), {
    kind: "project.output",
    payload: patch,
    label: i18n.t("settings.output.label"),
  });
}

function onResolutionPreset(id: string): void {
  const preset = resolutionPreset(id);
  if (!preset) return;
  applyOutput({ width: preset.width, height: preset.height });
}

function onFpsPreset(id: string): void {
  if (id === CUSTOM_OUTPUT) return;
  const fps = Number(id);
  if (!Number.isFinite(fps)) return;
  applyOutput({ fps });
}

function onProjectWidth(value: number): void {
  applyOutput({ width: value });
}

function onProjectHeight(value: number): void {
  applyOutput({ height: value });
}

function onProjectFps(value: number): void {
  applyOutput({ fps: value });
}

watch(
  () => layout.settingsSection,
  (section) => {
    if (section) active.value = section;
  },
);

// ---- 剪辑智能体 ----
const agentBaseUrl = ref("");
const agentApiKey = ref("");
const agentModel = ref("");
const agentModelList = ref<string[]>([]);
const agentProbe = ref<AgentProbe | null>(null);
const agentBusy = ref(false);
const agentSaving = ref(false);
const agentSaved = ref(false);

// ---- MCP ----
const mcp = ref<McpStatus | null>(null);
const mcpPort = ref("50563");
const mcpSaving = ref(false);
const mcpError = ref("");
const mcpOn = computed(() => mcp.value?.enabled ?? false);
const mcpRunning = computed(() => mcp.value?.running ?? false);
const mcpEndpoint = computed(() => mcp.value?.url ?? null);

// ---- 网络 ----
const proxyMode = ref<ProxyMode>("system");
const proxyUrl = ref("");
const proxyStatus = ref<ProxyStatus | null>(null);
const proxyProbe = ref<ProxyProbe | null>(null);
const proxySaving = ref(false);
const proxySaved = ref(false);
const proxyTesting = ref(false);
const proxySourceLabel = computed(
  () => proxyStatus.value?.source ?? i18n.t("settings.proxy.system"),
);

// ---- 模型下载源 / 镜像 ----
const modelSourcePref = ref<ModelSourcePreference>("auto");
const modelMirrors = ref("");
const modelDownloadPrefix = ref("");
const sourceSaving = ref(false);
const sourceSaved = ref(false);

watch([modelSourcePref, modelMirrors, modelDownloadPrefix], () => {
  sourceSaved.value = false;
});

// ---- 云端 / 自定义 TTS ----

const TTS_KINDS: CloudTtsKind[] = [
  "openai",
  "elevenlabs",
  "azure",
  "google",
  "baidu",
  "minimax",
  "volcengine",
  "custom",
];
const TTS_FORMATS = ["mp3", "wav", "opus", "aac", "flac", "pcm"];

type ProviderFieldKey =
  | "base_url"
  | "api_key"
  | "api_secret"
  | "app_id"
  | "group_id"
  | "region"
  | "model"
  | "voice"
  | "format"
  | "speed"
  | "volume"
  | "pitch"
  | "method"
  | "headers"
  | "body"
  | "audio_path";

interface ProviderField {
  key: ProviderFieldKey;
  labelKey: string;
  hintKey?: string;
  placeholder?: string;
  sensitive?: boolean;
  multiline?: boolean;
}

/** 表单里数字也存成字符串，保存时再转回 number。 */
interface ProviderDraft {
  id: string;
  name: string;
  kind: CloudTtsKind;
  enabled: boolean;
  base_url: string;
  api_key: string;
  api_secret: string;
  app_id: string;
  group_id: string;
  region: string;
  model: string;
  voice: string;
  format: string;
  speed: string;
  volume: string;
  pitch: string;
  voices: string;
  method: string;
  headers: string;
  body: string;
  audio_path: string;
}

const TTS_FIELDS: Record<CloudTtsKind, ProviderField[]> = {
  openai: [
    {
      key: "base_url",
      labelKey: "settings.tts.baseUrl",
      hintKey: "settings.tts.baseUrlOpenaiHint",
      placeholder: "https://api.openai.com/v1",
    },
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyHint",
      placeholder: "sk-…",
      sensitive: true,
    },
    { key: "model", labelKey: "settings.tts.model", hintKey: "settings.tts.modelHint", placeholder: "tts-1" },
    { key: "voice", labelKey: "settings.tts.voice", hintKey: "settings.tts.voiceHint", placeholder: "alloy" },
    { key: "format", labelKey: "settings.tts.format", hintKey: "settings.tts.formatHint" },
    { key: "speed", labelKey: "settings.tts.speed", hintKey: "settings.tts.speedHint", placeholder: "1.0" },
  ],
  elevenlabs: [
    {
      key: "base_url",
      labelKey: "settings.tts.baseUrl",
      hintKey: "settings.tts.baseUrlElevenHint",
      placeholder: "https://api.elevenlabs.io/v1",
    },
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyHint",
      placeholder: "sk-…",
      sensitive: true,
    },
    {
      key: "model",
      labelKey: "settings.tts.model",
      hintKey: "settings.tts.modelElevenHint",
      placeholder: "eleven_multilingual_v2",
    },
    {
      key: "voice",
      labelKey: "settings.tts.voiceId",
      hintKey: "settings.tts.voiceIdHint",
      placeholder: "JBFqnCBsd6RMkjVDRZzb",
    },
  ],
  azure: [
    {
      key: "region",
      labelKey: "settings.tts.region",
      hintKey: "settings.tts.regionHint",
      placeholder: "eastasia",
    },
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyHint",
      placeholder: "speech key",
      sensitive: true,
    },
    {
      key: "voice",
      labelKey: "settings.tts.voice",
      hintKey: "settings.tts.voiceAzureHint",
      placeholder: "zh-CN-XiaoxiaoNeural",
    },
    { key: "format", labelKey: "settings.tts.format", hintKey: "settings.tts.formatHint" },
  ],
  google: [
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyGoogleHint",
      placeholder: "API key",
      sensitive: true,
    },
    {
      key: "voice",
      labelKey: "settings.tts.voice",
      hintKey: "settings.tts.voiceGoogleHint",
      placeholder: "cmn-CN-Wavenet-A",
    },
    { key: "speed", labelKey: "settings.tts.speed", hintKey: "settings.tts.speedHint", placeholder: "1.0" },
    { key: "pitch", labelKey: "settings.tts.pitch", hintKey: "settings.tts.pitchHint", placeholder: "0" },
  ],
  baidu: [
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyHint",
      placeholder: "API Key",
      sensitive: true,
    },
    {
      key: "api_secret",
      labelKey: "settings.tts.apiSecret",
      hintKey: "settings.tts.apiSecretHint",
      placeholder: "Secret Key",
      sensitive: true,
    },
    { key: "voice", labelKey: "settings.tts.voice", hintKey: "settings.tts.voiceBaiduHint", placeholder: "0" },
    { key: "speed", labelKey: "settings.tts.speed", hintKey: "settings.tts.speedHint", placeholder: "1.0" },
    { key: "pitch", labelKey: "settings.tts.pitch", hintKey: "settings.tts.pitchHint", placeholder: "0" },
    { key: "volume", labelKey: "settings.tts.volume", hintKey: "settings.tts.volumeHint", placeholder: "1.0" },
  ],
  minimax: [
    {
      key: "base_url",
      labelKey: "settings.tts.baseUrl",
      hintKey: "settings.tts.baseUrlMinimaxHint",
      placeholder: "https://api.minimax.chat",
    },
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.apiKeyHint",
      placeholder: "API Key",
      sensitive: true,
    },
    {
      key: "group_id",
      labelKey: "settings.tts.groupId",
      hintKey: "settings.tts.groupIdHint",
      placeholder: "GroupId",
    },
    { key: "model", labelKey: "settings.tts.model", hintKey: "settings.tts.modelMiniMaxHint", placeholder: "speech-01" },
    { key: "voice", labelKey: "settings.tts.voice", hintKey: "settings.tts.voiceHint", placeholder: "male-qn-qingse" },
    { key: "speed", labelKey: "settings.tts.speed", hintKey: "settings.tts.speedHint", placeholder: "1.0" },
  ],
  volcengine: [
    {
      key: "base_url",
      labelKey: "settings.tts.baseUrl",
      hintKey: "settings.tts.baseUrlVolcHint",
      placeholder: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
    },
    {
      key: "app_id",
      labelKey: "settings.tts.appId",
      hintKey: "settings.tts.appIdHint",
      placeholder: "App ID",
    },
    {
      key: "api_key",
      labelKey: "settings.tts.accessKey",
      hintKey: "settings.tts.accessKeyHint",
      placeholder: "Access Key",
      sensitive: true,
    },
    {
      key: "model",
      labelKey: "settings.tts.resourceId",
      hintKey: "settings.tts.resourceIdHint",
      placeholder: "volc_tts_release",
    },
    {
      key: "voice",
      labelKey: "settings.tts.voice",
      hintKey: "settings.tts.voiceVolcHint",
      placeholder: "zh_female_cancan_mars_bigtts",
    },
    { key: "speed", labelKey: "settings.tts.speed", hintKey: "settings.tts.speedHint", placeholder: "1.0" },
  ],
  custom: [
    {
      key: "base_url",
      labelKey: "settings.tts.url",
      hintKey: "settings.tts.urlHint",
      placeholder: "http://127.0.0.1:9880/tts",
    },
    { key: "method", labelKey: "settings.tts.method", hintKey: "settings.tts.methodHint" },
    {
      key: "api_key",
      labelKey: "settings.tts.apiKey",
      hintKey: "settings.tts.customKeyHint",
      placeholder: "可选",
      sensitive: true,
    },
    {
      key: "headers",
      labelKey: "settings.tts.headers",
      hintKey: "settings.tts.headersHint",
      placeholder: '{"Authorization": "Bearer {{api_key}}"}',
      multiline: true,
    },
    {
      key: "body",
      labelKey: "settings.tts.body",
      hintKey: "settings.tts.bodyHint",
      placeholder: '{"text": "{{text}}", "voice": "{{voice}}", "speed": {{speed}}}',
      multiline: true,
    },
    {
      key: "audio_path",
      labelKey: "settings.tts.audioPath",
      hintKey: "settings.tts.audioPathHint",
      placeholder: "data.audio",
    },
    { key: "format", labelKey: "settings.tts.format", hintKey: "settings.tts.formatHint" },
  ],
};

const cloudProviders = ref<CloudTtsProvider[]>([]);
const ttsDraft = ref<ProviderDraft | null>(null);
const editingTtsId = ref<string | null>(null);
const ttsLoading = ref(false);
const ttsSaving = ref(false);
const ttsTesting = ref(false);
const ttsTestText = ref(i18n.t("settings.tts.testTextDefault"));
const ttsTestResult = ref<{ ok: boolean; detail: string } | null>(null);
const ttsTestAudio = ref<CloudTtsTest | null>(null);
const ttsVoiceOptions = ref<TtsVoice[]>([]);
const ttsVoicesLoading = ref(false);
const ttsVoiceError = ref("");
let testPlayer: HTMLAudioElement | null = null;

const ttsKindOptions = computed<SelectOption[]>(() =>
  TTS_KINDS.map((kind) => ({
    id: kind,
    label: i18n.t(`settings.tts.kind.${kind}`),
  })),
);
const ttsFields = computed<ProviderField[]>(() =>
  ttsDraft.value ? TTS_FIELDS[ttsDraft.value.kind] : [],
);

const ttsFormatOptions: SelectOption[] = TTS_FORMATS.map((format) => ({
  id: format,
  label: format.toUpperCase(),
}));
const ttsMethodOptions: SelectOption[] = [
  { id: "POST", label: "POST" },
  { id: "GET", label: "GET" },
];
const ttsVoiceIds = computed(() => ttsVoiceOptions.value.map((voice) => voice.id));

type NumericFieldKey = "speed" | "volume" | "pitch";
interface NumericSpec {
  min: number;
  max: number;
  step: number;
  decimals: number;
  width: string;
}
const TTS_NUMERIC: Record<NumericFieldKey, NumericSpec> = {
  speed: { min: 0.1, max: 4, step: 0.05, decimals: 2, width: "42px" },
  volume: { min: 0, max: 3, step: 0.05, decimals: 2, width: "42px" },
  pitch: { min: -20, max: 20, step: 1, decimals: 0, width: "38px" },
};

function numericSpec(key: ProviderFieldKey): NumericSpec {
  return key === "speed" || key === "volume" || key === "pitch"
    ? TTS_NUMERIC[key]
    : TTS_NUMERIC.speed;
}

function numericValue(key: ProviderFieldKey): number {
  if (!ttsDraft.value) return 0;
  return toNumber(ttsDraft.value[key], 0);
}

function setNumeric(key: ProviderFieldKey, value: number): void {
  if (ttsDraft.value) ttsDraft.value[key] = String(value);
}

function kindDefaults(kind: CloudTtsKind): Partial<ProviderDraft> {
  switch (kind) {
    case "openai":
      return { model: "tts-1", voice: "alloy" };
    case "elevenlabs":
      return { model: "eleven_multilingual_v2" };
    case "azure":
      return { region: "eastasia", voice: "zh-CN-XiaoxiaoNeural" };
    case "google":
      return { voice: "cmn-CN-Wavenet-A" };
    case "baidu":
      return { voice: "0" };
    case "minimax":
      return { model: "speech-01", voice: "male-qn-qingse" };
    case "volcengine":
      return { model: "volc_tts_release", voice: "zh_female_cancan_mars_bigtts" };
    case "custom":
      return { method: "POST" };
  }
}

function blankDraft(kind: CloudTtsKind): ProviderDraft {
  return {
    id: crypto.randomUUID(),
    name: i18n.t(`settings.tts.kind.${kind}`),
    kind,
    enabled: true,
    base_url: "",
    api_key: "",
    api_secret: "",
    app_id: "",
    group_id: "",
    region: "",
    model: "",
    voice: "",
    format: "mp3",
    speed: "1",
    volume: "1",
    pitch: "0",
    voices: "",
    method: "POST",
    headers: "",
    body: "",
    audio_path: "",
    ...kindDefaults(kind),
  };
}

function toDraft(provider: CloudTtsProvider): ProviderDraft {
  return {
    ...provider,
    speed: String(provider.speed),
    volume: String(provider.volume),
    pitch: String(provider.pitch),
  };
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fromDraft(draft: ProviderDraft): CloudTtsProvider {
  return {
    ...draft,
    speed: toNumber(draft.speed, 1),
    volume: toNumber(draft.volume, 1),
    pitch: toNumber(draft.pitch, 0),
  };
}

function stopTestAudio(): void {
  if (testPlayer) {
    testPlayer.pause();
    testPlayer = null;
  }
}

function resetTest(): void {
  stopTestAudio();
  ttsTestResult.value = null;
  ttsTestAudio.value = null;
  ttsVoiceOptions.value = [];
  ttsVoiceError.value = "";
}

async function loadCloudTts(): Promise<void> {
  ttsLoading.value = true;
  try {
    cloudProviders.value = (await cloudTtsConfig()).providers;
    if (!ttsDraft.value && cloudProviders.value[0]) {
      editProvider(cloudProviders.value[0]);
    }
  } catch {
    cloudProviders.value = [];
  } finally {
    ttsLoading.value = false;
  }
}

function newProvider(): void {
  editingTtsId.value = null;
  ttsDraft.value = blankDraft("openai");
  resetTest();
}

function editProvider(provider: CloudTtsProvider): void {
  editingTtsId.value = provider.id;
  ttsDraft.value = toDraft(provider);
  resetTest();
}

async function saveProvider(): Promise<void> {
  if (!ttsDraft.value || ttsSaving.value) return;
  ttsSaving.value = true;
  ttsTestResult.value = null;
  try {
    const provider = fromDraft(ttsDraft.value);
    const next = [...cloudProviders.value];
    const index = next.findIndex((item) => item.id === provider.id);
    if (index >= 0) next[index] = provider;
    else next.push(provider);
    cloudProviders.value = (await cloudTtsSetConfig(next)).providers;
    const saved =
      cloudProviders.value.find((item) => item.id === provider.id) ?? provider;
    editingTtsId.value = saved.id;
    ttsDraft.value = toDraft(saved);
    toast(i18n.t("settings.tts.saved"));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    ttsSaving.value = false;
  }
}

async function deleteProvider(provider: CloudTtsProvider): Promise<void> {
  if (ttsSaving.value) return;
  const accepted = await confirm({
    title: i18n.t("settings.tts.deleteTitle"),
    message: i18n.t("settings.tts.deleteMessage", { name: provider.name }),
    confirmText: i18n.t("common.delete"),
    cancelText: i18n.t("common.cancel"),
  });
  if (!accepted) return;
  ttsSaving.value = true;
  try {
    const next = cloudProviders.value.filter((item) => item.id !== provider.id);
    cloudProviders.value = (await cloudTtsSetConfig(next)).providers;
    if (editingTtsId.value === provider.id) {
      editingTtsId.value = null;
      ttsDraft.value = null;
      resetTest();
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    ttsSaving.value = false;
  }
}

function playTestAudio(): void {
  const audio = ttsTestAudio.value;
  if (!audio) return;
  stopTestAudio();
  testPlayer = new Audio(fileUrl(audio.path));
  void testPlayer.play().catch((error) => {
    ttsTestResult.value = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  });
}

async function testTtsProvider(): Promise<void> {
  if (!ttsDraft.value || ttsTesting.value) return;
  ttsTesting.value = true;
  ttsTestResult.value = null;
  ttsTestAudio.value = null;
  try {
    const result = await cloudTtsTest(
      fromDraft(ttsDraft.value),
      ttsTestText.value.trim(),
    );
    ttsTestAudio.value = result;
    ttsTestResult.value = {
      ok: true,
      detail: i18n.t("settings.tts.testOk", {
        duration: result.duration.toFixed(1),
      }),
    };
    playTestAudio();
  } catch (error) {
    ttsTestResult.value = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    ttsTesting.value = false;
  }
}

async function fetchTtsVoices(): Promise<void> {
  if (!ttsDraft.value || ttsVoicesLoading.value) return;
  ttsVoicesLoading.value = true;
  ttsVoiceError.value = "";
  try {
    ttsVoiceOptions.value = await cloudTtsVoices(fromDraft(ttsDraft.value));
    if (!ttsDraft.value.voice && ttsVoiceOptions.value[0]) {
      ttsDraft.value.voice = ttsVoiceOptions.value[0].id;
    }
  } catch (error) {
    ttsVoiceOptions.value = [];
    ttsVoiceError.value = error instanceof Error ? error.message : String(error);
  } finally {
    ttsVoicesLoading.value = false;
  }
}

watch(
  () => ttsDraft.value?.kind,
  (kind, previous) => {
    // 初次载入（previous 为空）时保留草稿里已有的配置；只有用户真的切换类型才重置。
    if (!ttsDraft.value || !kind || !previous || previous === kind) return;
    const oldName = i18n.t(`settings.tts.kind.${previous}`);
    ttsDraft.value = {
      ...ttsDraft.value,
      name:
        ttsDraft.value.name === oldName
          ? i18n.t(`settings.tts.kind.${kind}`)
          : ttsDraft.value.name,
      base_url: "",
      api_key: "",
      api_secret: "",
      app_id: "",
      group_id: "",
      region: "",
      model: "",
      voice: "",
      format: "mp3",
      speed: "1",
      volume: "1",
      pitch: "0",
      method: "POST",
      headers: "",
      body: "",
      audio_path: "",
      ...kindDefaults(kind),
    };
    ttsVoiceOptions.value = [];
    ttsVoiceError.value = "";
    ttsTestResult.value = null;
    ttsTestAudio.value = null;
  },
);

// ---- 命令行 ----
const cli = ref<CliStatus | null>(null);
const cliBusy = ref(false);
const cliError = ref("");
const cliOn = computed(() => ["installed", "system"].includes(cli.value?.state ?? ""));
const cliStateLabel = computed(
  () => i18n.t(`settings.cli.state.${cli.value?.state ?? "unsupported"}`),
);
const cliLocation = computed(
  () =>
    cli.value?.conflict ??
    cli.value?.target ??
    cli.value?.bundled ??
    i18n.t("settings.cli.notBundled"),
);
const cliMessage = computed(() => {
  if (cliError.value) return cliError.value;
  if (cli.value?.state === "conflict") return i18n.t("settings.cli.hint.conflict");
  if (cli.value?.hint) return i18n.t(`settings.cli.hint.${cli.value.hint}`);
  return i18n.t("settings.cli.statusHint");
});

function clampPort(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 65535);
}

async function loadAgent(): Promise<void> {
  try {
    const cfg = await agentConfig();
    agentBaseUrl.value = cfg.base_url;
    agentApiKey.value = cfg.api_key;
    agentModel.value = cfg.model;
  } catch {
    // 浏览器预览 / 后端未起：保持空白。
  }
}

async function loadMcp(): Promise<void> {
  try {
    mcp.value = await mcpStatus();
    mcpPort.value = String(mcp.value.port ?? 50563);
  } catch {
    mcp.value = null;
  }
}

async function loadNetwork(): Promise<void> {
  try {
    const cfg = await networkConfig();
    proxyMode.value = cfg.proxy_mode;
    proxyUrl.value = cfg.proxy_url;
    proxyStatus.value = await networkStatus();
  } catch {
    proxyStatus.value = null;
  }
}

async function loadModelSources(): Promise<void> {
  await models.loadSourceConfig();
  modelSourcePref.value = models.sourcePreference;
  modelMirrors.value = models.mirrors.join("\n");
  modelDownloadPrefix.value = models.downloadPrefix;
}

async function saveModelSources(): Promise<void> {
  if (sourceSaving.value) return;
  sourceSaving.value = true;
  sourceSaved.value = false;
  try {
    await models.saveSourceConfig(
      modelSourcePref.value,
      modelMirrors.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      modelDownloadPrefix.value.trim(),
    );
    modelMirrors.value = models.mirrors.join("\n");
    modelDownloadPrefix.value = models.downloadPrefix;
    sourceSaved.value = true;
    toast(i18n.t("settings.store.saved"));
  } catch (error) {
    toast(
      i18n.t("settings.store.saveFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    sourceSaving.value = false;
  }
}

async function loadCli(): Promise<void> {
  try {
    cli.value = await cliStatus();
  } catch {
    cli.value = null;
  }
}

async function saveAgent(): Promise<void> {
  if (agentSaving.value) return;
  agentSaving.value = true;
  agentSaved.value = false;
  try {
    const cfg = await agentSetConfig(
      agentBaseUrl.value.trim(),
      agentApiKey.value.trim(),
      agentModel.value.trim(),
    );
    agentBaseUrl.value = cfg.base_url;
    agentApiKey.value = cfg.api_key;
    agentModel.value = cfg.model;
    agentSaved.value = true;
    await agentStore.loadConfig();
    toast(i18n.t("settings.ai.saved"));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    agentSaving.value = false;
  }
}

async function fetchModels(): Promise<void> {
  if (agentBusy.value) return;
  agentBusy.value = true;
  try {
    agentModelList.value = await agentModels(
      agentBaseUrl.value.trim(),
      agentApiKey.value.trim(),
      agentModel.value.trim(),
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    agentBusy.value = false;
  }
}

async function testAgent(): Promise<void> {
  if (agentBusy.value) return;
  agentBusy.value = true;
  agentProbe.value = null;
  try {
    agentProbe.value = await agentTest(
      agentBaseUrl.value.trim(),
      agentApiKey.value.trim(),
      agentModel.value.trim(),
    );
  } catch (error) {
    agentProbe.value = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: 0,
    };
  } finally {
    agentBusy.value = false;
  }
}

async function applyMcp(enabled: boolean, port: number): Promise<void> {
  mcpSaving.value = true;
  mcpError.value = "";
  try {
    mcp.value = await setMcpConfig(enabled, port);
    mcpPort.value = String(mcp.value.port);
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : String(error);
  } finally {
    mcpSaving.value = false;
  }
}

async function toggleMcp(): Promise<void> {
  await applyMcp(!mcpOn.value, clampPort(mcpPort.value));
}

const mcpPortNumber = computed(() => clampPort(mcpPort.value));

async function onMcpPortValue(value: number): Promise<void> {
  const port = Math.min(Math.max(Math.trunc(value), 0), 65535);
  mcpPort.value = String(port);
  await applyMcp(mcp.value?.enabled ?? false, port);
}

async function saveNetwork(): Promise<void> {
  if (proxySaving.value) return;
  proxySaving.value = true;
  proxySaved.value = false;
  try {
    await networkSetConfig(proxyMode.value, proxyUrl.value.trim());
    proxyStatus.value = await networkStatus();
    proxySaved.value = true;
    toast(i18n.t("settings.proxy.saved"));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    proxySaving.value = false;
  }
}

async function testProxy(): Promise<void> {
  if (proxyTesting.value) return;
  proxyTesting.value = true;
  proxyProbe.value = null;
  try {
    proxyProbe.value = await networkProbe(proxyMode.value, proxyUrl.value.trim());
  } catch (error) {
    proxyProbe.value = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: 0,
    };
  } finally {
    proxyTesting.value = false;
  }
}

async function onToggleCli(): Promise<void> {
  if (cliBusy.value) return;
  if (!isTauri()) {
    cliError.value = i18n.t("settings.cli.desktopOnly");
    toast(cliError.value, "error");
    return;
  }
  if (cli.value?.state === "system") {
    toast(i18n.t("settings.cli.systemInstalled"));
    return;
  }
  cliBusy.value = true;
  cliError.value = "";
  try {
    cli.value = cliOn.value ? await uninstallCli() : await installCli();
    toast(
      i18n.t(cliOn.value ? "settings.cli.mountedToast" : "settings.cli.unmountedToast"),
    );
  } catch (error) {
    cliError.value = error instanceof Error ? error.message : String(error);
    toast(cliError.value, "error");
  } finally {
    cliBusy.value = false;
  }
}

async function copy(value: string | null): Promise<void> {
  if (!value) return;
  if (await copyText(value)) toast(i18n.t("settings.copy.ok"));
  else toast(i18n.t("copy.failed"), "error");
}

function openCliFromAi(): void {
  active.value = "cli";
}

function onTheme(id: ThemeMode): void {
  setTheme(id);
}

function onAccent(id: AccentColor): void {
  setAccent(id);
}

function back(): void {
  layout.closeSettings();
}

onMounted(() => {
  void updater.loadVersion();
  void loadAgent();
  void loadMcp();
  void loadNetwork();
  void loadModelSources();
  void loadCloudTts();
  void loadCli();
});
</script>

<template>
  <div class="settings">
    <!-- 设置自带的侧栏 -->
    <aside class="settings-nav">
      <button class="back" @click="back">
        <ArrowLeftIcon class="back-icon" />
        <span class="back-label">{{ i18n.t("settings.back") }}</span>
      </button>

      <nav class="nav-list" :aria-label="i18n.t('settings.navAria')">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          class="nav-item"
          :class="{ on: active === s.id }"
          :aria-current="active === s.id ? 'page' : undefined"
          @click="active = s.id"
        >
          <span class="nav-ind" />
          <span class="nav-text">
            <span class="nav-label">{{ i18n.t(s.labelKey) }}</span>
            <span class="nav-caption">{{ i18n.t(s.captionKey) }}</span>
          </span>
        </button>
      </nav>
    </aside>

    <!-- 内容：居中列 -->
    <section class="settings-body">
      <div class="settings-content">
        <h1 class="page-title">{{ i18n.t(activeMeta.labelKey) }}</h1>
        <p class="page-sub">{{ i18n.t(activeMeta.captionKey) }}</p>

        <!-- 通用 -->
        <template v-if="active === 'general'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.language") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.language.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.language.hint") }}</span>
                </div>
                <div class="m3-seg" role="group" :aria-label="i18n.t('settings.language.label')">
                  <button
                    v-for="l in i18n.locales"
                    :key="l.id"
                    class="m3-seg-btn"
                    :class="{ on: i18n.locale.value === l.id }"
                    :aria-pressed="i18n.locale.value === l.id"
                    @click="i18n.setLocale(l.id)"
                  >
                    {{ l.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.project") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.project.current") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.project.currentHint") }}</span>
                </div>
                <span class="row-value">{{ projectName }}</span>
              </div>
              <div class="row output-row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.output.resolution") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.output.resolutionHint") }}</span>
                </div>
                <div class="output-controls">
                  <Md3Select
                    class="output-select"
                    :model-value="resolutionPresetId"
                    :options="resolutionOptions"
                    :label="i18n.t('settings.output.resolution')"
                    @update:model-value="onResolutionPreset"
                  />
                  <NumberField
                    :model-value="project.doc.width"
                    :min="MIN_PROJECT_DIMENSION"
                    :max="MAX_PROJECT_DIMENSION"
                    :step="2"
                    :sr-label="i18n.t('settings.output.width')"
                    input-width="58px"
                    @update:model-value="onProjectWidth"
                  />
                  <span class="output-times">×</span>
                  <NumberField
                    :model-value="project.doc.height"
                    :min="MIN_PROJECT_DIMENSION"
                    :max="MAX_PROJECT_DIMENSION"
                    :step="2"
                    :sr-label="i18n.t('settings.output.height')"
                    input-width="58px"
                    @update:model-value="onProjectHeight"
                  />
                </div>
              </div>
              <div class="row output-row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.output.fps") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.output.fpsHint") }}</span>
                </div>
                <div class="output-controls">
                  <Md3Select
                    class="output-select"
                    :model-value="fpsPresetId"
                    :options="fpsOptions"
                    :label="i18n.t('settings.output.fps')"
                    @update:model-value="onFpsPreset"
                  />
                  <NumberField
                    :model-value="project.doc.fps"
                    :min="MIN_PROJECT_FPS"
                    :max="MAX_PROJECT_FPS"
                    :step="1"
                    :decimals="3"
                    :sr-label="i18n.t('settings.output.fps')"
                    input-width="64px"
                    @update:model-value="onProjectFps"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 外观 -->
        <template v-else-if="active === 'appearance'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.theme") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.theme.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.theme.hint") }}</span>
                </div>
                <div class="m3-seg" role="group" :aria-label="i18n.t('settings.theme.label')">
                  <button
                    v-for="t in THEMES"
                    :key="t.id"
                    class="m3-seg-btn"
                    :class="{ on: themeMode === t.id }"
                    :aria-pressed="themeMode === t.id"
                    @click="onTheme(t.id)"
                  >
                    {{ i18n.t(t.labelKey) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.accent") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.accent.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.accent.hint") }}</span>
                </div>
                <div class="swatches" role="group" :aria-label="i18n.t('settings.accent.label')">
                  <button
                    v-for="a in ACCENTS"
                    :key="a.id"
                    class="swatch"
                    :class="{ on: accent === a.id }"
                    :style="{ backgroundColor: a.swatch }"
                    :aria-label="i18n.t(a.labelKey)"
                    :aria-pressed="accent === a.id"
                    @click="onAccent(a.id)"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="active === 'layout'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.panels") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.panels.tracks") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.panels.tracksHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: layout.showTimeline }"
                  role="switch"
                  :aria-checked="layout.showTimeline"
                  :aria-label="i18n.t('settings.panels.tracks')"
                  @click="layout.showTimeline = !layout.showTimeline"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.panels.inspector") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.panels.inspectorHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: layout.showPanel }"
                  role="switch"
                  :aria-checked="layout.showPanel"
                  :aria-label="i18n.t('settings.panels.inspector')"
                  @click="layout.showPanel = !layout.showPanel"
                />
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.width") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.width.tracks") }}</span>
                </div>
                <NumberField
                  v-model="layout.timelineHeight"
                  :min="MIN_TIMELINE_HEIGHT"
                  :max="MAX_TIMELINE_HEIGHT"
                  :step="10"
                  :sr-label="i18n.t('settings.width.tracks')"
                  input-width="40px"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.width.inspector") }}</span>
                </div>
                <NumberField
                  v-model="layout.panelWidth"
                  :min="MIN_PANEL_WIDTH"
                  :max="MAX_PANEL_WIDTH"
                  :step="10"
                  :sr-label="i18n.t('settings.width.inspector')"
                  input-width="40px"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- AI / MCP -->
        <template v-else-if="active === 'ai'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.ai.title") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.ai.baseUrl") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.ai.baseUrlHint") }}</span>
                </div>
                <input
                  v-model="agentBaseUrl"
                  class="md3-field net-input"
                  :placeholder="i18n.t('settings.ai.baseUrlPlaceholder')"
                  spellcheck="false"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.ai.apiKey") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.ai.apiKeyHint") }}</span>
                </div>
                <input
                  v-model="agentApiKey"
                  class="md3-field net-input"
                  type="password"
                  autocomplete="off"
                  :placeholder="i18n.t('settings.ai.apiKeyPlaceholder')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.ai.model") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.ai.modelHint") }}</span>
                </div>
                <div class="row-combo">
                  <ComboField
                    v-model="agentModel"
                    :options="agentModelList"
                    :label="i18n.t('settings.ai.model')"
                    :placeholder="i18n.t('settings.ai.modelPlaceholder')"
                  />
                </div>
              </div>
              <div class="row actions-row">
                <button class="scan-btn" :disabled="agentBusy" @click="fetchModels">
                  {{
                    agentBusy
                      ? i18n.t("settings.ai.fetching")
                      : i18n.t("settings.ai.fetchModels")
                  }}
                </button>
                <button class="scan-btn" :disabled="agentBusy" @click="testAgent">
                  {{ agentBusy ? i18n.t("settings.ai.testing") : i18n.t("settings.ai.test") }}
                </button>
                <button class="scan-btn primary" :disabled="agentSaving" @click="saveAgent">
                  {{ i18n.t("settings.ai.save") }}
                </button>
              </div>
              <p
                v-if="agentProbe"
                class="probe"
                :class="{ ok: agentProbe.ok, error: !agentProbe.ok }"
              >
                {{
                  i18n.t(
                    agentProbe.ok ? "settings.ai.probeOk" : "settings.ai.probeFail",
                    { detail: agentProbe.detail, ms: agentProbe.ms },
                  )
                }}
              </p>
              <p v-else-if="agentSaved" class="probe ok">
                {{ i18n.t("settings.ai.saved") }}
              </p>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.mcp.server") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.enable") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.mcp.enableHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: mcpOn }"
                  role="switch"
                  :aria-checked="mcpOn"
                  :disabled="mcpSaving"
                  @click="toggleMcp"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.port") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.mcp.portHint") }}</span>
                </div>
                <NumberField
                  :model-value="mcpPortNumber"
                  :min="0"
                  :max="65535"
                  :step="1"
                  :decimals="0"
                  input-width="58px"
                  :sr-label="i18n.t('settings.mcp.port')"
                  :disabled="mcpSaving || !mcp?.enabled"
                  @update:model-value="onMcpPortValue"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.status") }}</span>
                </div>
                <span class="row-value" :class="{ 'status-on': mcpRunning }">
                  {{
                    mcpError ||
                    (mcpRunning
                      ? i18n.t("settings.mcp.running")
                      : i18n.t("settings.mcp.stopped"))
                  }}
                </span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.usage") }}</span>
                </div>
                <span class="row-value mono">
                  {{ mcpEndpoint || i18n.t("settings.mcp.notListening") }}
                </span>
                <button class="scan-btn" :disabled="!mcpEndpoint" @click="copy(mcpEndpoint)">
                  {{ i18n.t("settings.mcp.copy") }}
                </button>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.security") }}</span>
                </div>
                <span class="row-value hint">{{ i18n.t("settings.mcp.securityHint") }}</span>
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.skills.group") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.skills.title") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.skills.hint") }}</span>
                </div>
                <button class="scan-btn" @click="openCliFromAi">
                  {{ i18n.t("settings.skills.openCli") }}
                </button>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.skills.mount") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.skills.mountHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: cliOn }"
                  role="switch"
                  :aria-checked="cliOn"
                  :disabled="cliBusy"
                  @click="onToggleCli"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- 语音合成 -->
        <template v-else-if="active === 'tts'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.tts.providers") }}</div>
            <div class="card">
              <p v-if="ttsLoading" class="probe">{{ i18n.t("common.loading") }}</p>
              <p v-else-if="cloudProviders.length === 0" class="probe">
                {{ i18n.t("settings.tts.empty") }}
              </p>
              <div
                v-for="provider in cloudProviders"
                :key="provider.id"
                class="row provider-row"
                :class="{ on: editingTtsId === provider.id }"
                @click="editProvider(provider)"
              >
                <div class="row-text">
                  <span class="row-title">{{ provider.name }}</span>
                  <span class="row-sub">
                    {{ i18n.t(`settings.tts.kind.${provider.kind}`) }} ·
                    {{ provider.voice || i18n.t("settings.tts.noVoice") }}
                  </span>
                </div>
                <span class="row-value" :class="{ 'status-on': provider.enabled }">
                  {{
                    i18n.t(
                      provider.enabled
                        ? "settings.tts.enabledOn"
                        : "settings.tts.enabledOff",
                    )
                  }}
                </span>
                <button
                  class="scan-btn"
                  :disabled="ttsSaving"
                  @click.stop="deleteProvider(provider)"
                >
                  {{ i18n.t("settings.tts.delete") }}
                </button>
              </div>
              <div class="row actions-row">
                <button class="scan-btn primary" @click="newProvider">
                  {{ i18n.t("settings.tts.add") }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="ttsDraft" class="group">
            <div class="group-title">
              {{ i18n.t(editingTtsId ? "settings.tts.edit" : "settings.tts.new") }}
            </div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.tts.name") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.tts.nameHint") }}</span>
                </div>
                <input
                  v-model="ttsDraft.name"
                  class="md3-field net-input"
                  spellcheck="false"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.tts.kind") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.tts.kindHint") }}</span>
                </div>
                <Md3Select
                  v-model="ttsDraft.kind"
                  :options="ttsKindOptions"
                  :label="i18n.t('settings.tts.kind')"
                />
              </div>
              <p v-if="ttsDraft.kind === 'custom'" class="probe">
                {{ i18n.t("settings.tts.customHint") }}
              </p>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.tts.enabled") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.tts.enabledHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: ttsDraft.enabled }"
                  role="switch"
                  :aria-checked="ttsDraft.enabled"
                  :aria-label="i18n.t('settings.tts.enabled')"
                  @click="ttsDraft.enabled = !ttsDraft.enabled"
                />
              </div>

              <div
                v-for="field in ttsFields"
                :key="field.key"
                class="row"
              >
                <div class="row-text">
                  <span class="row-title">{{ i18n.t(field.labelKey) }}</span>
                  <span v-if="field.hintKey" class="row-sub">
                    {{ i18n.t(field.hintKey) }}
                  </span>
                </div>
                <Md3Select
                  v-if="field.key === 'format'"
                  v-model="ttsDraft.format"
                  :options="ttsFormatOptions"
                  :label="i18n.t(field.labelKey)"
                />
                <Md3Select
                  v-else-if="field.key === 'method'"
                  v-model="ttsDraft.method"
                  :options="ttsMethodOptions"
                  :label="i18n.t(field.labelKey)"
                />
                <NumberField
                  v-else-if="field.key === 'speed' || field.key === 'volume' || field.key === 'pitch'"
                  :model-value="numericValue(field.key)"
                  :min="numericSpec(field.key).min"
                  :max="numericSpec(field.key).max"
                  :step="numericSpec(field.key).step"
                  :decimals="numericSpec(field.key).decimals"
                  :input-width="numericSpec(field.key).width"
                  :sr-label="i18n.t(field.labelKey)"
                  @update:model-value="setNumeric(field.key, $event)"
                />
                <div v-else-if="field.key === 'voice'" class="row-combo">
                  <ComboField
                    v-model="ttsDraft.voice"
                    :options="ttsVoiceIds"
                    :label="i18n.t(field.labelKey)"
                    :placeholder="field.placeholder"
                    :empty="i18n.t('settings.tts.voicesEmpty')"
                  />
                </div>
                <textarea
                  v-else-if="field.multiline"
                  v-model="ttsDraft[field.key]"
                  class="md3-field mirror-field"
                  rows="3"
                  spellcheck="false"
                  :placeholder="field.placeholder"
                />
                <input
                  v-else
                  v-model="ttsDraft[field.key]"
                  class="md3-field net-input"
                  :type="field.sensitive ? 'password' : 'text'"
                  :placeholder="field.placeholder"
                  spellcheck="false"
                />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.tts.voices") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.tts.voicesHint") }}</span>
                </div>
                <textarea
                  v-model="ttsDraft.voices"
                  class="md3-field mirror-field"
                  rows="3"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.tts.voicesPlaceholder')"
                />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.tts.testText") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.tts.testTextHint") }}</span>
                </div>
                <input
                  v-model="ttsTestText"
                  class="md3-field net-input"
                  spellcheck="false"
                />
              </div>

              <div class="row actions-row">
                <button
                  class="scan-btn"
                  :disabled="ttsVoicesLoading"
                  @click="fetchTtsVoices"
                >
                  {{
                    ttsVoicesLoading
                      ? i18n.t("settings.tts.fetchingVoices")
                      : i18n.t("settings.tts.fetchVoices")
                  }}
                </button>
                <button class="scan-btn" :disabled="ttsTesting" @click="testTtsProvider">
                  {{
                    ttsTesting
                      ? i18n.t("settings.tts.testing")
                      : i18n.t("settings.tts.test")
                  }}
                </button>
                <button v-if="ttsTestAudio" class="scan-btn" @click="playTestAudio">
                  {{ i18n.t("settings.tts.play") }}
                </button>
                <button class="scan-btn primary" :disabled="ttsSaving" @click="saveProvider">
                  {{
                    ttsSaving
                      ? i18n.t("settings.tts.saving")
                      : i18n.t("settings.tts.save")
                  }}
                </button>
              </div>
              <p
                v-if="ttsTestResult"
                class="probe"
                :class="{ ok: ttsTestResult.ok, error: !ttsTestResult.ok }"
              >
                {{ ttsTestResult.detail }}
              </p>
              <p v-if="ttsVoiceError" class="probe error">{{ ttsVoiceError }}</p>
              <p v-else-if="ttsVoiceOptions.length" class="probe ok">
                {{
                  i18n.t("settings.tts.voicesFetched", {
                    count: ttsVoiceOptions.length,
                  })
                }}
              </p>
            </div>
          </div>
        </template>

        <!-- 网络 -->
        <template v-else-if="active === 'network'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.proxy.group") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.proxy.mode") }}</span>
                </div>
                <div class="m3-seg" role="group" :aria-label="i18n.t('settings.proxy.mode')">
                  <button
                    v-for="mode in PROXY_MODES"
                    :key="mode.id"
                    class="m3-seg-btn"
                    :class="{ on: proxyMode === mode.id }"
                    :aria-pressed="proxyMode === mode.id"
                    @click="proxyMode = mode.id"
                  >
                    {{ i18n.t(mode.labelKey) }}
                  </button>
                </div>
              </div>
              <div v-if="proxyMode === 'manual'" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.proxy.url") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.proxy.urlHint") }}</span>
                </div>
                <input
                  v-model="proxyUrl"
                  class="md3-field net-input"
                  :placeholder="i18n.t('settings.proxy.urlPlaceholder')"
                  spellcheck="false"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.proxy.current") }}</span>
                </div>
                <span class="row-value">{{ proxySourceLabel }}</span>
                <button class="scan-btn" :disabled="proxyTesting" @click="testProxy">
                  {{
                    proxyTesting
                      ? i18n.t("settings.proxy.testing")
                      : i18n.t("settings.proxy.test")
                  }}
                </button>
              </div>
              <p
                v-if="proxyProbe"
                class="probe"
                :class="{ ok: proxyProbe.ok, error: !proxyProbe.ok }"
              >
                {{
                  i18n.t(
                    proxyProbe.ok ? "settings.proxy.probeOk" : "settings.proxy.probeFail",
                    { detail: proxyProbe.detail },
                  )
                }}
              </p>
              <div class="row actions-row">
                <button class="scan-btn primary" :disabled="proxySaving" @click="saveNetwork">
                  {{
                    proxySaved
                      ? i18n.t("settings.proxy.saved")
                      : i18n.t("settings.proxy.save")
                  }}
                </button>
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.store.group") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.store.source") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.store.sourceHint") }}</span>
                </div>
                <div
                  class="m3-seg"
                  role="group"
                  :aria-label="i18n.t('settings.store.source')"
                >
                  <button
                    v-for="pref in MODEL_SOURCE_PREFS"
                    :key="pref.id"
                    class="m3-seg-btn"
                    :class="{ on: modelSourcePref === pref.id }"
                    :aria-pressed="modelSourcePref === pref.id"
                    @click="modelSourcePref = pref.id"
                  >
                    {{ i18n.t(pref.labelKey) }}
                  </button>
                </div>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.store.models") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.store.modelsHint") }}</span>
                </div>
                <textarea
                  v-model="modelMirrors"
                  class="md3-field mirror-field"
                  rows="3"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.store.modelsPlaceholder')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.store.prefix") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.store.prefixHint") }}</span>
                </div>
                <input
                  v-model="modelDownloadPrefix"
                  class="md3-field net-input"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.store.prefixPlaceholder')"
                />
              </div>
              <p class="probe">{{ i18n.t("settings.store.saveHint") }}</p>
              <div class="row actions-row">
                <button class="scan-btn primary" :disabled="sourceSaving" @click="saveModelSources">
                  {{
                    sourceSaving
                      ? i18n.t("settings.store.saving")
                      : sourceSaved
                        ? i18n.t("settings.store.saved")
                        : i18n.t("settings.store.save")
                  }}
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- 命令行 -->
        <template v-else-if="active === 'cli'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.cli.group") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.mount") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.cli.mountHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: cliOn }"
                  role="switch"
                  :aria-checked="cliOn"
                  :disabled="cliBusy"
                  @click="onToggleCli"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.status") }}</span>
                </div>
                <span class="row-value">
                  {{ cliBusy ? i18n.t("settings.cli.busy") : cliStateLabel }}
                </span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.command") }}</span>
                </div>
                <span class="row-value mono">{{ cliLocation }}</span>
              </div>
              <div v-if="cli?.full_path && !cliOn" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.fullPath") }}</span>
                </div>
                <span class="row-value mono">{{ cli.full_path }}</span>
                <button class="scan-btn" @click="copy(cli.full_path)">
                  {{ i18n.t("settings.cli.copy") }}
                </button>
              </div>
              <div v-if="cli?.manual_command" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.manual") }}</span>
                </div>
                <span class="row-value mono">{{ cli.manual_command }}</span>
                <button class="scan-btn" @click="copy(cli.manual_command)">
                  {{ i18n.t("settings.cli.copy") }}
                </button>
              </div>
            </div>
            <p class="probe" :class="{ error: !!cliError }">{{ cliMessage }}</p>
          </div>
        </template>

        <!-- 关于 -->
        <template v-else>
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.about.app") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.about.version") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.about.versionHint") }}</span>
                </div>
                <span class="row-value">v{{ updater.version || APP_VERSION }}</span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.about.engine") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.about.engineHint") }}</span>
                </div>
                <span class="row-value">Tauri + ffmpeg</span>
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.update.group") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ updateTitle }}</span>
                  <span class="row-sub">{{ updateMessage }}</span>
                </div>
                <div class="row-actions">
                  <button
                    v-if="updater.phase === 'ready'"
                    class="scan-btn"
                    @click="updater.restart()"
                  >
                    {{ i18n.t("settings.update.restart") }}
                  </button>
                  <button
                    v-else-if="updater.phase === 'available'"
                    class="scan-btn"
                    @click="updater.install()"
                  >
                    {{ i18n.t("settings.update.download") }}
                  </button>
                  <button
                    v-else
                    class="scan-btn"
                    :disabled="updater.phase === 'checking' || updater.phase === 'downloading'"
                    @click="updater.check()"
                  >
                    {{ i18n.t("settings.update.check") }}
                  </button>
                </div>
              </div>
              <div v-if="updater.phase === 'downloading'" class="row">
                <div
                  class="update-progress"
                  role="progressbar"
                  :aria-valuenow="Math.round(updater.progress * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="update-progress-fill"
                    :style="{ width: `${Math.round(updater.progress * 100)}%` }"
                  />
                </div>
              </div>
              <div v-if="updater.info?.notes && updater.phase !== 'idle'" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.update.notes") }}</span>
                  <p class="row-sub update-notes">{{ updater.info.notes }}</p>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background-color: var(--app-bg);
}

/* ---- 设置侧栏 ---- */
.settings-nav {
  width: 220px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 14px;
  border-right: 1px solid rgb(var(--md-outline-variant) / 0.3);
  overflow-y: auto;
}
.back {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.back:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.back:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.back-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 6px 14px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.nav-item:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.nav-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.nav-item.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.nav-ind {
  position: absolute;
  left: 4px;
  top: 50%;
  width: 3px;
  height: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  transform: translateY(-50%);
  opacity: 0;
  transition: height 0.16s ease, opacity 0.16s ease;
}
.nav-item.on .nav-ind {
  height: 20px;
  opacity: 1;
}
.nav-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.nav-label {
  font-size: 14px;
  font-weight: 500;
}
.nav-caption {
  font-size: 11px;
  opacity: 0.7;
}

/* ---- 内容 ---- */
.settings-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
}
.settings-content {
  width: 100%;
  max-width: 720px;
  padding: 32px 32px 56px;
}
.page-title {
  margin: 0;
  font-size: 26px;
  line-height: 1.25;
  font-weight: 400;
  color: rgb(var(--md-on-surface));
}
.page-sub {
  margin: 4px 0 24px;
  font-size: 13px;
  color: rgb(var(--md-on-surface-variant));
}
.group + .group {
  margin-top: 22px;
}
.group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: rgb(var(--md-primary));
  padding: 0 4px 8px;
}
.card {
  background-color: var(--app-inset);
  border-radius: 20px;
  padding: 4px 16px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 62px;
  padding: 10px 0;
}
.row + .row {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.row-title {
  font-size: 14px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.row-sub {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.row-value {
  font-size: 13px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  flex: 0 0 auto;
}
.row-value.mono {
  max-width: 360px;
  white-space: normal;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-align: right;
}
.row-value.hint {
  max-width: 380px;
  white-space: normal;
  text-align: right;
  font-size: 11px;
  line-height: 1.5;
}
.row-value.status-on {
  color: rgb(var(--md-primary));
}
.output-row {
  align-items: flex-start;
}
.output-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex: 0 0 auto;
}
.output-select {
  width: 150px;
}
.output-times {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.net-input {
  width: 300px;
  max-width: 58%;
  flex: 0 0 auto;
}
.row-combo {
  width: 220px;
  max-width: 58%;
  flex: 0 0 auto;
}
textarea.mirror-field {
  width: 360px;
  max-width: 58%;
  height: auto;
  min-height: 78px;
  padding: 8px 10px;
  border-radius: 12px;
  resize: vertical;
  font-size: 12px;
  line-height: 1.5;
  flex: 0 0 auto;
}
.provider-row {
  cursor: pointer;
  border-radius: 12px;
  padding-left: 8px;
  padding-right: 8px;
  transition: background-color 0.14s ease;
}
.provider-row:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.provider-row.on {
  background-color: rgb(var(--md-secondary-container) / 0.55);
}
.actions-row {
  justify-content: flex-end;
  gap: 8px;
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}
.update-progress {
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.14);
}
.update-progress-fill {
  height: 100%;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.update-notes {
  margin: 0;
  white-space: pre-wrap;
}
.scan-btn {
  height: 30px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, opacity 0.14s ease;
}
.scan-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-primary) / 0.08);
}
.scan-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.scan-btn.primary {
  border-color: transparent;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.scan-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.probe {
  margin: 0;
  padding: 4px 0 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-muted));
  word-break: break-word;
}
.probe.ok {
  color: rgb(var(--md-primary));
}
.probe.error {
  color: rgb(var(--md-error));
}

/* ---- 分段按钮 ---- */
.m3-seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  flex: 0 0 auto;
}
.m3-seg-btn {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.m3-seg-btn:hover {
  color: rgb(var(--md-on-surface));
}
.m3-seg-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.m3-seg-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

/* ---- 主题色 swatches ---- */
.swatches {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.swatch {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: transform 0.16s ease;
}
.swatch:hover {
  transform: scale(1.08);
}
.swatch:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.swatch.on::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 999px;
  border: 2px solid rgb(var(--md-primary));
}

/* ---- 开关 ---- */
/* 与 ai-daw 的 .m3-switch 保持一致：关闭态是带底色的轨道 + 左对齐小把手。 */
.m3-switch {
  width: 52px;
  height: 32px;
  flex: 0 0 auto;
  position: relative;
  padding: 0;
  border: 2px solid rgb(var(--md-outline));
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  transition:
    background-color var(--md-ease-emphasized),
    border-color var(--md-ease-emphasized);
}
.m3-switch::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 6px;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
  transition:
    left var(--md-ease-emphasized-decel),
    width var(--md-ease-emphasized-decel),
    height var(--md-ease-emphasized-decel),
    margin-top var(--md-ease-emphasized-decel),
    background-color var(--md-ease-emphasized-decel);
}
.m3-switch.on {
  background-color: rgb(var(--md-primary));
  border-color: rgb(var(--md-primary));
}
.m3-switch.on::after {
  /* 轨道内宽 = 52 − 2×2(border) = 48；把手 24，右侧留 2 → left = 22。 */
  left: 22px;
  width: 24px;
  height: 24px;
  margin-top: -12px;
  background-color: rgb(var(--md-on-primary));
}
.m3-switch:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.m3-switch:disabled {
  opacity: 0.45;
  cursor: default;
}

@media (max-width: 820px) {
  .settings-nav {
    width: 76px;
    padding: 10px 8px;
  }
  .back-label,
  .nav-text {
    display: none;
  }
  .back,
  .nav-item {
    justify-content: center;
    padding: 0;
  }
  .settings-content {
    padding: 24px 18px 44px;
  }
  .row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .back,
  .nav-item,
  .nav-ind,
  .m3-seg-btn,
  .m3-switch,
  .m3-switch::after,
  .swatch {
    transition: none;
  }
}
</style>
