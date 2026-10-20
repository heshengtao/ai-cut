/** 播放查询：给定时间点，找出各轨道上「正在播」的片段。纯函数，供预览与时间线共用。 */
import type { Clip, Project, Track } from "@/types/project";

/** 片段是否覆盖时间点 t：左闭右开 [start, start+duration)。 */
export function covers(clip: Clip, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration;
}

/** 每条轨道上覆盖 t 的片段；无则为 null。 */
export function activeClipsAt(doc: Project, t: number): Map<string, Clip | null> {
  const result = new Map<string, Clip | null>();
  for (const track of doc.tracks) {
    result.set(track.id, track.clips.find((clip) => covers(clip, t)) ?? null);
  }
  return result;
}

/** 轨道此刻是否发声（静音只影响声音）。 */
export function isAudible(track: Track): boolean {
  return !track.muted;
}

/** 轨道是否参与画面合成（视频/图片/文字）。 */
export function isVisible(track: Track): boolean {
  return track.visible !== false;
}

/** 素材是否为视频素材。 */
function isVideoAsset(doc: Project, assetId: string): boolean {
  if (assetId === "") return false;
  return doc.assets.find((a) => a.id === assetId)?.kind === "video";
}

/** 主画面轨：自上而下第一条可见、且带有视频片段的轨道（图片由预览层单独叠加）。 */
export function mainVideoTrack(doc: Project): Track | null {
  return (
    doc.tracks.find(
      (track) => isVisible(track) && track.clips.some((clip) => isVideoAsset(doc, clip.assetId)),
    ) ?? null
  );
}

/** 主画面轨上覆盖 t 的视频片段。 */
export function mainVideoClipAt(doc: Project, t: number): { track: Track; clip: Clip } | null {
  for (const track of doc.tracks) {
    if (!isVisible(track)) continue;
    const clip = track.clips.find((c) => covers(c, t) && isVideoAsset(doc, c.assetId));
    if (clip) return { track, clip };
  }
  return null;
}

/** 工程总时长 = 所有片段结束时间的最大值。 */
export function projectDuration(doc: Project): number {
  let max = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) max = Math.max(max, clip.start + clip.duration);
  }
  return max;
}
