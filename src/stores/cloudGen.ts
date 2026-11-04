/** 云端图像 / 视频生成任务：进度事件 + 结果（本地 sd.cpp 任务走各自的 store）。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  cloudGenBusy,
  cloudGenCancel,
  cloudGenImage,
  cloudGenVideo,
  onCloudGenProgress,
} from "@/core/cloudGenApi";
import type {
  CloudGenProgress,
  CloudImageRequest,
  CloudImageResult,
  CloudVideoRequest,
  CloudVideoResult,
} from "@/types/cloudGen";

export const useCloudGenStore = defineStore("cloudGen", () => {
  const running = ref(false);
  const progress = ref<CloudGenProgress | null>(null);
  const imageResult = ref<CloudImageResult | null>(null);
  const videoResult = ref<CloudVideoResult | null>(null);
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
    subscribing = onCloudGenProgress((payload) => {
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
      running.value = await cloudGenBusy();
    } catch {
      // 预览 / 旧版桌面端没有这个命令：保持当前状态。
    }
  }

  async function startImage(
    request: CloudImageRequest,
  ): Promise<CloudImageResult | null> {
    if (running.value) return null;
    running.value = true;
    error.value = null;
    imageResult.value = null;
    progress.value = { state: "preparing", message: null, progress: 0, elapsed: 0 };
    try {
      const created = await cloudGenImage(request);
      imageResult.value = created;
      return created;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (!text.includes("已取消")) error.value = text;
      return null;
    } finally {
      running.value = false;
    }
  }

  async function startVideo(
    request: CloudVideoRequest,
  ): Promise<CloudVideoResult | null> {
    if (running.value) return null;
    running.value = true;
    error.value = null;
    videoResult.value = null;
    progress.value = { state: "preparing", message: null, progress: 0, elapsed: 0 };
    try {
      const created = await cloudGenVideo(request);
      videoResult.value = created;
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
      await cloudGenCancel();
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
    imageResult,
    videoResult,
    error,
    watch,
    unwatch,
    refreshBusy,
    startImage,
    startVideo,
    cancel,
  };
});
