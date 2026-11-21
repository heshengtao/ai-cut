/** 工程文档 ↔ JSON。解析时做结构校验，避免坏文件把内存里的工程搞崩。 */
import type {
  Clip,
  ClipKeyframes,
  CutRecord,
  CutScope,
  Marker,
  Project,
  Track,
} from "@/types/project";
import { PROJECT_VERSION } from "@/types/project";
import { attachEpisodeView, migrateToEpisodes, patchProjectMeta } from "@/core/episodes";
import { normalizeBoard } from "@/core/board/schema";
import { normalizeSeriesGraph } from "@/core/series/sanitize";
import { normalizeClipEffects } from "@/core/effects";
import { normalizeClipTransition } from "@/core/clipTransition";
import {
  baseKeyframeValues,
  KEYFRAME_PROPERTIES,
  normalizeKeyframes,
  type KeyframeInput,
} from "@/core/keyframes";
import { t } from "@/i18n/translate";

export function serializeProject(project: Project): string {
  // 折返一次：即使调用方从 ops 拿到的是被展开过的对象，写出前也补回投影。
  const doc = attachEpisodeView(project);
  // 投影是**可枚举**访问器（为了 `{...doc}` 展开安全），写盘时要剔除，
  // 否则 JSON 里会同时出现 episodes 与根级 tracks/markers 两份时间线。
  const wire: Record<string, unknown> = { ...doc };
  delete wire.tracks;
  delete wire.markers;
  // 活动画布是 `boards` 的访问器投影：写盘只保留 boards 一份。
  delete wire.board;
  return JSON.stringify(wire, null, 2);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 轨道 / 片段的形状校验（文档 v1 与 v2 共用）。 */
function assertTracks(tracks: unknown[]): void {
  for (const track of tracks) {
    if (!isObject(track)) throw new Error(t("error.serialize.badTrack"));
    if (!Array.isArray(track.clips)) throw new Error(t("error.serialize.badClips"));
    for (const clip of track.clips) {
      if (!isObject(clip)) throw new Error(t("error.serialize.badClip"));
      if (!isNumber(clip.start) || !isNumber(clip.duration) || !isNumber(clip.in)) {
        throw new Error(t("error.serialize.badClipTime"));
      }
    }
  }
}

function assertProjectShape(value: unknown): asserts value is Project {
  if (!isObject(value)) throw new Error(t("error.serialize.notObject"));
  if (value.version !== 1 && value.version !== PROJECT_VERSION) {
    throw new Error(
      t("error.serialize.version", {
        expected: PROJECT_VERSION,
        actual: String(value.version),
      }),
    );
  }
  if (typeof value.name !== "string") throw new Error(t("error.serialize.missingName"));
  if (!isNumber(value.fps) || value.fps <= 0)
    throw new Error(t("error.serialize.badFps"));
  if (!isNumber(value.width) || !isNumber(value.height))
    throw new Error(t("error.serialize.badResolution"));
  if (!Array.isArray(value.assets)) throw new Error(t("error.serialize.badAssets"));

  // v1：根级 tracks；读入后由 migrateToEpisodes() 包成一个分P。
  if (value.version === 1) {
    if (!Array.isArray(value.tracks)) throw new Error(t("error.serialize.badTracks"));
    assertTracks(value.tracks as unknown[]);
    return;
  }

  if (!Array.isArray(value.episodes) || value.episodes.length === 0)
    throw new Error(t("error.serialize.badEpisodes"));
  if (typeof value.activeEpisodeId !== "string" || !value.activeEpisodeId)
    throw new Error(t("error.serialize.badActiveEpisode"));
  for (const episode of value.episodes) {
    if (!isObject(episode) || typeof episode.id !== "string" || !episode.id)
      throw new Error(t("error.serialize.badEpisode"));
    if (!Array.isArray(episode.tracks) || !Array.isArray(episode.markers))
      throw new Error(t("error.serialize.badEpisode"));
    assertTracks(episode.tracks as unknown[]);
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 旧格式里某个属性的关键帧在 `time` 处的线性插值。 */
function legacyKeyframeValue(frames: unknown, time: number, fallback: number): number {
  if (!Array.isArray(frames)) return fallback;
  const points = frames
    .filter(
      (frame) =>
        isObject(frame) && isNumber(frame.time) && isNumber(frame.value),
    )
    .map((frame) => ({
      time: frame.time as number,
      value: frame.value as number,
    }))
    .sort((a, b) => a.time - b.time);
  if (points.length === 0) return fallback;
  if (time <= points[0].time) return points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    if (time <= points[index].time) {
      const prev = points[index - 1];
      const next = points[index];
      const span = next.time - prev.time;
      if (span <= 0) return next.value;
      return prev.value + ((next.value - prev.value) * (time - prev.time)) / span;
    }
  }
  return points[points.length - 1].value;
}

/**
 * 关键帧迁移：旧格式是「每个属性一组 {time,value}」，新格式是
 * 「每个时刻记录全部参数」。把旧格式取时间并集后逐点插值补齐。
 */
function migrateClipKeyframes(clip: Clip): ClipKeyframes | undefined {
  const raw = (clip as unknown as { keyframes?: unknown }).keyframes;
  if (raw === undefined || raw === null) return undefined;
  const base = baseKeyframeValues(clip);
  if (Array.isArray(raw)) {
    const frames = normalizeKeyframes(raw as KeyframeInput[], clip.duration, base);
    return frames.length > 0 ? frames : undefined;
  }
  if (!isObject(raw)) return undefined;

  const times = new Set<number>();
  for (const property of KEYFRAME_PROPERTIES) {
    const frames = raw[property];
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (isObject(frame) && isNumber(frame.time)) {
        times.add(clampValue(frame.time, 0, Math.max(0, clip.duration)));
      }
    }
  }
  if (times.size === 0) return undefined;

  const inputs: KeyframeInput[] = [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      opacity: legacyKeyframeValue(raw.opacity, time, base.opacity),
      x: legacyKeyframeValue(raw.x, time, base.x),
      y: legacyKeyframeValue(raw.y, time, base.y),
      scale: legacyKeyframeValue(raw.scale, time, base.scale),
      rotation: legacyKeyframeValue(raw.rotation, time, base.rotation),
    }));
  const frames = normalizeKeyframes(inputs, clip.duration, base);
  return frames.length > 0 ? frames : undefined;
}


/** 读旧工程 / 手改坏了的剪口组：只保留字段齐全的，坏条目直接丢。 */
function normalizeCutScopes(project: Project): CutScope[] | undefined {
  const raw = (project as unknown as { cutScopes?: unknown }).cutScopes;
  if (!Array.isArray(raw)) return undefined;
  const scopes: CutScope[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    if (
      typeof item.id !== "string" ||
      typeof item.assetId !== "string" ||
      typeof item.trackId !== "string" ||
      !isNumber(item.baseIn) ||
      !isNumber(item.baseOut) ||
      !isNumber(item.baseStart) ||
      !isObject(item.template) ||
      !Array.isArray(item.pieces) ||
      !Array.isArray(item.cuts)
    ) {
      continue;
    }
    const cuts: CutRecord[] = [];
    for (const cut of item.cuts) {
      if (!isObject(cut) || !isNumber(cut.srcStart) || !isNumber(cut.srcEnd)) continue;
      cuts.push({
        id: typeof cut.id === "string" && cut.id ? cut.id : crypto.randomUUID(),
        srcStart: cut.srcStart,
        srcEnd: cut.srcEnd,
        kind:
          cut.kind === "pause" || cut.kind === "retake" || cut.kind === "manual"
            ? cut.kind
            : "filler",
        text: typeof cut.text === "string" ? cut.text : "",
        createdAt: isNumber(cut.createdAt) ? cut.createdAt : Date.now(),
      });
    }
    const words = Array.isArray(item.words)
      ? item.words
          .filter(
            (word): word is { text: string; start: number; end: number } =>
              isObject(word) &&
              typeof word.text === "string" &&
              isNumber(word.start) &&
              isNumber(word.end),
          )
          .map((word) => ({ text: word.text, start: word.start, end: word.end }))
      : [];
    scopes.push({
      id: item.id,
      assetId: item.assetId,
      trackId: item.trackId,
      baseIn: item.baseIn,
      baseOut: item.baseOut,
      baseStart: item.baseStart,
      template: item.template as unknown as Clip,
      pieces: item.pieces.filter((id): id is string => typeof id === "string"),
      cuts,
      ...(words.length > 0 ? { words } : {}),
      ...(typeof item.timed === "boolean" ? { timed: item.timed } : {}),
    });
  }
  return scopes.length > 0 ? scopes : undefined;
}

/** 轨道归一化：缺省 visible 视为 true，旧的 solo / mask 字段丢弃，迁移关键帧格式。 */
function normalizeTracks(source: Track[]): Track[] {
  return source.map((track) => {
    const record = { ...(track as unknown as Record<string, unknown>) };
    const visible = record.visible !== false;
    delete record.solo;
    const clips = track.clips.map((clip) => {
      const next = { ...(clip as unknown as Record<string, unknown>) };
      delete next.mask;
      const normalized = next as unknown as Clip;
      const keyframes = migrateClipKeyframes(normalized);
      if (keyframes) normalized.keyframes = keyframes;
      else delete normalized.keyframes;

      const effects = normalizeClipEffects(normalized.effects);
      if (effects.length === 0) delete normalized.effects;
      else normalized.effects = effects;

      for (const edge of ["in", "out"] as const) {
        const key = edge === "in" ? "transitionIn" : "transitionOut";
        const current = normalized[key];
        if (!current) continue;
        const transition = normalizeClipTransition(current, normalized.duration);
        if (transition) normalized[key] = transition;
        else delete normalized[key];
      }
      return normalized;
    });
    return { ...(record as unknown as Track), visible, clips };
  });
}

/** 标记归一化：过滤坏条目，补齐 id / 时间与可选字段。 */
function normalizeMarkers(source: Marker[]): Marker[] {
  return Array.isArray(source)
    ? source
        .filter((marker) => isObject(marker) && isNumber(marker.time))
        .map((marker) => {
          const severity =
            marker.severity === "blocker" ||
            marker.severity === "high" ||
            marker.severity === "medium" ||
            marker.severity === "low"
              ? marker.severity
              : undefined;
          const kind =
            marker.kind === "scene" ||
            marker.kind === "hit" ||
            marker.kind === "review" ||
            marker.kind === "chapter"
              ? marker.kind
              : undefined;
          const bbox =
            isObject(marker.bbox) &&
            isNumber(marker.bbox.x) &&
            isNumber(marker.bbox.y) &&
            isNumber(marker.bbox.width) &&
            isNumber(marker.bbox.height)
              ? {
                  x: marker.bbox.x,
                  y: marker.bbox.y,
                  width: marker.bbox.width,
                  height: marker.bbox.height,
                }
              : undefined;
          const tags = Array.isArray(marker.tags)
            ? marker.tags.filter((tag): tag is string => typeof tag === "string")
            : undefined;
          return {
            id: typeof marker.id === "string" && marker.id ? marker.id : crypto.randomUUID(),
            time: Math.max(0, marker.time),
            name: typeof marker.name === "string" ? marker.name : "",
            ...(typeof marker.color === "string" ? { color: marker.color } : {}),
            ...(kind ? { kind } : {}),
            ...(typeof marker.sceneId === "string" && marker.sceneId
              ? { sceneId: marker.sceneId }
              : {}),
            ...(typeof marker.note === "string" && marker.note ? { note: marker.note } : {}),
            ...(severity ? { severity } : {}),
            ...(marker.resolved === true ? { resolved: true } : {}),
            ...(bbox ? { bbox } : {}),
            ...(typeof marker.screenshot === "string" && marker.screenshot
              ? { screenshot: marker.screenshot }
              : {}),
            ...(tags && tags.length > 0 ? { tags } : {}),
            ...(isNumber(marker.createdAt) ? { createdAt: marker.createdAt } : {}),
            ...(isNumber(marker.updatedAt) ? { updatedAt: marker.updatedAt } : {}),
          };
        })
    : [];
}

/**
 * 归一化整份文档：先迁移成多分P，再逐分P 归一化轨道 / 标记，
 * 最后折返投影（`tracks` / `markers` 访问器）并处理剪口组。
 */
function normalizeProject(input: Project): Project {
  const migrated = attachEpisodeView(migrateToEpisodes(input));
  const episodes = migrated.episodes.map((episode) => ({
    ...episode,
    tracks: normalizeTracks(episode.tracks),
    markers: normalizeMarkers(episode.markers),
  }));
  const doc = patchProjectMeta(migrated, { episodes });
  const cutScopes = normalizeCutScopes(doc);
  // 画布：新工程写 `boards`；只有老工程才把单张 `board` 迁移成一张画布
  // （由 `attachBoardView()` 补 id / 标题）。
  const boards = Array.isArray(doc.boards)
    ? doc.boards.map((canvas) => ({
        ...canvas,
        doc: normalizeBoard(canvas.doc),
      }))
    : undefined;
  const board = doc.board === undefined ? undefined : normalizeBoard(doc.board);
  const seriesGraph = normalizeSeriesGraph(
    (doc as unknown as { seriesGraph?: unknown }).seriesGraph,
  );
  return patchProjectMeta(doc, {
    ...(seriesGraph ? { seriesGraph } : {}),
    cutScopes,
    ...(boards ? { boards } : {}),
    ...(board ? { board } : {}),
  });
}

export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(t("error.serialize.badJson"));
  }
  assertProjectShape(raw);
  return normalizeProject(raw as Project);
}
