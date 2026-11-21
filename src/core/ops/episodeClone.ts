/**
 * 分P 的深拷贝：轨道 / 片段 / 标记全部换新 id（素材引用保持不变）。
 *
 * 复制分P（duplicate）和粘贴剪贴板（paste）共用同一套克隆逻辑；放在独立模块里，
 * 避免 `ops/episodes.ts` 与 `ops/series.ts` 互相 import。
 */
import { newEpisode } from "@/core/episodes";
import type { Clip, Episode, Marker, Track } from "@/types/project";

export function cloneTrack(track: Track): Track {
  return {
    ...track,
    id: crypto.randomUUID(),
    clips: track.clips.map((clip) => ({
      ...(clip as unknown as Record<string, unknown>),
      id: crypto.randomUUID(),
    }) as unknown as Clip),
  };
}

export function cloneMarker(marker: Marker): Marker {
  return { ...marker, id: crypto.randomUUID() };
}

/** 用源分P 的内容生成一个新分P；id / order / 名字由调用方决定。 */
export function cloneEpisode(source: Episode, name: string, order: number): Episode {
  return {
    ...newEpisode(name, order),
    tracks: source.tracks.map(cloneTrack),
    markers: source.markers.map(cloneMarker),
  };
}
