/** 视频 AI 的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import {
  EVENT_VIDEO_AI,
  type VideoAiAspect,
  type VideoAiProgress,
  type VideoAiSubject,
  type VideoProcessed,
} from "@/types/video";

export function videoAiUpscale(
  path: string,
  start: number,
  duration: number,
  fps: number,
  modelId: string,
  scale: number,
): Promise<VideoProcessed> {
  return invoke<VideoProcessed>("video_ai_upscale", {
    path,
    start,
    duration,
    fps,
    modelId,
    scale,
  });
}

export function videoAiUpscaleImage(
  path: string,
  modelId: string,
  scale: number,
): Promise<VideoProcessed> {
  return invoke<VideoProcessed>("video_ai_upscale_image", {
    path,
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
  return invoke<void>("video_ai_cancel");
}

export function onVideoAiProgress(
  handler: (progress: VideoAiProgress) => void,
): Promise<UnlistenFn> {
  return listen<VideoAiProgress>(EVENT_VIDEO_AI, (event) => handler(event.payload));
}
