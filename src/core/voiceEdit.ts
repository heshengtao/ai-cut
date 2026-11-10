/**
 * 变声结果的落位：原片段就地静音，结果按原起点铺到「AI 变声」轨道。
 *
 * 复用朗读轨道的空轨打包规则：同名轨道放不下就自动加一条，
 * 保证任意两条结果不会在同一轨道上重叠。
 */
import type { Clip, Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip, setClipMuted } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

export interface ConvertedVoiceItem {
  clipId: string;
  assetId: string;
  /** 模型输出的真实时长（秒）。 */
  duration: number;
}

function locate(doc: Project, clipId: string): Clip | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

export function placeConvertedVoice(
  doc: Project,
  items: ConvertedVoiceItem[],
  baseName: string,
): Project {
  if (items.length === 0) return doc;

  const ordered = items
    .map((item) => ({ item, clip: locate(doc, item.clipId) }))
    .filter((entry): entry is { item: ConvertedVoiceItem; clip: Clip } => entry.clip !== null)
    .sort((a, b) => a.clip.start - b.clip.start);

  let next = doc;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:\\s+\\d+)?$`);
  const lanes: { id: string; spans: { start: number; end: number }[] }[] = [];
  for (const track of next.tracks) {
    if (track.locked || !pattern.test(track.name)) continue;
    lanes.push({
      id: track.id,
      spans: track.clips.map((clip) => ({
        start: clip.start,
        end: clip.start + clip.duration,
      })),
    });
  }

  for (const { item, clip } of ordered) {
    next = setClipMuted(next, clip.id, true);
    const duration = Math.min(item.duration, clip.duration);
    if (!(duration > 0)) continue;
    const end = clip.start + duration;

    let lane = lanes.find((candidate) =>
      candidate.spans.every((span) => end <= span.start || clip.start >= span.end),
    );
    if (!lane) {
      let name = baseName;
      let index = 2;
      while (next.tracks.some((track) => track.name === name)) name = `${baseName} ${index++}`;
      next = addTrack(next, name);
      const track = next.tracks[next.tracks.length - 1];
      lane = { id: track.id, spans: [] };
      lanes.push(lane);
    }

    next = addClip(
      next,
      lane.id,
      createClip({
        assetId: item.assetId,
        trackId: lane.id,
        start: clip.start,
        duration,
        in: 0,
      }),
    );
    lane.spans.push({ start: clip.start, end });
  }

  return next;
}
