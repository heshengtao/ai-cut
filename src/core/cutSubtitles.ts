/**
 * 把剪口播的词表变成时间线上的字幕片段。
 *
 * 剪完之后，被剪掉的词不再出现，剩下的词按「同一片段内、停顿不超过 0.6 秒、
 * 一行不超过 24 个字」归成一句，时间用片段自己的时钟折算。
 *
 * 这样改字就发生在时间线的字幕片段上，审查面板只负责剪 / 还原。
 */
import type { Clip, CutScope, Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrackAt, removeTrack } from "@/core/ops/tracks";

/** 一行字幕最多多少字。 */
const MAX_CUE_CHARS = 24;
/** 超过这个停顿就换一行（秒）。 */
const CUE_GAP = 0.6;

export interface CutCue {
  start: number;
  end: number;
  text: string;
  /** 这一句覆盖的词表下标范围（`起始-结束`），重铺时用来认「还是同一句」。 */
  key: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function speedOf(clip: Clip): number {
  return Math.min(4, Math.max(0.1, clip.speed ?? 1));
}

/** 中英混排时补一个空格，避免把两个英文单词粘成一个。 */
function appendText(current: string, next: string): string {
  if (!current) return next;
  const last = current[current.length - 1];
  const first = next[0] ?? "";
  const latin = /[A-Za-z0-9]/;
  if (latin.test(last) && latin.test(first)) return `${current} ${next}`;
  return current + next;
}

/**
 * 生成字幕条目。
 *
 * `clips` 是整条时间线的片段，函数只挑出属于这组剪口的那些。
 * 一条字幕不会跨片段（跨剪口），保证不会出现「字幕压着被剪掉的气口」。
 */
export function buildCutCues(
  scope: CutScope,
  words: Word[],
  clips: Clip[],
  fps: number,
): CutCue[] {
  const pieces = clips
    .filter((clip) => scope.pieces.includes(clip.id))
    .sort((a, b) => a.start - b.start);
  if (pieces.length === 0 || words.length === 0) return [];

  const minDuration = 1 / Math.max(1, fps);
  const cut = (word: Word): boolean => {
    const middle = (word.start + word.end) / 2;
    return scope.cuts.some((item) => middle >= item.srcStart && middle < item.srcEnd);
  };
  const pieceAt = (time: number): Clip | null =>
    pieces.find((piece) => {
      const span = piece.duration * speedOf(piece);
      return time >= piece.in - 1e-6 && time <= piece.in + span + 1e-6;
    }) ?? null;
  const toTimeline = (piece: Clip, time: number): number =>
    piece.start + (time - piece.in) / speedOf(piece);

  const cues: CutCue[] = [];
  let open: {
    pieceId: string;
    start: number;
    end: number;
    text: string;
    first: number;
    last: number;
  } | null = null;
  const flush = (): void => {
    if (!open) return;
    if (open.end - open.start >= minDuration && open.text.trim()) {
      cues.push({
        start: open.start,
        end: open.end,
        text: open.text.trim(),
        key: `${open.first}-${open.last}`,
      });
    }
    open = null;
  };

  for (const [position, word] of words.entries()) {
    if (cut(word)) {
      flush();
      continue;
    }
    const piece = pieceAt((word.start + word.end) / 2) ?? pieceAt(word.start);
    if (!piece) {
      flush();
      continue;
    }
    const start = toTimeline(piece, word.start);
    const end = Math.max(start + minDuration, toTimeline(piece, word.end));
    if (
      open &&
      (open.pieceId !== piece.id ||
        start - open.end > CUE_GAP ||
        open.text.length + word.text.length > MAX_CUE_CHARS)
    ) {
      flush();
    }
    if (!open) {
      open = { pieceId: piece.id, start, end, text: word.text, first: position, last: position };
    } else {
      open.end = Math.max(open.end, end);
      open.text = appendText(open.text, word.text);
      open.last = position;
    }
  }
  flush();

  // 同一轨上不能重叠：后一条的起点至少压到前一条结束之后一帧。
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    if (cues[index].start < previous.end + minDuration) {
      const start = previous.end + minDuration;
      cues[index] = { ...cues[index], start, end: Math.max(start + minDuration, cues[index].end) };
    }
  }
  return cues;
}

/** 建一条「口播字幕」轨：先删掉上一次生成的同名轨，再把条目放进去。 */
export function placeCueTrack(doc: Project, cues: CutCue[], name: string): Project {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+\\d+)?$`);

  // 先记住上一版同名字幕的文案：句子没被剪口切成/并成别的句子时，保留用户改过的字。
  const previous = new Map<string, { text: string; textStyle?: Clip["textStyle"] }>();
  for (const track of doc.tracks) {
    if (!pattern.test(track.name)) continue;
    for (const clip of track.clips) {
      if (clip.cueRange) {
        previous.set(clip.cueRange, {
          text: clip.text ?? "",
          ...(clip.textStyle ? { textStyle: clip.textStyle } : {}),
        });
      }
    }
  }

  let next = doc;
  for (const track of doc.tracks) {
    if (pattern.test(track.name)) next = removeTrack(next, track.id);
  }
  if (cues.length === 0) return next;

  const index = next.tracks.length;
  next = addTrackAt(next, index, name);
  const track = next.tracks[index];
  for (const cue of cues) {
    const duration = Math.max(1 / next.fps, cue.end - cue.start);
    const kept = previous.get(cue.key);
    const clip = createClip({
      assetId: "",
      trackId: track.id,
      start: cue.start,
      duration,
      text: kept?.text ?? cue.text,
    });
    clip.cueRange = cue.key;
    if (kept?.textStyle) clip.textStyle = kept.textStyle;
    next = addClip(next, track.id, clip);
  }
  return next;
}
