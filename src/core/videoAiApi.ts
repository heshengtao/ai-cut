/** 视频 AI 的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  EVENT_VIDEO_AI,
  type VideoAiAspect,
  type VideoAiProgress,
  type VideoAiSubject,
  type VideoProcessed,
} from "@/types/video";
import { isTauri } from "@/utils/platform";

export function videoAiUpscale(
  path: string,
  start: number,
  duration: number,
  fps: number,
  modelId: string,
  scale: number,
): Promise<VideoProcessed> {
  if (!isTauri()) return Promise.reject(new Error("视频超分需要在桌面应用中使用"));
  return invoke<VideoProcessed>("video_ai_upscale", {
    path,
    start,
    duration,
    fps,
    modelId,
    scale,
  });
}

export function videoAiInterpolate(
  path: string,
  start: number,
  duration: number,
  fps: number,
  modelId: string,
  factor: number,
): Promise<VideoProcessed> {
  if (!isTauri()) return Promise.reject(new Error("视频补帧需要在桌面应用中使用"));
  return invoke<VideoProcessed>("video_ai_interpolate", {
    path,
    start,
    duration,
    fps,
    modelId,
    factor,
  });
}

export function videoAiReframe(
  path: string,
  start: number,
  duration: number,
  fps: number,
  yoloModelId: string | null,
  yunetModelId: string | null,
  subject: VideoAiSubject,
  aspect: VideoAiAspect,
  height: number,
  smooth: number,
): Promise<VideoProcessed> {
  if (!isTauri()) return Promise.reject(new Error("智能裁剪需要在桌面应用中使用"));
  return invoke<VideoProcessed>("video_ai_reframe", {
    path,
    start,
    duration,
    fps,
    yoloModelId,
    yunetModelId,
    subject,
    aspect,
    height,
    smooth,
  });
}

export function videoAiCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("video_ai_cancel");
}

export function onVideoAiProgress(
  handler: (progress: VideoAiProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<VideoAiProgress>(EVENT_VIDEO_AI, (event) => handler(event.payload));
}
