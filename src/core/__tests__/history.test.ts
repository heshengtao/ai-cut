import { describe, expect, it } from "vitest";
import { groupProjectHistory } from "@/core/history";
import type { ProjectHistoryEntry } from "@/types/project";

function entry(
  id: string,
  savedAt: number,
  patch: Partial<ProjectHistoryEntry> = {},
): ProjectHistoryEntry {
  return {
    id,
    name: "demo",
    saved_at: savedAt,
    path: null,
    dirty: false,
    duration: 10,
    thumbnail: null,
    track_count: 1,
    clip_count: 2,
    ...patch,
  };
}

describe("groupProjectHistory", () => {
  it("keeps one card for repeated snapshots of the same file", () => {
    const groups = groupProjectHistory([
      entry("1", 100, { path: "/movies/demo.aicut" }),
      entry("2", 300, { path: "/movies/demo.aicut" }),
      entry("3", 200, { path: "/movies/demo.aicut" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.versions.map((item) => item.id)).toEqual(["2", "3", "1"]);
  });

  it("groups unsaved versions by the project creation time", () => {
    const groups = groupProjectHistory([
      entry("1", 100, { project_created_at: 42 }),
      entry("2", 200, { project_created_at: 42 }),
      entry("3", 150, { project_created_at: 99 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.versions).toHaveLength(2);
    expect(groups[0]?.versions[0]?.id).toBe("2");
  });

  it("does not merge different paths or legacy entries without identity", () => {
    const groups = groupProjectHistory([
      entry("1", 100, { path: "/movies/a.aicut" }),
      entry("2", 200, { path: "/movies/b.aicut" }),
      entry("3", 300),
      entry("4", 400),
    ]);

    expect(groups).toHaveLength(4);
  });

  it("compares Windows separators without creating a second card", () => {
    const groups = groupProjectHistory([
      entry("1", 100, { path: "C:\\movies\\demo.aicut" }),
      entry("2", 200, { path: "C:/movies/demo.aicut" }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it("orders cards by their newest version", () => {
    const groups = groupProjectHistory([
      entry("1", 100, { path: "/movies/a.aicut" }),
      entry("2", 300, { path: "/movies/b.aicut" }),
      entry("3", 200, { path: "/movies/a.aicut" }),
    ]);

    expect(groups.map((group) => group.name)).toHaveLength(2);
    expect(groups[0]?.versions[0]?.id).toBe("2");
  });
});
