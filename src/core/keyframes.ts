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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function normalizeKeyframes(
  input: Keyframe[] | undefined,
  duration: number,
  property: KeyframeProperty,
): Keyframe[] {
  const [min, max] = KEYFRAME_RANGES[property];
  const sorted = (input ?? [])
    .filter((frame) => Number.isFinite(frame.time) && Number.isFinite(frame.value))
    .map((frame) => ({
      time: clamp(frame.time, 0, Math.max(0, duration)),
      value: clamp(frame.value, min, max),
    }))
    .sort((a, b) => a.time - b.time);

  const deduped: Keyframe[] = [];
  for (const frame of sorted) {
    if (deduped.length > 0 && Math.abs(deduped[deduped.length - 1].time - frame.time) < 1e-6) {
      deduped[deduped.length - 1] = frame;
    } else {
      deduped.push(frame);
    }
  }
  return deduped;
}

/** 线性插值；区间外保持首/尾值。 */
export function keyframeValue(
  keyframes: Keyframe[] | undefined,
  time: number,
  fallback: number,
): number {
  if (!keyframes || keyframes.length === 0) return fallback;
  if (time <= keyframes[0].time) return keyframes[0].value;
  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = keyframes[index - 1];
    const next = keyframes[index];
    if (time <= next.time) {
      const span = next.time - prev.time;
      if (span <= 0) return next.value;
      return prev.value + ((next.value - prev.value) * (time - prev.time)) / span;
    }
  }
  return keyframes[keyframes.length - 1].value;
}

export function resolveTransformAt(clip: Clip, localTime: number): ClipTransform {
  const base = resolveTransform(clip);
  const keyframes = clip.keyframes;
  if (!keyframes) return base;
  const value = (property: "x" | "y" | "scale" | "rotation"): number =>
    keyframes[property]?.length
      ? keyframeValue(keyframes[property], localTime, base[property])
      : base[property];
  return {
    ...base,
    x: value("x"),
    y: value("y"),
    scale: value("scale"),
    rotation: value("rotation"),
  };
}

export function opacityAt(clip: Clip, localTime: number): number {
  return keyframesValue(clip, "opacity", localTime);
}

function keyframesValue(clip: Clip, property: KeyframeProperty, localTime: number): number {
  if (property === "opacity") {
    return keyframeValue(clip.keyframes?.opacity, localTime, clip.opacity ?? 1);
  }
  return resolveTransformAt(clip, localTime)[property];
}

export function currentKeyframeValue(
  clip: Clip,
  property: KeyframeProperty,
  localTime: number,
): number {
  return keyframesValue(clip, property, localTime);
}

/**
 * 生成碎片化的线性插值表达式。
 * `variable` 是 ffmpeg 的时间变量（overlay 用 t，geq 用 T，scale/rotate 用 t）。
 * `offset` 用于把片段的相对时间平移到全局时间。
 */
export function keyframeExpression(
  keyframes: Keyframe[] | undefined,
  variable: string,
  offset = 0,
): string | null {
  if (!keyframes || keyframes.length === 0) return null;
  const points = keyframes.map((frame) => ({
    time: frame.time + offset,
    value: frame.value,
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

export function hasKeyframes(clip: Clip, property: KeyframeProperty): boolean {
  return (clip.keyframes?.[property]?.length ?? 0) > 0;
}
