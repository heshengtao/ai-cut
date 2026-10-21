/** 无模型视频处理的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  EVENT_VIDEO_DSP,
  type VideoDspOptions,
  type VideoDspProgress,
  type VideoProcessed,
} from "@/types/video";
import { isTauri } from "@/utils/platform";

export function videoDspProcess(
  path: string,
  start: number,
  duration: number,
  fps: number,
  options: VideoDspOptions,
): Promise<VideoProcessed> {
  if (!isTauri()) return Promise.reject(new Error("视频处理需要在桌面应用中使用"));
  return invoke<VideoProcessed>("video_dsp_process", {
    path,
    start,
    duration,
    fps,
    options,
  });
}

export function videoDspCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("video_dsp_cancel");
}

export function onVideoDspProgress(
  handler: (progress: VideoDspProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<VideoDspProgress>(EVENT_VIDEO_DSP, (event) => handler(event.payload));
}
