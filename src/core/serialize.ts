/** 工程文档 ↔ JSON。解析时做结构校验，避免坏文件把内存里的工程搞崩。 */
import type { Project, Track } from "@/types/project";
import { PROJECT_VERSION } from "@/types/project";
import { t } from "@/i18n";

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function assertProjectShape(value: unknown): asserts value is Project {
  if (!isObject(value)) throw new Error(t("error.serialize.notObject"));
  if (value.version !== PROJECT_VERSION) {
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
  if (!Array.isArray(value.tracks)) throw new Error(t("error.serialize.badTracks"));

  for (const track of value.tracks) {
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

/** 兼容旧工程：缺省 visible 视为 true，旧的 solo 字段丢弃，缺省 markers 为空。 */
function normalizeProject(project: Project): Project {
  const tracks = project.tracks.map((track) => {
    const record = { ...(track as unknown as Record<string, unknown>) };
    const visible = record.visible !== false;
    delete record.solo;
    return { ...(record as unknown as Track), visible };
  });
  const markers = Array.isArray(project.markers)
    ? project.markers
        .filter((marker) => isObject(marker) && isNumber(marker.time))
        .map((marker) => ({
          id: typeof marker.id === "string" && marker.id ? marker.id : crypto.randomUUID(),
          time: Math.max(0, marker.time),
          name: typeof marker.name === "string" ? marker.name : "",
          ...(typeof marker.color === "string" ? { color: marker.color } : {}),
        }))
    : [];
  return { ...project, tracks, markers };
}

export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(t("error.serialize.badJson"));
  }
  assertProjectShape(raw);
  return normalizeProject(raw);
}
