import { describe, expect, it } from "vitest";
import type { Project } from "@/types/project";
import { applyCommandsToDoc } from "@/core/commands";
import {
  createAsset,
  createClip,
  createMarker,
  createTrack,
  newProject,
} from "@/core/factory";
import { addClip, addMarker, addTrack } from "@/core/ops";
import { parseFilmManifest } from "@/core/film/manifest";
import type { ManifestAsset } from "@/core/film/import";
import { buildManifestCommands, FILM_TAG } from "@/core/film/import";
import { projectToManifest } from "@/core/film/export";

const MANIFEST = {
  version: 1,
  fps: 30,
  scenes: [
    {
      id: "s01",
      t0: 0,
      t1: 4,
      title: "开场",
      take: "renders/s01.mp4",
      markers: [2],
      review: [{ t: 2.5, text: "翅膀穿模", severity: "high" }],
    },
    { id: "s02", t0: 4, t1: 8, title: "结尾", take: "renders/s02.mp4" },
  ],
  review: [{ t: 7, text: "整体节奏偏慢", severity: "low" }],
};

const ASSETS: ManifestAsset[] = [
  {
    path: "/tmp/film/renders/s01.mp4",
    kind: "video",
    duration: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
  },
  {
    path: "/tmp/film/renders/s02.mp4",
    kind: "video",
    duration: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
  },
];

function options(overrides: Partial<Parameters<typeof buildManifestCommands>[2]> = {}) {
  return {
    mode: "replace" as const,
    trackName: "Scenes",
    assets: ASSETS,
    baseRevision: 0,
    actor: "agent" as const,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildManifestCommands", () => {
  it("creates assets, a scene track, clips and structured markers", () => {
    const parsed = parseFilmManifest(MANIFEST, "/tmp/film/film.json");
    const { commands, summary } = buildManifestCommands(newProject("demo"), parsed, options());

    expect(summary.assetsAdded).toBe(2);
    expect(summary.clipsAdded).toBe(2);
    expect(summary.markersAdded).toBe(5); // 2 scene + 1 hit + 2 review
    expect(commands.map((command) => command.kind)).toEqual(
      expect.arrayContaining(["asset.add", "track.add", "clip.add", "marker.add"]),
    );

    const result = applyCommandsToDoc(newProject("demo"), commands);
    expect(result.doc.tracks.find((track) => track.name === "Scenes")).toBeTruthy();
    const clips = result.doc.tracks.flatMap((track) => track.clips);
    expect(clips.map((clip) => clip.sceneId)).toEqual(["s01", "s02"]);
    const review = result.doc.markers.find((marker) => marker.note === "翅膀穿模");
    expect(review).toMatchObject({
      kind: "review",
      sceneId: "s01",
      severity: "high",
      note: "翅膀穿模",
    });
    expect(result.doc.markers.filter((marker) => marker.tags?.includes(FILM_TAG))).toHaveLength(5);
  });

  it("is idempotent when re-imported against the resulting document", () => {
    const parsed = parseFilmManifest(MANIFEST, "/tmp/film/film.json");
    const first = buildManifestCommands(newProject("demo"), parsed, options());
    const imported = applyCommandsToDoc(newProject("demo"), first.commands).doc;

    const second = buildManifestCommands(imported, parsed, options());
    expect(second.commands).toHaveLength(0);
    expect(second.summary.clipsAdded).toBe(0);
    expect(second.summary.markersAdded).toBe(0);
    expect(second.summary.assetsAdded).toBe(0);
  });

  it("replace removes stale imported clips and markers, merge keeps them", () => {
    const track = createTrack("Scenes");
    const asset = createAsset({
      id: "old-asset",
      name: "old.mp4",
      kind: "video",
      src: "/tmp/film/renders/old.mp4",
      duration: 4,
    });
    const clip = {
      ...createClip({
        assetId: asset.id,
        trackId: track.id,
        start: 20,
        duration: 2,
      }),
      sceneId: "old",
    };
    const marker = {
      ...createMarker({ time: 20, name: "old" }),
      kind: "scene" as const,
      sceneId: "old",
      tags: [FILM_TAG],
    };
    let doc: Project = { ...newProject("demo"), tracks: [track], assets: [asset] };
    doc = addClip(doc, track.id, clip);
    doc = addMarker(doc, marker);

    const parsed = parseFilmManifest(MANIFEST, "/tmp/film/film.json");
    const replace = buildManifestCommands(doc, parsed, options({ mode: "replace" }));
    expect(replace.summary.clipsRemoved).toBe(1);
    expect(replace.summary.markersRemoved).toBe(1);
    expect(replace.commands.map((command) => command.kind)).toEqual(
      expect.arrayContaining(["clip.remove", "marker.remove"]),
    );

    const merge = buildManifestCommands(doc, parsed, options({ mode: "merge" }));
    expect(merge.summary.clipsRemoved).toBe(0);
    expect(merge.summary.markersRemoved).toBe(0);
  });

  it("exports scenes/review and preserves music from the previous file", () => {
    const parsed = parseFilmManifest(MANIFEST, "/tmp/film/film.json");
    const first = buildManifestCommands(newProject("demo"), parsed, options());
    const imported = applyCommandsToDoc(newProject("demo"), first.commands).doc;

    const exported = projectToManifest(imported, {
      baseDir: "/tmp/film",
      previous: { music: { bpm: 120, key: "A minor" } },
    });
    const scenes = exported.scenes as Array<{
      id: string;
      take?: string;
      review?: Array<{ text: string }>;
    }>;
    expect(scenes.map((scene) => scene.id)).toEqual(["s01", "s02"]);
    expect(scenes[0].take).toBe("renders/s01.mp4");
    expect(scenes[0].review?.[0].text).toContain("翅膀");
    expect(exported.music).toEqual({ bpm: 120, key: "A minor" });
    expect((exported.review as Array<{ text: string }>)[0].text).toContain("节奏");
  });

  it("conform rewrites fps and dimensions in the same batch", () => {
    const parsed = parseFilmManifest(
      { ...MANIFEST, fps: 60, width: 1280, height: 720 },
      "/tmp/film/film.json",
    );
    const { commands } = buildManifestCommands(
      newProject("demo"),
      parsed,
      options({ conform: true }),
    );
    expect(commands[0].kind).toBe("project.output");
    expect(commands[0].payload).toEqual({ fps: 60, width: 1280, height: 720 });

    const result = applyCommandsToDoc(newProject("demo"), commands);
    expect(result.doc.fps).toBe(60);
    expect(result.doc.width).toBe(1280);
    expect(result.doc.height).toBe(720);
  });

  it("clamps a take shorter than the scene and warns", () => {
    const parsed = parseFilmManifest(
      {
        version: 1,
        scenes: [{ id: "s01", t0: 0, t1: 10, take: "renders/s01.mp4" }],
      },
      "/tmp/film/film.json",
    );
    const { commands, summary } = buildManifestCommands(
      newProject("demo"),
      parsed,
      options({
        assets: [
          {
            path: "/tmp/film/renders/s01.mp4",
            kind: "video",
            duration: 4,
            hasAudio: true,
          },
        ],
      }),
    );
    const add = commands.find((command) => command.kind === "clip.add");
    expect((add?.payload as { clip: { duration: number } }).clip.duration).toBe(4);
    expect(summary.warnings.join("")).toMatch(/截断/);
  });
});
