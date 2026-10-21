/**
 * 可序列化命令注册表。
 *
 * 所有 AI 写操作都走这里：命令是纯数据，内部再调用 `core/ops` 的纯函数。
 * 这样同一条命令可以来自 UI、MCP 或事件回放，执行结果一致。
 */
import type { Affected, Command, CommandKind } from "@/types/events";
import type { Clip, MediaAsset, Project } from "@/types/project";
import {
  addAsset,
  addClip,
  addTrackAt,
  moveClips,
  moveTrack,
  removeAsset,
  removeClips,
  removeTrack,
  renameProject,
  setProjectOutput,
  setTrackFlag,
  splitClips,
  trimClip,
  updateAsset,
  updateClip,
} from "@/core/ops";
import { t } from "@/i18n";

/** 命令执行结果：新文档 + 受影响对象。 */
export interface ApplyResult {
  doc: Project;
  affected: Affected;
}

const EMPTY_AFFECTED: Affected = { clipIds: [], trackIds: [], assetIds: [] };

function invalid(message: string): never {
  throw new Error(`${t("error.command.invalidPayload")}：${message}`);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${field} 必须是非空字符串`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${field} 必须是有限数字`);
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(`${field} 必须是字符串数组`);
  }
  return value as string[];
}

function asAsset(value: unknown): MediaAsset {
  const record = asRecord(value, "asset");
  asString(record.id, "asset.id");
  asString(record.name, "asset.name");
  asString(record.kind, "asset.kind");
  asString(record.src, "asset.src");
  asNumber(record.duration, "asset.duration");
  return record as unknown as MediaAsset;
}

function asNewClip(value: unknown, trackId: string): Clip {
  const record = asRecord(value, "clip");
  const start = asNumber(record.start, "clip.start");
  const duration = asNumber(record.duration, "clip.duration");
  if (!(duration > 0)) invalid("clip.duration 必须大于 0");
  if (typeof record.assetId !== "string") invalid("clip.assetId 必须是字符串");
  return {
    ...(record as unknown as Clip),
    id:
      typeof record.id === "string" && record.id.length > 0
        ? record.id
        : crypto.randomUUID(),
    assetId: record.assetId,
    trackId,
    start,
    duration,
    in: record.in === undefined ? 0 : asNumber(record.in, "clip.in"),
  };
}

/** 收集文档内所有片段，按 id 索引。 */
function clipIndex(doc: Project): Map<string, Clip> {
  const map = new Map<string, Clip>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) map.set(clip.id, clip);
  }
  return map;
}

/** 对比两份文档，算出受影响的对象与时间区间。 */
export function diffAffected(before: Project, after: Project): Affected {
  if (before === after) return EMPTY_AFFECTED;

  const clipIds = new Set<string>();
  const trackIds = new Set<string>();
  const assetIds = new Set<string>();

  const beforeClips = clipIndex(before);
  const afterClips = clipIndex(after);
  for (const [id, clip] of beforeClips) {
    const next = afterClips.get(id);
    if (!next || next !== clip) clipIds.add(id);
  }
  for (const [id, clip] of afterClips) {
    if (!beforeClips.has(id) || beforeClips.get(id) !== clip) clipIds.add(id);
  }

  const beforeTracks = new Map(before.tracks.map((track) => [track.id, track]));
  const afterTracks = new Map(after.tracks.map((track) => [track.id, track]));
  for (const [id, track] of beforeTracks) {
    const next = afterTracks.get(id);
    if (!next || next !== track) trackIds.add(id);
  }
  for (const [id, track] of afterTracks) {
    if (!beforeTracks.has(id) || beforeTracks.get(id) !== track) trackIds.add(id);
  }

  const beforeAssets = new Map(before.assets.map((asset) => [asset.id, asset]));
  const afterAssets = new Map(after.assets.map((asset) => [asset.id, asset]));
  for (const [id, asset] of beforeAssets) {
    const next = afterAssets.get(id);
    if (!next || next !== asset) assetIds.add(id);
  }
  for (const [id, asset] of afterAssets) {
    if (!beforeAssets.has(id) || beforeAssets.get(id) !== asset) assetIds.add(id);
  }

  let range: [number, number] | undefined;
  if (clipIds.size > 0) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const id of clipIds) {
      const clip = afterClips.get(id) ?? beforeClips.get(id);
      if (!clip) continue;
      min = Math.min(min, clip.start);
      max = Math.max(max, clip.start + clip.duration);
    }
    if (Number.isFinite(min) && Number.isFinite(max)) range = [min, max];
  }

  return {
    clipIds: [...clipIds],
    trackIds: [...trackIds],
    assetIds: [...assetIds],
    ...(range ? { range } : {}),
  };
}

/** 把一条命令应用到文档。未知或不可执行类型会抛错。 */
export function applyCommandToDoc(doc: Project, command: Command): ApplyResult {
  const payload = asRecord(command.payload, "payload");
  let next = doc;

  switch (command.kind) {
    case "asset.add": {
      next = addAsset(doc, asAsset(payload.asset));
      break;
    }
    case "asset.remove": {
      next = removeAsset(doc, asString(payload.assetId, "assetId"));
      break;
    }
    case "asset.update": {
      next = updateAsset(
        doc,
        asString(payload.assetId, "assetId"),
        asRecord(payload.patch, "patch") as Partial<MediaAsset>,
      );
      break;
    }
    case "clip.add": {
      const trackId = asString(payload.trackId, "trackId");
      const clip = asNewClip(payload.clip, trackId);
      const track = doc.tracks.find((candidate) => candidate.id === trackId);
      if (!track) invalid(`未知轨道：${trackId}`);
      const end = clip.start + clip.duration;
      if (
        track.clips.some(
          (existing) => clip.start < existing.start + existing.duration && existing.start < end,
        )
      ) {
        const trackIndex = doc.tracks.findIndex((candidate) => candidate.id === trackId);
        throw new Error(t("error.command.overlap", { n: trackIndex + 1 }));
      }
      next = addClip(doc, trackId, clip);
      break;
    }
    case "clip.update": {
      next = updateClip(
        doc,
        asString(payload.clipId, "clipId"),
        asRecord(payload.patch, "patch") as Partial<Clip>,
      );
      break;
    }
    case "clip.remove": {
      next = removeClips(doc, asStringArray(payload.clipIds, "clipIds"));
      break;
    }
    case "clip.split": {
      next = splitClips(
        doc,
        asStringArray(payload.clipIds, "clipIds"),
        asNumber(payload.at, "at"),
      );
      break;
    }
    case "clip.trim": {
      const edge = payload.edge;
      if (edge !== "start" && edge !== "end") invalid("edge 必须是 start 或 end");
      next = trimClip(
        doc,
        asString(payload.clipId, "clipId"),
        edge,
        asNumber(payload.time, "time"),
      );
      break;
    }
    case "clip.move": {
      next = moveClips(
        doc,
        asStringArray(payload.clipIds, "clipIds"),
        asNumber(payload.delta, "delta"),
        payload.targetTrackId === undefined
          ? undefined
          : asString(payload.targetTrackId, "targetTrackId"),
      );
      break;
    }
    case "track.add": {
      next = addTrackAt(
        doc,
        payload.index === undefined ? doc.tracks.length : asNumber(payload.index, "index"),
      );
      break;
    }
    case "track.update": {
      const trackId = asString(payload.trackId, "trackId");
      const patch = asRecord(payload.patch, "patch");
      for (const flag of ["muted", "visible", "locked"] as const) {
        const value = patch[flag];
        if (value === undefined) continue;
        if (typeof value !== "boolean") invalid(`${flag} 必须是布尔值`);
        next = setTrackFlag(next, trackId, flag, value);
      }
      break;
    }
    case "track.remove": {
      next = removeTrack(doc, asString(payload.trackId, "trackId"));
      break;
    }
    case "track.move": {
      next = moveTrack(
        doc,
        asString(payload.trackId, "trackId"),
        asNumber(payload.toIndex, "toIndex"),
      );
      break;
    }
    case "project.rename": {
      next = renameProject(doc, asString(payload.name, "name"));
      break;
    }
    case "project.output": {
      const patch: { width?: number; height?: number; fps?: number } = {};
      if (payload.width !== undefined) patch.width = asNumber(payload.width, "width");
      if (payload.height !== undefined) patch.height = asNumber(payload.height, "height");
      if (payload.fps !== undefined) patch.fps = asNumber(payload.fps, "fps");
      if (patch.width === undefined && patch.height === undefined && patch.fps === undefined) {
        invalid("project.output 至少需要 width / height / fps 之一");
      }
      next = setProjectOutput(doc, patch);
      break;
    }
    case "project.reset":
    case "ui.dispatch":
    case "history.undo":
    case "history.redo": {
      throw new Error(t("error.command.unknownKind", { kind: command.kind }));
    }
    default: {
      throw new Error(t("error.command.unknownKind", { kind: String(command.kind) }));
    }
  }

  return { doc: next, affected: diffAffected(doc, next) };
}

/** 供测试 / 调试使用：判断某种命令是否可执行。 */
export function isExecutableKind(kind: CommandKind): boolean {
  return (
    kind !== "project.reset" &&
    kind !== "ui.dispatch" &&
    kind !== "history.undo" &&
    kind !== "history.redo"
  );
}
