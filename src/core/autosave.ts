/**
 * 自动保存与重启恢复。
 *
 * 每次文档变化都把「工程内容 + 文件路径 + dirty」写进应用数据目录的
 * `recovery/session.json`；下次启动时直接静默载入，不再弹确认框。
 * 旧版的 `recovery/autosave.json` 仍会作为兜底读取一次。
 */
import { watch } from "vue";
import { parseProject, serializeProject } from "@/core/serialize";
import { recoveryRead, sessionRead, sessionWrite } from "@/core/media";
import type { Project } from "@/types/project";
import { flushHistoryRecords, recordProjectHistory } from "@/core/history";
import { useProjectStore } from "@/stores/project";

/** 自动保存的防抖时长（毫秒）。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

interface SessionSnapshot {
  project: string;
  path: string | null;
  dirty: boolean;
  savedAt: number;
}

interface RestoredSession {
  project: Project;
  path: string | null;
  dirty: boolean;
}

function parseSession(json: string): RestoredSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (typeof record.project === "string") {
      return {
        project: parseProject(record.project),
        path: typeof record.path === "string" ? record.path : null,
        dirty: record.dirty === true,
      };
    }
  }

  // 旧版草稿就是工程 JSON 本身。
  return { project: parseProject(json), path: null, dirty: true };
}

function isBlank(project: Project): boolean {
  return (
    project.assets.length === 0 &&
    project.tracks.every((track) => track.clips.length === 0)
  );
}

export function startAutosave(): void {
  const project = useProjectStore();
  let timer: number | undefined;

  const schedule = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void writeSession().catch(() => {
        // 自动保存失败不打扰用户：写不进去（磁盘满/权限）时静默跳过
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  watch([() => project.doc, () => project.filePath, () => project.dirty], schedule);
}

async function writeSession(): Promise<void> {
  const project = useProjectStore();
  const snapshot: SessionSnapshot = {
    project: serializeProject(project.doc),
    path: project.filePath,
    dirty: project.dirty,
    savedAt: Date.now(),
  };
  await sessionWrite(JSON.stringify(snapshot));
}

let restoreStarted = false;

/** 启动时静默载入上次的工程；没有会话或内容为空时什么都不做。 */
export async function restoreLastSession(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;

  const project = useProjectStore();
  let session: RestoredSession | null = null;
  try {
    const json = (await sessionRead()) ?? (await recoveryRead());
    if (json) session = parseSession(json);
  } catch {
    return;
  }
  if (!session || isBlank(session.project)) return;

  project.busy = true;
  try {
    project.reset(await project.markOfflineAssets(session.project), session.path);
    project.dirty = session.dirty;

    // 当前工程也放进历史列表，重启后不会只剩一份孤零零的自动保存。
    recordProjectHistory(project.doc, session.path, session.dirty);
    await Promise.all([flushHistoryRecords(), writeSession().catch(() => undefined)]);
  } finally {
    project.busy = false;
  }
}
