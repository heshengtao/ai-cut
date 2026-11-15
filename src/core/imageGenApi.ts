/** 图像生成 / 编辑（stable-diffusion.cpp，桌面与浏览器共用同一份 daemon 实现）。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
import type {
  ImageGenProgress,
  ImageGenRequest,
  ImageGenResult,
} from "@/types/imageGen";
import { EVENT_IMAGE_GEN } from "@/types/imageGen";

export async function imageGenStart(
  request: ImageGenRequest,
): Promise<ImageGenResult> {
  await requireCapability("image_gen", t("caps.feature.imageGen"));
  return invoke<ImageGenResult>("image_gen_start", { request });
}

export function imageGenCancel(): Promise<void> {
  return invoke<void>("image_gen_cancel");
}

export function imageGenBusy(): Promise<boolean> {
  return invoke<boolean>("image_gen_busy");
}

export function onImageGenProgress(
  handler: (progress: ImageGenProgress) => void,
): Promise<UnlistenFn> {
  return listen<ImageGenProgress>(EVENT_IMAGE_GEN, (event) => handler(event.payload));
}
