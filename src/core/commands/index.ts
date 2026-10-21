/**
 * 可序列化命令注册表。
 *
 * 所有 AI 写操作都走这里：命令是纯数据，内部再调用 `core/ops` 的纯函数。
 * 这样同一条命令可以来自 UI、MCP 或事件回放，执行结果一致。
 */
import type { Affected, Command, CommandKind } from "@/types/events";
import type {
  Clip,
  ClipColor,
  ClipMask,
  ClipTransition,
  KeyframeProperty,
  MediaAsset,
  Project,
  Track,
} from "@/types/project";
import {
  addAsset,
  addClip,
  addMarker,
  addTrackAt,
  duplicateClips,
  moveClips,
  moveTrack,
  removeAsset,
  removeClips,
  removeMarker,
  removeTrack,
  renameProject,
  renameTrack,
  rippleDeleteClips,
  setClipColor,
  setClipKeyframes,
  setClipMask,
  setClipSpeed,
  setClipTransition,
  setProjectOutput,
  setTrackFlag,
  splitClips,
  trimClip,
  updateAsset,
  updateClip,
  updateMarker,
} from "@/core/ops";
import { createClip } from "@/core/factory";
import { KEYFRAME_PROPERTIES, KEYFRAME_RANGES } from "@/core/keyframes";
import { placeSubtitleCues } from "@/core/subtitleTrack";
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

/** 按 id 或 1 起始 index 定位轨道。 */
function resolveTrack(doc: Project, value: unknown, field: string): Track {
  if (typeof value === "string" && value.length > 0) {
    const byId = doc.tracks.find((track) => track.id === value);
    if (byId) return byId;
    const index = Number(value);
    if (Number.isInteger(index) && index >= 1 && index <= doc.tracks.length) {
      return doc.tracks[index - 1];
    }
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= doc.tracks.length) {
    return doc.tracks[value - 1];
  }
  invalid(`${field} 必须是轨道 id 或 1 起始 index`);
}

/**
 * 校验片段落点：素材存在、不越过素材范围、时长合法、同轨不重叠。
 * 更新片段时用 `ignoreClipId` 跳过片段自身。
 */
function validateClip(
  doc: Project,
  clip: Clip,
  trackId: string,
  ignoreClipId?: string,
): void {
  if (!(clip.duration > 0)) invalid("clip.duration 必须大于 0");
  if (!(clip.start >= 0)) invalid("clip.start 不能为负");
  if (!(clip.in >= 0)) invalid("clip.in 不能为负");
  const speed = clip.speed ?? 1;
  if (!(speed >= 0.1 && speed <= 4)) invalid("clip.speed 必须在 0.1 到 4 之间");

  const track = doc.tracks.find((candidate) => candidate.id === trackId);
  if (!track) invalid(`未知轨道：${trackId}`);

  if (clip.assetId !== "") {
    const asset = doc.assets.find((candidate) => candidate.id === clip.assetId);
    if (!asset) invalid(`未知素材：${clip.assetId}`);
    if (asset.kind !== "image") {
      const epsilon = 1 / doc.fps + 1e-6;
      if (clip.in + clip.duration * speed > asset.duration + epsilon) {
        invalid(`片段超出素材范围：in + duration × speed > ${asset.duration}`);
      }
    }
  }

  const end = clip.start + clip.duration;
  for (const other of track.clips) {
    if (other.id === ignoreClipId) continue;
    if (clip.start < other.start + other.duration && other.start < end) {
      throw new Error(t("error.command.overlap", { n: doc.tracks.indexOf(track) + 1 }));
    }
  }
}

function mergeAffected(items: Affected[]): Affected {
  const clipIds = new Set<string>();
  const trackIds = new Set<string>();
  const assetIds = new Set<string>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    for (const id of item.clipIds) clipIds.add(id);
    for (const id of item.trackIds) trackIds.add(id);
    for (const id of item.assetIds) assetIds.add(id);
    if (item.range) {
      min = Math.min(min, item.range[0]);
      max = Math.max(max, item.range[1]);
    }
  }

  const range: [number, number] | undefined =
    Number.isFinite(min) && Number.isFinite(max) ? [min, max] : undefined;
  return {
    clipIds: [...clipIds],
    trackIds: [...trackIds],
    assetIds: [...assetIds],
    ...(range ? { range } : {}),
  };
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
      const trackId = resolveTrack(doc, payload.trackId, "trackId").id;
      const clip = asNewClip(payload.clip, trackId);
      validateClip(doc, clip, trackId);
      next = addClip(doc, trackId, clip);
      break;
    }
    case "clip.update": {
      const clipId = asString(payload.clipId, "clipId");
      const patch = asRecord(payload.patch, "patch") as Partial<Clip>;
      if ("id" in patch || "trackId" in patch) {
        invalid("clip.update 不支持修改 id / trackId；跨轨请用 clip.move");
      }
      const found = clipIndex(doc).get(clipId);
      if (!found) invalid(`片段不存在：${clipId}`);
      const updated: Clip = { ...found, ...patch, id: found.id, trackId: found.trackId };
      validateClip(doc, updated, found.trackId, clipId);
      next = updateClip(doc, clipId, patch);
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
          : resolveTrack(doc, payload.targetTrackId, "targetTrackId").id,
      );
      break;
    }
    case "clip.append": {
      const assetId = asString(payload.assetId, "assetId");
      const asset = doc.assets.find((candidate) => candidate.id === assetId);
      if (!asset) invalid(`未知素材：${assetId}`);

      let base = doc;
      let track: Track;
      if (payload.trackId !== undefined) {
        track = resolveTrack(base, payload.trackId, "trackId");
      } else if (base.tracks.length > 0) {
        track = base.tracks[base.tracks.length - 1];
      } else {
        const name =
          payload.trackName === undefined
            ? undefined
            : asString(payload.trackName, "trackName").trim();
        if (name !== undefined && name.length === 0) invalid("trackName 不能为空");
        base = addTrackAt(base, base.tracks.length, name);
        track = base.tracks[base.tracks.length - 1];
      }

      const inPoint = payload.in === undefined ? 0 : asNumber(payload.in, "in");
      const start =
        payload.start === undefined
          ? track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0)
          : asNumber(payload.start, "start");
      const fallback = asset.kind === "image" ? 5 : Math.max(0, asset.duration - inPoint);
      const duration =
        payload.duration === undefined ? fallback : asNumber(payload.duration, "duration");
      if (!(duration > 0)) invalid("duration 必须大于 0；图片素材请显式传入 duration");

      const clip = createClip({
        assetId,
        trackId: track.id,
        start,
        duration,
        in: inPoint,
      });
      validateClip(base, clip, track.id);
      next = addClip(base, track.id, clip);
      break;
    }
    case "clip.speed": {
      const clipId = asString(payload.clipId, "clipId");
      const speed = asNumber(payload.speed, "speed");
      if (!(speed >= 0.1 && speed <= 4)) invalid("speed 必须在 0.1 到 4 之间");
      next = setClipSpeed(doc, clipId, speed);
      break;
    }
    case "clip.color": {
      const clipId = asString(payload.clipId, "clipId");
      const patch = asRecord(payload.patch, "patch");
      const clean: Partial<ClipColor> = {};
      const ranges: Record<keyof ClipColor, [number, number]> = {
        brightness: [-1, 1],
        contrast: [0, 2],
        saturation: [0, 3],
        temperature: [-1, 1],
        tint: [-1, 1],
      };
      for (const key of Object.keys(ranges) as (keyof ClipColor)[]) {
        if (patch[key] === undefined) continue;
        const value = asNumber(patch[key], key);
        const [min, max] = ranges[key];
        if (value < min || value > max) {
          invalid(`${key} 必须在 ${min} 到 ${max} 之间`);
        }
        clean[key] = value;
      }
      next = setClipColor(doc, clipId, clean);
      break;
    }
    case "clip.transition": {
      const clipId = asString(payload.clipId, "clipId");
      const edgeValue = asString(payload.edge, "edge");
      if (edgeValue !== "in" && edgeValue !== "out") invalid("edge 必须是 in / out");
      if (payload.transition === null) {
        next = setClipTransition(doc, clipId, edgeValue, null);
        break;
      }
      const transition = asRecord(payload.transition, "transition");
      const clean: Partial<ClipTransition> = {};
      if (transition.type !== undefined) {
        const type = asString(transition.type, "type");
        if (type !== "fade" && type !== "slide") invalid("type 必须是 fade / slide");
        clean.type = type;
      }
      if (transition.duration !== undefined) {
        const duration = asNumber(transition.duration, "duration");
        if (duration < 0) invalid("duration 不能为负");
        clean.duration = duration;
      }
      if (transition.direction !== undefined) {
        const direction = asString(transition.direction, "direction");
        if (
          direction !== "left" &&
          direction !== "right" &&
          direction !== "up" &&
          direction !== "down"
        ) {
          invalid("direction 必须是 left / right / up / down");
        }
        clean.direction = direction;
      }
      next = setClipTransition(doc, clipId, edgeValue, clean);
      break;
    }
    case "clip.keyframes": {
      const clipId = asString(payload.clipId, "clipId");
      const propertyValue = asString(payload.property, "property");
      if (!KEYFRAME_PROPERTIES.includes(propertyValue as KeyframeProperty)) {
        invalid("property 必须是 opacity / x / y / scale / rotation");
      }
      const property = propertyValue as KeyframeProperty;
      if (payload.keyframes === null) {
        next = setClipKeyframes(doc, clipId, property, null);
        break;
      }
      if (!Array.isArray(payload.keyframes)) invalid("keyframes 必须是数组或 null");
      const [min, max] = KEYFRAME_RANGES[property];
      const frames = payload.keyframes.map((frame, index) => {
        const record = asRecord(frame, `keyframes[${index}]`);
        const time = asNumber(record.time, `keyframes[${index}].time`);
        const value = asNumber(record.value, `keyframes[${index}].value`);
        if (time < 0) invalid(`keyframes[${index}].time 不能为负`);
        if (value < min || value > max) {
          invalid(`keyframes[${index}].value 必须在 ${min} 到 ${max} 之间`);
        }
        return { time, value };
      });
      next = setClipKeyframes(doc, clipId, property, frames);
      break;
    }
    case "clip.mask": {
      const clipId = asString(payload.clipId, "clipId");
      if (payload.mask === null) {
        next = setClipMask(doc, clipId, null);
        break;
      }
      const mask = asRecord(payload.mask, "mask");
      const clean: Partial<ClipMask> = {};
      if (mask.shape !== undefined) {
        const shape = asString(mask.shape, "shape");
        if (shape !== "rect" && shape !== "ellipse" && shape !== "linear") {
          invalid("shape 必须是 rect / ellipse / linear");
        }
        clean.shape = shape;
      }
      const numericKeys = ["x", "y", "width", "height", "feather", "angle"] as const;
      const ranges: Record<(typeof numericKeys)[number], [number, number]> = {
        x: [0, 1],
        y: [0, 1],
        width: [0.01, 1],
        height: [0.01, 1],
        feather: [0, 0.5],
        angle: [0, 360],
      };
      for (const key of numericKeys) {
        if (mask[key] === undefined) continue;
        const value = asNumber(mask[key], key);
        const [min, max] = ranges[key];
        if (value < min || value > max) {
          invalid(`${key} 必须在 ${min} 到 ${max} 之间`);
        }
        clean[key] = value;
      }
      next = setClipMask(doc, clipId, clean);
      break;
    }
    case "clip.duplicate": {
      const target =
        payload.targetTrackId === undefined
          ? undefined
          : resolveTrack(doc, payload.targetTrackId, "targetTrackId").id;
      next = duplicateClips(
        doc,
        asStringArray(payload.clipIds, "clipIds"),
        payload.offset === undefined ? 0 : asNumber(payload.offset, "offset"),
        target,
      );
      break;
    }
    case "clip.ripple_delete": {
      const clipIds = asStringArray(payload.clipIds, "clipIds");
      const known = clipIndex(doc);
      for (const id of clipIds) {
        if (!known.has(id)) invalid(`片段不存在：${id}`);
      }
      next = rippleDeleteClips(doc, clipIds);
      break;
    }
    case "track.add": {
      const name =
        payload.name === undefined ? undefined : asString(payload.name, "name").trim();
      if (name !== undefined && name.length === 0) invalid("name 不能为空");
      next = addTrackAt(
        doc,
        payload.index === undefined ? doc.tracks.length : asNumber(payload.index, "index"),
        name,
      );
      break;
    }
    case "track.update": {
      const trackId = resolveTrack(doc, payload.trackId, "trackId").id;
      const patch = asRecord(payload.patch, "patch");
      if (patch.name !== undefined) {
        next = renameTrack(next, trackId, asString(patch.name, "name"));
      }
      for (const flag of ["muted", "visible", "locked"] as const) {
        const value = patch[flag];
        if (value === undefined) continue;
        if (typeof value !== "boolean") invalid(`${flag} 必须是布尔值`);
        next = setTrackFlag(next, trackId, flag, value);
      }
      break;
    }
    case "track.remove": {
      next = removeTrack(doc, resolveTrack(doc, payload.trackId, "trackId").id);
      break;
    }
    case "track.move": {
      next = moveTrack(
        doc,
        resolveTrack(doc, payload.trackId, "trackId").id,
        asNumber(payload.toIndex, "toIndex"),
      );
      break;
    }
    case "subtitle.import": {
      const raw = payload.entries;
      if (!Array.isArray(raw) || raw.length === 0) {
        invalid("entries 必须是非空数组");
      }
      const entries = raw.map((item, index) => {
        const record = asRecord(item, `entries[${index}]`);
        const start = asNumber(record.start, `entries[${index}].start`);
        const end = asNumber(record.end, `entries[${index}].end`);
        const text = asString(record.text, `entries[${index}].text`);
        if (!(end > start)) invalid(`entries[${index}] 的 end 必须大于 start`);
        return { start, end, text };
      });
      const trackName =
        payload.trackName === undefined
          ? undefined
          : asString(payload.trackName, "trackName").trim();
      if (trackName !== undefined && trackName.length === 0) {
        invalid("trackName 不能为空");
      }
      const offset =
        payload.offset === undefined ? 0 : asNumber(payload.offset, "offset");
      next = placeSubtitleCues(
        doc,
        entries,
        trackName || t("subtitle.track"),
        offset,
      );
      break;
    }
    case "marker.add": {
      const time = asNumber(payload.time, "time");
      if (time < 0) invalid("time 不能为负");
      const name =
        payload.name === undefined ? "" : asString(payload.name, "name").trim();
      const color =
        payload.color === undefined ? undefined : asString(payload.color, "color");
      next = addMarker(doc, {
        id: crypto.randomUUID(),
        time,
        name: name || t("marker.defaultName", { n: doc.markers.length + 1 }),
        ...(color ? { color } : {}),
      });
      break;
    }
    case "marker.update": {
      const markerId = asString(payload.markerId, "markerId");
      const patch = asRecord(payload.patch, "patch");
      const clean: { time?: number; name?: string; color?: string } = {};
      if (patch.time !== undefined) clean.time = asNumber(patch.time, "time");
      if (patch.name !== undefined) clean.name = asString(patch.name, "name");
      if (patch.color !== undefined) clean.color = asString(patch.color, "color");
      next = updateMarker(doc, markerId, clean);
      break;
    }
    case "marker.remove": {
      next = removeMarker(doc, asString(payload.markerId, "markerId"));
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

/**
 * 顺序应用一批命令。整批在草稿上执行，任何一条失败都会抛出，
 * 调用方（project store）因此可以做到「全成功才提交」。
 */
export function applyCommandsToDoc(doc: Project, commands: Command[]): ApplyResult {
  let next = doc;
  const affected: Affected[] = [];
  for (const command of commands) {
    const step = applyCommandToDoc(next, command);
    affected.push(step.affected);
    next = step.doc;
  }
  return { doc: next, affected: mergeAffected(affected) };
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
