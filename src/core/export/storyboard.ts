/** 多帧自检：按时间点连续渲染 PNG，供 agent 快速查看时间线。 */
import { join } from "@tauri-apps/api/path";
import type { Project } from "@/types/project";
import {
  renderFrame,
  type RenderFrameOptions,
  type RenderFrameResult,
} from "./frame";

export interface RenderStoryboardOptions {
  times: number[];
  outputDir: string;
  prefix?: string;
  resolution?: RenderFrameOptions["resolution"];
  width?: number | null;
  height?: number | null;
  fit?: RenderFrameOptions["fit"];
  fitAnchor?: RenderFrameOptions["fitAnchor"];
  fps?: number | null;
}

export interface RenderStoryboardResult {
  frames: RenderFrameResult[];
}

export async function renderStoryboard(
  project: Project,
  options: RenderStoryboardOptions,
): Promise<RenderStoryboardResult> {
  if (options.times.length === 0) throw new Error("times 不能为空");
  const prefix = options.prefix?.trim() || "frame";
  const frames: RenderFrameResult[] = [];

  for (let index = 0; index < options.times.length; index += 1) {
    const name = `${prefix}-${String(index + 1).padStart(3, "0")}.png`;
    const outputPath = await join(options.outputDir, name);
    frames.push(
      await renderFrame(project, {
        time: options.times[index],
        outputPath,
        resolution: options.resolution,
        width: options.width,
        height: options.height,
        fit: options.fit,
        fitAnchor: options.fitAnchor,
        fps: options.fps,
      }),
    );
  }

  return { frames };
}
