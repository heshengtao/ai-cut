/** 视频处理结果落回时间线的纯函数。 */
import type { Project } from "@/types/project";
import { updateClip } from "@/core/ops/clips";

/**
 * 用处理后的新素材替换片段引用；入点归零，时长不超过新素材。
 *
 * 处理结果本身已经是从原片段入点开始的区间，所以替换后从 0 开始是最直接的映射。
 */
export function replaceClipVideo(
  doc: Project,
  clipId: string,
  assetId: string,
  assetDuration: number,
  clipDuration: number,
): Project {
  const duration =
    assetDuration > 0 ? Math.min(clipDuration, assetDuration) : clipDuration;
  return updateClip(doc, clipId, { assetId, in: 0, duration });
}
