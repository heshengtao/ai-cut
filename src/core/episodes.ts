/**
 * 工程分P（Episode）的文档视图。
 *
 * 真相在 `doc.episodes`；`doc.tracks` / `doc.markers` 是指向**当前分P**的
 * 不可枚举访问器：getter 返回真实数组引用（所以 `doc.tracks.push(…)` 这类原地
 * 修改天然正确），setter 整体替换。这样 300 多处 `doc.tracks` 调用不必改动。
 *
 * 纪律：任何 `{ ...doc, tracks }` 展开都会丢掉访问器，所以每个文档产出点
 * （`withTouch`、store 赋值、`parseProject`、会话合并）都必须调用
 * `attachEpisodeView()` 折返。本文件不许 import Vue / store。
 */
import type { Episode, Marker, Project, Track } from "@/types/project";
import { attachBoardView, isBoardViewAttached } from "@/core/board/projectBoards";
import { t } from "@/i18n/translate";

/** 已挂过投影的文档对象（同一个对象只挂一次）。 */
const attached = new WeakSet<object>();

/** 该文档上的投影是否已就绪。 */
export function isEpisodeViewAttached(doc: Project): boolean {
  return attached.has(doc);
}

function hasEpisodes(doc: Project): boolean {
  const episodes = (doc as Partial<Project>).episodes;
  return Array.isArray(episodes) && episodes.length > 0;
}

/** 当前分P；`activeEpisodeId` 失效时回落到第一个。 */
export function activeEpisode(doc: Project): Episode {
  const found = doc.episodes.find((episode) => episode.id === doc.activeEpisodeId);
  return found ?? doc.episodes[0];
}

/** 新建一个空分P。 */
export function newEpisode(name: string, order: number): Episode {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    order,
    tracks: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** v1 工程（根级 tracks / markers）包成一个分P。已是 v2 时原样返回。 */
export function migrateToEpisodes(doc: Project): Project {
  if (hasEpisodes(doc)) return doc;
  const episode: Episode = {
    id: crypto.randomUUID(),
    name: t("episode.defaultName", { index: 1 }),
    order: 0,
    tracks: Array.isArray(doc.tracks) ? doc.tracks : [],
    markers: Array.isArray(doc.markers) ? doc.markers : [],
    createdAt: doc.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  return { ...doc, version: 2, episodes: [episode], activeEpisodeId: episode.id };
}

function replaceActiveEpisode(doc: Project, patch: Partial<Episode>): void {
  const target = activeEpisode(doc);
  doc.episodes = doc.episodes.map((episode) =>
    episode.id === target.id ? { ...episode, ...patch, updatedAt: Date.now() } : episode,
  );
}

function defineView(doc: Project): Project {
  Object.defineProperties(doc, {
    tracks: {
      // 必须是**可枚举**访问器：`{ ...doc }` 展开时才会把数组值拷过去，
      // 外部展开出来的文档因此仍然有 `doc.tracks`，不需要改造那 300 多处调用。
      // 代价是 JSON 里会出现重复字段，由 `serializeProject()` 负责剔除。
      enumerable: true,
      configurable: true,
      get: () => activeEpisode(doc).tracks,
      set: (value: Track[]) => replaceActiveEpisode(doc, { tracks: value }),
    },
    markers: {
      enumerable: true,
      configurable: true,
      get: () => activeEpisode(doc).markers,
      set: (value: Marker[]) => replaceActiveEpisode(doc, { markers: value }),
    },
  });
  attached.add(doc);
  return doc;
}

/**
 * 把文档折回「episodes 是真相 + 访问器就绪」的形态。
 *
 * - v1 文档 → 先迁移成一个分P；
 * - 被 `{ ...doc }` 展开过（有自有 `tracks` / `markers`）→ 折回当前分P，
 *   并替换而不是原地修改分P 对象，保证撤销快照里的旧文档不被改到；
 * - 已就绪 → 返回原对象（幂等，`dispatch` 的 `next === before` 判断依赖它）。
 */
export function attachEpisodeView(input: Project): Project {
  const doc = hasEpisodes(input) ? input : migrateToEpisodes(input);
  const target = activeEpisode(doc);
  // 投影是访问器；被 `{ ...doc }` 展开过的会变成普通数据字段（没有 getter）。
  const trackAccessor = Boolean(Object.getOwnPropertyDescriptor(doc, "tracks")?.get);
  const markerAccessor = Boolean(Object.getOwnPropertyDescriptor(doc, "markers")?.get);
  const ownTracks = !trackAccessor && Array.isArray((doc as Partial<Project>).tracks);
  const ownMarkers = !markerAccessor && Array.isArray((doc as Partial<Project>).markers);

  if (
    attached.has(doc) &&
    isBoardViewAttached(doc) &&
    doc.activeEpisodeId === target.id &&
    trackAccessor &&
    markerAccessor
  ) {
    return doc;
  }

  const tracks = ownTracks ? (doc.tracks as Track[]) : target.tracks;
  const markers = ownMarkers ? (doc.markers as Marker[]) : target.markers;
  const episodes = doc.episodes.map((episode) =>
    episode.id === target.id ? { ...episode, tracks, markers } : episode,
  );
  const next = { ...doc, episodes, activeEpisodeId: target.id } as Project;
  delete (next as Partial<Project>).tracks;
  delete (next as Partial<Project>).markers;
  return defineView(attachBoardView(next));
}

/**
 * 只改工程级字段（改名 / 剪口组 / 分P 列表 / activeEpisodeId）时用它。
 *
 * 普通 `{ ...doc, patch }` 展开会把当前分P 的 `tracks` 值拷成自有数据字段，折返时
 * 会把它灌进**新的**当前分P（切分P 会把上一集的轨道带过去）。这里先剔除投影再折返。
 */
export function patchProjectMeta(doc: Project, patch: Partial<Project>): Project {
  const next = { ...doc, ...patch } as Project;
  delete (next as Partial<Project>).tracks;
  delete (next as Partial<Project>).markers;
  return attachEpisodeView(next);
}

/** 切到另一个分P；id 不存在或已经是当前分P 时返回 null。 */
export function switchActiveEpisode(doc: Project, episodeId: string): Project | null {
  if (!hasEpisodes(doc)) return null;
  if (doc.activeEpisodeId === episodeId) return null;
  if (!doc.episodes.some((episode) => episode.id === episodeId)) return null;
  return patchProjectMeta(doc, { activeEpisodeId: episodeId });
}
