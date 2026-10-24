/** 导出前的图层准备：文字先渲染成透明 PNG，带 OFX 效果的片段先烘焙成中间文件。 */
import type { Project } from "@/types/project";
import type { ExportAnchor, ExportFit } from "@/types/export";
import { isVisible } from "@/core/playback/activeClips";
import { clipEffectSpecs, clipHasEffects } from "@/core/effects";
import { cacheFilePath, fileStamp, pathExists } from "@/core/media";
import { ofxBakeClip } from "@/core/ofxApi";
import { t } from "@/i18n";
import { stableHash } from "@/utils/hash";
import { dataUrlToBase64, renderTextLayerPng, textLayerName } from "./textLayer";
import { writeExportTextImage } from "./api";

export interface PreparedLayers {
  textImages: Map<string, string>;
  /** clipId → 已烘焙的 ProRes 4444 中间文件。 */
  effectVideos: Map<string, string>;
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

  return { textImages, effectVideos };
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
