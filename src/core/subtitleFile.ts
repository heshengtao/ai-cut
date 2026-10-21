/** SRT / VTT 解析与序列化：纯函数，便于测试与 MCP 复用。 */

export type SubtitleFormat = "srt" | "vtt";

export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

function stripTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function parseTimestamp(raw: string): number | null {
  const match = raw
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, "0"));
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function timeRange(line: string): { start: number; end: number } | null {
  const arrow = line.indexOf("-->");
  if (arrow < 0) return null;
  const left = line.slice(0, arrow).trim();
  const right = line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "";
  const start = parseTimestamp(left);
  const end = parseTimestamp(right);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function parseBlocks(text: string, vtt: boolean): SubtitleEntry[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const entries: SubtitleEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    const head = lines[0].trim().toUpperCase();
    if (vtt && (head === "WEBVTT" || head.startsWith("NOTE") || head === "STYLE" || head === "REGION")) {
      continue;
    }

    const rangeIndex = lines.findIndex((line) => line.includes("-->"));
    if (rangeIndex < 0) continue;
    const range = timeRange(lines[rangeIndex]);
    if (!range) continue;

    const body = lines.slice(rangeIndex + 1).join("\n");
    const text = stripTags(body);
    if (!text) continue;
    entries.push({ start: range.start, end: range.end, text });
  }

  return entries.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function parseSrt(text: string): SubtitleEntry[] {
  return parseBlocks(text, false);
}

export function parseVtt(text: string): SubtitleEntry[] {
  return parseBlocks(text, true);
}

export function subtitleFormatFromPath(path: string): SubtitleFormat {
  return path.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
}

export function parseSubtitleText(text: string, path = ""): SubtitleEntry[] {
  return subtitleFormatFromPath(path) === "vtt" || /^\uFEFF?WEBVTT\b/i.test(text)
    ? parseVtt(text)
    : parseSrt(text);
}

function formatTimestamp(seconds: number, separator: "," | "."): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    `${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`,
  ].join(":");
}

function ordered(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry) => ({
      start: Math.max(0, entry.start),
      end: Math.max(entry.start + 0.001, entry.end),
      text: entry.text.trim(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function serializeSrt(entries: SubtitleEntry[]): string {
  return (
    ordered(entries)
      .map(
        (entry, index) =>
          `${index + 1}\n${formatTimestamp(entry.start, ",")} --> ${formatTimestamp(entry.end, ",")}\n${entry.text}\n`,
      )
      .join("\n")
  );
}

export function serializeVtt(entries: SubtitleEntry[]): string {
  return `WEBVTT\n\n${ordered(entries)
    .map(
      (entry) =>
        `${formatTimestamp(entry.start, ".")} --> ${formatTimestamp(entry.end, ".")}\n${entry.text}\n`,
    )
    .join("\n")}`;
}

export function serializeSubtitles(
  entries: SubtitleEntry[],
  format: SubtitleFormat,
): string {
  return format === "vtt" ? serializeVtt(entries) : serializeSrt(entries);
}
