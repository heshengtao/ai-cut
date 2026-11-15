/**
 * 多端会话的工程合并。
 *
 * 每个客户端都持有完整文档；一次编辑只广播「受影响的对象 + 分P」：
 * 同一分P 内轨道按整条替换、素材按条替换，工程级字段（名称 / 帧率 / 分辨率）以后到者为准；
 * 不同分P 的补丁互不覆盖，当前分P 由本地决定（远端不会把你从正在剪的那一集踢走）。
 * 远端新建的分P 会被带过来。
 */
import { attachEpisodeView, patchProjectMeta } from "@/core/episodes";
import type { Affected } from "@/types/events";
import type { Episode, MediaAsset, Project, Track } from "@/types/project";

function owningTrackIds(tracks: Track[], clipIds: Set<string>): string[] {
  const ids: string[] = [];
  for (const track of tracks) {
    if (track.clips.some((clip) => clipIds.has(clip.id))) ids.push(track.id);
  }
  return ids;
}

/** 在一个分P 内合并轨道：只替换受影响的轨道，其余保留本地版本。 */
function mergeEpisodeTracks(local: Episode, incoming: Episode, trackIds: Set<string>): Episode {
  const incomingTracks = new Map(incoming.tracks.map((track) => [track.id, track]));
  const tracks = local.tracks.filter(
    (track) => !trackIds.has(track.id) || incomingTracks.has(track.id),
  );
  for (const [index, track] of incoming.tracks.entries()) {
    if (!trackIds.has(track.id)) continue;
    const localIndex = tracks.findIndex((item) => item.id === track.id);
    if (localIndex >= 0) tracks[localIndex] = track;
    else tracks.splice(Math.min(index, tracks.length), 0, track);
  }
  return { ...incoming, tracks };
}

/** 素材按 id 合并：只替换受影响的条目。 */
function mergeAssets(
  local: MediaAsset[],
  incoming: MediaAsset[],
  assetIds: Set<string>,
): MediaAsset[] {
  const incomingAssets = new Map(incoming.map((asset) => [asset.id, asset]));
  const assets = local.filter(
    (asset) => !assetIds.has(asset.id) || incomingAssets.has(asset.id),
  );
  for (const [index, asset] of incoming.entries()) {
    if (!assetIds.has(asset.id)) continue;
    const localIndex = assets.findIndex((item) => item.id === asset.id);
    if (localIndex >= 0) assets[localIndex] = asset;
    else assets.splice(Math.min(index, assets.length), 0, asset);
  }
  return assets;
}

/** 把远端快照合并进当前文档；`full` 或没有 affected 时整份替换。 */
export function mergeRemoteProject(
  current: Project,
  incoming: Project,
  affected: Affected | null | undefined,
  full: boolean,
): Project {
  if (full || !affected) return attachEpisodeView(incoming);

  const clipIds = new Set(affected.clipIds);
  const patchEpisodeId = affected.episodeId ?? incoming.activeEpisodeId;
  const incomingEpisode = incoming.episodes.find((episode) => episode.id === patchEpisodeId);
  const clipOwners = new Set([
    ...owningTrackIds(current.tracks, clipIds),
    ...(incomingEpisode ? owningTrackIds(incomingEpisode.tracks, clipIds) : []),
  ]);
  const trackIds = new Set([...affected.trackIds, ...clipOwners]);

  const episodes = current.episodes.map((episode) => {
    if (episode.id !== patchEpisodeId || !incomingEpisode) return episode;
    return mergeEpisodeTracks(episode, incomingEpisode, trackIds);
  });
  const known = new Set(current.episodes.map((episode) => episode.id));
  for (const episode of incoming.episodes) {
    if (!known.has(episode.id)) episodes.push(episode);
  }

  // 用 patchProjectMeta 而不是裸展开：展开会把 incoming 的 tracks 拷成自有字段，
  // 折返时覆盖掉刚合并好的 episodes。
  return patchProjectMeta(incoming, {
    episodes,
    activeEpisodeId: current.activeEpisodeId,
    assets: mergeAssets(current.assets, incoming.assets, new Set(affected.assetIds)),
  });
}

const CLIENT_KEY = "ai-cut-session-client";

/** 当前客户端的稳定 id：桌面与每个浏览器标签各一个，用于忽略自己的广播。 */
export function sessionClientId(): string {
  try {
    const existing = sessionStorage.getItem(CLIENT_KEY);
    if (existing) return existing;
    const id = `c-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    return `c-${Math.random().toString(36).slice(2, 10)}`;
  }
}
