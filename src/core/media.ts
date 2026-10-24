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
  rotation: number | null;
  has_video: boolean;
  has_audio: boolean;
  format_name: string;
  video_codec: string | null;
  audio_codec: string | null;
}

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "avif", "heic", "heif",
  "tif", "tiff", "ico", "svg",
]);
const VIDEO_EXTS = new Set([
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "mpg", "mpeg", "m2v",
  "ts", "m2ts", "mts", "wmv", "flv", "vob", "ogv", "3gp", "3g2",
  "mxf", "asf", "rm", "rmvb", "dv",
]);
const AUDIO_EXTS = new Set([
  "wav", "mp3", "mp2", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus",
  "aiff", "aif", "aifc", "wma", "mka", "ac3", "eac3", "dts", "amr", "caf",
  "ape", "wv",
]);

/** WebView 能直接播放的容器；其余先经 ffmpeg 生成代理。 */
const DIRECT_VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm"]);
/** WebAudio 能稳定解码的音频；视频音轨统一走抽取。 */
const DIRECT_AUDIO_EXTS = new Set([
  "wav", "mp3", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "aif", "aiff", "aifc",
]);

/** 取路径中的文件名（兼容 `\\` 与 `/`）。 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : path;
}

/** 取小写扩展名（没有则返回空串）。 */
export function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** 按扩展名判定素材类型；不支持的类型返回 null。 */
export function kindFromPath(path: string): AssetKind | null {
  const ext = extOf(path);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

/** 该视频是否需要 ffmpeg 预览代理（MKV / AVI / WMV…）。 */
export function needsVideoProxy(path: string): boolean {
  return !DIRECT_VIDEO_EXTS.has(extOf(path));
}

/** 该素材的音轨是否需要先转成通用格式。视频一律抽取，避免整段读进内存。 */
export function needsAudioProxy(kind: AssetKind, path: string): boolean {
  if (kind === "video") return true;
  return kind === "audio" && !DIRECT_AUDIO_EXTS.has(extOf(path));
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

export interface FileStamp {
  exists: boolean;
  size: number;
  mtimeMs: number;
}

/** 文件戳：增量渲染缓存用它判断素材是否变化。 */
export function fileStamp(path: string): Promise<FileStamp> {
  return invoke<FileStamp>("file_stamp", { path });
}

export function makeThumbnail(path: string, assetId: string, atSec: number): Promise<string> {
  return invoke<string>("make_thumbnail", { path, assetId, atSec });
}

export function makeWaveform(path: string, assetId: string): Promise<number[]> {
  return invoke<number[]>("make_waveform", { path, assetId });
}

/** 同一素材的转码只跑一次：界面多处同时请求时共享同一个 Promise。 */
function cachedPreview(
  cache: Map<string, Promise<string>>,
  key: string,
  run: () => Promise<string>,
): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = run().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

const audioPreviewCache = new Map<string, Promise<string>>();
const videoPreviewCache = new Map<string, Promise<string>>();

/** 任意素材的音轨 → 缓存 M4A（AAC），供 WebAudio 解码。 */
export function extractAudioPreview(path: string, assetId: string): Promise<string> {
  return cachedPreview(audioPreviewCache, `${assetId}:${path}`, () =>
    invoke<string>("extract_audio_preview", { path, assetId }),
  );
}

/** 任意视频素材 → H.264/AAC MP4 预览，供 `<video>` 播放。 */
export function makeVideoPreview(path: string, assetId: string): Promise<string> {
  return cachedPreview(videoPreviewCache, `${assetId}:${path}`, () =>
    invoke<string>("make_video_preview", { path, assetId }),
  );
}

export function readProjectFile(path: string): Promise<string> {
  return invoke<string>("read_project", { path });
}

export function writeProjectFile(path: string, json: string): Promise<void> {
  return invoke<void>("write_project", { path, json });
}

/** 读取任意文本文件（字幕等）；复用工程的 fs 命令。 */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_project", { path });
}

/** 写入任意文本文件（字幕等）；复用工程的 fs 命令。 */
export function writeTextFile(path: string, text: string): Promise<void> {
  return invoke<void>("write_project", { path, json: text });
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

  const name = baseName(path);
  // 图片（尤其 SVG / HEIC）不一定能被 ffprobe 读取，读不出来也允许导入。
  let meta: MediaMeta;
  try {
    meta = await probeMedia(path);
  } catch (error) {
    if (kind !== "image") throw error;
    meta = {
      duration: 0,
      width: null,
      height: null,
      fps: null,
      rotation: null,
      has_video: false,
      has_audio: false,
      format_name: "",
      video_codec: null,
      audio_codec: null,
    };
  }

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

  // 音轨先转成通用格式：解决 MOV 里的 PCM / 冷门编码放不出声的问题，
  // 同时让波形从纯音频解码，省掉一次视频解复用。
  let audioSource = path;
  if (kind !== "image" && meta.has_audio && needsAudioProxy(kind, path)) {
    try {
      audioSource = await extractAudioPreview(path, id);
    } catch {
      /* 抽取失败：回退到直接解码源文件 */
    }
  }

  const thumbAt = kind === "image" ? 0 : Math.min(1, duration / 2);
  try {
    const thumbName = await makeThumbnail(path, id, thumbAt);
    asset.thumb = await cacheFilePath(thumbName);
  } catch {
    /* 缩略图失败：卡片退化为纯色占位 */
  }
  if (meta.has_audio) {
    try {
      asset.wave = await makeWaveform(audioSource, id);
    } catch {
      /* 波形失败：片段块不画波形 */
    }
  }

  // WebView 明确放不了的容器提前转代理，避免第一次播放时黑屏等待。
  if (kind === "video" && needsVideoProxy(path)) {
    void makeVideoPreview(path, id).catch(() => undefined);
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

/** 原生文件框：选择字幕文件（.srt / .vtt）。 */
export async function pickSubtitleFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: t("subtitle.fileFilter"), extensions: ["srt", "vtt"] }],
  });
  return typeof picked === "string" ? picked : null;
}

/** 原生文件框：选择字幕导出路径；扩展名决定 SRT / VTT。 */
export async function pickSubtitleSavePath(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${defaultName}.srt`,
    filters: [{ name: t("subtitle.fileFilter"), extensions: ["srt", "vtt"] }],
  });
  if (!picked) return null;
  const lower = picked.toLowerCase();
  return lower.endsWith(".srt") || lower.endsWith(".vtt") ? picked : `${picked}.srt`;
}

/** 自动保存/恢复草稿的路径（应用数据目录下 recovery/autosave.json）。 */
export async function recoveryPath(): Promise<string> {
  const dir = await join(await appDataDir(), "recovery");
  return join(dir, "autosave.json");
}

/** 最后一次工作会话（工程内容 + 路径 + dirty），用于重启后静默恢复。 */
export async function sessionPath(): Promise<string> {
  const dir = await join(await appDataDir(), "recovery");
  return join(dir, "session.json");
}

/** 读恢复草稿；不存在返回 null。 */
export async function recoveryRead(): Promise<string | null> {
  try {
    return await readProjectFile(await recoveryPath());
  } catch {
    return null;
  }
}

/** 读最后一次工作会话；不存在返回 null。 */
export async function sessionRead(): Promise<string | null> {
  try {
    return await readProjectFile(await sessionPath());
  } catch {
    return null;
  }
}

export async function sessionWrite(json: string): Promise<void> {
  await writeProjectFile(await sessionPath(), json);
}
