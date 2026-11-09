import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useImageModelSource } from "@/composables/useImageModelSource";
import { useModelsStore } from "@/stores/models";
import type { ModelFamily, ModelStatus } from "@/types/models";

function model(id: string, family: ModelFamily, installed = false): ModelStatus {
  return {
    id,
    name: id,
    feature: "image-gen",
    tag: "visual",
    license: "test",
    family,
    approx_bytes: 100,
    recommended: false,
    bundled: false,
    bundle_eligible: false,
    installed,
    path: null,
    total_files: 1,
    installed_files: installed ? 1 : 0,
    reusable_bytes: 0,
    shared_bytes: 0,
    regions: ["intl"],
    sources: [],
    files: [],
  };
}

describe("image model source lists", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useModelsStore().catalog = [
      model("sd15-inpaint", "sd15", true),
      model("z-image-turbo", "z_image_turbo"),
      model("sdxl-base", "sdxl"),
      model("flux1-kontext", "flux1_kontext"),
      model("qwen-image-edit", "qwen_image_edit"),
    ];
  });

  it("keeps edit-only models out of the generation list", () => {
    const draw = useImageModelSource({
      mode: "draw",
      providers: () => [],
      presets: () => [],
    });
    const edit = useImageModelSource({
      mode: "edit",
      providers: () => [],
      presets: () => [],
    });

    expect(draw.localModels.value.map((item) => item.id)).toEqual([
      "z-image-turbo",
      "sdxl-base",
    ]);
    expect(edit.localModels.value.map((item) => item.id)).toEqual([
      "sd15-inpaint",
      "z-image-turbo",
      "sdxl-base",
      "flux1-kontext",
      "qwen-image-edit",
    ]);

    const drawLabels = draw.options.value.map((option) => option.label);
    expect(drawLabels).not.toContain("sd15-inpaint");
    expect(drawLabels).not.toContain("flux1-kontext");
    expect(drawLabels).not.toContain("qwen-image-edit");
    const editLabels = edit.options.value.map((option) => option.label);
    expect(editLabels).toContain("flux1-kontext");
    expect(editLabels).toContain("qwen-image-edit");
  });

  it("remembers the chosen model per page", () => {
    const draw = useImageModelSource({
      mode: "draw",
      providers: () => [],
      presets: () => [],
    });
    const edit = useImageModelSource({
      mode: "edit",
      providers: () => [],
      presets: () => [],
    });

    draw.sourceId.value = "local:sdxl-base";
    expect(draw.featureKey).toBe("image-gen");
    expect(edit.featureKey).toBe("image-edit");
    expect(edit.sourceId.value).toBe("local:z-image-turbo");

    edit.sourceId.value = "local:qwen-image-edit";
    expect(edit.sourceId.value).toBe("local:qwen-image-edit");
    expect(draw.sourceId.value).toBe("local:sdxl-base");
  });
});
