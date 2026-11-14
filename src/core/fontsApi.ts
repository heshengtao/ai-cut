/** 字体库 IPC：Fontsource 注册表、安装 / 删除、进度事件。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import { isTauri } from "@/utils/platform";
import { pickLocalFiles, uploadLocalFile } from "@/platform/files";

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
  // 浏览器端也走 daemon 的字体目录：下载与落盘都在服务端做，共用同一份实现。
  return invoke("font_install", { id, weights });
}

export function cancelFontInstall(id?: string): Promise<void> {
  return invoke("font_cancel", { id });
}

export function removeFont(id: string): Promise<void> {
  return invoke("font_remove", { id });
}

export function revealFont(id: string): Promise<void> {
  // 在系统文件管理器里打开目录只有桌面端能做。
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
  return invoke("font_import", { path, family, weight, style });
}

export function onFontProgress(handler: (progress: FontProgress) => void): Promise<UnlistenFn> {
  return listen<FontProgress>(EVENT_FONT, (event) => handler(event.payload));
}

/** 工程里存的是字体 id；Fontsource 安装项的 id 与目录名都是 `fs-<sourceId>`。 */
export function fontsourceId(sourceId: string): string {
  return `fs-${sourceId}`;
}

/** 选一个本地字体文件；浏览器里先上传到 daemon，拿回服务端路径。 */
export async function pickFontFile(): Promise<string | null> {
  if (!isTauri()) {
    const [file] = await pickLocalFiles(".ttf,.otf,.woff,.woff2", false);
    return file ? await uploadLocalFile(file) : null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  return path ?? null;
}
