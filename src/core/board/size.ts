/**
 * 画布模型节点的「输出分辨率」。
 *
 * 各家后端要的东西不一样：
 *
 * - 本地 sd.cpp / 多数聚合站吃**像素宽高**，宽度还要按模型家族对齐（16 / 32 / 64）；
 * - Gemini / Stability / 可灵 / MiniMax / OpenRouter 这类只吃**画幅比例**，
 *   宽高只是给后端换算比例的「建议像素」；
 * - OpenAI（DALL·E-3 / GPT-image）和 SiliconFlow 只允许**白名单**里的几档尺寸；
 * - 方舟 / MiniMax 视频只吃**分辨率档**（480p / 720p / 1080p），比例另算或由服务决定；
 * - Replicate / fal / MiniMax H3 这类接口压根不传尺寸，输出由模型或输入素材决定。
 *
 * 注册表里只放一个 `size` 参数，这里按当前模型把它收成「可选项 + 是否允许自定义」，
 * 卡片与检查器共用同一份规则；运行时再换算成真正的宽高 / 档位。
 *
 * 纯函数，不 import Vue / store。
 */
import { IMAGE_PRESETS, alignImageSize, imageModelSpec } from "@/types/imageGen";
import { VIDEO_ASPECTS, VIDEO_RESOLUTIONS } from "@/types/videoGen";
import type { CloudGenKind } from "@/types/cloudGen";

/** `params.size` 取值：某个选项 id / `custom` / `auto`（不需要选）。 */
export const SIZE_CUSTOM = "custom";
export const SIZE_AUTO = "auto";

/**
 * - `pixels`：像素宽高，预设有几档 + 可自定义；
 * - `aspect`：只认画幅比例（像素只是建议值），不能自定义；
 * - `fixed`：只允许服务白名单里的尺寸，不能自定义；
 * - `tier`：只认分辨率档（480p / 720p / 1080p），不能自定义；
 * - `auto`：接口不传尺寸，由模型 / 输入素材决定。
 */
export type BoardSizeMode = "pixels" | "aspect" | "fixed" | "tier" | "auto";

export interface BoardSizeOption {
  id: string;
  /** 触发器上显示的主文案。 */
  label: string;
  /** 菜单里的第二行小字（像素 / 画幅说明）。 */
  hint?: string;
  width: number;
  height: number;
  /** 菜单里的比例预览。 */
  ratio?: number;
  /** `tier` 模式真正发给后端的档位 id（`480p` / `720p` / `1080p`）。 */
  tier?: string;
}

export interface BoardSizeSpec {
  mode: BoardSizeMode;
  options: BoardSizeOption[];
  /** 允许「自定义…」并手填宽高。 */
  custom: boolean;
  /** 自定义宽高的对齐单位。 */
  step: number;
  min: number;
  max: number;
  /** 缺省档（新节点 / 换模型后落不到任何一档时用）。 */
  defaultId: string;
  /** `auto` / 取不到选项时用的兜底尺寸。 */
  fallback: { width: number; height: number };
}

export interface BoardSizeInput {
  kind: "image" | "video";
  /** 模型值：`local:<id>` / `cloud:<providerId>`。 */
  model?: unknown;
  /** 云端服务类型（openai / gemini / minimax…）。 */
  providerKind?: CloudGenKind | null;
  /** 云端服务实际使用的模型名（OpenAI 靠它区分 DALL·E-3 / GPT-image）。 */
  cloudModel?: string | null;
  /** 本地模型家族（sdxl / qwen_image / minimax_h3…）。 */
  family?: string | null;
}

/** 后端 OpenAI / 各家的比例白名单，和 Rust 侧 `nearest_ratio` 一致。 */
const IMAGE_RATIOS = [
  { id: "1:1", label: "1:1", width: 1024, height: 1024 },
  { id: "4:3", label: "4:3", width: 1152, height: 864 },
  { id: "3:2", label: "3:2", width: 1216, height: 832 },
  { id: "16:9", label: "16:9", width: 1280, height: 720 },
  { id: "21:9", label: "21:9", width: 1680, height: 720 },
  { id: "3:4", label: "3:4", width: 864, height: 1152 },
  { id: "2:3", label: "2:3", width: 832, height: 1216 },
  { id: "9:16", label: "9:16", width: 720, height: 1280 },
  { id: "9:21", label: "9:21", width: 720, height: 1680 },
] as const;

/** 视频画幅比例 → 建议像素（后端只取比例时用它们算 ratio）。 */
const VIDEO_RATIO_PIXELS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 960, height: 960 },
};

const IMAGE_PIXELS: [number, number][] = IMAGE_PRESETS.map((preset) => [
  preset.width,
  preset.height,
]);

/** 方舟视频的档位 × 画幅（后端同时收 ratio 与 resolution）。 */
const ARK_TIERS = [
  {
    id: "480p",
    label: "480p",
    sizes: {
      "16:9": { width: 864, height: 480 },
      "9:16": { width: 480, height: 864 },
      "1:1": { width: 640, height: 640 },
    },
  },
  {
    id: "720p",
    label: "720p",
    sizes: {
      "16:9": { width: 1280, height: 720 },
      "9:16": { width: 720, height: 1280 },
      "1:1": { width: 960, height: 960 },
    },
  },
  {
    id: "1080p",
    label: "1080p",
    sizes: {
      "16:9": { width: 1920, height: 1080 },
      "9:16": { width: 1080, height: 1920 },
      "1:1": { width: 1080, height: 1080 },
    },
  },
] as const;

/** 视频选项里的画幅顺序（横 / 竖 / 方）。 */
const VIDEO_ASPECT_ORDER = ["16:9", "9:16", "1:1"] as const;

function splitModel(value: unknown): { kind: "local" | "cloud"; id: string } | null {
  if (typeof value !== "string" || !value.includes(":")) return null;
  const [kind, ...rest] = value.split(":");
  if ((kind !== "local" && kind !== "cloud") || rest.length === 0) return null;
  return { kind, id: rest.join(":") };
}

/** 最近的常见比例名（`832 × 1216` → `2:3`），给菜单第二行用。 */
export function ratioName(width: number, height: number): string {
  const target = Math.log(Math.max(1, width) / Math.max(1, height));
  let best = "1:1";
  let distance = Number.POSITIVE_INFINITY;
  for (const item of IMAGE_RATIOS) {
    const value = Math.abs(Math.log(item.width / item.height) - target);
    if (value < distance) {
      distance = value;
      best = item.label;
    }
  }
  return best;
}

function pixelOption(width: number, height: number, label = `${width} × ${height}`): BoardSizeOption {
  return {
    id: `${width}x${height}`,
    label,
    hint: ratioName(width, height),
    width,
    height,
    ratio: width / height,
  };
}

function ratioOption(item: (typeof IMAGE_RATIOS)[number]): BoardSizeOption {
  return {
    id: item.id,
    label: item.label,
    hint: `${item.width} × ${item.height}`,
    width: item.width,
    height: item.height,
    ratio: item.width / item.height,
  };
}

function dedupe(options: BoardSizeOption[]): BoardSizeOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function pixelsSpec(
  options: BoardSizeOption[],
  config: {
    step: number;
    max: number;
    defaultId?: string;
    fallback?: { width: number; height: number };
    custom?: boolean;
    min?: number;
  },
): BoardSizeSpec {
  const list = dedupe(options);
  const fallback = config.fallback ?? {
    width: list[0]?.width ?? 1024,
    height: list[0]?.height ?? 1024,
  };
  return {
    mode: "pixels",
    options: list,
    custom: config.custom ?? true,
    step: config.step,
    min: config.min ?? 256,
    max: config.max,
    defaultId:
      config.defaultId && list.some((option) => option.id === config.defaultId)
        ? config.defaultId
        : list[0]?.id ?? `${fallback.width}x${fallback.height}`,
    fallback,
  };
}

function fixedImageSizes(
  sizes: [number, number][],
  config: { defaultId?: string; min?: number; max?: number } = {},
): BoardSizeSpec {
  return {
    ...pixelsSpec(sizes.map(([width, height]) => pixelOption(width, height)), {
      step: 16,
      max: config.max ?? 2048,
      min: config.min,
      defaultId: config.defaultId ?? "1024x1024",
      custom: false,
    }),
    mode: "fixed",
  };
}

function aspectImageSpec(): BoardSizeSpec {
  return {
    mode: "aspect",
    options: IMAGE_RATIOS.map(ratioOption),
    custom: false,
    step: 16,
    min: 256,
    max: 2048,
    defaultId: "1:1",
    fallback: { width: 1024, height: 1024 },
  };
}

function aspectVideoSpec(ids: readonly string[]): BoardSizeSpec {
  const options: BoardSizeOption[] = [];
  for (const id of ids) {
    const size = VIDEO_RATIO_PIXELS[id];
    if (!size) continue;
    options.push({
      id,
      label: id,
      hint: `${size.width} × ${size.height}`,
      width: size.width,
      height: size.height,
      ratio: size.width / size.height,
    });
  }
  return {
    mode: "aspect",
    options,
    custom: false,
    step: 32,
    min: 256,
    max: 1920,
    defaultId: options[0]?.id ?? "16:9",
    fallback: { width: 1280, height: 720 },
  };
}

function fixedVideoSizes(sizes: [number, number][]): BoardSizeSpec {
  return {
    mode: "fixed",
    options: sizes.map(([width, height]) => pixelOption(width, height)),
    custom: false,
    step: 32,
    min: 256,
    max: 1920,
    defaultId: `${sizes[0]?.[0] ?? 1280}x${sizes[0]?.[1] ?? 720}`,
    fallback: { width: sizes[0]?.[0] ?? 1280, height: sizes[0]?.[1] ?? 720 },
  };
}

function autoSpec(kind: "image" | "video"): BoardSizeSpec {
  const fallback =
    kind === "image" ? { width: 1024, height: 1024 } : { width: 832, height: 480 };
  return {
    mode: "auto",
    options: [],
    custom: false,
    step: 32,
    min: 256,
    max: kind === "image" ? 2048 : 1920,
    defaultId: SIZE_AUTO,
    fallback,
  };
}

/** 本地模型：图片按家族对齐像素，视频用 AI 视频页同一套「档位 × 画幅」。 */
function localSpec(kind: "image" | "video", family: string | null): BoardSizeSpec {
  if (kind === "image") {
    const step = imageModelSpec(family).multiple;
    return pixelsSpec(
      IMAGE_PIXELS.map(([width, height]) =>
        pixelOption(alignImageSize(width, step), alignImageSize(height, step)),
      ),
      { step, max: 2048, defaultId: "1024x1024", fallback: { width: 1024, height: 1024 } },
    );
  }
  const options: BoardSizeOption[] = [];
  for (const tier of VIDEO_RESOLUTIONS) {
    for (const aspect of VIDEO_ASPECTS) {
      const size = tier.sizes[aspect.id];
      if (!size) continue;
      options.push({
        id: `${tier.id}-${aspect.id}`,
        label: `${tier.id} · ${aspect.id}`,
        hint: `${size.width} × ${size.height}`,
        width: size.width,
        height: size.height,
        ratio: aspect.ratio,
      });
    }
  }
  return pixelsSpec(options, {
    step: 32,
    max: 1920,
    defaultId: "480p-16:9",
    fallback: { width: 864, height: 480 },
  });
}

function cloudImageSpec(providerKind: CloudGenKind, cloudModel: string | null): BoardSizeSpec {
  switch (providerKind) {
    case "openai": {
      const model = (cloudModel ?? "").toLowerCase();
      // DALL·E-3 / GPT-image 只认这几个官方尺寸，后端也会再映射一次。
      if (model.includes("dall-e-3")) {
        return fixedImageSizes([
          [1024, 1024],
          [1792, 1024],
          [1024, 1792],
        ]);
      }
      if (model.includes("gpt-image")) {
        return fixedImageSizes([
          [1024, 1024],
          [1536, 1024],
          [1024, 1536],
        ]);
      }
      return pixelsSpec(IMAGE_PIXELS.map(([width, height]) => pixelOption(width, height)), {
        step: 16,
        max: 2048,
        defaultId: "1024x1024",
      });
    }
    case "gemini":
    case "stability":
    case "kling":
    case "minimax":
    case "openrouter":
      // 只吃 aspect_ratio，宽高由后端换算成最接近的一档比例。
      return aspectImageSpec();
    case "siliconflow":
      // 接口有白名单，按比例映射到允许的五档。
      return fixedImageSizes([
        [1024, 1024],
        [1280, 960],
        [960, 1280],
        [1024, 768],
        [768, 1024],
      ]);
    case "bfl":
      // FLUX API 允许任意宽高（256–1440，32 对齐）。
      return pixelsSpec(IMAGE_PIXELS.map(([width, height]) => pixelOption(width, height)), {
        step: 32,
        max: 1440,
        defaultId: "1024x1024",
      });
    case "dashscope":
    case "ark":
      // 百炼 / 方舟收 `宽*高` 字符串，常用的 1K / 1.5K 几档 + 自定义。
      return pixelsSpec(
        [...IMAGE_PIXELS, [1536, 1024] as [number, number], [1024, 1536] as [number, number]].map(
          ([width, height]) => pixelOption(width, height),
        ),
        { step: 32, max: 2048, defaultId: "1024x1024", fallback: { width: 1024, height: 1024 } },
      );
    case "replicate":
    case "fal":
      // 这两个聚合站的图片接口不收尺寸，输出由模型决定。
      return autoSpec("image");
    default:
      return pixelsSpec(IMAGE_PIXELS.map(([width, height]) => pixelOption(width, height)), {
        step: 32,
        max: 2048,
        defaultId: "1024x1024",
      });
  }
}

function arkVideoSpec(): BoardSizeSpec {
  const options: BoardSizeOption[] = [];
  for (const tier of ARK_TIERS) {
    for (const aspect of VIDEO_ASPECT_ORDER) {
      const size = tier.sizes[aspect];
      if (!size) continue;
      options.push({
        id: `${tier.id}-${aspect}`,
        label: `${tier.label} · ${aspect}`,
        hint: `${size.width} × ${size.height}`,
        width: size.width,
        height: size.height,
        ratio: size.width / size.height,
        tier: tier.id,
      });
    }
  }
  return {
    mode: "tier",
    options,
    custom: false,
    step: 32,
    min: 256,
    max: 2048,
    defaultId: "720p-16:9",
    fallback: { width: 1280, height: 720 },
  };
}

/** MiniMax 视频只吃分辨率档，比例由输入素材 / 服务决定。 */
function minimaxVideoSpec(): BoardSizeSpec {
  return {
    mode: "tier",
    options: [
      {
        id: "720p",
        label: "720P",
        hint: "1280 × 720",
        width: 1280,
        height: 720,
        ratio: 16 / 9,
        tier: "720p",
      },
      {
        id: "1080p",
        label: "1080P",
        hint: "1920 × 1080",
        width: 1920,
        height: 1080,
        ratio: 16 / 9,
        tier: "1080p",
      },
    ],
    custom: false,
    step: 32,
    min: 256,
    max: 1920,
    defaultId: "1080p",
    fallback: { width: 1280, height: 720 },
  };
}

function cloudVideoSpec(providerKind: CloudGenKind, cloudModel: string | null): BoardSizeSpec {
  switch (providerKind) {
    case "gemini":
      // Veo 只出横屏 / 竖屏。
      return aspectVideoSpec(["16:9", "9:16"]);
    case "kling":
    case "luma":
    case "fal":
      return aspectVideoSpec(["16:9", "9:16", "1:1"]);
    case "runway":
      // Runway 的 ratio 字段是固定几档像素比例，这里直接给它认识的三档。
      return fixedVideoSizes([
        [1280, 720],
        [720, 1280],
        [960, 960],
      ]);
    case "dashscope":
    case "siliconflow":
      // 百炼 / SiliconFlow 视频只接受固定三档尺寸。
      return fixedVideoSizes([
        [1280, 720],
        [720, 1280],
        [960, 960],
      ]);
    case "ark":
      return arkVideoSpec();
    case "minimax":
      // H3 参考模型的比例是 adaptive，分辨率由服务固定 768P；其余模型可选档位。
      return cloudModel && /h3/i.test(cloudModel) ? autoSpec("video") : minimaxVideoSpec();
    case "replicate":
      return autoSpec("video");
    default:
      return localSpec("video", null);
  }
}

/** 按当前节点选中的模型算出一份分辨率规格。 */
export function boardSizeSpec(input: BoardSizeInput): BoardSizeSpec {
  const kind = input.kind;
  const model = splitModel(input.model);
  const cloud = model?.kind === "cloud" || Boolean(input.providerKind);
  if (!cloud) return localSpec(kind, input.family ?? null);
  if (!input.providerKind) {
    // 云端服务列表还没加载：先给一份通用的像素预设，加载完会自动重算。
    return localSpec(kind, null);
  }
  return kind === "image"
    ? cloudImageSpec(input.providerKind, input.cloudModel ?? null)
    : cloudVideoSpec(input.providerKind, input.cloudModel ?? null);
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** 最近的一档（按比例距离），找不到返回 null。 */
export function nearestSizeOption(
  spec: BoardSizeSpec,
  width: number,
  height: number,
): BoardSizeOption | null {
  if (spec.options.length === 0 || width <= 0 || height <= 0) return null;
  const target = Math.log(width / height);
  let best: BoardSizeOption | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const option of spec.options) {
    const value = Math.abs(Math.log(option.width / option.height) - target);
    if (value < distance) {
      distance = value;
      best = option;
    }
  }
  return best;
}

/**
 * 当前应该高亮的选项 id。
 *
 * 旧文档只有 `width` / `height`：像素完全对得上某一档就用那一档，对不上且允许
 * 自定义就进「自定义」，保留用户原来的尺寸；比例 / 白名单型的服务没法保留像素，
 * 落到比例最接近的一档。
 */
export function boardSizeValue(
  spec: BoardSizeSpec,
  params: Record<string, unknown>,
): string {
  if (spec.mode === "auto") return SIZE_AUTO;
  const raw = typeof params.size === "string" ? params.size.trim() : "";
  const width = numberOrNull(params.width);
  const height = numberOrNull(params.height);

  if (raw === SIZE_CUSTOM) return spec.custom ? SIZE_CUSTOM : spec.defaultId;
  if (raw && spec.options.some((option) => option.id === raw)) return raw;

  if (width !== null && height !== null) {
    const exact = spec.options.find(
      (option) => option.width === width && option.height === height,
    );
    if (exact) return exact.id;
    if (!raw && spec.custom) return SIZE_CUSTOM;
    // 档位型服务以前没有这个选项（后端写死默认档）：旧文档直接落到默认档。
    if (!raw && spec.mode === "tier") return spec.defaultId;
    const nearest = nearestSizeOption(spec, width, height);
    if (nearest) return nearest.id;
  }

  // 新节点什么参数都没有：落到缺省档（自定义只有用户明确选了、或旧文档带宽高时才进入）。
  return spec.defaultId;
}

function alignSize(value: number, spec: BoardSizeSpec): number {
  const step = Math.max(1, Math.round(spec.step));
  const clamped = Math.min(spec.max, Math.max(spec.min, Math.round(value)));
  return Math.min(spec.max, Math.ceil(clamped / step) * step);
}

/** 传给生成接口的宽高（像素模式按对齐单位取整）。 */
export function boardSizePixels(
  spec: BoardSizeSpec,
  params: Record<string, unknown>,
): { width: number; height: number } {
  if (spec.mode === "auto") return { ...spec.fallback };
  const id = boardSizeValue(spec, params);
  if (id === SIZE_CUSTOM) {
    const width = numberOrNull(params.width) ?? spec.fallback.width;
    const height = numberOrNull(params.height) ?? spec.fallback.height;
    return { width: alignSize(width, spec), height: alignSize(height, spec) };
  }
  const option =
    spec.options.find((item) => item.id === id) ??
    spec.options.find((item) => item.id === spec.defaultId) ??
    spec.options[0];
  if (!option) return { ...spec.fallback };
  if (spec.mode === "pixels") {
    return { width: alignSize(option.width, spec), height: alignSize(option.height, spec) };
  }
  return { width: option.width, height: option.height };
}

/** 选中某一档时要写回哪些参数（同时写 width / height，旧代码和导出都能读）。 */
export function boardSizePatch(
  spec: BoardSizeSpec,
  params: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  if (id === SIZE_AUTO) return {};
  if (id === SIZE_CUSTOM) {
    const raw = typeof params.size === "string" ? params.size.trim() : "";
    const width = numberOrNull(params.width);
    const height = numberOrNull(params.height);
    // 从别的模型切过来时 raw 可能不存在于当前选项：按旧宽高取最接近的一档做起点。
    const previous =
      spec.options.find((option) => option.id === raw) ??
      (width !== null && height !== null ? nearestSizeOption(spec, width, height) : null);
    return {
      size: SIZE_CUSTOM,
      width: previous?.width ?? width ?? spec.fallback.width,
      height: previous?.height ?? height ?? spec.fallback.height,
    };
  }
  const option =
    spec.options.find((item) => item.id === id) ??
    spec.options.find((item) => item.id === spec.defaultId) ??
    spec.options[0];
  if (!option) return {};
  return { size: option.id, width: option.width, height: option.height };
}

/** `tier` 模式发给后端的档位 id；其它模式返回 null。 */
export function boardSizeTier(
  spec: BoardSizeSpec,
  params: Record<string, unknown>,
): string | null {
  if (spec.mode !== "tier") return null;
  const id = boardSizeValue(spec, params);
  return spec.options.find((option) => option.id === id)?.tier ?? null;
}
