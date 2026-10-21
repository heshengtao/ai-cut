/** AI 朗读轨道分配：音频按文字片段起点对齐，重叠时自动拆到新轨道。 */
import type { Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

export interface VoiceoverItem {
  /** 文字片段 id（只用于调试与回查）。 */
  id: string;
  assetId: string;
  start: number;
  duration: number;
}

interface Lane {
  id: string;
  name: string;
  spans: { start: number; end: number }[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trackPattern(baseName: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseName)}(?:\\s+\\d+)?$`);
}

function findFreeLane(lanes: Lane[], start: number, end: number): Lane | null {
  return (
    lanes.find((lane) =>
      lane.spans.every((span) => end <= span.start || start >= span.end),
    ) ?? null
  );
}

/**
 * 把朗读音频放进时间线。
 *
 * - 每段音频的 `start` 始终等于对应文字片段的起点，不做任何推移；
 * - 优先复用同名的「朗读」轨道；与已有片段重叠时新建一条轨道，
 *   保证文字与语音不会错位；
 * - 一次调用只产生一个新的工程文档，调用方可以在同一个事务里提交。
 */
export function placeVoiceover(
  doc: Project,
  items: VoiceoverItem[],
  baseName: string,
): Project {
  if (items.length === 0) return doc;

  const pattern = trackPattern(baseName);
  const lanes: Lane[] = [];
  for (const track of doc.tracks) {
    if (track.locked || !pattern.test(track.name)) continue;
    lanes.push({
      id: track.id,
      name: track.name,
      spans: track.clips.map((clip) => ({
        start: clip.start,
        end: clip.start + clip.duration,
      })),
    });
  }

  let next = doc;
  const ordered = items
    .filter((item) => item.duration > 0)
    .slice()
    .sort((a, b) => a.start - b.start || a.duration - b.duration);

  for (const item of ordered) {
    const end = item.start + item.duration;
    let lane = findFreeLane(lanes, item.start, end);

    if (!lane) {
      let name = baseName;
      let index = 2;
      while (next.tracks.some((track) => track.name === name)) {
        name = `${baseName} ${index++}`;
      }
      next = addTrack(next, name);
      const track = next.tracks[next.tracks.length - 1];
      lane = { id: track.id, name, spans: [] };
      lanes.push(lane);
    }

    const clip = createClip({
      assetId: item.assetId,
      trackId: lane.id,
      start: item.start,
      duration: item.duration,
    });
    next = addClip(next, lane.id, clip);
    lane.spans.push({ start: item.start, end });
  }

  return next;
}
