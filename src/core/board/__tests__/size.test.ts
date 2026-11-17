import { describe, expect, it } from "vitest";
import {
  SIZE_AUTO,
  SIZE_CUSTOM,
  boardSizePatch,
  boardSizePixels,
  boardSizeSpec,
  boardSizeTier,
  boardSizeValue,
  nearestSizeOption,
} from "@/core/board/size";

function ids(spec: ReturnType<typeof boardSizeSpec>): string[] {
  return spec.options.map((option) => option.id);
}

describe("boardSizeSpec", () => {
  it("本地图片按家族对齐单位给像素预设，并允许自定义", () => {
    const spec = boardSizeSpec({ kind: "image", model: "local:sdxl", family: "sdxl" });
    expect(spec.mode).toBe("pixels");
    expect(spec.custom).toBe(true);
    expect(spec.step).toBe(64);
    expect(spec.defaultId).toBe("1024x1024");
    expect(ids(spec)).toEqual([
      "512x512",
      "768x768",
      "1024x1024",
      "832x1216",
      "1216x832",
      "1344x1344",
    ]);
    // 竖屏 832 在 64 对齐下不变；FLUX 家族的 16 对齐也不会改这些档。
    const flux = boardSizeSpec({ kind: "image", model: "local:flux", family: "flux1_schnell" });
    expect(flux.step).toBe(16);
    expect(ids(flux)).toEqual(ids(spec));
  });

  it("本地视频用 AI 视频页同一套「档位 × 画幅」，默认 480p 横屏", () => {
    const spec = boardSizeSpec({ kind: "video", model: "local:wan", family: "wan21_t2v" });
    expect(spec.mode).toBe("pixels");
    expect(spec.custom).toBe(true);
    expect(spec.step).toBe(32);
    expect(spec.defaultId).toBe("480p-16:9");
    expect(ids(spec)).toHaveLength(9);
    expect(spec.options.find((option) => option.id === "720p-16:9")).toMatchObject({
      width: 1280,
      height: 736,
      label: "720p · 16:9",
    });
  });

  it("只认比例的云端图片服务不给自定义，只列画幅", () => {
    for (const providerKind of ["gemini", "stability", "kling", "minimax", "openrouter"] as const) {
      const spec = boardSizeSpec({ kind: "image", providerKind });
      expect(spec.mode).toBe("aspect");
      expect(spec.custom).toBe(false);
      expect(ids(spec)).toEqual([
        "1:1",
        "4:3",
        "3:2",
        "16:9",
        "21:9",
        "3:4",
        "2:3",
        "9:16",
        "9:21",
      ]);
      expect(spec.defaultId).toBe("1:1");
    }
  });

  it("白名单尺寸的服务只能选它支持的几档", () => {
    const silico = boardSizeSpec({ kind: "image", providerKind: "siliconflow" });
    expect(silico.mode).toBe("fixed");
    expect(silico.custom).toBe(false);
    expect(ids(silico)).toEqual(["1024x1024", "1280x960", "960x1280", "1024x768", "768x1024"]);

    const dalle = boardSizeSpec({
      kind: "image",
      providerKind: "openai",
      cloudModel: "dall-e-3",
    });
    expect(dalle.mode).toBe("fixed");
    expect(ids(dalle)).toEqual(["1024x1024", "1792x1024", "1024x1792"]);

    const gpt = boardSizeSpec({
      kind: "image",
      providerKind: "openai",
      cloudModel: "gpt-image-1",
    });
    expect(gpt.custom).toBe(false);
    expect(ids(gpt)).toEqual(["1024x1024", "1536x1024", "1024x1536"]);

    // 普通 OpenAI 兼容接口吃任意宽高 → 预设 + 自定义（16 对齐）。
    const free = boardSizeSpec({
      kind: "image",
      providerKind: "openai",
      cloudModel: "flux-pro",
    });
    expect(free.mode).toBe("pixels");
    expect(free.custom).toBe(true);
    expect(free.step).toBe(16);
  });

  it("吃任意宽高的云端图片服务给常用档 + 自定义", () => {
    const bfl = boardSizeSpec({ kind: "image", providerKind: "bfl" });
    expect(bfl.custom).toBe(true);
    expect(bfl.step).toBe(32);
    expect(bfl.max).toBe(1440);

    for (const providerKind of ["dashscope", "ark"] as const) {
      const spec = boardSizeSpec({ kind: "image", providerKind });
      expect(spec.custom).toBe(true);
      expect(ids(spec)).toContain("1536x1024");
      expect(ids(spec)).toContain("1024x1536");
    }
  });

  it("接口不传尺寸的服务显示「由模型决定」", () => {
    for (const providerKind of ["replicate", "fal"] as const) {
      const spec = boardSizeSpec({ kind: "image", providerKind });
      expect(spec.mode).toBe("auto");
      expect(spec.options).toHaveLength(0);
      expect(boardSizeValue(spec, {})).toBe(SIZE_AUTO);
      expect(boardSizePixels(spec, {})).toEqual({ width: 1024, height: 1024 });
    }
    const minimaxH3 = boardSizeSpec({
      kind: "video",
      providerKind: "minimax",
      cloudModel: "MiniMax-H3",
    });
    expect(minimaxH3.mode).toBe("auto");
  });

  it("云端视频按服务分画幅 / 固定尺寸 / 分辨率档", () => {
    const veo = boardSizeSpec({ kind: "video", providerKind: "gemini" });
    expect(veo.mode).toBe("aspect");
    expect(ids(veo)).toEqual(["16:9", "9:16"]);

    const kling = boardSizeSpec({ kind: "video", providerKind: "kling" });
    expect(ids(kling)).toEqual(["16:9", "9:16", "1:1"]);

    for (const providerKind of ["dashscope", "siliconflow", "runway"] as const) {
      const spec = boardSizeSpec({ kind: "video", providerKind });
      expect(spec.mode).toBe("fixed");
      expect(spec.custom).toBe(false);
      expect(ids(spec)).toEqual(["1280x720", "720x1280", "960x960"]);
    }

    const ark = boardSizeSpec({ kind: "video", providerKind: "ark" });
    expect(ark.mode).toBe("tier");
    expect(ark.custom).toBe(false);
    expect(ids(ark)).toHaveLength(9);
    expect(ark.defaultId).toBe("720p-16:9");
    expect(ark.options.find((option) => option.id === "1080p-9:16")?.tier).toBe("1080p");

    const minimax = boardSizeSpec({ kind: "video", providerKind: "minimax" });
    expect(minimax.mode).toBe("tier");
    expect(minimax.options.map((option) => option.tier)).toEqual(["720p", "1080p"]);
    expect(minimax.defaultId).toBe("1080p");
  });

  it("云端服务列表还没加载时先给通用像素预设", () => {
    const spec = boardSizeSpec({ kind: "image", model: "cloud:unloaded" });
    expect(spec.mode).toBe("pixels");
    expect(spec.custom).toBe(true);
  });
});

describe("boardSizeValue / pixels", () => {
  const localImage = boardSizeSpec({ kind: "image", model: "local:sdxl", family: "sdxl" });

  it("新节点没有参数时落到默认档", () => {
    expect(boardSizeValue(localImage, {})).toBe("1024x1024");
    expect(boardSizePixels(localImage, {})).toEqual({ width: 1024, height: 1024 });
  });

  it("旧文档只有宽高：对得上预设就用预设，对不上进自定义并保留原值", () => {
    expect(boardSizeValue(localImage, { width: 832, height: 1216 })).toBe("832x1216");
    expect(boardSizeValue(localImage, { width: 900, height: 900 })).toBe(SIZE_CUSTOM);
    expect(boardSizePixels(localImage, { size: SIZE_CUSTOM, width: 900, height: 900 })).toEqual({
      width: 960,
      height: 960,
    });
  });

  it("比例型服务把旧宽高折算到最接近的画幅", () => {
    const gemini = boardSizeSpec({ kind: "image", providerKind: "gemini" });
    expect(boardSizeValue(gemini, { width: 832, height: 1216 })).toBe("2:3");
    expect(boardSizeValue(gemini, { width: 2048, height: 858 })).toBe("21:9");
    expect(boardSizePixels(gemini, { size: "16:9" })).toEqual({ width: 1280, height: 720 });
  });

  it("用另一家的档位 id 换模型时落到最接近的一档", () => {
    // 旧云端比例档 `16:9` 换成本地图片（像素预设），按比例取最接近的横屏档。
    const legacy = { size: "16:9", width: 1280, height: 720 };
    expect(boardSizeValue(localImage, legacy)).toBe("1216x832");
  });

  it("自定义宽高按对齐单位取整并夹在范围里", () => {
    expect(
      boardSizePixels(localImage, { size: SIZE_CUSTOM, width: 900, height: 2100 }),
    ).toEqual({ width: 960, height: 2048 });
  });

  it("选中预设会同时写回宽高，旧代码 / 导出都读得到", () => {
    expect(boardSizePatch(localImage, {}, "832x1216")).toEqual({
      size: "832x1216",
      width: 832,
      height: 1216,
    });
    // 切到自定义：先保留上一档的像素作为起点。
    expect(boardSizePatch(localImage, { size: "832x1216" }, SIZE_CUSTOM)).toEqual({
      size: SIZE_CUSTOM,
      width: 832,
      height: 1216,
    });
  });

  it("旧文档没有档位参数时落到服务的默认档", () => {
    const minimax = boardSizeSpec({ kind: "video", providerKind: "minimax" });
    expect(boardSizeValue(minimax, { width: 832, height: 480 })).toBe("1080p");
    const ark = boardSizeSpec({ kind: "video", providerKind: "ark" });
    expect(boardSizeValue(ark, { width: 832, height: 480 })).toBe("720p-16:9");
  });

  it("分辨率档只在档位型服务上透出", () => {
    const ark = boardSizeSpec({ kind: "video", providerKind: "ark" });
    expect(boardSizeTier(ark, { size: "1080p-9:16" })).toBe("1080p");
    expect(boardSizeTier(ark, {})).toBe("720p");
    expect(boardSizeTier(localImage, { size: "1024x1024" })).toBeNull();
  });

  it("nearestSizeOption 按比例距离挑档", () => {
    const aspect = boardSizeSpec({ kind: "image", providerKind: "gemini" });
    expect(nearestSizeOption(aspect, 900, 900)?.id).toBe("1:1");
    expect(nearestSizeOption(aspect, 1200, 500)?.id).toBe("21:9");
  });
});
