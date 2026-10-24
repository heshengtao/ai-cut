/** 缩略图补全：agent 通过 MCP / film.json 导入的素材可能只有元数据。 */
import { cacheFilePath, makeThumbnail } from "@/core/media";
import type { MediaAsset } from "@/types/project";

/** 正在生成的素材 id，避免媒体库与时间线重复触发。 */
const inflight = new Set<string>();
/** 本次会话生成过的缩略图：文档被撤销 / 重载替换时直接复用。 */
const cache = new Map<string, string>();
/** 失败过的「素材 id + 源路径」：避免每次文档变更都重新跑一次 ffmpeg。 */
const failed = new Set<string>();

function attemptKey(asset: MediaAsset): string {
  return `${asset.id}\u0000${asset.src}`;
}

/** 取本次会话已生成的缩略图（没有则 undefined）。 */
export function cachedThumbnail(assetId: string): string | undefined {
  return cache.get(assetId);
}

/** 需要补缩略图的素材：只有视频有画面，图片用原图、音频无画面。 */
export function needsThumbnail(asset: MediaAsset): boolean {
  return asset.kind === "video" && !asset.offline && !asset.thumb;
}

/** 按需生成缩略图（兼容 agent 导入与旧工程）。失败时静默忽略。 */
export async function ensureThumbnail(
  asset: MediaAsset,
  apply: (thumb: string) => void,
): Promise<void> {
  if (!needsThumbnail(asset) || inflight.has(asset.id) || failed.has(attemptKey(asset))) return;

  // 文档被撤销 / 重新载入后 thumb 字段可能丢失：直接复用本次会话的缓存。
  const cached = cache.get(asset.id);
  if (cached) {
    apply(cached);
    return;
  }

  inflight.add(asset.id);
  let thumb: string;
  try {
    const atSec = Math.min(1, Math.max(0, asset.duration) / 2);
    const name = await makeThumbnail(asset.src, asset.id, atSec);
    thumb = await cacheFilePath(name);
  } catch {
    failed.add(attemptKey(asset));
    return;
  } finally {
    inflight.delete(asset.id);
  }
  cache.set(asset.id, thumb);
  apply(thumb);
}
