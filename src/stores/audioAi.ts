/** 音频 AI / DSP 任务：进度事件 + 统一的忙碌状态。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  audioAiCancel,
  audioAiDenoise,
  audioAiSeparate,
  audioDspProcess,
  audioMeasureLoudness,
  onAudioAiProgress,
  translateText,
} from "@/core/audioAiApi";
import type {
  AudioAiState,
  AudioDspEffect,
  AudioDspPreset,
  AudioProcessed,
  AudioStem,
  LoudnessReport,
} from "@/types/models";

export type AudioAiTask =
  | "denoise"
  | "separate"
  | "dsp"
  | "loudness"
  | "translate";

export const useAudioAiStore = defineStore("audioAi", () => {
  const running = ref(false);
  /** 当前运行的是哪一项能力：进度条只显示在对应卡片上。 */
  const task = ref<AudioAiTask | null>(null);
  /** 当前任务是否能被 `audio_ai_cancel` 真正取消（ffmpeg DSP 不支持中途取消）。 */
  const cancellable = ref(false);
  const state = ref<AudioAiState>("idle");
  const progress = ref(0);
  const message = ref<string | null>(null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onAudioAiProgress((payload) => {
      state.value = payload.state;
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

  function begin(nextTask: AudioAiTask, canCancel: boolean): void {
    if (running.value) throw new Error("已有音频任务正在运行");
    watch();
    running.value = true;
    task.value = nextTask;
    cancellable.value = canCancel;
    state.value = "processing";
    progress.value = 0;
    message.value = null;
  }

  function finish(): void {
    running.value = false;
    task.value = null;
    cancellable.value = false;
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function denoise(
    path: string,
    start: number,
    duration: number,
    modelId: string,
  ): Promise<AudioProcessed> {
    begin("denoise", true);
    try {
      const result = await audioAiDenoise(path, start, duration, modelId);
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

  async function separate(
    path: string,
    start: number,
    duration: number,
    modelId: string,
  ): Promise<AudioStem[]> {
    begin("separate", true);
    try {
      const result = await audioAiSeparate(path, start, duration, modelId);
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

  async function dsp(
    path: string,
    start: number,
    duration: number,
    effect: AudioDspEffect,
    preset: AudioDspPreset,
  ): Promise<AudioProcessed> {
    begin("dsp", false);
    try {
      const result = await audioDspProcess(path, start, duration, effect, preset);
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

  async function loudness(
    path: string,
    start: number,
    duration: number,
  ): Promise<LoudnessReport> {
    begin("loudness", false);
    try {
      const result = await audioMeasureLoudness(path, start, duration);
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

  async function translate(texts: string[], target: string): Promise<string[]> {
    begin("translate", true);
    try {
      const result = await translateText(texts, target);
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
      await audioAiCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  return {
    running,
    task,
    cancellable,
    state,
    progress,
    progressPct,
    message,
    watch,
    denoise,
    separate,
    dsp,
    loudness,
    translate,
    cancel,
  };
});
