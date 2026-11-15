/** 视频生成（stable-diffusion.cpp，桌面与浏览器共用同一份 daemon 实现）。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
import type {
  VideoGenProgress,
  VideoGenRequest,
  VideoGenResult,
} from "@/types/videoGen";
import { EVENT_VIDEO_GEN } from "@/types/videoGen";

export async function videoGenStart(
  request: VideoGenRequest,
): Promise<VideoGenResult> {
  await requireCapability("video_gen", t("caps.feature.videoGen"));
  return invoke<VideoGenResult>("video_gen_start", { request });
}

export function videoGenCancel(): Promise<void> {
  return invoke<void>("video_gen_cancel");
}

export function videoGenBusy(): Promise<boolean> {
  return invoke<boolean>("video_gen_busy");
}

export function onVideoGenProgress(
  handler: (progress: VideoGenProgress) => void,
): Promise<UnlistenFn> {
  return listen<VideoGenProgress>(EVENT_VIDEO_GEN, (event) => handler(event.payload));
}
