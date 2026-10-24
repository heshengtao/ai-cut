import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  normalizePath,
  parseFilmManifest,
  relativeToManifest,
  resolveManifestPath,
} from "@/core/film/manifest";

const RAW = {
  version: 1,
  name: "137s 草稿",
  fps: 60,
  duration: 12,
  scenes: [
    {
      id: "s01",
      t0: 0,
      t1: 5,
      title: "开场",
      take: "renders/s01.mp4",
      markers: [2.5],
      review: [
        {
          t: 2.5,
          text: "翅膀穿模",
          severity: "high",
          bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          screenshot: "shots/s01-2.5.png",
        },
      ],
    },
    { id: "s02", t0: 5, t1: 12, take: "/abs/s02.mp4" },
  ],
  review: [{ t: 8, text: "整体节奏偏慢", severity: "low" }],
  music: { bpm: 120, key: "A minor", bars: 68 },
};

describe("parseFilmManifest", () => {
  it("normalizes scenes, resolves paths and keeps warnings empty", () => {
    const parsed = parseFilmManifest(RAW, "/tmp/film/film.json");
    expect(parsed.baseDir).toBe("/tmp/film");
    expect(parsed.manifest.scenes).toHaveLength(2);
    expect(parsed.takePaths.get("s01")).toBe("/tmp/film/renders/s01.mp4");
    expect(parsed.takePaths.get("s02")).toBe("/abs/s02.mp4");
    expect(parsed.manifest.scenes[0].review?.[0].screenshot).toBe(
      "/tmp/film/shots/s01-2.5.png",
    );
    expect(parsed.manifest.review?.[0].text).toBe("整体节奏偏慢");
    expect(parsed.manifest.music?.bpm).toBe(120);
    expect(parsed.warnings).toEqual([]);
  });

  it("sorts scenes and warns on overlaps", () => {
    const parsed = parseFilmManifest(
      {
        version: 1,
        scenes: [
          { id: "b", t0: 4, t1: 8 },
          { id: "a", t0: 0, t1: 5 },
        ],
      },
      "/tmp/film/film.json",
    );
    expect(parsed.manifest.scenes.map((scene) => scene.id)).toEqual(["a", "b"]);
    expect(parsed.warnings.join("")).toMatch(/重叠/);
  });

  it("rejects a wrong version and empty scenes", () => {
    expect(() => parseFilmManifest({ version: 2, scenes: [] }, "/tmp/f.json")).toThrow(
      /版本/,
    );
    expect(() => parseFilmManifest({ version: 1, scenes: [] }, "/tmp/f.json")).toThrow(
      /scenes/,
    );
  });

  it("drops duplicate ids and invalid review notes with warnings", () => {
    const parsed = parseFilmManifest(
      {
        version: 1,
        scenes: [
          { id: "a", t0: 0, t1: 2, review: [{ t: 1, text: "" }, { t: 1, text: "ok" }] },
          { id: "a", t0: 2, t1: 4 },
        ],
      },
      "/tmp/f.json",
    );
    expect(parsed.manifest.scenes).toHaveLength(1);
    expect(parsed.manifest.scenes[0].review).toHaveLength(1);
    expect(parsed.warnings.join("")).toMatch(/重复|text/);
  });
});

describe("docs example", () => {
  it("parses the checked-in example without warnings", () => {
    const path = fileURLToPath(
      new URL("../../../docs/film.example.json", import.meta.url),
    );
    const parsed = parseFilmManifest(JSON.parse(readFileSync(path, "utf8")), path);
    expect(parsed.manifest.scenes.length).toBeGreaterThan(0);
    expect(parsed.manifest.music?.bpm).toBe(120);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("manifest paths", () => {
  it("resolves relative paths and keeps absolute ones", () => {
    expect(resolveManifestPath("/tmp/film", "a/b.mp4")).toBe("/tmp/film/a/b.mp4");
    expect(resolveManifestPath("/tmp/film", "/x/a.mp4")).toBe("/x/a.mp4");
    expect(resolveManifestPath("/tmp/film", "../out/a.mp4")).toBe("/tmp/out/a.mp4");
  });

  it("normalizes separators and dot segments", () => {
    expect(normalizePath("/tmp//film/./a/../b.mp4")).toBe("/tmp/film/b.mp4");
    expect(relativeToManifest("/tmp/film", "/tmp/film/renders/s01.mp4")).toBe(
      "renders/s01.mp4",
    );
    expect(relativeToManifest("/tmp/film", "/other/s01.mp4")).toBe("../../other/s01.mp4");
  });
});
