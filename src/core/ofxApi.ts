/** OFX host 的 Tauri 封装。浏览器环境返回空 / 报错，不阻塞界面。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  OfxBakeProgress,
  OfxBakeImageRequest,
  OfxBakeRequest,
  OfxBakeTransitionRequest,
  OfxEffectSpec,
  OfxFrame,
  OfxPluginInfo,
  OfxTransitionSource,
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
  fps?: number;
  /** 片段时长（秒），供 retimer / transition 感知时基。 */
  duration?: number;
  /** Retimer：本次已解码帧对应的插件 SourceTime。 */
  retimerSourceTime?: number | null;
  effects: OfxEffectSpec[];
}

/** 用 ffmpeg 取一帧，跑完效果链后返回 PNG。 */
export function ofxRenderPreview(args: OfxRenderPreviewArgs): Promise<OfxFrame> {
  if (!isTauri()) return Promise.reject(new Error("OFX 预览需要在桌面应用中使用"));
  return invoke<OfxFrame>("ofx_render_preview", { ...args });
}

export interface OfxRenderTransitionArgs {
  bundle: string;
  plugin: string;
  context?: string | null;
  params?: Record<string, unknown> | null;
  from: OfxTransitionSource | null;
  to: OfxTransitionSource | null;
  timelineTime: number;
  progress: number;
  duration: number;
  width: number;
  height: number;
  fps?: number;
  fit?: "contain" | "cover" | "stretch";
}

export interface OfxSourceTimeArgs {
  bundle: string;
  plugin: string;
  context?: string | null;
  time: number;
  duration?: number | null;
  fps?: number | null;
  width?: number | null;
  height?: number | null;
  params?: Record<string, unknown> | null;
}

/** Retimer：问插件某个输出时间需要哪一帧源素材。 */
export function ofxSourceTime(args: OfxSourceTimeArgs): Promise<number> {
  if (!isTauri()) return Promise.reject(new Error("OFX SourceTime 需要在桌面应用中使用"));
  return invoke<number>("ofx_source_time", { ...args });
}

/** 渲染一张转场画面（两路已解码源）。 */
export function ofxRenderTransition(args: OfxRenderTransitionArgs): Promise<OfxFrame> {
  if (!isTauri()) return Promise.reject(new Error("OFX 转场需要在桌面应用中使用"));
  return invoke<OfxFrame>("ofx_render_transition", { ...args });
}

/** 把转场烘焙成独立的叠加视频。 */
export function ofxBakeTransition(
  request: OfxBakeTransitionRequest,
): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error("OFX 转场导出需要在桌面应用中使用"));
  return invoke<string>("ofx_bake_transition", { request });
}

/** 把图片片段烘焙成带效果的 PNG 预览（缓存文件，播放时也能常驻显示）。 */
export function ofxBakeImage(request: OfxBakeImageRequest): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error("OFX 图片预览需要在桌面应用中使用"));
  return invoke<string>("ofx_bake_image", { request });
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
