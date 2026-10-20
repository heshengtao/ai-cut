/** 片段外观：文字样式、混合模式、描边、阴影与圆角的默认值 / 归一化。 */
import type {
  BlendMode,
  Clip,
  ClipShadow,
  ClipStroke,
  ClipTextStyle,
  TextAlign,
} from "@/types/project";

/** 可选字体：id 存进工程，stack 用于预览与导出。 */
export interface FontFamilyOption {
  id: string;
  labelKey: string;
  stack: string;
}

export const FONT_FAMILIES: FontFamilyOption[] = [
  {
    id: "pingfang",
    labelKey: "font.pingfang",
    stack: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  {
    id: "system",
    labelKey: "font.system",
    stack: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: "sans",
    labelKey: "font.sans",
    stack: 'Arial, Helvetica, "Helvetica Neue", sans-serif',
  },
  {
    id: "serif",
    labelKey: "font.serif",
    stack: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
  },
  {
    id: "mono",
    labelKey: "font.mono",
    stack: '"SF Mono", Menlo, Consolas, "Courier New", monospace',
  },
  {
    id: "noto",
    labelKey: "font.noto",
    stack: '"Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", sans-serif',
  },
  {
    id: "yahei",
    labelKey: "font.yahei",
    stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: "songti",
    labelKey: "font.songti",
    stack: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif',
  },
  {
    id: "kaiti",
    labelKey: "font.kaiti",
    stack: '"Kaiti SC", "KaiTi", "STKaiti", "Noto Serif CJK SC", serif',
  },
];

export function fontStackOf(id: string): string {
  return FONT_FAMILIES.find((font) => font.id === id)?.stack ?? FONT_FAMILIES[0].stack;
}

export const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "plus-lighter",
];

export const TEXT_ALIGNS: TextAlign[] = ["left", "center", "right"];

export const DEFAULT_TEXT_STYLE: ClipTextStyle = {
  fontFamily: "pingfang",
  fontSize: 48,
  color: "#ffffff",
  letterSpacing: 0,
  lineHeight: 1.25,
  align: "center",
  backgroundEnabled: false,
  backgroundColor: "#000000",
  backgroundOpacity: 0.65,
  glowEnabled: false,
  glowColor: "#ffffff",
  glowBlur: 16,
  glowOpacity: 0.8,
};

export const DEFAULT_STROKE: ClipStroke = {
  enabled: false,
  color: "#000000",
  width: 4,
};

export const DEFAULT_SHADOW: ClipShadow = {
  enabled: false,
  color: "#000000",
  opacity: 0.5,
  blur: 16,
  offsetX: 0,
  offsetY: 8,
};

/** 文字默认带一层轻阴影，保证在任意画面上都能看清。 */
export const DEFAULT_TEXT_SHADOW: ClipShadow = {
  enabled: true,
  color: "#000000",
  opacity: 0.75,
  blur: 12,
  offsetX: 0,
  offsetY: 2,
};

/** 文字背景的内边距与圆角（工程像素，会按画布比例缩放）。 */
export const TEXT_BACKGROUND_PADDING_X = 16;
export const TEXT_BACKGROUND_PADDING_Y = 8;
export const TEXT_BACKGROUND_RADIUS = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return fallback;
}

/** `#rrggbb` + alpha → CSS rgba()。 */
export function hexToRgba(color: string, alpha: number): string {
  const hex = normalizeColor(color, "#000000");
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function normalizeAlign(value: unknown): TextAlign {
  return TEXT_ALIGNS.includes(value as TextAlign) ? (value as TextAlign) : "center";
}

export function normalizeTextStyle(value: Partial<ClipTextStyle>): ClipTextStyle {
  return {
    fontFamily:
      typeof value.fontFamily === "string" && value.fontFamily !== ""
        ? value.fontFamily
        : DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: clamp(finite(value.fontSize, DEFAULT_TEXT_STYLE.fontSize), 5, 400),
    color: normalizeColor(value.color, DEFAULT_TEXT_STYLE.color),
    letterSpacing: clamp(
      finite(value.letterSpacing, DEFAULT_TEXT_STYLE.letterSpacing),
      -100,
      200,
    ),
    lineHeight: clamp(finite(value.lineHeight, DEFAULT_TEXT_STYLE.lineHeight), 0.5, 4),
    align: normalizeAlign(value.align),
    backgroundEnabled: value.backgroundEnabled === true,
    backgroundColor: normalizeColor(
      value.backgroundColor,
      DEFAULT_TEXT_STYLE.backgroundColor,
    ),
    backgroundOpacity: clamp(
      finite(value.backgroundOpacity, DEFAULT_TEXT_STYLE.backgroundOpacity),
      0,
      1,
    ),
    glowEnabled: value.glowEnabled === true,
    glowColor: normalizeColor(value.glowColor, DEFAULT_TEXT_STYLE.glowColor),
    glowBlur: clamp(finite(value.glowBlur, DEFAULT_TEXT_STYLE.glowBlur), 0, 200),
    glowOpacity: clamp(
      finite(value.glowOpacity, DEFAULT_TEXT_STYLE.glowOpacity),
      0,
      1,
    ),
  };
}

export function normalizeStroke(value: Partial<ClipStroke>): ClipStroke {
  return {
    enabled: value.enabled === true,
    color: normalizeColor(value.color, DEFAULT_STROKE.color),
    width: clamp(finite(value.width, DEFAULT_STROKE.width), 0, 80),
  };
}

export function normalizeShadow(value: Partial<ClipShadow>): ClipShadow {
  return {
    enabled: value.enabled === true,
    color: normalizeColor(value.color, DEFAULT_SHADOW.color),
    opacity: clamp(finite(value.opacity, DEFAULT_SHADOW.opacity), 0, 1),
    blur: clamp(finite(value.blur, DEFAULT_SHADOW.blur), 0, 300),
    offsetX: clamp(finite(value.offsetX, DEFAULT_SHADOW.offsetX), -300, 300),
    offsetY: clamp(finite(value.offsetY, DEFAULT_SHADOW.offsetY), -300, 300),
  };
}

export function normalizeBlendMode(value: unknown): BlendMode {
  return BLEND_MODES.includes(value as BlendMode) ? (value as BlendMode) : "normal";
}

/** 是否是文字片段（没有素材）。 */
export function isTextClip(clip: Clip): boolean {
  return clip.assetId === "";
}

export function resolveTextStyle(clip: Clip): ClipTextStyle {
  return normalizeTextStyle(clip.textStyle ?? {});
}

export function resolveStroke(clip: Clip): ClipStroke {
  return normalizeStroke(clip.stroke ?? {});
}

export function resolveShadow(clip: Clip): ClipShadow {
  if (clip.shadow) return normalizeShadow(clip.shadow);
  return isTextClip(clip) ? DEFAULT_TEXT_SHADOW : DEFAULT_SHADOW;
}

export function resolveBlendMode(clip: Clip): BlendMode {
  return normalizeBlendMode(clip.blendMode);
}

export function resolveCornerRadius(clip: Clip): number {
  return clamp(finite(clip.cornerRadius, 0), 0, 1000);
}

export function sameTextStyle(a: ClipTextStyle, b: ClipTextStyle): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameStroke(a: ClipStroke, b: ClipStroke): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameShadow(a: ClipShadow, b: ClipShadow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
