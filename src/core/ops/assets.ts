/** 素材 ops：工程里的素材表，以及素材与片段的引用关系。 */
import type { MediaAsset, Project } from "@/types/project";
import { withTouch } from "./internal";

export function addAsset(doc: Project, asset: MediaAsset): Project {
  if (doc.assets.some((a) => a.id === asset.id)) return doc;
  return withTouch(doc, { assets: [...doc.assets, asset] });
}

/** 删除素材，并连带删除所有引用它的片段。 */
export function removeAsset(doc: Project, assetId: string): Project {
  const assets = doc.assets.filter((a) => a.id !== assetId);
  if (assets.length === doc.assets.length) return doc;
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const clips = track.clips.filter((c) => c.assetId !== assetId);
    if (clips.length === track.clips.length) return track;
    changed = true;
    return { ...track, clips };
  });
  return withTouch(doc, changed ? { assets, tracks } : { assets });
}

/** 局部更新素材（缩略图/波形/离线标记等）。 */
export function updateAsset(doc: Project, assetId: string, patch: Partial<MediaAsset>): Project {
  const index = doc.assets.findIndex((a) => a.id === assetId);
  if (index < 0) return doc;
  const assets = doc.assets.slice();
  assets[index] = { ...assets[index], ...patch };
  return withTouch(doc, { assets });
}

/** 重新链接离线素材。 */
export function relinkAsset(doc: Project, assetId: string, newSrc: string): Project {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (!asset) return doc;
  if (asset.src === newSrc && !asset.offline) return doc;
  return updateAsset(doc, assetId, { src: newSrc, offline: false });
}
