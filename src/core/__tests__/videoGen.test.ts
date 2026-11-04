import { describe, expect, it } from "vitest";
import {
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  aspectFromSize,
  videoModelSpec,
  videoResolution,
} from "@/types/videoGen";

describe("video generation specs", () => {
  it("offers landscape, portrait and square sizes in every tier", () => {
    expect(VIDEO_ASPECTS.map((aspect) => aspect.id)).toEqual(["16:9", "9:16", "1:1"]);
    for (const tier of VIDEO_RESOLUTIONS) {
      for (const aspect of VIDEO_ASPECTS) {
        const size = tier.sizes[aspect.id];
        // H3 要求宽高是 32 的倍数；Wan / LTX 只要求 16，32 同样满足。
        expect(size.width % 32).toBe(0);
        expect(size.height % 32).toBe(0);
      }
    }
    expect(videoResolution("720p", "9:16").size).toEqual({ width: 736, height: 1280 });
    expect(videoResolution("480p", "1:1").size).toEqual({ width: 640, height: 640 });
  });

  it("falls back to 480p for an unknown tier", () => {
    expect(videoResolution("nope", "16:9").tier.id).toBe("480p");
  });

  it("knows which families accept reference frames", () => {
    expect(videoModelSpec("minimax_h3")).toMatchObject({
      initImage: true,
      endImage: true,
      refImage: false,
      refAudio: false,
    });
    expect(videoModelSpec("minimax_h3_ref2va")).toMatchObject({
      initImage: false,
      endImage: false,
      refImage: true,
      refAudio: true,
    });
    expect(videoModelSpec("ltx_23")).toMatchObject({ initImage: true, endImage: true });
    expect(videoModelSpec("ltx_25")).toMatchObject({ initImage: true, endImage: true });
    expect(videoModelSpec("wan22_ti2v")).toMatchObject({ initImage: true, endImage: false });
    expect(videoModelSpec("wan21_t2v")).toMatchObject({ initImage: false, endImage: false });
    expect(videoModelSpec("wan22_t2v_a14b")).toMatchObject({
      initImage: false,
      endImage: false,
    });
    expect(videoModelSpec("hunyuan_video_15")).toMatchObject({
      initImage: false,
      endImage: false,
    });
  });

  it("derives a sensible default aspect from the project size", () => {
    expect(aspectFromSize(1920, 1080)).toBe("16:9");
    expect(aspectFromSize(1080, 1920)).toBe("9:16");
    expect(aspectFromSize(1080, 1080)).toBe("1:1");
    expect(aspectFromSize(undefined, undefined)).toBe("16:9");
  });
});
