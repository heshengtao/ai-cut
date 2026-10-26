import { describe, expect, it } from "vitest";
import { createAsset, createClip, createTrack, newProject } from "@/core/factory";
import type { ExportOptions } from "@/types/export";
import type { Project } from "@/types/project";
import { buildExportPlan } from "@/core/export/plan";

const MP4: ExportOptions = {
  format: "mp4",
  resolution: "project",
  width: null,
  height: null,
  fps: null,
  quality: "standard",
  fit: "contain",
  fitAnchor: "center",
  gifColors: 256,
  gifDither: "sierra2_4a",
  gifLoop: 0,
};

function project(): { doc: Project; clipId: string } {
  const doc = newProject();
  doc.assets.push(
    createAsset({
      id: "a",
      name: "a.mp4",
      kind: "video",
      src: "/media/a.mp4",
      duration: 10,
      hasAudio: false,
    }),
  );
  const track = createTrack("V1");
  const clip = createClip({
    assetId: "a",
    trackId: track.id,
    start: 0,
    duration: 4,
  });
  track.clips.push(clip);
  doc.tracks.push(track);
  return { doc, clipId: clip.id };
}

describe("buildExportPlan — OFX transition overlays", () => {
  it("adds the baked transition as an opaque full-frame overlay", () => {
    const { doc, clipId } = project();
    const plan = buildExportPlan(
      doc,
      MP4,
      new Map(),
      "/tmp/out.mp4",
      new Map(),
      undefined,
      new Map([
        [`${clipId}:in`, { path: "/cache/transition.mov", start: 1, duration: 1 }],
      ]),
    );
    expect(plan.inputs).toContain("/cache/transition.mov");
    expect(plan.filterGraph).toContain("format=yuva420p,setsar=1");
    expect(plan.filterGraph).toContain("enable='between(t,1,2)'");
  });

  it("clips the overlay to an export window", () => {
    const { doc, clipId } = project();
    const plan = buildExportPlan(
      doc,
      MP4,
      new Map(),
      "/tmp/out.mp4",
      new Map(),
      { start: 0.5, end: 3 },
      new Map([
        [`${clipId}:in`, { path: "/cache/transition.mov", start: 1, duration: 1 }],
      ]),
    );
    expect(plan.filterGraph).toContain("enable='between(t,0.5,1.5)'");
  });
});
