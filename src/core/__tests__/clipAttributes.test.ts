import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addTrack } from "@/core/ops/tracks";
import {
  addClip,
  setClipColor,
  setClipKeyframes,
  setClipOpacity,
  setClipSpeed,
  setClipTextStyle,
  setClipTransition,
} from "@/core/ops/clips";
import {
  applyClipAttributes,
  copyClipAttributes,
  resetClipAttributes,
} from "@/core/clipAttributes";
import { DEFAULT_TRANSFORM } from "@/core/transform";

function setup() {
  let doc = addTrack(newProject());
  const trackId = doc.tracks[0].id;
  doc = addAsset(
    doc,
    createAsset({
      id: "a1",
      name: "clip.mp4",
      kind: "video",
      src: "/tmp/clip.mp4",
      duration: 10,
    }),
  );
  const source = createClip({ assetId: "a1", trackId, start: 0, duration: 4 });
  const target = createClip({ assetId: "a1", trackId, start: 5, duration: 2 });
  doc = addClip(doc, trackId, source);
  doc = addClip(doc, trackId, target);
  return { doc, trackId, source, target };
}

function find(doc: ReturnType<typeof newProject>, id: string) {
  for (const track of doc.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return clip;
  }
  throw new Error("clip not found");
}

describe("copyClipAttributes", () => {
  it("resolves defaults so pasting can also clear target effects", () => {
    const { doc, source } = setup();
    const attrs = copyClipAttributes(find(doc, source.id));

    expect(attrs.opacity).toBe(1);
    expect(attrs.transform).toEqual(DEFAULT_TRANSFORM);
    expect(attrs.transitionIn).toBeNull();
    expect(attrs.transitionOut).toBeNull();
    expect(attrs.keyframes).toBeNull();
    expect(attrs.gain).toBe(0);
    expect(attrs.muted).toBe(false);
  });
});

describe("applyClipAttributes", () => {
  it("copies effects without touching timing", () => {
    let { doc, source, target } = setup();
    doc = setClipOpacity(doc, source.id, 0.5);
    doc = setClipColor(doc, source.id, { saturation: 1.5 });
    doc = setClipTransition(doc, source.id, "in", { type: "fade", duration: 0.5 });

    const attrs = copyClipAttributes(find(doc, source.id));
    const next = applyClipAttributes(doc, target.id, attrs);
    const copied = find(next, target.id);

    expect(copied.opacity).toBe(0.5);
    expect(copied.color?.saturation).toBeCloseTo(1.5);
    expect(copied.transitionIn?.type).toBe("fade");
    expect(copied.start).toBe(5);
    expect(copied.duration).toBe(2);
  });

  it("clears effects that the source does not have", () => {
    let { doc, source, target } = setup();
    doc = setClipTransition(doc, target.id, "out", { type: "slide", duration: 0.5 });
    doc = setClipKeyframes(doc, target.id, [
      { time: 0, opacity: 1 },
      { time: 1, opacity: 0.2 },
    ]);

    const attrs = copyClipAttributes(find(doc, source.id));
    const next = applyClipAttributes(doc, target.id, attrs);
    const copied = find(next, target.id);

    expect(copied.transitionOut).toBeUndefined();
    expect(copied.keyframes).toBeUndefined();
  });
});

describe("resetClipAttributes", () => {
  it("clears effects but keeps timing and speed", () => {
    let { doc, source } = setup();
    doc = setClipSpeed(doc, source.id, 2);
    doc = setClipOpacity(doc, source.id, 0.3);

    const next = resetClipAttributes(doc, source.id);
    const clip = find(next, source.id);

    expect(clip.opacity).toBeUndefined();
    expect(clip.speed).toBe(2);
    expect(clip.duration).toBeCloseTo(2);
  });

  it("keeps text content while resetting its style", () => {
    const { doc, trackId } = setup();
    const text = createClip({
      assetId: "",
      trackId,
      start: 20,
      duration: 2,
      text: "标题",
    });
    let next = addClip(doc, trackId, text);
    next = setClipTextStyle(next, text.id, { fontSize: 72 });

    const result = resetClipAttributes(next, text.id);
    const clip = find(result, text.id);

    expect(clip.text).toBe("标题");
    expect(clip.textStyle).toBeUndefined();
  });
});
