/** OFX host 的 Tauri 封装。浏览器环境返回空 / 报错，不阻塞界面。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  OfxBakeProgress,
  OfxBakeRequest,
  OfxEffectSpec,
  OfxFrame,
  OfxPluginInfo,
} from "@/types/plugins";
import { EVENT_OFX_BAKE } from "@/types/plugins";
import { isTauri } from "@/utils/platform";

export function ofxProbe(
  bundle: string,
  plugin?: string | null,
  context?: string | null,
): Promise<OfxPluginInfo[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<OfxPluginInfo[]>("ofx_probe", {
    bundle,
    plugin: plugin ?? null,
    context: context ?? null,
  });
}

export interface OfxRenderFrameArgs {
  bundle: string;
  plugin: string;
  context?: string | null;
  width: number;
  height: number;
  time: number;
  rgbaBase64: string;
  params?: Record<string, unknown> | null;
}

/** 渲染一张已经解码好的 RGBA 帧（base64），返回 PNG。 */
export function ofxRenderFrame(args: OfxRenderFrameArgs): Promise<OfxFrame> {
  if (!isTauri()) return Promise.reject(new Error("OFX 渲染需要在桌面应用中使用"));
  return invoke<OfxFrame>("ofx_render_frame", { ...args });
}

export interface OfxRenderPreviewArgs {
  source: string;
  sourceTime: number;
  time: number;
  width: number;
  height: number;
  isImage: boolean;
  fit?: "contain" | "cover" | "stretch";
  effects: OfxEffectSpec[];
}

/** 用 ffmpeg 取一帧，跑完效果链后返回 PNG。 */
export function ofxRenderPreview(args: OfxRenderPreviewArgs): Promise<OfxFrame> {
  if (!isTauri()) return Promise.reject(new Error("OFX 预览需要在桌面应用中使用"));
  return invoke<OfxFrame>("ofx_render_preview", { ...args });
}

/** 把片段烘焙成 ProRes 4444（导出）或 H.264（预览），供当作普通视频源使用。 */
export function ofxBakeClip(request: OfxBakeRequest): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error("OFX 导出需要在桌面应用中使用"));
  return invoke<string>("ofx_bake_clip", { request });
}

/** 取消指定 id 的烘焙（下一个帧边界生效）。 */
export function ofxCancelBake(id: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("ofx_cancel_bake", { id });
}

export function onOfxBakeProgress(
  handler: (progress: OfxBakeProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<OfxBakeProgress>(EVENT_OFX_BAKE, (event) => handler(event.payload));
}
