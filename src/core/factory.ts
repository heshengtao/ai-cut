/** 领域对象构造器：统一 id 生成与默认值。 */
import type { Clip, ClipTextStyle, MediaAsset, Project, Track } from "@/types/project";
import { PROJECT_VERSION } from "@/types/project";
import { t } from "@/i18n";

function newId(): string {
  return crypto.randomUUID();
}

/** 下一个默认轨道名，如「轨道 2」。 */
export function nextTrackName(project: Project): string {
  return t("track.autoName", { n: project.tracks.length + 1 });
}

export function createTrack(name?: string): Track {
  return {
    id: newId(),
    name: name ?? t("track.name"),
    muted: false,
    visible: true,
    locked: false,
    clips: [],
  };
}

export function createClip(input: {
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  in?: number;
  text?: string;
  textStyle?: ClipTextStyle;
}): Clip {
  return {
    id: newId(),
    assetId: input.assetId,
    trackId: input.trackId,
    start: input.start,
    duration: input.duration,
    in: input.in ?? 0,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.textStyle !== undefined ? { textStyle: input.textStyle } : {}),
  };
}

export function createAsset(
  input: Omit<MediaAsset, "id" | "addedAt"> & { id?: string; addedAt?: number },
): MediaAsset {
  const { id, addedAt, ...rest } = input;
  return { ...rest, id: id ?? newId(), addedAt: addedAt ?? Date.now() };
}

/** 新建空工程：不预置轨道，拖入素材时再自动创建。 */
export function newProject(name = "untitled"): Project {
  const now = Date.now();
  return {
    version: PROJECT_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    tracks: [],
  };
}
