/** ffmpeg ssim / psnr 统计文件解析。 */

export interface SsimFrame {
  frame: number;
  time: number;
  score: number;
}

export interface SsimSummary {
  frames: SsimFrame[];
  mean: number;
  min: number;
  samples: number;
}

const FRAME_RE = /n:\s*(\d+)/;
const ALL_RE = /\bAll:\s*([0-9.]+)/;
const Y_RE = /\bY:\s*([0-9.]+)/;

/**
 * 解析 `stats_file` 输出。
 *
 * 不同 ffmpeg 版本的字段顺序不同，但都带 `n:`；优先取 `All:`，退化到 `Y:`。
 */
export function parseSsimStats(text: string, fps: number, start = 0): SsimSummary {
  const frames: SsimFrame[] = [];
  for (const line of text.split(/\r?\n/)) {
    const frameMatch = FRAME_RE.exec(line);
    if (!frameMatch) continue;
    const scoreMatch = ALL_RE.exec(line) ?? Y_RE.exec(line);
    if (!scoreMatch) continue;
    const score = Number(scoreMatch[1]);
    if (!Number.isFinite(score)) continue;
    const frame = Number(frameMatch[1]);
    frames.push({
      frame,
      time: start + (Math.max(1, frame) - 1) / (fps > 0 ? fps : 30),
      score,
    });
  }
  if (frames.length === 0) {
    return { frames, mean: 1, min: 1, samples: 0 };
  }
  const scores = frames.map((frame) => frame.score);
  return {
    frames,
    mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    min: Math.min(...scores),
    samples: frames.length,
  };
}

export interface ChangedSample {
  time: number;
  score: number;
}

/** 低于阈值的帧按时间排序返回；连续帧合并成区间起点。 */
export function changedSamples(summary: SsimSummary, threshold: number): ChangedSample[] {
  const changed = summary.frames
    .filter((frame) => frame.score < threshold)
    .map((frame) => ({ time: frame.time, score: frame.score }));
  const merged: ChangedSample[] = [];
  for (const sample of changed) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(sample.time - last.time) < 1e-3) continue;
    merged.push(sample);
  }
  return merged;
}
