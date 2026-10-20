/** 工程动作：顶栏按钮与快捷键共用。 */
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useLayoutStore } from "@/stores/layout";
import { useExportStore } from "@/stores/export";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import { t } from "@/i18n";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProjectActions() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const layout = useLayoutStore();
  const exportStore = useExportStore();

  async function newProject(): Promise<void> {
    try {
      if (
        project.dirty &&
        !(await confirm({
          title: t("confirm.unsavedTitle"),
          message: t("confirm.unsavedNew"),
          confirmText: t("confirm.newProject"),
          destructive: true,
        }))
      ) {
        return;
      }
      project.newProject();
    } catch (error) {
      toast(t("error.operation", { error: errorText(error) }), "error");
    }
  }

  async function openProject(): Promise<void> {
    try {
      if (
        project.dirty &&
        !(await confirm({
          title: t("confirm.unsavedTitle"),
          message: t("confirm.unsavedOpen"),
          confirmText: t("confirm.continueOpen"),
          destructive: true,
        }))
      ) {
        return;
      }
      await project.open();
    } catch (error) {
      toast(t("error.open", { error: errorText(error) }), "error");
    }
  }

  async function saveProject(): Promise<void> {
    try {
      const saved = await project.save();
      if (saved) toast(t("toast.saved"));
    } catch (error) {
      toast(t("error.save", { error: errorText(error) }), "error");
    }
  }

  async function saveProjectAs(): Promise<void> {
    try {
      const saved = await project.saveAs();
      if (saved) toast(t("toast.savedAs"));
    } catch (error) {
      toast(t("error.save", { error: errorText(error) }), "error");
    }
  }

  function renameProject(name: string): void {
    project.rename(name);
  }

  function exportVideo(): void {
    exportStore.openDialog();
  }

  function openSettings(): void {
    playback.playing = false;
    layout.openSettings();
  }

  function closeSettings(): void {
    layout.closeSettings();
  }

  function toggleSettings(): void {
    if (layout.settingsOpen) closeSettings();
    else openSettings();
  }

  return {
    newProject,
    openProject,
    saveProject,
    saveProjectAs,
    renameProject,
    exportVideo,
    openSettings,
    closeSettings,
    toggleSettings,
  };
}
