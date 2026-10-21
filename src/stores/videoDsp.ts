/** 无模型视频处理任务：进度事件 + 忙碌状态。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onVideoDspProgress,
  videoDspCancel,
  videoDspProcess,
} from "@/core/videoDspApi";
import type {
  VideoDspOptions,
  VideoDspState,
  VideoProcessed,
} from "@/types/video";

export const useVideoDspStore = defineStore("videoDsp", () => {
  const running = ref(false);
  const state = ref<VideoDspState>("idle");
  const progress = ref(0);
  const message = ref<string | null>(null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onVideoDspProgress((payload) => {
      state.value = payload.state as VideoDspState;
      progress.value = payload.progress;
      message.value = payload.message;
      if (payload.state === "done" || payload.state === "error") running.value = false;
    })
      .then((off) => {
        stopProgress = off;
        subscribing = null;
      })
      .catch(() => {
        subscribing = null;
      });
  }

  function begin(): void {
    if (running.value) throw new Error("已有视频处理任务正在运行");
    watch();
    running.value = true;
    state.value = "processing";
    progress.value = 0;
    message.value = null;
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function process(
    path: string,
    start: number,
    duration: number,
    fps: number,
    options: VideoDspOptions,
  ): Promise<VideoProcessed> {
    begin();
    try {
      const result = await videoDspProcess(path, start, duration, fps, options);
      state.value = "done";
      progress.value = 1;
      return result;
    } catch (error) {
      state.value = "error";
      message.value = errorText(error);
      throw error;
    } finally {
      running.value = false;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await videoDspCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  return {
    running,
    state,
    progress,
    progressPct,
    message,
    watch,
    process,
    cancel,
  };
});
