import { describe, expect, it } from "vitest";
import {
  addStemTracks,
  applyProcessedAudio,
  extractClipAudio,
  loudnessGain,
  replaceClipAudio,
} from "@/core/audioEdit";
import { createClip, createTrack, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

describe("loudnessGain", () => {
  it("moves the integrated loudness to the target", () => {
    expect(loudnessGain({ integrated_lufs: -20, true_peak_dbtp: -10 }, -14)).toBe(6);
  });

  it("caps the gain so true peak stays under the ceiling", () => {
    // LUFS 想要 +6 dB，但峰值只允许 +2 dB（-3 → -1）。
    expect(loudnessGain({ integrated_lufs: -20, true_peak_dbtp: -3 }, -14)).toBe(2);
  });

  it("clamps to the clip.gain range", () => {
    expect(loudnessGain({ integrated_lufs: -80, true_peak_dbtp: -80 }, -14)).toBe(12);
    expect(loudnessGain({ integrated_lufs: 0, true_peak_dbtp: 0 }, -14)).toBe(-14);
  });

  it("returns null for silence", () => {
    expect(loudnessGain({ integrated_lufs: null, true_peak_dbtp: null }, -14)).toBeNull();
  });
});

describe("replaceClipAudio", () => {
  it("swaps the asset and resets the in-point", () => {
    let doc = newProject();
    const track = createTrack("A");
    doc = { ...doc, tracks: [track] };
    const clip = createClip({
      assetId: "old",
      trackId: track.id,
      start: 3,
      duration: 5,
      in: 2,
    });
    doc = addClip(doc, track.id, clip);

    const next = replaceClipAudio(doc, clip.id, "new", 4.5, 5);
    const updated = next.tracks[0].clips[0];
    expect(updated.assetId).toBe("new");
    expect(updated.in).toBe(0);
    expect(updated.duration).toBe(4.5);
    expect(updated.start).toBe(3);
  });

  it("keeps the clip length when the processed asset has no duration yet", () => {
    let doc = newProject();
    const track = createTrack("A");
    doc = { ...doc, tracks: [track] };
    const clip = createClip({ assetId: "old", trackId: track.id, start: 0, duration: 5 });
    doc = addClip(doc, track.id, clip);

    const next = replaceClipAudio(doc, clip.id, "new", 0, 5);
    expect(next.tracks[0].clips[0].duration).toBe(5);
  });
});

describe("applyProcessedAudio", () => {
  it("replaces the asset in place for an audio clip", () => {
    let doc = newProject();
    const track = createTrack("A");
    doc = { ...doc, tracks: [track] };
    const clip = createClip({ assetId: "old", trackId: track.id, start: 2, duration: 5 });
    doc = addClip(doc, track.id, clip);

    const next = applyProcessedAudio(doc, clip, "clean", 5, "audio", "降噪");
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].clips[0]).toMatchObject({
      assetId: "clean",
      start: 2,
      duration: 5,
      in: 0,
    });
  });

  it("keeps the video clip and puts the processed audio on a new track", () => {
    let doc = newProject();
    doc = addTrack(doc, "画面");
    const sourceId = doc.tracks[0].id;
    const clip = createClip({
      assetId: "video",
      trackId: sourceId,
      start: 7,
      duration: 6,
      in: 3,
    });
    doc = addClip(doc, sourceId, clip);

    const next = applyProcessedAudio(doc, clip, "clean", 6, "video", "AI 降噪");
    const video = next.tracks[0].clips[0];
    expect(video.assetId).toBe("video");
    expect(video.muted).toBe(true);
    expect(video.start).toBe(7);
    expect(next.tracks[1].name).toBe("AI 降噪");
    expect(next.tracks[1].clips[0]).toMatchObject({
      assetId: "clean",
      start: 7,
      duration: 6,
      in: 0,
    });
  });
});

describe("extractClipAudio", () => {
  it("mutes the video clip and puts its audio on a new track below", () => {
    let doc = newProject();
    doc = addTrack(doc, "画面");
    const sourceId = doc.tracks[0].id;
    const clip = createClip({
      assetId: "video",
      trackId: sourceId,
      start: 5,
      duration: 4,
      in: 2,
    });
    doc = addClip(doc, sourceId, clip);

    const result = extractClipAudio(doc, clip, "分离音频");

    expect(result.doc.tracks[0].clips[0]).toMatchObject({
      assetId: "video",
      muted: true,
      start: 5,
      duration: 4,
      in: 2,
    });
    expect(result.doc.tracks).toHaveLength(2);
    expect(result.doc.tracks[1].name).toBe("分离音频");
    expect(result.doc.tracks[1].clips[0]).toMatchObject({
      id: result.clipId,
      assetId: "video",
      start: 5,
      duration: 4,
      in: 2,
    });
  });

  it("does nothing for an empty or zero-length clip", () => {
    const doc = newProject();
    const clip = createClip({ assetId: "", trackId: "none", start: 0, duration: 0 });
    const result = extractClipAudio(doc, clip, "分离音频");
    expect(result.doc).toBe(doc);
    expect(result.clipId).toBeNull();
  });
});

describe("addStemTracks", () => {
  it("inserts stems below the source, aligns them, and mutes the source", () => {
    let doc = newProject();
    doc = addTrack(doc, "原片");
    const sourceId = doc.tracks[0].id;
    const clip = createClip({
      assetId: "mix",
      trackId: sourceId,
      start: 12,
      duration: 8,
      in: 4,
    });
    doc = addClip(doc, sourceId, clip);

    const next = addStemTracks(
      doc,
      clip,
      [
        { label: "人声", assetId: "vocals", duration: 8 },
        { label: "鼓", assetId: "drums", duration: 7.5 },
      ],
      "分轨",
      true,
    );

    expect(next.tracks[0].clips[0].muted).toBe(true);
    expect(next.tracks[0].muted).toBe(false);
    expect(next.tracks).toHaveLength(3);
    expect(next.tracks[1].name).toBe("分轨 · 人声");
    expect(next.tracks[2].name).toBe("分轨 · 鼓");
    expect(next.tracks[1].clips[0]).toMatchObject({
      assetId: "vocals",
      start: 12,
      duration: 8,
      in: 0,
    });
    expect(next.tracks[2].clips[0]).toMatchObject({
      assetId: "drums",
      start: 12,
      duration: 7.5,
      in: 0,
    });
  });

  it("leaves the source track audible when muteSource is false", () => {
    let doc = newProject();
    doc = addTrack(doc, "原片");
    const sourceId = doc.tracks[0].id;
    const clip = createClip({
      assetId: "mix",
      trackId: sourceId,
      start: 0,
      duration: 4,
    });
    doc = addClip(doc, sourceId, clip);

    const next = addStemTracks(
      doc,
      clip,
      [{ label: "人声", assetId: "vocals", duration: 4 }],
      "分轨",
      false,
    );

    expect(next.tracks[0].clips[0].muted).toBeUndefined();
    expect(next.tracks[1].name).toBe("分轨 · 人声");
  });
});
