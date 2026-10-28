/** 模型下载、字幕生成与 AI 朗读的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AsrProgress,
  AsrTranscription,
  ModelProgress,
  ModelSourceConfig,
  ModelSourcePreference,
  ModelStatus,
  SourceProbe,
  SubtitleCue,
  TtsAudio,
  TtsItem,
  TtsProgress,
  TtsVoice,
} from "@/types/models";
import { EVENT_ASR, EVENT_MODEL, EVENT_TTS } from "@/types/models";
import { isTauri } from "@/utils/platform";

export function modelCatalog(): Promise<ModelStatus[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<ModelStatus[]>("model_catalog");
}

export function modelDownload(id: string): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error("模型下载需要在桌面应用中使用"));
  return invoke<void>("model_download", { id });
}

export function modelProbe(id: string): Promise<SourceProbe[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SourceProbe[]>("model_probe", { id });
}

export function modelCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("model_cancel");
}

export function modelRemove(id: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("model_remove", { id });
}

export function modelReveal(id: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("model_reveal", { id });
}

export function onModelProgress(
  handler: (progress: ModelProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<ModelProgress>(EVENT_MODEL, (event) => handler(event.payload));
}

export function modelSourceConfig(): Promise<ModelSourceConfig> {
  if (!isTauri()) {
    return Promise.resolve({ preference: "auto", mirrors: [], download_prefix: "" });
  }
  return invoke<ModelSourceConfig>("model_source_config");
}

export function modelSetSourceConfig(
  preference: ModelSourcePreference,
  mirrors: string[],
  downloadPrefix: string,
): Promise<ModelSourceConfig> {
  if (!isTauri()) return Promise.resolve({ preference, mirrors, download_prefix: downloadPrefix });
  return invoke<ModelSourceConfig>("model_set_source_config", {
    preference,
    mirrors,
    downloadPrefix,
  });
}

export function asrTranscribe(
  path: string,
  modelId: string,
  language?: string,
): Promise<SubtitleCue[]> {
  if (!isTauri()) return Promise.reject(new Error("字幕生成需要在桌面应用中使用"));
  return invoke<SubtitleCue[]>("asr_transcribe", {
    path,
    modelId,
    language: language ?? null,
  });
}

/**
 * 转写每个词的素材内时间，给「智能剪口播」用。
 *
 * 与 [`asrTranscribe`] 走同一把运行锁，两个功能不会同时占用识别模型。
 */
export function asrTranscribeWords(
  path: string,
  modelId: string,
  language?: string,
): Promise<AsrTranscription> {
  if (!isTauri()) return Promise.reject(new Error("剪口播需要在桌面应用中使用"));
  return invoke<AsrTranscription>("asr_transcribe_words", {
    path,
    modelId,
    language: language ?? null,
  });
}

export function asrCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("asr_cancel");
}

export function onAsrProgress(handler: (progress: AsrProgress) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<AsrProgress>(EVENT_ASR, (event) => handler(event.payload));
}

export function ttsVoices(modelId: string): Promise<TtsVoice[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<TtsVoice[]>("tts_voices", { modelId });
}

export function ttsSynthesize(
  modelId: string,
  items: TtsItem[],
  voice: string | null,
  referencePath: string | null,
  referenceText: string | null,
): Promise<TtsAudio[]> {
  if (!isTauri()) return Promise.reject(new Error("AI 朗读需要在桌面应用中使用"));
  return invoke<TtsAudio[]>("tts_synthesize", {
    modelId,
    items,
    voice,
    referencePath,
    referenceText,
  });
}

export function ttsCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("tts_cancel");
}

export function onTtsProgress(handler: (progress: TtsProgress) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<TtsProgress>(EVENT_TTS, (event) => handler(event.payload));
}
