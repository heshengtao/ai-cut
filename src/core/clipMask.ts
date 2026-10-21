/** 静态蒙版：归一化、预览 CSS 与默认值。 */
import type { Clip, ClipMask, ClipMaskShape } from "@/types/project";

export const DEFAULT_CLIP_MASK: ClipMask = {
  shape: "rect",
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.8,
  feather: 0.05,
  angle: 0,
};

const SHAPES: ClipMaskShape[] = ["rect", "ellipse", "linear"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeClipMask(input: Partial<ClipMask> | undefined): ClipMask {
  const shape = input?.shape && SHAPES.includes(input.shape) ? input.shape : "rect";
  const x = clamp(input?.x ?? DEFAULT_CLIP_MASK.x, 0, 0.99);
  const y = clamp(input?.y ?? DEFAULT_CLIP_MASK.y, 0, 0.99);
  const width = clamp(input?.width ?? DEFAULT_CLIP_MASK.width, 0.01, 1 - x);
  const height = clamp(input?.height ?? DEFAULT_CLIP_MASK.height, 0.01, 1 - y);
  return {
    shape,
    x,
    y,
    width,
    height,
    feather: clamp(input?.feather ?? DEFAULT_CLIP_MASK.feather ?? 0, 0, 0.5),
    angle: ((input?.angle ?? DEFAULT_CLIP_MASK.angle ?? 0) % 360 + 360) % 360,
  };
}

/** 预览 CSS：矩形/椭圆用 clip-path，线性用 mask-image。 */
export function clipMaskCss(clip: Clip): Record<string, string> | undefined {
  const mask = clip.mask;
  if (!mask) return undefined;
  const left = mask.x * 100;
  const top = mask.y * 100;
  const right = (1 - mask.x - mask.width) * 100;
  const bottom = (1 - mask.y - mask.height) * 100;

  if (mask.shape === "rect") {
    return {
      clipPath: `inset(${top.toFixed(2)}% ${Math.max(0, right).toFixed(2)}% ${Math.max(0, bottom).toFixed(2)}% ${left.toFixed(2)}%)`,
    };
  }
  if (mask.shape === "ellipse") {
    return {
      clipPath:
        `ellipse(${(mask.width * 50).toFixed(2)}% ${(mask.height * 50).toFixed(2)}% ` +
        `at ${(left + mask.width * 50).toFixed(2)}% ${(top + mask.height * 50).toFixed(2)}%)`,
    };
  }

  const feather = Math.max(0, Math.min(0.5, mask.feather ?? 0));
  const start = (feather * 100).toFixed(2);
  const end = ((1 - feather) * 100).toFixed(2);
  const gradient =
    `linear-gradient(${mask.angle ?? 0}deg, transparent 0%, #000 ${start}%, ` +
    `#000 ${end}%, transparent 100%)`;
  return {
    maskImage: gradient,
    WebkitMaskImage: gradient,
    maskSize: `${(mask.width * 100).toFixed(2)}% ${(mask.height * 100).toFixed(2)}%`,
    WebkitMaskSize: `${(mask.width * 100).toFixed(2)}% ${(mask.height * 100).toFixed(2)}%`,
    maskPosition: `${left.toFixed(2)}% ${top.toFixed(2)}%`,
    WebkitMaskPosition: `${left.toFixed(2)}% ${top.toFixed(2)}%`,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
}
