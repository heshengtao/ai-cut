import { describe, expect, it } from "vitest";
import type { ClipEffect, Project } from "@/types/project";
import { createAsset, createClip, createTrack, newProject } from "@/core/factory";
import { normalizeClipTransition } from "@/core/clipTransition";
import { parseProject, serializeProject } from "@/core/serialize";
import {
  activeOfxTransition,
  ofxTransitionRange,
  transitionProgress,
  transitionSourceTime,
} from "@/core/ofxTransition";

const EFFECT: ClipEffect = {
  id: "fx-transition",
  plugin: "com.example.dissolve",
  name: "Dissolve",
  bundle: "/tmp/dissolve.ofx.bundle",
  context: "OfxImageEffectContextTransition",
  params: {},
  enabled: true,
};

function build(): { project: Project; trackId: string; a: string; b: string } {
  const project = newProject();
  project.assets.push(
    createAsset({
      id: "asset",
      name: "a.mp4",
      kind: "video",
      src: "/tmp/a.mp4",
      duration: 10,
      hasAudio: false,
    }),
  );
  const track = createTrack("V1");
  const a = createClip({ assetId: "asset", trackId: track.id, start: 0, duration: 2 });
  const b = createClip({ assetId: "asset", trackId: track.id, start: 2, duration: 2 });
  b.transitionIn = {
    type: "ofx",
    duration: 1,
    effect: EFFECT,
  };
  track.clips.push(a, b);
  project.tracks.push(track);
  return { project, trackId: track.id, a: a.id, b: b.id };
}

describe("OFX transition range", () => {
  it("centres the transition on the cut and resolves both sides", () => {
    const { project, trackId, b } = build();
    const clip = project.tracks[0]!.clips.find((item) => item.id === b)!;
    const range = ofxTransitionRange(project, trackId, clip, "in")!;
    expect(range.start).toBeCloseTo(1.5);
    expect(range.end).toBeCloseTo(2.5);
    expect(range.cut).toBeCloseTo(2);
    expect(range.from?.clip.start).toBe(0);
    expect(range.to?.clip.id).toBe(b);
    expect(transitionProgress(range, 2)).toBeCloseTo(0.5);
    expect(transitionProgress(range, 1.5)).toBe(0);
    expect(transitionProgress(range, 2.5)).toBe(1);
  });

  it("finds the active transition only inside its range", () => {
    const { project } = build();
    expect(activeOfxTransition(project, 1.4)).toBeNull();
    expect(activeOfxTransition(project, 2)?.clipId).toBe(
      project.tracks[0]!.clips[1]!.id,
    );
    expect(activeOfxTransition(project, 2.6)).toBeNull();
  });

  it("clamps handle frames to the material and honours speed", () => {
    const { project, trackId, b } = build();
    const clip = project.tracks[0]!.clips.find((item) => item.id === b)!;
    const range = ofxTransitionRange(project, trackId, clip, "in")!;
    // B starts at 2s but the transition starts at 1.5s: pre-roll clamps to in.
    expect(transitionSourceTime(range.to!, 1.5)).toBe(0);
    // A continues past its out at 2s into its handle.
    expect(transitionSourceTime(range.from!, 2.4)).toBeCloseTo(2.4);
  });

  it("ignores disabled transition effects", () => {
    const { project, trackId, b } = build();
    const clip = project.tracks[0]!.clips.find((item) => item.id === b)!;
    clip.transitionIn = { ...clip.transitionIn!, effect: { ...EFFECT, enabled: false } };
    expect(ofxTransitionRange(project, trackId, clip, "in")).toBeNull();
  });
});

describe("normalizeClipTransition — ofx", () => {
  it("keeps the effect and clamps duration independently of the clip", () => {
    const normalized = normalizeClipTransition(
      { type: "ofx", duration: 20, effect: EFFECT },
      1,
    )!;
    expect(normalized.type).toBe("ofx");
    expect(normalized.duration).toBe(10);
    expect(normalized.effect?.id).toBe(EFFECT.id);
  });

  it("drops a transition without an effect", () => {
    expect(normalizeClipTransition({ type: "ofx", duration: 1 }, 2)).toBeNull();
  });

  it("survives a project save / load round-trip", () => {
    const { project } = build();
    const restored = parseProject(serializeProject(project));
    const clip = restored.tracks[0]!.clips[1]!;
    expect(clip.transitionIn?.type).toBe("ofx");
    expect(clip.transitionIn?.effect?.plugin).toBe(EFFECT.plugin);
    expect(clip.transitionIn?.duration).toBe(1);
  });
});
