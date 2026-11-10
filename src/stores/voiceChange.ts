/** 变声任务：进度事件 + 上次选择的音色 / 模型（跨工程记住）。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { cancelVoiceChange, onVoiceProgress } from "@/core/voiceChangeApi";

export const useVoiceChangeStore = defineStore("voiceChange", () => {
  const running = ref(false);
  const progress = ref(0);
  const index = ref(0);
  const total = ref(0);
  const message = ref<string | null>(null);
  const voiceId = ref<string | null>(null);
  const modelId = ref("meanvc2-int8");

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.round(progress.value * 100));

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onVoiceProgress((payload) => {
      progress.value = payload.progress;
      index.value = payload.index;
      total.value = payload.total;
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

  function start(count: number): void {
    if (running.value) throw new Error("已有变声任务正在运行");
    watch();
    running.value = true;
    progress.value = 0;
    index.value = 0;
    total.value = count;
    message.value = null;
  }

  function finish(): void {
    running.value = false;
  }

  async function cancel(): Promise<void> {
    await cancelVoiceChange();
  }

  return {
    running,
    progress,
    index,
    total,
    message,
    voiceId,
    modelId,
    progressPct,
    start,
    finish,
    cancel,
  };
});
