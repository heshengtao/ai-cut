/** 区间渲染：只编译窗口内的片段，输出 MP4。 */
import type { Project } from "@/types/project";
import type {
  ExportAnchor,
  ExportFit,
  ExportOptions,
  ExportQuality,
  ExportResolution,
} from "@/types/export";
import { buildExportPlan, resolveDimensions } from "./plan";
import { prepareLayers } from "./layers";
import { startExport } from "./api";

export interface RenderSegmentOptions {
  start: number;
  end: number;
  outputPath: string;
  resolution?: ExportResolution;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  fit?: ExportFit;
  fitAnchor?: ExportAnchor;
  quality?: ExportQuality;
}

export interface RenderSegmentResult {
  path: string;
  start: number;
  end: number;
  duration: number;
  width: number;
  height: number;
  warnings: string[];
}

export async function renderSegment(
  project: Project,
  options: RenderSegmentOptions,
): Promise<RenderSegmentResult> {
  const custom = options.width != null || options.height != null;
  const exportOptions: ExportOptions = {
    format: "mp4",
    resolution: custom ? "custom" : options.resolution ?? "project",
    width: options.width ?? null,
    height: options.height ?? null,
    fps: options.fps ?? null,
    quality: options.quality ?? "high",
    fit: options.fit ?? "contain",
    fitAnchor: options.fitAnchor ?? "center",
    gifColors: 256,
    gifDither: "sierra2_4a",
    gifLoop: 0,
  };

  const { width, height, fps } = resolveDimensions(project, exportOptions);
  const { textImages, effectVideos } = await prepareLayers(
    project,
    width,
    height,
    { fps, fit: exportOptions.fit, fitAnchor: exportOptions.fitAnchor },
  );
  const plan = buildExportPlan(
    project,
    exportOptions,
    textImages,
    options.outputPath,
    effectVideos,
    { start: options.start, end: options.end },
  );

  await startExport({
    inputs: plan.inputs,
    filterGraph: plan.filterGraph,
    outputArgs: plan.outputArgs,
    duration: plan.duration,
  });

  return {
    path: options.outputPath,
    start: options.start,
    end: options.end,
    duration: plan.duration,
    width,
    height,
    warnings: plan.warnings,
  };
}
