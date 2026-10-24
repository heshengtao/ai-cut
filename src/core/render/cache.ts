/**
 * 增量渲染缓存。
 *
 * 缓存键 = 裁剪到窗口内的工程 + 素材文件戳 + 输出规格。
 * 不做字段白名单：plan.ts 以后加字段也不会漏进 key。
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import type { Project } from "@/types/project";
import type {
  ExportAnchor,
  ExportFit,
  ExportOptions,
  ExportResolution,
} from "@/types/export";
import { projectDuration } from "@/core/playback/activeClips";
import { resolveDimensions } from "@/core/export/plan";
import { fileStamp, pathExists, readProjectFile, writeProjectFile } from "@/core/media";
import { renderSegment } from "@/core/export/segment";

const CACHE_KEY_VERSION = 1;
const INDEX_FILE = "index.json";

export interface RenderRangeArgs {
  start: number;
  end: number;
  outputPath?: string;
  resolution?: ExportResolution;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  fit?: ExportFit;
  fitAnchor?: ExportAnchor;
  force?: boolean;
  cache?: boolean;
}

export interface RenderRangeResult {
  path: string;
  key: string;
  cached: boolean;
  start: number;
  end: number;
  duration: number;
  width: number;
  height: number;
  elapsedMs: number;
  warnings: string[];
}

export type StaleReason = "fresh" | "no-cache" | "content-changed" | "missing-file";

export interface RangeStatus {
  id?: string;
  start: number;
  end: number;
  key: string;
  stale: boolean;
  reason: StaleReason;
  cachedPath?: string;
}

interface CacheEntry {
  path: string;
  createdAt: number;
  start: number;
  end: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

interface CacheIndex {
  version: 1;
  entries: Record<string, CacheEntry>;
}

function emptyIndex(): CacheIndex {
  return { version: 1, entries: {} };
}

/** 稳定序列化：对象 key 排序，数组保持顺序。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 无 SubtleCrypto（单元测试环境）时的确定性回退。 */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function sha256(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x9e3779b9)}`;
}

function snap(seconds: number, fps: number): number {
  if (!(fps > 0)) return Math.round(seconds * 1000) / 1000;
  return Math.round(seconds * fps) / fps;
}

interface NormalizedRange {
  start: number;
  end: number;
  fps: number;
  width: number;
  height: number;
}

function normalizeRange(
  project: Project,
  args: Pick<
    RenderRangeArgs,
    "start" | "end" | "width" | "height" | "resolution" | "fps" | "fit" | "fitAnchor"
  >,
): NormalizedRange {
  const full = projectDuration(project);
  const start = snap(Math.max(0, args.start), project.fps);
  const end = snap(Math.min(args.end, full), project.fps);
  if (!(end > start)) throw new Error("渲染区间为空（检查 start / end）");
  const custom = args.width != null || args.height != null;
  const options: ExportOptions = {
    format: "mp4",
    resolution: custom ? "custom" : args.resolution ?? "project",
    width: args.width ?? null,
    height: args.height ?? null,
    fps: args.fps ?? null,
    quality: "high",
    fit: args.fit ?? "contain",
    fitAnchor: args.fitAnchor ?? "center",
    gifColors: 256,
    gifDither: "sierra2_4a",
    gifLoop: 0,
  };
  const { width, height, fps } = resolveDimensions(project, options);
  return { start, end, fps, width, height };
}

/** 只保留与窗口相交的片段与被引用的素材。 */
function pruneProject(
  project: Project,
  range: NormalizedRange,
): { doc: unknown; assets: Project["assets"] } {
  const tracks = project.tracks
    .map((track) => ({
      ...track,
      clips: track.clips.filter(
        (clip) => clip.start < range.end && clip.start + clip.duration > range.start,
      ),
    }))
    .filter((track) => track.clips.length > 0);
  const assetIds = new Set(
    tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)).filter(Boolean),
  );
  const assets = project.assets.filter((asset) => assetIds.has(asset.id));
  return {
    doc: {
      version: project.version,
      fps: project.fps,
      width: project.width,
      height: project.height,
      tracks,
    },
    assets,
  };
}

export interface Fingerprint {
  key: string;
  range: NormalizedRange;
  cachePath: string;
}

/** 计算某段落的缓存键；素材文件戳会触发失效。 */
export async function fingerprintRange(
  project: Project,
  args: RenderRangeArgs,
): Promise<Fingerprint> {
  const range = normalizeRange(project, args);
  const { doc, assets } = pruneProject(project, range);
  const stamped = await Promise.all(
    assets.map(async (asset) => {
      const stamp = await fileStamp(asset.src);
      return {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        src: asset.src,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        fps: asset.fps,
        hasAudio: asset.hasAudio,
        offline: asset.offline,
        stamp: { exists: stamp.exists, size: stamp.size, mtimeMs: stamp.mtimeMs },
      };
    }),
  );

  const payload = {
    keyVersion: CACHE_KEY_VERSION,
    range: {
      start: range.start,
      end: range.end,
      width: range.width,
      height: range.height,
      fps: range.fps,
      fit: args.fit ?? "contain",
      fitAnchor: args.fitAnchor ?? "center",
    },
    project: doc,
    assets: stamped,
  };
  const key = await sha256(canonicalJson(payload));
  return { key, range, cachePath: await join(await cacheDir(), `${key}.mp4`) };
}

export async function cacheDir(): Promise<string> {
  return join(await appDataDir(), "cache", "render");
}

async function indexPath(): Promise<string> {
  return join(await cacheDir(), INDEX_FILE);
}

async function readIndex(): Promise<CacheIndex> {
  try {
    const text = await readProjectFile(await indexPath());
    const parsed = JSON.parse(text) as Partial<CacheIndex>;
    if (parsed.version !== 1 || typeof parsed.entries !== "object" || !parsed.entries) {
      return emptyIndex();
    }
    return { version: 1, entries: parsed.entries };
  } catch {
    return emptyIndex();
  }
}

async function writeIndex(index: CacheIndex): Promise<void> {
  await writeProjectFile(await indexPath(), JSON.stringify(index, null, 2));
}

function sameRange(entry: CacheEntry, start: number, end: number): boolean {
  return Math.abs(entry.start - start) < 1e-6 && Math.abs(entry.end - end) < 1e-6;
}

/**
 * 渲染一个区间；命中缓存时直接返回已有文件。
 * 未提供 outputPath 时产物落在应用缓存目录。
 */
export async function renderRange(
  project: Project,
  args: RenderRangeArgs,
): Promise<RenderRangeResult> {
  const started = Date.now();
  const { key, range, cachePath } = await fingerprintRange(project, args);
  const useCache = args.cache !== false;
  const index = useCache ? await readIndex() : emptyIndex();
  const existing = index.entries[key];

  if (useCache && !args.force && existing && (await pathExists(existing.path))) {
    return {
      path: existing.path,
      key,
      cached: true,
      start: range.start,
      end: range.end,
      duration: existing.duration,
      width: existing.width,
      height: existing.height,
      elapsedMs: Date.now() - started,
      warnings: [],
    };
  }

  const outputPath = args.outputPath?.trim() || cachePath;
  const result = await renderSegment(project, {
    start: range.start,
    end: range.end,
    outputPath,
    resolution: args.resolution,
    width: args.width ?? null,
    height: args.height ?? null,
    fps: args.fps ?? null,
    fit: args.fit,
    fitAnchor: args.fitAnchor,
  });

  if (useCache) {
    index.entries[key] = {
      path: result.path,
      createdAt: Date.now(),
      start: range.start,
      end: range.end,
      duration: result.duration,
      width: result.width,
      height: result.height,
      fps: range.fps,
    };
    await writeIndex(index);
  }

  return {
    path: result.path,
    key,
    cached: false,
    start: range.start,
    end: range.end,
    duration: result.duration,
    width: result.width,
    height: result.height,
    elapsedMs: Date.now() - started,
    warnings: result.warnings,
  };
}

/** 只计算脏段，不渲染。 */
export async function renderStatus(
  project: Project,
  ranges: Array<{ id?: string; start: number; end: number }>,
  options: Omit<RenderRangeArgs, "start" | "end"> = {},
): Promise<RangeStatus[]> {
  const index = await readIndex();
  const result: RangeStatus[] = [];
  for (const range of ranges) {
    const { key, range: normalized } = await fingerprintRange(project, {
      ...options,
      start: range.start,
      end: range.end,
    });
    const entry = index.entries[key];
    if (entry && (await pathExists(entry.path))) {
      result.push({
        ...(range.id ? { id: range.id } : {}),
        start: normalized.start,
        end: normalized.end,
        key,
        stale: false,
        reason: "fresh",
        cachedPath: entry.path,
      });
      continue;
    }
    const previous = Object.values(index.entries).find((candidate) =>
      sameRange(candidate, normalized.start, normalized.end),
    );
    result.push({
      ...(range.id ? { id: range.id } : {}),
      start: normalized.start,
      end: normalized.end,
      key,
      stale: true,
      reason: entry ? "missing-file" : previous ? "content-changed" : "no-cache",
    });
  }
  return result;
}

export interface RenderManifestArgs {
  scenes: Array<{ id?: string; start: number; end: number }>;
  outputDir?: string;
  force?: boolean;
  cache?: boolean;
}

export interface RenderManifestResult {
  total: number;
  rendered: number;
  cached: number;
  failed: number;
  segments: RenderRangeResult[];
  errors: Array<{ id?: string; error: string }>;
  elapsedMs: number;
}

/** 逐段渲染；串行执行，因为 ffmpeg 同一时间只允许一个进程。 */
export async function renderManifest(
  project: Project,
  args: RenderManifestArgs,
): Promise<RenderManifestResult> {
  const started = Date.now();
  const segments: RenderRangeResult[] = [];
  const errors: Array<{ id?: string; error: string }> = [];
  let rendered = 0;
  let cached = 0;

  for (const scene of args.scenes) {
    const outputPath = args.outputDir
      ? await join(args.outputDir, `${scene.id ?? `scene-${segments.length + 1}`}.mp4`)
      : undefined;
    try {
      const result = await renderRange(project, {
        start: scene.start,
        end: scene.end,
        ...(outputPath ? { outputPath } : {}),
        force: args.force,
        cache: args.cache,
      });
      segments.push(result);
      if (result.cached) cached += 1;
      else rendered += 1;
    } catch (error) {
      errors.push({
        ...(scene.id ? { id: scene.id } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: args.scenes.length,
    rendered,
    cached,
    failed: errors.length,
    segments,
    errors,
    elapsedMs: Date.now() - started,
  };
}
