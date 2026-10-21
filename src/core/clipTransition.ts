/** 片段入/出转场：归一化与预览状态。 */
import type {
  Clip,
  ClipTransition,
  ClipTransitionDirection,
  ClipTransitionType,
} from "@/types/project";

const TYPES: ClipTransitionType[] = ["fade", "slide"];
const DIRECTIONS: ClipTransitionDirection[] = ["left", "right", "up", "down"];

export const DEFAULT_TRANSITION_DURATION = 0.5;

export function normalizeClipTransition(
  input: Partial<ClipTransition> | null | undefined,
  clipDuration: number,
): ClipTransition | null {
  if (!input?.type || !TYPES.includes(input.type)) return null;
  const duration = Math.min(
    Math.max(input.duration ?? DEFAULT_TRANSITION_DURATION, 0),
    Math.max(0, clipDuration),
  );
  if (!(duration > 0)) return null;
  return {
    type: input.type,
    duration,
    ...(input.type === "slide"
      ? {
          direction:
            input.direction && DIRECTIONS.includes(input.direction)
              ? input.direction
              : "left",
        }
      : {}),
  };
}

export interface TransitionState {
  opacity: number;
  /** 相对于舞台宽度的百分比。 */
  offsetX: number;
  /** 相对于舞台高度的百分比。 */
  offsetY: number;
}

function slideOffset(
  direction: ClipTransitionDirection | undefined,
  progress: number,
): { x: number; y: number } {
  const amount = 100 * (1 - Math.min(1, Math.max(0, progress)));
  switch (direction ?? "left") {
    case "right":
      return { x: amount, y: 0 };
    case "up":
      return { x: 0, y: -amount };
    case "down":
      return { x: 0, y: amount };
    default:
      return { x: -amount, y: 0 };
  }
}

/** 按片段内时间计算透明度与滑动偏移。 */
export function transitionState(clip: Clip, localTime: number): TransitionState {
  let opacity = 1;
  let offsetX = 0;
  let offsetY = 0;
  const t = Math.min(clip.duration, Math.max(0, localTime));

  if (clip.transitionIn) {
    const progress = Math.min(1, Math.max(0, t / clip.transitionIn.duration));
    if (clip.transitionIn.type === "fade") {
      opacity *= progress;
    } else {
      const offset = slideOffset(clip.transitionIn.direction, progress);
      offsetX += offset.x;
      offsetY += offset.y;
    }
  }

  if (clip.transitionOut) {
    const progress = Math.min(
      1,
      Math.max(0, (clip.duration - t) / clip.transitionOut.duration),
    );
    if (clip.transitionOut.type === "fade") {
      opacity *= progress;
    } else {
      const offset = slideOffset(clip.transitionOut.direction, progress);
      offsetX += offset.x;
      offsetY += offset.y;
    }
  }

  return { opacity: Math.min(1, Math.max(0, opacity)), offsetX, offsetY };
}

/** 导出用的 alpha 淡化滤镜（在片段本地时间轴上执行）。 */
export function clipFadeFilters(clip: Clip): string[] {
  const filters: string[] = [];
  const number = (value: number) => String(Number(value.toFixed(6)));
  if (clip.transitionIn?.type === "fade") {
    filters.push(`fade=t=in:st=0:d=${number(clip.transitionIn.duration)}:alpha=1`);
  }
  if (clip.transitionOut?.type === "fade") {
    filters.push(
      `fade=t=out:st=${number(Math.max(0, clip.duration - clip.transitionOut.duration))}:` +
        `d=${number(clip.transitionOut.duration)}:alpha=1`,
    );
  }
  return filters;
}

export function hasSlideTransition(clip: Clip): boolean {
  return clip.transitionIn?.type === "slide" || clip.transitionOut?.type === "slide";
}
