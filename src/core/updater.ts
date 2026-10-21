/**
 * 自动更新：Tauri `updater` 插件的薄封装（仅桌面端）。
 *
 * 更新源是 GitHub Releases 上的 `latest.json`，端点与验签公钥在
 * `src-tauri/tauri.conf.json` 的 `plugins.updater` 里配置。浏览器预览里
 * 所有调用都退化成「已是最新 / 无事可做」。
 */
import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@/utils/platform";

/** 一次更新检查的结果（供界面展示；不含插件内部句柄）。 */
export interface UpdateInfo {
  /** 新版本号。 */
  version: string;
  /** 当前正在运行的版本号。 */
  currentVersion: string;
  /** 更新说明（Releases 的 notes）。 */
  notes: string | null;
  /** 发布时间（RFC 3339）。 */
  date: string | null;
}

/** 待安装的更新句柄：`checkUpdate` 拿到、`downloadAndInstall` 用它。 */
let pending: Update | null = null;

/** 当前应用版本号（来自 `tauri.conf.json` 的 `version`）。 */
export async function currentVersion(): Promise<string> {
  if (!isTauri()) return "0.0.0";
  return getVersion();
}

/** 查一次更新；返回 `null` 表示已是最新。 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  const found = await check();
  pending = found;
  if (!found) return null;
  return {
    version: found.version,
    currentVersion: found.currentVersion,
    notes: found.body ?? null,
    date: found.date ?? null,
  };
}

/**
 * 下载并安装已发现的更新（装完由调用方重启到新版本）。
 * `onProgress` 收到累计已下载字节与总字节（总长未知时为 0）。
 */
export async function downloadAndInstall(
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  if (!isTauri()) return;
  const update = pending;
  if (!update) throw new Error("no update to install");
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    } else {
      downloaded = total;
    }
    onProgress(downloaded, total);
  });
  pending = null;
}

/** 重启应用（让新装好的版本生效）。 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  await relaunch();
}
