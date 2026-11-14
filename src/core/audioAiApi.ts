/** 音频 AI / DSP 的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import {
  EVENT_AUDIO_AI,
  type AudioAiProgress,
  type AudioDspEffect,
  type AudioDspPreset,
  type AudioProcessed,
  type AudioStem,
  type LoudnessReport,
} from "@/types/models";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";

export async function audioMeasureLoudness(
  path: string,
  start: number,
  duration: number,
): Promise<LoudnessReport> {
  await requireCapability("loudness", t("caps.feature.loudness"));
  return invoke<LoudnessReport>("audio_measure_loudness", { path, start, duration });
}

export function audioDspProcess(
  path: string,
  start: number,
  duration: number,
  effect: AudioDspEffect,
  preset: AudioDspPreset,
): Promise<AudioProcessed> {
  return invoke<AudioProcessed>("audio_dsp_process", {
    path,
    start,
    duration,
    effect,
    preset,
  });
}

export function audioAiDenoise(
  path: string,
  start: number,
  duration: number,
  modelId: string,
): Promise<AudioProcessed> {
  return invoke<AudioProcessed>("audio_ai_denoise", { path, start, duration, modelId });
}

export function audioAiSeparate(
  path: string,
  start: number,
  duration: number,
  modelId: string,
): Promise<AudioStem[]> {
  return invoke<AudioStem[]>("audio_ai_separate", { path, start, duration, modelId });
}

export function audioExtractReference(
  path: string,
  start: number,
  duration: number,
): Promise<AudioProcessed> {
  return invoke<AudioProcessed>("audio_extract_reference", { path, start, duration });
}

export function audioAiCancel(): Promise<void> {
  return invoke<void>("audio_ai_cancel");
}

/** 复用已配置的 OpenAI 兼容端点翻译字幕行。 */
export function translateText(texts: string[], target: string): Promise<string[]> {
  return invoke<string[]>("translate_text", { texts, target });
}

export function onAudioAiProgress(
  handler: (progress: AudioAiProgress) => void,
): Promise<UnlistenFn> {
  return listen<AudioAiProgress>(EVENT_AUDIO_AI, (event) => handler(event.payload));
}
