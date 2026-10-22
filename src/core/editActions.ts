/** 确定性剪辑动作：供智能体/MCP 一步完成，不必手工拼多条命令。 */
import type { Clip, MediaAsset } from "@/types/project";
import { extractClipAudio } from "@/core/audioEdit";
import { useProjectStore } from "@/stores/project";
import { t } from "@/i18n";

export interface ExtractAudioParams {
  clipId: string;
  trackName?: string;
  actor?: "human" | "agent";
  sessionId?: string;
}

/**
 * 把视频片段的音轨拆到下面一条新轨道：原片段静音，新片段复用同一素材并标记 audioOnly。
 */
export function extractAudio(params: ExtractAudioParams) {
  const project = useProjectStore();
  let clip: Clip | null = null;
  let asset: MediaAsset | null = null;
  for (const track of project.doc.tracks) {
    const found = track.clips.find((candidate) => candidate.id === params.clipId);
    if (!found) continue;
    clip = found;
    asset = project.doc.assets.find((candidate) => candidate.id === found.assetId) ?? null;
    break;
  }
  if (!clip) throw new Error(`片段不存在：${params.clipId}`);
  if (!asset) throw new Error(`片段 ${params.clipId} 没有关联素材`);
  if (asset.kind !== "video") throw new Error(`片段 ${params.clipId} 不是视频素材`);
  if (clip.audioOnly) throw new Error(`片段 ${params.clipId} 已经是纯音频片段`);
  if (!(clip.duration > 0)) throw new Error(`片段 ${params.clipId} 时长无效`);

  const target = clip;
  const before = project.doc;
  const previousTracks = new Set(before.tracks.map((track) => track.id));
  project.dispatch(
    (doc) =>
      extractClipAudio(
        doc,
        target,
        params.trackName?.trim() || t("inspector.extractAudioTrack"),
      ).doc,
    {
      kind: "ui.dispatch",
      actor: params.actor ?? "agent",
      label: "分离音频",
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    },
  );

  const track = project.doc.tracks.find((candidate) => !previousTracks.has(candidate.id));
  return {
    sourceClipId: params.clipId,
    track: track
      ? { id: track.id, name: track.name, clipCount: track.clips.length }
      : null,
    audioClipId: track?.clips[0]?.id ?? null,
    mutedSource: project.doc.tracks
      .flatMap((candidate) => candidate.clips)
      .find((candidate) => candidate.id === params.clipId)?.muted ?? false,
    revision: project.revision,
  };
}
