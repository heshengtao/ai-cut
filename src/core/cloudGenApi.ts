/** 云端图像 / 视频生成的 Tauri 封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type {
  CloudGenConfig,
  CloudGenPreset,
  CloudGenProgress,
  CloudGenProvider,
  CloudGenTest,
  CloudImageRequest,
  CloudImageResult,
  CloudVideoRequest,
  CloudVideoResult,
} from "@/types/cloudGen";
import { EVENT_CLOUD_GEN } from "@/types/cloudGen";
import { isTauri } from "@/utils/platform";

const DESKTOP_ONLY = "云端生成需要在桌面应用中使用";

export function cloudGenConfig(): Promise<CloudGenConfig> {
  if (!isTauri()) return Promise.resolve({ providers: [] });
  return invoke<CloudGenConfig>("cloud_gen_config");
}

export function cloudGenSetConfig(
  providers: CloudGenProvider[],
): Promise<CloudGenConfig> {
  if (!isTauri()) return Promise.resolve({ providers });
  return invoke<CloudGenConfig>("cloud_gen_set_config", { providers });
}

export function cloudGenPresets(): Promise<CloudGenPreset[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<CloudGenPreset[]>("cloud_gen_presets");
}

export function cloudGenImage(
  request: CloudImageRequest,
): Promise<CloudImageResult> {
  if (!isTauri()) return Promise.reject(new Error(DESKTOP_ONLY));
  return invoke<CloudImageResult>("cloud_gen_image", { request });
}

export function cloudGenVideo(
  request: CloudVideoRequest,
): Promise<CloudVideoResult> {
  if (!isTauri()) return Promise.reject(new Error(DESKTOP_ONLY));
  return invoke<CloudVideoResult>("cloud_gen_video", { request });
}

export function cloudGenTest(provider: CloudGenProvider): Promise<CloudGenTest> {
  if (!isTauri()) return Promise.reject(new Error(DESKTOP_ONLY));
  return invoke<CloudGenTest>("cloud_gen_test", { provider });
}

export function cloudGenCancel(): Promise<void> {
  return invoke<void>("cloud_gen_cancel");
}

export function cloudGenBusy(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("cloud_gen_busy");
}

export function onCloudGenProgress(
  handler: (progress: CloudGenProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<CloudGenProgress>(EVENT_CLOUD_GEN, (event) => handler(event.payload));
}
