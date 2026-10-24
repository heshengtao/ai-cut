/** 接触表：把多帧拼成一张 PNG，并写一份 cell → 时间的图例。 */
import { writeTextFile } from "@/core/media";
import { startExport } from "./api";

export interface ContactLayout {
  cols: number;
  rows: number;
  /** xstack 的 layout 字符串。 */
  layout: string;
}

export interface ContactSheetOptions {
  outputPath: string;
  cols?: number;
  cellWidth?: number;
  /** 与 frames 一一对应的时间（秒），用于图例。 */
  times?: number[];
}

export interface ContactSheetResult {
  path: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: Array<{ index: number; time?: number; framePath: string }>;
  legendPath: string;
}

export function buildContactLayout(
  count: number,
  cols: number,
  cellWidth: number,
  cellHeight: number,
): ContactLayout {
  const safeCols = Math.min(Math.max(1, Math.floor(cols || 1)), Math.max(1, count));
  const rows = Math.ceil(count / safeCols);
  const parts: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      parts.push(`${col * cellWidth}_${row * cellHeight}`);
    }
  }
  return { cols: safeCols, rows, layout: parts.join("|") };
}

function even(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/** frames 必须已经存在；不足的格子用最后一帧补齐。 */
export async function buildContactSheet(
  frames: string[],
  options: ContactSheetOptions,
): Promise<ContactSheetResult> {
  if (frames.length === 0) throw new Error("接触表需要至少一帧");
  const cols = Math.min(6, Math.max(1, Math.round(options.cols ?? Math.ceil(Math.sqrt(frames.length)))));
  const rows = Math.ceil(frames.length / cols);
  const cellWidth = even(options.cellWidth ?? 480, 480);
  const cellHeight = even(Math.round(cellWidth * 9) / 16, 270);
  const total = cols * rows;
  const padded = [...frames, ...Array.from({ length: total - frames.length }, () => frames[frames.length - 1])];
  const layout = buildContactLayout(padded.length, cols, cellWidth, cellHeight);

  const filters = padded.map(
    (_, index) =>
      `[${index}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[c${index}]`,
  );
  const labels = padded.map((_, index) => `[c${index}]`).join("");
  filters.push(
    `${labels}xstack=inputs=${padded.length}:layout=${layout.layout}:fill=black[out]`,
  );

  await startExport({
    inputs: padded.flatMap((frame) => ["-i", frame]),
    filterGraph: filters.join(";"),
    outputArgs: ["-map", "[out]", "-frames:v", "1", options.outputPath],
    duration: 1 / 30,
  });

  const cells = frames.map((framePath, index) => ({
    index,
    ...(options.times?.[index] !== undefined ? { time: options.times[index] } : {}),
    framePath,
  }));
  const legendPath = `${options.outputPath}.json`;
  await writeTextFile(
    legendPath,
    JSON.stringify(
      {
        path: options.outputPath,
        cols,
        rows,
        cellWidth,
        cellHeight,
        cells,
      },
      null,
      2,
    ),
  );

  return {
    path: options.outputPath,
    width: cols * cellWidth,
    height: rows * cellHeight,
    cols,
    rows,
    cells,
    legendPath,
  };
}
