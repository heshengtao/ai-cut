/**
 * **按类型并行的下载队列 + 「跳到下载管理器并定位到某一项」的聚焦总线。**
 *
 * 为什么要有它：模型 / ONNX Runtime / sd.cpp 引擎原本各自管一个 `busyId`，
 * 「引擎装完再下模型」这种链式需求只能由调用方自己 `await` 串联；可一旦用户
 * 中途点了别的下载，后面那一步就会被 store 的「已有下载」守卫**静默吞掉**，
 * 界面表现为「确认过了，但什么都没发生」。
 *
 * 语义（与后端三个独立 downloader 对齐，ai-daw 也是这个模型）：
 * - **一条车道一个类型**：`runtime` / `sdcpp` / `model` 各自最多一个在下载，
 *   不同车道之间可以同时跑（后端 `models.rs` / `runtime.rs` / `sdcpp.rs`
 *   各有一个 `running` 标志，互不阻塞）；
 * - 同一车道内按入队顺序串行，一条失败就停下这一条车道，其余车道继续；
 * - 队列跑完后调用方可以接着做「切后端 / 回原页面 / 提示重启」。
 *
 * 为什么不是全局串行：一次「准备运行环境」会同时要引擎和权重，串行只是把两条
 * 独立的高速公路并成一条；而且后端本来就允许并行，禁它的只有这个 store。
 * 代价是下载条要能同时显示多行（`DownloadStrip` 已按车道渲染）。
 *
 * `focus` 是给下载管理器用的：跳过去之后要自动切页签、切筛选、滚动定位并高亮，
 * 否则用户落在「已安装」页签上，只会看到一句「没有可下载的内容」。
 */
import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useSdcppStore } from "@/stores/sdcpp";

/** 下载管理器里的三个分区（与 ModelsPane 的分组一一对应）。 */
export type DownloadSection = "runtime" | "sdcpp" | "model";

/** 车道顺序 = 下载条上的显示顺序（引擎 / 运行库在前，权重在后）。 */
const SECTIONS: DownloadSection[] = ["runtime", "sdcpp", "model"];

export interface DownloadTask {
  section: DownloadSection;
  /** 模型 id / 运行时 id / 引擎包 id。 */
  id: string;
  /** 界面文案用的名字（失败提示要指名道姓）。 */
  label: string;
  /** 预计要下多少字节（磁盘空间预检用；未知就省略）。 */
  bytes?: number;
}

export interface DownloadFocus {
  section: DownloadSection;
  id: string;
}

/** 失败的那一项（给「重试剩余」用）。 */
export interface DownloadFailure {
  task: DownloadTask;
  message: string;
}

/** 下载条的一行：某条车道正在跑的那一项。 */
export interface DownloadActive {
  section: DownloadSection;
  task: DownloadTask;
  /** 0–100；总大小未知时 `null`（画不定长条纹）。 */
  pct: number | null;
  /** 这一批里的第几项 / 共几项（只统计本车道）。 */
  index: number;
  total: number;
}

/** 一个待跑的任务 + 它这一项的完成回调。 */
interface Job {
  task: DownloadTask;
  settle: (ok: boolean) => void;
}

interface LaneState {
  /** 正在下载的那一项（`null` = 这条车道空着）。 */
  active: DownloadTask | null;
  /** 还没开始的任务。 */
  queue: Job[];
  /** 本批已完成 / 共几项（车道空下来时归零）。 */
  done: number;
  total: number;
  pumping: boolean;
  /** 第一条失败（下载条 / 调用方要指名道姓）。 */
  failure: DownloadFailure | null;
  /** 本批真正失败 + 被跳过的任务（「重试剩余」只该重跑这些）。 */
  failed: DownloadTask[];
}

function lane(): LaneState {
  return {
    active: null,
    queue: [],
    done: 0,
    total: 0,
    pumping: false,
    failure: null,
    failed: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useDownloadsStore = defineStore("downloads", () => {
  const models = useModelsStore();
  const runtimes = useRuntimesStore();
  const sdcpp = useSdcppStore();

  const lanes = reactive<Record<DownloadSection, LaneState>>({
    runtime: lane(),
    sdcpp: lane(),
    model: lane(),
  });

  /** 跳到下载管理器时要定位到哪一项（消费后清空）。 */
  const focus = ref<DownloadFocus | null>(null);

  function sectionPct(section: DownloadSection): number | null {
    if (section === "model") return models.progressPct;
    if (section === "runtime") return runtimes.progressPct;
    return sdcpp.progressPct;
  }

  /** 各 store 的「正在下载」标志（下载线程可能在别处被启动）。 */
  function sectionBusyId(section: DownloadSection): string | null {
    if (section === "model") return models.busyId;
    if (section === "runtime") return runtimes.busyId;
    return sdcpp.busyId;
  }

  /**
   * 等别的入口（设置页 / AI 卡片）把同一类型的下载跑完再开始。
   *
   * 后端的 `running` 标志是「一个类型一个」，撞上了只会报「已有…正在下载」；
   * 用户在设置页手动点的那一份不该被队列当成失败，排在它后面即可。
   */
  async function waitForSectionIdle(section: DownloadSection): Promise<void> {
    if (sectionBusyId(section) === null) return;
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => sectionBusyId(section),
        (value) => {
          if (value !== null) return;
          stop();
          resolve();
        },
      );
    });
  }

  /** 跑一项：三套 store 的失败语义统一成「抛异常」。 */
  async function one(task: DownloadTask): Promise<void> {
    switch (task.section) {
      case "model":
        await models.download(task.id);
        return;
      case "runtime":
        await runtimes.install(task.id);
        return;
      default:
        await sdcpp.install(task.id);
    }
  }

  /** 跑一条车道：顺序执行，失败即停（后面的任务记进 `failed` 等重试）。 */
  async function pump(section: DownloadSection): Promise<void> {
    const state = lanes[section];
    if (state.pumping) return;
    state.pumping = true;
    try {
      while (state.queue.length > 0) {
        await waitForSectionIdle(section);
        const job = state.queue.shift();
        if (!job) break;
        state.active = job.task;
        try {
          await one(job.task);
          state.done += 1;
          job.settle(true);
        } catch (error) {
          const failure = { task: job.task, message: messageOf(error) };
          if (!state.failure) state.failure = failure;
          state.failed.push(job.task);
          job.settle(false);
          // 这一条车道到此为止：剩下的任务没开始，记为待重试，别让 run() 永远等。
          for (const rest of state.queue.splice(0)) {
            state.failed.push(rest.task);
            rest.settle(false);
          }
        } finally {
          state.active = null;
        }
      }
    } finally {
      state.pumping = false;
      state.done = 0;
      state.total = 0;
    }
  }

  /** 把若干项排进一条车道，返回「这几项是否全部成功」。 */
  function enqueue(section: DownloadSection, tasks: DownloadTask[]): Promise<boolean> {
    const state = lanes[section];
    // 车道空着才清上一轮的失败记录；并行入队时不要把别人刚记下的原因抹掉。
    if (!state.pumping && state.queue.length === 0) {
      state.failure = null;
      state.failed = [];
      state.done = 0;
      state.total = 0;
    }
    const waits: Promise<boolean>[] = [];
    for (const task of tasks) {
      state.total += 1;
      waits.push(
        new Promise<boolean>((resolve) => {
          state.queue.push({ task, settle: resolve });
        }),
      );
    }
    void pump(section);
    return Promise.all(waits).then((results) => results.every(Boolean));
  }

  /** 各车道正在跑的项（下载条按这个渲染，一行一条车道）。 */
  const active = computed<DownloadActive[]>(() => {
    const rows: DownloadActive[] = [];
    for (const section of SECTIONS) {
      const state = lanes[section];
      if (!state.active) continue;
      rows.push({
        section,
        task: state.active,
        pct: sectionPct(section),
        index: Math.min(state.done + 1, Math.max(1, state.total)),
        total: Math.max(1, state.total),
      });
    }
    return rows;
  });

  const running = computed(() => active.value.length > 0);
  const pending = computed(() =>
    SECTIONS.reduce((sum, section) => sum + lanes[section].queue.length, 0),
  );

  /** 第一条失败（给未按车道区分的调用方用）。 */
  const failure = computed<DownloadFailure | null>(() => {
    for (const section of SECTIONS) {
      const value = lanes[section].failure;
      if (value) return value;
    }
    return null;
  });

  /** 本批没装成的全部任务（失败 + 被跳过的），按车道顺序。 */
  const failedTasks = computed<DownloadTask[]>(() =>
    SECTIONS.flatMap((section) => lanes[section].failed),
  );

  /** 进度文案：聚合所有车道（`已完成 2/3`）。 */
  const progressText = computed(() => ({
    done: SECTIONS.reduce((sum, section) => sum + lanes[section].done, 0),
    total: SECTIONS.reduce((sum, section) => sum + lanes[section].total, 0),
  }));

  /**
   * 正在跑的第一项（给只画一根进度条的页内 / 对话框用；多车道时取第一条）。
   *
   * 下载条不要用它——它要看到所有车道，用 `active`。
   */
  const progress = computed(() => active.value[0] ?? null);

  function requestFocus(section: DownloadSection, id: string): void {
    focus.value = { section, id };
  }

  /** 取走（并清空）聚焦请求；返回是否曾经请求过。 */
  function consumeFocus(): DownloadFocus | null {
    const value = focus.value;
    focus.value = null;
    return value;
  }

  /**
   * 按类型并行下载一串任务，返回是否全部成功。
   *
   * - 不同分区同时开始；同一分区按传入顺序串行；
   * - 某一条车道失败就停下它（其余车道照常跑完），失败项与未开始项进 `failedTasks`；
   * - 已经有别的入口在同类型上下载时，排在它后面而不是报错——旧实现会静默 `return false`，
   *   界面表现为「点了确认但什么都没发生」。
   */
  async function run(tasks: DownloadTask[]): Promise<boolean> {
    if (tasks.length === 0) return true;
    const waits: Promise<boolean>[] = [];
    for (const section of SECTIONS) {
      const mine = tasks.filter((task) => task.section === section);
      if (mine.length > 0) waits.push(enqueue(section, mine));
    }
    const results = await Promise.all(waits);
    return results.every(Boolean);
  }

  /** 失败之后接着下「没完成的那几项」。 */
  async function retry(tasks: DownloadTask[]): Promise<boolean> {
    return run(tasks);
  }

  /**
   * 取消：传分区只停那一条车道，不传就停全部正在跑的（排队中的一并丢掉）。
   *
   * 只取消**本队列自己发起的**下载：别的入口手动点的下载不归这里管。
   */
  async function cancel(section?: DownloadSection): Promise<void> {
    const targets = section
      ? [section]
      : SECTIONS.filter((entry) => {
          const state = lanes[entry];
          // 排队中但还没拿到 store（等别的入口跑完）的车道也要一起撤掉。
          return state.active !== null || state.queue.length > 0;
        });
    await Promise.all(
      targets.map(async (entry) => {
        const state = lanes[entry];
        for (const job of state.queue.splice(0)) job.settle(false);
        if (!state.active) return;
        try {
          if (entry === "model") await models.cancel();
          else if (entry === "runtime") await runtimes.cancel();
          else await sdcpp.cancel();
        } catch {
          // 各 store 的终态事件会纠正状态。
        } finally {
          state.active = null;
        }
      }),
    );
  }

  return {
    active,
    failure,
    failedTasks,
    focus,
    running,
    pending,
    progress,
    progressText,
    requestFocus,
    consumeFocus,
    run,
    retry,
    cancel,
  };
});
