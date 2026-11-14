<script setup lang="ts">
/**
 * 设置页：自带一条侧栏 + 居中内容列，视觉与 ai-daw 一致。
 * 应用内全屏页（layout.settingsOpen），不引入路由。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowLeftIcon } from "@heroicons/vue/24/outline";
import NumberField from "@/components/common/NumberField.vue";
import Md3Slider from "@/components/common/Md3Slider.vue";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
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
import { modelHfTokenStatus, modelSaveHfToken } from "@/core/modelApi";
import { useProjectStore } from "@/stores/project";
import { useOnboardingStore } from "@/stores/onboarding";
import { useAgentStore } from "@/stores/agent";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useSdcppStore } from "@/stores/sdcpp";
import { useDownloadsStore } from "@/stores/downloads";
import { useDeviceStore } from "@/stores/device";
import { useUpdaterStore } from "@/stores/updater";
import { displayProjectName } from "@/utils/projectName";
import {
  webAccessInfo,
  webAccessOpen,
  webAccessSetLan,
  type WebAccessInfo,
} from "@/core/webApi";
import { useI18n, type Locale } from "@/i18n";
import type {
  AgentProbe,
  BackendInfo,
  BackendOption,
  BackendPreference,
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
  aiBackendInfo,
  aiSetBackend,
  backendFallback,
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
import {
  cloudGenConfig,
  cloudGenPresets,
  cloudGenSetConfig,
  cloudGenTest,
} from "@/core/cloudGenApi";
import type {
  CloudGenKind,
  CloudGenPreset,
  CloudGenProvider,
  CloudGenTest,
  GenCapability,
} from "@/types/cloudGen";
import {
  capabilitySummary,
  effectiveCapabilities,
} from "@/utils/cloudGen";
import {
  pluginRegistryConfig,
  pluginSetRegistryConfig,
} from "@/core/pluginApi";
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
import { humanSize } from "@/utils/size";
import { appRestart } from "@/core/runtimeApi";
import {
  dataDirCleanupPrevious,
  dataDirInfo,
  dataDirMigrate,
  onDataDirProgress,
  pickDataDir,
} from "@/core/storageApi";
import type { DataDirInfo, DataDirProgress, DataDirSource } from "@/types/storage";

type Section = SettingsSection;

const SECTIONS: { id: Section; labelKey: string; captionKey: string }[] = [
  { id: "general", labelKey: "settings.section.general", captionKey: "settings.section.general.caption" },
  {
    id: "appearance",
    labelKey: "settings.section.appearance",
    captionKey: "settings.section.appearance.caption",
  },
  { id: "layout", labelKey: "settings.section.layout", captionKey: "settings.section.layout.caption" },
  { id: "storage", labelKey: "settings.section.storage", captionKey: "settings.section.storage.caption" },
  { id: "network", labelKey: "settings.section.network", captionKey: "settings.section.network.caption" },
  { id: "ai", labelKey: "settings.section.ai", captionKey: "settings.section.ai.caption" },
  { id: "gen", labelKey: "settings.section.gen", captionKey: "settings.section.gen.caption" },
  { id: "tts", labelKey: "settings.section.tts", captionKey: "settings.section.tts.caption" },
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

const localeSegOptions = computed(() =>
  i18n.locales.map((locale) => ({ value: locale.id, label: locale.label })),
);
const themeSegOptions = computed(() =>
  THEMES.map((theme) => ({ value: theme.id, label: i18n.t(theme.labelKey) })),
);
const proxySegOptions = computed(() =>
  PROXY_MODES.map((mode) => ({ value: mode.id, label: i18n.t(mode.labelKey) })),
);
const sourceSegOptions = computed(() =>
  MODEL_SOURCE_PREFS.map((pref) => ({ value: pref.id, label: i18n.t(pref.labelKey) })),
);

const APP_VERSION = "1.0.0";

const i18n = useI18n();
const layout = useLayoutStore();
const onboarding = useOnboardingStore();
const runtimes = useRuntimesStore();
const sdcpp = useSdcppStore();
const downloads = useDownloadsStore();
const device = useDeviceStore();
const project = useProjectStore();
const agentStore = useAgentStore();
const models = useModelsStore();
const updater = useUpdaterStore();

const active = ref<Section>(layout.settingsSection ?? "general");
const activeMeta = computed(() => SECTIONS.find((s) => s.id === active.value) ?? SECTIONS[0]);
const contentScroll = ref<HTMLElement | null>(null);
watch(active, () => contentScroll.value?.scrollTo({ top: 0 }));
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

// ---- 本地 AI 执行后端 ----
const backendInfo = ref<BackendInfo | null>(null);
const backendSaving = ref(false);
/** 只列本机平台支持的项（CUDA 还要求本机有 NVIDIA 驱动）。 */
const backendOptions = computed(() => (backendInfo.value?.options ?? []).filter((option) => option.available));
/** CUDA provider 硬依赖的四个组件（后端没下发 `missing` 时的兜底清单）。 */
function cudaParts(runtime: string): string[] {
  const suffix = runtime === "cuda13" ? "13" : "";
  return [`cudart${suffix}`, `cublas${suffix}`, `cufft${suffix}`, `cudnn${suffix}`];
}

/** 组件 id → 界面上显示的名字（清单还没加载时退回 id 本身）。 */
function partName(id: string): string {
  const item = runtimes.items.find((entry) => entry.id === id);
  return item ? i18n.t(item.label) : id;
}

/**
 * 「看起来能用、实际在跑 CPU」的提示。
 *
 * 两种情况都必须说出来，否则用户只会看到「CUDA 已选」，然后发现显卡闲着：
 * 1. 组件缺（provider 载不进来）；
 * 2. provider 没注册成功（本次会话建的会话只能是 CPU）。
 */
const backendWarning = computed(() => {
  const info = backendInfo.value;
  if (!info || (info.preference !== "cuda12" && info.preference !== "cuda13")) return "";
  const cuda = info.options.find((option) => option.kind === info.preference);
  if (!cuda || !cuda.available) return "";
  // 本体都没装：先说本体，别把「组件齐了」当成能跑。
  if (!cuda.runtime_installed) {
    return i18n.t("settings.ai.cudaCoreMissing", {
      version: info.preference === "cuda13" ? "13" : "12",
    });
  }
  const missing = cuda.missing ?? [];
  if (missing.length > 0) {
    return i18n.t("settings.ai.cudaPartsMissing", {
      parts: missing.map(partName).join("、"),
    });
  }
  // 运行时还没被加载过（启动后尚未建会话）时 `ep_ready` 必然是 false：
  // 这不是失败，只有加载过、注册仍失败才提示。
  if (!info.ep_ready && info.loaded_runtime) {
    return i18n.t("settings.ai.cudaNotActive");
  }
  return "";
});

/** 后端按钮的 tooltip：运行时没装 → 提示先去下载。 */
function backendTitle(option: BackendOption): string | undefined {
  return option.runtime_installed ? undefined : i18n.t("settings.ai.runtimeMissing");
}

/** 分段控件用的选项（与按钮版一一对应；文案 / 提示走同一个 i18n）。 */
const backendSegOptions = computed(() =>
  backendOptions.value.map((option) => ({
    value: option.kind,
    label: backendText(option.kind, "label", option.label),
    title: backendTitle(option),
    disabled: backendSaving.value,
  })),
);

function onBackendPick(value: string): void {
  void setBackend(value as BackendPreference);
}

/** 跳到下载管理器 → 运行时（与 ai-daw 设置页的「打开下载管理器」一致）。 */
function openRuntimeManager(): void {
  const id = backendInfo.value?.preference === "cuda13" ? "cuda13" : "cuda";
  downloads.requestFocus("runtime", id);
  layout.closeSettings();
  layout.openDownloads("models");
}

/** 需要下载的运行时本体（CUDA 12 / 13）；随包基线（CPU / DirectML / CoreML）不列。 */
const optionalRuntimes = computed(() =>
  runtimes.items.filter((item) => item.core && !item.bundled),
);

/** 正在从设置页直接下载的那一份（用来画进度、把按钮换成「取消」）。 */
const runtimeInstallId = ref<string | null>(null);

/** 当前偏好的运行时是不是这一份（`cuda12` 对应的清单 id 是 `cuda`）。 */
function isActiveRuntime(id: string): boolean {
  const preference = backendInfo.value?.preference;
  if (!preference) return false;
  const mapped = preference === "cuda12" ? "cuda" : preference;
  return mapped === id;
}

/**
 * 在设置页直接装一份运行库（不用跳管理器）。
 *
 * 装 CUDA 本体会顺带补齐同大版本组件；装完就切过去——用户点「下载 2.9 GB」的本意
 * 是要用它，再让他去别处点一次「切换」纯属多余。需要重启时弹提示。
 */
async function installRuntimeHere(id: string): Promise<void> {
  if (runtimeInstallId.value) return;
  runtimeInstallId.value = id;
  try {
    await runtimes.install(id);
    const kind = id === "cuda13" ? "cuda13" : "cuda12";
    backendInfo.value = await aiSetBackend(kind);
    device.info = backendInfo.value;
    if (backendInfo.value.restart_required) runtimes.requestRestartPrompt();
  } catch (error) {
    if (!runtimes.error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  } finally {
    runtimeInstallId.value = null;
  }
}

/** 重启应用；开发模式下后端会拒绝并返回说明，这里用 toast 告诉用户手动重启。 */
async function restartApp(): Promise<void> {
  try {
    await appRestart();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

/** 确认框里的重启说明：开发模式下补一句「不会自动重启」，别让人点完才发现。 */
function restartBody(): string {
  const body = i18n.t("settings.ai.restartBody");
  return import.meta.env.DEV ? `${body} ${i18n.t("settings.ai.restartDevHint")}` : body;
}

/**
 * 点后端按钮：
 * - 缺运行时 / 组件 → 先弹框确认，跳到下载管理器**自动补齐**（CUDA 本体带同版本组件），
 *   装完再切换并提示重启；
 * - 已在磁盘上 → 直接切换，需要重启时弹框询问。
 */
async function setBackend(preference: BackendPreference): Promise<void> {
  if (backendSaving.value || backendInfo.value?.preference === preference) return;
  const option = backendInfo.value?.options.find((entry) => entry.kind === preference);
  if (!option) return;

  // 缺口 = 本体 +（CUDA 时）同大版本的全套组件。**本体已装、组件缺**也要先补：
  // provider 硬依赖 cudart / cuBLAS / cuFFT / cuDNN，缺一个就载不进来并静默回落 CPU。
  if (runtimes.items.length === 0) await runtimes.load();
  const pending: string[] = [];
  const isCuda = option.kind === "cuda12" || option.kind === "cuda13";
  if (isCuda) {
    const core = runtimes.items.find((entry) => entry.id === option.runtime);
    if (!core || !core.installed) pending.push(option.runtime);
    for (const id of [...(option.missing ?? []), ...cudaParts(option.runtime)]) {
      const item = runtimes.items.find((entry) => entry.id === id);
      if (item && !item.installed && !pending.includes(id)) pending.push(id);
    }
  }

  if (pending.length > 0) {
    const total = pending.reduce(
      (sum, id) => sum + (runtimes.items.find((entry) => entry.id === id)?.bytes ?? 0),
      0,
    );
    const accepted = await confirm({
      title: i18n.t("settings.ai.runtimeMissingTitle"),
      message:
        total > 0
          ? i18n.t("settings.ai.runtimeMissingBody", {
              backend: backendText(option.kind, "label", option.label),
              size: humanSize(total),
            })
          : i18n.t("settings.ai.runtimeMissingBodyUnknown", {
              backend: backendText(option.kind, "label", option.label),
            }),
      confirmText: i18n.t("settings.ai.runtimeMissingGo"),
    });
    if (!accepted) return;

    backendSaving.value = true;
    // 下载管理器在这期间是前台：进度、取消都在那里，和 ai-daw 的流程一致。
    layout.closeSettings();
    layout.openDownloads("models");
    downloads.requestFocus("runtime", pending[0] ?? option.runtime);
    // 同一分区内串行；运行时与别的类型（引擎 / 模型）可以并行，各自一条车道。
    // 下 CUDA 本体时会顺带补齐同大版本的全部组件，后面的 id 会被后端直接跳过。
    const tasks = pending.map((id) => ({
      section: "runtime" as const,
      id,
      label: partName(id),
      bytes: runtimes.items.find((entry) => entry.id === id)?.bytes ?? 0,
    }));
    const ok = await downloads.run(tasks);
    if (!ok) {
      backendSaving.value = false;
      toast(i18n.t("settings.ai.cudaDownloadFailed"));
      return;
    }
    try {
      backendInfo.value = await aiSetBackend(preference);
      device.info = backendInfo.value;
    } catch (error) {
      backendSaving.value = false;
      toast(error instanceof Error ? error.message : String(error));
      return;
    }
    backendSaving.value = false;
    // 装完再回设置页：重启提示由 onMounted 的 `consumeRestartPrompt` 弹出来，
    // 期间离开设置页也不会丢（管理器里还有常驻横幅）。
    if (backendInfo.value.restart_required) runtimes.requestRestartPrompt();
    layout.openSettings("ai");
    return;
  }

  backendSaving.value = true;
  try {
    backendInfo.value = await aiSetBackend(preference);
    if (backendInfo.value.restart_required) {
      const accepted = await confirm({
        title: i18n.t("settings.ai.restartTitle"),
        message: restartBody(),
        confirmText: i18n.t("settings.ai.restartNow"),
      });
      if (accepted) void restartApp();
    } else {
      const label = backendText(option.kind, "label", option.label);
      const loaded = backendInfo.value.loaded_runtime === option.runtime;
      toast(
        i18n.t(
          loaded ? "settings.ai.backendAppliedCurrent" : "settings.ai.backendAppliedNext",
          { backend: label },
        ),
      );
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    backendSaving.value = false;
  }
}

/**
 * 后端文案：后端目录里的中文只作兜底，界面优先用 i18n（英文界面才不会出现中文）。
 */
function backendText(kind: string, field: "label" | "note", fallback: string): string {
  const key = field === "note" ? `backend.${kind}.note` : `backend.${kind}`;
  const text = i18n.t(key);
  return text === key ? fallback : text;
}

const backendNote = computed(() => {
  const current = backendInfo.value?.options.find(
    (option) => option.kind === backendInfo.value?.preference,
  );
  return current ? backendText(current.kind, "note", current.note) : "";
});

async function loadBackend(): Promise<void> {
  try {
    backendInfo.value = await aiBackendInfo();
    device.info = backendInfo.value;
  } catch {
    // 旧版桌面端没有新命令 / 预览环境：保留完整选项，只把非 CPU 标为不可用。
    backendInfo.value = backendFallback();
  }
  // 运行时清单用于弹框里的体积 / 状态文案。
  if (runtimes.items.length === 0) void runtimes.load();
  void sdcpp.load();
  void sdcpp.loadInfo();
}

// ---- sd.cpp 视频后端（与 ONNX Runtime 分开） ----
/**
 * 视频生成后端只有真实存在的引擎：cpu / vulkan / cuda12（macOS 是 metal），
 * 没有「自动」这一档——旧配置里存的 auto 由 Rust 侧换算成「自动挑中的那一份」。
 * 控件与上面的 ONNX Runtime 后端一样，是分段按钮（不是下拉框）。
 */
const sdcppSaving = ref(false);
/** 只列本机真能跑的：AMD 机器上不摆 CUDA（装了也只是一句「找不到 nvcuda.dll」）。 */
const sdcppOptions = computed(() =>
  (sdcpp.info?.options ?? []).filter((option) => option.usable),
);

const sdcppActiveKind = computed(() => {
  const options = sdcppOptions.value;
  const preferred = sdcpp.info?.preference;
  if (preferred && options.some((option) => option.kind === preferred)) return preferred;
  const current = sdcpp.info?.current;
  if (current && options.some((option) => option.kind === current)) return current;
  return options.find((option) => option.recommended)?.kind ?? options[0]?.kind ?? "cpu";
});

const sdcppCurrent = computed(
  () => sdcppOptions.value.find((option) => option.kind === sdcppActiveKind.value) ?? null,
);
const sdcppNote = computed(() => {
  const option = sdcppCurrent.value;
  if (!option) return i18n.t("settings.ai.sdcppHint");
  if (!option.installed) {
    return `${i18n.t(option.note)} · ${i18n.t("sdcpp.downloadSize", {
      size: humanSize(option.bytes),
    })}`;
  }
  return i18n.t(option.note);
});
/** 分段按钮的选项。 */
const sdcppSegOptions = computed(() =>
  sdcppOptions.value.map((option) => ({
    value: option.kind,
    label: i18n.t(option.label),
    title: option.installed ? i18n.t(option.note) : i18n.t("settings.ai.sdcppMissing"),
    disabled: sdcppSaving.value,
  })),
);

function openSdcppManager(): void {
  // macOS 的 CPU 复用 Metal 包：target 要落到真实的构建 id 上，不能拼 `sdcpp-cpu`。
  const target =
    sdcppCurrent.value?.downloadId ??
    `sdcpp-${sdcpp.info?.preference || sdcpp.info?.recommended || "cpu"}`;
  downloads.requestFocus("sdcpp", target);
  layout.closeSettings();
  layout.openDownloads("models");
}

/**
 * 切视频后端：没装 → 确认 → 跳管理器**自动下载** → 装完自动切过去。
 *
 * 以前确认之后只是跳转，既不下载也不切换，用户回来一看偏好还是旧的。
 */
async function setSdcppBackend(kind: string): Promise<void> {
  if (sdcppSaving.value) return;
  const option = sdcppOptions.value.find((item) => item.kind === kind);
  if (!option) return;
  const label = i18n.t(option.label);
  if (!option.installed) {
    const accepted = await confirm({
      title: i18n.t("aiVideo.engineMissingTitle"),
      message: i18n.t("settings.ai.sdcppNeedDownload", {
        backend: label,
        size: humanSize(option.bytes),
      }),
      confirmText: i18n.t("settings.ai.sdcppDownloadGo"),
    });
    if (!accepted) return;

    sdcppSaving.value = true;
    layout.closeSettings();
    layout.openDownloads("models");
    downloads.requestFocus("sdcpp", option.downloadId);
    const ok = await downloads.run([
      { section: "sdcpp", id: option.downloadId, label },
    ]);
    if (!ok) {
      sdcppSaving.value = false;
      layout.openSettings("ai");
      return;
    }
    try {
      await sdcpp.setBackend(kind);
      toast(i18n.t("settings.ai.sdcppApplied", { backend: label }));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      sdcppSaving.value = false;
      layout.openSettings("ai");
    }
    return;
  }
  if (sdcpp.info?.preference === kind) return;
  sdcppSaving.value = true;
  try {
    await sdcpp.setBackend(kind);
    toast(i18n.t("settings.ai.sdcppApplied", { backend: label }));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    sdcppSaving.value = false;
  }
}

// ---- MCP ----
const mcp = ref<McpStatus | null>(null);
const mcpPort = ref("50563");
const mcpSaving = ref(false);
const mcpError = ref("");
const mcpOn = computed(() => mcp.value?.enabled ?? false);
const mcpRunning = computed(() => mcp.value?.running ?? false);
const mcpEndpoint = computed(() => mcp.value?.url ?? null);
/** 配置端口没绑上、退回了临时端口时的一句话说明；正常监听时为 null。 */
const mcpFallbackNote = computed(() => {
  const status = mcp.value;
  if (!status?.fallback) return null;
  const key =
    status.portConflict === "denied"
      ? "settings.mcp.portConflictDenied"
      : "settings.mcp.portConflictBusy";
  return i18n.t(key, { port: status.port, bound: status.boundPort ?? status.port });
});

// ---- 网络 ----
const proxyMode = ref<ProxyMode>("system");
const proxyUrl = ref("");
const proxyStatus = ref<ProxyStatus | null>(null);
const proxyProbe = ref<ProxyProbe | null>(null);
const proxySaving = ref(false);
const proxySaved = ref(false);
const proxyTesting = ref(false);
const pluginRegistryUrl = ref("");
const pluginRegistryMirrors = ref("");
const pluginSaving = ref(false);
const pluginSaved = ref(false);
const proxySourceLabel = computed(
  () => proxyStatus.value?.source ?? i18n.t("settings.proxy.system"),
);

// ---- 模型下载源 / 镜像 ----
const modelSourcePref = ref<ModelSourcePreference>("auto");
/** HF read token：输入框只在「要设置」时有值；已配置的状态用掩码显示。 */
const hfTokenInput = ref("");
const hfTokenHint = ref("");
const hfTokenSaving = ref(false);
const hfTokenError = ref("");
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

/**
 * 关掉编辑器：新建中的草稿直接丢掉（卡片收起），
 * 编辑已保存的服务则只是放弃这次的修改——真正的删除在列表那一行。
 */
function discardTtsDraft(): void {
  editingTtsId.value = null;
  ttsDraft.value = null;
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

// ---- 图像 / 视频生成服务 ----
/** 表单里能力也按数组存，保存时原样回写。 */
interface GenDraft {
  id: string;
  name: string;
  kind: CloudGenKind;
  enabled: boolean;
  base_url: string;
  api_key: string;
  api_secret: string;
  group_id: string;
  image_model: string;
  edit_model: string;
  video_model: string;
  capabilities: GenCapability[];
}

const genPresets = ref<CloudGenPreset[]>([]);
const genProviders = ref<CloudGenProvider[]>([]);
const genDraft = ref<GenDraft | null>(null);
const editingGenId = ref<string | null>(null);
const genLoading = ref(false);
const genSaving = ref(false);
const genTesting = ref(false);
const genTestResult = ref<CloudGenTest | null>(null);
const genTestError = ref("");
const genLoadError = ref("");

function genPreset(kind: CloudGenKind): CloudGenPreset | undefined {
  return genPresets.value.find((item) => item.kind === kind);
}

const genKindOptions = computed<SelectOption[]>(() => {
  const official = i18n.t("settings.gen.groupOfficial");
  const aggregator = i18n.t("settings.gen.groupAggregator");
  return genPresets.value.map((preset) => ({
    id: preset.kind,
    label: i18n.t(`settings.gen.kind.${preset.kind}`),
    group: preset.group === "official" ? official : aggregator,
  }));
});

const genCapabilityLabels = computed<Record<GenCapability | "video", string>>(() => ({
  t2i: i18n.t("settings.gen.cap.t2i"),
  i2i: i18n.t("settings.gen.cap.i2i"),
  t2v: i18n.t("settings.gen.cap.video"),
  i2v: i18n.t("settings.gen.cap.video"),
  video: i18n.t("settings.gen.cap.video"),
}));

function genSummary(provider: CloudGenProvider): string {
  return capabilitySummary(
    effectiveCapabilities(provider, genPresets.value),
    genCapabilityLabels.value,
  );
}

function blankGenDraft(kind: CloudGenKind): GenDraft {
  const preset = genPreset(kind);
  return {
    id: crypto.randomUUID(),
    name: i18n.t(`settings.gen.kind.${kind}`),
    kind,
    enabled: true,
    base_url: preset?.baseUrl ?? "",
    api_key: "",
    api_secret: "",
    group_id: "",
    image_model: preset?.imageModel ?? "",
    edit_model: preset?.editModel ?? "",
    video_model: preset?.videoModel ?? "",
    capabilities: [...(preset?.capabilities ?? [])],
  };
}

function toGenDraft(provider: CloudGenProvider): GenDraft {
  return {
    ...provider,
    capabilities: [...effectiveCapabilities(provider, genPresets.value)],
  };
}

function fromGenDraft(draft: GenDraft): CloudGenProvider {
  return { ...draft, capabilities: [...draft.capabilities] };
}

function genHasCapability(capability: "t2i" | "i2i" | "video"): boolean {
  const caps = genDraft.value?.capabilities ?? [];
  if (capability === "video") return caps.includes("t2v") || caps.includes("i2v");
  return caps.includes(capability);
}

function toggleGenCapability(capability: "t2i" | "i2i" | "video"): void {
  const draft = genDraft.value;
  if (!draft) return;
  const next = new Set(draft.capabilities);
  if (capability === "video") {
    if (next.has("t2v") || next.has("i2v")) {
      next.delete("t2v");
      next.delete("i2v");
    } else {
      next.add("t2v");
      next.add("i2v");
    }
  } else if (next.has(capability)) {
    next.delete(capability);
  } else {
    next.add(capability);
  }
  draft.capabilities = [...next];
}

async function loadCloudGen(): Promise<void> {
  genLoading.value = true;
  genLoadError.value = "";
  try {
    const [config, presets] = await Promise.all([cloudGenConfig(), cloudGenPresets()]);
    genProviders.value = config.providers;
    genPresets.value = presets;
    if (!genDraft.value && genProviders.value[0]) editGenProvider(genProviders.value[0]);
  } catch (error) {
    genLoadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    genLoading.value = false;
  }
}

function newGenProvider(): void {
  editingGenId.value = null;
  genDraft.value = blankGenDraft("openai");
  genTestResult.value = null;
  genTestError.value = "";
}

/** 同 TTS：新建中的草稿直接收起；编辑已保存的服务只放弃修改。 */
function discardGenDraft(): void {
  editingGenId.value = null;
  genDraft.value = null;
  genTestResult.value = null;
  genTestError.value = "";
}

function editGenProvider(provider: CloudGenProvider): void {
  editingGenId.value = provider.id;
  genDraft.value = toGenDraft(provider);
  genTestResult.value = null;
  genTestError.value = "";
}

async function saveGenProvider(): Promise<void> {
  if (!genDraft.value || genSaving.value) return;
  genSaving.value = true;
  genTestError.value = "";
  try {
    const provider = fromGenDraft(genDraft.value);
    const next = [...genProviders.value];
    const index = next.findIndex((item) => item.id === provider.id);
    if (index >= 0) next[index] = provider;
    else next.push(provider);
    genProviders.value = (await cloudGenSetConfig(next)).providers;
    const saved = genProviders.value.find((item) => item.id === provider.id) ?? provider;
    editingGenId.value = saved.id;
    genDraft.value = toGenDraft(saved);
    toast(i18n.t("settings.gen.saved"));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    genSaving.value = false;
  }
}

async function deleteGenProvider(provider: CloudGenProvider): Promise<void> {
  if (genSaving.value) return;
  const accepted = await confirm({
    title: i18n.t("settings.gen.deleteTitle"),
    message: i18n.t("settings.gen.deleteMessage", { name: provider.name }),
    confirmText: i18n.t("common.delete"),
    cancelText: i18n.t("common.cancel"),
  });
  if (!accepted) return;
  genSaving.value = true;
  try {
    const next = genProviders.value.filter((item) => item.id !== provider.id);
    genProviders.value = (await cloudGenSetConfig(next)).providers;
    if (editingGenId.value === provider.id) {
      editingGenId.value = null;
      genDraft.value = null;
      genTestResult.value = null;
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    genSaving.value = false;
  }
}

async function testGenProvider(): Promise<void> {
  if (!genDraft.value || genTesting.value) return;
  genTesting.value = true;
  genTestResult.value = null;
  genTestError.value = "";
  try {
    genTestResult.value = await cloudGenTest(fromGenDraft(genDraft.value));
  } catch (error) {
    genTestError.value = error instanceof Error ? error.message : String(error);
  } finally {
    genTesting.value = false;
  }
}

watch(
  () => genDraft.value?.kind,
  (kind, previous) => {
    // 初次载入保留草稿；用户真的切换类型时把地址 / 模型 / 能力换成该类型的预设。
    if (!genDraft.value || !kind || !previous || previous === kind) return;
    const preset = genPreset(kind);
    const oldName = i18n.t(`settings.gen.kind.${previous}`);
    genDraft.value = {
      ...genDraft.value,
      name: genDraft.value.name === oldName ? i18n.t(`settings.gen.kind.${kind}`) : genDraft.value.name,
      base_url: preset?.baseUrl ?? "",
      image_model: preset?.imageModel ?? "",
      edit_model: preset?.editModel ?? "",
      video_model: preset?.videoModel ?? "",
      capabilities: [...(preset?.capabilities ?? [])],
    };
    genTestResult.value = null;
    genTestError.value = "";
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

/** 读「有没有配 HF token」——后端只回状态与掩码，不回 token 本身。 */
async function refreshHfToken(): Promise<void> {
  try {
    const status = await modelHfTokenStatus();
    hfTokenHint.value = status.hint;
  } catch {
    hfTokenHint.value = "";
  }
}

/** 保存 / 清除 HF token（空串 = 清除）。 */
async function saveHfToken(token: string): Promise<void> {
  if (hfTokenSaving.value) return;
  hfTokenSaving.value = true;
  hfTokenError.value = "";
  try {
    await modelSaveHfToken(token);
    hfTokenInput.value = "";
    await refreshHfToken();
  } catch (err) {
    hfTokenError.value = err instanceof Error ? err.message : String(err);
  } finally {
    hfTokenSaving.value = false;
  }
}

async function loadNetwork(): Promise<void> {
  void refreshHfToken();
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

async function loadPluginRegistry(): Promise<void> {
  try {
    const config = await pluginRegistryConfig();
    pluginRegistryUrl.value = config.url;
    pluginRegistryMirrors.value = config.mirrors.join("\n");
  } catch {
    pluginRegistryUrl.value = "";
    pluginRegistryMirrors.value = "";
  }
}

async function savePluginRegistry(): Promise<void> {
  if (pluginSaving.value) return;
  pluginSaving.value = true;
  pluginSaved.value = false;
  try {
    const config = await pluginSetRegistryConfig(
      pluginRegistryUrl.value.trim(),
      pluginRegistryMirrors.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
    pluginRegistryUrl.value = config.url;
    pluginRegistryMirrors.value = config.mirrors.join("\n");
    pluginSaved.value = true;
    toast(i18n.t("settings.plugins.saved"));
  } catch (error) {
    toast(
      i18n.t("settings.plugins.saveFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    pluginSaving.value = false;
  }
}

async function resetPluginRegistry(): Promise<void> {
  pluginRegistryUrl.value = "";
  pluginRegistryMirrors.value = "";
  await savePluginRegistry();
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

function onLocalePick(value: string): void {
  i18n.setLocale(value as Locale);
}

function onTheme(id: ThemeMode): void {
  setTheme(id);
}

function onAccent(id: AccentColor): void {
  setAccent(id);
}

// ---- 存储：数据目录 ----
const webInfo = ref<WebAccessInfo | null>(null);

async function loadWebInfo(): Promise<void> {
  if (!isTauri()) return;
  try {
    webInfo.value = await webAccessInfo();
  } catch {
    webInfo.value = null;
  }
}

async function setWebLan(lan: boolean): Promise<void> {
  try {
    webInfo.value = await webAccessSetLan(lan);
  } catch {
    // 设置页的失败不打断其他操作；状态保持原样。
  }
}

async function openWebAccess(): Promise<void> {
  try {
    await webAccessOpen();
  } catch {
    // 打不开浏览器时用户仍可以手动复制地址。
  }
}

async function copyWebUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // 剪贴板不可用：地址仍然可见，可手动选中复制。
  }
}

const dataDir = ref<DataDirInfo | null>(null);
const dataDirLoading = ref(false);
const dataDirBusy = ref(false);
const dataDirError = ref("");
const dataDirProgress = ref<DataDirProgress | null>(null);
/** 迁移进度监听：页面卸载时一定要解绑，否则回调会写进已销毁的组件。 */
let offDataDir: (() => void) | null = null;

const dataDirSize = computed(() => humanSize(dataDir.value?.size_bytes ?? 0));
const dataDirSource = computed(() => {
  const source: DataDirSource = dataDir.value?.source ?? "default";
  return i18n.t(`settings.storage.source.${source}`);
});
/** 已迁移、等重启时的新目录；没有则为空串。 */
const dataDirNext = computed(() =>
  dataDir.value?.restart_required ? dataDir.value.next ?? "" : "",
);
const dataDirPrevious = computed(() => dataDir.value?.previous ?? []);

/** 迁移进度文案：扫描阶段不知道总量，复制阶段按字节报百分比。 */
const dataDirProgressText = computed(() => {
  const progress = dataDirProgress.value;
  if (!progress || progress.phase === "scan") return i18n.t("settings.storage.scanning");
  if (progress.phase === "write" || progress.phase === "done") {
    return i18n.t("settings.storage.writing");
  }
  if (progress.total <= 0) {
    return i18n.t("settings.storage.copying", { done: humanSize(progress.done) });
  }
  const percent = Math.min(100, Math.round((progress.done / progress.total) * 100));
  return `${i18n.t("settings.storage.copying", {
    done: `${humanSize(progress.done)} / ${humanSize(progress.total)}`,
  })} · ${percent}%`;
});

const dataDirPercent = computed(() => {
  const progress = dataDirProgress.value;
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
});

async function loadDataDir(): Promise<void> {
  dataDirLoading.value = true;
  dataDirError.value = "";
  try {
    const info = await dataDirInfo();
    dataDir.value = info;
    if (!info) dataDirError.value = i18n.t("settings.storage.desktopOnly");
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error);
  } finally {
    dataDirLoading.value = false;
  }
}

/** 选一个**空**目录 → 确认 → 复制 + 写指针；旧目录留到重启后清理。 */
async function chooseDataDir(): Promise<void> {
  if (dataDirBusy.value || dataDir.value?.portable) return;
  const target = await pickDataDir();
  if (!target) return;
  const accepted = await confirm({
    title: i18n.t("settings.storage.confirmTitle"),
    message: i18n.t("settings.storage.confirmBody", { path: target }),
    confirmText: i18n.t("settings.storage.confirmGo"),
  });
  if (!accepted) return;
  dataDirBusy.value = true;
  dataDirError.value = "";
  dataDirProgress.value = { phase: "scan", done: 0, total: 0, files: 0, message: null };
  try {
    offDataDir = await onDataDirProgress((progress) => {
      dataDirProgress.value = progress;
    });
    await dataDirMigrate(target);
    await loadDataDir();
    toast(i18n.t("settings.storage.done", { path: target }));
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error);
    toast(i18n.t("settings.storage.failed", { error: dataDirError.value }), "error");
  } finally {
    offDataDir?.();
    offDataDir = null;
    dataDirBusy.value = false;
    dataDirProgress.value = null;
  }
}

/** 重启后清理上一次迁移留下的旧目录（指针与发现文件会保留）。 */
async function cleanupPreviousDataDir(): Promise<void> {
  if (dataDirBusy.value || dataDirPrevious.value.length === 0) return;
  const accepted = await confirm({
    title: i18n.t("settings.storage.cleanupTitle"),
    message: i18n.t("settings.storage.cleanupBody", {
      path: dataDirPrevious.value.join(", "),
    }),
    confirmText: i18n.t("settings.storage.cleanupGo"),
    destructive: true,
  });
  if (!accepted) return;
  dataDirBusy.value = true;
  dataDirError.value = "";
  try {
    const removed = await dataDirCleanupPrevious();
    toast(
      removed.length
        ? i18n.t("settings.storage.cleaned", { path: removed.join(", ") })
        : i18n.t("settings.storage.nothingToClean"),
    );
    await loadDataDir();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dataDirError.value = message;
    toast(i18n.t("settings.storage.cleanupFailed", { error: message }), "error");
  } finally {
    dataDirBusy.value = false;
  }
}

function back(): void {
  layout.closeSettings();
}

/** 重看引导：先回到工作区，等界面切换完再量锚点（设置页里没有那些区域）。 */
function replayTour(): void {
  layout.closeSettings();
  window.setTimeout(() => onboarding.startTour(), 260);
}

onMounted(() => {
  void updater.loadVersion();
  void loadAgent();
  void loadBackend();
  void loadMcp();
  void loadNetwork();
  void loadModelSources();
  void loadPluginRegistry();
  void loadCloudTts();
  void loadCloudGen();
  void loadCli();
  void loadDataDir();
  void loadWebInfo();
  // 从下载管理器装完运行库回来：弹一次「重启后生效」（和 ai-daw 一样）。
  if (runtimes.consumeRestartPrompt()) {
    void confirm({
      title: i18n.t("settings.ai.restartTitle"),
      message: restartBody(),
      confirmText: i18n.t("settings.ai.restartNow"),
    }).then((accepted) => {
      if (accepted) void restartApp();
    });
  }
});

onUnmounted(() => {
  offDataDir?.();
  offDataDir = null;
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
    <section ref="contentScroll" class="settings-body">
      <div class="settings-content">
        <h1 class="page-title">{{ i18n.t(activeMeta.labelKey) }}</h1>
        <p class="page-sub">{{ i18n.t(activeMeta.captionKey) }}</p>

        <!-- 通用 -->
        <template v-if="active === 'general'">
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

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.language") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.language.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.language.hint") }}</span>
                </div>
                <SegmentedControl
                  :model-value="i18n.locale.value"
                  :options="localeSegOptions"
                  :aria-label="i18n.t('settings.language.label')"
                  @update:model-value="onLocalePick"
                />
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.startup") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.welcome.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.welcome.hint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: onboarding.welcomeOnStart }"
                  role="switch"
                  :aria-checked="onboarding.welcomeOnStart"
                  :aria-label="i18n.t('settings.welcome.label')"
                  @click="onboarding.setWelcomeOnStart(!onboarding.welcomeOnStart)"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.welcome.replay") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.welcome.replayHint") }}</span>
                </div>
                <button class="scan-btn" @click="replayTour">
                  {{ i18n.t("settings.welcome.replayAction") }}
                </button>
              </div>
            </div>
          </div>

          <!-- Web 访问：浏览器 / 第二屏 -->
          <div v-if="isTauri()" class="group">
            <div class="group-title">{{ i18n.t("settings.web.title") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.web.local") }}</span>
                  <span class="row-sub mono">{{ webInfo?.loopbackUrl ?? "—" }}</span>
                  <span class="row-sub">{{ i18n.t("settings.web.localHint") }}</span>
                </div>
                <button class="scan-btn" :disabled="!webInfo" @click="copyWebUrl(webInfo?.loopbackUrl)">
                  {{ i18n.t("settings.web.copy") }}
                </button>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.web.lan") }}</span>
                  <span class="row-sub mono">{{
                    webInfo?.lanUrl ?? i18n.t("settings.web.lanUnavailable")
                  }}</span>
                  <span class="row-sub">{{ i18n.t("settings.web.lanHint") }}</span>
                  <span v-if="webInfo?.restartRequired" class="row-sub">{{
                    i18n.t("settings.web.restart")
                  }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: webInfo?.lan ?? false }"
                  role="switch"
                  :aria-checked="webInfo?.lan ?? false"
                  :aria-label="i18n.t('settings.web.lan')"
                  @click="setWebLan(!(webInfo?.lan ?? false))"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.web.open") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.web.openHint") }}</span>
                </div>
                <button class="scan-btn primary" @click="openWebAccess">
                  {{ i18n.t("settings.web.openButton") }}
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- 存储：数据目录（模型 / 运行时 / OFX 插件 / 工程历史） -->
        <template v-else-if="active === 'storage'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.storage.location") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.current") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.storage.currentHint") }}</span>
                  <span class="row-sub mono">{{ dataDir?.current ?? i18n.t("common.loading") }}</span>
                </div>
                <span class="row-value">{{ dataDirSize }}</span>
              </div>
              <div v-if="dataDir?.on_system_drive && !dataDirNext" class="col-row">
                <span class="row-sub warn">
                  {{ i18n.t("settings.storage.systemDrive", { size: dataDirSize }) }}
                </span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.source.label") }}</span>
                  <span class="row-sub">{{ dataDirSource }}</span>
                </div>
              </div>
              <div v-if="dataDir && dataDir.default !== dataDir.current" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.default") }}</span>
                  <span class="row-sub mono">{{ dataDir.default }}</span>
                </div>
              </div>
              <div v-if="dataDir" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.cache") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.storage.cacheHint") }}</span>
                  <span class="row-sub mono">{{ dataDir.cache }}</span>
                </div>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.move") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.storage.moveHint") }}</span>
                </div>
                <button
                  class="scan-btn"
                  :disabled="
                    dataDirBusy ||
                    dataDirLoading ||
                    dataDir?.portable === true ||
                    dataDirNext !== ''
                  "
                  @click="chooseDataDir"
                >
                  {{ i18n.t("settings.storage.choose") }}
                </button>
              </div>
              <div v-if="dataDir?.portable" class="col-row">
                <span class="row-sub warn">{{ i18n.t("settings.storage.portable") }}</span>
              </div>
              <div v-if="dataDirBusy" class="col-row">
                <div
                  class="update-progress"
                  role="progressbar"
                  :aria-valuenow="dataDirPercent"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div class="update-progress-fill" :style="{ width: `${dataDirPercent}%` }" />
                </div>
                <span class="row-sub">{{ dataDirProgressText }}</span>
              </div>
              <div v-if="dataDirError" class="col-row">
                <span class="row-sub warn">{{ dataDirError }}</span>
              </div>
            </div>
          </div>

          <!-- 迁移完成：重启前当前进程仍写旧目录，必须显眼地提醒。 -->
          <div v-if="dataDirNext" class="group">
            <div class="group-title">{{ i18n.t("settings.storage.migratedTitle") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">
                    {{ i18n.t("settings.storage.migrated", { path: dataDirNext }) }}
                  </span>
                  <span class="row-sub">{{ i18n.t("settings.storage.migratedHint") }}</span>
                </div>
                <button class="scan-btn primary" @click="restartApp">
                  {{ i18n.t("settings.storage.restartNow") }}
                </button>
              </div>
            </div>
          </div>

          <!-- 旧目录清理：重启后才有意义；指针与发现文件留在默认目录，不受影响。 -->
          <div
            v-if="dataDirPrevious.length > 0 && !dataDir?.restart_required"
            class="group"
          >
            <div class="group-title">{{ i18n.t("settings.storage.previousTitle") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.storage.previous") }}</span>
                  <span
                    v-for="path in dataDirPrevious"
                    :key="path"
                    class="row-sub mono"
                  >{{ path }}</span>
                  <span class="row-sub">{{ i18n.t("settings.storage.previousHint") }}</span>
                </div>
                <button
                  class="scan-btn"
                  :disabled="dataDirBusy"
                  @click="cleanupPreviousDataDir"
                >
                  {{ i18n.t("settings.storage.cleanup") }}
                </button>
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
                <SegmentedControl
                  :model-value="themeMode"
                  :options="themeSegOptions"
                  :aria-label="i18n.t('settings.theme.label')"
                  @update:model-value="onTheme($event as ThemeMode)"
                />
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
                  <span class="row-sub">{{ Math.round(layout.timelineHeight) }} px</span>
                </div>
                <Md3Slider
                  v-model="layout.timelineHeight"
                  class="row-slider"
                  :min="MIN_TIMELINE_HEIGHT"
                  :max="MAX_TIMELINE_HEIGHT"
                  :step="10"
                  :label="i18n.t('settings.width.tracks')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.width.inspector") }}</span>
                  <span class="row-sub">{{ Math.round(layout.panelWidth) }} px</span>
                </div>
                <Md3Slider
                  v-model="layout.panelWidth"
                  class="row-slider"
                  :min="MIN_PANEL_WIDTH"
                  :max="MAX_PANEL_WIDTH"
                  :step="10"
                  :label="i18n.t('settings.width.inspector')"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- AI / MCP -->
        <template v-else-if="active === 'ai'">
          <!-- OpenAI 兼容端点：右侧「剪辑智能体」面板直连它 -->
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.ai.title") }}</div>
            <div class="card">
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.ai.baseUrl") }}</span>
                <span class="row-sub">{{ i18n.t("settings.ai.baseUrlHint") }}</span>
                <input
                  v-model="agentBaseUrl"
                  class="net-input"
                  type="text"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.ai.baseUrlPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.ai.apiKey") }}</span>
                <span class="row-sub">{{ i18n.t("settings.ai.apiKeyHint") }}</span>
                <input
                  v-model="agentApiKey"
                  class="net-input"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.ai.apiKeyPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.ai.model") }}</span>
                <span class="row-sub">{{ i18n.t("settings.ai.modelHint") }}</span>
                <ComboField
                  v-model="agentModel"
                  :options="agentModelList"
                  :label="i18n.t('settings.ai.model')"
                  :placeholder="i18n.t('settings.ai.modelPlaceholder')"
                  :empty="i18n.t('settings.ai.modelEmpty')"
                />
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

          <!-- 本地 AI 执行后端 -->
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.ai.ortGroup") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.ai.backend") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.ai.backendHint") }}</span>
                </div>
                <SegmentedControl
                  :model-value="backendInfo?.preference ?? ''"
                  :options="backendSegOptions"
                  :aria-label="i18n.t('settings.ai.backend')"
                  @update:model-value="onBackendPick"
                />
              </div>
              <div class="col-row">
                <span v-if="backendNote" class="row-sub">{{ backendNote }}</span>
                <span class="row-sub">
                  {{ i18n.t("settings.ai.platform", { platform: backendInfo?.platform ?? "…" }) }}
                </span>
              </div>
              <div v-if="backendWarning" class="col-row">
                <span class="row-sub warn">{{ backendWarning }}</span>
              </div>
            </div>

            <!-- 运行库：与 ai-daw 一样单独一张卡片；装 / 删之后提示重启 -->
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.ai.runtimes") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.ai.runtimesHint") }}</span>
                </div>
                <div class="row-actions">
                  <span v-if="backendInfo?.restart_required" class="row-sub restart-hint">
                    {{ i18n.t("settings.ai.restartRequired") }}
                  </span>
                  <button class="scan-btn" @click="openRuntimeManager">
                    {{ i18n.t("settings.ai.runtimeOpen") }}
                  </button>
                </div>
              </div>

              <!--
                运行库状态直接摊在这里：以前只有一句「打开下载管理器」，
                用户既不知道装了什么、也不知道还差几 GB，跳过去还停在「已安装」页签。
              -->
              <div
                v-for="runtime in optionalRuntimes"
                :key="runtime.id"
                class="runtime-row"
              >
                <div class="row-text">
                  <span class="row-title">
                    {{ i18n.t(runtime.label) }}
                    <span v-if="isActiveRuntime(runtime.id)" class="row-pill">
                      {{ i18n.t("settings.ai.runtimeActive") }}
                    </span>
                  </span>
                  <span class="row-sub">
                    {{ humanSize(runtime.bytes) }} ·
                    {{
                      runtime.installed
                        ? i18n.t("runtime.installed")
                        : i18n.t("runtime.notInstalled")
                    }}
                  </span>
                  <div v-if="runtimeInstallId === runtime.id" class="runtime-progress">
                    <div
                      class="runtime-progress-fill"
                      :class="{ indeterminate: runtimes.progressPct === null }"
                      :style="
                        runtimes.progressPct === null
                          ? undefined
                          : { width: `${runtimes.progressPct}%` }
                      "
                    />
                  </div>
                </div>
                <div class="row-actions">
                  <button
                    v-if="runtimeInstallId === runtime.id"
                    class="scan-btn"
                    @click="runtimes.cancel()"
                  >
                    {{ i18n.t("models.cancel") }}
                  </button>
                  <button
                    v-else-if="!runtime.installed"
                    class="scan-btn"
                    :disabled="runtimes.busyId !== null"
                    @click="installRuntimeHere(runtime.id)"
                  >
                    {{ i18n.t("models.download", { size: humanSize(runtime.bytes) }) }}
                  </button>
                  <button
                    v-else
                    class="scan-btn"
                    :disabled="runtimes.busyId !== null"
                    @click="runtimes.reveal(runtime.id)"
                  >
                    {{ i18n.t("models.reveal") }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- sd.cpp 视频后端：与上面的 ONNX Runtime 完全分开 -->
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.ai.sdcppGroup") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("aiVideo.backend") }}</span>
                  <span class="row-sub">{{ sdcppNote }}</span>
                </div>
                <SegmentedControl
                  :model-value="sdcppActiveKind"
                  :options="sdcppSegOptions"
                  :aria-label="i18n.t('aiVideo.backend')"
                  @update:model-value="setSdcppBackend"
                />
              </div>
              <div class="col-row">
                <span v-if="sdcpp.info" class="row-sub">
                  {{ i18n.t("settings.ai.platform", { platform: sdcpp.info.platform }) }}
                </span>
                <span class="row-sub">{{ i18n.t("settings.ai.sdcppHint") }}</span>
              </div>
            </div>

            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("aiVideo.engine") }}</span>
                  <span class="row-sub">
                    {{
                      sdcpp.ready
                        ? i18n.t("aiVideo.engineReady")
                        : i18n.t("settings.ai.sdcppMissing")
                    }}
                  </span>
                </div>
                <div class="row-actions">
                  <button class="scan-btn" @click="openSdcppManager">
                    {{ i18n.t("settings.ai.sdcppOpen") }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- MCP 服务器 -->
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
                  <span class="row-sub">{{ mcpEndpoint || i18n.t("settings.mcp.notListening") }}</span>
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
              <div v-if="mcpFallbackNote" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.portConflict") }}</span>
                  <span class="row-sub warn">{{ mcpFallbackNote }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- MCP 接入地址 -->
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.mcp.usage") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.endpoint") }}</span>
                  <span class="row-sub mono">
                    {{ mcpEndpoint || i18n.t("settings.mcp.notListening") }}
                  </span>
                </div>
                <button class="scan-btn" :disabled="!mcpEndpoint" @click="copy(mcpEndpoint)">
                  {{ i18n.t("settings.mcp.copy") }}
                </button>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.mcp.security") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.mcp.securityHint") }}</span>
                </div>
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

        <!-- 图像 / 视频生成 -->
        <template v-else-if="active === 'gen'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.gen.providers") }}</div>
            <div class="card">
              <p class="probe">{{ i18n.t("settings.gen.lead") }}</p>
              <p v-if="genLoading" class="probe">{{ i18n.t("common.loading") }}</p>
              <p v-else-if="genLoadError" class="probe error">{{ genLoadError }}</p>
              <p v-else-if="genProviders.length === 0" class="probe">
                {{ i18n.t("settings.gen.empty") }}
              </p>
              <div
                v-for="provider in genProviders"
                :key="provider.id"
                class="row provider-row"
                :class="{ on: editingGenId === provider.id }"
                @click="editGenProvider(provider)"
              >
                <div class="row-text">
                  <span class="row-title">{{ provider.name }}</span>
                  <span class="row-sub">
                    {{ i18n.t(`settings.gen.kind.${provider.kind}`) }} ·
                    {{ genSummary(provider) }}
                  </span>
                </div>
                <span class="row-value" :class="{ 'status-on': provider.enabled }">
                  {{
                    i18n.t(
                      provider.enabled
                        ? "settings.gen.enabledOn"
                        : "settings.gen.enabledOff",
                    )
                  }}
                </span>
                <button
                  class="scan-btn"
                  :disabled="genSaving"
                  @click.stop="deleteGenProvider(provider)"
                >
                  {{ i18n.t("settings.gen.delete") }}
                </button>
              </div>
              <div class="row actions-row">
                <button class="scan-btn primary" @click="newGenProvider">
                  {{ i18n.t("settings.gen.add") }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="genDraft" class="group">
            <div class="group-title">
              {{ i18n.t(editingGenId ? "settings.gen.edit" : "settings.gen.new") }}
            </div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.name") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.nameHint") }}</span>
                </div>
                <input v-model="genDraft.name" class="md3-field net-input" spellcheck="false" />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.kind") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.kindHint") }}</span>
                </div>
                <Md3Select
                  v-model="genDraft.kind"
                  :options="genKindOptions"
                  :label="i18n.t('settings.gen.kind')"
                />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.enabled") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.enabledHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: genDraft.enabled }"
                  role="switch"
                  :aria-checked="genDraft.enabled"
                  :aria-label="i18n.t('settings.gen.enabled')"
                  @click="genDraft.enabled = !genDraft.enabled"
                />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.cap.t2i") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.cap.t2iHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: genHasCapability('t2i') }"
                  role="switch"
                  :aria-checked="genHasCapability('t2i')"
                  :aria-label="i18n.t('settings.gen.cap.t2i')"
                  @click="toggleGenCapability('t2i')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.cap.i2i") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.cap.i2iHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: genHasCapability('i2i') }"
                  role="switch"
                  :aria-checked="genHasCapability('i2i')"
                  :aria-label="i18n.t('settings.gen.cap.i2i')"
                  @click="toggleGenCapability('i2i')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.cap.video") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.cap.videoHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: genHasCapability('video') }"
                  role="switch"
                  :aria-checked="genHasCapability('video')"
                  :aria-label="i18n.t('settings.gen.cap.video')"
                  @click="toggleGenCapability('video')"
                />
              </div>

              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.baseUrl") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.baseUrlHint") }}</span>
                </div>
                <input
                  v-model="genDraft.base_url"
                  class="md3-field net-input"
                  spellcheck="false"
                  :placeholder="genPreset(genDraft.kind)?.baseUrl"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.apiKey") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.apiKeyHint") }}</span>
                </div>
                <input
                  v-model="genDraft.api_key"
                  class="md3-field net-input"
                  type="password"
                  spellcheck="false"
                  placeholder="sk-…"
                />
              </div>
              <div v-if="genDraft.kind === 'kling'" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.apiSecret") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.apiSecretHint") }}</span>
                </div>
                <input
                  v-model="genDraft.api_secret"
                  class="md3-field net-input"
                  type="password"
                  spellcheck="false"
                />
              </div>
              <div v-if="genDraft.kind === 'minimax'" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.groupId") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.groupIdHint") }}</span>
                </div>
                <input v-model="genDraft.group_id" class="md3-field net-input" spellcheck="false" />
              </div>

              <div v-if="genHasCapability('t2i')" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.imageModel") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.imageModelHint") }}</span>
                </div>
                <input
                  v-model="genDraft.image_model"
                  class="md3-field net-input"
                  spellcheck="false"
                  :placeholder="genPreset(genDraft.kind)?.imageModel"
                />
              </div>
              <div v-if="genHasCapability('i2i')" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.editModel") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.editModelHint") }}</span>
                </div>
                <input
                  v-model="genDraft.edit_model"
                  class="md3-field net-input"
                  spellcheck="false"
                  :placeholder="genPreset(genDraft.kind)?.editModel"
                />
              </div>
              <div v-if="genHasCapability('video')" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.gen.videoModel") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.gen.videoModelHint") }}</span>
                </div>
                <input
                  v-model="genDraft.video_model"
                  class="md3-field net-input"
                  spellcheck="false"
                  :placeholder="genPreset(genDraft.kind)?.videoModel"
                />
              </div>

              <div class="row actions-row">
                <button
                  class="scan-btn danger"
                  :disabled="genSaving || genTesting"
                  @click="discardGenDraft"
                >
                  {{ i18n.t(editingGenId ? "common.cancel" : "common.delete") }}
                </button>
                <button
                  v-if="genHasCapability('t2i')"
                  class="scan-btn"
                  :disabled="genTesting"
                  @click="testGenProvider"
                >
                  {{
                    genTesting ? i18n.t("settings.gen.testing") : i18n.t("settings.gen.test")
                  }}
                </button>
                <button class="scan-btn primary" :disabled="genSaving" @click="saveGenProvider">
                  {{
                    genSaving ? i18n.t("settings.gen.saving") : i18n.t("settings.gen.save")
                  }}
                </button>
              </div>
              <p v-if="genTesting" class="probe">{{ i18n.t("settings.gen.testHint") }}</p>
              <p v-if="genTestError" class="probe error">{{ genTestError }}</p>
              <div v-if="genTestResult" class="gen-preview">
                <img :src="fileUrl(genTestResult.path)" alt="" />
                <span class="probe ok">
                  {{
                    i18n.t("settings.gen.testOk", {
                      width: genTestResult.width,
                      height: genTestResult.height,
                    })
                  }}
                </span>
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
                  class="scan-btn danger"
                  :disabled="ttsSaving || ttsTesting"
                  @click="discardTtsDraft"
                >
                  {{ i18n.t(editingTtsId ? "common.cancel" : "common.delete") }}
                </button>
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
                  <span class="row-sub">{{ i18n.t("settings.proxy.modeHint") }}</span>
                </div>
                <SegmentedControl
                  :model-value="proxyMode"
                  :options="proxySegOptions"
                  :aria-label="i18n.t('settings.proxy.mode')"
                  @update:model-value="proxyMode = $event as ProxyMode"
                />
              </div>
              <div v-if="proxyMode === 'manual'" class="col-row">
                <span class="row-title">{{ i18n.t("settings.proxy.url") }}</span>
                <span class="row-sub">{{ i18n.t("settings.proxy.urlHint") }}</span>
                <input
                  v-model="proxyUrl"
                  class="net-input"
                  type="text"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.proxy.urlPlaceholder')"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.proxy.current") }}</span>
                  <span class="row-sub">{{ proxySourceLabel }}</span>
                </div>
                <button class="scan-btn" :disabled="proxyTesting" @click="testProxy">
                  {{
                    proxyTesting
                      ? i18n.t("settings.proxy.testing")
                      : i18n.t("settings.proxy.test")
                  }}
                </button>
              </div>
              <div v-if="proxyProbe" class="col-row">
                <span
                  class="row-sub"
                  :class="{ 'probe-ok': proxyProbe.ok, 'probe-error': !proxyProbe.ok }"
                >
                  {{
                    i18n.t(
                      proxyProbe.ok ? "settings.proxy.probeOk" : "settings.proxy.probeFail",
                      { detail: proxyProbe.detail },
                    )
                  }}
                </span>
              </div>
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
                <SegmentedControl
                  :model-value="modelSourcePref"
                  :options="sourceSegOptions"
                  :aria-label="i18n.t('settings.store.source')"
                  @update:model-value="modelSourcePref = $event as ModelSourcePreference"
                />
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.store.hfToken") }}</span>
                <span class="row-sub">
                  {{ i18n.t("settings.store.hfTokenHint") }}
                  <template v-if="hfTokenHint">
                    （{{ i18n.t("settings.store.hfTokenSet", { hint: hfTokenHint }) }}）
                  </template>
                </span>
                <div class="token-row">
                  <input
                    v-model="hfTokenInput"
                    class="net-input"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="i18n.t('settings.store.hfTokenPlaceholder')"
                  />
                  <button
                    class="scan-btn"
                    :disabled="hfTokenSaving || !hfTokenInput.trim()"
                    @click="saveHfToken(hfTokenInput)"
                  >
                    {{ i18n.t("settings.store.hfTokenSave") }}
                  </button>
                  <button
                    v-if="hfTokenHint"
                    class="scan-btn"
                    :disabled="hfTokenSaving"
                    @click="saveHfToken('')"
                  >
                    {{ i18n.t("settings.store.hfTokenClear") }}
                  </button>
                </div>
                <span v-if="hfTokenError" class="row-sub token-error">{{ hfTokenError }}</span>
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.store.models") }}</span>
                <span class="row-sub">{{ i18n.t("settings.store.modelsHint") }}</span>
                <textarea
                  v-model="modelMirrors"
                  class="net-input"
                  rows="2"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.store.modelsPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.store.prefix") }}</span>
                <span class="row-sub">{{ i18n.t("settings.store.prefixHint") }}</span>
                <input
                  v-model="modelDownloadPrefix"
                  class="net-input"
                  type="text"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.store.prefixPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-sub">{{ i18n.t("settings.store.saveHint") }}</span>
              </div>
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

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.plugins.group") }}</div>
            <div class="card">
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.plugins.url") }}</span>
                <span class="row-sub">{{ i18n.t("settings.plugins.urlHint") }}</span>
                <input
                  v-model="pluginRegistryUrl"
                  class="net-input"
                  type="text"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.plugins.urlPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-title">{{ i18n.t("settings.plugins.mirrors") }}</span>
                <span class="row-sub">{{ i18n.t("settings.plugins.mirrorsHint") }}</span>
                <textarea
                  v-model="pluginRegistryMirrors"
                  class="net-input"
                  rows="2"
                  spellcheck="false"
                  :placeholder="i18n.t('settings.plugins.mirrorsPlaceholder')"
                />
              </div>
              <div class="col-row">
                <span class="row-sub">{{ i18n.t("settings.plugins.saveHint") }}</span>
              </div>
              <div class="row actions-row">
                <button class="scan-btn" :disabled="pluginSaving" @click="resetPluginRegistry">
                  {{ i18n.t("settings.plugins.reset") }}
                </button>
                <button class="scan-btn primary" :disabled="pluginSaving" @click="savePluginRegistry">
                  {{
                    pluginSaving
                      ? i18n.t("settings.plugins.saving")
                      : pluginSaved
                        ? i18n.t("settings.plugins.saved")
                        : i18n.t("settings.plugins.save")
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
                  <span class="row-sub">{{ cliMessage }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: cliOn }"
                  role="switch"
                  :aria-checked="cliOn"
                  :aria-label="i18n.t('settings.cli.mount')"
                  :disabled="cliBusy"
                  @click="onToggleCli"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.status") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.cli.mountHint") }}</span>
                </div>
                <span class="row-value">{{ cliBusy ? i18n.t("settings.cli.busy") : cliStateLabel }}</span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.command") }}</span>
                  <span class="row-sub mono">{{ cliLocation }}</span>
                </div>
              </div>
              <div v-if="cli?.full_path && !cliOn" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.fullPath") }}</span>
                  <span class="row-sub mono">{{ cli.full_path }}</span>
                </div>
                <button class="scan-btn" @click="copy(cli.full_path)">
                  {{ i18n.t("settings.cli.copy") }}
                </button>
              </div>
              <div v-if="cli?.manual_command" class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.cli.manual") }}</span>
                  <span class="row-sub mono">{{ cli.manual_command }}</span>
                </div>
                <button class="scan-btn" @click="copy(cli.manual_command)">
                  {{ i18n.t("settings.cli.copy") }}
                </button>
              </div>
            </div>
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
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.about.license") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.about.licenseLabel") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.about.licenseHint") }}</span>
                </div>
                <span class="row-value">Apache-2.0</span>
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
  background-color: var(--app-card);
  background-image: var(--app-wash);
}

/* ---- 设置侧栏 ---- */
.settings-nav {
  width: 220px;
  scrollbar-gutter: stable;
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
  scrollbar-gutter: stable;
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
  border: 1px solid rgb(var(--md-outline-variant) / 0.22);
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
  flex: 1 1 0;
  min-width: 0;
}
/* 竖向排布的设置行（网络 / AI 端点这种：标题在上、控件占满一整行）。 */
/* HF token：输入框 + 保存 / 清除并排；窄窗口下输入框先缩。 */
.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.token-row .net-input {
  flex: 1 1 auto;
  min-width: 0;
}
.token-error {
  color: rgb(var(--md-error));
}
.col-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.col-row + .col-row,
.col-row + .row,
.row + .col-row {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
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
.row-sub.warn {
  color: rgb(var(--md-error));
}
/* 「重启后生效」提示：只在切过运行库时出现，跟按钮同一行。 */
.restart-hint {
  color: rgb(var(--md-primary));
  white-space: nowrap;
}
.row-sub.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
}
/* 运行库：卡片里逐行列出 CUDA 12 / 13 的状态与下载按钮。 */
.runtime-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.row-pill {
  display: inline-flex;
  align-items: center;
  height: 17px;
  margin-left: 6px;
  padding: 0 7px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
  font-size: 10px;
  font-weight: 500;
  vertical-align: 1px;
}
.runtime-progress {
  height: 3px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.runtime-progress-fill {
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.runtime-progress-fill.indeterminate {
  width: 35%;
  animation: settings-progress 1.2s ease-in-out infinite;
}
@keyframes settings-progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.probe-ok {
  color: rgb(var(--md-primary));
}
.probe-error {
  color: rgb(var(--md-error));
}
.row-slider {
  width: 200px;
  flex: 0 0 auto;
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
/* 竖排行里的输入框占满整行，与 ai-daw 的设置页一致。 */
.col-row .net-input {
  width: 100%;
  max-width: none;
  flex: 1 1 auto;
  padding: 8px 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 10px;
  background-color: var(--app-card);
  color: rgb(var(--md-on-surface));
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
.col-row .net-input:focus {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 0;
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
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.gen-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.gen-preview img {
  width: 160px;
  height: 160px;
  object-fit: cover;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-highest));
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
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.scan-btn {
  height: 32px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 12px;
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
.scan-btn.danger {
  border-color: rgb(var(--md-error) / 0.45);
  color: rgb(var(--md-error));
}
.scan-btn.danger:hover:not(:disabled) {
  background-color: rgb(var(--md-error) / 0.08);
}
/* 「删除 / 取消」放最左边，和右边的测试 / 保拉开距离，避免误点。 */
.actions-row .scan-btn.danger {
  margin-right: auto;
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

/* ---- 主题色 swatches ---- */
.swatches {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.swatch {
  position: relative;
  width: 36px;
  height: 36px;
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
  .row .net-input,
  .row .row-combo,
  .row .output-controls {
    width: 100%;
    max-width: none;
  }
  .row-slider {
    width: 100%;
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
