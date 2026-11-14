import { describe, expect, it } from "vitest";
import { mergeRemoteProject } from "@/core/sessionMerge";
import type { Affected } from "@/types/events";
import type { Project, Track } from "@/types/project";

function track(id: string, clipId: string, name = id): Track {
  return {
    id,
    name,
    muted: false,
    locked: false,
    visible: true,
    clips: [
      {
        id: clipId,
        assetId: "a1",
        start: 0,
        duration: 2,
        inPoint: 0,
        speed: 1,
      } as never,
    ],
  } as Track;
}

const base = {
  version: 1,
  name: "local",
  createdAt: 1,
  updatedAt: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  assets: [],
  tracks: [track("t1", "c1"), track("t2", "c2")],
  markers: [],
} as Project;

describe("mergeRemoteProject", () => {
  it("只替换受影响的轨道，保留另一条本地轨道", () => {
    const local: Project = {
      ...base,
      tracks: [
        { ...track("t1", "c1"), name: "local-t1" },
        { ...track("t2", "c2"), name: "local-t2" },
      ],
    };
    const incoming: Project = {
      ...base,
      name: "remote",
      tracks: [
        { ...track("t1", "c1"), name: "remote-t1" },
        { ...track("t2", "c2"), name: "remote-t2" },
      ],
    };
    const affected: Affected = { clipIds: ["c1"], trackIds: [], assetIds: [] };
    const merged = mergeRemoteProject(local, incoming, affected, false);
    expect(merged.name).toBe("remote");
    expect(merged.tracks[0]?.name).toBe("remote-t1");
    expect(merged.tracks[1]?.name).toBe("local-t2");
  });

  it("full 或没有 affected 时整份替换", () => {
    const incoming = { ...base, name: "remote" };
    expect(mergeRemoteProject(base, incoming, null, false)).toBe(incoming);
    expect(mergeRemoteProject(base, incoming, null, true)).toBe(incoming);
  });
});
