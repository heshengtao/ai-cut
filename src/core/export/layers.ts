/** 导出前的图层准备：文字先渲染成透明 PNG，带 OFX 效果的片段先烘焙成中间文件。 */
import type { Project } from "@/types/project";
import type { ExportAnchor, ExportFit } from "@/types/export";
import { isVisible } from "@/core/playback/activeClips";
import { clipEffectSpecs, clipHasEffects } from "@/core/effects";
import { cacheFilePath, fileStamp, pathExists } from "@/core/media";
import { ofxBakeClip, ofxBakeTransition } from "@/core/ofxApi";
import { ofxTransitionRange, type OfxTransitionSide } from "@/core/ofxTransition";
import { t } from "@/i18n";
import { stableHash } from "@/utils/hash";
import { dataUrlToBase64, renderTextLayerPng, textLayerName } from "./textLayer";
import { writeExportTextImage } from "./api";

export interface PreparedTransitionVideo {
  path: string;
  /** 时间线上的转场起点。 */
  start: number;
  duration: number;
}

export interface PreparedLayers {
  textImages: Map<string, string>;
  /** clipId → 已烘焙的 ProRes 4444 中间文件。 */
  effectVideos: Map<string, string>;
  /** `${clipId}:${edge}` → 已烘焙的转场叠加视频。 */
  transitionVideos: Map<string, PreparedTransitionVideo>;
}

export interface PrepareLayersOptions {
  fps?: number;
  fit?: ExportFit;
  fitAnchor?: ExportAnchor;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function needsTextLayer(project: Project): boolean {
  return project.tracks.some(
    (track) =>
      isVisible(track) &&
      track.clips.some((clip) => (clip.text ?? "").trim() !== "" && clip.duration > 0),
  );
}

export async function prepareLayers(
  project: Project,
  width: number,
  height: number,
  options: PrepareLayersOptions = {},
): Promise<PreparedLayers> {
  const textImages = new Map<string, string>();
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      const text = (clip.text ?? "").trim();
      if (text === "" || !(clip.duration > 0)) continue;
      const dataUrl = renderTextLayerPng(clip, width, height, project.height);
      if (!dataUrl) throw new Error(t("export.textRenderFailed"));
      const imagePath = await writeExportTextImage(
        textLayerName(clip.id, width, height),
        dataUrlToBase64(dataUrl),
      );
      textImages.set(clip.id, imagePath);
    }
  }

  const effectVideos = await prepareEffectVideos(
    project,
    width,
    height,
    options.fps ?? project.fps,
    options.fit ?? "contain",
    options.fitAnchor ?? "center",
  );
  const transitionVideos = await prepareTransitionVideos(
    project,
    width,
    height,
    options.fps ?? project.fps,
    options.fit ?? "contain",
    effectVideos,
  );

  return { textImages, effectVideos, transitionVideos };
}

/** 把带 OFX 效果的片段烘焙成 ProRes 4444；无效果时返回空 Map。 */
async function prepareEffectVideos(
  project: Project,
  width: number,
  height: number,
  fps: number,
  fit: ExportFit,
  fitAnchor: ExportAnchor,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      if (!(clip.duration > 0) || clip.audioOnly) continue;
      if (!clipHasEffects(clip)) continue;
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (!asset || (asset.kind !== "video" && asset.kind !== "image")) continue;
      if (asset.offline) {
        throw new Error(t("export.offlineAsset", { name: asset.name }));
      }

      const effects = clipEffectSpecs(clip);
      if (effects.length === 0) continue;
      const stamp = await fileStamp(asset.src);
      const key = stableHash(
        JSON.stringify({
          clip: clip.id,
          source: asset.src,
          in: clip.in ?? 0,
          duration: clip.duration,
          speed: clip.speed ?? 1,
          width,
          height,
          fps,
          fit,
          fitAnchor,
          stamp,
          effects,
        }),
      );
      const output = await cacheFilePath(
        `ofx-${safeId(clip.id)}-${key}.mov`,
      );
      if (await pathExists(output)) {
        out.set(clip.id, output);
        continue;
      }

      try {
        await ofxBakeClip({
          source: asset.src,
          sourceIn: clip.in ?? 0,
          duration: clip.duration,
          speed: clip.speed ?? 1,
          fps,
          width,
          height,
          isImage: asset.kind === "image",
          sourceDuration: asset.duration,
          fit,
          fitAnchor,
          timeOffset: 0,
          effects,
          output,
        });
        out.set(clip.id, output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`片段 ${clip.id} 的 OFX 效果烘焙失败：${message}`);
      }
    }
  }
  return out;
}

/** 转场一侧的烘焙源：优先使用已渲染好的片段效果视频，保证转场吃的是最终画面。 */
function transitionSourceArgs(
  side: OfxTransitionSide,
  effectVideos: ReadonlyMap<string, string>,
): {
  source: string;
  sourceIn: number;
  start: number;
  speed: number;
  assetDuration: number;
  isImage: boolean;
} {
  const baked = effectVideos.get(side.clip.id);
  if (baked) {
    return {
      source: baked,
      sourceIn: 0,
      start: side.clip.start,
      speed: 1,
      assetDuration: side.clip.duration,
      isImage: false,
    };
  }
  const asset = side.asset;
  if (!asset) throw new Error(`转场片段 ${side.clip.id} 缺少素材`);
  if (asset.offline) throw new Error(t("export.offlineAsset", { name: asset.name }));
  return {
    source: asset.src,
    sourceIn: side.clip.in ?? 0,
    start: side.clip.start,
    speed: side.clip.speed ?? 1,
    assetDuration: asset.duration > 0 ? asset.duration : 0,
    isImage: asset.kind === "image",
  };
}

/** 把每个 OFX 转场烘焙成独立的整帧叠加视频。 */
async function prepareTransitionVideos(
  project: Project,
  width: number,
  height: number,
  fps: number,
  fit: ExportFit,
  effectVideos: ReadonlyMap<string, string>,
): Promise<Map<string, PreparedTransitionVideo>> {
  const out = new Map<string, PreparedTransitionVideo>();
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      for (const edge of ["in", "out"] as const) {
        const range = ofxTransitionRange(project, track.id, clip, edge);
        if (!range) continue;
        const from = range.from ? transitionSourceArgs(range.from, effectVideos) : null;
        const to = range.to ? transitionSourceArgs(range.to, effectVideos) : null;
        if (!from && !to) continue;
        const stamp = await Promise.all(
          [range.from, range.to]
            .filter((side): side is OfxTransitionSide => Boolean(side?.asset))
            .map((side) => fileStamp(side.asset!.src)),
        );
        const key = stableHash(
          JSON.stringify({
            clip: range.clipId,
            edge,
            start: range.start,
            duration: range.duration,
            width,
            height,
            fps,
            fit,
            effect: range.effect,
            from,
            to,
            stamp,
          }),
        );
        const output = await cacheFilePath(
          `ofx-transition-${safeId(range.clipId)}-${edge}-${key}.mov`,
        );
        const entry = { path: output, start: range.start, duration: range.duration };
        if (await pathExists(output)) {
          out.set(`${range.clipId}:${edge}`, entry);
          continue;
        }
        try {
          await ofxBakeTransition({
            preview: false,
            bundle: range.effect.bundle,
            plugin: range.effect.plugin,
            context: range.effect.context ?? "OfxImageEffectContextTransition",
            params: { ...range.effect.params },
            from,
            to,
            start: range.start,
            duration: range.duration,
            fps,
            width,
            height,
            fit,
            output,
          });
          out.set(`${range.clipId}:${edge}`, entry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`转场 ${range.clipId}:${edge} 烘焙失败：${message}`);
        }
      }
    }
  }
  return out;
}
