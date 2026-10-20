import { describe, expect, it } from "vitest";
import { createAsset, createClip, createTrack, newProject } from "@/core/factory";
import { addClip, setTrackFlag, updateClip } from "@/core/ops";
import type { ExportOptions } from "@/types/export";
import type { Project } from "@/types/project";
import {
  buildExportPlan,
  collectUsedAssets,
  hasExportableText,
  resolveDimensions,
} from "@/core/export/plan";
import { formatSeconds, safeFileName } from "@/core/export/escape";
import { dataUrlToBase64, textLayerName } from "@/core/export/textLayer";

const MP4: ExportOptions = {
  format: "mp4",
  resolution: "project",
  fps: null,
  quality: "standard",
};

const NO_TEXT = new Map<string, string>();

function fixture() {
  const topTrack = createTrack("V1");
  const bottomTrack = createTrack("V2");
  const audioTrack = createTrack("A1");
  const textTrack = createTrack("T1");

  const topAsset = createAsset({
    id: "top",
    name: "top.mp4",
    kind: "video",
    src: "/media/top.mp4",
    duration: 30,
    hasAudio: true,
  });
  const bottomAsset = createAsset({
    id: "bottom",
    name: "bottom.mp4",
    kind: "video",
    src: "/media/bottom.mp4",
    duration: 30,
    hasAudio: false,
  });
  const imageAsset = createAsset({
    id: "cover",
    name: "cover.png",
    kind: "image",
    src: "/media/cover.png",
    duration: 0,
  });
  const musicAsset = createAsset({
    id: "music",
    name: "music.mp3",
    kind: "audio",
    src: "/media/music.mp3",
    duration: 20,
    hasAudio: true,
  });

  const topClip = createClip({
    assetId: "top",
    trackId: topTrack.id,
    start: 0,
    duration: 3,
    in: 1,
  });
  const bottomClip = {
    ...createClip({
      assetId: "bottom",
      trackId: bottomTrack.id,
      start: 1,
      duration: 3,
      in: 2,
    }),
    opacity: 0.5,
  };
  const imageClip = createClip({
    assetId: "cover",
    trackId: bottomTrack.id,
    start: 2,
    duration: 3,
  });
  const musicClip = {
    ...createClip({
      assetId: "music",
      trackId: audioTrack.id,
      start: 1.5,
      duration: 3.5,
      in: 0,
    }),
    gain: -6,
  };
  const textClip = createClip({
    assetId: "",
    trackId: textTrack.id,
    start: 1,
    duration: 3,
    text: "夏天: 海边的风",
  });

  let doc: Project = {
    ...newProject("导出测试"),
    tracks: [topTrack, bottomTrack, audioTrack, textTrack],
    assets: [topAsset, bottomAsset, imageAsset, musicAsset],
  };
  doc = addClip(doc, topTrack.id, topClip);
  doc = addClip(doc, bottomTrack.id, bottomClip);
  doc = addClip(doc, bottomTrack.id, imageClip);
  doc = addClip(doc, audioTrack.id, musicClip);
  doc = addClip(doc, textTrack.id, textClip);

  return {
    doc,
    topTrack,
    bottomTrack,
    audioTrack,
    textTrack,
    topAsset,
    bottomAsset,
    imageAsset,
    musicAsset,
    topClip,
    bottomClip,
    imageClip,
    musicClip,
    textClip,
  };
}

describe("formatSeconds / safeFileName", () => {
  it("formats seconds with up to 6 decimals and no trailing zeros", () => {
    expect(formatSeconds(2)).toBe("2");
    expect(formatSeconds(1.5)).toBe("1.5");
    expect(formatSeconds(1 / 30)).toBe("0.033333");
  });

  it("cleans file names and falls back when empty", () => {
    expect(safeFileName('a/b:c*?"<>|')).toBe("a b c");
    expect(safeFileName("   ")).toBe("未命名项目");
  });
});

describe("text layer helpers", () => {
  it("strips the data URL prefix and names cache files per clip", () => {
    expect(dataUrlToBase64("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(textLayerName("a/b:c", 1280, 720)).toBe("text-a_b_c-1280x720.png");
  });
});

describe("resolveDimensions", () => {
  it("keeps project dimensions by default", () => {
    const { doc } = fixture();
    expect(resolveDimensions(doc, MP4)).toEqual({ width: 1920, height: 1080, fps: 30 });
  });

  it("scales to presets while preserving aspect", () => {
    const { doc } = fixture();
    expect(resolveDimensions(doc, { ...MP4, resolution: "720p" })).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
    });
    expect(resolveDimensions(doc, { ...MP4, resolution: "1080p" })).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
    });
  });

  it("caps GIF at 720p and 15fps", () => {
    const { doc } = fixture();
    expect(resolveDimensions(doc, { ...MP4, format: "gif" })).toEqual({
      width: 1280,
      height: 720,
      fps: 15,
    });
  });
});

describe("collectUsedAssets / hasExportableText", () => {
  it("includes visual assets even when muted, but drops muted audio-only assets", () => {
    const { doc, audioTrack } = fixture();
    const withMuted = setTrackFlag(doc, audioTrack.id, "muted", true);
    const ids = collectUsedAssets(withMuted).map((a) => a.id);
    expect(ids).toContain("top");
    expect(ids).toContain("bottom");
    expect(ids).toContain("cover");
    expect(ids).not.toContain("music");
    expect(hasExportableText(doc)).toBe(true);
  });
});

describe("buildExportPlan — video", () => {
  it("composites video tracks bottom-to-top and applies opacity", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, MP4, NO_TEXT, "/tmp/out.mp4");

    expect(plan.inputs).toContain("-loop");
    expect(plan.inputs.indexOf("/media/bottom.mp4")).toBeLessThan(
      plan.inputs.indexOf("/media/top.mp4"),
    );
    expect(plan.filterGraph).toContain("color=c=black:s=1920x1080:r=30:d=5");
    expect(plan.filterGraph).toContain("overlay=eof_action=pass:enable='between(t,1,4)'");
    expect(plan.filterGraph).toContain("overlay=eof_action=pass:enable='between(t,0,3)'");
    expect(plan.filterGraph).toContain("colorchannelmixer=aa=0.5");
    expect(plan.filterGraph).toContain("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black@0");
  });

  it("keeps the picture when a video track is muted", () => {
    const { doc, topTrack } = fixture();
    const muted = setTrackFlag(doc, topTrack.id, "muted", true);
    const plan = buildExportPlan(muted, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.inputs).toContain("/media/top.mp4");
    expect(plan.filterGraph).toContain("between(t,0,3)");
  });

  it("skips the picture of hidden visual tracks but keeps their audio", () => {
    const { doc, topTrack } = fixture();
    const hidden = setTrackFlag(doc, topTrack.id, "visible", false);
    const plan = buildExportPlan(hidden, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.filterGraph).not.toContain("overlay=eof_action=pass:enable='between(t,0,3)'");
    // 隐藏只影响画面；这条视频轨的音频仍然需要一个输入。
    expect(plan.inputs).toContain("/media/top.mp4");
    expect(plan.filterGraph).toContain("amix=inputs=2");
  });

  it("throws for offline assets used by clips", () => {
    const { doc, topAsset } = fixture();
    const offline = {
      ...doc,
      assets: doc.assets.map((a) => (a.id === topAsset.id ? { ...a, offline: true } : a)),
    };
    expect(() => buildExportPlan(offline, MP4, NO_TEXT, "/tmp/out.mp4")).toThrow(/离线/);
  });
});

describe("buildExportPlan — audio", () => {
  it("mixes audio tracks and video-embedded audio with gain and delay", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.filterGraph).toContain("volume=-6dB");
    expect(plan.filterGraph).toContain("adelay=1500:all=1");
    expect(plan.filterGraph).toContain("aresample=48000");
    expect(plan.filterGraph).toContain(
      "amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]",
    );
    expect(plan.filterGraph).toContain("[2:a]");
    expect(plan.filterGraph).toContain("[3:a]");
  });

  it("applies fade in/out, pitch and stereo balance", () => {
    const { doc, audioTrack } = fixture();
    const clip = doc.tracks.find((t) => t.id === audioTrack.id)!.clips[0];
    const modified = updateClip(doc, clip.id, {
      fadeIn: 0.5,
      fadeOut: 1,
      pitch: 12,
      pan: -0.5,
    });
    const plan = buildExportPlan(modified, MP4, NO_TEXT, "/tmp/out.mp4");

    expect(plan.filterGraph).toContain("afade=t=in:st=0:d=0.5");
    expect(plan.filterGraph).toContain("afade=t=out:st=2.5:d=1");
    expect(plan.filterGraph).toContain("asetrate=96000");
    expect(plan.filterGraph).toContain("atempo=0.500000");
    expect(plan.filterGraph).toContain("pan=stereo|c0=c0*1.000|c1=c1*0.500");
  });

  it("adds a silent audio source when no clip has audio", () => {
    const track = createTrack("V1");
    const image = createAsset({
      id: "pic",
      name: "pic.png",
      kind: "image",
      src: "/media/pic.png",
      duration: 0,
    });
    const clip = createClip({ assetId: "pic", trackId: track.id, start: 0, duration: 2 });
    let doc: Project = { ...newProject(), tracks: [track], assets: [image] };
    doc = addClip(doc, track.id, clip);

    const plan = buildExportPlan(doc, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.filterGraph).toContain("anullsrc=r=48000:cl=stereo:d=2");
  });
});

describe("buildExportPlan — text", () => {
  it("overlays a pre-rendered text PNG", () => {
    const { doc, textClip } = fixture();
    const plan = buildExportPlan(
      doc,
      MP4,
      new Map([[textClip.id, "/tmp/text.png"]]),
      "/tmp/out.mp4",
    );
    expect(plan.inputs).toContain("-loop");
    expect(plan.inputs).toContain("/tmp/text.png");
    expect(plan.filterGraph).toContain(
      "[3:v]format=yuva420p,fps=30,setpts=PTS-STARTPTS+1/TB[t0]",
    );
    expect(plan.filterGraph).toContain("[vtext0]");
    expect(plan.filterGraph).toContain("enable='between(t,1,4)'");
    expect(plan.filterGraph).not.toContain("drawtext");
  });

  it("warns when a text clip has no rendered image", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.warnings.join("")).toMatch(/文字/);
    expect(plan.filterGraph).not.toContain("vtext");
  });
});

describe("buildExportPlan — output profiles", () => {
  it("builds MP4 output args", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, MP4, NO_TEXT, "/tmp/out.mp4");
    expect(plan.outputArgs).toEqual(
      expect.arrayContaining([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
      ]),
    );
    expect(plan.outputArgs.at(-1)).toBe("/tmp/out.mp4");
  });

  it("maps quality to CRF", () => {
    const { doc } = fixture();
    expect(
      buildExportPlan(doc, { ...MP4, quality: "high" }, NO_TEXT, "/tmp/out.mp4").outputArgs,
    ).toEqual(expect.arrayContaining(["-crf", "18"]));
    expect(
      buildExportPlan(doc, { ...MP4, quality: "small" }, NO_TEXT, "/tmp/out.mp4").outputArgs,
    ).toEqual(expect.arrayContaining(["-crf", "28"]));
  });

  it("builds ProRes output args", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, { ...MP4, format: "prores" }, NO_TEXT, "/tmp/out.mov");
    expect(plan.outputArgs).toEqual(
      expect.arrayContaining([
        "-c:v",
        "prores_ks",
        "-profile:v",
        "2",
        "-pix_fmt",
        "yuv422p10le",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
      ]),
    );
    expect(plan.outputArgs.at(-1)).toBe("/tmp/out.mov");
  });

  it("builds GIF with palette filters and no audio", () => {
    const { doc } = fixture();
    const plan = buildExportPlan(doc, { ...MP4, format: "gif" }, NO_TEXT, "/tmp/out.gif");
    expect(plan.filterGraph).toContain("split[g0][g1]");
    expect(plan.filterGraph).toContain("palettegen=max_colors=256:stats_mode=diff[pal]");
    expect(plan.filterGraph).toContain("paletteuse=dither=sierra2_4a[gifout]");
    expect(plan.filterGraph).not.toContain("[aout]");
    expect(plan.outputArgs).toEqual(
      expect.arrayContaining(["-map", "[gifout]", "-loop", "0", "-an"]),
    );
    expect(plan.fps).toBe(15);
    expect(plan.outputArgs.at(-1)).toBe("/tmp/out.gif");
  });
});

describe("buildExportPlan — validation", () => {
  it("rejects an empty timeline", () => {
    expect(() => buildExportPlan(newProject(), MP4, NO_TEXT, "/tmp/out.mp4")).toThrow(
      /时间线为空/,
    );
  });
});
