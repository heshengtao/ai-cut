/** 模型下载、字幕生成与 AI 朗读的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type {
  AsrProgress,
  AsrTranscription,
  HfTokenStatus,
  ModelAuth,
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

export function modelCatalog(): Promise<ModelStatus[]> {
  return invoke<ModelStatus[]>("model_catalog");
}

/**
 * 开始下载某个模型；命令一直等到下完 / 失败。
 *
 * 返回值非空 = 目标模型是 gated 仓库，需要用户先去 HF 同意许可并给一个 read token；
 * 拿到 token 后重新调一次即可。
 */
export function modelDownload(id: string): Promise<ModelAuth | null> {
  return invoke<ModelAuth | null>("model_download", { id });
}

/** 保存 / 清除 Hugging Face read token（传空串 = 清除）。 */
export function modelSaveHfToken(token: string): Promise<void> {
  return invoke<void>("model_save_hf_token", { token });
}

/** 当前是否配了 HF token（只回状态与掩码，不回 token 本身）。 */
export function modelHfTokenStatus(): Promise<HfTokenStatus> {
  return invoke<HfTokenStatus>("model_hf_token_status");
}

export function modelProbe(id: string): Promise<SourceProbe[]> {
  return invoke<SourceProbe[]>("model_probe", { id });
}

export function modelCancel(): Promise<void> {
  return invoke<void>("model_cancel");
}

export function modelRemove(id: string): Promise<void> {
  return invoke<void>("model_remove", { id });
}

export function modelReveal(id: string): Promise<void> {
  return invoke<void>("model_reveal", { id });
}

export function onModelProgress(
  handler: (progress: ModelProgress) => void,
): Promise<UnlistenFn> {
  return listen<ModelProgress>(EVENT_MODEL, (event) => handler(event.payload));
}

export function modelSourceConfig(): Promise<ModelSourceConfig> {
  return invoke<ModelSourceConfig>("model_source_config");
}

export function modelSetSourceConfig(
  preference: ModelSourcePreference,
  mirrors: string[],
  downloadPrefix: string,
): Promise<ModelSourceConfig> {
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
  return invoke<AsrTranscription>("asr_transcribe_words", {
    path,
    modelId,
    language: language ?? null,
  });
}

export function asrCancel(): Promise<void> {
  return invoke<void>("asr_cancel");
}

export function onAsrProgress(handler: (progress: AsrProgress) => void): Promise<UnlistenFn> {
  return listen<AsrProgress>(EVENT_ASR, (event) => handler(event.payload));
}

export function ttsVoices(modelId: string): Promise<TtsVoice[]> {
  return invoke<TtsVoice[]>("tts_voices", { modelId });
}

export function ttsSynthesize(
  modelId: string,
  items: TtsItem[],
  voice: string | null,
  referencePath: string | null,
  referenceText: string | null,
): Promise<TtsAudio[]> {
  return invoke<TtsAudio[]>("tts_synthesize", {
    modelId,
    items,
    voice,
    referencePath,
    referenceText,
  });
}

export function ttsCancel(): Promise<void> {
  return invoke<void>("tts_cancel");
}

export function onTtsProgress(handler: (progress: TtsProgress) => void): Promise<UnlistenFn> {
  return listen<TtsProgress>(EVENT_TTS, (event) => handler(event.payload));
}
