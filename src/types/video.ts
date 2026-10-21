/** 无模型视频处理的类型与事件协议。 */

export type VideoStrength = "light" | "medium" | "strong";

/** 处理项；未出现的字段表示关闭。 */
export interface VideoDspOptions {
  stabilize?: VideoStrength;
  denoise?: VideoStrength;
  deflicker?: VideoStrength;
  /** 0..1；0 表示关闭。 */
  motionBlur?: number;
  /** 1.0 表示关闭；1.5 / 2.0 为放大倍数。 */
  upscale?: number;
}

export type VideoDspState = "idle" | "processing" | "done" | "error";

export interface VideoDspProgress {
  /** `processing` / `done` / `error`。 */
  state: string;
  progress: number;
  message: string | null;
}

export interface VideoProcessed {
  path: string;
  duration: number;
}

/** 视频处理进度事件名（与 Rust 侧一致）。 */
export const EVENT_VIDEO_DSP = "video-dsp-progress";

export type VideoAiState = "idle" | "processing" | "done" | "error";
export type VideoAiSubject = "face" | "person" | "auto" | "center";
export type VideoAiAspect = "9:16" | "1:1" | "16:9" | "source";

export interface VideoAiProgress {
  /** `processing` / `done` / `error`。 */
  state: string;
  progress: number;
  message: string | null;
}

/** 视频 AI 进度事件名（与 Rust 侧一致）。 */
export const EVENT_VIDEO_AI = "video-ai-progress";
