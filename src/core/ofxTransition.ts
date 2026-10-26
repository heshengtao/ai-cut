/** OFX 转场的时间线解析：切点、两侧片段、源时间和进度。 */
import type { Clip, ClipEffect, MediaAsset, Project } from "@/types/project";
import { isVisible } from "@/core/playback/activeClips";

export interface OfxTransitionSide {
  clip: Clip;
  asset: MediaAsset | undefined;
  /** 该侧片段在时间线上的起点。 */
  start: number;
}

export interface OfxTransitionRange {
  clipId: string;
  edge: "in" | "out";
  trackId: string;
  effect: ClipEffect;
  /** 切点时间线秒。 */
  cut: number;
  /** 转场覆盖区间 [start, end)。 */
  start: number;
  end: number;
  duration: number;
  from: OfxTransitionSide | null;
  to: OfxTransitionSide | null;
  /** 叠加层应处于的轨道层级（同轨道值）。 */
  layer: number;
}

const EPSILON = 1e-3;

function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

function speedOf(clip: Clip): number {
  return Math.min(4, Math.max(0.1, clip.speed ?? 1));
}

/** 同轨道上在切点结束 / 开始的相邻片段。 */
function neighbourAtCut(
  clips: Clip[],
  cut: number,
  side: "end" | "start",
  selfId: string,
): Clip | null {
  for (const clip of clips) {
    if (clip.id === selfId) continue;
    const edge = side === "end" ? clipEnd(clip) : clip.start;
    if (Math.abs(edge - cut) <= EPSILON) return clip;
  }
  return null;
}

function sideOf(project: Project, clip: Clip | null, start: number): OfxTransitionSide | null {
  if (!clip) return null;
  return {
    clip,
    asset: project.assets.find((asset) => asset.id === clip.assetId),
    start,
  };
}

function transitionOf(clip: Clip, edge: "in" | "out") {
  return edge === "in" ? clip.transitionIn : clip.transitionOut;
}

/** 为片段某一边的 OFX 转场计算区间；不是 OFX 转场时返回 null。 */
export function ofxTransitionRange(
  project: Project,
  trackId: string,
  clip: Clip,
  edge: "in" | "out",
): OfxTransitionRange | null {
  const transition = transitionOf(clip, edge);
  if (transition?.type !== "ofx" || !transition.effect) return null;
  if (transition.effect.enabled === false) return null;
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track) return null;

  const cut = edge === "in" ? clip.start : clipEnd(clip);
  const previous =
    edge === "in" ? neighbourAtCut(track.clips, cut, "end", clip.id) : null;
  const next =
    edge === "out" ? neighbourAtCut(track.clips, cut, "start", clip.id) : null;
  const from =
    edge === "in"
      ? sideOf(project, previous, previous?.start ?? cut)
      : sideOf(project, clip, clip.start);
  const to =
    edge === "in"
      ? sideOf(project, clip, clip.start)
      : sideOf(project, next, next?.start ?? cut);
  if (!from && !to) return null;

  const duration = Math.max(0.1, transition.duration);
  let start: number;
  let end: number;
  if (from && to) {
    // 标准 NLE 语义：切点居中，两侧各借 duration/2 的 handle。
    start = cut - duration / 2;
    end = cut + duration / 2;
  } else if (from) {
    start = cut - duration;
    end = cut;
  } else {
    start = cut;
    end = cut + duration;
  }

  const index = project.tracks.findIndex((item) => item.id === trackId);
  return {
    clipId: clip.id,
    edge,
    trackId,
    effect: transition.effect,
    cut,
    start,
    end,
    duration,
    from,
    to,
    layer: project.tracks.length - index,
  };
}

/** 当前时间点生效的 OFX 转场（取最上方轨道）。 */
export function activeOfxTransition(
  project: Project,
  time: number,
): OfxTransitionRange | null {
  let best: OfxTransitionRange | null = null;
  for (const track of project.tracks) {
    if (!isVisible(track)) continue;
    for (const clip of track.clips) {
      for (const edge of ["in", "out"] as const) {
        const range = ofxTransitionRange(project, track.id, clip, edge);
        if (!range) continue;
        if (time < range.start - EPSILON || time >= range.end - EPSILON) continue;
        if (!best || range.layer > best.layer) best = range;
      }
    }
  }
  return best;
}

/** 转场进度 0..1。 */
export function transitionProgress(range: OfxTransitionRange, time: number): number {
  if (!(range.end > range.start)) return 0;
  return Math.min(1, Math.max(0, (time - range.start) / range.duration));
}

/**
 * 某一侧在时间线 `time` 对应的素材时间。
 *
 * 转场会越过片段的 out / in 读取 handle；没有 handle 时钳到素材边界，
 * 表现为冻结最后一帧 / 第一帧。
 */
export function transitionSourceTime(
  side: OfxTransitionSide,
  time: number,
): number {
  if (side.asset?.kind === "image") return 0;
  const raw = (side.clip.in ?? 0) + (time - side.clip.start) * speedOf(side.clip);
  // 允许读取 in 之前的 handle；只有素材边界才是硬限制。
  const min = 0;
  const duration = side.asset?.duration ?? 0;
  const max = duration > 0 ? Math.max(min, duration - 0.001) : raw;
  return Math.min(max, Math.max(min, raw));
}

/** 转场烘焙 / 缓存签名。 */
export function ofxTransitionKey(range: OfxTransitionRange): string {
  return `${range.clipId}:${range.edge}`;
}
