/**
 * 云端图像 / 视频生成的调用封装。
 *
 * 实现已下沉到 `crates/daemon`（纯 HTTP + ffmpeg 探测 + 缓存目录），浏览器 / 容器
 * 版本同样可用。这里不再用 `isTauri()` 猜，只有能力表守卫（桌面壳恒可用）。
 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
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

export function cloudGenConfig(): Promise<CloudGenConfig> {
  return invoke<CloudGenConfig>("cloud_gen_config");
}

export function cloudGenSetConfig(
  providers: CloudGenProvider[],
): Promise<CloudGenConfig> {
  return invoke<CloudGenConfig>("cloud_gen_set_config", { providers });
}

export function cloudGenPresets(): Promise<CloudGenPreset[]> {
  return invoke<CloudGenPreset[]>("cloud_gen_presets");
}

export async function cloudGenImage(
  request: CloudImageRequest,
): Promise<CloudImageResult> {
  await requireCapability("cloud_gen", t("caps.feature.cloudGen"));
  return invoke<CloudImageResult>("cloud_gen_image", { request });
}

export async function cloudGenVideo(
  request: CloudVideoRequest,
): Promise<CloudVideoResult> {
  await requireCapability("cloud_gen", t("caps.feature.cloudGen"));
  return invoke<CloudVideoResult>("cloud_gen_video", { request });
}

export async function cloudGenTest(
  provider: CloudGenProvider,
): Promise<CloudGenTest> {
  await requireCapability("cloud_gen", t("caps.feature.cloudGen"));
  return invoke<CloudGenTest>("cloud_gen_test", { provider });
}

export function cloudGenCancel(): Promise<void> {
  return invoke<void>("cloud_gen_cancel");
}

export function cloudGenBusy(): Promise<boolean> {
  return invoke<boolean>("cloud_gen_busy");
}

/** 进度事件：桌面走 Tauri event，浏览器走 SSE，同一套事件名。 */
export function onCloudGenProgress(
  handler: (progress: CloudGenProgress) => void,
): Promise<UnlistenFn> {
  return listen<CloudGenProgress>(EVENT_CLOUD_GEN, (event) => handler(event.payload));
}
