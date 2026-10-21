/** AI 朗读任务：本地模型 + 云端 TTS 服务，共用进度事件。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onTtsProgress,
  ttsCancel,
  ttsSynthesize,
  ttsVoices,
} from "@/core/modelApi";
import {
  cloudTtsConfig,
  cloudTtsSynthesize,
  cloudTtsVoices,
} from "@/core/cloudTtsApi";
import type {
  CloudTtsProvider,
  TtsAudio,
  TtsItem,
  TtsProgress,
  TtsVoice,
} from "@/types/models";

export const useTtsStore = defineStore("tts", () => {
  const running = ref(false);
  const progress = ref(0);
  const state = ref<TtsProgress["state"] | "idle">("idle");
  const message = ref<string | null>(null);
  const providers = ref<CloudTtsProvider[]>([]);
  /** 是否已经从后端读过配置，避免重复请求。 */
  const providersLoaded = ref(false);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onTtsProgress((payload) => {
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

  async function run<T>(task: () => Promise<T>): Promise<T> {
    watch();
    running.value = true;
    progress.value = 0;
    state.value = "loading";
    message.value = null;
    try {
      const result = await task();
      state.value = "done";
      progress.value = 1;
      return result;
    } catch (error) {
      state.value = "error";
      message.value = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      running.value = false;
    }
  }

  async function synthesize(
    modelId: string,
    items: TtsItem[],
    voice: string | null,
    referencePath: string | null,
    referenceText: string | null,
  ): Promise<TtsAudio[]> {
    if (running.value || items.length === 0) return [];
    return run(() =>
      ttsSynthesize(modelId, items, voice, referencePath, referenceText),
    );
  }

  async function voices(modelId: string | null): Promise<TtsVoice[]> {
    if (!modelId) return [];
    try {
      return await ttsVoices(modelId);
    } catch {
      return [];
    }
  }

  /** 读取云端 TTS 配置（设置页保存后重新调用即可刷新）。 */
  async function loadProviders(force = false): Promise<void> {
    if (providersLoaded.value && !force) return;
    try {
      providers.value = (await cloudTtsConfig()).providers;
      providersLoaded.value = true;
    } catch {
      providers.value = [];
    }
  }

  async function providerVoices(provider: CloudTtsProvider): Promise<TtsVoice[]> {
    try {
      return await cloudTtsVoices(provider);
    } catch {
      return [];
    }
  }

  async function synthesizeCloud(
    providerId: string,
    items: TtsItem[],
    voice: string | null,
  ): Promise<TtsAudio[]> {
    if (running.value || items.length === 0) return [];
    return run(() => cloudTtsSynthesize(providerId, items, voice));
  }

  async function cancel(): Promise<void> {
    try {
      await ttsCancel();
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
    providers,
    providersLoaded,
    watch,
    synthesize,
    synthesizeCloud,
    voices,
    providerVoices,
    loadProviders,
    cancel,
  };
});
