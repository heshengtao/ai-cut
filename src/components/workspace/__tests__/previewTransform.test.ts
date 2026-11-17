/**
 * 预览舞台变换写回的回归测试。
 *
 * 关键用例：片段在**第二条轨道**上时也必须写进去。之前的实现遍历轨道时
 * 遇到第一条不含该片段的轨道就 `return doc`，导致只有第一条轨道上的片段
 * （通常是文字）能拖动 / 缩放，其余片段全部静默失败。
 */
import { describe, expect, it } from "vitest";
import { createClip, createTrack, newProject } from "@/core/factory";
import { patchClipTransform } from "@/components/workspace/previewTransform";
import type { Project } from "@/types/project";

function projectWithTwoTracks(): {
  doc: Project;
  textClipId: string;
  lowerClipId: string;
} {
  const doc = newProject();
  const textTrack = createTrack("轨道 1");
  const mediaTrack = createTrack("轨道 2");
  const textClip = createClip({
    assetId: "",
    trackId: textTrack.id,
    start: 0,
    duration: 5,
    text: "默认文本",
  });
  const mediaClip = createClip({
    assetId: "asset-video",
    trackId: mediaTrack.id,
    start: 0,
    duration: 5,
  });
  textTrack.clips = [textClip];
  mediaTrack.clips = [mediaClip];
  return {
    doc: { ...doc, tracks: [textTrack, mediaTrack] },
    textClipId: textClip.id,
    lowerClipId: mediaClip.id,
  };
}

function transformOf(doc: Project, clipId: string) {
  return doc.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)?.transform;
}

describe("patchClipTransform", () => {
  it("writes the transform for a clip on the first track", () => {
    const { doc, textClipId } = projectWithTwoTracks();
    const next = patchClipTransform(doc, textClipId, { x: 10, y: -5 }, 0);
    expect(next).not.toBe(doc);
    expect(transformOf(next, textClipId)).toMatchObject({ x: 10, y: -5 });
  });

  it("writes the transform for a clip on a lower track", () => {
    const { doc, lowerClipId } = projectWithTwoTracks();
    const next = patchClipTransform(doc, lowerClipId, { x: 8.5, y: 9.1 }, 0);
    expect(next).not.toBe(doc);
    expect(transformOf(next, lowerClipId)).toMatchObject({ x: 8.5, y: 9.1, scale: 1 });
  });

  it("keeps scale when only the position changes", () => {
    const { doc, lowerClipId } = projectWithTwoTracks();
    const scaled = patchClipTransform(doc, lowerClipId, { scale: 1.4 }, 0);
    const moved = patchClipTransform(scaled, lowerClipId, { x: 4, y: 6 }, 0);
    expect(transformOf(moved, lowerClipId)).toMatchObject({ x: 4, y: 6, scale: 1.4 });
  });

  it("writes a keyframe when the clip is animated", () => {
    const { doc, lowerClipId } = projectWithTwoTracks();
    const withKeyframes: Project = {
      ...doc,
      tracks: doc.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === lowerClipId
            ? {
                ...clip,
                keyframes: [
                  { time: 0, x: 0, y: 0, scale: 1, rotation: 0 },
                  { time: 5, x: 20, y: 0, scale: 1, rotation: 0 },
                ],
              }
            : clip,
        ),
      })),
    };
    const next = patchClipTransform(withKeyframes, lowerClipId, { y: 30 }, 2);
    const clip = next.tracks.flatMap((track) => track.clips).find((c) => c.id === lowerClipId);
    expect(clip?.keyframes?.some((frame) => Math.abs(frame.time - 2) < 1e-6)).toBe(true);
    expect(clip?.keyframes?.find((frame) => Math.abs(frame.time - 2) < 1e-6)?.y).toBe(30);
  });

  it("returns the same document for an unknown clip", () => {
    const { doc } = projectWithTwoTracks();
    expect(patchClipTransform(doc, "nope", { x: 5 }, 0)).toBe(doc);
  });
});
