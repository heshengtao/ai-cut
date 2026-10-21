/** 字幕生成任务：进度事件 + 一次转写调用。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { asrCancel, asrTranscribe, onAsrProgress } from "@/core/modelApi";
import type { AsrProgress, SubtitleCue } from "@/types/models";

export const useAsrStore = defineStore("asr", () => {
  const running = ref(false);
  const progress = ref(0);
  const state = ref<AsrProgress["state"] | "idle">("idle");
  const message = ref<string | null>(null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onAsrProgress((payload) => {
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

  async function generate(
    path: string,
    modelId: string,
    language?: string,
  ): Promise<SubtitleCue[]> {
    if (running.value) return [];
    watch();
    running.value = true;
    progress.value = 0;
    state.value = "extracting";
    message.value = null;
    try {
      const cues = await asrTranscribe(path, modelId, language);
      state.value = "done";
      return cues;
    } catch (err) {
      state.value = "error";
      message.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      running.value = false;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await asrCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  return {
    running,
    progress,
    progressPct,
    state,
    message,
    watch,
    generate,
    cancel,
  };
});
