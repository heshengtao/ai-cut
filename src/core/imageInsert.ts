/** 生成图片落时间线：新开一条**最上层**轨道，在播放头放一个图片片段。 */
import type { MediaAsset, Project } from "@/types/project";
import { addAsset, addClip, addTrackAt } from "@/core/ops";
import { createClip } from "@/core/factory";
import { snapToFrame } from "@/core/time";

/** 图片没有固有长度：插入时间线时统一给 5 秒。 */
export const GENERATED_IMAGE_SECONDS = 5;

/**
 * 把画图 / 改图结果放进工程。
 *
 * 每次生成都**新开一条轨道并插到 index 0**（最上层），而不是复用已有轨道：
 * 生成图通常是叠加层 / 参考层，压在原有画面上方才不会遮住下面的剪辑；同时保留
 * 每一次生成，方便对比后自己删。
 */
export function insertGeneratedImage(
  doc: Project,
  asset: MediaAsset,
  start: number,
  trackName: string,
): Project {
  let next = addAsset(doc, asset);
  next = addTrackAt(next, 0, trackName);
  const track = next.tracks[0];
  const at = snapToFrame(Math.max(0, start), next.fps);
  return addClip(
    next,
    track.id,
    createClip({
      assetId: asset.id,
      trackId: track.id,
      start: at,
      duration: GENERATED_IMAGE_SECONDS,
    }),
  );
}
