/**
 * 把字幕条目放进文字轨。
 *
 * 两条硬约束：
 * - **字幕轨永远在最上方**（`tracks[0]`）：预览按轨道顺序叠层，字幕轨一旦排在视频轨
 *   下面就会被画面盖住，生成出来等于不可见。新建时插到最上方，复用旧轨时也提回最上方。
 * - 同一轨内不重叠：一条轨放不下时自动开下一条 `字幕 2` / `字幕 3`…。
 */
import type { Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrackAt, raiseTracks } from "@/core/ops/tracks";
import type { SubtitleEntry } from "@/core/subtitleFile";

export interface CueInput {
  start: number;
  duration: number;
  text: string;
}

interface Lane {
  id: string;
  spans: { start: number; end: number }[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 与 `baseName` 同族的字幕轨：`字幕` / `字幕 2` / `字幕 3`… */
export function cueTrackPattern(baseName: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseName)}(?:\\s+\\d+)?$`);
}

/** 生成一个还没被占用的字幕轨名。 */
export function uniqueCueTrackName(doc: Project, baseName: string): string {
  const taken = new Set(doc.tracks.map((track) => track.name));
  if (!taken.has(baseName)) return baseName;
  let index = 2;
  while (taken.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

/**
 * 在最上方新建一条字幕轨并写入全部条目。
 * 调用方应在一次 `dispatch` 内使用，这样整批字幕只算一步撤销。
 */
export function insertCueTrack(
  doc: Project,
  cues: readonly CueInput[],
  baseName: string,
): Project {
  const usable = cues.filter((cue) => cue.text.trim().length > 0);
  if (usable.length === 0) return doc;

  let next = addTrackAt(doc, 0, uniqueCueTrackName(doc, baseName));
  const trackId = next.tracks[0].id;
  for (const cue of usable) {
    next = addClip(
      next,
      trackId,
      createClip({
        assetId: "",
        trackId,
        start: cue.start,
        duration: cue.duration,
        text: cue.text,
      }),
    );
  }
  return next;
}

/** 把与 `pattern` 匹配的字幕轨都提到最上方，保持它们之间的相对顺序。 */
function raiseCueTracks(doc: Project, pattern: RegExp): Project {
  const ids = doc.tracks.filter((track) => pattern.test(track.name)).map((track) => track.id);
  return raiseTracks(doc, ids);
}

/** 把导入 / 生成的字幕条目放进字幕轨（重叠时自动开新轨）。 */
export function placeSubtitleCues(
  doc: Project,
  entries: SubtitleEntry[],
  baseName: string,
  offset = 0,
): Project {
  if (entries.length === 0) return doc;

  const pattern = cueTrackPattern(baseName);
  const lanes: Lane[] = [];
  for (const track of doc.tracks) {
    if (track.locked || !pattern.test(track.name)) continue;
    lanes.push({
      id: track.id,
      spans: track.clips.map((clip) => ({
        start: clip.start,
        end: clip.start + clip.duration,
      })),
    });
  }

  let next = doc;
  const ordered = entries
    .filter((entry) => entry.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);

  for (const entry of ordered) {
    const start = Math.max(0, entry.start + offset);
    const duration = Math.max(1 / doc.fps, entry.end - entry.start);
    const end = start + duration;

    let lane = lanes.find((candidate) =>
      candidate.spans.every((span) => end <= span.start || start >= span.end),
    );

    if (!lane) {
      next = addTrackAt(next, 0, uniqueCueTrackName(next, baseName));
      const track = next.tracks[0];
      lane = { id: track.id, spans: [] };
      lanes.push(lane);
    }

    next = addClip(
      next,
      lane.id,
      createClip({
        assetId: "",
        trackId: lane.id,
        start,
        duration,
        text: entry.text.trim(),
      }),
    );
    lane.spans.push({ start, end });
  }

  // 复用旧字幕轨时也提回最上方：字幕不能被视频轨盖住。
  return raiseCueTracks(next, pattern);
}
