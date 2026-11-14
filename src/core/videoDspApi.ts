/** 无模型视频处理的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import {
  EVENT_VIDEO_DSP,
  type VideoDspOptions,
  type VideoDspProgress,
  type VideoProcessed,
} from "@/types/video";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";

export async function videoDspProcess(
  path: string,
  start: number,
  duration: number,
  fps: number,
  options: VideoDspOptions,
): Promise<VideoProcessed> {
  await requireCapability("video_dsp", t("caps.feature.videoDsp"));
  return invoke<VideoProcessed>("video_dsp_process", {
    path,
    start,
    duration,
    fps,
    options,
  });
}

export function videoDspCancel(): Promise<void> {
  return invoke<void>("video_dsp_cancel");
}

export function onVideoDspProgress(
  handler: (progress: VideoDspProgress) => void,
): Promise<UnlistenFn> {
  return listen<VideoDspProgress>(EVENT_VIDEO_DSP, (event) => handler(event.payload));
}
