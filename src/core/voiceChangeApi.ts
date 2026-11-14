/** 离线变声的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type {
  VcClipRequest,
  VcClipResult,
  VoiceEntry,
  VoiceProgress,
} from "@/types/voiceChange";
import { EVENT_VOICE } from "@/types/voiceChange";
import { isTauri } from "@/utils/platform";

function guard<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error(`${label}需要在桌面应用中使用`));
  return run();
}

export function convertVoiceBatch(
  clips: VcClipRequest[],
  voiceId: string,
  modelId: string,
): Promise<VcClipResult[]> {
  return guard("AI 变声", () =>
    invoke<VcClipResult[]>("voice_change_convert", { clips, voiceId, modelId }),
  );
}

export function cancelVoiceChange(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("voice_change_cancel");
}

export function listVoices(): Promise<VoiceEntry[]> {
  return guard("读取音色库", () => invoke<VoiceEntry[]>("voice_change_voice_list"));
}

export function importVoice(
  assetPath: string,
  name: string,
  start: number | null = null,
  duration: number | null = null,
): Promise<VoiceEntry> {
  return guard("导入音色", () =>
    invoke<VoiceEntry>("voice_change_voice_import", {
      assetPath,
      name,
      start,
      duration,
    }),
  );
}

export function deleteVoice(id: string): Promise<void> {
  return guard("删除音色", () => invoke<void>("voice_change_voice_delete", { id }));
}

export function onVoiceProgress(
  handler: (payload: VoiceProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<VoiceProgress>(EVENT_VOICE, (event) => handler(event.payload));
}
