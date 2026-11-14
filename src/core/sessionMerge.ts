/**
 * 多端会话的工程合并。
 *
 * 每个客户端都持有完整文档；一次编辑只广播「受影响的对象」：
 * 轨道按整条替换，素材按条替换，工程级字段（名称 / 帧率 / 分辨率 / 标记）以后到者为准。
 * 这样两台机器同时改不同轨道不会互相覆盖；同一条轨道上的并发编辑按到达顺序取后者。
 */
import type { Affected } from "@/types/events";
import type { Project } from "@/types/project";

function owningTrackIds(project: Project, clipIds: Set<string>): string[] {
  const ids: string[] = [];
  for (const track of project.tracks) {
    if (track.clips.some((clip) => clipIds.has(clip.id))) ids.push(track.id);
  }
  return ids;
}

/** 把远端快照合并进当前文档；`full` 或没有 affected 时整份替换。 */
export function mergeRemoteProject(
  current: Project,
  incoming: Project,
  affected: Affected | null | undefined,
  full: boolean,
): Project {
  if (full || !affected) return incoming;

  const clipIds = new Set(affected.clipIds);
  const trackIds = new Set(affected.trackIds);
  const assetIds = new Set(affected.assetIds);
  for (const id of owningTrackIds(current, clipIds)) trackIds.add(id);
  for (const id of owningTrackIds(incoming, clipIds)) trackIds.add(id);

  const incomingTracks = new Map(incoming.tracks.map((track) => [track.id, track]));
  const tracks = current.tracks.filter(
    (track) => !trackIds.has(track.id) || incomingTracks.has(track.id),
  );
  for (const [index, track] of incoming.tracks.entries()) {
    if (!trackIds.has(track.id)) continue;
    const localIndex = tracks.findIndex((item) => item.id === track.id);
    if (localIndex >= 0) tracks[localIndex] = track;
    else tracks.splice(Math.min(index, tracks.length), 0, track);
  }

  const incomingAssets = new Map(incoming.assets.map((asset) => [asset.id, asset]));
  const assets = current.assets.filter(
    (asset) => !assetIds.has(asset.id) || incomingAssets.has(asset.id),
  );
  for (const [index, asset] of incoming.assets.entries()) {
    if (!assetIds.has(asset.id)) continue;
    const localIndex = assets.findIndex((item) => item.id === asset.id);
    if (localIndex >= 0) assets[localIndex] = asset;
    else assets.splice(Math.min(index, assets.length), 0, asset);
  }

  return { ...incoming, tracks, assets };
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
