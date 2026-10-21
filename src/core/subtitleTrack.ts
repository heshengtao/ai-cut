/** 把字幕条目放进文字轨：重叠时自动拆到新轨，保证同轨不重叠。 */
import type { Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrackAt } from "@/core/ops/tracks";
import type { SubtitleEntry } from "@/core/subtitleFile";

interface Lane {
  id: string;
  spans: { start: number; end: number }[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trackPattern(baseName: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseName)}(?:\\s+\\d+)?$`);
}

export function placeSubtitleCues(
  doc: Project,
  entries: SubtitleEntry[],
  baseName: string,
  offset = 0,
): Project {
  if (entries.length === 0) return doc;

  const pattern = trackPattern(baseName);
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
      let name = baseName;
      let index = 2;
      while (next.tracks.some((track) => track.name === name)) {
        name = `${baseName} ${index++}`;
      }
      next = addTrackAt(next, 0, name);
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

  return next;
}
