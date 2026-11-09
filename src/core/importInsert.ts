/**
 * 导入即上时间线：把刚导入的素材按导入顺序铺到播放头之后。
 *
 * 规则与媒体库双击插入一致：优先复用第一条未锁定轨道，没有就新建；
 * 图片没有固有长度，给固定秒数；音视频按完整源时长。片段之间用
 * `placeWithoutOverlap` 顺延，互不重叠。
 */
import type { MediaAsset, Project } from "@/types/project";
import { addClip, addTrack } from "@/core/ops";
import { createClip } from "@/core/factory";
import { placeWithoutOverlap } from "@/core/timelinePlacement";

/** 图片没有固有长度：与媒体库双击插入保持一致。 */
export const IMPORTED_IMAGE_SECONDS = 15;

export interface ImportInsertResult {
  doc: Project;
  /** 新插入的片段 id，按导入顺序。 */
  clipIds: string[];
}

/**
 * 在 `start`（通常是播放头）处依次放下这些素材。
 *
 * 时长未知（探测失败 / 空文件）的素材只留在媒体库，不往时间线上放；
 * 一个都放不下时原样返回文档，调用方据此决定提示文案。
 */
export function insertImportedAssets(
  doc: Project,
  assets: MediaAsset[],
  start: number,
): ImportInsertResult {
  let next = doc;
  const clipIds: string[] = [];

  for (const asset of assets) {
    const duration = asset.kind === "image" ? IMPORTED_IMAGE_SECONDS : asset.duration;
    if (!(duration > 0)) continue;

    let track = next.tracks.find((candidate) => !candidate.locked);
    if (!track) {
      next = addTrack(next);
      track = next.tracks[next.tracks.length - 1];
    }

    const at = placeWithoutOverlap(start, duration, track.clips, next.fps);
    const clip = createClip({
      assetId: asset.id,
      trackId: track.id,
      start: at,
      duration,
    });
    clipIds.push(clip.id);
    next = addClip(next, track.id, clip);
  }

  return { doc: next, clipIds };
}
