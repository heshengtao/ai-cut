import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addClip, addTrack } from "@/core/ops";
import {
  addEpisode,
  duplicateEpisode,
  episodeDuration,
  moveEpisode,
  removeEpisode,
  renameEpisode,
} from "@/core/ops/episodes";
import { createClip } from "@/core/factory";
import type { Episode, Project } from "@/types/project";

function base(): Project {
  return newProject("剧集");
}

describe("addEpisode", () => {
  it("追加到末尾、order 递增、不切换当前分P", () => {
    const first = base();
    const doc = addEpisode(addEpisode(first, "第二集"), "第三集");
    expect(doc.episodes).toHaveLength(3);
    expect(doc.episodes.map((episode) => episode.order)).toEqual([0, 1, 2]);
    expect(doc.activeEpisodeId).toBe(first.activeEpisodeId);
    expect(doc.tracks).toBe(doc.episodes[0].tracks);
  });
});

describe("renameEpisode", () => {
  it("只改目标分P", () => {
    const doc = addEpisode(base(), "第二集");
    const target = doc.episodes[1].id;
    const next = renameEpisode(doc, target, "改名了");
    expect(next.episodes[1].name).toBe("改名了");
    expect(next.episodes[0].name).toBe(doc.episodes[0].name);
  });

  it("空名字不生效", () => {
    const doc = base();
    expect(renameEpisode(doc, doc.episodes[0].id, "   ")).toBe(doc);
  });
});

describe("removeEpisode", () => {
  it("删掉非当前分P，当前分P 不变", () => {
    const doc = addEpisode(base(), "第二集");
    const next = removeEpisode(doc, doc.episodes[1].id);
    expect(next.episodes).toHaveLength(1);
    expect(next.activeEpisodeId).toBe(doc.activeEpisodeId);
  });

  it("删掉当前分P 时落到相邻分P", () => {
    const doc = addEpisode(base(), "第二集");
    const second = doc.episodes[1].id;
    const switchedToSecond = { ...doc, activeEpisodeId: second } as Project;
    const next = removeEpisode(switchedToSecond, second);
    expect(next.episodes).toHaveLength(1);
    expect(next.activeEpisodeId).toBe(next.episodes[0].id);
    expect(next.tracks).toBe(next.episodes[0].tracks);
  });

  it("只剩一个分P 时原样返回", () => {
    const doc = base();
    expect(removeEpisode(doc, doc.episodes[0].id)).toBe(doc);
  });
});

describe("moveEpisode", () => {
  it("调整顺序并重排 order", () => {
    const a = base();
    const doc = addEpisode(addEpisode(a, "第二集"), "第三集");
    const ids = doc.episodes.map((episode) => episode.id);
    const next = moveEpisode(doc, ids[2], 0);
    expect(next.episodes.map((episode) => episode.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(next.episodes.map((episode) => episode.order)).toEqual([0, 1, 2]);
  });
});

describe("duplicateEpisode", () => {
  it("复制轨道 / 片段 / 标记并换成新 id", () => {
    let doc = base();
    doc = addTrack(doc);
    const trackId = doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 3 });
    doc = addClip(doc, trackId, clip);

    const copy = duplicateEpisode(doc, doc.episodes[0].id, "副本");
    expect(copy.episodes).toHaveLength(2);
    const original = copy.episodes[0];
    const duplicated = copy.episodes[1];
    expect(duplicated.name).toBe("副本");
    expect(duplicated.tracks).toHaveLength(1);
    expect(duplicated.tracks[0].id).not.toBe(original.tracks[0].id);
    expect(duplicated.tracks[0].clips[0].id).not.toBe(original.clips?.[0]?.id ?? "");
    expect(duplicated.tracks[0].clips[0].assetId).toBe("a1");
    expect(duplicated.tracks[0].clips[0].start).toBe(0);
    expect(copy.activeEpisodeId).toBe(doc.activeEpisodeId);
  });
});

describe("episodeDuration", () => {
  it("取最大 start + duration", () => {
    const episode = {
      id: "e",
      name: "分P",
      order: 0,
      tracks: [
        {
          id: "t",
          name: "轨道",
          muted: false,
          visible: true,
          locked: false,
          clips: [
            { id: "c1", assetId: "a", start: 2, duration: 1, in: 0 } as never,
            { id: "c2", assetId: "a", start: 5, duration: 4, in: 0 } as never,
          ],
        },
      ],
      markers: [],
      createdAt: 0,
      updatedAt: 0,
    } satisfies Episode;
    expect(episodeDuration(episode)).toBe(9);
  });

  it("空分P 是 0", () => {
    const doc = base();
    expect(episodeDuration(doc.episodes[0])).toBe(0);
  });
});
