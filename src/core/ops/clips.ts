/** 片段 ops：增删、移动、裁剪、分割与属性。全部不可变。 */
import type {
  BlendMode,
  Clip,
  ClipShadow,
  ClipStroke,
  ClipTextStyle,
  ClipTransform,
  Project,
} from "@/types/project";
import { createClip } from "@/core/factory";
import {
  normalizeBlendMode,
  normalizeShadow,
  normalizeStroke,
  normalizeTextStyle,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
  sameShadow,
  sameStroke,
  sameTextStyle,
} from "@/core/clipStyle";
import {
  normalizeTransform,
  resolveTransform,
  sameTransform,
} from "@/core/transform";
import { findClip, mapTrack, mapTrackClips, sortClips, withTouch, clamp } from "./internal";

export function addClip(doc: Project, trackId: string, clip: Clip): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.clips.some((c) => c.id === clip.id)) return doc;
  return mapTrack(doc, trackId, (t) => ({
    ...t,
    clips: sortClips([...t.clips, { ...clip, trackId }]),
  }));
}

export function removeClips(doc: Project, clipIds: string[]): Project {
  if (clipIds.length === 0) return doc;
  const ids = new Set(clipIds);
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const clips = track.clips.filter((c) => !ids.has(c.id));
    if (clips.length === track.clips.length) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? withTouch(doc, { tracks }) : doc;
}

export function updateClip(doc: Project, clipId: string, patch: Partial<Clip>): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const next: Clip = { ...found.clip, ...patch, id: found.clip.id, trackId: found.clip.trackId };
  return mapTrackClips(doc, found.track.id, (clips) =>
    clips.map((c) => (c.id === clipId ? next : c)),
  );
}

/**
 * 把被拖动的片段约束到不与 `stationary` 重叠：顶到阻挡片段的边缘。
 * 取位移更小的一侧；左顶会越过 0 时强制右顶。
 */
export function constrainAgainst(moving: Clip, stationary: Clip[]): Clip {
  let start = moving.start;
  const duration = moving.duration;
  for (const other of stationary) {
    const otherEnd = other.start + other.duration;
    const overlaps = start < otherEnd && other.start < start + duration;
    if (!overlaps) continue;
    const rightEdge = otherEnd; // 贴其右缘
    const leftEdge = other.start - duration; // 贴其左缘
    if (leftEdge < 0) {
      start = rightEdge;
      continue;
    }
    start = Math.abs(rightEdge - start) <= Math.abs(leftEdge - start) ? rightEdge : leftEdge;
  }
  return { ...moving, start: Math.max(0, start) };
}

/**
 * 平移（并可跨轨）一组片段。
 * - `deltaSec` 为时间增量；结果 `start ≥ 0`。
 * - 未指定 `targetTrackId` 时保持原轨道。
 * - 对目标轨上的未拖动片段做重叠约束，被拖片段之间保持相对偏移。
 */
export function moveClips(
  doc: Project,
  clipIds: string[],
  deltaSec: number,
  targetTrackId?: string,
): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return doc;
  if (targetTrackId && !doc.tracks.some((t) => t.id === targetTrackId)) return doc;

  const moving: Clip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (ids.has(clip.id)) moving.push(clip);
  }
  if (moving.length === 0) return doc;
  if (deltaSec === 0 && (!targetTrackId || moving.every((c) => c.trackId === targetTrackId))) {
    return doc;
  }

  // 每条轨道上「未拖动」的片段，作为约束参考
  const stationaryByTrack = new Map<string, Clip[]>();
  for (const track of doc.tracks) {
    stationaryByTrack.set(track.id, track.clips.filter((c) => !ids.has(c.id)));
  }

  // 逐轨累积结果，从当前内容里剔除被拖动片段
  const resultByTrack = new Map<string, Clip[]>();
  for (const track of doc.tracks) resultByTrack.set(track.id, [...(stationaryByTrack.get(track.id) ?? [])]);

  const moved = sortClips(
    moving.map((c) => ({ ...c, trackId: targetTrackId ?? c.trackId, start: Math.max(0, c.start + deltaSec) })),
  );

  for (const clip of moved) {
    const list = resultByTrack.get(clip.trackId) ?? [];
    const constrained = constrainAgainst(clip, list);
    resultByTrack.set(clip.trackId, sortClips([...list, constrained]));
  }

  const tracks = doc.tracks.map((track) => {
    const clips = resultByTrack.get(track.id);
    return clips ? { ...track, clips } : track;
  });
  return withTouch(doc, { tracks });
}

/** 同轨内紧邻 `clip` 的左右边界（未计自己）。 */
function neighbourBounds(track: { clips: Clip[] }, clip: Clip): { prevEnd: number; nextStart: number } {
  let prevEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    if (other.start + other.duration <= clip.start) {
      prevEnd = Math.max(prevEnd, other.start + other.duration);
    } else if (other.start >= clip.start + clip.duration) {
      nextStart = Math.min(nextStart, other.start);
    }
  }
  return { prevEnd, nextStart };
}

/**
 * 素材是否没有固定长度（图片 / 文字 / 缺失素材）：可以在时间线上无限延长。
 * 音视频素材的可用范围始终是 `[in, asset.duration]`。
 */
function hasUnboundedSource(asset: { kind: string } | undefined, clip: Clip): boolean {
  return clip.assetId === "" || !asset || asset.kind === "image";
}

/**
 * 裁剪片段的一端。
 * - `edge === "start"`：改 `start`/`in`，出点不动。
 * - `edge === "end"`：改 `duration`，起点与入点不动。
 *
 * 音视频的裁剪永远在素材范围内，且**不改变播放速度**。
 */
export function trimClip(
  doc: Project,
  clipId: string,
  edge: "start" | "end",
  newTimeSec: number,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { track, clip } = found;
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const unbounded = hasUnboundedSource(asset, clip);
  const minDuration = 1 / doc.fps;
  const snapped = Math.round(newTimeSec * doc.fps) / doc.fps;
  const { prevEnd, nextStart } = neighbourBounds(track, clip);
  const clipEnd = clip.start + clip.duration;

  let next: Clip;
  if (edge === "start") {
    // 音视频最多回退到素材入点 0；图片 / 文字可以继续向左延长。
    const sourceStartLimit = unbounded ? 0 : clip.start - clip.in;
    const minStart = Math.max(0, prevEnd, sourceStartLimit);
    const maxStart = clipEnd - minDuration;
    // minStart > maxStart 时（极短片段 / 素材已耗尽）优先保证不产生负时长。
    const start = maxStart <= minStart ? Math.max(0, maxStart) : Math.min(Math.max(snapped, minStart), maxStart);
    if (start === clip.start) return doc;
    const delta = start - clip.start;
    next = {
      ...clip,
      start,
      duration: clip.duration - delta,
      // 无限素材向左延长时不搬动入点（入点保持 0）。
      in: unbounded ? clip.in : clip.in + delta,
    };
  } else {
    // 音视频最多延长到素材结尾；图片 / 文字没有上限。
    const sourceLimit = unbounded
      ? Infinity
      : clip.start + Math.max(0, (asset?.duration ?? 0) - clip.in);
    const maxEnd = Math.min(sourceLimit, nextStart);
    const minEnd = clip.start + minDuration;
    const end = maxEnd <= minEnd ? Math.max(clip.start, maxEnd) : Math.min(Math.max(snapped, minEnd), maxEnd);
    if (end === clipEnd) return doc;
    next = { ...clip, duration: end - clip.start };
  }

  if (!(next.duration > 0)) return doc;
  return mapTrackClips(doc, track.id, (clips) => clips.map((c) => (c.id === clipId ? next : c)));
}

/**
 * 在 `atSec` 处分割指定片段（分割点先吸附到帧网格）。
 * 只处理分割点严格落在内部的片段；无命中时返回原 doc。
 */
export function splitClips(doc: Project, clipIds: string[], atSec: number): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return doc;
  const at = Math.round(atSec * doc.fps) / doc.fps;
  let changed = false;

  const tracks = doc.tracks.map((track) => {
    const targets = track.clips.filter(
      (c) => ids.has(c.id) && at > c.start && at < c.start + c.duration,
    );
    if (targets.length === 0) return track;
    const targetIds = new Set(targets.map((c) => c.id));
    changed = true;

    const clips: Clip[] = [];
    for (const clip of track.clips) {
      if (!targetIds.has(clip.id)) {
        clips.push(clip);
        continue;
      }
      const leftDuration = at - clip.start;
      clips.push({ ...clip, duration: leftDuration });
      clips.push({
        ...clip,
        id: crypto.randomUUID(),
        start: at,
        duration: clip.duration - leftDuration,
        in: clip.in + leftDuration,
      });
    }
    return { ...track, clips: sortClips(clips) };
  });

  return changed ? withTouch(doc, { tracks }) : doc;
}

export function addTextClip(
  doc: Project,
  trackId: string,
  start: number,
  duration: number,
  text: string,
): Project {
  if (!doc.tracks.some((t) => t.id === trackId)) return doc;
  const clip = createClip({ assetId: "", trackId, start, duration, text });
  return addClip(doc, trackId, clip);
}

export function setClipText(doc: Project, clipId: string, text: string): Project {
  const found = findClip(doc, clipId);
  if (!found || found.clip.text === text) return doc;
  return updateClip(doc, clipId, { text });
}

export function setClipGain(doc: Project, clipId: string, db: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const value = clamp(db, -60, 12);
  if (found.clip.gain === value) return doc;
  return updateClip(doc, clipId, { gain: value });
}

/** 淡入时长（秒）：与淡出共享片段时长，避免两者之和超过片段长度。 */
export function setClipFadeIn(doc: Project, clipId: string, seconds: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const max = Math.max(0, found.clip.duration - (found.clip.fadeOut ?? 0));
  const value = clamp(seconds, 0, max);
  if ((found.clip.fadeIn ?? 0) === value) return doc;
  return updateClip(doc, clipId, { fadeIn: value });
}

/** 淡出时长（秒）：与淡入共享片段时长。 */
export function setClipFadeOut(doc: Project, clipId: string, seconds: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const max = Math.max(0, found.clip.duration - (found.clip.fadeIn ?? 0));
  const value = clamp(seconds, 0, max);
  if ((found.clip.fadeOut ?? 0) === value) return doc;
  return updateClip(doc, clipId, { fadeOut: value });
}

/** 变调（半音），范围 -12..12。 */
export function setClipPitch(doc: Project, clipId: string, semitones: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const value = clamp(semitones, -12, 12);
  if ((found.clip.pitch ?? 0) === value) return doc;
  return updateClip(doc, clipId, { pitch: value });
}

/** 立体声平衡 -1..1。 */
export function setClipPan(doc: Project, clipId: string, value: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const pan = clamp(value, -1, 1);
  if ((found.clip.pan ?? 0) === pan) return doc;
  return updateClip(doc, clipId, { pan });
}

export function setClipOpacity(doc: Project, clipId: string, value: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const opacity = clamp(value, 0, 1);
  if (found.clip.opacity === opacity) return doc;
  return updateClip(doc, clipId, { opacity });
}

/** 更新画面变换（位置 / 缩放 / 旋转）；未传的字段保持当前值。 */
export function setClipTransform(
  doc: Project,
  clipId: string,
  patch: Partial<ClipTransform>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;

  const current = resolveTransform(found.clip);
  const next = normalizeTransform({
    x: patch.x ?? current.x,
    y: patch.y ?? current.y,
    scale: patch.scale ?? current.scale,
    rotation: patch.rotation ?? current.rotation,
  });

  // 没有显式 transform 且值与默认值一致时，不写入字段。
  if (sameTransform(current, next)) return doc;
  return updateClip(doc, clipId, { transform: next });
}

/** 更新文字样式；未传的字段保持当前值。 */
export function setClipTextStyle(
  doc: Project,
  clipId: string,
  patch: Partial<ClipTextStyle>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const current = resolveTextStyle(found.clip);
  const next = normalizeTextStyle({ ...current, ...patch });
  if (sameTextStyle(current, next)) return doc;
  return updateClip(doc, clipId, { textStyle: next });
}

export function setClipBlendMode(
  doc: Project,
  clipId: string,
  mode: BlendMode | string,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const next = normalizeBlendMode(mode);
  if ((found.clip.blendMode ?? "normal") === next) return doc;
  return updateClip(doc, clipId, { blendMode: next });
}

/** 更新描边；未传的字段保持当前值。 */
export function setClipStroke(
  doc: Project,
  clipId: string,
  patch: Partial<ClipStroke>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const current = resolveStroke(found.clip);
  const next = normalizeStroke({ ...current, ...patch });
  if (sameStroke(current, next)) return doc;
  return updateClip(doc, clipId, { stroke: next });
}

/** 更新阴影；未传的字段保持当前值。 */
export function setClipShadow(
  doc: Project,
  clipId: string,
  patch: Partial<ClipShadow>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const current = resolveShadow(found.clip);
  const next = normalizeShadow({ ...current, ...patch });
  if (sameShadow(current, next)) return doc;
  return updateClip(doc, clipId, { shadow: next });
}

/** 更新图片 / 视频圆角（工程像素）。 */
export function setClipCornerRadius(
  doc: Project,
  clipId: string,
  value: number,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const next = clamp(value, 0, 1000);
  if ((found.clip.cornerRadius ?? 0) === next) return doc;
  return updateClip(doc, clipId, { cornerRadius: next });
}
