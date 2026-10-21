/** 音频 AI / DSP 的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  EVENT_AUDIO_AI,
  type AudioAiProgress,
  type AudioDspEffect,
  type AudioDspPreset,
  type AudioProcessed,
  type AudioStem,
  type LoudnessReport,
} from "@/types/models";
import { isTauri } from "@/utils/platform";

export function audioMeasureLoudness(
  path: string,
  start: number,
  duration: number,
): Promise<LoudnessReport> {
  if (!isTauri()) return Promise.reject(new Error("响度测量需要在桌面应用中使用"));
  return invoke<LoudnessReport>("audio_measure_loudness", { path, start, duration });
}

export function audioDspProcess(
  path: string,
  start: number,
  duration: number,
  effect: AudioDspEffect,
  preset: AudioDspPreset,
): Promise<AudioProcessed> {
  if (!isTauri()) return Promise.reject(new Error("音频处理需要在桌面应用中使用"));
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
  if (!isTauri()) return Promise.reject(new Error("AI 降噪需要在桌面应用中使用"));
  return invoke<AudioProcessed>("audio_ai_denoise", { path, start, duration, modelId });
}

export function audioAiSeparate(
  path: string,
  start: number,
  duration: number,
  modelId: string,
): Promise<AudioStem[]> {
  if (!isTauri()) return Promise.reject(new Error("人声分离需要在桌面应用中使用"));
  return invoke<AudioStem[]>("audio_ai_separate", { path, start, duration, modelId });
}

export function audioExtractReference(
  path: string,
  start: number,
  duration: number,
): Promise<AudioProcessed> {
  if (!isTauri()) return Promise.reject(new Error("抽取参考音需要在桌面应用中使用"));
  return invoke<AudioProcessed>("audio_extract_reference", { path, start, duration });
}

export function audioAiCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("audio_ai_cancel");
}

/** 复用已配置的 OpenAI 兼容端点翻译字幕行。 */
export function translateText(texts: string[], target: string): Promise<string[]> {
  if (!isTauri()) return Promise.reject(new Error("音频翻译需要在桌面应用中使用"));
  return invoke<string[]>("translate_text", { texts, target });
}

export function onAudioAiProgress(
  handler: (progress: AudioAiProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<AudioAiProgress>(EVENT_AUDIO_AI, (event) => handler(event.payload));
}
