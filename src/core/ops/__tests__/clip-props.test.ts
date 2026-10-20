import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import {
  addClip,
  addTextClip,
  setClipBlendMode,
  setClipCornerRadius,
  setClipFadeIn,
  setClipFadeOut,
  setClipGain,
  setClipOpacity,
  setClipPan,
  setClipPitch,
  setClipShadow,
  setClipStroke,
  setClipText,
  setClipTextStyle,
  setClipTransform,
} from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import {
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
} from "@/core/clipStyle";
import { DEFAULT_TEXT_TRANSFORM, DEFAULT_TRANSFORM, resolveTransform } from "@/core/transform";

function withClip() {
  const base = addTrack(newProject());
  const v = base.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId: v, start: 0, duration: 4 });
  return { doc: addClip(base, v, clip), v, id: clip.id };
}

function find(doc: ReturnType<typeof newProject>, id: string) {
  for (const t of doc.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error("not found");
}

describe("addTextClip", () => {
  it("creates a text clip with an empty assetId", () => {
    const base = addTrack(newProject());
    const textTrack = base.tracks[0].id;
    const next = addTextClip(base, textTrack, 1, 3, "夏天，海边的风");
    const clip = next.tracks[0].clips[0];
    expect(clip.assetId).toBe("");
    expect(clip.text).toBe("夏天，海边的风");
    expect(clip.start).toBe(1);
    expect(clip.duration).toBe(3);
  });

  it("is a no-op for an unknown track", () => {
    const base = newProject();
    expect(addTextClip(base, "missing", 0, 1, "x")).toBe(base);
  });
});

describe("setClipText", () => {
  it("updates the text and is a no-op when unchanged", () => {
    const base = addTrack(newProject());
    const textTrack = base.tracks[0].id;
    const doc = addTextClip(base, textTrack, 0, 2, "旧");
    const id = doc.tracks[0].clips[0].id;
    const next = setClipText(doc, id, "新");
    expect(find(next, id).text).toBe("新");
    expect(setClipText(next, id, "新")).toBe(next);
  });
});

describe("setClipGain", () => {
  it("stores the value and clamps to the -60..12 dB range", () => {
    const { doc, id } = withClip();
    expect(find(setClipGain(doc, id, -3), id).gain).toBe(-3);
    expect(find(setClipGain(doc, id, 999), id).gain).toBe(12);
    expect(find(setClipGain(doc, id, -999), id).gain).toBe(-60);
  });
});

describe("setClipOpacity", () => {
  it("stores the value and clamps to 0..1", () => {
    const { doc, id } = withClip();
    expect(find(setClipOpacity(doc, id, 0.4), id).opacity).toBeCloseTo(0.4);
    expect(find(setClipOpacity(doc, id, 5), id).opacity).toBe(1);
    expect(find(setClipOpacity(doc, id, -5), id).opacity).toBe(0);
  });

  it("is a no-op when the value is unchanged", () => {
    const { doc, id } = withClip();
    const once = setClipOpacity(doc, id, 0.5);
    expect(setClipOpacity(once, id, 0.5)).toBe(once);
  });
});

describe("audio properties", () => {
  it("clamps fades so fade in + fade out never exceed the clip", () => {
    const { doc, id } = withClip();
    const fadedIn = setClipFadeIn(doc, id, 99);
    expect(find(fadedIn, id).fadeIn).toBe(4);

    const fadedOut = setClipFadeOut(fadedIn, id, 99);
    expect(find(fadedOut, id).fadeOut ?? 0).toBe(0);
    expect(find(setClipFadeOut(doc, id, 1.5), id).fadeOut).toBe(1.5);
  });

  it("clamps pitch to ±12 semitones and pan to ±1", () => {
    const { doc, id } = withClip();
    expect(find(setClipPitch(doc, id, 99), id).pitch).toBe(12);
    expect(find(setClipPitch(doc, id, -99), id).pitch).toBe(-12);
    expect(find(setClipPan(doc, id, 2), id).pan).toBe(1);
    expect(find(setClipPan(doc, id, -2), id).pan).toBe(-1);
  });

  it("is a no-op when the value is unchanged", () => {
    const { doc, id } = withClip();
    const once = setClipFadeIn(doc, id, 1);
    expect(setClipFadeIn(once, id, 1)).toBe(once);
    expect(setClipPitch(once, id, 0)).toBe(once);
    expect(setClipPan(once, id, 0)).toBe(once);
  });
});

describe("setClipTransform", () => {
  it("uses centered defaults for media and a lower default for text", () => {
    const { doc, id } = withClip();
    expect(resolveTransform(find(doc, id))).toEqual(DEFAULT_TRANSFORM);

    const textTrack = addTrack(doc);
    const textDoc = addTextClip(textTrack, textTrack.tracks.at(-1)!.id, 0, 3, "hello");
    const text = textDoc.tracks.at(-1)!.clips[0];
    expect(resolveTransform(text)).toEqual(DEFAULT_TEXT_TRANSFORM);
    expect(resolveTransform(text).y).toBe(30);
  });

  it("updates one field and clamps the result", () => {
    const { doc, id } = withClip();
    const moved = setClipTransform(doc, id, { x: 12.5, y: -8 });
    expect(resolveTransform(find(moved, id))).toMatchObject({ x: 12.5, y: -8 });

    const clamped = setClipTransform(moved, id, { scale: 99, rotation: -999 });
    expect(resolveTransform(find(clamped, id)).scale).toBe(5);
    expect(resolveTransform(find(clamped, id)).rotation).toBe(-360);
  });

  it("is a no-op when nothing changes", () => {
    const { doc, id } = withClip();
    expect(setClipTransform(doc, id, { x: 0, y: 0, scale: 1, rotation: 0 })).toBe(doc);
  });
});

describe("text style", () => {
  it("uses defaults and clamps out-of-range values", () => {
    const { doc, id } = withClip();
    expect(resolveTextStyle(find(doc, id)).fontSize).toBe(48);

    const styled = setClipTextStyle(doc, id, {
      fontSize: 999,
      letterSpacing: -999,
      lineHeight: 9,
      color: "#ABCDEF",
    });
    const style = resolveTextStyle(find(styled, id));
    expect(style.fontSize).toBe(400);
    expect(style.letterSpacing).toBe(-100);
    expect(style.lineHeight).toBe(4);
    expect(style.color).toBe("#abcdef");
  });

  it("is a no-op when the value is unchanged", () => {
    const { doc, id } = withClip();
    expect(setClipTextStyle(doc, id, { fontSize: 48 })).toBe(doc);
    expect(setClipTextStyle(doc, id, { color: "not-a-color" })).toBe(doc);
  });
});

describe("stroke / shadow / blend / radius", () => {
  it("stores stroke and shadow patches", () => {
    const { doc, id } = withClip();
    const stroked = setClipStroke(doc, id, { enabled: true, color: "#FF0000", width: 8 });
    expect(resolveStroke(find(stroked, id))).toMatchObject({
      enabled: true,
      color: "#ff0000",
      width: 8,
    });

    const shadowed = setClipShadow(stroked, id, {
      enabled: true,
      color: "#000000",
      opacity: 2,
      blur: 20,
      offsetX: 4,
    });
    expect(resolveShadow(find(shadowed, id))).toMatchObject({
      enabled: true,
      opacity: 1,
      blur: 20,
      offsetX: 4,
    });
  });

  it("gives text a default shadow but keeps media shadow off", () => {
    const { doc, id } = withClip();
    expect(resolveShadow(find(doc, id)).enabled).toBe(false);

    const textDoc = addTextClip(doc, doc.tracks[0].id, 0, 2, "hello");
    const text = textDoc.tracks[0].clips.find((clip) => clip.assetId === "")!;
    expect(resolveShadow(text).enabled).toBe(true);
  });

  it("normalizes blend modes and clamps radius", () => {
    const { doc, id } = withClip();
    const screened = setClipBlendMode(doc, id, "screen");
    expect(resolveBlendMode(find(screened, id))).toBe("screen");
    const reset = setClipBlendMode(screened, id, "not-a-mode");
    expect(resolveBlendMode(find(reset, id))).toBe("normal");

    const rounded = setClipCornerRadius(doc, id, 9999);
    expect(resolveCornerRadius(find(rounded, id))).toBe(1000);
    expect(resolveCornerRadius(find(setClipCornerRadius(doc, id, -4), id))).toBe(0);
  });
});
