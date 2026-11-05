/**
 * 右键菜单里的 AI 动作：先确认本地模型就绪，再直接复用 `core/aiActions` 的编排。
 *
 * 与 AI 面板的区别只在入口：面板负责选模型 / 调参数，菜单负责「对着这个片段立刻做」。
 * 缺模型时不静默失败，而是给一条带「打开模型下载」按钮的提示。
 */
import {
  cutFillerWords,
  denoise,
  interpolate,
  measureLoudness,
  processAudio,
  processVideo,
  reframe,
  separate,
  synthesizeVoiceover,
  transcribe,
  translate,
  upscale,
  type JobContext,
} from "@/core/aiActions";
import { useAiLaunchStore } from "@/stores/aiLaunch";
import { useAiTasksStore } from "@/stores/aiTasks";
import { useAsrStore } from "@/stores/asr";
import { useAudioAiStore } from "@/stores/audioAi";
import { useDownloadsStore } from "@/stores/downloads";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { usePlaybackStore } from "@/stores/playback";
import { useTtsStore } from "@/stores/tts";
import { useVideoAiStore } from "@/stores/videoAi";
import { useVideoDspStore } from "@/stores/videoDsp";
import type { AudioDspPreset, ModelFeature } from "@/types/models";
import type { VideoAiSubject, VideoDspOptions } from "@/types/video";
import { toast } from "@/composables/useToast";
import { t } from "@/i18n";

/** 菜单触发的任务不会被外部 job 取消，`cancelled` 永远是 false；取消走 HUD 的按钮。 */
const MENU_JOB: JobContext = { cancelled: () => false, actor: "human" };

interface Requirement {
  feature: ModelFeature;
  label: string;
}

export function useAiClipActions() {
  const layout = useLayoutStore();
  const playback = usePlaybackStore();
  const models = useModelsStore();
  const downloads = useDownloadsStore();
  const asr = useAsrStore();
  const tts = useTtsStore();
  const audioAi = useAudioAiStore();
  const videoAi = useVideoAiStore();
  const videoDsp = useVideoDspStore();
  const tasks = useAiTasksStore();
  const launch = useAiLaunchStore();

  async function loadCatalog(): Promise<void> {
    if (models.catalog.length === 0) await models.load();
  }

  function installed(feature: ModelFeature): boolean {
    return models.ofFeature(feature).some((model) => model.installed);
  }

  /** 跳到下载管理器并定位到具体那一项；比只打开「已安装」页签有用。 */
  function openModelDownloads(modelId?: string): void {
    if (modelId) downloads.requestFocus("model", modelId);
    layout.openTab("models");
  }

  function modelToast(name: string, detail?: string, modelId?: string): void {
    toast(detail ? `${t("menu.aiNeedModel", { name })}（${detail}）` : t("menu.aiNeedModel", { name }), "error", {
      timeout: 8000,
      action: {
        label: t("menu.openModels"),
        run: () => openModelDownloads(modelId),
      },
    });
  }

  async function ensureFeatures(requirements: Requirement[]): Promise<boolean> {
    await loadCatalog();
    const missing = requirements.filter((item) => !installed(item.feature));
    if (missing.length === 0) return true;
    const names = [...new Set(missing.map((item) => item.label))].join(
      t("common.listSeparator"),
    );
    const suggested = models.ofFeature(missing[0].feature)[0]?.id;
    modelToast(names, undefined, suggested);
    return false;
  }

  /** 剪口播必须用强制对齐器，`aiActions` 里是写死的模型 id，这里保持一致。 */
  async function ensureAligner(): Promise<boolean> {
    await loadCatalog();
    if (models.byId("qwen3-aligner-0.6b-q4")?.installed) return true;
    modelToast(
      t("audio.cutFillers"),
      t("menu.alignerOnly"),
      "qwen3-aligner-0.6b-q4",
    );
    return false;
  }

  /** 本地朗读模型；MOSS 家族还依赖音频编解码器。 */
  async function ensureTts(): Promise<boolean> {
    await loadCatalog();
    const model = models.ofFeature("tts").find((item) => item.installed);
    if (!model) {
      modelToast(t("ai.voiceoverModel"), undefined, models.ofFeature("tts")[0]?.id);
      return false;
    }
    if (model.family === "moss_tts_nano" && !installed("tts-codec")) {
      modelToast(
        t("ai.voiceoverModel"),
        t("menu.codecOnly"),
        models.ofFeature("tts-codec")[0]?.id,
      );
      return false;
    }
    return true;
  }

  /** 同一时刻只跑一个菜单级 AI 任务：底层 store 多数只支持单任务。 */
  function busy(): boolean {
    if (
      tasks.busy ||
      asr.running ||
      tts.running ||
      audioAi.running ||
      videoAi.running ||
      videoDsp.running
    ) {
      toast(t("menu.aiBusy"));
      return true;
    }
    return false;
  }

  function run(name: string, job: () => Promise<unknown>, cancel?: () => void): void {
    if (busy()) return;
    const id = tasks.begin(name, cancel);
    void Promise.resolve()
      .then(job)
      .then(() => {
        toast(t("menu.aiDone", { name }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("已取消")) {
          toast(t("audio.cancelled"));
          return;
        }
        toast(t("menu.aiFailed", { error: message }), "error", { timeout: 9000 });
      })
      .finally(() => tasks.end(id));
  }

  // -------------------------------------------------------------------------
  // 字幕 / 音频
  // -------------------------------------------------------------------------

  async function transcribeClip(clipId: string): Promise<void> {
    const ok = await ensureFeatures([
      { feature: "asr", label: t("ai.subtitleModel") },
      { feature: "vad", label: t("ai.subtitleModel") },
    ]);
    if (!ok) return;
    run(t("ai.subtitles"), () => transcribe({ clipId, insertSubtitles: true }, MENU_JOB), () =>
      asr.cancel(),
    );
  }

  async function cutFiller(clipId: string): Promise<void> {
    const ok = await ensureFeatures([{ feature: "asr", label: t("ai.subtitleModel") }]);
    if (!ok || !(await ensureAligner())) return;
    run(t("audio.cutFillers"), () => cutFillerWords({ clipId }, MENU_JOB), () => asr.cancel());
  }

  async function translateClip(
    clipId: string,
    target: string,
    dub: boolean,
  ): Promise<void> {
    const ok = await ensureFeatures([
      { feature: "asr", label: t("ai.subtitleModel") },
      { feature: "vad", label: t("ai.subtitleModel") },
    ]);
    if (!ok) return;
    if (dub && !(await ensureTts())) return;
    const name = `${t("audio.translate")} · ${t(`audio.lang.${target}`)}`;
    run(
      name,
      () => translate({ clipId, target, dub }, MENU_JOB),
      () => {
        void asr.cancel();
        void audioAi.cancel();
      },
    );
  }

  async function separateClip(clipId: string): Promise<void> {
    const ok = await ensureFeatures([{ feature: "separate", label: t("audio.separate") }]);
    if (!ok) return;
    run(t("audio.separate"), () => separate({ clipId }, MENU_JOB), () => audioAi.cancel());
  }

  async function denoiseClip(clipId: string): Promise<void> {
    const ok = await ensureFeatures([{ feature: "enhance", label: t("audio.aiDenoise") }]);
    if (!ok) return;
    run(t("audio.aiDenoise"), () => denoise({ clipId }, MENU_JOB), () => audioAi.cancel());
  }

  function beautifyClip(clipId: string, preset: AudioDspPreset): void {
    const name = `${t("audio.beautify")} · ${t(`audio.beautify.${preset}`)}`;
    run(
      name,
      () => processAudio({ clipId, effect: "beautify", preset }, MENU_JOB),
      () => audioAi.cancel(),
    );
  }

  function normalizeLoudness(clipId: string): void {
    run(
      t("audio.loudness"),
      () => measureLoudness({ clipId, targetLufs: -14, apply: true }, MENU_JOB),
      () => audioAi.cancel(),
    );
  }

  async function voiceover(clipIds: string[]): Promise<void> {
    if (clipIds.length === 0) return;
    if (!(await ensureTts())) return;
    run(t("ai.voiceover"), () => synthesizeVoiceover({ clipIds }, MENU_JOB), () =>
      tts.cancel(),
    );
  }

  // -------------------------------------------------------------------------
  // 画面
  // -------------------------------------------------------------------------

  async function upscaleClip(clipId: string, scale: 2 | 4): Promise<void> {
    const ok = await ensureFeatures([{ feature: "superres", label: t("videoAi.upscale") }]);
    if (!ok) return;
    run(
      `${t("videoAi.upscale")} ${scale}×`,
      () => upscale({ clipId, scale }, MENU_JOB),
      () => videoAi.cancel(),
    );
  }

  async function interpolateClip(clipId: string, factor: 2 | 4): Promise<void> {
    const ok = await ensureFeatures([
      { feature: "interpolate", label: t("videoAi.interpolate") },
    ]);
    if (!ok) return;
    run(
      `${t("videoAi.interpolate")} ${factor}×`,
      () => interpolate({ clipId, factor }, MENU_JOB),
      () => videoAi.cancel(),
    );
  }

  async function reframeClip(clipId: string, subject: VideoAiSubject): Promise<void> {
    const feature: ModelFeature = subject === "person" ? "track" : "reframe";
    const label = subject === "person" ? t("videoAi.track") : t("videoAi.crop");
    const ok = await ensureFeatures([{ feature, label }]);
    if (!ok) return;
    run(
      label,
      () =>
        reframe(
          {
            clipId,
            mode: subject === "person" ? "track" : "crop",
            subject,
            aspect: "9:16",
            height: 1080,
            smooth: 0.6,
          },
          MENU_JOB,
        ),
      () => videoAi.cancel(),
    );
  }

  function processVideoClip(
    clipId: string,
    options: VideoDspOptions,
    name: string,
  ): void {
    run(
      name,
      () => processVideo({ clipId, options }, MENU_JOB),
      () => videoDsp.cancel(),
    );
  }

  // -------------------------------------------------------------------------
  // 生成页：带 prompt / 参考图 / 落点打开
  // -------------------------------------------------------------------------

  function openVideoGeneration(options: {
    at: number;
    prompt?: string;
    imageAssetId?: string;
  }): void {
    playback.setPlayhead(options.at);
    launch.open("video", {
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.imageAssetId ? { imageAssetId: options.imageAssetId } : {}),
    });
    layout.openTab("ai");
  }

  function openImageGeneration(options: {
    at: number;
    mode?: "draw" | "edit";
    prompt?: string;
    sourceAssetId?: string;
  }): void {
    playback.setPlayhead(options.at);
    launch.open("image", {
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}),
    });
    layout.openTab("ai");
  }

  return {
    transcribeClip,
    cutFiller,
    translateClip,
    separateClip,
    denoiseClip,
    beautifyClip,
    normalizeLoudness,
    voiceover,
    upscaleClip,
    interpolateClip,
    reframeClip,
    processVideoClip,
    openVideoGeneration,
    openImageGeneration,
  };
}
