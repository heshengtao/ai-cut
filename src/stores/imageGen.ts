/** 图像生成 / 编辑任务（sd.cpp 的各图像家族共用）：进度事件 + 结果。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  imageGenBusy,
  imageGenCancel,
  imageGenStart,
  onImageGenProgress,
} from "@/core/imageGenApi";
import type {
  ImageGenProgress,
  ImageGenRequest,
  ImageGenResult,
} from "@/types/imageGen";

export const useImageGenStore = defineStore("imageGen", () => {
  const running = ref(false);
  const progress = ref<ImageGenProgress | null>(null);
  const result = ref<ImageGenResult | null>(null);
  const error = ref<string | null>(null);

  const progressPct = computed<number | null>(() => {
    const current = progress.value;
    if (!current || current.state === "preparing") return null;
    if (current.progress <= 0) return null;
    return Math.min(100, Math.round(current.progress * 100));
  });

  const elapsed = computed(() => progress.value?.elapsed ?? 0);
  const message = computed(() => progress.value?.message ?? null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onImageGenProgress((payload) => {
      progress.value = payload;
      if (payload.state === "error" && payload.message) error.value = payload.message;
    })
      .then((off) => {
        stopProgress = off;
        subscribing = null;
      })
      .catch(() => {
        subscribing = null;
      });
  }

  function unwatch(): void {
    stopProgress?.();
    stopProgress = null;
  }

  async function refreshBusy(): Promise<void> {
    try {
      running.value = await imageGenBusy();
    } catch {
      // 预览 / 旧版桌面端没有这个命令：保持当前状态。
    }
  }

  async function start(request: ImageGenRequest): Promise<ImageGenResult | null> {
    if (running.value) return null;
    running.value = true;
    error.value = null;
    result.value = null;
    progress.value = { state: "preparing", message: null, progress: 0, elapsed: 0 };
    try {
      const created = await imageGenStart(request);
      result.value = created;
      return created;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (!text.includes("已取消")) error.value = text;
      return null;
    } finally {
      running.value = false;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await imageGenCancel();
    } catch {
      // 状态事件会纠正。
    }
  }

  return {
    running,
    progress,
    progressPct,
    elapsed,
    message,
    result,
    error,
    watch,
    unwatch,
    refreshBusy,
    start,
    cancel,
  };
});
