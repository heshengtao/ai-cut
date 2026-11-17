/** 云端图像 / 视频生成：供应商、能力、请求与结果（与 Rust `cloud_gen.rs` 对齐）。 */

export type CloudGenKind =
  | "openai"
  | "gemini"
  | "stability"
  | "bfl"
  | "dashscope"
  | "ark"
  | "kling"
  | "minimax"
  | "runway"
  | "luma"
  | "replicate"
  | "fal"
  | "openrouter"
  | "siliconflow";

/** 图生图指「指令改图 / 参考图」；i2v 指视频首帧。 */
export type GenCapability = "t2i" | "i2i" | "t2v" | "i2v";

/** 一家已经配置好的云端生成服务（字段按需取用，与 TTS 的服务条目同一套形态）。 */
export interface CloudGenProvider {
  id: string;
  name: string;
  kind: CloudGenKind;
  enabled: boolean;
  base_url: string;
  api_key: string;
  /** 可灵这类 AK/SK 双密钥的服务用。 */
  api_secret: string;
  /** MiniMax 的 GroupId。 */
  group_id: string;
  image_model: string;
  edit_model: string;
  video_model: string;
  /** 覆盖默认能力；空数组 = 用该类型的默认值。 */
  capabilities: GenCapability[];
}

export interface CloudGenConfig {
  providers: CloudGenProvider[];
}

/** 新增服务时的预设（来自 Rust，避免两套默认值）。 */
export interface CloudGenPreset {
  kind: CloudGenKind;
  name: string;
  group: "official" | "aggregator";
  baseUrl: string;
  imageModel: string;
  editModel: string;
  videoModel: string;
  capabilities: GenCapability[];
}

export interface CloudImageRequest {
  providerId: string;
  mode: "draw" | "edit";
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  initImage?: string;
  /**
   * 额外参考图（本地文件路径）：支持多图编辑的服务（Gemini / GPT-Image /
   * Seedream 4 / Qwen-Image-Edit…）按顺序收，单图服务只用第一张。
   */
  refImages?: string[];
  /** 白色涂抹区域 + 透明背景的 PNG data URL；只有 OpenAI 编辑接口用得上。 */
  maskPng?: string;
  seed?: number;
}

export interface CloudVideoRequest {
  providerId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seconds: number;
  /**
   * 分辨率档（`480p` / `720p` / `1080p`）。
   *
   * 方舟 / MiniMax 这类接口不收像素宽高，只收档位；不传时后端沿用各自的
   * 默认档（方舟 720p、MiniMax 1080P）。宽高仍然会传，用来换算画幅比例。
   */
  resolution?: string;
  initImage?: string;
  /** 多模态参考（MiniMax H3）：本地文件路径，后端转 data URI 上传。 */
  refImages?: string[];
  refAudios?: string[];
  refVideos?: string[];
}

export interface CloudImageResult {
  path: string;
  width: number;
  height: number;
  provider: string;
  model: string;
}

export interface CloudVideoResult {
  path: string;
  width: number;
  height: number;
  duration: number;
  provider: string;
  model: string;
}

export interface CloudGenProgress {
  state: "preparing" | "running" | "done" | "error" | "cancelled";
  message: string | null;
  /** 0..1。 */
  progress: number;
  elapsed: number;
}

/** 设置页「测试」的产物：一张 512 的样张。 */
export interface CloudGenTest {
  path: string;
  width: number;
  height: number;
}

export const EVENT_CLOUD_GEN = "cloud-gen-progress";

/** 一家服务支持的能力（空 = 该类型的默认值）。 */
export function providerCapabilities(provider: CloudGenProvider): GenCapability[] {
  if (provider.capabilities.length > 0) return provider.capabilities;
  return [];
}
