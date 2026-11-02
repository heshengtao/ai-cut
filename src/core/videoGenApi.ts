/** MiniMax-H3 视频生成的 Tauri 封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  VideoGenProgress,
  VideoGenRequest,
  VideoGenResult,
} from "@/types/videoGen";
import { EVENT_VIDEO_GEN } from "@/types/videoGen";
import { isTauri } from "@/utils/platform";

export function videoGenStart(request: VideoGenRequest): Promise<VideoGenResult> {
  return invoke<VideoGenResult>("video_gen_start", { request });
}

export function videoGenCancel(): Promise<void> {
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
