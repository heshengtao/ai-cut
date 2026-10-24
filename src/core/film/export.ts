/**
 * 工程 → film.json。
 *
 * scenes 从带 `sceneId` 的片段/标记重建；review 从 kind=review 的标记重建。
 * `music` 属于 AI DAW，写回时优先保留旧文件里的内容。
 */
import type { Clip, Marker, Project } from "@/types/project";
import type { FilmManifest, FilmReviewNote, FilmScene } from "./manifest";
import { FILM_MANIFEST_VERSION, relativeToManifest } from "./manifest";

export interface ExportManifestOptions {
  /** manifest 所在目录；用于把绝对素材路径转成相对路径。 */
  baseDir: string;
  /** 旧文件 JSON；用于保留 music 与未知字段。 */
  previous?: Record<string, unknown> | null;
}

function durationOf(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  return end;
}

function noteOf(marker: Marker): FilmReviewNote {
  return {
    ...(marker.id ? { id: marker.id } : {}),
    t: marker.time,
    text: marker.note ?? marker.name,
    ...(marker.severity ? { severity: marker.severity } : {}),
    ...(marker.resolved === true ? { resolved: true } : {}),
    ...(marker.bbox ? { bbox: marker.bbox } : {}),
    ...(marker.screenshot ? { screenshot: marker.screenshot } : {}),
    ...(marker.tags && marker.tags.length > 0 ? { tags: marker.tags } : {}),
  };
}

function isReviewMarker(marker: Marker): boolean {
  return marker.kind === "review" || Boolean(marker.note);
}

/** 把工程重建为 manifest；不读写文件。 */
export function projectToManifest(
  project: Project,
  options: ExportManifestOptions,
): Record<string, unknown> {
  const clipsByScene = new Map<string, Clip[]>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!clip.sceneId) continue;
      const list = clipsByScene.get(clip.sceneId) ?? [];
      list.push(clip);
      clipsByScene.set(clip.sceneId, list);
    }
  }

  const sceneMarkers = new Map<string, Marker>();
  const hits = new Map<string, number[]>();
  const reviews = new Map<string, FilmReviewNote[]>();
  const looseReviews: FilmReviewNote[] = [];

  for (const marker of project.markers) {
    const sceneId = marker.sceneId;
    if (marker.kind === "scene" && sceneId) {
      sceneMarkers.set(sceneId, marker);
    } else if (marker.kind === "hit" && sceneId) {
      const list = hits.get(sceneId) ?? [];
      list.push(marker.time);
      hits.set(sceneId, list);
    } else if (isReviewMarker(marker)) {
      if (sceneId) {
        const list = reviews.get(sceneId) ?? [];
        list.push(noteOf(marker));
        reviews.set(sceneId, list);
      } else {
        looseReviews.push(noteOf(marker));
      }
    }
  }

  const sceneIds = new Set<string>([
    ...clipsByScene.keys(),
    ...sceneMarkers.keys(),
    ...hits.keys(),
    ...reviews.keys(),
  ]);

  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const scenes: FilmScene[] = [];
  for (const id of sceneIds) {
    const clips = (clipsByScene.get(id) ?? []).slice().sort((a, b) => a.start - b.start);
    const marker = sceneMarkers.get(id);
    const t0 = clips.length > 0 ? clips[0].start : marker?.time ?? 0;
    const t1 =
      clips.length > 0
        ? Math.max(...clips.map((clip) => clip.start + clip.duration))
        : t0;
    const takeClip = clips.find((clip) => clip.assetId !== "");
    const asset = takeClip ? assetById.get(takeClip.assetId) : undefined;
    const titleSource = marker?.name ?? "";
    const title = titleSource.includes(" · ")
      ? titleSource.slice(titleSource.indexOf(" · ") + 3)
      : undefined;
    const sceneHits = (hits.get(id) ?? []).slice().sort((a, b) => a - b);
    const sceneReviews = (reviews.get(id) ?? []).slice().sort((a, b) => a.t - b.t);
    scenes.push({
      id,
      t0,
      t1,
      ...(title ? { title } : {}),
      ...(asset ? { take: relativeToManifest(options.baseDir, asset.src) } : {}),
      ...(sceneHits.length > 0 ? { markers: sceneHits } : {}),
      ...(sceneReviews.length > 0 ? { review: sceneReviews } : {}),
    });
  }
  scenes.sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  // 只有 marker、没有 clip 的场次也要给出合法时长，否则重新导入会被 t1 > t0 规则拒绝。
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene.t1 > scene.t0) continue;
    const following = scenes[index + 1];
    const t1 =
      following && following.t0 > scene.t0
        ? following.t0
        : scene.t0 + 1 / Math.max(1, project.fps);
    scenes[index] = { ...scene, t1 };
  }

  const next: FilmManifest = {
    version: FILM_MANIFEST_VERSION,
    name: project.name,
    fps: project.fps,
    width: project.width,
    height: project.height,
    duration: durationOf(project),
    scenes,
    ...(looseReviews.length > 0 ? { review: looseReviews } : {}),
  };

  const previous = options.previous;
  const merged: Record<string, unknown> = {
    ...(previous ?? {}),
    ...(next as unknown as Record<string, unknown>),
  };
  // music 由 AI DAW 维护：本次没有新内容时保留旧文件里的。
  if (next.music === undefined && previous && previous.music !== undefined) {
    merged.music = previous.music;
  }
  return merged;
}
