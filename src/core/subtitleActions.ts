/** 字幕文件导入 / 导出：走命令总线与工程 store，UI 与 MCP 共用。 */
import type { Command } from "@/types/events";
import type { Project } from "@/types/project";
import { readTextFile, writeTextFile } from "@/core/media";
import { resolveTrack } from "@/core/projectView";
import {
  parseSubtitleText,
  serializeSubtitles,
  subtitleFormatFromPath,
  type SubtitleEntry,
  type SubtitleFormat,
} from "@/core/subtitleFile";
import { useProjectStore } from "@/stores/project";
import { t } from "@/i18n";

export interface ImportSubtitleFileOptions {
  path: string;
  trackName?: string;
  offset?: number;
  actor?: "human" | "agent";
  sessionId?: string;
  baseRevision?: number;
}

export interface ImportSubtitleResult {
  cueCount: number;
  revision: number;
  trackIds: string[];
  clipIds: string[];
}

export async function importSubtitlesFromFile(
  options: ImportSubtitleFileOptions,
): Promise<ImportSubtitleResult> {
  const text = await readTextFile(options.path);
  const entries = parseSubtitleText(text, options.path);
  if (entries.length === 0) throw new Error(t("subtitle.empty"));

  const project = useProjectStore();
  const command: Command = {
    id: crypto.randomUUID(),
    baseRevision: options.baseRevision ?? project.revision,
    actor: options.actor ?? "human",
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    kind: "subtitle.import",
    payload: {
      entries: entries.map(({ start, end, text: body }) => ({ start, end, text: body })),
      ...(options.trackName?.trim() ? { trackName: options.trackName.trim() } : {}),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    },
    label: t("subtitle.importLabel"),
    timestamp: Date.now(),
  };

  const result = project.applyCommand(command);
  if (!result.ok) throw new Error(result.error || t("subtitle.importFailed"));
  return {
    cueCount: entries.length,
    revision: result.revision,
    trackIds: result.affected.trackIds,
    clipIds: result.affected.clipIds,
  };
}

/** 收集文字片段为字幕条目；不传轨道时收集全部文字轨。 */
export function collectSubtitleEntries(
  doc: Project,
  trackRef?: string | number,
): SubtitleEntry[] {
  const tracks =
    trackRef === undefined
      ? doc.tracks
      : (() => {
          const track = resolveTrack(doc, trackRef);
          return track ? [track] : [];
        })();

  const entries: SubtitleEntry[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      const text = (clip.text ?? "").trim();
      if (clip.assetId === "" && text) {
        entries.push({
          start: clip.start,
          end: clip.start + clip.duration,
          text,
        });
      }
    }
  }
  return entries.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface ExportSubtitleResult {
  path: string;
  format: SubtitleFormat;
  count: number;
}

export async function exportSubtitlesToFile(
  path: string,
  entries: SubtitleEntry[],
  format?: SubtitleFormat,
): Promise<ExportSubtitleResult> {
  if (entries.length === 0) throw new Error(t("subtitle.empty"));
  const resolved = format ?? subtitleFormatFromPath(path);
  await writeTextFile(path, serializeSubtitles(entries, resolved));
  return { path, format: resolved, count: entries.length };
}
