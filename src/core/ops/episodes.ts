/**
 * 分P（Episode）的编辑操作：增 / 删 / 改名 / 排序 / 复制。
 *
 * 全部是不可变纯函数，经 `dispatch` 进撤销栈；改工程级字段一律走
 * `patchProjectMeta`，避免 `{ ...doc }` 展开把当前分P 的轨道灌进目标分P。
 */
import { newEpisode, patchProjectMeta } from "@/core/episodes";
import { withTouch } from "@/core/ops/internal";
import { cloneEpisode } from "./episodeClone";
import { pruneSeriesEdges } from "./series";
import type { Episode, Project } from "@/types/project";

/** 分P 时长：所有轨道里最靠后的片段终点。 */
export function episodeDuration(episode: Episode): number {
  let end = 0;
  for (const track of episode.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

/** 下一个 order 值。 */
function nextOrder(episodes: Episode[]): number {
  return episodes.reduce((max, episode) => Math.max(max, episode.order), -1) + 1;
}

/** 按当前顺序重排 `order`（0..n-1）。 */
function reindex(episodes: Episode[]): Episode[] {
  return episodes.map((episode, index) =>
    episode.order === index ? episode : { ...episode, order: index, updatedAt: Date.now() },
  );
}

/** 追加一个空白分P（不切换当前分P）。 */
export function addEpisode(doc: Project, name: string): Project {
  const episode = newEpisode(name, nextOrder(doc.episodes));
  return withTouch(doc, { episodes: [...doc.episodes, episode] }) as Project;
}

/** 改分P 名；空名不生效。 */
export function renameEpisode(doc: Project, episodeId: string, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  const target = doc.episodes.find((episode) => episode.id === episodeId);
  if (!target || target.name === trimmed) return doc;
  return withTouch(doc, {
    episodes: doc.episodes.map((episode) =>
      episode.id === episodeId ? { ...episode, name: trimmed, updatedAt: Date.now() } : episode,
    ),
  }) as Project;
}

/** 删除一个分P；只剩一个时原样返回。删到当前分P 时落到相邻分P。 */
export function removeEpisode(doc: Project, episodeId: string): Project {
  if (doc.episodes.length <= 1) return doc;
  const index = doc.episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return doc;
  const episodes = reindex(doc.episodes.filter((episode) => episode.id !== episodeId));
  const next =
    doc.activeEpisodeId !== episodeId
      ? (withTouch(doc, { episodes }) as Project)
      : patchProjectMeta(doc, {
          episodes,
          activeEpisodeId: episodes[Math.min(index, episodes.length - 1)].id,
        });
  return pruneSeriesEdges(next);
}

/** 把分P 移到 `toIndex`，并重排 order。 */
export function moveEpisode(doc: Project, episodeId: string, toIndex: number): Project {
  const from = doc.episodes.findIndex((episode) => episode.id === episodeId);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(toIndex, doc.episodes.length - 1));
  if (from === to) return doc;
  const episodes = [...doc.episodes];
  const [moved] = episodes.splice(from, 1);
  episodes.splice(to, 0, moved);
  return withTouch(doc, { episodes: reindex(episodes) }) as Project;
}

/** 复制一个分P（插在原分P 后面），轨道 / 片段 / 标记全部换新 id。 */
export function duplicateEpisode(doc: Project, episodeId: string, name: string): Project {
  const index = doc.episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return doc;
  const source = doc.episodes[index];
  const copy = cloneEpisode(source, name, index + 1);
  const episodes = [...doc.episodes];
  episodes.splice(index + 1, 0, copy);
  return withTouch(doc, { episodes: reindex(episodes) }) as Project;
}
