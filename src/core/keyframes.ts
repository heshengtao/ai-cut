/** 关键帧：归一化、插值、预览取值与导出表达式。 */
import type {
  Clip,
  ClipTransform,
  Keyframe,
  KeyframeProperty,
} from "@/types/project";
import { resolveTransform } from "@/core/transform";

export const KEYFRAME_PROPERTIES: KeyframeProperty[] = [
  "opacity",
  "x",
  "y",
  "scale",
  "rotation",
];

export const KEYFRAME_RANGES: Record<KeyframeProperty, [number, number]> = {
  opacity: [0, 1],
  x: [-100, 100],
  y: [-100, 100],
  scale: [0.01, 10],
  rotation: [-360, 360],
};

/** 写入关键帧时允许只给出部分参数，缺省项沿用片段的静态值。 */
export type KeyframeInput = { time: number } & Partial<Omit<Keyframe, "time">>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** 片段在不考虑关键帧时的静态取值。 */
export function baseKeyframeValues(clip: Clip): Omit<Keyframe, "time"> {
  const transform = resolveTransform(clip);
  return {
    opacity: clamp(clip.opacity ?? 1, 0, 1),
    x: transform.x,
    y: transform.y,
    scale: transform.scale,
    rotation: transform.rotation,
  };
}

/** 补齐缺省参数、限制范围、按时间排序并合并同一时刻的帧。 */
export function normalizeKeyframes(
  input: readonly KeyframeInput[] | undefined,
  duration: number,
  base: Omit<Keyframe, "time">,
): Keyframe[] {
  const sorted = (input ?? [])
    .filter((frame) => Number.isFinite(frame.time))
    .map((frame) => {
      const values = { ...base };
      for (const property of KEYFRAME_PROPERTIES) {
        const value = frame[property];
        if (typeof value === "number" && Number.isFinite(value)) {
          const [min, max] = KEYFRAME_RANGES[property];
          values[property] = clamp(value, min, max);
        }
      }
      return {
        time: clamp(frame.time, 0, Math.max(0, duration)),
        ...values,
      };
    })
    .sort((a, b) => a.time - b.time);

  const deduped: Keyframe[] = [];
  for (const frame of sorted) {
    if (
      deduped.length > 0 &&
      Math.abs(deduped[deduped.length - 1].time - frame.time) < 1e-6
    ) {
      deduped[deduped.length - 1] = frame;
    } else {
      deduped.push(frame);
    }
  }
  return deduped;
}

/** 单个属性的线性插值；区间外保持首/尾值。 */
export function keyframeValue(
  keyframes: readonly Keyframe[] | undefined,
  property: KeyframeProperty,
  time: number,
  fallback: number,
): number {
  if (!keyframes || keyframes.length === 0) return fallback;
  if (time <= keyframes[0].time) return keyframes[0][property];
  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = keyframes[index - 1];
    const next = keyframes[index];
    if (time <= next.time) {
      const span = next.time - prev.time;
      if (span <= 0) return next[property];
      return (
        prev[property] +
        ((next[property] - prev[property]) * (time - prev.time)) / span
      );
    }
  }
  return keyframes[keyframes.length - 1][property];
}

/** 某一时刻的全部动画参数（含线性插值结果）。 */
export function keyframeValuesAt(
  clip: Clip,
  localTime: number,
): Omit<Keyframe, "time"> {
  const base = baseKeyframeValues(clip);
  return {
    opacity: keyframeValue(clip.keyframes, "opacity", localTime, base.opacity),
    x: keyframeValue(clip.keyframes, "x", localTime, base.x),
    y: keyframeValue(clip.keyframes, "y", localTime, base.y),
    scale: keyframeValue(clip.keyframes, "scale", localTime, base.scale),
    rotation: keyframeValue(clip.keyframes, "rotation", localTime, base.rotation),
  };
}

export function keyframeAt(
  keyframes: readonly Keyframe[] | undefined,
  time: number,
  epsilon = 1e-4,
): Keyframe | undefined {
  return keyframes?.find((frame) => Math.abs(frame.time - time) < epsilon);
}

/** 在同一时刻新增或更新一帧，其余参数沿用当前插值结果。 */
export function upsertKeyframe(
  clip: Clip,
  time: number,
  patch: Partial<Omit<Keyframe, "time">> = {},
): Keyframe[] {
  const values = { ...keyframeValuesAt(clip, time), ...patch };
  return [
    ...(clip.keyframes ?? []).filter(
      (frame) => Math.abs(frame.time - time) >= 1e-4,
    ),
    { time, ...values },
  ].sort((a, b) => a.time - b.time);
}

export function resolveTransformAt(clip: Clip, localTime: number): ClipTransform {
  const base = resolveTransform(clip);
  if (!clip.keyframes || clip.keyframes.length === 0) return base;
  return {
    x: keyframeValue(clip.keyframes, "x", localTime, base.x),
    y: keyframeValue(clip.keyframes, "y", localTime, base.y),
    scale: keyframeValue(clip.keyframes, "scale", localTime, base.scale),
    rotation: keyframeValue(clip.keyframes, "rotation", localTime, base.rotation),
  };
}

export function opacityAt(clip: Clip, localTime: number): number {
  return keyframeValue(
    clip.keyframes,
    "opacity",
    localTime,
    clip.opacity ?? 1,
  );
}

/**
 * 生成碎片化的线性插值表达式。
 * `variable` 是 ffmpeg 的时间变量（overlay 用 t，geq 用 T，scale/rotate 用 t）。
 * `offset` 用于把片段的相对时间平移到全局时间。
 */
export function keyframeExpression(
  keyframes: readonly Keyframe[] | undefined,
  property: KeyframeProperty,
  variable: string,
  offset = 0,
): string | null {
  if (!keyframes || keyframes.length === 0) return null;
  const points = keyframes.map((frame) => ({
    time: frame.time + offset,
    value: frame[property],
  }));
  if (points.length === 1) return number(points[0].value);

  let expression = number(points[points.length - 1].value);
  for (let index = points.length - 1; index > 0; index -= 1) {
    const prev = points[index - 1];
    const next = points[index];
    const span = next.time - prev.time;
    if (span <= 0) continue;
    const segment =
      `(${number(prev.value)}+(${number(next.value)}-${number(prev.value)})*` +
      `(${variable}-${number(prev.time)})/${number(span)})`;
    expression = `if(lt(${variable},${number(next.time)}),${segment},${expression})`;
  }
  expression = `if(lt(${variable},${number(points[0].time)}),${number(points[0].value)},${expression})`;
  return expression;
}
