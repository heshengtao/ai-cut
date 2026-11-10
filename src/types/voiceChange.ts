/** 离线变声：请求 / 结果 / 音色 / 进度。 */

export interface VcClipRequest {
  clipId: string;
  path: string;
  start: number;
  duration: number;
}

export interface VcClipResult {
  clipId: string;
  path: string;
  duration: number;
}

export interface VoiceSource {
  assetId?: string | null;
  name: string;
}

export interface VoiceEntry {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  source: VoiceSource;
}

export type VoiceState = "decoding" | "processing" | "writing" | "done" | "error";

export interface VoiceProgress {
  state: VoiceState;
  progress: number;
  index: number;
  total: number;
  message: string | null;
}

export const EVENT_VOICE = "voice-change-progress";
