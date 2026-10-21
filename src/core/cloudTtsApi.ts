/** 云端 / 自定义 TTS 的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import type {
  CloudTtsConfig,
  CloudTtsProvider,
  CloudTtsTest,
  TtsAudio,
  TtsItem,
  TtsVoice,
} from "@/types/models";
import { isTauri } from "@/utils/platform";

const DESKTOP_ONLY = "云端 TTS 需要在桌面应用中使用";

export function cloudTtsConfig(): Promise<CloudTtsConfig> {
  if (!isTauri()) return Promise.resolve({ providers: [] });
  return invoke<CloudTtsConfig>("cloud_tts_config");
}

export function cloudTtsSetConfig(
  providers: CloudTtsProvider[],
): Promise<CloudTtsConfig> {
  if (!isTauri()) return Promise.resolve({ providers });
  return invoke<CloudTtsConfig>("cloud_tts_set_config", { providers });
}

export function cloudTtsVoices(provider: CloudTtsProvider): Promise<TtsVoice[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<TtsVoice[]>("cloud_tts_voices", { provider });
}

export function cloudTtsTest(
  provider: CloudTtsProvider,
  text: string,
): Promise<CloudTtsTest> {
  if (!isTauri()) return Promise.reject(new Error(DESKTOP_ONLY));
  return invoke<CloudTtsTest>("cloud_tts_test", { provider, text });
}

export function cloudTtsSynthesize(
  providerId: string,
  items: TtsItem[],
  voice: string | null,
): Promise<TtsAudio[]> {
  if (!isTauri()) return Promise.reject(new Error(DESKTOP_ONLY));
  return invoke<TtsAudio[]>("cloud_tts_synthesize", {
    providerId,
    items,
    voice,
  });
}
