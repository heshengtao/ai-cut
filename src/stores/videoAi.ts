/** 视频 AI 任务：进度事件 + 统一忙碌状态。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onVideoAiProgress,
  videoAiCancel,
  videoAiInterpolate,
  videoAiReframe,
  videoAiUpscale,
} from "@/core/videoAiApi";
import type {
  VideoAiAspect,
  VideoAiState,
  VideoAiSubject,
  VideoProcessed,
} from "@/types/video";

export type VideoAiTask = "upscale" | "interpolate" | "reframe";

export const useVideoAiStore = defineStore("videoAi", () => {
  const running = ref(false);
  const task = ref<VideoAiTask | null>(null);
  const state = ref<VideoAiState>("idle");
  const progress = ref(0);
  const message = ref<string | null>(null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onVideoAiProgress((payload) => {
      state.value = payload.state as VideoAiState;
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

  function begin(nextTask: VideoAiTask): void {
    if (running.value) throw new Error("已有视频 AI 任务正在运行");
    watch();
    running.value = true;
    task.value = nextTask;
    state.value = "processing";
    progress.value = 0;
    message.value = null;
  }

  function finish(): void {
    running.value = false;
    task.value = null;
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function upscale(
    path: string,
    start: number,
    duration: number,
    fps: number,
    modelId: string,
    scale: number,
  ): Promise<VideoProcessed> {
    begin("upscale");
    try {
      const result = await videoAiUpscale(path, start, duration, fps, modelId, scale);
      state.value = "done";
      progress.value = 1;
      return result;
    } catch (error) {
      state.value = "error";
      message.value = errorText(error);
      throw error;
    } finally {
      finish();
    }
  }

  async function interpolate(
    path: string,
    start: number,
    duration: number,
    fps: number,
    modelId: string,
    factor: number,
  ): Promise<VideoProcessed> {
    begin("interpolate");
    try {
      const result = await videoAiInterpolate(path, start, duration, fps, modelId, factor);
      state.value = "done";
      progress.value = 1;
      return result;
    } catch (error) {
      state.value = "error";
      message.value = errorText(error);
      throw error;
    } finally {
      finish();
    }
  }

  async function reframe(
    path: string,
    start: number,
    duration: number,
    fps: number,
    yoloModelId: string | null,
    yunetModelId: string | null,
    subject: VideoAiSubject,
    aspect: VideoAiAspect,
    height: number,
    smooth: number,
  ): Promise<VideoProcessed> {
    begin("reframe");
    try {
      const result = await videoAiReframe(
        path,
        start,
        duration,
        fps,
        yoloModelId,
        yunetModelId,
        subject,
        aspect,
        height,
        smooth,
      );
      state.value = "done";
      progress.value = 1;
      return result;
    } catch (error) {
      state.value = "error";
      message.value = errorText(error);
      throw error;
    } finally {
      finish();
    }
  }

  async function cancel(): Promise<void> {
    try {
      await videoAiCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  return {
    running,
    task,
    state,
    progress,
    progressPct,
    message,
    watch,
    upscale,
    interpolate,
    reframe,
    cancel,
  };
});
