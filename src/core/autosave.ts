/**
 * 自动保存与崩溃恢复。
 *
 * 写入的是应用数据目录下的 `recovery/autosave.json`，与用户显式保存的工程文件分开——
 * 草稿永远不覆盖用户的工程文件。
 */
import { watch } from "vue";
import { parseProject, serializeProject } from "@/core/serialize";
import { recoveryRead, recoveryWrite } from "@/core/media";
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { t } from "@/i18n";

/** 自动保存的防抖时长（毫秒）。 */
const AUTOSAVE_DEBOUNCE_MS = 2000;

export function startAutosave(): void {
  const project = useProjectStore();
  let timer: number | undefined;

  watch(
    () => project.doc,
    () => {
      if (!project.dirty) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void recoveryWrite(serializeProject(project.doc)).catch(() => {
          // 自动保存失败不打扰用户：写不进去（磁盘满/权限）时静默跳过
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  );
}

/** 启动时检查是否有比当前工程更新的恢复草稿。 */
export async function checkRecovery(): Promise<void> {
  const project = useProjectStore();

  if (project.dirty) return; // 已经有未保存的工作，不打断

  let draft: ReturnType<typeof parseProject> | null = null;
  try {
    const json = await recoveryRead();
    if (!json) return;
    draft = parseProject(json);
  } catch {
    return; // 草稿损坏：忽略
  }

  const newer = project.filePath === null || draft.updatedAt > project.doc.updatedAt;
  if (!newer || draft.tracks.every((t) => t.clips.length === 0)) return;

  const when = new Date(draft.updatedAt).toLocaleString();
  const restore = await confirm({
    title: t("confirm.recoveryTitle"),
    message: t("confirm.recoveryMessage", { when }),
    confirmText: t("confirm.restore"),
    cancelText: t("confirm.discard"),
  });
  if (!restore) return;

  project.reset(draft, project.filePath);
  project.dirty = true;
  toast(t("toast.recoveryRestored"));
}
