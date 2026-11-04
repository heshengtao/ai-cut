/** 本地 AI 运行时（ONNX Runtime 构建）：清单、下载、取消、删除、重启提示。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onRuntimeProgress,
  runtimeBusy,
  runtimeCancel,
  runtimeCatalog,
  runtimeInstall,
  runtimeRemove,
  runtimeReveal,
} from "@/core/runtimeApi";
import { aiBackendInfo } from "@/core/agentApi";
import type { RuntimeProgress, RuntimeStatus } from "@/types/runtime";

/**
 * 运行时（下载管理器 → 运行时）：
 *
 * ONNX Runtime 是 `load-dynamic` 的 dylib：**一个进程只能加载一份**，CUDA 12 / 13
 * 是两套独立的运行时，装好 / 换后端之后要重启才生效。CUDA 组件（cudart / cuBLAS /
 * cuFFT / cuDNN）是在加载那一刻一次性预载进进程的，所以**补装组件**同样要重启。
 * 后端为此单独记了一个 `pending-restart` 标记，这里把它翻译成界面提示。
 */
export const useRuntimesStore = defineStore("runtimes", () => {
  const items = ref<RuntimeStatus[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 正在下载的运行时 id（同一时刻最多一个）。 */
  const busyId = ref<string | null>(null);
  const progress = ref<RuntimeProgress | null>(null);
  /** 「重启后生效」常驻提示（从设置页跳过来 / 装完组件时置位）。 */
  const restartPrompt = ref(false);

  /** 装 / 删之后要提示「重启后生效」。 */
  function requestRestartPrompt(): void {
    restartPrompt.value = true;
  }

  /** 取走（并清空）重启提示；返回是否曾经请求过。 */
  function consumeRestartPrompt(): boolean {
    if (!restartPrompt.value) return false;
    restartPrompt.value = false;
    return true;
  }

  /**
   * 装 / 删之后问一次后端「要不要重启才生效」。
   *
   * 只比较「已加载的运行时路径」是不够的：CUDA 组件是在加载那一刻一次性预载的，
   * 之后再补装 cuDNN / cuFFT，路径没变但仍然要重启。
   */
  async function refreshRestartPrompt(): Promise<void> {
    try {
      const info = await aiBackendInfo();
      if (info.restart_required) restartPrompt.value = true;
    } catch {
      // 预览 / 后端不可用：这只是个提示，失败就不提。
    }
  }

  const progressPct = computed<number | null>(() => {
    const current = progress.value;
    if (!current || current.state !== "downloading" || current.total <= 0) return null;
    return Math.min(100, Math.round((current.received / current.total) * 100));
  });

  /** 只有需要下载的运行时（CUDA 12 / 13）会出现在可管理列表里。 */
  const optional = computed(() => items.value.filter((item) => !item.bundled));

  function installing(id: string): boolean {
    return busyId.value === id;
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      items.value = await runtimeCatalog();
      // 下载线程可能在管理器没打开时就已经结束：别让界面一直卡在「下载中」。
      // （后端没有这个命令时按「还在下载」处理，宁可不纠正也不要误清状态。）
      let busy = true;
      try {
        busy = await runtimeBusy();
      } catch {
        busy = true;
      }
      if (!busy) {
        busyId.value = null;
        progress.value = null;
      }
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      loading.value = false;
    }
  }

  function cancelled(err: unknown): boolean {
    return String(err).includes("已取消");
  }

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  /** 订阅下载进度（管理器挂载时调用）；重复调用不会叠订阅。 */
  function watchProgress(): void {
    if (stopProgress || subscribing) return;
    subscribing = onRuntimeProgress((payload) => {
      if (payload.state === "done") {
        busyId.value = null;
        progress.value = null;
        void load();
        void refreshRestartPrompt();
      } else if (payload.state === "error") {
        busyId.value = null;
        progress.value = null;
        if (payload.message) error.value = payload.message;
      } else {
        busyId.value = payload.id;
        progress.value = payload;
      }
    })
      .then((off) => {
        stopProgress = off;
        subscribing = null;
      })
      .catch(() => {
        subscribing = null;
      });
  }

  /**
   * 下载一个运行时（本体 + 同大版本缺失组件，后端一条命令搞定）并等到装完。
   *
   * 失败 / 取消时**抛出**：调用方（下载队列 / 设置页）要据此决定是否继续下一步。
   * `error` 仍然写一份，供管理器里的红条显示。
   */
  async function install(id: string, force = false): Promise<void> {
    if (busyId.value !== null && busyId.value !== id) {
      throw new Error("已有运行时正在下载，请先等它结束或取消。");
    }
    busyId.value = id;
    progress.value = { id, state: "downloading", received: 0, total: 0, message: null };
    error.value = null;
    try {
      // 下 CUDA 本体会顺带补齐同大版本的全部组件，这一句会一直等到装完。
      await runtimeInstall(id, force);
    } catch (err) {
      busyId.value = null;
      progress.value = null;
      if (!cancelled(err)) error.value = String(err);
      throw err;
    }
    busyId.value = null;
    progress.value = null;
    await load();
    await refreshRestartPrompt();
  }

  async function cancel(): Promise<void> {
    try {
      await runtimeCancel();
    } catch {
      // 状态事件会纠正。
    } finally {
      // 立刻收起进度条；线程会在下一个数据块处停下。
      busyId.value = null;
      progress.value = null;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await runtimeRemove(id);
    } catch (err) {
      error.value = String(err);
    }
    // 删除可能因为 DLL 被占用而改成「下次启动清理」：刷新后才看得到真实状态。
    await load();
    await refreshRestartPrompt();
  }

  async function reveal(id: string): Promise<void> {
    try {
      await runtimeReveal(id);
    } catch (err) {
      error.value = String(err);
    }
  }

  return {
    items,
    optional,
    loading,
    error,
    busyId,
    progress,
    progressPct,
    restartPrompt,
    requestRestartPrompt,
    consumeRestartPrompt,
    refreshRestartPrompt,
    installing,
    load,
    watchProgress,
    install,
    cancel,
    remove,
    reveal,
  };
});
