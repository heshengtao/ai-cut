/** ops 的内部助手：不可变地替换轨道/片段，并统一维护 updatedAt。 */
import type { Clip, Project, Track } from "@/types/project";

/** 更新时间戳并覆盖指定字段。 */
export function withTouch(doc: Project, patch: Partial<Project>): Project {
  return { ...doc, ...patch, updatedAt: Date.now() };
}

/** 按 id 替换整条轨道；找不到或引用未变时返回原 doc。 */
export function replaceTrack(doc: Project, trackId: string, next: Track): Project {
  const index = doc.tracks.findIndex((t) => t.id === trackId);
  if (index < 0 || doc.tracks[index] === next) return doc;
  const tracks = doc.tracks.slice();
  tracks[index] = next;
  return withTouch(doc, { tracks });
}

/** 对某条轨道做映射；`fn` 返回同一引用即视为无变化。 */
export function mapTrack(doc: Project, trackId: string, fn: (track: Track) => Track): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return doc;
  return replaceTrack(doc, trackId, fn(track));
}

/** 对某条轨道的 clips 数组做映射。 */
export function mapTrackClips(
  doc: Project,
  trackId: string,
  fn: (clips: Clip[]) => Clip[],
): Project {
  return mapTrack(doc, trackId, (track) => {
    const clips = fn(track.clips);
    return clips === track.clips ? track : { ...track, clips };
  });
}

/** 在整份文档中定位片段。 */
export function findClip(doc: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** 轨内按 start 升序（不修改入参）。 */
export function sortClips(clips: Clip[]): Clip[] {
  return clips.slice().sort((a, b) => a.start - b.start);
}

/** 数值夹紧。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
