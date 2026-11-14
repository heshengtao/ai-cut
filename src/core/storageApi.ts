/** 数据目录的 Tauri 封装：查看、选择、一键迁移、清理旧目录。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type { DataDirInfo, DataDirProgress } from "@/types/storage";
import { EVENT_DATA_DIR } from "@/types/storage";
import { isTauri } from "@/utils/platform";

/** 当前数据目录概况；浏览器预览下返回 `null`。 */
export function dataDirInfo(): Promise<DataDirInfo | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<DataDirInfo>("data_dir_info");
}

/** 一键迁移：复制当前数据到 `target`，写指针，返回需要重启的新状态。 */
export function dataDirMigrate(target: string): Promise<DataDirInfo> {
  return invoke<DataDirInfo>("data_dir_migrate", { target });
}

/** 清理上一次迁移留下的旧目录，返回真正删掉的目录。 */
export function dataDirCleanupPrevious(): Promise<string[]> {
  return invoke<string[]>("data_dir_cleanup_previous");
}

/** 迁移 / 清理进度（`data-dir-progress` 事件）。 */
export function onDataDirProgress(
  handler: (progress: DataDirProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<DataDirProgress>(EVENT_DATA_DIR, (event) => handler(event.payload));
}

/** 选择数据目录：必须是新目录（迁移只往空目录里复制）。 */
export async function pickDataDir(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked ?? null;
}
