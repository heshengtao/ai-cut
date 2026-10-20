/** 轨道 ops：增删改名与静音/显示/锁定。 */
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

/** 删除轨道；允许删到一条不剩。 */
export function removeTrack(doc: Project, trackId: string): Project {
  const tracks = doc.tracks.filter((t) => t.id !== trackId);
  if (tracks.length === doc.tracks.length) return doc;
  return withTouch(doc, { tracks });
}

export function renameTrack(doc: Project, trackId: string, name: string): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.name === name) return doc;
  return replaceTrack(doc, trackId, { ...track, name });
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
