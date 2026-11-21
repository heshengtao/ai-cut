/**
 * 剧集画布的会话级位置缓存。
 *
 * 为什么不是只存在组件里：切到预览 / 画布再回来，`SeriesGraph` 会重新挂载；如果位置缓存
 * 跟着组件走，没有手动坐标的卡片就会重新自动分层，和用户刚才看到的排布对不上（表现为
 * 「切换视图后节点排列乱了」）。按 episode id 存（id 全局唯一），跨视图切换保留。
 */
import type { SeriesPosition } from "./layout";

const cache = new Map<string, SeriesPosition>();

export function cachedSeriesPosition(episodeId: string): SeriesPosition | undefined {
  return cache.get(episodeId);
}

export function setSeriesPosition(episodeId: string, position: SeriesPosition): void {
  cache.set(episodeId, position);
}

/** 只保留仍然存在的分P，避免删掉的卡片一直占着内存。 */
export function pruneSeriesPositions(keep: ReadonlySet<string>): void {
  for (const id of [...cache.keys()]) {
    if (!keep.has(id)) cache.delete(id);
  }
}

/** 「自动排列 / 按时间顺序重建」时清空，让自动分层重新生效。 */
export function clearSeriesPositions(): void {
  cache.clear();
}
