/**
 * **「缺什么就弹框，确认后跳转并真的开始下载」** —— 所有 AI 功能共用一套。
 *
 * 以前每个入口各写一遍「确认 → `layout.openTab("models")`」，结果是跳过去之后
 * **什么都不下**，用户还要自己在管理器里找卡片再点一次；更糟的是下载管理器默认停在
 * 「已安装」页签，未装的条目根本不显示，看起来就是「点了没反应」。
 *
 * 这里的职责：
 * 1. 算出「还差什么」（`core/aiDeps`）；
 * 2. 弹 `AiSetupDialog` 让用户看一眼体积和推荐后端；
 * 3. 确认后跳管理器 → 定位到第一项 → **按类型并行下载**（`stores/downloads`）；
 * 4. 装完自动切后端；CUDA 那套需要重启时问一句（开发版会明确说「无法重启」）；
 * 5. 完成后回到触发它的那个面板，并提示一句。
 */
import { ref } from "vue";
import { useI18n } from "@/i18n";
import { useDeviceStore } from "@/stores/device";
import { useDownloadsStore, type DownloadTask } from "@/stores/downloads";
import { useLayoutStore, type PaneId } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useSdcppStore } from "@/stores/sdcpp";
import { aiSetBackend } from "@/core/agentApi";
import { appRestart } from "@/core/runtimeApi";
import { diskFreeBytes } from "@/core/diskApi";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { humanSize } from "@/utils/size";
import { hasSeen, markSeen, forgetSeen } from "@/core/setupMemory";
import { engineDep, modelDep, runtimeDeps, totalBytes } from "@/core/aiDeps";
import { sectionOf, type SetupBackend, type SetupDep, type SetupPlan } from "@/types/setup";
import type { BackendPreference } from "@/types/agent";
import type { ModelStatus } from "@/types/models";

/** 后端那句「为什么推荐它」的依据文案。 */
function reasonFor(
  i18n: ReturnType<typeof useI18n>,
  device: { vendor: string; name: string },
  kind: string,
): string {
  if (device.vendor === "nvidia") {
    return i18n.t("setup.reason.nvidia", { name: device.name || "NVIDIA" });
  }
  if (device.vendor === "amd" || device.vendor === "intel") {
    return i18n.t("setup.reason.vulkan");
  }
  if (device.vendor === "apple") return i18n.t("setup.reason.apple");
  if (kind === "cpu") return i18n.t("setup.reason.cpu");
  return i18n.t("setup.reason.generic");
}

interface SessionOptions {
  /** 记忆键（`image` / `video` / `runtime`）。 */
  feature: string;
  /** 组计划；返回 `null` 表示「没有可准备的东西」。 */
  build: () => SetupPlan | null;
  /** 下载完成之后把后端切过去（返回是否需要重启）。 */
  applyBackend: () => Promise<boolean>;
  /** 全部成功后的收尾（回到原页面 / 打开子页）。 */
  done?: () => void;
}

function useSetupSession(options: SessionOptions) {
  const i18n = useI18n();
  const layout = useLayoutStore();
  const downloads = useDownloadsStore();

  const open = ref(false);
  const plan = ref<SetupPlan | null>(null);
  const running = ref(false);
  /** 首次引导：不给「稍后」，只能去下载或离开这一页。 */
  const forced = ref(false);
  /** 上一次失败的任务（「重试剩余」用）。 */
  const failed = ref<DownloadTask[]>([]);
  /** 弹框是从哪个面板弹出来的（装完回哪儿）。 */
  let origin: PaneId = layout.activeTab;
  /** 本次「准备」成功后要执行的额外动作（例如直接打开刚准备好的子页）。 */
  let onDone: (() => void) | null = null;

  /** 登记「装好之后做什么」；取消时自动丢弃。 */
  function setDone(fn: (() => void) | null): void {
    onDone = fn;
  }

  /** 缺依赖就弹框；返回是否**已经就绪**（调用方据此决定要不要继续跑）。 */
  function ensure(): boolean {
    const next = options.build();
    plan.value = next;
    if (!next || next.deps.length === 0) {
      open.value = false;
      return true;
    }
    origin = layout.activeTab;
    forced.value = false;
    open.value = true;
    return false;
  }

  /** 首次进入某个功能时自动弹一次（同一「功能 + 推荐后端」只弹一次）。 */
  function maybePrompt(): void {
    const next = options.build();
    if (!next || next.deps.length === 0) return;
    const key = next.backend?.kind ?? "model";
    if (hasSeen(options.feature, key)) return;
    plan.value = next;
    origin = layout.activeTab;
    // 首次引导不给「稍后」：功能一个字节都没装，留着也只是对着点不动的按钮。
    forced.value = true;
    open.value = true;
  }

  function cancel(): void {
    const next = plan.value;
    open.value = false;
    // 取消后别再记着「装好要打开子页」：那是上一次的意图。
    onDone = null;
    // 用户看过并关了：之后不再自动糊上来（主动点按钮时仍会弹）。
    if (next) markSeen(options.feature, next.backend?.kind ?? "model");
  }

  /**
   * 磁盘预检：还差的空间不够就提示并返回 `false`。
   *
   * 读不到剩余空间（权限 / 非 Windows 的兜底失败）就当「不知道」，不拦。
   */
  async function hasDiskRoom(tasks: DownloadTask[]): Promise<boolean> {
    const needed = tasks.reduce((sum, task) => sum + (task.bytes ?? 0), 0);
    if (needed <= 0) return true;
    const free = await diskFreeBytes();
    if (free === null) return true;
    if (free >= Math.round(needed * 1.2)) return true;
    toast(i18n.t("setup.diskLow", { size: humanSize(needed) }), "error");
    return false;
  }

  /** 跳管理器 + 按类型并行下载（同一类型内串行）+ 切后端 + 回原页面。 */
  async function run(tasks: DownloadTask[], jump = true, checkDisk = true): Promise<boolean> {
    if (tasks.length === 0) return true;

    // 磁盘预检：装到一半满盘会留下半个目录，比直接说「还差 4 GB」难受得多。
    if (checkDisk && !(await hasDiskRoom(tasks))) return false;

    origin = layout.activeTab;
    if (jump) {
      layout.openDownloads("models");
      const first = tasks[0];
      if (first) downloads.requestFocus(first.section, first.id);
    }

    running.value = true;
    let ok = false;
    try {
      ok = await downloads.run(tasks);
    } finally {
      running.value = false;
    }

    if (!ok) {
      // 只重试「没装成」的那些：并行时别的车道可能已经装好了。
      failed.value = downloads.failedTasks.length > 0 ? [...downloads.failedTasks] : tasks;
      const failure = downloads.failure;
      toast(
        i18n.t("setup.failed", {
          name: failure?.task.label ?? "",
          error: failure?.message ?? "",
        }),
        "error",
      );
      return false;
    }

    failed.value = [];
    let restart = false;
    try {
      restart = await options.applyBackend();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }

    // 装好了：这个功能的「已引导」记录作废（下次换机器才会重新提示）。
    forgetSeen(options.feature);

    // 还停在下载管理器才把用户带回去：中途自己切走了就别抢。
    if (layout.activeTab === "models") layout.openTab(origin);
    options.done?.();
    const after = onDone;
    onDone = null;
    after?.();

    if (restart) await askRestart(plan.value?.backend?.label ?? "");
    else toast(i18n.t("setup.done"));
    return true;
  }

  /** 重启提示：CUDA 那套要重启才会被加载；开发版会明确拒绝，别让用户白等。 */
  async function askRestart(backend: string): Promise<void> {
    const accepted = await confirm({
      title: i18n.t("setup.restartTitle", { backend }),
      message: i18n.t("setup.restartBody"),
      confirmText: i18n.t("settings.ai.restartNow"),
      cancelText: i18n.t("setup.restartLater"),
    });
    if (!accepted) return;
    try {
      await appRestart();
    } catch (error) {
      // 开发模式下 `app_restart` 会拒绝：把原因说清楚，别让人以为按钮坏了。
      toast(error instanceof Error ? error.message : String(error));
    }
  }

  /** 用户点「下载并安装」：跳管理器并开始下载。 */
  async function confirmRun(jump = true): Promise<void> {
    const current = plan.value;
    if (!current) {
      open.value = false;
      return;
    }
    const tasks: DownloadTask[] = current.deps.map((dep) => ({
      section: sectionOf(dep),
      id: dep.id,
      label: dep.label,
      bytes: dep.bytes,
    }));
    // 空间不够就**别关弹窗**：用户还站在原地，看得到「还差多少」再决定要不要清理。
    if (!(await hasDiskRoom(tasks))) return;
    open.value = false;
    await run(tasks, jump, false);
  }

  /** 失败后「重试剩余」。 */
  async function retry(): Promise<void> {
    const tasks = failed.value;
    if (tasks.length === 0) return;
    failed.value = [];
    await run(tasks);
  }

  /** 取消当前下载（对话框里的「取消」）。 */
  async function cancelDownload(): Promise<void> {
    await downloads.cancel();
  }

  return {
    open,
    plan,
    running,
    forced,
    failed,
    /** 当前这一项的进度（页内 / 对话框里的进度条）。 */
    progress: downloads.progress,
    ensure,
    maybePrompt,
    cancel,
    confirmRun,
    retry,
    run,
    cancelDownload,
    setDone,
  };
}

/**
 * **画图 / 视频**：sd.cpp 引擎 + 当前选中的模型。
 *
 * 两种入口共用同一套计划：
 * - 点「生成 / 打开」时缺什么补什么（引擎 + 模型）；
 * - 只切后端时只算引擎那一项（`prepareEngine`），别顺手把 6 GB 的权重也塞进弹窗。
 *
 * 引擎没有「重启」概念（每次生成都起一个新进程），所以只需要装完切后端。
 */
export function useEngineSetup(
  feature: "image" | "image-edit" | "video",
  model: () => ModelStatus | null,
) {
  const i18n = useI18n();
  const sdcpp = useSdcppStore();
  const device = useDeviceStore();
  /** 用户在这个功能上选定的引擎（弹窗里所谓「目标后端」）。 */
  const chosen = ref<string | null>(null);
  /** 计划范围：`all` = 引擎 + 模型；`engine` = 只算引擎。 */
  const scope = ref<"all" | "engine">("all");

  function defaultKind(): string {
    const info = sdcpp.info;
    if (!info) return "cpu";
    const current = info.options.find((option) => option.kind === info.preference);
    if (current?.usable && current.installed) return current.kind;
    return info.recommended;
  }

  function build(override?: string): SetupPlan | null {
    const info = sdcpp.info;
    if (!info) return null;
    const kind = override ?? chosen.value ?? defaultKind();
    const option = info.options.find((item) => item.kind === kind) ?? null;
    if (!option) return null;
    // 本机跑不起来的后端（AMD 上看 CUDA）不弹下载：装完也用不上。
    if (!option.usable) return null;

    const deps: SetupDep[] = [];
    if (!option.installed) deps.push(engineDep(option, i18n.t(option.label)));
    if (scope.value === "all") {
      const selected = model();
      if (selected && !selected.installed) deps.push(modelDep(selected));
    }
    if (deps.length === 0) return null;

    const backend: SetupBackend = {
      kind: option.kind,
      label: i18n.t(option.label),
      reason: reasonFor(i18n, device.device, option.kind),
      recommended: option.recommended,
      choices: info.options
        .filter((item) => item.usable)
        .map((item) => ({ kind: item.kind, label: i18n.t(item.label) })),
    };

    const titleKey =
      feature === "video"
        ? "setup.title.video"
        : feature === "image-edit"
          ? "setup.title.image-edit"
          : "setup.title.image";
    return {
      title: i18n.t(titleKey),
      lead: i18n.t("setup.lead", { backend: backend.label, reason: backend.reason }),
      deps,
      totalBytes: totalBytes(deps),
      backend,
      // sd.cpp 引擎是独立进程，装完直接可用。
      restartAfter: false,
    };
  }

  const session = useSetupSession({
    feature,
    build: () => build(),
    applyBackend: async () => {
      const kind = chosen.value;
      if (!kind) return false;
      await sdcpp.setBackend(kind);
      await sdcpp.load();
      await sdcpp.loadInfo();
      return false;
    },
  });

  /** 弹窗里选后端：记住选择并重算。 */
  function choose(kind: string): void {
    chosen.value = kind;
    const next = build(kind);
    session.plan.value = next;
    session.open.value = next !== null;
  }

  /** 缺引擎 / 缺模型就弹框；`true` = 已经能跑。 */
  function ensure(): boolean {
    scope.value = "all";
    const ready = session.ensure();
    if (!ready) chosen.value = session.plan.value?.backend?.kind ?? chosen.value;
    return ready;
  }

  /** 首次进入自动弹。 */
  function maybePrompt(): void {
    scope.value = "all";
    session.maybePrompt();
    if (session.open.value) chosen.value = session.plan.value?.backend?.kind ?? chosen.value;
  }

  /**
   * 切换后端：装好了就直接切，没装就弹窗只引导这一份额外的引擎。
   *
   * 这里**不**把缺的模型一起塞进来 —— 用户点的是后端按钮，不是「生成」。
   */
  async function prepareEngine(kind: string): Promise<void> {
    const option = sdcpp.info?.options.find((item) => item.kind === kind);
    if (!option) return;
    if (!option.usable) {
      toast(i18n.t("setup.unsupported", { name: i18n.t(option.label) }), "error");
      return;
    }
    if (!option.installed) {
      scope.value = "engine";
      chosen.value = kind;
      session.ensure();
      return;
    }
    await switchTo(kind);
  }

  /** 已经装好的后端：直接切，不弹窗。 */
  async function switchTo(kind: string): Promise<void> {
    if (sdcpp.info?.preference === kind) return;
    chosen.value = kind;
    try {
      await sdcpp.setBackend(kind);
      const option = sdcpp.info?.options.find((item) => item.kind === kind);
      toast(
        i18n.t("aiVideo.backendSwitched", {
          name: option ? i18n.t(option.label) : kind,
        }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      await sdcpp.load();
      await sdcpp.loadInfo();
    }
  }

  return {
    open: session.open,
    plan: session.plan,
    running: session.running,
    forced: session.forced,
    failed: session.failed,
    progress: session.progress,
    ensure,
    maybePrompt,
    cancel: session.cancel,
    confirm: () => session.confirmRun(true),
    /** 「在后台下载」：不跳管理器，进度留在本页。 */
    confirmBackground: () => session.confirmRun(false),
    cancelDownload: session.cancelDownload,
    retry: session.retry,
    choose,
    prepareEngine,
    switchTo,
    setDone: session.setDone,
  };
}

/**
 * **ONNX Runtime 后端**：本体 + 同版本组件。
 *
 * 与引擎不同，CUDA 这套是**进程内加载**的：装完必须重启才生效，所以 `applyBackend`
 * 要把 `restart_required` 透出来，由会话决定弹不弹重启框。
 */
export function useRuntimeSetup() {
  const i18n = useI18n();
  const runtimes = useRuntimesStore();
  const device = useDeviceStore();
  const pending = ref<string | null>(null);

  function optionOf(kind: string) {
    return device.info?.options.find((option) => option.kind === kind) ?? null;
  }

  function defaultKind(): string {
    const info = device.info;
    if (!info) return "cpu";
    const current = info.options.find((option) => option.kind === info.preference);
    if (current?.available) return info.preference;
    return info.recommended;
  }

  function build(override?: string): SetupPlan | null {
    const kind = override ?? pending.value ?? defaultKind();
    const option = optionOf(kind);
    if (!option || !option.available) return null;
    const deps = runtimeDeps(option, runtimes.items, (key) => i18n.t(key));
    if (deps.length === 0) return null;
    const reason = reasonFor(i18n, device.device, kind);
    return {
      title: i18n.t("setup.title.runtime"),
      lead: i18n.t("setup.lead", { backend: option.label, reason }),
      deps,
      totalBytes: totalBytes(deps),
      backend: {
        kind,
        label: option.label,
        reason,
        recommended: device.info?.recommended === kind,
        choices: (device.info?.options ?? [])
          .filter((item) => item.available)
          .map((item) => ({ kind: item.kind, label: item.label })),
      },
      restartAfter: true,
    };
  }

  const session = useSetupSession({
    feature: "runtime",
    build: () => build(),
    applyBackend: async () => {
      const kind = pending.value ?? defaultKind();
      const info = await aiSetBackend(kind as BackendPreference);
      device.info = info;
      return info.restart_required;
    },
  });

  /** 准备某个运行时后端（不传就用当前 / 推荐的那个）。 */
  function ensureFor(kind?: string): boolean {
    pending.value = kind ?? defaultKind();
    const ready = session.ensure();
    if (!ready) pending.value = session.plan.value?.backend?.kind ?? pending.value;
    return ready;
  }

  function choose(kind: string): void {
    pending.value = kind;
    const next = build(kind);
    session.plan.value = next;
    session.open.value = next !== null;
  }

  /** 首次进入自动弹（按推荐后端算）。 */
  function maybePrompt(): void {
    pending.value = defaultKind();
    session.maybePrompt();
    if (session.open.value) pending.value = session.plan.value?.backend?.kind ?? pending.value;
  }

  return {
    open: session.open,
    plan: session.plan,
    running: session.running,
    forced: session.forced,
    failed: session.failed,
    progress: session.progress,
    ensureFor,
    maybePrompt,
    cancel: session.cancel,
    confirm: () => session.confirmRun(true),
    confirmBackground: () => session.confirmRun(false),
    cancelDownload: session.cancelDownload,
    retry: session.retry,
    choose,
    defaultKind,
  };
}

/**
 * **AI 变声**：当前 ONNX Runtime 后端 + MeanVC2 完整模型包。
 *
 * 模型包包含五张转换图和音色编码器：没有编码器就导入不了音色，新用户也就无法变声，
 * 所以它们是一个下载项，不再拆成「基础模型 / 可选编码器」两条。
 *
 * 与视频 / 画图不同，这里没有独立的引擎进程：ONNX Runtime 是进程内加载的，
 * 缺本体 / CUDA 组件时要和 `useRuntimeSetup` 一样在装完后提示重启。
 *
 * 只检查**当前生效的后端**，不硬推推荐档：CPU 是随包内置的，机器再强也不该为了
 * 一次变声先下几 GB CUDA。用户可以在弹窗里主动换成别的后端。
 */
export function useVoiceSetup(modelId: () => string = () => "meanvc2-int8") {
  const i18n = useI18n();
  const device = useDeviceStore();
  const runtimes = useRuntimesStore();
  const models = useModelsStore();
  const pending = ref<string | null>(null);
  /** 这次计划里有没有运行时 / 组件（决定装完要不要重启、要不要切后端）。 */
  let runtimePending = false;

  function optionOf(kind: string) {
    return device.info?.options.find((option) => option.kind === kind) ?? null;
  }

  function defaultKind(): string {
    const info = device.info;
    if (!info) return "cpu";
    const preferred = info.options.find((option) => option.kind === info.preference);
    return preferred?.available ? preferred.kind : info.recommended;
  }

  function build(override?: string): SetupPlan | null {
    const kind = override ?? pending.value ?? defaultKind();
    const option = optionOf(kind);
    const model = models.byId(modelId());
    const deps: SetupDep[] = [];
    if (option?.available) {
      deps.push(...runtimeDeps(option, runtimes.items, (key) => i18n.t(key)));
    }
    if (model && !model.installed) deps.push(modelDep(model));
    if (deps.length === 0) {
      runtimePending = false;
      return null;
    }

    runtimePending = deps.some((dep) => dep.kind !== "model");
    const reason = reasonFor(i18n, device.device, kind);
    return {
      title: i18n.t("setup.title.voice"),
      // 只有模型缺失时不要写「这台机器适合用 CUDA」——用户会以为还要下引擎。
      lead:
        option && runtimePending
          ? i18n.t("setup.lead", { backend: option.label, reason })
          : i18n.t("setup.leadModel"),
      deps,
      totalBytes: totalBytes(deps),
      // 纯模型计划不展示后端：用户点的是「补权重」，不该顺带被推荐换运行时。
      backend:
        runtimePending && option?.available
          ? {
              kind,
              label: option.label,
              reason,
              recommended: device.info?.recommended === kind,
              choices: (device.info?.options ?? [])
                .filter((item) => item.available)
                .map((item) => ({ kind: item.kind, label: item.label })),
            }
          : null,
      restartAfter: runtimePending,
    };
  }

  const session = useSetupSession({
    feature: "voice",
    build: () => build(),
    applyBackend: async () => {
      // 纯模型下载不用碰后端；只有补运行时 / 组件时才需要重新读一次状态。
      if (!runtimePending) return false;
      const kind = pending.value ?? defaultKind();
      const info = await aiSetBackend(kind as BackendPreference);
      device.info = info;
      return info.restart_required;
    },
  });

  /**
   * 缺什么补什么；返回 `true` = 已经能跑。
   *
   * 与其它 setup 不同，这里是**异步**的：变声的「引擎」是 ONNX Runtime，
   * 它的就绪信息要和模型清单一起读回来，否则第一次打开会把缺引擎误判成就绪。
   */
  async function ensure(): Promise<boolean> {
    if (models.catalog.length === 0) await models.load();
    // `device.load()` 会合并并发请求；正在别处加载时直接等同一个 Promise。
    if (device.info === null) await device.load();
    // 只有当前后端真的缺运行时 / 组件时才去读清单算体积，纯模型路径不多打一次 IPC。
    const info = device.info;
    const current = info?.options.find((option) => option.kind === info.preference);
    if (
      current?.available &&
      (!current.runtime_installed || current.missing.length > 0) &&
      runtimes.items.length === 0
    ) {
      await runtimes.load();
    }
    // 变声模型是一个完整包（五张转换图 + 音色编码器），缺任何文件都按同一项补。
    const ready = session.ensure();
    if (!ready) pending.value = session.plan.value?.backend?.kind ?? defaultKind();
    return ready;
  }

  function choose(kind: string): void {
    pending.value = kind;
    const next = build(kind);
    session.plan.value = next;
    session.open.value = next !== null;
  }

  return {
    open: session.open,
    plan: session.plan,
    running: session.running,
    forced: session.forced,
    failed: session.failed,
    progress: session.progress,
    ensure,
    cancel: session.cancel,
    confirm: () => session.confirmRun(true),
    confirmBackground: () => session.confirmRun(false),
    cancelDownload: session.cancelDownload,
    retry: session.retry,
    choose,
    setDone: session.setDone,
  };
}
