/**
 * Material Design 3 Expressive 几何路径算法：
 * - `buildMorphPolygonPath`：变形加载器（8 瓣扇贝 / 四叶草 / 六瓣花 / 圆角方）的平滑圆角闭合 SVG 路径；
 * - `buildWavyProgressPaths`：波浪线性进度条的激活波浪段与留白未完成直线段。
 */

export interface MorphShapePreset {
  /** 外瓣数量。 */
  points: number;
  /** 外半径（基于 48×48 viewBox，中心 24,24）。 */
  rOuter: number;
  /** 内半径。 */
  rInner: number;
}

export const MORPH_LOADER_PRESETS: readonly MorphShapePreset[] = [
  { points: 8, rOuter: 20, rInner: 15.5 }, // 8-point scallop
  { points: 4, rOuter: 21, rInner: 12.5 }, // 4-leaf clover
  { points: 6, rOuter: 20, rInner: 14.5 }, // 6-petal flower
  { points: 4, rOuter: 20, rInner: 18.5 }, // soft squircle
];

/**
 * 生成圆角星形/花瓣闭合路径（二次贝塞尔角平滑），用于 M3 Expressive 变形加载器。
 */
export function buildMorphPolygonPath(
  points: number,
  rOuter: number,
  rInner: number,
  rotationRad = 0,
  center = 24,
): string {
  const n = Math.max(3, Math.round(points));
  const total = n * 2;
  const vertices: [number, number][] = [];
  for (let i = 0; i < total; i++) {
    const angle = (i / total) * Math.PI * 2 + rotationRad;
    const r = i % 2 === 0 ? rOuter : rInner;
    vertices.push([center + Math.cos(angle) * r, center + Math.sin(angle) * r]);
  }
  let d = "";
  for (let i = 0; i < total; i++) {
    const p0 = vertices[(i - 1 + total) % total]!;
    const p1 = vertices[i]!;
    const p2 = vertices[(i + 1) % total]!;
    const mx1 = (p0[0] + p1[0]) / 2;
    const my1 = (p0[1] + p1[1]) / 2;
    const mx2 = (p1[0] + p2[0]) / 2;
    const my2 = (p1[1] + p2[1]) / 2;
    if (i === 0) d += `M ${mx1.toFixed(1)} ${my1.toFixed(1)}`;
    d += ` Q ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${mx2.toFixed(1)} ${my2.toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * 按经过时间（秒）计算当前变形加载器的插值路径。
 */
export function sampleMorphLoaderPath(elapsedSec: number): string {
  const stepDuration = 1.15;
  const idx = Math.floor(elapsedSec / stepDuration) % MORPH_LOADER_PRESETS.length;
  const nextIdx = (idx + 1) % MORPH_LOADER_PRESETS.length;
  const localT = (elapsedSec % stepDuration) / stepDuration;
  const ease = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;
  const s1 = MORPH_LOADER_PRESETS[idx]!;
  const s2 = MORPH_LOADER_PRESETS[nextIdx]!;
  const rOuter = s1.rOuter + (s2.rOuter - s1.rOuter) * ease;
  const rInner = s1.rInner + (s2.rInner - s1.rInner) * ease;
  const points = localT < 0.5 ? s1.points : s2.points;
  return buildMorphPolygonPath(points, rOuter, rInner, elapsedSec * 0.6);
}

export interface WavyProgressPaths {
  activePath: string;
  inactivePath: string;
}

/**
 * 生成 M3 Expressive 波浪线性进度条的激活波浪路径与未完成直线路径。
 */
export function buildWavyProgressPaths(options: {
  width: number;
  height: number;
  /** 0..1 的进度值。 */
  progress: number;
  /** 相位（弧度），随时间递增产生流动波浪。 */
  phase: number;
  /** 振幅（px），设为 0 时退化为直线（用于 prefers-reduced-motion）。 */
  amplitude?: number;
  /** 激活段与未完成段之间的留白间隙（px）。 */
  gap?: number;
}): WavyProgressPaths {
  const { width, height, phase } = options;
  const p = Math.min(1, Math.max(0, options.progress));
  const amp = options.amplitude ?? 2.8;
  const gap = options.gap ?? 7;
  const pad = 3;
  const midY = height / 2;
  const usable = Math.max(0, width - pad * 2);
  const endX = pad + usable * p;

  let activePath = "";
  if (p > 0.005) {
    const freq = 0.22;
    const step = 4;
    const startY = midY + Math.sin(pad * freq - phase) * amp;
    activePath = `M ${pad.toFixed(1)} ${startY.toFixed(1)}`;
    for (let x = pad + step; x < endX; x += step) {
      const y = midY + Math.sin(x * freq - phase) * amp;
      activePath += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    const endY = midY + Math.sin(endX * freq - phase) * amp;
    activePath += ` L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  }

  let inactivePath = "";
  const trackStart = p > 0.005 ? endX + gap : pad;
  const trackEnd = width - pad;
  if (trackStart < trackEnd - 1) {
    inactivePath = `M ${trackStart.toFixed(1)} ${midY.toFixed(1)} L ${trackEnd.toFixed(1)} ${midY.toFixed(1)}`;
  }

  return { activePath, inactivePath };
}
