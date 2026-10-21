/** 导出渲染的类型与格式元数据。 */
import type { MediaAsset } from "@/types/project";

export type ExportFormat = "mp4" | "prores" | "gif";
export type ExportResolution = "project" | "1080p" | "720p" | "custom";
export type ExportQuality = "high" | "standard" | "small";
/** 素材比例与输出比例不一致时的适配方式。 */
export type ExportFit = "contain" | "cover";
/** cover 裁切时保留画面中的哪个区域。 */
export type ExportAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";
export type GifDither = "sierra2_4a" | "bayer" | "floyd_steinberg" | "none";

export const EXPORT_ANCHORS: ExportAnchor[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

export const GIF_DITHERS: GifDither[] = [
  "sierra2_4a",
  "bayer",
  "floyd_steinberg",
  "none",
];

export interface ExportOptions {
  format: ExportFormat;
  resolution: ExportResolution;
  /** resolution = custom 时的目标尺寸；只给一边时另一边按工程比例推导。 */
  width: number | null;
  height: number | null;
  /** null = 跟随工程 fps；GIF 默认 15。 */
  fps: number | null;
  quality: ExportQuality;
  /** contain 加边（默认），cover 裁切填满。 */
  fit: ExportFit;
  /** cover 时保留的区域，默认 center。 */
  fitAnchor: ExportAnchor;
  /** GIF 调色板颜色数，2–256。 */
  gifColors: number;
  gifDither: GifDither;
  /** GIF 循环次数：0 = 无限，-1 = 不循环。 */
  gifLoop: number;
}

export interface ExportPlan {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** ffmpeg 输入参数（不含输出路径）。 */
  inputs: string[];
  /** ffmpeg 的复杂滤镜图（按 ffmpeg 版本以文件或内联参数传入）。 */
  filterGraph: string;
  /** 输出参数，最后一项是输出路径。 */
  outputArgs: string[];
  warnings: string[];
}

export interface ExportProgress {
  seconds: number;
  fraction: number;
}

/** 供 UI / store 使用的格式元数据。文案字段存 i18n key。 */
export const EXPORT_FORMATS: Record<
  ExportFormat,
  { extension: string; labelKey: string; hintKey: string; audioKey: string }
> = {
  mp4: {
    extension: "mp4",
    labelKey: "export.format.mp4.label",
    hintKey: "export.format.mp4.hint",
    audioKey: "export.format.mp4.audio",
  },
  prores: {
    extension: "mov",
    labelKey: "export.format.prores.label",
    hintKey: "export.format.prores.hint",
    audioKey: "export.format.prores.audio",
  },
  gif: {
    extension: "gif",
    labelKey: "export.format.gif.label",
    hintKey: "export.format.gif.hint",
    audioKey: "export.format.gif.audio",
  },
};

/** 参与导出的素材（用于离线 / 文件存在性预检）。 */
export type UsedAsset = MediaAsset;
