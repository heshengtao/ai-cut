/** 工程输出设置：分辨率 / 帧率预设与归一化。 */

export const MIN_PROJECT_DIMENSION = 16;
export const MAX_PROJECT_DIMENSION = 8192;
export const MIN_PROJECT_FPS = 1;
export const MAX_PROJECT_FPS = 120;

export interface ResolutionPreset {
  id: string;
  width: number;
  height: number;
  labelKey: string;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "1080p", width: 1920, height: 1080, labelKey: "settings.output.1080p" },
  { id: "720p", width: 1280, height: 720, labelKey: "settings.output.720p" },
  { id: "4k", width: 3840, height: 2160, labelKey: "settings.output.4k" },
  { id: "vertical", width: 1080, height: 1920, labelKey: "settings.output.vertical" },
  { id: "square", width: 1080, height: 1080, labelKey: "settings.output.square" },
  { id: "4x3", width: 1440, height: 1080, labelKey: "settings.output.4x3" },
];

export const FPS_PRESETS = [24, 25, 30, 50, 60];

export const CUSTOM_OUTPUT = "custom";

/** 宽高取偶数并夹到合法范围；H.264 的 yuv420p 要求偶数尺寸。 */
export function evenDimension(value: number): number {
  if (!Number.isFinite(value)) return MIN_PROJECT_DIMENSION;
  const rounded = Math.round(value);
  const even = rounded % 2 === 0 ? rounded : rounded + 1;
  return Math.min(MAX_PROJECT_DIMENSION, Math.max(MIN_PROJECT_DIMENSION, even));
}

/** 帧率夹到 1..120，并保留三位小数（兼容 23.976 / 29.97）。 */
export function normalizeFps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 30;
  const clamped = Math.min(MAX_PROJECT_FPS, Math.max(MIN_PROJECT_FPS, value));
  return Math.round(clamped * 1000) / 1000;
}

/** 当前宽高命中的预设 id；没有命中返回 `custom`。 */
export function matchResolutionPreset(width: number, height: number): string {
  return (
    RESOLUTION_PRESETS.find(
      (preset) => preset.width === width && preset.height === height,
    )?.id ?? CUSTOM_OUTPUT
  );
}

export function resolutionPreset(id: string): ResolutionPreset | undefined {
  return RESOLUTION_PRESETS.find((preset) => preset.id === id);
}
