/** 媒体导入：媒体库、预览区空态、时间线空态共用同一套流程与提示。 */
import { ref } from "vue";
import { addAsset } from "@/core/ops";
import { importAssetAt, pickMediaFiles } from "@/core/media";
import { insertImportedAssets } from "@/core/importInsert";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useLayoutStore } from "@/stores/layout";
import { toast } from "@/composables/useToast";
import { useI18n } from "@/i18n";
import type { MediaAsset } from "@/types/project";

export interface MediaImportOptions {
  /**
   * 导入成功后直接把素材铺到时间线（时间轴 / 预览区空态的一步到位导入）。
   * 媒体库里的导入不带这个选项：用户可能只是先把素材收进库里。
   */
  insertToTimeline?: boolean;
  /** 导入成功后把右侧边栏切到媒体库，让用户看到刚导入的素材。默认开启。 */
  revealInLibrary?: boolean;
}

export function useMediaImport() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();
  const layout = useLayoutStore();
  const i18n = useI18n();
  const importing = ref(false);

  /**
   * 选文件并导入，返回成功导入的数量（0 表示用户取消或全部失败）。
   *
   * `options.insertToTimeline` 让导入与「放到时间线」合成一步，
   * `options.revealInLibrary`（默认开）保证右侧边栏停在媒体库，看得到新素材。
   */
  async function importMedia(options: MediaImportOptions = {}): Promise<number> {
    if (importing.value) return 0;
    let picked: string[];
    try {
      picked = await pickMediaFiles();
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
    const imported: MediaAsset[] = [];
    try {
      for (const path of picked) {
        try {
          imported.push(await importAssetAt(path));
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
    if (imported.length === 0) return 0;

    // 一次导入 = 一次撤销：素材与（可选的）时间线片段在同一个事务里提交，
    // 也避免多文件导入时预览区先闪一下「没有素材」再出现片段。
    const clipIds: string[] = [];
    project.dispatch(
      (doc) => {
        let next = doc;
        for (const asset of imported) next = addAsset(next, asset);
        // 一步到位：空时间轴 / 空预览区点导入，素材直接落在播放头处。
        if (options.insertToTimeline) {
          const result = insertImportedAssets(next, imported, playback.playhead);
          clipIds.push(...result.clipIds);
          next = result.doc;
        }
        return next;
      },
      { kind: "ui.dispatch", actor: "human", label: i18n.t("media.importMedia") },
    );

    // 选中最后一段，用户可以直接按 Delete / 打开检查器继续调整。
    if (options.insertToTimeline && clipIds.length > 0) {
      selection.select(clipIds[clipIds.length - 1]);
    }

    // 时长未知的素材只进了媒体库：如实退回普通「已导入」提示。
    const placedAll = clipIds.length === imported.length;
    if (options.insertToTimeline && placedAll) {
      toast(i18n.t("media.importedToTimeline", { count: imported.length }));
    } else {
      toast(i18n.t("media.imported", { count: imported.length }));
    }
    if (options.revealInLibrary !== false) layout.openTab("media");

    return imported.length;
  }

  return { importing, importMedia };
}
