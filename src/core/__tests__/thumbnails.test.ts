import { describe, expect, it, vi } from "vitest";
import { createAsset } from "@/core/factory";
import type { AssetKind } from "@/types/project";

const state = vi.hoisted(() => ({
  calls: [] as { path: string; id: string; at: number }[],
}));

vi.mock("@/core/media", () => ({
  makeThumbnail: async (path: string, id: string, at: number) => {
    state.calls.push({ path, id, at });
    if (path.includes("broken")) throw new Error("ffmpeg failed");
    return `${id}.png`;
  },
  cacheFilePath: async (name: string) => `/cache/${name}`,
}));

import { cachedThumbnail, ensureThumbnail, needsThumbnail } from "@/core/thumbnails";

function asset(kind: AssetKind, overrides: Partial<Parameters<typeof createAsset>[0]> = {}) {
  return createAsset({
    name: "a.mp4",
    kind,
    src: "/media/a.mp4",
    duration: 10,
    ...overrides,
  });
}

describe("needsThumbnail", () => {
  it("only asks for videos that have no cached thumbnail", () => {
    expect(needsThumbnail(asset("video"))).toBe(true);
    expect(needsThumbnail(asset("image"))).toBe(false);
    expect(needsThumbnail(asset("audio"))).toBe(false);
    expect(needsThumbnail(asset("video", { thumb: "/cache/x.png" }))).toBe(false);
    expect(needsThumbnail(asset("video", { offline: true }))).toBe(false);
  });
});

describe("ensureThumbnail", () => {
  it("generates once and applies the cache path", async () => {
    const video = asset("video", { id: "video-once" });
    const applied: string[] = [];

    await ensureThumbnail(video, (thumb) => applied.push(thumb));
    await ensureThumbnail(video, (thumb) => applied.push(thumb));

    // 第二次走会话缓存：不再跑 ffmpeg，但仍把路径交给文档。
    expect(applied).toEqual(["/cache/video-once.png", "/cache/video-once.png"]);
    expect(state.calls).toEqual([{ path: "/media/a.mp4", id: "video-once", at: 1 }]);
    expect(cachedThumbnail("video-once")).toBe("/cache/video-once.png");
  });

  it("samples at half the duration for short clips", async () => {
    await ensureThumbnail(asset("video", { id: "video-short", duration: 1 }), () => undefined);
    expect(state.calls.find((call) => call.id === "video-short")?.at).toBe(0.5);
  });

  it("re-applies the session cache when the document lost the thumb", async () => {
    await ensureThumbnail(asset("video", { id: "video-restored" }), () => undefined);
    const applied: string[] = [];

    // 撤销 / 重新打开工程后拿到的是没有 thumb 的旧对象。
    await ensureThumbnail(asset("video", { id: "video-restored" }), (thumb) => applied.push(thumb));

    expect(applied).toEqual(["/cache/video-restored.png"]);
    expect(state.calls.filter((call) => call.id === "video-restored")).toHaveLength(1);
  });

  it("does not hammer ffmpeg for a source that failed", async () => {
    const broken = asset("video", { id: "video-broken", src: "/media/broken.mp4" });
    const applied: string[] = [];

    await ensureThumbnail(broken, (thumb) => applied.push(thumb));
    await ensureThumbnail(broken, (thumb) => applied.push(thumb));

    expect(applied).toEqual([]);
    expect(state.calls.filter((call) => call.id === "video-broken")).toHaveLength(1);
  });
});
