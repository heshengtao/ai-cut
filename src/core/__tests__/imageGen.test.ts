import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_SPEC,
  IMAGE_PRESETS,
  alignImageSize,
  editSizeFromSource,
  imageModelSpec,
} from "@/types/imageGen";

describe("image generation specs", () => {
  it("maps every supported family and falls back for unknown ones", () => {
    expect(imageModelSpec("sd15").steps).toBe(20);
    expect(imageModelSpec("qwen_image_edit").refEdit).toBe(true);
    expect(imageModelSpec("nope")).toBe(DEFAULT_IMAGE_SPEC);
    expect(imageModelSpec(null)).toBe(DEFAULT_IMAGE_SPEC);
  });

  it("only offers draw-capable models in the draw tab", () => {
    expect(imageModelSpec("z_image_turbo").draw).toBe(true);
    expect(imageModelSpec("flux1_kontext").draw).toBe(false);
    expect(imageModelSpec("qwen_image_edit").draw).toBe(false);
    expect(imageModelSpec("flux1_kontext").edit).toBe(true);
  });

  it("aligns sizes to each family's multiple", () => {
    expect(alignImageSize(513, 64)).toBe(576);
    expect(alignImageSize(513, 32)).toBe(544);
    expect(alignImageSize(513, 16)).toBe(528);
    expect(alignImageSize(1024, 64)).toBe(1024);
    expect(alignImageSize(10, 32)).toBe(64);
  });

  it("derives edit sizes from the source image without upscaling", () => {
    expect(editSizeFromSource(832, 1216, 32)).toEqual({ width: 832, height: 1216 });
    expect(editSizeFromSource(6000, 4000, 32)).toEqual({ width: 2048, height: 1376 });
    expect(editSizeFromSource(null, 1080, 32)).toBeNull();
  });

  it("keeps the preset list usable by every family", () => {
    expect(IMAGE_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of IMAGE_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
    }
  });
});
