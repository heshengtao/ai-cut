/** 前端媒体层：Tauri 命令封装 + webview 可用的文件 URL。 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { AssetKind, MediaAsset } from "@/types/project";
import { t } from "@/i18n";

/** `probe_media` 的返回。 */
export interface MediaMeta {
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_video: boolean;
  has_audio: boolean;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "tiff"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv", "flv", "ts"]);
const AUDIO_EXTS = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif"]);

/** 取路径中的文件名（兼容 `\\` 与 `/`）。 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 按扩展名判定素材类型；不支持的类型返回 null。 */
export function kindFromPath(path: string): AssetKind | null {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

/** 绝对路径 → webview 可直接用于 <video>/<img>/<audio> 的 URL。 */
export function fileUrl(path: string): string {
  return convertFileSrc(path);
}

/** 缓存文件名 → 绝对路径（与 Rust 侧 `cache_dir` 对应）。 */
export async function cacheFilePath(name: string): Promise<string> {
  return join(await appDataDir(), "cache", name);
}

export function probeMedia(path: string): Promise<MediaMeta> {
  return invoke<MediaMeta>("probe_media", { path });
}

export function makeThumbnail(path: string, assetId: string, atSec: number): Promise<string> {
  return invoke<string>("make_thumbnail", { path, assetId, atSec });
}

export function makeWaveform(path: string, assetId: string): Promise<number[]> {
  return invoke<number[]>("make_waveform", { path, assetId });
}

export function readProjectFile(path: string): Promise<string> {
  return invoke<string>("read_project", { path });
}

export function writeProjectFile(path: string, json: string): Promise<void> {
  return invoke<void>("write_project", { path, json });
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

/** 原生文件框的媒体过滤器（按当前语言生成）。 */
function mediaFilter(): { name: string; extensions: string[] } {
  return {
    name: t("media.fileFilter"),
    extensions: [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS],
  };
}

/** 原生文件框：选一个或多个素材。取消返回空数组。 */
export async function pickMediaFiles(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, filters: [mediaFilter()] });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** 原生文件框：打开工程。取消返回 null。 */
export async function pickProjectFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: t("project.fileFilter"), extensions: ["json"] }],
  });
  return typeof picked === "string" ? picked : null;
}

/** 原生文件框：另存为工程路径。取消返回 null。 */
export async function pickSaveProjectPath(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${defaultName}.json`,
    filters: [{ name: t("project.fileFilter"), extensions: ["json"] }],
  });
  return picked ?? null;
}

/**
 * 导入一个素材文件：探测元数据、尽力生成缩略图与波形。
 * 缩略图/波形是「尽力而为」——失败不影响素材可用。
 */
export async function importAssetAt(path: string): Promise<MediaAsset> {
  const kind = kindFromPath(path);
  if (!kind) throw new Error(t("error.unsupportedType", { name: baseName(path) }));

  const meta = await probeMedia(path);
  const name = baseName(path);
  const duration = kind === "image" ? 0 : meta.duration;
  if (kind !== "image" && !(duration > 0)) throw new Error(t("error.noDuration", { name }));

  const id = crypto.randomUUID();
  const asset: MediaAsset = {
    id,
    name,
    kind,
    src: path,
    duration,
    addedAt: Date.now(),
    ...(meta.width !== null ? { width: meta.width } : {}),
    ...(meta.height !== null ? { height: meta.height } : {}),
    ...(meta.fps !== null ? { fps: meta.fps } : {}),
    hasAudio: meta.has_audio,
  };

  const thumbAt = kind === "image" ? 0 : Math.min(1, duration / 2);
  try {
    const thumbName = await makeThumbnail(path, id, thumbAt);
    asset.thumb = await cacheFilePath(thumbName);
  } catch {
    /* 缩略图失败：卡片退化为纯色占位 */
  }
  if (meta.has_audio) {
    try {
      asset.wave = await makeWaveform(path, id);
    } catch {
      /* 波形失败：片段块不画波形 */
    }
  }
  return asset;
}

/** 原生文件框：选择导出文件路径。取消返回 null；缺扩展名时自动补上。 */
export async function pickExportPath(
  defaultName: string,
  extension: string,
  label: string,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${defaultName}.${extension}`,
    filters: [{ name: label, extensions: [extension] }],
  });
  if (!picked) return null;
  return picked.toLowerCase().endsWith(`.${extension}`) ? picked : `${picked}.${extension}`;
}

/** 自动保存/恢复草稿的路径（应用数据目录下 recovery/autosave.json）。 */
export async function recoveryPath(): Promise<string> {
  const dir = await join(await appDataDir(), "recovery");
  return join(dir, "autosave.json");
}

/** 读恢复草稿；不存在返回 null。 */
export async function recoveryRead(): Promise<string | null> {
  try {
    return await readProjectFile(await recoveryPath());
  } catch {
    return null;
  }
}

export async function recoveryWrite(json: string): Promise<void> {
  await writeProjectFile(await recoveryPath(), json);
}
