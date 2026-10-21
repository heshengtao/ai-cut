import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import { replaceClipVideo } from "@/core/videoEdit";

function withClip(duration = 5, inPoint = 2) {
  const base = addTrack(newProject());
  const track = base.tracks[0].id;
  const clip = createClip({
    assetId: "source",
    trackId: track,
    start: 10,
    duration,
    in: inPoint,
  });
  return { doc: addClip(base, track, clip), id: clip.id };
}

describe("replaceClipVideo", () => {
  it("swaps the asset, resets the in point and keeps the start", () => {
    const { doc, id } = withClip();
    const next = replaceClipVideo(doc, id, "processed", 4.5, 5);
    const clip = next.tracks[0].clips.find((item) => item.id === id)!;
    expect(clip.assetId).toBe("processed");
    expect(clip.in).toBe(0);
    expect(clip.duration).toBe(4.5);
    expect(clip.start).toBe(10);
  });

  it("keeps the clip duration when the processed asset is longer", () => {
    const { doc, id } = withClip();
    const next = replaceClipVideo(doc, id, "processed", 8, 5);
    const clip = next.tracks[0].clips.find((item) => item.id === id)!;
    expect(clip.duration).toBe(5);
  });

  it("is a no-op for an unknown clip", () => {
    const { doc } = withClip();
    expect(replaceClipVideo(doc, "missing", "processed", 4, 5)).toBe(doc);
  });
});
