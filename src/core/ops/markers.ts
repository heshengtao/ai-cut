/** 时间线标记 ops：增删改，始终保持按时间排序。 */
import type { Marker, Project } from "@/types/project";
import { withTouch } from "./internal";

function sortMarkers(markers: Marker[]): Marker[] {
  return markers.slice().sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}

function normalizeMarker(marker: Marker): Marker {
  return {
    ...marker,
    time: Math.max(0, marker.time),
    name: marker.name.trim(),
  };
}

export function addMarker(doc: Project, marker: Marker): Project {
  const next = normalizeMarker(marker);
  if (doc.markers.some((candidate) => candidate.id === next.id)) return doc;
  return withTouch(doc, { markers: sortMarkers([...doc.markers, next]) });
}

export function updateMarker(
  doc: Project,
  markerId: string,
  patch: Partial<Pick<Marker, "time" | "name" | "color">>,
): Project {
  const index = doc.markers.findIndex((marker) => marker.id === markerId);
  if (index < 0) return doc;
  const current = doc.markers[index];
  const next = normalizeMarker({ ...current, ...patch });
  if (
    next.time === current.time &&
    next.name === current.name &&
    next.color === current.color
  ) {
    return doc;
  }
  const markers = doc.markers.slice();
  markers[index] = next;
  return withTouch(doc, { markers: sortMarkers(markers) });
}

export function removeMarker(doc: Project, markerId: string): Project {
  const markers = doc.markers.filter((marker) => marker.id !== markerId);
  if (markers.length === doc.markers.length) return doc;
  return withTouch(doc, { markers });
}
