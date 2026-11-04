/** 视频生成（stable-diffusion.cpp）：请求、进度、结果与各家族的生成规格。 */

export interface VideoGenRequest {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  seconds?: number;
  frames?: number;
  steps: number;
  seed: number;
  cfgScale: number;
  flowShift: number;
  offloadToCpu?: boolean;
  vaeTiling?: boolean;
  /** 首帧参考图（绝对路径）：支持 I2V 的家族会把它接到 `--init-img`。 */
  initImage?: string | null;
  /** 尾帧参考图（绝对路径）：首尾帧家族接到 `--end-img`，必须同时给首帧。 */
  endImage?: string | null;
  /** 参考图（可多张）：MiniMax-H3 Ref2VA 接到 `-r`，按顺序对应 `<Picture N>`。 */
  refImages?: string[];
  /** 参考音频（可多条）：MiniMax-H3 Ref2VA 接到 `--ref-audio`。 */
  refAudios?: string[];
}

export interface VideoGenProgress {
  state: "preparing" | "running" | "done" | "error" | "cancelled";
  message: string | null;
  /** 0..1；没有可解析的 step 时是 0。 */
  progress: number;
  elapsed: number;
  step?: number | null;
  totalSteps?: number | null;
}

export interface VideoGenResult {
  path: string;
  duration: number;
  width: number;
  height: number;
  frames: number;
}

export const EVENT_VIDEO_GEN = "video-gen-progress";

/**
 * 帧率 / 帧数网格：不同模型家族不一样（Rust 侧 `VideoSpec` 是同一套规则）。
 * 帧数必须落在 `k * step + offset` 上，否则 sd.cpp 的 latent 帧数对不上。
 */
export interface VideoFrameSpec {
  fps: number;
  step: number;
  offset: number;
  maxFrames: number;
}

/** 一个家族的完整规格：帧数网格 + 界面默认参数。 */
export interface VideoModelSpec extends VideoFrameSpec {
  /** 单段建议帧数（超过就提示分段生成）。 */
  softFrames: number;
  /** 官方建议的采样步数。 */
  steps: number;
  /** 官方建议的 CFG。 */
  cfg: number;
  /** 官方建议的 flow shift；`null` = 该家族不用（界面隐藏，也不传给 sd-cli）。 */
  flowShift: number | null;
  /** 是否连音频一起生成。 */
  audio: boolean;
  /** 是否支持首帧参考图（I2V）。 */
  initImage: boolean;
  /** 是否支持尾帧参考图（首尾帧 / FLF2V）。 */
  endImage: boolean;
  /** 是否支持参考图（`-r`，Ref2VA）。 */
  refImage: boolean;
  /** 是否支持参考音频（`--ref-audio`，Ref2VA）。 */
  refAudio: boolean;
}

/**
 * 家族 → 规格。顺序与 `src-tauri/src/models.rs` 的清单一致（体积从轻到重）：
 * - `wan21_t2v`：Wan2.1 T2V 1.3B，16 fps、`4k+1`、无音频；
 * - `wan22_ti2v`：Wan2.2 TI2V 5B，24 fps、`4k+1`、无音频；
 * - `wan22_t2v_a14b`：Wan2.2 T2V A14B 双专家，16 fps、`4k+1`、无音频；
 * - `hunyuan_video_15`：HunyuanVideo 1.5，24 fps、`4k+1`、无音频；
 * - `ltx_23`：LTX-2.3，24 fps、`8k+1`、有音频；
 * - `minimax_h3`：MiniMax-H3 FL2VA，24 fps、`17k+5`、有音频、首帧 / 尾帧；
 * - `minimax_h3_ref2va`：MiniMax-H3 Ref2VA，同 H3 网格，但只吃参考图 / 参考音频；
 * - `ltx_25`：LTX-2.5，24 fps、`8k+1`、有音频。
 */
const SPECS: Record<string, VideoModelSpec> = {
  wan21_t2v: {
    fps: 16,
    step: 4,
    offset: 1,
    maxFrames: 161,
    softFrames: 81,
    steps: 20,
    cfg: 6,
    flowShift: 3,
    audio: false,
    initImage: false,
    endImage: false,
    refImage: false,
    refAudio: false,
  },
  wan22_ti2v: {
    fps: 24,
    step: 4,
    offset: 1,
    maxFrames: 121,
    softFrames: 121,
    steps: 20,
    cfg: 6,
    flowShift: 3,
    audio: false,
    initImage: true,
    endImage: false,
    refImage: false,
    refAudio: false,
  },
  wan22_t2v_a14b: {
    fps: 16,
    step: 4,
    offset: 1,
    maxFrames: 81,
    softFrames: 81,
    steps: 10,
    cfg: 3.5,
    flowShift: 3,
    audio: false,
    initImage: false,
    endImage: false,
    refImage: false,
    refAudio: false,
  },
  hunyuan_video_15: {
    fps: 24,
    step: 4,
    offset: 1,
    maxFrames: 121,
    softFrames: 121,
    steps: 20,
    cfg: 6,
    flowShift: null,
    audio: false,
    initImage: false,
    endImage: false,
    refImage: false,
    refAudio: false,
  },
  ltx_23: {
    fps: 24,
    step: 8,
    offset: 1,
    maxFrames: 121,
    softFrames: 121,
    steps: 20,
    cfg: 6,
    flowShift: null,
    audio: true,
    initImage: true,
    endImage: true,
    refImage: false,
    refAudio: false,
  },
  minimax_h3: {
    fps: 24,
    step: 17,
    offset: 5,
    maxFrames: 360,
    softFrames: 175,
    steps: 6,
    cfg: 1,
    flowShift: 12,
    audio: true,
    initImage: true,
    endImage: true,
    refImage: false,
    refAudio: false,
  },
  minimax_h3_ref2va: {
    fps: 24,
    step: 17,
    offset: 5,
    maxFrames: 360,
    softFrames: 175,
    steps: 6,
    cfg: 1,
    flowShift: 12,
    audio: true,
    initImage: false,
    endImage: false,
    refImage: true,
    refAudio: true,
  },
  ltx_25: {
    fps: 24,
    step: 8,
    offset: 1,
    maxFrames: 121,
    softFrames: 121,
    steps: 20,
    cfg: 6,
    flowShift: null,
    audio: true,
    initImage: true,
    endImage: true,
    refImage: false,
    refAudio: false,
  },
};

/** 未知家族按 H3 处理（清单里最后、也是规格最宽松的一个）。 */
export const DEFAULT_VIDEO_SPEC: VideoModelSpec = SPECS.minimax_h3;

/** 按模型家族取完整规格。 */
export function videoModelSpec(family: string | null | undefined): VideoModelSpec {
  return (family && SPECS[family]) || DEFAULT_VIDEO_SPEC;
}

/** 只取帧率 / 帧数网格。 */
export function videoFrameSpec(family: string | null | undefined): VideoFrameSpec {
  return videoModelSpec(family);
}

/** 帧数对齐到网格（向上取整，且不小于 offset）。 */
export function alignFrames(
  frames: number,
  spec: VideoFrameSpec = DEFAULT_VIDEO_SPEC,
): number {
  const value = Math.max(spec.offset, Math.round(frames));
  const remainder = (value - spec.offset) % spec.step;
  return remainder === 0 ? value : value + spec.step - remainder;
}

/** 秒数 → 网格帧数（H3 的 10 秒 = 243 帧 = 10.125s）。 */
export function framesForSeconds(
  seconds: number,
  spec: VideoFrameSpec = DEFAULT_VIDEO_SPEC,
): number {
  return Math.min(spec.maxFrames, alignFrames(Math.max(0, seconds) * spec.fps, spec));
}

/** 画幅：横屏 / 竖屏 / 方形。 */
export type VideoAspect = "16:9" | "9:16" | "1:1";

export interface VideoSize {
  width: number;
  height: number;
}

export interface VideoResolutionTier {
  id: string;
  label: string;
  sizes: Record<VideoAspect, VideoSize>;
}

/** 画幅选项（`ratio` 用于下拉框里的比例预览图标）。 */
export const VIDEO_ASPECTS: { id: VideoAspect; label: string; ratio: number }[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
];

/**
 * 分辨率档 × 画幅。宽高全部对齐到 32 的倍数：
 * H3 是硬约束（向上对齐 32），Wan / LTX 只要求 16 的倍数，32 自然也满足。
 * 720p 横屏沿用原来的 1280×736（720 不是 32 的倍数，向上取到 736）。
 */
export const VIDEO_RESOLUTIONS: VideoResolutionTier[] = [
  {
    id: "360p",
    label: "360p",
    sizes: {
      "16:9": { width: 608, height: 352 },
      "9:16": { width: 352, height: 608 },
      "1:1": { width: 512, height: 512 },
    },
  },
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
      "16:9": { width: 1280, height: 736 },
      "9:16": { width: 736, height: 1280 },
      "1:1": { width: 960, height: 960 },
    },
  },
];

/** 取一档分辨率 + 画幅对应的实际像素尺寸。 */
export function videoResolution(
  resolutionId: string,
  aspect: VideoAspect,
): { tier: VideoResolutionTier; size: VideoSize } {
  const tier =
    VIDEO_RESOLUTIONS.find((item) => item.id === resolutionId) ?? VIDEO_RESOLUTIONS[1];
  return { tier, size: tier.sizes[aspect] ?? tier.sizes["16:9"] };
}

/** 按工程宽高猜一个最接近的画幅，作为视频生成页的默认值。 */
export function aspectFromSize(width?: number | null, height?: number | null): VideoAspect {
  if (!width || !height || width <= 0 || height <= 0) return "16:9";
  const ratio = width / height;
  if (ratio < 0.8) return "9:16";
  if (ratio < 1.25) return "1:1";
  return "16:9";
}
