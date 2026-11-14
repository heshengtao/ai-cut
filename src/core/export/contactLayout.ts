/**
 * 接触表的版面计算（纯函数）。
 *
 * 单独成文件是为了让无头文档引擎也能用：`contactSheet.ts` 还要走平台 API
 * （写文件 / 跑 ffmpeg），拖进 QuickJS 会把 Vue 一起带进来。
 */

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
