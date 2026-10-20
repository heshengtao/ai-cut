/** 时间换算：工程内部一律用秒，UI 落点吸附到帧网格。 */

/** 秒 → 帧号（四舍五入）。 */
export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

/** 帧号 → 秒。 */
export function frameToSec(frame: number, fps: number): number {
  return frame / fps;
}

/** 把秒吸附到最近的帧边界。 */
export function snapToFrame(sec: number, fps: number): number {
  return frameToSec(secToFrame(sec, fps), fps);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 秒 → `HH:MM:SS:FF` 时间码（负数按 0 处理）。 */
export function formatTimecode(sec: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(sec * rate));
  const frames = totalFrames % rate;
  const totalSec = Math.floor(totalFrames / rate);
  return [
    pad2(Math.floor(totalSec / 3600)),
    pad2(Math.floor(totalSec / 60) % 60),
    pad2(totalSec % 60),
    pad2(frames),
  ].join(":");
}
