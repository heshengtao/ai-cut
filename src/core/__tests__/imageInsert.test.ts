import { describe, expect, it } from "vitest";
import { insertGeneratedImage, GENERATED_IMAGE_SECONDS } from "@/core/imageInsert";
import { createAsset, createTrack, newProject } from "@/core/factory";

describe("insertGeneratedImage", () => {
  const asset = createAsset({
    name: "gen.png",
    kind: "image",
    src: "D:/cache/gen.png",
    duration: 0,
    width: 1024,
    height: 1024,
  });

  it("creates a new topmost track and puts the image at the playhead", () => {
    const project = newProject("demo");
    project.fps = 30;
    project.tracks = [createTrack("底层"), createTrack("字幕")];

    const next = insertGeneratedImage(project, asset, 3.02, "AI 画图");

    expect(next.tracks).toHaveLength(3);
    expect(next.tracks[0].name).toBe("AI 画图");
    expect(next.tracks.slice(1).map((track) => track.name)).toEqual(["底层", "字幕"]);
    const clip = next.tracks[0].clips[0];
    expect(clip.assetId).toBe(asset.id);
    // 3.02s 吸附到 30fps 的最近帧边界（91 帧 = 3.0333s）。
    expect(clip.start).toBeCloseTo(91 / 30, 5);
    expect(clip.duration).toBe(GENERATED_IMAGE_SECONDS);
    expect(next.assets.some((item) => item.id === asset.id)).toBe(true);
  });

  it("does not mutate the previous document", () => {
    const project = newProject("demo");
    project.tracks = [createTrack("底层")];
    const next = insertGeneratedImage(project, asset, 0, "AI 改图");
    expect(project.tracks).toHaveLength(1);
    expect(project.assets).toHaveLength(0);
    expect(next.tracks).toHaveLength(2);
  });

  it("keeps every generation on its own track", () => {
    let project = newProject("demo");
    project.tracks = [createTrack("底层")];
    project = insertGeneratedImage(project, asset, 0, "AI 画图");
    project = insertGeneratedImage(project, asset, 0, "AI 画图");
    expect(project.tracks.map((track) => track.name)).toEqual([
      "AI 画图",
      "AI 画图",
      "底层",
    ]);
    // 同一个素材重复引用时只入库一份。
    expect(project.assets.filter((item) => item.id === asset.id)).toHaveLength(1);
  });
});
