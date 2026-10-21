/** 片段调色：模型归一化、预览 CSS 与导出 ffmpeg 滤镜。 */
import type { Clip, ClipColor } from "@/types/project";

export interface ResolvedClipColor {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
}

export const DEFAULT_CLIP_COLOR: ResolvedClipColor = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeClipColor(input: ClipColor | undefined): ResolvedClipColor {
  return {
    brightness: clamp(input?.brightness ?? 0, -1, 1),
    contrast: clamp(input?.contrast ?? 1, 0, 2),
    saturation: clamp(input?.saturation ?? 1, 0, 3),
    temperature: clamp(input?.temperature ?? 0, -1, 1),
    tint: clamp(input?.tint ?? 0, -1, 1),
  };
}

export function resolveClipColor(clip: Clip): ResolvedClipColor {
  return normalizeClipColor(clip.color);
}

export function isDefaultClipColor(color: ResolvedClipColor): boolean {
  return (
    Math.abs(color.brightness) < 1e-6 &&
    Math.abs(color.contrast - 1) < 1e-6 &&
    Math.abs(color.saturation - 1) < 1e-6 &&
    Math.abs(color.temperature) < 1e-6 &&
    Math.abs(color.tint) < 1e-6
  );
}

/** 预览用的 CSS filter；色温/色调是近似值，最终以导出为准。 */
export function clipColorCss(clip: Clip): string | undefined {
  const color = resolveClipColor(clip);
  if (isDefaultClipColor(color)) return undefined;

  const parts = [
    `brightness(${(1 + color.brightness).toFixed(3)})`,
    `contrast(${color.contrast.toFixed(3)})`,
    `saturate(${color.saturation.toFixed(3)})`,
  ];
  const hue = -color.temperature * 8 + color.tint * 10;
  if (Math.abs(color.temperature) > 1e-6) {
    if (color.temperature > 0) {
      parts.push(`sepia(${(color.temperature * 0.25).toFixed(3)})`);
    }
  }
  if (Math.abs(hue) > 0.01) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  return parts.join(" ");
}

/** 导出用 ffmpeg 滤镜：eq 负责亮度/对比度/饱和度，colorbalance 负责色温/色调。 */
export function clipColorFilters(clip: Clip): string[] {
  const color = resolveClipColor(clip);
  if (isDefaultClipColor(color)) return [];

  const filters = [
    `eq=brightness=${color.brightness.toFixed(4)}:` +
      `contrast=${color.contrast.toFixed(4)}:` +
      `saturation=${color.saturation.toFixed(4)}`,
  ];

  if (Math.abs(color.temperature) > 1e-6 || Math.abs(color.tint) > 1e-6) {
    const warm = color.temperature * 0.18;
    const green = color.tint * 0.18;
    filters.push(
      `colorbalance=rs=${warm.toFixed(4)}:gs=${green.toFixed(4)}:bs=${(-warm).toFixed(4)}:` +
        `rm=${(warm * 0.7).toFixed(4)}:gm=${(green * 0.7).toFixed(4)}:bm=${(-warm * 0.7).toFixed(4)}:` +
        `rh=${(warm * 0.4).toFixed(4)}:gh=${(green * 0.4).toFixed(4)}:bh=${(-warm * 0.4).toFixed(4)}`,
    );
  }
  return filters;
}
