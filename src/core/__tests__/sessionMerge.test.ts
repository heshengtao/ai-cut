import { describe, expect, it } from "vitest";
import { mergeRemoteProject } from "@/core/sessionMerge";
import { newEpisode, patchProjectMeta } from "@/core/episodes";
import { newProject } from "@/core/factory";
import type { Affected } from "@/types/events";
import type { Project, Track } from "@/types/project";

function track(id: string, name = id): Track {
  return { id, name, muted: false, locked: false, visible: true, clips: [] };
}

/** 合并结果必须始终满足「投影 == 当前分P 的轨道」。 */
function expectConsistent(merged: Project): void {
  const active = merged.episodes.find((episode) => episode.id === merged.activeEpisodeId)!;
  expect(merged.tracks).toBe(active.tracks);
}

function docWith(name: string, tracks: Track[]): Project {
  const base = newProject(name);
  return patchProjectMeta(base, {
    episodes: [{ ...base.episodes[0], tracks }],
  });
}

describe("mergeRemoteProject", () => {
  it("同一分P：只替换受影响轨道，保留另一条本地轨道", () => {
    const local = docWith("local", [track("t1", "local-t1"), track("t2", "local-t2")]);
    // 远端快照是同一个工程：分P id 必须一致，只有轨道内容不同。
    const incoming = patchProjectMeta(local, {
      name: "remote",
      episodes: local.episodes.map((episode) => ({
        ...episode,
        tracks: [track("t1", "remote-t1"), track("t2", "remote-t2")],
      })),
    });
    const merged = mergeRemoteProject(
      local,
      incoming,
      {
        clipIds: [],
        trackIds: ["t1"],
        assetIds: [],
        episodeId: local.activeEpisodeId,
      },
      false,
    );
    expectConsistent(merged);
    expect(merged.name).toBe("remote");
    expect(merged.tracks[0].name).toBe("remote-t1");
    expect(merged.tracks[1].name).toBe("local-t2");
  });

  it("不同分P 的补丁不动当前分P 的轨道", () => {
    const localBase = newProject("local");
    const second = newEpisode("分P 2", 1);
    const local = patchProjectMeta(localBase, {
      episodes: [
        { ...localBase.episodes[0], tracks: [track("t1", "local-t1")] },
        { ...second, tracks: [track("r1", "local-r1")] },
      ],
    });
    const incoming = patchProjectMeta(local, {
      episodes: local.episodes.map((episode) =>
        episode.id === second.id
          ? { ...episode, tracks: [track("r1", "remote-r1")] }
          : { ...episode, tracks: [track("t1", "remote-t1")] },
      ),
    });

    const merged = mergeRemoteProject(
      local,
      incoming,
      {
        clipIds: [],
        trackIds: ["r1"],
        assetIds: [],
        episodeId: second.id,
      },
      false,
    );

    expectConsistent(merged);
    expect(merged.activeEpisodeId).toBe(local.activeEpisodeId);
    expect(merged.tracks[0].name).toBe("local-t1");
    const other = merged.episodes.find((episode) => episode.id === second.id)!;
    expect(other.tracks[0].name).toBe("remote-r1");
  });

  it("远端新建的分P 会被带过来", () => {
    const local = docWith("local", []);
    const extra = newEpisode("远端新集", 1);
    const incoming = patchProjectMeta(local, {
      episodes: [...local.episodes, extra],
    });
    const merged = mergeRemoteProject(
      local,
      incoming,
      {
        clipIds: [],
        trackIds: [],
        assetIds: [],
        episodeId: local.activeEpisodeId,
      },
      false,
    );
    expectConsistent(merged);
    expect(merged.episodes.some((episode) => episode.id === extra.id)).toBe(true);
  });

  it("full 或没有 affected 时整份替换", () => {
    const local = docWith("local", []);
    const incoming = docWith("remote", []);
    expect(mergeRemoteProject(local, incoming, null, false)).toBe(incoming);
    expect(mergeRemoteProject(local, incoming, null, true)).toBe(incoming);
  });
});
