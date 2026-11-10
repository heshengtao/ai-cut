import { describe, expect, it } from "vitest";
import { placeConvertedVoice } from "@/core/voiceEdit";
import { createClip, createTrack, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

function projectWithClip() {
  let doc = newProject();
  doc = { ...doc, tracks: [] };
  doc = addTrack(doc, "对白");
  const track = doc.tracks[0];
  doc = addClip(
    doc,
    track.id,
    createClip({ assetId: "a-video", trackId: track.id, start: 2, duration: 5 }),
  );
  return { doc, trackId: track.id, clip: doc.tracks[0].clips[0] };
}

describe("placeConvertedVoice", () => {
  it("mutes the original and adds the result on a new track", () => {
    const { doc, clip } = projectWithClip();
    const next = placeConvertedVoice(
      doc,
      [{ clipId: clip.id, assetId: "a-voice", duration: 5 }],
      "AI 变声",
    );
    expect(next.tracks[0].clips[0].muted).toBe(true);
    const lane = next.tracks.find((track) => track.name === "AI 变声");
    expect(lane).toBeTruthy();
    expect(lane!.clips[0]).toMatchObject({ assetId: "a-voice", start: 2, duration: 5 });
  });

  it("keeps overlapping results on separate lanes", () => {
    const { doc, trackId, clip } = projectWithClip();
    const second = createClip({ assetId: "a-video-2", trackId, start: 3, duration: 2 });
    const withSecond = addClip(doc, trackId, second);
    const next = placeConvertedVoice(
      withSecond,
      [
        { clipId: clip.id, assetId: "a-voice", duration: 5 },
        { clipId: second.id, assetId: "a-voice-2", duration: 2 },
      ],
      "AI 变声",
    );
    const names = next.tracks
      .map((track) => track.name)
      .filter((name) => name.startsWith("AI 变声"));
    expect(names.length).toBe(2);
  });

  it("clamps the result to the original duration", () => {
    const { doc, clip } = projectWithClip();
    const next = placeConvertedVoice(
      doc,
      [{ clipId: clip.id, assetId: "a-voice", duration: 99 }],
      "AI 变声",
    );
    const lane = next.tracks.find((track) => track.name === "AI 变声")!;
    expect(lane.clips[0].duration).toBe(5);
  });
});
