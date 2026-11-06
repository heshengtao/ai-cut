/** 媒体导入：媒体库、预览区空态、时间线空态共用同一套流程与提示。 */
import { ref } from "vue";
import { addAsset } from "@/core/ops";
import { importAssetAt, pickMediaFiles } from "@/core/media";
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";
import { useI18n } from "@/i18n";

export function useMediaImport() {
  const project = useProjectStore();
  const i18n = useI18n();
  const importing = ref(false);

  /**
   * 选文件并导入。`paths` 只在需要复用系统选择结果时传；
   * 返回成功导入的数量（0 表示用户取消或全部失败）。
   */
  async function importMedia(paths?: string[]): Promise<number> {
    if (importing.value) return 0;
    let picked: string[];
    try {
      picked = paths ?? (await pickMediaFiles());
    } catch (error) {
      toast(
        i18n.t("media.importFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
      return 0;
    }
    if (picked.length === 0) return 0;

    importing.value = true;
    let added = 0;
    try {
      for (const path of picked) {
        try {
          const asset = await importAssetAt(path);
          project.dispatch((doc) => addAsset(doc, asset));
          added += 1;
        } catch (error) {
          toast(
            i18n.t("media.importFailed", {
              error: error instanceof Error ? error.message : String(error),
            }),
            "error",
          );
        }
      }
    } finally {
      importing.value = false;
    }
    if (added > 0) toast(i18n.t("media.imported", { count: added }));
    return added;
  }

  return { importing, importMedia };
}
