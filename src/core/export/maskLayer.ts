/** 把静态蒙版渲染成透明 PNG，导出时供 alphamerge 使用。 */
import type { Clip } from "@/types/project";

export function maskLayerName(clipId: string): string {
  return `mask-${clipId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function renderMaskLayerPng(
  clip: Clip,
  width: number,
  height: number,
): string | null {
  const mask = clip.mask;
  if (!mask) return null;
  if (!(width > 0) || !(height > 0)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const x = mask.x * canvas.width;
  const y = mask.y * canvas.height;
  const w = Math.max(1, mask.width * canvas.width);
  const h = Math.max(1, mask.height * canvas.height);
  const feather = Math.min(0.5, Math.max(0, mask.feather ?? 0));
  const blur = feather * Math.min(w, h);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (blur > 0.5 && "filter" in ctx) {
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
  }

  if (mask.shape === "rect") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, w, h);
  } else if (mask.shape === "ellipse") {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const angle = ((mask.angle ?? 0) * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const length = Math.max(w, h);
    const dx = (Math.cos(angle) * length) / 2;
    const dy = (Math.sin(angle) * length) / 2;
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(Math.min(0.49, Math.max(0.01, feather)), "rgba(255,255,255,1)");
    gradient.addColorStop(Math.max(0.51, Math.min(0.99, 1 - feather)), "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
  }

  ctx.restore();
  return canvas.toDataURL("image/png");
}
