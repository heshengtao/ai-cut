/** 字体库 IPC：Fontsource 注册表、安装 / 删除、进度事件。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import { isTauri } from "@/utils/platform";

/**
 * 字体安装 / 删除要靠桌面端的字体目录与解包逻辑，浏览器模式下明确拒绝。
 *
 * 不这么写就会打到 daemon 上换来一句 `未知命令：font_install`——界面上看是"点了没反应"。
 */
function desktopOnly<T>(label: string): Promise<T> {
  return Promise.reject(new Error(`${label}需要在桌面应用中使用`));
}

/** Fontsource `/v1/fonts` 列表项（只声明用到的字段）。 */
export interface FontSourceSummary {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset?: string;
  variable?: boolean;
  category?: string;
  license?: string;
  type?: string;
  lastModified?: string;
}

export interface FontRegistry {
  /** 缓存时间（Unix 秒）。 */
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  fonts: FontSourceSummary[];
}

export interface FontFaceEntry {
  file: string;
  weight: number;
  style: string;
  subset: string;
  unicodeRange?: string | null;
}

export interface InstalledFont {
  id: string;
  family: string;
  /** `fontsource` / `local`。 */
  source: string;
  sourceId: string;
  version: string;
  license: string;
  category: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  bytes: number;
  installedAt: number;
  faces: FontFaceEntry[];
  /** 绝对目录。 */
  dir: string;
}

export interface FontProbe {
  family: string | null;
  weight: number;
  style: string;
  format: string;
  bytes: number;
}

export type FontPhase = "meta" | "download" | "write" | "done" | "error";

export interface FontProgress {
  id: string;
  phase: FontPhase;
  filesDone: number;
  filesTotal: number;
  bytes: number;
  message?: string | null;
}

export const EVENT_FONT = "font-progress";

export function fontRegistry(force = false): Promise<FontRegistry> {
  return invoke("font_registry", { force });
}

export function listFonts(): Promise<InstalledFont[]> {
  return invoke("font_list");
}

export function installFont(id: string, weights: number[]): Promise<InstalledFont> {
  if (!isTauri()) return desktopOnly("字体安装");
  return invoke("font_install", { id, weights });
}

export function cancelFontInstall(id?: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke("font_cancel", { id });
}

export function removeFont(id: string): Promise<void> {
  if (!isTauri()) return desktopOnly("删除字体");
  return invoke("font_remove", { id });
}

export function revealFont(id: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke("font_reveal", { id });
}

export function probeFont(path: string): Promise<FontProbe> {
  return invoke("font_probe", { path });
}

export function importFont(
  path: string,
  family?: string,
  weight?: number,
  style?: string,
): Promise<InstalledFont> {
  if (!isTauri()) return desktopOnly("导入字体");
  return invoke("font_import", { path, family, weight, style });
}

export function onFontProgress(handler: (progress: FontProgress) => void): Promise<UnlistenFn> {
  return listen<FontProgress>(EVENT_FONT, (event) => handler(event.payload));
}

/** 工程里存的是字体 id；Fontsource 安装项的 id 与目录名都是 `fs-<sourceId>`。 */
export function fontsourceId(sourceId: string): string {
  return `fs-${sourceId}`;
}
