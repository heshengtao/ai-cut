/** MiniMax-H3 视频生成：请求、进度、结果。 */

export interface VideoGenRequest {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  seconds?: number;
  frames?: number;
  steps: number;
  seed: number;
  cfgScale: number;
  flowShift: number;
  offloadToCpu?: boolean;
  vaeTiling?: boolean;
}

export interface VideoGenProgress {
  state: "preparing" | "running" | "done" | "error" | "cancelled";
  message: string | null;
  /** 0..1；没有可解析的 step 时是 0。 */
  progress: number;
  elapsed: number;
  step?: number | null;
  totalSteps?: number | null;
}

export interface VideoGenResult {
  path: string;
  duration: number;
  width: number;
  height: number;
  frames: number;
}

export const EVENT_VIDEO_GEN = "video-gen-progress";

/** H3 的帧数网格：17k + 5。 */
export function alignFrames(frames: number): number {
  const value = Math.max(5, Math.round(frames));
  const remainder = (value - 5) % 17;
  return remainder === 0 ? value : value + 17 - remainder;
}

/** 秒数 → 网格帧数（10 秒 = 243 帧 = 10.125s）。 */
export function framesForSeconds(seconds: number): number {
  return alignFrames(Math.max(0, seconds) * 24);
}
