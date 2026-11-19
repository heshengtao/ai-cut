/**
 * 素材卡（图片 / 视频）的尺寸适配（纯函数，不 import Vue / store）。
 *
 * 规则和 ai-board 的 `mediaHeight()` 一致：**宽度不变**，高度按素材原始比例算，
 * 夹在 140–1200 之间。卡片与画面同形，卡里的 `object-fit: contain` 就永远不裁图。
 *
 * 三处调用方共用这一份：新建 / 拖入节点（`BoardView`）、卡片里 `<img>` / `<video>`
 * 加载完成、以及素材元数据一换就适配（`BoardNode` 的 `watch(primary)`）。
 */

/** 素材卡最小高度（画布单位）：再扁的宽幅素材也留得住底部操作区。 */
export const MEDIA_MIN_HEIGHT = 140;
/** 素材卡最大高度：竖屏长图 / 竖屏视频不把画布撑得没法看。 */
export const MEDIA_MAX_HEIGHT = 1200;

/** 没有素材元数据（ffprobe / 浏览器都读不到）时的兜底比例，接近 3:2。 */
const FALLBACK_RATIO = 0.66;

export interface MediaSize {
  width: number;
  height: number;
}

function clampHeight(value: number): number {
  return Math.min(MEDIA_MAX_HEIGHT, Math.max(MEDIA_MIN_HEIGHT, value));
}

/** 宽度固定时，按素材原始比例算出的卡片高度（140–1200 夹取）。 */
export function mediaHeight(
  width: number,
  naturalWidth?: number | null,
  naturalHeight?: number | null,
): number {
  const safeWidth = Math.max(1, Math.round(width));
  if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) {
    return clampHeight(Math.round(safeWidth * FALLBACK_RATIO));
  }
  return clampHeight(Math.round(safeWidth * (naturalHeight / naturalWidth)));
}

/** 适配后的节点尺寸：宽度原样保留，只改高度。 */
export function mediaNodeSize(
  width: number,
  naturalWidth?: number | null,
  naturalHeight?: number | null,
): MediaSize {
  const safeWidth = Math.max(1, Math.round(width));
  return { width: safeWidth, height: mediaHeight(safeWidth, naturalWidth, naturalHeight) };
}

/**
 * 新尺寸和现有尺寸是否「基本一致」。
 *
 * ±2px 内不写回：图片 `@load`、元数据 watch、用户拖拽缩放都会算一次，
 * 容差能让它们互相之间不打架，也不会往工程里写一堆没意义的尺寸变化。
 */
export function sameMediaSize(
  current: { width?: number; height?: number } | null | undefined,
  next: MediaSize,
  tolerance = 2,
): boolean {
  if (!current) return false;
  const width = current.width ?? 0;
  const height = current.height ?? 0;
  return Math.abs(width - next.width) <= tolerance && Math.abs(height - next.height) <= tolerance;
}
