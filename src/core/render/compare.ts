/** 两版渲染的对比：SSIM 指标 + 并排关键帧。 */
import { join } from "@tauri-apps/api/path";
import { probeMedia, readTextFile, writeProjectFile } from "@/core/media";
import { startExport } from "@/core/export/api";
import { changedSamples, parseSsimStats } from "@/core/export/ssim";
import type { ChangedSample, SsimSummary } from "@/core/export/ssim";
import { cacheDir } from "./cache";

export interface CompareArgs {
  /** A 版视频绝对路径。 */
  a: string;
  /** B 版视频绝对路径。 */
  b: string;
  times?: number[];
  outputDir?: string;
  range?: { start: number; end: number };
  threshold?: number;
  fps?: number;
}

export interface CompareResult {
  ssim: { mean: number; min: number; samples: number };
  changed: ChangedSample[];
  frames: Array<{ time: number; path: string; score: number }>;
  statsPath: string;
  start: number;
  end: number;
  fps: number;
  warnings: string[];
}

function even(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function escapeFilterPath(path: string): string {
  // ffmpeg 滤镜里反斜杠会被当转义符；Windows 路径统一成正斜杠。
  return path.replace(/\\/g, "/").replace(/'/g, "\\'");
}

async function ensureDir(path: string): Promise<void> {
  // write_project 会创建父目录；用空文件触发一次即可，随后删不删都无妨。
  await writeProjectFile(await join(path, ".keep"), "");
}

/** 逐帧 SSIM + 并排帧；整个流程串行，因为 ffmpeg 是单槽的。 */
export async function compareTakes(args: CompareArgs): Promise<CompareResult> {
  const [a, b] = await Promise.all([probeMedia(args.a), probeMedia(args.b)]);
  if (!(a.duration > 0) || !(b.duration > 0)) {
    throw new Error("对比失败：无法读取视频时长");
  }
  const start = Math.max(0, args.range?.start ?? 0);
  const end = Math.min(
    args.range?.end ?? Math.min(a.duration, b.duration),
    Math.min(a.duration, b.duration),
  );
  if (!(end > start)) throw new Error("对比区间为空");

  const fps = Math.max(1, Math.round(args.fps ?? 30));
  const width = even(Math.min(a.width ?? 1280, b.width ?? 1280), 1280);
  const height = even(Math.min(a.height ?? 720, b.height ?? 720), 720);
  const duration = end - start;
  const dir = await cacheDir();
  await ensureDir(dir);
  const statsPath = await join(dir, `ssim-${Date.now()}.log`);
  const warnings: string[] = [];
  if (Math.abs(a.duration - b.duration) > 0.05) {
    warnings.push(
      `两版时长不同（${a.duration.toFixed(2)}s vs ${b.duration.toFixed(2)}s），只比较交集`,
    );
  }

  const fit = (label: string) =>
    `[${label}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;
  const filterGraph =
    `${fit("0")}[a];${fit("1")}[b];` +
    `[a][b]ssim=stats_file='${escapeFilterPath(statsPath)}'[s]`;

  await startExport({
    inputs: ["-ss", String(start), "-t", String(duration), "-i", args.a, "-ss", String(start), "-t", String(duration), "-i", args.b],
    filterGraph,
    outputArgs: ["-map", "[s]", "-f", "null", "-"],
    duration,
  });

  let summary: SsimSummary = { frames: [], mean: 1, min: 1, samples: 0 };
  try {
    summary = parseSsimStats(await readTextFile(statsPath), fps, start);
  } catch (error) {
    warnings.push(
      `SSIM 统计读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const times =
    args.times && args.times.length > 0
      ? args.times
          .filter((time) => time >= start && time <= end)
          .slice(0, 8)
      : [0.25, 0.5, 0.75].map((ratio) => start + duration * ratio);

  const outputDir = args.outputDir?.trim() || (await join(dir, "compare"));
  await ensureDir(outputDir);
  const frames: Array<{ time: number; path: string; score: number }> = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const path = await join(outputDir, `compare-${String(index + 1).padStart(3, "0")}.png`);
    const frameFilter =
      `${fit("0")}[a];${fit("1")}[b];[a][b]hstack=inputs=2[out]`;
    await startExport({
      inputs: ["-ss", String(time), "-i", args.a, "-ss", String(time), "-i", args.b],
      filterGraph: frameFilter,
      outputArgs: ["-map", "[out]", "-frames:v", "1", path],
      duration: 1 / fps,
    });
    const nearest =
      summary.frames.length === 0
        ? null
        : summary.frames.reduce((best, frame) =>
            Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best,
          );
    frames.push({ time, path, score: nearest?.score ?? 1 });
  }

  return {
    ssim: { mean: summary.mean, min: summary.min, samples: summary.samples },
    changed: changedSamples(summary, args.threshold ?? 0.98),
    frames,
    statsPath,
    start,
    end,
    fps,
    warnings,
  };
}
