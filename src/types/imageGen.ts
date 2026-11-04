/** 图像生成 / 编辑（stable-diffusion.cpp）：请求、进度、结果与各家族的生成规格。 */

export type ImageGenMode = "draw" | "edit";

export interface ImageGenRequest {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  cfgScale: number;
  flowShift?: number;
  /** 原图绝对路径：图生图 / 局部重绘 / 指令改图。 */
  initImage?: string;
  /** 白色涂抹区域 + 透明背景的 PNG data URL。 */
  maskPng?: string;
  /** 重绘强度 0..1；只有带原图时生效。 */
  strength?: number;
  offloadToCpu?: boolean;
  vaeTiling?: boolean;
}

export interface ImageGenProgress {
  state: "preparing" | "running" | "done" | "error" | "cancelled";
  message: string | null;
  /** 0..1；没有可解析的 step 时是 0。 */
  progress: number;
  elapsed: number;
  step?: number | null;
  totalSteps?: number | null;
}

export interface ImageGenResult {
  path: string;
  width: number;
  height: number;
}

export const EVENT_IMAGE_GEN = "image-gen-progress";

/**
 * 一个图像家族的完整规格（Rust 侧 `ImageSpec` 是同一套规则）。
 *
 * `multiple`：宽高对齐单位；`draw` / `edit`：这个模型能不能用于画图 / 改图；
 * `refEdit`：是否按整图参考编辑（FLUX Kontext / Qwen-Image-Edit）；
 * `singleFile`：单文件 checkpoint（不需要单独的 VAE / 文本编码器）。
 */
export interface ImageModelSpec {
  multiple: number;
  steps: number;
  cfg: number;
  flowShift: number | null;
  negative: boolean;
  draw: boolean;
  edit: boolean;
  refEdit: boolean;
  singleFile: boolean;
}

const SPECS: Record<string, ImageModelSpec> = {
  sd15: {
    multiple: 64,
    steps: 20,
    cfg: 7.5,
    flowShift: null,
    negative: true,
    draw: true,
    edit: true,
    refEdit: false,
    singleFile: true,
  },
  sdxl: {
    multiple: 64,
    steps: 25,
    cfg: 7,
    flowShift: null,
    negative: true,
    draw: true,
    edit: true,
    refEdit: false,
    singleFile: true,
  },
  z_image_turbo: {
    multiple: 32,
    steps: 8,
    cfg: 1,
    flowShift: null,
    negative: false,
    draw: true,
    edit: true,
    refEdit: false,
    singleFile: false,
  },
  flux1_schnell: {
    multiple: 16,
    steps: 4,
    cfg: 1,
    flowShift: null,
    negative: false,
    draw: true,
    edit: true,
    refEdit: false,
    singleFile: false,
  },
  flux1_kontext: {
    multiple: 16,
    steps: 20,
    cfg: 1,
    flowShift: null,
    negative: false,
    draw: false,
    edit: true,
    refEdit: true,
    singleFile: false,
  },
  qwen_image: {
    multiple: 32,
    steps: 20,
    cfg: 2.5,
    flowShift: 3,
    negative: true,
    draw: true,
    edit: true,
    refEdit: false,
    singleFile: false,
  },
  qwen_image_edit: {
    multiple: 32,
    steps: 20,
    cfg: 2.5,
    flowShift: 3,
    negative: false,
    draw: false,
    edit: true,
    refEdit: true,
    singleFile: false,
  },
};

/** 未知家族按 Z-Image（默认档、规则最宽松）处理。 */
export const DEFAULT_IMAGE_SPEC: ImageModelSpec = SPECS.z_image_turbo;

/** 按模型家族取完整规格。 */
export function imageModelSpec(family: string | null | undefined): ImageModelSpec {
  return (family && SPECS[family]) || DEFAULT_IMAGE_SPEC;
}

/** 宽高对齐到模型要求的倍数（不小于 64）。 */
export function alignImageSize(value: number, multiple: number): number {
  const step = Math.max(1, Math.round(multiple));
  const aligned = Math.ceil(Math.max(64, Math.round(value)) / step) * step;
  return aligned;
}

/** 画图预设：方形 / 竖屏 / 横屏各来一档。 */
export const IMAGE_PRESETS = [
  { id: "512", width: 512, height: 512, label: "512 × 512" },
  { id: "768", width: 768, height: 768, label: "768 × 768" },
  { id: "1024", width: 1024, height: 1024, label: "1024 × 1024" },
  { id: "portrait", width: 832, height: 1216, label: "832 × 1216" },
  { id: "landscape", width: 1216, height: 832, label: "1216 × 832" },
  { id: "qwen", width: 1344, height: 1344, label: "1344 × 1344" },
] as const;

/** 原图尺寸 → 生成尺寸：按家族的对齐单位取整，并限制在 2048 以内。 */
export function editSizeFromSource(
  width: number | null | undefined,
  height: number | null | undefined,
  multiple: number,
): { width: number; height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  return {
    width: Math.min(2048, alignImageSize(width * scale, multiple)),
    height: Math.min(2048, alignImageSize(height * scale, multiple)),
  };
}
