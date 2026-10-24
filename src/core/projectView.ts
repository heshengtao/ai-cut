/**
 * 工程视图：给 MCP / 智能体的渐进式读取面。
 *
 * 原则：一次只返回当前关注点需要的数据。
 * - 概览：工程规格 + 轨道摘要，不返回片段与素材明细；
 * - 轨道页 / 单片段 / 检索：按 id 或时间范围取片段；
 * - 素材页：单独分页读取。
 */
import type { AssetKind, Clip, MediaAsset, Project, Track } from "@/types/project";

const DEFAULT_PAGE = 40;
const MAX_PAGE = 100;
const MAX_ASSET_PAGE = 200;
const SUMMARY_TEXT = 200;
const PAGE_TEXT = 1000;

export interface TrackSummary {
  id: string;
  index: number;
  name: string;
  muted: boolean;
  visible: boolean;
  locked: boolean;
  clipCount: number;
  start: number;
  end: number;
}

export interface ClipSummary {
  id: string;
  trackId: string;
  trackIndex: number;
  trackName: string;
  assetId: string;
  assetName: string | null;
  sceneId?: string;
  kind: AssetKind | "text" | "missing";
  start: number;
  duration: number;
  in: number;
  speed?: number;
  text?: string;
  muted?: boolean;
  audioOnly?: boolean;
}

export interface ClipPageQuery {
  trackId?: string | number;
  assetId?: string;
  text?: string;
  kind?: string;
  from?: number;
  to?: number;
  offset?: number;
  limit?: number;
}

export interface AssetQuery {
  kind?: string;
  name?: string;
  offline?: boolean;
  offset?: number;
  limit?: number;
}

export interface FocusContext {
  playhead: number;
  playing: boolean;
  selectedClipIds: string[];
  activeTrackId: string | null;
}

function clampPage(value: unknown, fallback = DEFAULT_PAGE, max = MAX_PAGE): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function clampOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function projectDuration(doc: Project): number {
  let end = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

export function resolveTrack(
  doc: Project,
  ref: string | number | undefined,
): Track | null {
  if (ref === undefined || ref === null) return null;
  if (typeof ref === "string" && ref.length > 0) {
    const byId = doc.tracks.find((track) => track.id === ref);
    if (byId) return byId;
    if (/^\d+$/.test(ref)) {
      const index = Number(ref);
      if (index >= 1 && index <= doc.tracks.length) return doc.tracks[index - 1];
    }
    return null;
  }
  if (typeof ref === "number" && Number.isInteger(ref) && ref >= 1 && ref <= doc.tracks.length) {
    return doc.tracks[ref - 1];
  }
  return null;
}

export function trackSummary(track: Track, index: number): TrackSummary {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const clip of track.clips) {
    start = Math.min(start, clip.start);
    end = Math.max(end, clip.start + clip.duration);
  }
  return {
    id: track.id,
    index,
    name: track.name,
    muted: track.muted,
    visible: track.visible,
    locked: track.locked,
    clipCount: track.clips.length,
    start: Number.isFinite(start) ? start : 0,
    end,
  };
}

export function assetSummary(asset: MediaAsset): Omit<MediaAsset, "wave" | "thumb"> {
  const { wave, thumb, ...rest } = asset;
  void wave;
  void thumb;
  return rest;
}

export function clipSummary(
  doc: Project,
  track: Track,
  trackIndex: number,
  clip: Clip,
): ClipSummary {
  const asset = clip.assetId === ""
    ? null
    : doc.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
  return {
    id: clip.id,
    trackId: track.id,
    trackIndex,
    trackName: track.name,
    assetId: clip.assetId,
    assetName: asset?.name ?? null,
    ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
    kind: clip.assetId === "" ? "text" : asset?.kind ?? "missing",
    start: clip.start,
    duration: clip.duration,
    in: clip.in,
    ...(clip.speed === undefined || clip.speed === 1 ? {} : { speed: clip.speed }),
    ...(clip.text === undefined ? {} : { text: truncate(clip.text, SUMMARY_TEXT) }),
    ...(clip.muted === undefined ? {} : { muted: clip.muted }),
    ...(clip.audioOnly === undefined ? {} : { audioOnly: clip.audioOnly }),
  };
}

function clipForPage(clip: Clip): Clip {
  if (clip.text === undefined) return clip;
  const text = truncate(clip.text, PAGE_TEXT);
  return text === clip.text ? clip : { ...clip, text };
}

function findClip(
  doc: Project,
  clipId: string,
): { track: Track; index: number; clip: Clip } | null {
  for (let index = 0; index < doc.tracks.length; index += 1) {
    const track = doc.tracks[index];
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { track, index: index + 1, clip };
  }
  return null;
}

export function overview(doc: Project, revision: number) {
  const assetsByKind: Record<AssetKind, number> = { video: 0, audio: 0, image: 0 };
  for (const asset of doc.assets) assetsByKind[asset.kind] += 1;

  return {
    revision,
    project: {
      name: doc.name,
      version: doc.version,
      fps: doc.fps,
      width: doc.width,
      height: doc.height,
      duration: projectDuration(doc),
      trackCount: doc.tracks.length,
      assetCount: doc.assets.length,
      assetsByKind,
      markerCount: doc.markers.length,
    },
    tracks: doc.tracks.map((track, index) => trackSummary(track, index + 1)),
    hint:
      "这是工程概览，不含片段与素材明细。按关注点继续读：get_context（播放头/选中）、" +
      "get_track（某轨分页）、find_clips（按时间/素材/文字检索）、get_clip（单片段）、" +
      "get_assets（素材）、get_markers（标记）。批量写操作用 apply_commands。",
  };
}

export function trackPage(
  doc: Project,
  revision: number,
  ref: string | number | undefined,
  offsetInput: unknown,
  limitInput: unknown,
) {
  const track = resolveTrack(doc, ref);
  if (!track) return null;

  const index = doc.tracks.indexOf(track) + 1;
  const offset = Math.min(clampOffset(offsetInput), track.clips.length);
  const limit = clampPage(limitInput);
  const page = track.clips.slice(offset, offset + limit).map(clipForPage);

  return {
    revision,
    track: trackSummary(track, index),
    offset,
    total: track.clips.length,
    hasMore: offset + page.length < track.clips.length,
    nextOffset: offset + page.length,
    clips: page,
  };
}

export function clipDetail(doc: Project, revision: number, clipId: string) {
  const found = findClip(doc, clipId);
  if (!found) return null;

  const { track, index, clip } = found;
  const position = track.clips.findIndex((candidate) => candidate.id === clip.id);
  const previous = position > 0 ? track.clips[position - 1] : null;
  const next = position >= 0 && position < track.clips.length - 1
    ? track.clips[position + 1]
    : null;
  const asset = clip.assetId === ""
    ? null
    : doc.assets.find((candidate) => candidate.id === clip.assetId) ?? null;

  return {
    revision,
    clip,
    track: trackSummary(track, index),
    asset: asset ? assetSummary(asset) : null,
    neighbors: {
      previous: previous ? clipSummary(doc, track, index, previous) : null,
      next: next ? clipSummary(doc, track, index, next) : null,
    },
  };
}

export function findClips(
  doc: Project,
  revision: number,
  query: ClipPageQuery,
) {
  let scoped: { track: Track; index: number }[] | null = null;
  if (query.trackId !== undefined) {
    const track = resolveTrack(doc, query.trackId);
    if (!track) return null;
    scoped = [{ track, index: doc.tracks.indexOf(track) + 1 }];
  }

  const from = typeof query.from === "number" ? query.from : Number.NEGATIVE_INFINITY;
  const to = typeof query.to === "number" ? query.to : Number.POSITIVE_INFINITY;
  const needle = query.text?.toLowerCase();
  const kind = query.kind?.toLowerCase();

  const matches: { track: Track; trackIndex: number; clip: Clip }[] = [];
  const tracks = scoped ?? doc.tracks.map((track, index) => ({ track, index: index + 1 }));

  for (const { track, index } of tracks) {
    for (const clip of track.clips) {
      const end = clip.start + clip.duration;
      if (end <= from || clip.start >= to) continue;
      if (query.assetId !== undefined && clip.assetId !== query.assetId) continue;
      if (needle !== undefined && !(clip.text ?? "").toLowerCase().includes(needle)) continue;
      if (kind !== undefined) {
        const asset = clip.assetId === ""
          ? null
          : doc.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
        const clipKind = clip.assetId === "" ? "text" : asset?.kind ?? "missing";
        if (clipKind !== kind) continue;
      }
      matches.push({ track, trackIndex: index, clip });
    }
  }

  matches.sort((a, b) => a.clip.start - b.clip.start || a.trackIndex - b.trackIndex);

  const offset = Math.min(clampOffset(query.offset), matches.length);
  const limit = clampPage(query.limit);
  const page = matches.slice(offset, offset + limit);

  return {
    revision,
    total: matches.length,
    offset,
    limit,
    hasMore: offset + page.length < matches.length,
    nextOffset: offset + page.length,
    clips: page.map(({ track, trackIndex, clip }) =>
      clipSummary(doc, track, trackIndex, clip),
    ),
  };
}

export function assetsPage(doc: Project, revision: number, query: AssetQuery) {
  const needle = query.name?.toLowerCase();
  const kind = query.kind?.toLowerCase();

  const matches = doc.assets.filter((asset) => {
    if (kind !== undefined && asset.kind !== kind) return false;
    if (query.offline !== undefined && Boolean(asset.offline) !== query.offline) return false;
    if (needle !== undefined && !asset.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const offset = Math.min(clampOffset(query.offset), matches.length);
  const limit = clampPage(query.limit, 50, MAX_ASSET_PAGE);
  const page = matches.slice(offset, offset + limit);

  return {
    revision,
    total: matches.length,
    offset,
    limit,
    hasMore: offset + page.length < matches.length,
    nextOffset: offset + page.length,
    assets: page.map(assetSummary),
  };
}

export interface MarkerQuery {
  from?: number;
  to?: number;
  sceneId?: string;
  kind?: string;
  severity?: string;
  resolved?: boolean;
  noteOnly?: boolean;
  offset?: number;
  limit?: number;
}

export function markers(doc: Project, revision: number, query: MarkerQuery = {}) {
  const from = typeof query.from === "number" ? query.from : Number.NEGATIVE_INFINITY;
  const to = typeof query.to === "number" ? query.to : Number.POSITIVE_INFINITY;
  const list = doc.markers
    .filter((marker) => marker.time >= from && marker.time <= to)
    .filter((marker) => (query.sceneId === undefined ? true : marker.sceneId === query.sceneId))
    .filter((marker) => (query.kind === undefined ? true : marker.kind === query.kind))
    .filter((marker) =>
      query.severity === undefined ? true : marker.severity === query.severity,
    )
    .filter((marker) =>
      query.resolved === undefined ? true : (marker.resolved === true) === query.resolved,
    )
    .filter((marker) => (query.noteOnly ? Boolean(marker.note) : true))
    .slice()
    .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));

  const offset = Math.min(clampOffset(query.offset), list.length);
  const limit = clampPage(query.limit, 200, 1000);
  const page = list.slice(offset, offset + limit);
  return {
    revision,
    total: list.length,
    offset,
    limit,
    hasMore: offset + page.length < list.length,
    nextOffset: offset + page.length,
    markers: page,
  };
}

export function focusContext(doc: Project, revision: number, context: FocusContext) {
  const selected: ClipSummary[] = [];
  for (const clipId of context.selectedClipIds) {
    const found = findClip(doc, clipId);
    if (found) {
      selected.push(clipSummary(doc, found.track, found.index, found.clip));
    }
  }

  const activeTrack = resolveTrack(doc, context.activeTrackId ?? undefined);
  return {
    revision,
    playhead: context.playhead,
    playing: context.playing,
    duration: projectDuration(doc),
    activeTrack: activeTrack
      ? trackSummary(activeTrack, doc.tracks.indexOf(activeTrack) + 1)
      : null,
    selectedClipIds: context.selectedClipIds,
    selectedClips: selected,
  };
}
