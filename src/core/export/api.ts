/** 导出相关的 Tauri 命令与事件封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ExportProgress } from "@/types/export";

export interface ExportJob {
  inputs: string[];
  filterGraph: string;
  outputArgs: string[];
  duration: number;
}

/** 启动导出，直到 ffmpeg 结束（或取消）才 resolve。 */
export function startExport(job: ExportJob): Promise<void> {
  return invoke<void>("export_video", { job });
}

export function cancelExport(): Promise<void> {
  return invoke<void>("cancel_export");
}

/** 把 Canvas 渲染出的 PNG 写入缓存目录，返回绝对路径。 */
export function writeExportTextImage(name: string, base64: string): Promise<string> {
  return invoke<string>("write_export_text_image", { name, base64 });
}

/** 订阅导出进度事件。 */
export function onExportProgress(
  handler: (progress: ExportProgress) => void,
): Promise<UnlistenFn> {
  return listen<ExportProgress>("export-progress", (event) => handler(event.payload));
}
