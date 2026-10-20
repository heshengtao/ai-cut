/**
 * 文字图层渲染：用 WebView 的 Canvas 把文字画成透明 PNG。
 *
 * 不依赖 ffmpeg 的 drawtext / freetype，因而对 sidecar 的构建方式不敏感；
 * 字体由系统字体栈提供（PingFang / Hiragino / Noto CJK / 微软雅黑）。
 */
import type { Clip } from "@/types/project";
import {
  fontStackOf,
  hexToRgba,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
  TEXT_BACKGROUND_PADDING_X,
  TEXT_BACKGROUND_PADDING_Y,
  TEXT_BACKGROUND_RADIUS,
} from "@/core/clipStyle";

/** 文字图层缓存文件名（按片段 id 与画幅区分）。 */
export function textLayerName(clipId: string, width: number, height: number): string {
  const safe = clipId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `text-${safe}-${width}x${height}.png`;
}

/** `data:image/png;base64,...` → 纯 base64。 */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** 按最大宽度把文本拆行（CJK 逐字断行，英文允许在空格处自然断开）。 */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of Array.from(paragraph)) {
      const next = current + char;
      if (current !== "" && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char.trimStart();
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** 兼容不同 WebView：支持时同步 Canvas 的字间距。 */
function setLetterSpacing(ctx: CanvasRenderingContext2D, value: number): void {
  const target = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in target) target.letterSpacing = `${value}px`;
}

/** 渲染一个文字片段；没有 DOM / Canvas 时返回 null。 */
export function renderTextLayerPng(
  clip: Clip,
  width: number,
  height: number,
  projectHeight: number,
): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const text = clip.text ?? "";
  const style = resolveTextStyle(clip);
  const stroke = resolveStroke(clip);
  const shadow = resolveShadow(clip);
  const scale = projectHeight > 0 ? height / projectHeight : 1;
  const fontSize = Math.max(1, style.fontSize * scale);
  const lineHeight = fontSize * style.lineHeight;
  const paddingX = TEXT_BACKGROUND_PADDING_X * scale;
  const paddingY = TEXT_BACKGROUND_PADDING_Y * scale;
  const maxWidth = width * 0.88;

  ctx.font = `600 ${fontSize}px ${fontStackOf(style.fontFamily)}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = "middle";
  setLetterSpacing(ctx, style.letterSpacing * scale);

  const lines = wrapLines(ctx, text, Math.max(1, maxWidth - paddingX * 2));
  const lineWidths = lines.map((line) => ctx.measureText(line).width);
  const blockWidth = Math.max(0, ...lineWidths);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);

  const centerX = width / 2;
  const anchorX =
    style.align === "left"
      ? centerX - blockWidth / 2
      : style.align === "right"
        ? centerX + blockWidth / 2
        : centerX;
  const firstY = height / 2 - ((lines.length - 1) * lineHeight) / 2;

  // 背景块：与预览一致，包住整段文字并留出内边距。
  if (style.backgroundEnabled && lines.length > 0) {
    const left = centerX - blockWidth / 2 - paddingX;
    const top = height / 2 - blockHeight / 2 - paddingY;
    const rectWidth = blockWidth + paddingX * 2;
    const rectHeight = blockHeight + paddingY * 2;
    const radius = Math.min(
      rectWidth / 2,
      rectHeight / 2,
      TEXT_BACKGROUND_RADIUS * scale,
    );
    ctx.save();
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(left, top, rectWidth, rectHeight, radius);
      ctx.fill();
    } else {
      ctx.fillRect(left, top, rectWidth, rectHeight);
    }
    ctx.restore();
  }

  const drawLines = (fill: boolean): void => {
    for (let index = 0; index < lines.length; index += 1) {
      const y = firstY + index * lineHeight;
      if (fill) ctx.fillText(lines[index], anchorX, y);
      else ctx.strokeText(lines[index], anchorX, y);
    }
  };

  // 发光：先用发光色画一遍，再画实际文字，文字本身不会被染色。
  if (style.glowEnabled) {
    ctx.save();
    ctx.shadowColor = hexToRgba(style.glowColor, style.glowOpacity);
    ctx.shadowBlur = style.glowBlur * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = style.color;
    drawLines(true);
    ctx.restore();
  }

  // 阴影（文字默认带一层轻阴影）。
  if (shadow.enabled) {
    ctx.save();
    ctx.shadowColor = hexToRgba(shadow.color, shadow.opacity);
    ctx.shadowBlur = shadow.blur * scale;
    ctx.shadowOffsetX = shadow.offsetX * scale;
    ctx.shadowOffsetY = shadow.offsetY * scale;
    ctx.fillStyle = style.color;
    drawLines(true);
    ctx.restore();
  }

  // 描边先画，再用实色填充，保证文字内部干净。
  if (stroke.enabled && stroke.width > 0) {
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    drawLines(false);
    ctx.restore();
  }

  ctx.fillStyle = style.color;
  drawLines(true);

  return canvas.toDataURL("image/png");
}
