import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset, addClip, addTrack } from "@/core/ops";

vi.mock("@/core/export/api", () => ({
  startExport: vi.fn(async () => undefined),
  writeExportTextImage: vi.fn(async (name: string) => `/tmp/${name}.png`),
}));

vi.mock("@/core/export/textLayer", () => ({
  renderTextLayerPng: vi.fn(() => "data:image/png;base64,AAAA"),
  dataUrlToBase64: vi.fn(() => "AAAA"),
  textLayerName: vi.fn((id: string) => `text-${id}`),
}));

import { startExport } from "@/core/export/api";
import { renderFrame } from "@/core/export/frame";

function fixture() {
  const track = addTrack(newProject("frame"));
  const trackId = track.tracks[0].id;
  const asset = createAsset({
    id: "a1",
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 10,
  });
  const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 4, in: 1 });
  let doc = addAsset(track, asset);
  doc = addClip(doc, trackId, clip);
  return doc;
}

describe("renderFrame", () => {
  beforeEach(() => {
    vi.mocked(startExport).mockClear();
  });

  it("builds a one-frame PNG job at the requested time", async () => {
    const doc = fixture();
    const result = await renderFrame(doc, { time: 2, outputPath: "/tmp/frame.png" });

    expect(result).toMatchObject({ path: "/tmp/frame.png", time: 2, width: 1920, height: 1080 });
    const job = vi.mocked(startExport).mock.calls[0][0];
    expect(job.outputArgs).toContain("-frames:v");
    expect(job.outputArgs).toContain("1");
    expect(job.outputArgs).toContain("-update");
    expect(job.outputArgs).toContain("-ss");
    expect(job.outputArgs).toContain("2");
    expect(job.outputArgs[job.outputArgs.length - 1]).toBe("/tmp/frame.png");
    expect(job.filterGraph).toContain("overlay");
  });

  it("renders a custom-size cover frame", async () => {
    const doc = fixture();
    const result = await renderFrame(doc, {
      time: 1,
      outputPath: "/tmp/cover.png",
      width: 240,
      height: 240,
      fit: "cover",
    });

    expect(result).toMatchObject({ width: 240, height: 240 });
    const job = vi.mocked(startExport).mock.calls[0][0];
    expect(job.filterGraph).toContain("scale=240:240:force_original_aspect_ratio=increase");
    expect(job.filterGraph).toContain("crop=240:240");
    expect(job.filterGraph).not.toContain("pad=240:240");
  });

  it("clamps a frame exactly at the timeline end", async () => {
    const doc = fixture();
    const result = await renderFrame(doc, { time: 4, outputPath: "/tmp/end.png" });
    expect(result.time).toBeLessThan(4);
    expect(result.time).toBeGreaterThanOrEqual(0);
  });

  it("rejects times outside the timeline", async () => {
    const doc = fixture();
    await expect(
      renderFrame(doc, { time: -1, outputPath: "/tmp/x.png" }),
    ).rejects.toThrow();
    await expect(
      renderFrame(doc, { time: 99, outputPath: "/tmp/x.png" }),
    ).rejects.toThrow();
  });
});
