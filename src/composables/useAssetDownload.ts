/**
 * 把素材"下载到本地"：弹原生保存框，再把文件复制到用户选的位置。
 *
 * 桌面走 Tauri 保存框，浏览器走 daemon 分配的导出路径（`new_export_path`），
 * 复制本身是同一个 rust 命令 `copy_file`。
 */
import { useI18n } from "@/i18n";
import { copyFileTo, pickExportPath } from "@/core/media";
import { toast } from "@/composables/useToast";
import type { MediaAsset } from "@/types/project";

export function useAssetDownload() {
  const i18n = useI18n();

  async function download(asset: MediaAsset): Promise<boolean> {
    const dot = asset.name.lastIndexOf(".");
    const base = dot > 0 ? asset.name.slice(0, dot) : asset.name;
    const extension = dot > 0 ? asset.name.slice(dot + 1) : "bin";
    const destination = await pickExportPath(base || "asset", extension, extension.toUpperCase());
    if (!destination) return false;
    try {
      await copyFileTo(asset.src, destination);
      toast(i18n.t("board.download.done", { name: base || asset.name }));
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
  }

  return { download };
}
