import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { boardSizeSpecFor } from "@/composables/useBoardSize";
import { boardCloudProviderList } from "@/composables/useBoardCloudOptions";
import { useModelsStore } from "@/stores/models";
import type { BoardNode } from "@/types/board";
import type { CloudGenProvider } from "@/types/cloudGen";

function node(type: string, params: Record<string, unknown>): BoardNode {
  return { id: "n", type, position: { x: 0, y: 0 }, data: { params, bindings: {} } };
}

function provider(patch: Partial<CloudGenProvider>): CloudGenProvider {
  return {
    id: "p",
    name: "P",
    kind: "gemini",
    enabled: true,
    base_url: "",
    api_key: "",
    api_secret: "",
    group_id: "",
    image_model: "",
    edit_model: "",
    video_model: "",
    capabilities: [],
    ...patch,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  boardCloudProviderList.value = [];
});

describe("boardSizeSpecFor", () => {
  it("服务列表还没加载时用通用像素预设", () => {
    const spec = boardSizeSpecFor(node("model.image", { model: "cloud:later" }));
    expect(spec.mode).toBe("pixels");
    expect(spec.custom).toBe(true);
  });

  it("加载后按云端服务类型给对应模式", () => {
    boardCloudProviderList.value = [
      provider({ id: "g", kind: "gemini" }),
      provider({ id: "v", kind: "ark", video_model: "seedance-1.0" }),
      provider({ id: "s", kind: "siliconflow" }),
    ];
    expect(boardSizeSpecFor(node("model.image", { model: "cloud:g" })).mode).toBe("aspect");
    expect(boardSizeSpecFor(node("model.image", { model: "cloud:s" })).mode).toBe("fixed");
    const video = boardSizeSpecFor(node("model.video", { model: "cloud:v" }));
    expect(video.mode).toBe("tier");
    expect(video.options.map((option) => option.tier)).toContain("1080p");
  });

  it("本地图片用模型家族的对齐单位", () => {
    const models = useModelsStore();
    models.catalog = [{ id: "sdxl-1", family: "sdxl" } as never];
    const spec = boardSizeSpecFor(node("model.image", { model: "local:sdxl-1" }));
    expect(spec.mode).toBe("pixels");
    expect(spec.step).toBe(64);
    // 家族没加载时退回默认对齐（32），不会报错。
    const missing = boardSizeSpecFor(node("model.image", { model: "local:unknown" }));
    expect(missing.step).toBe(32);
  });
});
