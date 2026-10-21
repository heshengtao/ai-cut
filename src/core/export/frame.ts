/** 时间线静帧渲染：复用导出滤镜，只输出指定时间的一帧 PNG。 */
import type {
  ExportAnchor,
  ExportFit,
  ExportOptions,
  ExportResolution,
} from "@/types/export";
import type { Project } from "@/types/project";
import { isVisible } from "@/core/playback/activeClips";
import { t } from "@/i18n";
import { buildExportPlan, resolveDimensions } from "./plan";
import { dataUrlToBase64, renderTextLayerPng, textLayerName } from "./textLayer";
import { maskLayerName, renderMaskLayerPng } from "./maskLayer";
import { startExport, writeExportTextImage } from "./api";

export interface RenderFrameOptions {
  time: number;
  outputPath: string;
  resolution?: ExportResolution;
  /** 给出任意一边即按自定义尺寸渲染。 */
  width?: number | null;
  height?: number | null;
  fit?: ExportFit;
  fitAnchor?: ExportAnchor;
  fps?: number | null;
}

export interface RenderFrameResult {
  path: string;
  time: number;
  width: number;
  height: number;
  duration: number;
}

export async function renderFrame(
  project: Project,
  options: RenderFrameOptions,
): Promise<RenderFrameResult> {
  if (!options.outputPath.trim()) throw new Error(t("export.frameNoOutput"));

  const custom = options.width != null || options.height != null;
  const exportOptions: ExportOptions = {
    format: "mp4",
    resolution: custom ? "custom" : options.resolution ?? "project",
    width: options.width ?? null,
    height: options.height ?? null,
    fps: options.fps ?? null,
    quality: "high",
    fit: options.fit ?? "contain",
    fitAnchor: options.fitAnchor ?? "center",
    gifColors: 256,
    gifDither: "sierra2_4a",
    gifLoop: 0,
  };
  const { width, height } = resolveDimensions(project, exportOptions);

  const textImages = new Map<string, string>();
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      const text = (clip.text ?? "").trim();
      if (text === "" || !(clip.duration > 0)) continue;
      const dataUrl = renderTextLayerPng(clip, width, height, project.height);
      if (!dataUrl) throw new Error(t("export.frameTextFailed"));
      const imagePath = await writeExportTextImage(
        textLayerName(clip.id, width, height),
        dataUrlToBase64(dataUrl),
      );
      textImages.set(clip.id, imagePath);
    }
  }

  const maskImages = new Map<string, string>();
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      if (!clip.mask) continue;
      const dataUrl = renderMaskLayerPng(clip, width, height);
      if (!dataUrl) continue;
      const imagePath = await writeExportTextImage(
        maskLayerName(clip.id),
        dataUrlToBase64(dataUrl),
      );
      maskImages.set(clip.id, imagePath);
    }
  }

  const plan = buildExportPlan(project, exportOptions, textImages, options.outputPath, maskImages);
  if (!(options.time >= 0 && options.time <= plan.duration)) {
    throw new Error(t("export.frameTimeInvalid"));
  }
  const at = Math.min(options.time, Math.max(0, plan.duration - 1 / plan.fps));

  const mapIndex = plan.outputArgs.indexOf("-map");
  const videoLabel = mapIndex >= 0 ? plan.outputArgs[mapIndex + 1] : null;
  if (!videoLabel) throw new Error(t("export.frameNoVideo"));

  await startExport({
    inputs: plan.inputs,
    filterGraph: plan.filterGraph,
    outputArgs: [
      "-map",
      videoLabel,
      "-an",
      "-ss",
      String(at),
      "-frames:v",
      "1",
      "-update",
      "1",
      options.outputPath,
    ],
    duration: Math.max(0.001, at + 1 / plan.fps),
  });

  return { path: options.outputPath, time: at, width, height, duration: plan.duration };
}
