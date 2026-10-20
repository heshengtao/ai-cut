/** 时间线吸附：拖拽时把片段的边对齐到候选点。纯函数，便于单测。 */
import type { Clip, Project } from "@/types/project";

/** 收集吸附候选点：零点、播放头，以及其他片段的起止时间。 */
export function snapTargets(
  doc: Project,
  excludeClipIds: Set<string>,
  playhead: number,
): number[] {
  const targets = new Set<number>([0, playhead]);
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      targets.add(clip.start);
      targets.add(clip.start + clip.duration);
    }
  }
  return [...targets];
}

export interface SnapMoveResult {
  delta: number;
  guide: number | null;
}

/** 为一组正在拖动的片段求吸附后的位移：在阈值内取位移最小的候选边。 */
export function snapMove(
  doc: Project,
  movingIds: Set<string>,
  rawDelta: number,
  thresholdSec: number,
  playhead: number,
): SnapMoveResult {
  const moving: Clip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (movingIds.has(clip.id)) moving.push(clip);
  }
  if (moving.length === 0) return { delta: rawDelta, guide: null };

  const start = Math.min(...moving.map((c) => c.start + rawDelta));
  const end = Math.max(...moving.map((c) => c.start + c.duration + rawDelta));
  const targets = snapTargets(doc, movingIds, playhead);

  let best: SnapMoveResult = { delta: rawDelta, guide: null };
  let bestDistance = thresholdSec;
  for (const target of targets) {
    for (const edge of [start, end]) {
      const distance = Math.abs(target - edge);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { delta: rawDelta + (target - edge), guide: target };
      }
    }
  }
  return best;
}

export interface SnapEdgeResult {
  time: number;
  guide: number | null;
}

/** 裁剪时把新的边缘时间吸附到候选点。 */
export function snapEdge(
  doc: Project,
  clipId: string,
  rawTime: number,
  thresholdSec: number,
  playhead: number,
): SnapEdgeResult {
  const targets = snapTargets(doc, new Set([clipId]), playhead);
  let best: SnapEdgeResult = { time: rawTime, guide: null };
  let bestDistance = thresholdSec;
  for (const target of targets) {
    const distance = Math.abs(target - rawTime);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { time: target, guide: target };
    }
  }
  return best;
}
