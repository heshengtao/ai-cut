/** 本地 AI 模型与字幕 / 朗读的前后端协议。 */

export type ModelFamily =
  | "whisper"
  | "paraformer"
  | "sense_voice"
  | "vad"
  | "moss_tts_nano"
  | "moss_audio_tokenizer_nano"
  | "zipvoice"
  | "localvqe"
  | "htdemucs"
  | "htdemucs6s"
  | "uvr"
  | "rife"
  | "real_esrgan_general"
  | "real_esrgan_x4plus"
  | "yolox_nano"
  | "yunet"
  | "qwen3_aligner";
export type ModelFeature =
  | "asr"
  | "vad"
  | "tts"
  | "tts-codec"
  | "enhance"
  | "separate"
  | "interpolate"
  | "superres"
  | "track"
  | "reframe"
  | "align";
export type ModelTag = "text" | "audio" | "visual";
export type ModelRegion = "intl" | "cn";
/** 模型下载源区域偏好。 */
export type ModelSourcePreference = "auto" | "international" | "domestic";

export interface ModelSourceConfig {
  preference: ModelSourcePreference;
  mirrors: string[];
  download_prefix: string;
}

export interface ModelFileStatus {
  filename: string;
  approx_bytes: number;
  installed: boolean;
  bytes: number | null;
}

export interface ModelSourceStatus {
  kind: string;
  region: ModelRegion;
  url: string;
}

export interface ModelStatus {
  id: string;
  name: string;
  feature: ModelFeature;
  tag: ModelTag;
  license: string;
  family: ModelFamily;
  approx_bytes: number;
  /** 是否为默认推荐模型（界面上默认选中并排在最前）。 */
  recommended: boolean;
  bundled: boolean;
  bundle_eligible: boolean;
  installed: boolean;
  path: string | null;
  total_files: number;
  installed_files: number;
  /** 覆盖的区域：`["cn"]` / `["cn","intl"]`。 */
  regions: ModelRegion[];
  /** 全部官方源（界面显示「魔搭 + HuggingFace」，悬停看 URL）。 */
  sources: ModelSourceStatus[];
  files: ModelFileStatus[];
}

export interface ModelProgress {
  id: string;
  state: "downloading" | "done" | "error";
  received: number;
  total: number;
  message: string | null;
  /** 当前正在尝试的下载地址（镜像 / 官方源）。 */
  source: string | null;
  /** `hf` / `modelscope` / `github` / `mirror`。 */
  source_kind: string | null;
  region: ModelRegion | null;
}

export interface SourceProbe {
  kind: string;
  region: ModelRegion;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

export interface AsrProgress {
  state: "extracting" | "detecting" | "transcribing" | "done" | "error";
  progress: number;
  message: string | null;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** 识别出的一个词，时间是素材内秒。 */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

/** 剪口播用的转录结果：词表 + 时间戳是否可信。 */
export interface AsrTranscription {
  words: TranscriptWord[];
  /** `false` = 模型没给 token 时间戳，词时间按字数估算，只能粗剪。 */
  timed: boolean;
}

export interface TtsProgress {
  state: "loading" | "synthesizing" | "done" | "error";
  progress: number;
  message: string | null;
}

export interface TtsItem {
  /** 文字片段 id，后端原样回传。 */
  id: string;
  text: string;
}

export interface TtsAudio {
  id: string;
  path: string;
  duration: number;
}

export interface TtsVoice {
  id: string;
  name: string;
  group: string;
}

/** 云端 / 自定义 TTS 的接口类型。 */
export type CloudTtsKind =
  | "openai"
  | "elevenlabs"
  | "azure"
  | "google"
  | "baidu"
  | "minimax"
  | "volcengine"
  | "custom";

/** 一个已配置的 TTS 服务。字段按接口类型取用。 */
export interface CloudTtsProvider {
  id: string;
  name: string;
  kind: CloudTtsKind;
  enabled: boolean;
  base_url: string;
  api_key: string;
  api_secret: string;
  app_id: string;
  group_id: string;
  region: string;
  model: string;
  voice: string;
  format: string;
  speed: number;
  volume: number;
  pitch: number;
  /** 额外音色，换行 / 逗号分隔。 */
  voices: string;
  method: string;
  headers: string;
  body: string;
  audio_path: string;
}

export interface CloudTtsConfig {
  providers: CloudTtsProvider[];
}

export interface CloudTtsTest {
  path: string;
  duration: number;
}

export type AudioAiState =
  | "idle"
  | "extracting"
  | "processing"
  | "writing"
  | "done"
  | "error";

export interface AudioAiProgress {
  state: Exclude<AudioAiState, "idle">;
  progress: number;
  message: string | null;
}

/** 后端处理完成后落地的音频文件。 */
export interface AudioProcessed {
  path: string;
  duration: number;
}

/** 音源分离的一条分轨。 */
export interface AudioStem {
  name:
    | "drums"
    | "bass"
    | "other"
    | "vocals"
    | "guitar"
    | "piano"
    | "accompaniment";
  path: string;
  duration: number;
}

/** EBU R128 测量结果；静音时两项为 null。 */
export interface LoudnessReport {
  integrated_lufs: number | null;
  true_peak_dbtp: number | null;
}

/** 无模型 DSP：快速降噪 / 人声美化。 */
export type AudioDspEffect = "denoise" | "beautify";
export type AudioDspPreset = "light" | "medium" | "strong" | "natural" | "bright" | "warm";

export const EVENT_MODEL = "model-progress";
export const EVENT_ASR = "asr-progress";
export const EVENT_TTS = "tts-progress";
export const EVENT_AUDIO_AI = "audio-ai-progress";
