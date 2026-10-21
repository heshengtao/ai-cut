/** 音频处理结果落回时间线的纯函数。 */
import type { AssetKind, Clip, Project } from "@/types/project";
import type { LoudnessReport } from "@/types/models";
import { createClip } from "@/core/factory";
import { addClip, updateClip } from "@/core/ops";
import { addTrackAt } from "@/core/ops/tracks";

/** 响度统一的目标档位。 */
export type LoudnessTarget = "streaming" | "podcast" | "broadcast";

export const LOUDNESS_TARGETS: Record<LoudnessTarget, number> = {
  streaming: -14,
  podcast: -16,
  broadcast: -23,
};

/** 真峰值上限：留 1 dB 余量给编解码后的采样间峰值。 */
export const TRUE_PEAK_CEILING_DBTP = -1;

/**
 * 由测量结果算出一个非破坏性的片段增益（dB）。
 *
 * 同时满足「积分响度到目标」与「真峰值不超过 ceiling」，并夹到 `clip.gain` 的
 * 合法区间（-60..12 dB）。静音返回 null。
 */
export function loudnessGain(
  report: LoudnessReport,
  targetLufs: number,
  ceilingDbtp = TRUE_PEAK_CEILING_DBTP,
): number | null {
  const lufs = report.integrated_lufs;
  if (lufs === null || !Number.isFinite(lufs)) return null;
  let gain = targetLufs - lufs;
  const peak = report.true_peak_dbtp;
  if (peak !== null && Number.isFinite(peak)) {
    gain = Math.min(gain, ceilingDbtp - peak);
  }
  return Math.max(-60, Math.min(12, gain));
}

/** 用处理后生成的新素材替换片段引用；入点归零，时长不超过新素材。 */
export function replaceClipAudio(
  doc: Project,
  clipId: string,
  assetId: string,
  assetDuration: number,
  clipDuration: number,
): Project {
  const duration =
    assetDuration > 0 ? Math.min(clipDuration, assetDuration) : clipDuration;
  return updateClip(doc, clipId, { assetId, in: 0, duration });
}

/**
 * 把单个处理结果落回时间线。
 *
 * - 纯音频片段：直接替换素材引用，不新增轨道。
 * - 视频片段：保留画面，只静音原声，并把处理后的音频放到下面一条新轨。
 */
export function applyProcessedAudio(
  doc: Project,
  clip: Clip,
  assetId: string,
  assetDuration: number,
  sourceKind: AssetKind,
  trackName: string,
): Project {
  if (sourceKind === "audio" || clip.audioOnly) {
    return replaceClipAudio(doc, clip.id, assetId, assetDuration, clip.duration);
  }

  const sourceIndex = doc.tracks.findIndex((track) => track.id === clip.trackId);
  const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : doc.tracks.length;
  let next = updateClip(doc, clip.id, { muted: true });
  next = addTrackAt(next, insertAt, trackName);
  const track = next.tracks[insertAt];
  const duration = Math.min(
    clip.duration,
    assetDuration > 0 ? assetDuration : clip.duration,
  );
  if (duration > 0) {
    next = addClip(
      next,
      track.id,
      createClip({
        assetId,
        trackId: track.id,
        start: clip.start,
        duration,
        in: 0,
      }),
    );
  }
  return next;
}

export interface ExtractedAudio {
  doc: Project;
  /** 新建音频片段的 id；没有可分离内容时为 null。 */
  clipId: string | null;
  trackId: string | null;
}

/**
 * 把视频片段的声音拆到下面一条新轨道。
 *
 * 画面片段保持原位并静音，新的音频片段复用同一个素材与入点，
 * 这样两条轨道可以分别调整音量、降噪或替换音频。
 */
export function extractClipAudio(
  doc: Project,
  sourceClip: Clip,
  trackName: string,
): ExtractedAudio {
  if (sourceClip.assetId === "" || !(sourceClip.duration > 0)) {
    return { doc, clipId: null, trackId: null };
  }

  const sourceIndex = doc.tracks.findIndex((track) => track.id === sourceClip.trackId);
  const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : doc.tracks.length;

  let next = updateClip(doc, sourceClip.id, { muted: true });
  next = addTrackAt(next, insertAt, trackName);
  const track = next.tracks[insertAt];
  const audio = createClip({
    assetId: sourceClip.assetId,
    trackId: track.id,
    start: sourceClip.start,
    duration: sourceClip.duration,
    in: sourceClip.in ?? 0,
  });
  next = addClip(next, track.id, { ...audio, audioOnly: true });
  return { doc: next, clipId: audio.id, trackId: track.id };
}

export interface StemTrackInput {
  /** 展示名（鼓 / 贝斯 / 其他 / 人声 …）。 */
  label: string;
  assetId: string;
  duration: number;
}

/**
 * 在源轨道下面新建分轨，并把分轨片段对齐到源片段起点。
 *
 * `muteSource` 为真时静音「源片段」而不是整条轨道，避免误伤同轨其它片段。
 */
export function addStemTracks(
  doc: Project,
  sourceClip: Clip,
  stems: StemTrackInput[],
  baseName: string,
  muteSource = true,
): Project {
  if (stems.length === 0) return doc;

  const sourceIndex = doc.tracks.findIndex((track) => track.id === sourceClip.trackId);
  let next = muteSource ? updateClip(doc, sourceClip.id, { muted: true }) : doc;
  let insertAt = sourceIndex >= 0 ? sourceIndex + 1 : next.tracks.length;

  for (const stem of stems) {
    next = addTrackAt(next, insertAt, `${baseName} · ${stem.label}`);
    const track = next.tracks[insertAt];
    const duration = Math.min(sourceClip.duration, stem.duration);
    if (duration > 0) {
      next = addClip(
        next,
        track.id,
        createClip({
          assetId: stem.assetId,
          trackId: track.id,
          start: sourceClip.start,
          duration,
          in: 0,
        }),
      );
    }
    insertAt += 1;
  }
  return next;
}
