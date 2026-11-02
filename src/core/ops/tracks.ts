/** 轨道 ops：增删与静音/显示/锁定。 */
import type { Project, Track } from "@/types/project";
import { createTrack, nextTrackName } from "@/core/factory";
import { replaceTrack, withTouch } from "./internal";

/** 在指定位置插入一条轨道；index 越界时夹紧到两端。 */
export function addTrackAt(doc: Project, index: number, name?: string): Project {
  const track = createTrack(name ?? nextTrackName(doc));
  const at = Math.min(Math.max(0, index), doc.tracks.length);
  const tracks = doc.tracks.slice();
  tracks.splice(at, 0, track);
  return withTouch(doc, { tracks });
}

/** 在末尾追加一条轨道。 */
export function addTrack(doc: Project, name?: string): Project {
  return addTrackAt(doc, doc.tracks.length, name);
}

/** 把轨道移动到指定位置（`toIndex` 为移除后的目标下标），越界时夹紧。 */
export function moveTrack(doc: Project, trackId: string, toIndex: number): Project {
  const from = doc.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return doc;
  const to = Math.min(Math.max(0, toIndex), doc.tracks.length - 1);
  if (to === from) return doc;
  const tracks = doc.tracks.slice();
  const [track] = tracks.splice(from, 1);
  tracks.splice(to, 0, track);
  return withTouch(doc, { tracks });
}

/**
 * 把一组轨道整体提到最上方，`trackIds` 的顺序就是提升后的顺序。
 * 用于「字幕轨永远压在最上层」这类层级约束；其余轨道保持原有相对顺序。
 */
export function raiseTracks(doc: Project, trackIds: string[]): Project {
  const wanted = new Set(trackIds);
  if (wanted.size === 0) return doc;
  const raised = trackIds
    .map((id) => doc.tracks.find((track) => track.id === id))
    .filter((track): track is Track => track !== undefined);
  if (raised.length === 0) return doc;

  const tracks = [...raised, ...doc.tracks.filter((track) => !wanted.has(track.id))];
  // 已经是最上层（且顺序一致）时不产生无意义的历史步骤。
  if (tracks.length === doc.tracks.length && tracks.every((track, index) => track === doc.tracks[index])) {
    return doc;
  }
  return withTouch(doc, { tracks });
}

/** 重命名轨道；空白名字视为无变化。 */
export function renameTrack(doc: Project, trackId: string, name: string): Project {
  const track = doc.tracks.find((candidate) => candidate.id === trackId);
  const next = name.trim();
  if (!track || !next || track.name === next) return doc;
  return replaceTrack(doc, trackId, { ...track, name: next });
}

/** 删除轨道；允许删到一条不剩。 */
export function removeTrack(doc: Project, trackId: string): Project {
  const tracks = doc.tracks.filter((t) => t.id !== trackId);
  if (tracks.length === doc.tracks.length) return doc;
  return withTouch(doc, { tracks });
}

export function setTrackFlag(
  doc: Project,
  trackId: string,
  flag: "muted" | "visible" | "locked",
  value: boolean,
): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track[flag] === value) return doc;
  const next: Track =
    flag === "muted"
      ? { ...track, muted: value }
      : flag === "visible"
        ? { ...track, visible: value }
        : { ...track, locked: value };
  return replaceTrack(doc, trackId, next);
}
