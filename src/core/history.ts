/**
 * 历史工程：切换工程前把当前工作副本交给后端落盘。
 *
 * 写入是串行队列，避免连续切换时几个快照互相覆盖索引；打开历史列表前先
 * `flushHistoryRecords()`，保证刚被替换掉的工程已经出现在列表里。
 */
import { invoke } from "@tauri-apps/api/core";
import type { Project, ProjectHistoryEntry } from "@/types/project";
import { serializeProject } from "@/core/serialize";
import { isTauri } from "@/utils/platform";

export interface HistorySnapshot {
  project: string;
  path: string | null;
  dirty: boolean;
}

let queue: Promise<unknown> = Promise.resolve();

/** 等待所有待写入的历史快照完成。 */
export function flushHistoryRecords(): Promise<void> {
  return queue.then(() => undefined);
}

/** 取第一张可用的视频 / 图片缩略图作为卡片封面。 */
function coverThumb(project: Project): string | null {
  const video = project.assets.find((asset) => asset.kind === "video" && asset.thumb);
  return video?.thumb ?? project.assets.find((asset) => asset.thumb)?.thumb ?? null;
}

/** 记录一份历史快照；空白工程由后端跳过。 */
export function recordProjectHistory(
  project: Project,
  path: string | null,
  dirty: boolean,
): void {
  if (!isTauri()) return;
  if (project.assets.length === 0 && project.tracks.every((track) => track.clips.length === 0)) {
    return;
  }
  const projectJson = serializeProject(project);
  const thumbnail = coverThumb(project);
  queue = queue
    .then(() =>
      invoke<ProjectHistoryEntry | null>("project_history_record", {
        project: projectJson,
        path,
        dirty,
        thumbnail,
      }),
    )
    .catch(() => undefined);
}

export function listProjectHistory(): Promise<ProjectHistoryEntry[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<ProjectHistoryEntry[]>("project_history_list");
}

export function getProjectHistory(id: string): Promise<HistorySnapshot> {
  if (!isTauri()) {
    return Promise.reject(new Error("历史工程需要在桌面应用中使用"));
  }
  return invoke<HistorySnapshot>("project_history_get", { id });
}

/** 从历史列表里删除一份快照（不影响磁盘上的工程文件）。 */
export function deleteProjectHistory(id: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("project_history_delete", { id });
}
