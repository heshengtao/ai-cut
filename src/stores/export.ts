/**
 * 导出 store：设置、预检、进度与取消。
 *
 * 进度监听放在这里而不是组件里——切换右侧面板标签不会中断导出，也不会丢进度。
 */
import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ExportOptions } from "@/types/export";
import { EXPORT_FORMATS } from "@/types/export";
import { buildExportPlan, collectUsedAssets, resolveDimensions } from "@/core/export/plan";
import { safeFileName } from "@/core/export/escape";
import {
  cancelExport,
  onExportProgress,
  startExport,
  writeExportTextImage,
} from "@/core/export/api";
import { dataUrlToBase64, renderTextLayerPng, textLayerName } from "@/core/export/textLayer";
import { maskLayerName, renderMaskLayerPng } from "@/core/export/maskLayer";
import { pathExists, pickExportPath } from "@/core/media";
import { isVisible, projectDuration } from "@/core/playback/activeClips";
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";
import { t } from "@/i18n";

export type ExportStatus = "idle" | "exporting" | "done" | "error";

export const useExportStore = defineStore("export", () => {
  const project = useProjectStore();

  const status = ref<ExportStatus>("idle");
  const dialogOpen = ref(false);
  const options = reactive<ExportOptions>({
    format: "mp4",
    resolution: "project",
    width: null,
    height: null,
    fps: null,
    quality: "standard",
    fit: "contain",
    fitAnchor: "center",
    gifColors: 256,
    gifDither: "sierra2_4a",
    gifLoop: 0,
  });
  const progress = ref(0);
  const seconds = ref(0);
  const duration = ref(0);
  const outputPath = ref<string | null>(null);
  const warnings = ref<string[]>([]);
  const errorMessage = ref("");

  let cancelRequested = false;
  let unlisten: UnlistenFn | null = null;

  /** 当前设置对应的输出规格（未导出时也用于 UI 摘要）。 */
  const outputSpec = computed(() => resolveDimensions(project.doc, options));

  async function ensureProgressListener(): Promise<void> {
    if (unlisten) return;
    unlisten = await onExportProgress((p) => {
      progress.value = p.fraction;
      seconds.value = p.seconds;
    });
  }

  /** `targetPath` 由智能体/MCP 显式给出时跳过原生保存对话框。 */
  async function start(targetPath?: string): Promise<string | null> {
    if (status.value === "exporting") return null;
    errorMessage.value = "";
    warnings.value = [];

    try {
      const doc = project.doc;
      if (!(projectDuration(doc) > 0)) {
        throw new Error(t("export.emptyTimeline"));
      }

      const missing: string[] = [];
      for (const asset of collectUsedAssets(doc)) {
        if (asset.offline || !(await pathExists(asset.src))) missing.push(asset.name);
      }
      if (missing.length > 0) {
        throw new Error(
          t("export.missingAssets", { names: missing.join(t("common.listSeparator")) }),
        );
      }

      const meta = EXPORT_FORMATS[options.format];
      const path =
        targetPath ??
        (await pickExportPath(
          safeFileName(doc.name),
          meta.extension,
          t(meta.labelKey),
        ));
      if (!path) return null;

      // 文字片段先用 Canvas 渲染成透明 PNG，导出时作为叠层使用。
      const spec = outputSpec.value;
      const textImages = new Map<string, string>();
      for (const track of doc.tracks) {
        if (!isVisible(track)) continue;
        for (const clip of track.clips) {
          const text = (clip.text ?? "").trim();
          if (text === "" || !(clip.duration > 0)) continue;
          const dataUrl = renderTextLayerPng(clip, spec.width, spec.height, doc.height);
          if (!dataUrl) throw new Error(t("export.textRenderFailed"));
          const imagePath = await writeExportTextImage(
            textLayerName(clip.id, spec.width, spec.height),
            dataUrlToBase64(dataUrl),
          );
          textImages.set(clip.id, imagePath);
        }
      }

      const maskImages = new Map<string, string>();
      for (const track of doc.tracks) {
        if (!isVisible(track)) continue;
        for (const clip of track.clips) {
          if (!clip.mask) continue;
          const dataUrl = renderMaskLayerPng(clip, spec.width, spec.height);
          if (!dataUrl) continue;
          const imagePath = await writeExportTextImage(
            maskLayerName(clip.id),
            dataUrlToBase64(dataUrl),
          );
          maskImages.set(clip.id, imagePath);
        }
      }

      const plan = buildExportPlan(doc, { ...options }, textImages, path, maskImages);
      warnings.value = plan.warnings;

      duration.value = plan.duration;
      outputPath.value = path;
      seconds.value = 0;
      progress.value = 0;
      status.value = "exporting";
      cancelRequested = false;

      await ensureProgressListener();
      await startExport({
        inputs: plan.inputs,
        filterGraph: plan.filterGraph,
        outputArgs: plan.outputArgs,
        duration: plan.duration,
      });

      progress.value = 1;
      seconds.value = plan.duration;
      status.value = "done";
      toast(t("toast.exported", { path }));
      return path;
    } catch (error) {
      if (cancelRequested) {
        status.value = "idle";
        progress.value = 0;
        seconds.value = 0;
        toast(t("toast.exportCancelled"));
      } else {
        status.value = "error";
        const message = error instanceof Error ? error.message : String(error);
        errorMessage.value = message;
        toast(t("export.failed", { error: message }), "error");
      }
      return null;
    } finally {
      cancelRequested = false;
    }
  }

  async function cancel(): Promise<void> {
    if (status.value !== "exporting") return;
    cancelRequested = true;
    await cancelExport().catch(() => undefined);
  }

  function openDialog(): void {
    dialogOpen.value = true;
  }

  /** 导出过程中不允许关闭模态框，避免看不到进度。 */
  function closeDialog(): void {
    if (status.value === "exporting") return;
    dialogOpen.value = false;
  }

  return {
    status,
    dialogOpen,
    options,
    progress,
    seconds,
    duration,
    outputPath,
    warnings,
    errorMessage,
    outputSpec,
    openDialog,
    closeDialog,
    start,
    cancel,
  };
});
