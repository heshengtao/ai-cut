import { describe, expect, it } from "vitest";
import type { ClipEffect, Project } from "@/types/project";
import {
  addAsset,
  addClip,
  addClipEffect,
  addTrack,
  moveClipEffect,
  removeClipEffect,
  setClipEffectEnabled,
  setClipEffectParam,
} from "@/core/ops";
import { createAsset, createClip, newProject } from "@/core/factory";
import {
  clipEffectSpecs,
  defaultEffectParams,
  isMountablePlugin,
  normalizeClipEffects,
} from "@/core/effects";
import { parseProject, serializeProject } from "@/core/serialize";
import type { OfxPluginInfo } from "@/types/plugins";

const PLUGIN: OfxPluginInfo = {
  identifier: "com.example.glow",
  name: "Glow",
  label: "Glow",
  grouping: "Examples",
  version: "1.0",
  pluginApi: "OfxImageEffectPluginAPI",
  apiVersion: 1,
  versionMajor: 1,
  versionMinor: 0,
  context: "OfxImageEffectContextFilter",
  contexts: ["OfxImageEffectContextFilter"],
  pixelDepths: ["OfxBitDepthFloat"],
  clips: ["Source", "Output"],
  params: [
    {
      name: "amount",
      label: "Amount",
      type: "double",
      hint: "",
      parent: "",
      secret: false,
      enabled: true,
      dimension: 1,
      default: 0.5,
      min: [0],
      max: [1],
      displayMin: [0],
      displayMax: [1],
      increment: [0.01],
      digits: 2,
      choices: [],
    },
    {
      name: "enabled",
      label: "Enabled",
      type: "boolean",
      hint: "",
      parent: "",
      secret: false,
      enabled: true,
      dimension: 1,
      default: true,
      min: null,
      max: null,
      displayMin: null,
      displayMax: null,
      increment: null,
      digits: 0,
      choices: [],
    },
  ],
};

function effect(): ClipEffect {
  return {
    id: "fx-1",
    plugin: PLUGIN.identifier,
    name: PLUGIN.label,
    bundle: "/tmp/glow.ofx.bundle",
    context: PLUGIN.context,
    params: defaultEffectParams(PLUGIN),
    enabled: true,
  };
}

function fixture(): { doc: Project; clipId: string } {
  const asset = createAsset({
    id: "a1",
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 20,
  });
  let doc = addAsset(addTrack(newProject("fx")), asset);
  const trackId = doc.tracks[0].id;
  const clip = createClip({ assetId: asset.id, trackId, start: 0, duration: 10 });
  doc = addClip(doc, trackId, clip);
  return { doc, clipId: clip.id };
}

describe("clip effects", () => {
  it("uses plugin defaults and can be added, edited and removed", () => {
    const { doc: base, clipId } = fixture();
    let doc = addClipEffect(base, clipId, effect());
    const clip = doc.tracks[0].clips[0];
    expect(clip.effects).toHaveLength(1);
    expect(clip.effects?.[0].params.amount).toBe(0.5);

    doc = setClipEffectParam(doc, clipId, "fx-1", "amount", 0.9);
    expect(doc.tracks[0].clips[0].effects?.[0].params.amount).toBe(0.9);

    doc = setClipEffectEnabled(doc, clipId, "fx-1", false);
    expect(doc.tracks[0].clips[0].effects?.[0].enabled).toBe(false);
    expect(clipEffectSpecs(doc.tracks[0].clips[0])).toHaveLength(0);

    doc = removeClipEffect(doc, clipId, "fx-1");
    expect(doc.tracks[0].clips[0].effects).toBeUndefined();
  });

  it("reorders effects and keeps ids stable", () => {
    const { doc: base, clipId } = fixture();
    let doc = addClipEffect(base, clipId, effect());
    doc = addClipEffect(doc, clipId, { ...effect(), id: "fx-2", name: "Second" });
    doc = moveClipEffect(doc, clipId, "fx-2", -1);
    expect(doc.tracks[0].clips[0].effects?.map((item) => item.id)).toEqual([
      "fx-2",
      "fx-1",
    ]);
  });

  it("drops malformed effects when loading a project", () => {
    const { doc, clipId } = fixture();
    const withEffect = addClipEffect(doc, clipId, effect());
    const json = serializeProject(withEffect);
    const parsed = parseProject(json);
    expect(parsed.tracks[0].clips[0].effects?.[0].plugin).toBe("com.example.glow");

    const broken = JSON.parse(json);
    broken.tracks[0].clips[0].effects = [
      { id: "bad" },
      { id: "ok", plugin: "p", bundle: "/tmp/p.ofx", params: { x: 2 } },
    ];
    const repaired = parseProject(JSON.stringify(broken));
    expect(repaired.tracks[0].clips[0].effects).toHaveLength(1);
    expect(repaired.tracks[0].clips[0].effects?.[0].id).toBe("ok");
    expect(normalizeClipEffects(null)).toEqual([]);
  });

  it("only mounts filter, general and generator contexts", () => {
    expect(
      isMountablePlugin({ ...PLUGIN, contexts: ["OfxImageEffectContextFilter"] }),
    ).toBe(true);
    expect(
      isMountablePlugin({ ...PLUGIN, contexts: ["OfxImageEffectContextGenerator"] }),
    ).toBe(true);
    expect(
      isMountablePlugin({ ...PLUGIN, contexts: ["OfxImageEffectContextGeneral"] }),
    ).toBe(true);
    expect(
      isMountablePlugin({
        ...PLUGIN,
        contexts: ["OfxImageEffectContextTransition"],
      }),
    ).toBe(false);
    expect(
      isMountablePlugin({ ...PLUGIN, contexts: ["OfxImageEffectContextPaint"] }),
    ).toBe(false);
    expect(
      isMountablePlugin({ ...PLUGIN, contexts: ["OfxImageEffectContextRetimer"] }),
    ).toBe(false);
    // 同时支持滤镜和转场的插件仍然可以按滤镜挂载。
    expect(
      isMountablePlugin({
        ...PLUGIN,
        contexts: [
          "OfxImageEffectContextTransition",
          "OfxImageEffectContextFilter",
        ],
      }),
    ).toBe(true);
  });
});
