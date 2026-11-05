/** 时间线插入位置的计算：纯函数，供拖放、右键菜单和插入文字共用。 */
import type { Clip, Project } from "@/types/project";
import { addTrackAt } from "@/core/ops";
import { snapToFrame } from "@/core/time";

/** 落点：落在某条轨道上，或在两条轨道之间插入新轨。 */
export type DropPlacement =
  | { kind: "lane"; trackId: string }
  | { kind: "insert"; index: number };

/** 解析落点；需要新轨时在指定位置创建。 */
export function resolveDropTrack(
  doc: Project,
  placement: DropPlacement,
): { doc: Project; trackId: string | null } {
  if (placement.kind === "lane") {
    const track = doc.tracks.find((candidate) => candidate.id === placement.trackId);
    return { doc, trackId: track && !track.locked ? track.id : null };
  }
  const next = addTrackAt(doc, placement.index);
  return { doc: next, trackId: next.tracks[placement.index].id };
}

/**
 * 让新片段落到不与已有片段重叠的位置：与任何片段相交时顺延到其右缘。
 * 片段按 start 升序，顺延只会让 start 变大，一遍即可。
 */
export function placeWithoutOverlap(
  startSec: number,
  duration: number,
  clips: Clip[],
  fps: number,
): number {
  let start = snapToFrame(Math.max(0, startSec), fps);
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  for (const clip of sorted) {
    const overlaps = start < clip.start + clip.duration && clip.start < start + duration;
    if (!overlaps) continue;
    start = snapToFrame(clip.start + clip.duration, fps);
  }
  return start;
}
