import { describe, expect, it } from "vitest";
import {
  activeEpisode,
  attachEpisodeView,
  isEpisodeViewAttached,
  switchActiveEpisode,
} from "@/core/episodes";
import { newProject } from "@/core/factory";
import { serializeProject } from "@/core/serialize";
import { renameProject } from "@/core/ops";
import type { Episode, Marker, Project, Track } from "@/types/project";

function track(id: string): Track {
  return { id, name: id, muted: false, visible: true, locked: false, clips: [] };
}

/** 一份 v1 形态的文档：根级 tracks / markers，没有 episodes。 */
function legacyDoc(): Project {
  const marker: Marker = { id: "m1", time: 0, name: "起点" };
  return {
    version: 1,
    name: "旧工程",
    createdAt: 1,
    updatedAt: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    tracks: [track("t1")],
    markers: [marker],
  } as unknown as Project;
}

describe("attachEpisodeView", () => {
  it("把 v1 文档迁移成一个分P", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(doc.version).toBe(2);
    expect(doc.episodes).toHaveLength(1);
    expect(doc.episodes[0].tracks.map((item) => item.id)).toEqual(["t1"]);
    expect(doc.episodes[0].markers.map((item) => item.id)).toEqual(["m1"]);
    expect(doc.activeEpisodeId).toBe(doc.episodes[0].id);
  });

  it("tracks / markers 是访问器，getter 返回当前分P 的真实数组", () => {
    const doc = attachEpisodeView(legacyDoc());
    const descriptor = Object.getOwnPropertyDescriptor(doc, "tracks");
    expect(typeof descriptor?.get).toBe("function");
    expect(doc.tracks).toBe(activeEpisode(doc).tracks);
  });

  it("写盘时剔除根级 tracks / markers，只保留 episodes", () => {
    const doc = attachEpisodeView(legacyDoc());
    const wire = JSON.parse(serializeProject(doc)) as Record<string, unknown>;
    expect(wire.tracks).toBeUndefined();
    expect(wire.markers).toBeUndefined();
    expect(Array.isArray(wire.episodes)).toBe(true);
  });

  it("被展开的文档仍然带 tracks（外部展开安全）", () => {
    const doc = attachEpisodeView(legacyDoc());
    const spread = { ...doc };
    expect(Array.isArray(spread.tracks)).toBe(true);
    expect(spread.tracks).toBe(doc.tracks);
  });

  it("展开后的新文档把 tracks 折回当前分P，且不改动旧文档", () => {
    const before = attachEpisodeView(legacyDoc());
    const replacement = [track("t2")];
    const after = attachEpisodeView({ ...before, tracks: replacement } as Project);
    expect(after.tracks).toBe(replacement);
    expect(activeEpisode(before).tracks.map((item) => item.id)).toEqual(["t1"]);
  });

  it("setter 整体替换当前分P 的轨道", () => {
    const doc = attachEpisodeView(legacyDoc());
    const next: Track[] = [];
    doc.tracks = next;
    expect(doc.tracks).toBe(next);
    expect(activeEpisode(doc).tracks).toBe(next);
  });

  it("对同一个文档重复 attach 返回原对象（幂等）", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(isEpisodeViewAttached(doc)).toBe(true);
    expect(attachEpisodeView(doc)).toBe(doc);
  });

  it("ops 的结果仍带 tracks 投影（withTouch 已折返）", () => {
    const doc = renameProject(newProject("改名前"), "改名后");
    expect(doc.name).toBe("改名后");
    expect(isEpisodeViewAttached(doc)).toBe(true);
    expect(Array.isArray(doc.tracks)).toBe(true);
  });
});

describe("switchActiveEpisode", () => {
  const second: Episode = {
    id: "e2",
    name: "分P 2",
    order: 1,
    tracks: [],
    markers: [],
    createdAt: 2,
    updatedAt: 2,
  };

  it("切分P 只换 activeEpisodeId，tracks 指向目标分P", () => {
    const base = attachEpisodeView(legacyDoc());
    const doc = attachEpisodeView({ ...base, episodes: [...base.episodes, second] } as Project);
    const switched = switchActiveEpisode(doc, "e2");
    expect(switched).not.toBeNull();
    expect(switched!.activeEpisodeId).toBe("e2");
    expect(switched!.tracks).toBe(switched!.episodes[1].tracks);
    // 切分P 不能把上一集的轨道灌进新分P：原分P 仍持有自己的 [t1]。
    expect(switched!.episodes[0].tracks.map((item) => item.id)).toEqual(["t1"]);
    expect(switched!.tracks).toHaveLength(0);
  });

  it("未知 id 或同一个 id 返回 null", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(switchActiveEpisode(doc, "nope")).toBeNull();
    expect(switchActiveEpisode(doc, doc.activeEpisodeId)).toBeNull();
  });
});

describe("newProject", () => {
  it("自带一个默认分P，且 tracks 已挂投影", () => {
    const doc = newProject("测试");
    expect(doc.version).toBe(2);
    expect(doc.episodes).toHaveLength(1);
    expect(doc.activeEpisodeId).toBe(doc.episodes[0].id);
    expect(doc.tracks).toHaveLength(0);
    expect(doc.episodes[0].name).toBe("分P 1");
  });
});
