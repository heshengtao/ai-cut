/** 画面变换的默认值、取值范围与几何计算。 */
import type { Clip, ClipTransform } from "@/types/project";

/** 视频 / 图片的默认变换：居中、100%、不旋转。 */
export const DEFAULT_TRANSFORM: ClipTransform = { x: 0, y: 0, scale: 1, rotation: 0 };

/** 文字的默认变换：水平居中，落在画面下方。 */
export const DEFAULT_TEXT_TRANSFORM: ClipTransform = { x: 0, y: 30, scale: 1, rotation: 0 };

export const TRANSFORM_LIMITS = {
  x: { min: -300, max: 300 },
  y: { min: -300, max: 300 },
  scale: { min: 0.05, max: 5 },
  rotation: { min: -360, max: 360 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 解析片段变换；旧工程 / 新片段没有 transform 时按类型给出默认值。 */
export function resolveTransform(clip: Clip): ClipTransform {
  if (clip.transform) return clip.transform;
  return clip.text !== undefined ? DEFAULT_TEXT_TRANSFORM : DEFAULT_TRANSFORM;
}

/** 归一化一份变换，保证数值在合法范围内。 */
export function normalizeTransform(value: ClipTransform): ClipTransform {
  return {
    x: clamp(value.x, TRANSFORM_LIMITS.x.min, TRANSFORM_LIMITS.x.max),
    y: clamp(value.y, TRANSFORM_LIMITS.y.min, TRANSFORM_LIMITS.y.max),
    scale: clamp(value.scale, TRANSFORM_LIMITS.scale.min, TRANSFORM_LIMITS.scale.max),
    rotation: clamp(
      value.rotation,
      TRANSFORM_LIMITS.rotation.min,
      TRANSFORM_LIMITS.rotation.max,
    ),
  };
}

/** 两份变换的数值是否相同。 */
export function sameTransform(a: ClipTransform, b: ClipTransform): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation;
}

/** 是否仍是「居中、原始大小、不旋转」的初始状态。 */
export function isDefaultTransform(value: ClipTransform): boolean {
  return sameTransform(value, DEFAULT_TRANSFORM);
}

/** 把一段内容按 contain 规则装进画布，返回实际显示尺寸。 */
export function containSize(
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return { width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}
