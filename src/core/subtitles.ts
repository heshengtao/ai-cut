/** 字幕时间换算：素材内时间 → 时间线时间。 */
import type { Clip } from "@/types/project";
import type { SubtitleCue } from "@/types/models";
import { snapToFrame } from "@/core/time";

export interface TimelineSubtitle {
  start: number;
  duration: number;
  text: string;
}

/**
 * 把一条素材内字幕映射到时间线。
 *
 * 选中的片段可能只引用素材的一段（`in` / `duration`），也可能被放在非零的
 * `start` 上；超出片段窗口的字幕直接丢弃，窗口内的按偏移换算并吸附到帧。
 */
export function mapCueToTimeline(
  cue: SubtitleCue,
  clip: Clip | null,
  fps: number,
): TimelineSubtitle | null {
  let start = cue.start;
  let end = cue.end;

  if (clip) {
    const inPoint = clip.in ?? 0;
    const outPoint = inPoint + clip.duration;
    if (end <= inPoint || start >= outPoint) return null;
    start = clip.start + Math.max(0, start - inPoint);
    end = clip.start + Math.min(clip.duration, end - inPoint);
  }

  start = snapToFrame(Math.max(0, start), fps);
  end = snapToFrame(Math.max(0, end), fps);
  if (end - start < 0.1) return null;
  end = snapToFrame(Math.max(start + 0.2, end), fps);
  if (end - start < 0.1) return null;

  return { start, duration: end - start, text: cue.text };
}
