/** 视频生成任务（sd.cpp 的各模型家族共用）：进度事件 + 结果。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onVideoGenProgress,
  videoGenBusy,
  videoGenCancel,
  videoGenStart,
} from "@/core/videoGenApi";
import type {
  VideoGenProgress,
  VideoGenRequest,
  VideoGenResult,
} from "@/types/videoGen";

export const useVideoGenStore = defineStore("videoGen", () => {
  const running = ref(false);
  const progress = ref<VideoGenProgress | null>(null);
  const result = ref<VideoGenResult | null>(null);
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
    subscribing = onVideoGenProgress((payload) => {
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
      running.value = await videoGenBusy();
    } catch {
      // 预览 / 旧版桌面端没有这个命令：保持当前状态。
    }
  }

  async function start(request: VideoGenRequest): Promise<VideoGenResult | null> {
    if (running.value) return null;
    running.value = true;
    error.value = null;
    result.value = null;
    progress.value = { state: "preparing", message: null, progress: 0, elapsed: 0 };
    try {
      const created = await videoGenStart(request);
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
      await videoGenCancel();
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
