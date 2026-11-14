/** 图像生成 / 编辑（stable-diffusion.cpp）的 Tauri 封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type {
  ImageGenProgress,
  ImageGenRequest,
  ImageGenResult,
} from "@/types/imageGen";
import { EVENT_IMAGE_GEN } from "@/types/imageGen";
import { isTauri } from "@/utils/platform";

export function imageGenStart(request: ImageGenRequest): Promise<ImageGenResult> {
  // 出图要靠桌面端的 stable-diffusion.cpp 与模型目录，无头 daemon 里没有。
  if (!isTauri()) return Promise.reject(new Error("AI 出图需要在桌面应用中使用"));
  return invoke<ImageGenResult>("image_gen_start", { request });
}

export function imageGenCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("image_gen_cancel");
}

export function imageGenBusy(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("image_gen_busy");
}

export function onImageGenProgress(
  handler: (progress: ImageGenProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<ImageGenProgress>(EVENT_IMAGE_GEN, (event) => handler(event.payload));
}
