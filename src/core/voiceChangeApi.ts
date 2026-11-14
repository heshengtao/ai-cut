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

export function convertVoiceBatch(
  clips: VcClipRequest[],
  voiceId: string,
  modelId: string,
): Promise<VcClipResult[]> {
  return invoke<VcClipResult[]>("voice_change_convert", { clips, voiceId, modelId });
}

export function cancelVoiceChange(): Promise<void> {
  return invoke<void>("voice_change_cancel");
}

export function listVoices(): Promise<VoiceEntry[]> {
  return invoke<VoiceEntry[]>("voice_change_voice_list");
}

export function importVoice(
  assetPath: string,
  name: string,
  start: number | null = null,
  duration: number | null = null,
): Promise<VoiceEntry> {
  return invoke<VoiceEntry>("voice_change_voice_import", {
    assetPath,
    name,
    start,
    duration,
  });
}

export function deleteVoice(id: string): Promise<void> {
  return invoke<void>("voice_change_voice_delete", { id });
}

export function onVoiceProgress(
  handler: (payload: VoiceProgress) => void,
): Promise<UnlistenFn> {
  return listen<VoiceProgress>(EVENT_VOICE, (event) => handler(event.payload));
}
