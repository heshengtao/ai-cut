/**
 * 时间线片段剪贴板：复制 / 剪切 / 粘贴。
 *
 * 剪贴板只存片段快照和「相对轨道序号 + 相对时间偏移」；粘贴时按当前工程重建：
 * 原轨道被删掉时夹到最后一条轨道，目标轨道被锁定就换一条未锁定的，
 * 落点与已有片段重叠时向右顺延——始终得到合法时间线，而不是直接报错。
 */
import { computed, ref } from "vue";
import type { Clip, Project } from "@/types/project";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

export interface ClipClipboardEntry {
  /** 复制时的片段快照（与源工程解耦）。 */
  clip: Clip;
  /** 复制时的轨道序号：粘贴优先回到同一层。 */
  trackIndex: number;
  /** 相对整组最早起点的偏移（秒）。 */
  offset: number;
}

const entries = ref<ClipClipboardEntry[]>([]);

/** 剪贴板里的片段数；0 表示「粘贴」不可用。 */
export const clipboardCount = computed(() => entries.value.length);

/** 片段是纯 JSON：深拷贝一份快照，之后改工程不会污染剪贴板。 */
function snapshot(clip: Clip): Clip {
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

/**
 * 把片段放进剪贴板，记录它们之间的相对位置。
 * 返回实际复制的片段数（0 表示没有命中任何片段）。
 */
export function copyClipsToClipboard(doc: Project, clipIds: readonly string[]): number {
  const ids = new Set(clipIds);
  if (ids.size === 0) return 0;

  const picked: ClipClipboardEntry[] = [];
  doc.tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) {
      if (!ids.has(clip.id)) continue;
      picked.push({ clip: snapshot(clip), trackIndex, offset: 0 });
    }
  });
  if (picked.length === 0) return 0;

  const base = Math.min(...picked.map((entry) => entry.clip.start));
  for (const entry of picked) entry.offset = Math.max(0, entry.clip.start - base);
  entries.value = picked;
  return picked.length;
}

export function clearClipClipboard(): void {
  entries.value = [];
}

/** 粘贴目标轨道：优先原序号，越界夹紧；锁定就换第一条未锁定轨道。 */
function targetTrack(doc: Project, index: number) {
  if (doc.tracks.length === 0) return null;
  const clamped = Math.min(Math.max(index, 0), doc.tracks.length - 1);
  const preferred = doc.tracks[clamped];
  if (preferred && !preferred.locked) return preferred;
  return doc.tracks.find((track) => !track.locked) ?? preferred ?? null;
}

/**
 * 把剪贴板条目铺到 `at` 处。
 *
 * 组内保持相对偏移；某个片段会压到已有片段时，只有它自己向右顺延，
 * 不会因为一次冲突丢掉整组。
 */
export function pasteClips(
  doc: Project,
  entriesToPaste: readonly ClipClipboardEntry[],
  at: number,
): { doc: Project; ids: string[] } {
  if (entriesToPaste.length === 0) return { doc, ids: [] };

  // 空工程也允许粘贴：先建一条轨道。
  let next = doc.tracks.length > 0 ? doc : addTrack(doc);
  const spans = new Map<string, { start: number; end: number }[]>();
  for (const track of next.tracks) {
    spans.set(
      track.id,
      track.clips.map((clip) => ({ start: clip.start, end: clip.start + clip.duration })),
    );
  }

  const ids: string[] = [];
  const ordered = [...entriesToPaste].sort((a, b) => a.offset - b.offset);
  for (const entry of ordered) {
    const track = targetTrack(next, entry.trackIndex);
    if (!track) continue;
    const duration = entry.clip.duration;
    if (!(duration > 0)) continue;

    const list = spans.get(track.id) ?? [];
    const collides = (value: number) =>
      list.some((span) => value < span.end - 1e-9 && span.start < value + duration - 1e-9);

    let start = Math.max(0, at + entry.offset);
    // 顺延到所有冲突片段的右缘；每次只会让 start 变大，最多迭代片段数次。
    for (let guard = 0; collides(start) && guard < 1000; guard += 1) {
      const blocking = list.filter(
        (span) => start < span.end - 1e-9 && span.start < start + duration - 1e-9,
      );
      start = Math.min(...blocking.map((span) => span.end));
    }
    if (collides(start)) continue;

    const clip: Clip = { ...entry.clip, id: crypto.randomUUID(), trackId: track.id, start };
    next = addClip(next, track.id, clip);
    list.push({ start, end: start + duration });
    ids.push(clip.id);
  }

  return { doc: next, ids };
}

/** 粘贴当前剪贴板内容。 */
export function pasteFromClipboard(doc: Project, at: number): { doc: Project; ids: string[] } {
  return pasteClips(doc, entries.value, at);
}
