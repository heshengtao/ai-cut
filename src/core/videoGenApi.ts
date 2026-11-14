/** 视频生成（stable-diffusion.cpp）的 Tauri 封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type {
  VideoGenProgress,
  VideoGenRequest,
  VideoGenResult,
} from "@/types/videoGen";
import { EVENT_VIDEO_GEN } from "@/types/videoGen";
import { isTauri } from "@/utils/platform";

export function videoGenStart(request: VideoGenRequest): Promise<VideoGenResult> {
  // 同出图：桌面端的本地扩散后端，无头 daemon 没接。
  if (!isTauri()) return Promise.reject(new Error("AI 视频生成需要在桌面应用中使用"));
  return invoke<VideoGenResult>("video_gen_start", { request });
}

export function videoGenCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("video_gen_cancel");
}

export function videoGenBusy(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("video_gen_busy");
}

export function onVideoGenProgress(
  handler: (progress: VideoGenProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<VideoGenProgress>(EVENT_VIDEO_GEN, (event) => handler(event.payload));
}
