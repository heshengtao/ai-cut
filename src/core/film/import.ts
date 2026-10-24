/**
 * film.json → 工程命令。
 *
 * 只生成 Command，不直接改文档；调用方（mcpBridge）统一走 applyCommands，
 * 因此一次导入仍然是一个 revision、一个撤销步。
 */
import type { Command, CommandKind } from "@/types/events";
import type { Clip, Marker, MarkerKind, MediaAsset, Project } from "@/types/project";
import type { FilmReviewNote, ParsedManifest } from "./manifest";
import { normalizePath } from "./manifest";

export interface ManifestAsset {
  path: string;
  kind: "video" | "audio" | "image";
  duration: number;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  hasAudio?: boolean;
}

export type ImportMode = "replace" | "merge";

export interface ImportOptions {
  mode: ImportMode;
  trackName: string;
  assets: ManifestAsset[];
  baseRevision: number;
  actor: "human" | "agent";
  sessionId?: string;
  label?: string;
  now?: number;
  /** 把工程 fps/宽高改成 manifest 的交付规格（同一个撤销步）。 */
  conform?: boolean;
}

export const FILM_TAG = "film-manifest";

export interface ImportSummary {
  scenes: number;
  clipsAdded: number;
  clipsUpdated: number;
  clipsRemoved: number;
  markersAdded: number;
  markersUpdated: number;
  markersRemoved: number;
  assetsAdded: number;
  trackId?: string;
  warnings: string[];
}

interface Draft {
  kind: CommandKind;
  payload: unknown;
  label: string;
}

function snap(seconds: number, fps: number): number {
  if (!(fps > 0)) return Math.round(seconds * 1000) / 1000;
  return Math.round(seconds * fps) / fps;
}

function markerTitle(note: FilmReviewNote): string {
  const prefix = note.severity ? `[${note.severity}] ` : "";
  const text = note.text.replace(/\s+/g, " ").trim();
  return `${prefix}${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
}

function markerKey(kind: MarkerKind, sceneId: string | undefined, time: number, identity?: string): string {
  return [kind, sceneId ?? "", time.toFixed(3), identity ?? ""].join("|");
}

/** 用正文作为身份：marker 不保存 note.id，重导入时按正文匹配最稳。 */
function noteIdentity(note: FilmReviewNote): string {
  return note.text.trim();
}

function fromNote(
  note: FilmReviewNote,
  sceneId: string | undefined,
  fps: number,
): { marker: Omit<Marker, "id">; key: string; time: number } {
  const time = snap(note.t, fps);
  return {
    key: markerKey("review", sceneId, time, noteIdentity(note)),
    time,
    marker: {
      time,
      name: markerTitle(note),
      kind: "review",
      ...(sceneId ? { sceneId } : {}),
      note: note.text,
      ...(note.severity ? { severity: note.severity } : {}),
      ...(note.resolved === true ? { resolved: true } : {}),
      ...(note.bbox ? { bbox: note.bbox } : {}),
      ...(note.screenshot ? { screenshot: note.screenshot } : {}),
      ...(note.tags ? { tags: [...note.tags, FILM_TAG] } : { tags: [FILM_TAG] }),
    },
  };
}

function sameNoteMarker(existing: Marker, desired: Omit<Marker, "id">): boolean {
  return (
    existing.time === desired.time &&
    existing.name === desired.name &&
    existing.kind === desired.kind &&
    existing.sceneId === desired.sceneId &&
    existing.note === desired.note &&
    existing.severity === desired.severity &&
    existing.resolved === desired.resolved &&
    existing.screenshot === desired.screenshot &&
    JSON.stringify(existing.bbox ?? null) === JSON.stringify(desired.bbox ?? null) &&
    JSON.stringify(existing.tags ?? []) === JSON.stringify(desired.tags ?? [])
  );
}

function sameClip(existing: Clip, desired: Partial<Clip>): boolean {
  return (
    existing.start === desired.start &&
    existing.duration === desired.duration &&
    existing.in === desired.in &&
    existing.assetId === desired.assetId &&
    existing.sceneId === desired.sceneId
  );
}

function assetFor(
  path: string,
  assets: Map<string, ManifestAsset>,
): ManifestAsset | undefined {
  return assets.get(normalizePath(path));
}

/**
 * 生成导入命令。
 *
 * `replace`：同步 manifest 里的 scene / hit / review，并删除带 film-manifest
 * 标签但本次已不存在的 marker 与 clip；`merge` 只增改不删。
 */
export function buildManifestCommands(
  project: Project,
  parsed: ParsedManifest,
  options: ImportOptions,
): { commands: Command[]; summary: ImportSummary } {
  const now = options.now ?? Date.now();
  const drafts: Draft[] = [];
  const warnings = [...parsed.warnings];
  const summary: ImportSummary = {
    scenes: parsed.manifest.scenes.length,
    clipsAdded: 0,
    clipsUpdated: 0,
    clipsRemoved: 0,
    markersAdded: 0,
    markersUpdated: 0,
    markersRemoved: 0,
    assetsAdded: 0,
    warnings,
  };

  if (parsed.manifest.fps && Math.abs(parsed.manifest.fps - project.fps) > 1e-6) {
    warnings.push(
      options.conform
        ? `manifest fps=${parsed.manifest.fps}；已自动 conform 工程输出规格`
        : `manifest fps=${parsed.manifest.fps} 与工程 fps=${project.fps} 不一致；时间按工程帧率吸附（可传 conform:true）`,
    );
  }

  // 自动 conform：把工程输出规格改成 manifest 的交付规格（与导入同一个撤销步）。
  if (options.conform) {
    const patch: { width?: number; height?: number; fps?: number } = {};
    if (parsed.manifest.fps && Math.abs(parsed.manifest.fps - project.fps) > 1e-6) {
      patch.fps = parsed.manifest.fps;
    }
    if (parsed.manifest.width && parsed.manifest.width !== project.width) {
      patch.width = parsed.manifest.width;
    }
    if (parsed.manifest.height && parsed.manifest.height !== project.height) {
      patch.height = parsed.manifest.height;
    }
    if (Object.keys(patch).length > 0) {
      drafts.push({
        kind: "project.output",
        payload: patch,
        label: "匹配影片规格",
      });
    }
  }

  // conform 时按 manifest 的 fps 吸附，避免 30→60 后时间不落在帧上。
  const frameRate =
    options.conform && parsed.manifest.fps ? parsed.manifest.fps : project.fps;

  const assetBySrc = new Map(
    project.assets.map((asset) => [normalizePath(asset.src), asset]),
  );
  const incomingAssets = new Map(
    options.assets.map((asset) => [normalizePath(asset.path), asset]),
  );
  const resolveAssetId = (path: string): string | null => {
    const key = normalizePath(path);
    const existing = assetBySrc.get(key);
    if (existing) return existing.id;
    const meta = assetFor(path, incomingAssets);
    if (!meta) return null;
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      name: path.replace(/\\/g, "/").split("/").pop() ?? path,
      kind: meta.kind,
      src: path,
      duration: meta.kind === "image" ? 0 : meta.duration,
      addedAt: now,
      hasAudio: meta.hasAudio ?? false,
      ...(meta.width != null ? { width: meta.width } : {}),
      ...(meta.height != null ? { height: meta.height } : {}),
      ...(meta.fps != null ? { fps: meta.fps } : {}),
    };
    assetBySrc.set(key, asset);
    incomingAssets.delete(key);
    summary.assetsAdded += 1;
    drafts.push({
      kind: "asset.add",
      payload: { asset },
      label: `导入素材 ${asset.name}`,
    });
    return asset.id;
  };

  // 场景重叠且同轨时，硬切到下一场开始，保证不触发同轨重叠校验。
  const sceneEnds = new Map<string, number>();
  parsed.manifest.scenes.forEach((scene, index) => {
    const next = parsed.manifest.scenes[index + 1];
    sceneEnds.set(scene.id, next && next.t0 < scene.t1 ? next.t0 : scene.t1);
  });

  const takes = parsed.manifest.scenes.filter((scene) => scene.take);
  let track = project.tracks.find((candidate) => candidate.name === options.trackName);
  let trackRef: string | number | undefined = track?.id;
  if (!track && takes.length > 0) {
    drafts.push({
      kind: "track.add",
      payload: { name: options.trackName },
      label: `新建场景轨 ${options.trackName}`,
    });
    trackRef = project.tracks.length + 1;
  }

  const existingMarkers = new Map<string, Marker>();
  for (const marker of project.markers) {
    if (!marker.tags?.includes(FILM_TAG)) continue;
    const kind = marker.kind;
    if (kind !== "scene" && kind !== "hit" && kind !== "review") continue;
    const time = snap(marker.time, frameRate);
    const key =
      kind === "review"
        ? markerKey(kind, marker.sceneId, time, marker.note?.trim() ?? "")
        : markerKey(kind, marker.sceneId, time);
    existingMarkers.set(key, marker);
  }

  const desiredMarkerIds = new Set<string>();
  const pushMarker = (desired: Omit<Marker, "id">, key: string) => {
    const existing = existingMarkers.get(key);
    if (existing) {
      desiredMarkerIds.add(existing.id);
      if (!sameNoteMarker(existing, desired)) {
        drafts.push({
          kind: "marker.update",
          payload: { markerId: existing.id, patch: desired },
          label: `更新标记 ${desired.name}`,
        });
        summary.markersUpdated += 1;
      }
      return;
    }
    const id = crypto.randomUUID();
    desiredMarkerIds.add(id);
    drafts.push({
      kind: "marker.add",
      payload: { id, ...desired },
      label: `添加标记 ${desired.name}`,
    });
    summary.markersAdded += 1;
  };

  const existingClips = new Map<string, Clip>();
  for (const candidate of project.tracks) {
    for (const clip of candidate.clips) {
      if (clip.sceneId) existingClips.set(clip.sceneId, clip);
    }
  }
  const desiredSceneIds = new Set(parsed.manifest.scenes.map((scene) => scene.id));

  for (const scene of parsed.manifest.scenes) {
    const sceneEnd = sceneEnds.get(scene.id) ?? scene.t1;
    if (scene.take) {
      const takePath = parsed.takePaths.get(scene.id);
      const assetId = takePath ? resolveAssetId(takePath) : null;
      if (takePath && assetId) {
        const meta =
          assetFor(takePath, incomingAssets) ??
          options.assets.find((a) => normalizePath(a.path) === normalizePath(takePath));
        let duration = sceneEnd - scene.t0;
        if (meta && meta.kind !== "image" && meta.duration > 0 && duration > meta.duration) {
          warnings.push(
            `场景 ${scene.id} 的 ${duration.toFixed(2)}s 超过 take 时长 ${meta.duration.toFixed(2)}s，已截断`,
          );
          duration = meta.duration;
        }
        const desired = {
          assetId,
          trackId: "",
          start: scene.t0,
          duration,
          in: 0,
          sceneId: scene.id,
        };
        const existing = existingClips.get(scene.id);
        if (existing) {
          if (!sameClip(existing, desired)) {
            drafts.push({
              kind: "clip.update",
              payload: {
                clipId: existing.id,
                patch: {
                  assetId,
                  start: desired.start,
                  duration: desired.duration,
                  in: 0,
                  sceneId: scene.id,
                },
              },
              label: `更新场景 ${scene.id}`,
            });
            summary.clipsUpdated += 1;
          }
        } else {
          if (trackRef === undefined) {
            warnings.push(`场景 ${scene.id} 没有可用的场景轨，已跳过画面`);
          } else {
            const clipId = crypto.randomUUID();
            drafts.push({
              kind: "clip.add",
              payload: { trackId: trackRef, clip: { id: clipId, ...desired } },
              label: `添加场景 ${scene.id}`,
            });
            summary.clipsAdded += 1;
          }
        }
      } else if (takePath) {
        warnings.push(`场景 ${scene.id} 的 take 探测失败，已跳过画面：${takePath}`);
      }
    }

    const sceneMarker: Omit<Marker, "id"> = {
      time: snap(scene.t0, frameRate),
      name: scene.title ? `${scene.id} · ${scene.title}` : scene.id,
      kind: "scene",
      sceneId: scene.id,
      tags: [FILM_TAG],
    };
    pushMarker(sceneMarker, markerKey("scene", scene.id, sceneMarker.time));

    for (const time of scene.markers ?? []) {
      const snapped = snap(time, frameRate);
      pushMarker(
        {
          time: snapped,
          name: `hit ${snapped.toFixed(2)}s`,
          kind: "hit",
          sceneId: scene.id,
          tags: [FILM_TAG],
        },
        markerKey("hit", scene.id, snapped),
      );
    }

    for (const note of scene.review ?? []) {
      const { marker, key } = fromNote(note, scene.id, frameRate);
      pushMarker(marker, key);
    }
  }

  for (const note of parsed.manifest.review ?? []) {
    const { marker, key } = fromNote(note, undefined, frameRate);
    pushMarker(marker, key);
  }

  if (options.mode === "replace") {
    for (const marker of project.markers) {
      if (!marker.tags?.includes(FILM_TAG)) continue;
      if (desiredMarkerIds.has(marker.id)) continue;
      drafts.push({
        kind: "marker.remove",
        payload: { markerId: marker.id },
        label: `移除过期标记 ${marker.name}`,
      });
      summary.markersRemoved += 1;
    }
    for (const sceneId of existingClips.keys()) {
      if (desiredSceneIds.has(sceneId)) continue;
      const clip = existingClips.get(sceneId);
      if (!clip) continue;
      drafts.push({
        kind: "clip.remove",
        payload: { clipIds: [clip.id] },
        label: `移除过期场景 ${sceneId}`,
      });
      summary.clipsRemoved += 1;
    }
  }

  const commands: Command[] = drafts.map((draft, index) => ({
    id: crypto.randomUUID(),
    baseRevision: options.baseRevision,
    actor: options.actor,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    kind: draft.kind,
    payload: draft.payload,
    label: options.label ?? `导入 film.json（${drafts.length} 步）`,
    timestamp: now + index,
  }));

  if (trackRef !== undefined && typeof trackRef === "number") {
    // track.add 在批次里先执行，新轨索引就是原轨道数 + 1。
    summary.trackId = undefined;
  } else {
    summary.trackId = typeof trackRef === "string" ? trackRef : undefined;
  }

  return { commands, summary };
}
