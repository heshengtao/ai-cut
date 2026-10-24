/**
 * film.json：AI CUT 与 AI DAW 共享的影片清单。
 *
 * 时间单位统一为秒；`music` 块归 AI DAW 所有，AI CUT 只透传不生成。
 * 解析函数只做校验与路径解析，不读写文件。
 */
import type { ReviewBBox, ReviewSeverity } from "@/types/project";

export const FILM_MANIFEST_VERSION = 1;

export const REVIEW_SEVERITIES: ReviewSeverity[] = ["blocker", "high", "medium", "low"];

export interface FilmReviewNote {
  id?: string;
  /** 时间线时间（秒）。 */
  t: number;
  text: string;
  severity?: ReviewSeverity;
  resolved?: boolean;
  bbox?: ReviewBBox;
  /** 截图路径；相对 manifest 目录或绝对路径。 */
  screenshot?: string;
  tags?: string[];
}

export interface FilmScene {
  id: string;
  t0: number;
  t1: number;
  title?: string;
  /** 这一场的渲染产物（MP4）；相对 manifest 目录或绝对路径。 */
  take?: string;
  /** 穿越 / 切点时间（秒）。 */
  markers?: number[];
  review?: FilmReviewNote[];
}

export interface FilmMusicCue {
  scene?: string;
  t0: number;
  t1: number;
  /** 语义音色名，例如 guqin-like；由 AI DAW 解释。 */
  instrument?: string;
  stem?: string;
  gainDb?: number;
}

export interface FilmMusic {
  bpm: number;
  key?: string;
  bars?: number;
  /** bar 1 / beat 0 对应的影片时间（秒）。 */
  offset?: number;
  cues?: FilmMusicCue[];
}

export interface FilmManifest {
  version: typeof FILM_MANIFEST_VERSION;
  name?: string;
  fps?: number;
  width?: number;
  height?: number;
  duration?: number;
  scenes: FilmScene[];
  /** 不归属某一场的备注。 */
  review?: FilmReviewNote[];
  /** AI DAW 的配乐信息；AI CUT 导出时原样保留。 */
  music?: FilmMusic;
}

export interface ParsedManifest {
  manifest: FilmManifest;
  baseDir: string;
  /** scene.id → take 的绝对路径。 */
  takePaths: Map<string, string>;
  /** 原始 JSON，用于导出时保留未知字段。 */
  raw: Record<string, unknown>;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

/** 归一化分隔符与 `.` / `..`，不做磁盘访问。 */
export function normalizePath(value: string): string {
  const absolute = isAbsolutePath(value);
  const drive = /^([A-Za-z]:)[\\/]/.exec(value)?.[1] ?? "";
  const unified = value.replace(/\\/g, "/");
  const parts = unified.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else if (!absolute) stack.push("..");
      continue;
    }
    stack.push(part);
  }
  if (drive) return `${drive}/${stack.slice(1).join("/")}`;
  if (value.startsWith("//")) return `//${stack.join("/")}`;
  return absolute ? `/${stack.join("/")}` : stack.join("/");
}

export function resolveManifestPath(baseDir: string, value: string): string {
  if (isAbsolutePath(value)) return normalizePath(value);
  return normalizePath(`${baseDir}/${value}`);
}

/** manifest 目录 → 目标的相对路径；跨盘时退回绝对路径。 */
export function relativeToManifest(baseDir: string, absolute: string): string {
  const base = normalizePath(baseDir);
  const target = normalizePath(absolute);
  if (base === "" || base === ".") return target;
  const baseParts = base.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);
  const sameDrive =
    baseParts.length === 0 ||
    targetParts.length === 0 ||
    (baseParts[0].endsWith(":") === targetParts[0].endsWith(":") &&
      (!baseParts[0].endsWith(":") || baseParts[0] === targetParts[0]));
  if (!sameDrive) return target;
  let common = 0;
  while (
    common < baseParts.length &&
    common < targetParts.length &&
    baseParts[common] === targetParts[common]
  ) {
    common += 1;
  }
  const up = baseParts.length - common;
  const rest = targetParts.slice(common);
  if (up === 0 && rest.length === 0) return ".";
  return [...Array.from({ length: up }, () => ".."), ...rest].join("/");
}

function parseNote(
  value: unknown,
  label: string,
  warnings: string[],
  baseDir: string,
): FilmReviewNote | null {
  if (!isRecord(value)) {
    warnings.push(`${label} 不是对象，已忽略`);
    return null;
  }
  if (!isNumber(value.t) || value.t < 0) {
    warnings.push(`${label}.t 必须是非负数字，已忽略`);
    return null;
  }
  if (typeof value.text !== "string" || value.text.trim() === "") {
    warnings.push(`${label}.text 不能为空，已忽略`);
    return null;
  }
  const severity = REVIEW_SEVERITIES.includes(value.severity as ReviewSeverity)
    ? (value.severity as ReviewSeverity)
    : undefined;
  if (value.severity !== undefined && !severity) {
    warnings.push(`${label}.severity 非法，已丢弃`);
  }
  let bbox: ReviewBBox | undefined;
  if (isRecord(value.bbox)) {
    const x = value.bbox.x;
    const y = value.bbox.y;
    const width = value.bbox.width;
    const height = value.bbox.height;
    if (isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height)) {
      bbox = { x, y, width, height };
    } else {
      warnings.push(`${label}.bbox 字段不完整，已丢弃`);
    }
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  return {
    ...(typeof value.id === "string" && value.id ? { id: value.id } : {}),
    t: value.t,
    text: value.text,
    ...(severity ? { severity } : {}),
    ...(typeof value.resolved === "boolean" ? { resolved: value.resolved } : {}),
    ...(bbox ? { bbox } : {}),
    ...(typeof value.screenshot === "string" && value.screenshot
      ? { screenshot: resolveManifestPath(baseDir, value.screenshot) }
      : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

/** 严格校验 + 排序 + 路径解析；返回 warnings 而不是静默修正。 */
export function parseFilmManifest(raw: unknown, manifestPath: string): ParsedManifest {
  if (!isRecord(raw)) throw new Error("film.json 必须是 JSON 对象");
  if (raw.version !== FILM_MANIFEST_VERSION) {
    throw new Error(
      `不支持的 film.json 版本：${String(raw.version)}（需要 ${FILM_MANIFEST_VERSION}）`,
    );
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error("film.json 的 scenes 必须是非空数组");
  }

  const normalizedManifestPath = normalizePath(manifestPath);
  const slash = normalizedManifestPath.lastIndexOf("/");
  const baseDir =
    slash > 0
      ? normalizedManifestPath.slice(0, slash)
      : slash === 0
        ? "/"
        : ".";
  const warnings: string[] = [];
  const seen = new Set<string>();
  const takePaths = new Map<string, string>();
  const scenes: FilmScene[] = [];

  raw.scenes.forEach((item, index) => {
    const label = `scenes[${index}]`;
    if (!isRecord(item)) {
      warnings.push(`${label} 不是对象，已忽略`);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      warnings.push(`${label}.id 不能为空，已忽略`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`${label}.id 重复（${id}），已忽略`);
      return;
    }
    const t0 = isNumber(item.t0) ? item.t0 : Number.NaN;
    const t1 = isNumber(item.t1) ? item.t1 : Number.NaN;
    if (!(t0 >= 0) || !(t1 > t0)) {
      warnings.push(`${label} 的 t0/t1 非法（需要 0 <= t0 < t1），已忽略`);
      return;
    }
    seen.add(id);

    const review: FilmReviewNote[] = [];
    if (Array.isArray(item.review)) {
      item.review.forEach((note, noteIndex) => {
        const parsed = parseNote(note, `${label}.review[${noteIndex}]`, warnings, baseDir);
        if (!parsed) return;
        if (parsed.t < t0 || parsed.t > t1) {
          warnings.push(`${label}.review[${noteIndex}] 的时间 ${parsed.t} 不在场景 [${t0},${t1}] 内`);
        }
        review.push(parsed);
      });
    }

    const markers = Array.isArray(item.markers)
      ? item.markers.filter((time): time is number => isNumber(time) && time >= 0)
      : [];
    if (Array.isArray(item.markers) && markers.length !== item.markers.length) {
      warnings.push(`${label}.markers 含非法时间，已丢弃`);
    }

    const take =
      typeof item.take === "string" && item.take.trim() ? item.take.trim() : undefined;
    if (take) takePaths.set(id, resolveManifestPath(baseDir, take));

    scenes.push({
      id,
      t0,
      t1,
      ...(typeof item.title === "string" && item.title ? { title: item.title } : {}),
      ...(take ? { take } : {}),
      ...(markers.length > 0 ? { markers } : {}),
      ...(review.length > 0 ? { review } : {}),
    });
  });

  if (scenes.length === 0) throw new Error("film.json 没有可用的 scenes");
  scenes.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || a.id.localeCompare(b.id));

  for (let index = 1; index < scenes.length; index += 1) {
    const prev = scenes[index - 1];
    const current = scenes[index];
    if (current.t0 < prev.t1 - 1e-6) {
      warnings.push(
        `场景 ${prev.id} 与 ${current.id} 重叠（${current.t0} < ${prev.t1}）；按转场处理`,
      );
    }
  }

  const duration = isNumber(raw.duration) && raw.duration > 0 ? raw.duration : undefined;
  if (duration !== undefined) {
    for (const scene of scenes) {
      if (scene.t1 > duration + 1e-6) {
        warnings.push(`场景 ${scene.id} 的结束时间 ${scene.t1} 超过 duration ${duration}`);
      }
    }
  }

  const topReview: FilmReviewNote[] = [];
  if (Array.isArray(raw.review)) {
    raw.review.forEach((note, index) => {
      const parsed = parseNote(note, `review[${index}]`, warnings, baseDir);
      if (parsed) topReview.push(parsed);
    });
  }

  const music = isRecord(raw.music) ? (raw.music as unknown as FilmMusic) : undefined;

  return {
    manifest: {
      version: FILM_MANIFEST_VERSION,
      ...(typeof raw.name === "string" && raw.name ? { name: raw.name } : {}),
      ...(isNumber(raw.fps) && raw.fps > 0 ? { fps: raw.fps } : {}),
      ...(isNumber(raw.width) && raw.width > 0 ? { width: raw.width } : {}),
      ...(isNumber(raw.height) && raw.height > 0 ? { height: raw.height } : {}),
      ...(duration !== undefined ? { duration } : {}),
      scenes,
      ...(topReview.length > 0 ? { review: topReview } : {}),
      ...(music ? { music } : {}),
    },
    baseDir,
    takePaths,
    raw,
    warnings,
  };
}

/** 导出时的深合并：保留旧文件的 music 与未知顶层字段。 */
export function mergeManifest(
  previous: Record<string, unknown> | null,
  next: FilmManifest,
): Record<string, unknown> {
  const base = isRecord(previous) ? { ...previous } : {};
  return { ...base, ...next };
}
