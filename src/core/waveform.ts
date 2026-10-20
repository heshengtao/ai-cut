/** 波形工具：在整段素材的峰值数组里取任意时间窗口的峰值。纯函数，便于单测。 */
import { makeWaveform } from "@/core/media";
import type { MediaAsset } from "@/types/project";

/** 低于这个桶数视为旧版波形（分辨率太粗，需要重新生成）。 */
export const MIN_WAVEFORM_BUCKETS = 256;

/** 正在生成的素材 id，避免多个片段重复触发。 */
const inflight = new Set<string>();
/** 本次会话生成的高分辨率波形：不依赖文档回写（撤销 / 拖拽临时文档也能用）。 */
const cache = new Map<string, number[]>();

/** 取本次会话已生成的波形（没有则 undefined）。 */
export function cachedWaveform(assetId: string): number[] | undefined {
  return cache.get(assetId);
}

/** 素材是否带音频且波形缺失 / 太粗。 */
export function needsWaveform(asset: MediaAsset): boolean {
  const audible = asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio !== false);
  return (
    audible &&
    !asset.offline &&
    asset.duration > 0 &&
    (asset.wave?.length ?? 0) < MIN_WAVEFORM_BUCKETS
  );
}

/** 按需重新生成波形（旧工程兼容）。失败时静默忽略。 */
export async function ensureWaveform(
  asset: MediaAsset,
  apply: (wave: number[]) => void,
): Promise<void> {
  if (!needsWaveform(asset) || inflight.has(asset.id) || cache.has(asset.id)) return;
  inflight.add(asset.id);
  try {
    const wave = await makeWaveform(asset.src, asset.id);
    if (wave.length > (asset.wave?.length ?? 0)) {
      cache.set(asset.id, wave);
      apply(wave);
    }
  } catch {
    /* 波形是增强信息，失败不影响播放 */
  } finally {
    inflight.delete(asset.id);
  }
}

/**
 * 取 `[fromSec, toSec)` 区间内的最大峰值（0..100）。
 * 时间按**素材内时间**计算，因此裁剪/缩放后波形不会变形。
 */
export function peakBetween(
  peaks: number[],
  sourceDuration: number,
  fromSec: number,
  toSec: number,
): number {
  if (peaks.length === 0 || !(sourceDuration > 0)) return 0;
  const start = Math.max(0, Math.min(sourceDuration, fromSec));
  const end = Math.max(start, Math.min(sourceDuration, toSec));
  if (end === start) return 0;

  const bucket = sourceDuration / peaks.length;
  const index0 = Math.max(0, Math.min(peaks.length - 1, Math.floor(start / bucket)));
  const index1 = Math.max(index0 + 1, Math.min(peaks.length, Math.ceil(end / bucket)));

  let peak = 0;
  for (let i = index0; i < index1; i += 1) peak = Math.max(peak, peaks[i] ?? 0);
  return peak;
}
