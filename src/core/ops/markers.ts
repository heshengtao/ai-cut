/** 时间线标记 ops：增删改，始终保持按时间排序。 */
import type { Marker, MarkerKind, Project, ReviewBBox, ReviewSeverity } from "@/types/project";
import { withTouch } from "./internal";

const MARKER_KINDS: MarkerKind[] = ["scene", "hit", "review", "chapter"];
const SEVERITIES: ReviewSeverity[] = ["blocker", "high", "medium", "low"];

/** 标记可改写字段；`bbox: null` / 空字符串用于显式清除。 */
export type MarkerPatch = Omit<
  Partial<Marker>,
  "id" | "updatedAt" | "bbox" | "severity"
> & {
  bbox?: ReviewBBox | null;
  severity?: ReviewSeverity | null;
};

function sortMarkers(markers: Marker[]): Marker[] {
  return markers.slice().sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}

function normalizeBBox(input: ReviewBBox | null | undefined): ReviewBBox | undefined {
  if (!input) return undefined;
  const values = [input.x, input.y, input.width, input.height];
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return {
    x: Math.min(1, Math.max(0, input.x)),
    y: Math.min(1, Math.max(0, input.y)),
    width: Math.min(1, Math.max(0, input.width)),
    height: Math.min(1, Math.max(0, input.height)),
  };
}

type MarkerInput = Omit<Marker, "bbox" | "severity"> & {
  bbox?: ReviewBBox | null;
  severity?: ReviewSeverity | null;
};

function normalizeMarker(marker: MarkerInput): Marker {
  const kind = MARKER_KINDS.includes(marker.kind as MarkerKind) ? marker.kind : undefined;
  const severity = SEVERITIES.includes(marker.severity as ReviewSeverity)
    ? marker.severity
    : undefined;
  const note = marker.note?.trim();
  const sceneId = marker.sceneId?.trim();
  const screenshot = marker.screenshot?.trim();
  const tags = marker.tags?.map((tag) => tag.trim()).filter(Boolean);
  const bbox = normalizeBBox(marker.bbox);
  return {
    id: marker.id,
    time: Math.max(0, marker.time),
    name: marker.name.trim(),
    ...(marker.color ? { color: marker.color } : {}),
    ...(kind ? { kind } : {}),
    ...(sceneId ? { sceneId } : {}),
    ...(note ? { note } : {}),
    ...(severity ? { severity } : {}),
    ...(marker.resolved === true ? { resolved: true } : {}),
    ...(bbox ? { bbox } : {}),
    ...(screenshot ? { screenshot } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(typeof marker.createdAt === "number" ? { createdAt: marker.createdAt } : {}),
  };
}

function sameBBox(a?: ReviewBBox, b?: ReviewBBox): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameMarker(a: Marker, b: Marker): boolean {
  return (
    a.time === b.time &&
    a.name === b.name &&
    a.color === b.color &&
    a.kind === b.kind &&
    a.sceneId === b.sceneId &&
    a.note === b.note &&
    a.severity === b.severity &&
    a.resolved === b.resolved &&
    sameBBox(a.bbox, b.bbox) &&
    a.screenshot === b.screenshot &&
    (a.tags ?? []).join("\u0000") === (b.tags ?? []).join("\u0000") &&
    a.createdAt === b.createdAt
  );
}

export function addMarker(doc: Project, marker: Marker): Project {
  const now = Date.now();
  const next = normalizeMarker({ createdAt: now, ...marker });
  if (doc.markers.some((candidate) => candidate.id === next.id)) return doc;
  return withTouch(doc, { markers: sortMarkers([...doc.markers, next]) });
}

export function updateMarker(doc: Project, markerId: string, patch: MarkerPatch): Project {
  const index = doc.markers.findIndex((marker) => marker.id === markerId);
  if (index < 0) return doc;
  const current = doc.markers[index];
  const next = normalizeMarker({ ...current, updatedAt: Date.now(), ...patch });
  if (sameMarker(current, next)) return doc;
  const markers = doc.markers.slice();
  markers[index] = next;
  return withTouch(doc, { markers: sortMarkers(markers) });
}

export function removeMarker(doc: Project, markerId: string): Project {
  const markers = doc.markers.filter((marker) => marker.id !== markerId);
  if (markers.length === doc.markers.length) return doc;
  return withTouch(doc, { markers });
}
