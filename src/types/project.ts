/** AI Cut 的领域类型：工程文档及其组成部分。 */

/** 素材类型。 */
export type AssetKind = "video" | "audio" | "image";

/** 导入的素材：只记录源文件路径引用，不拷贝文件。 */
export interface MediaAsset {
  id: string;
  name: string;
  kind: AssetKind;
  /** 源文件绝对路径。 */
  src: string;
  /** 秒；图片为 0。 */
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  /** 缩略图缓存文件绝对路径（应用数据目录 cache/）。 */
  thumb?: string;
  /** 波形峰值 0..100。 */
  wave?: number[];
  /** 载入工程时源文件缺失。 */
  offline?: boolean;
  addedAt: number;
}

/** 画面变换：以画布中心为原点，位置用画布宽高的百分比表示。 */
export interface ClipTransform {
  /** 水平偏移（画布宽度的百分比）。 */
  x: number;
  /** 垂直偏移（画布高度的百分比）。 */
  y: number;
  /** 缩放，1 = 100%。 */
  scale: number;
  /** 旋转角度（度）。 */
  rotation: number;
}

/** 图层混合模式（与 CSS mix-blend-mode 同名）。 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "plus-lighter";

/** 文字水平对齐。 */
export type TextAlign = "left" | "center" | "right";

/**
 * 文字样式。
 *
 * `fontSize` / `letterSpacing` / `glowBlur` 以 1080p 工程为参照的像素值存储：
 * 预览与导出都会按实际画布高度等比换算，因此换分辨率后视觉比例不变。
 */
export interface ClipTextStyle {
  /** 字体 id（见 core/clipStyle 的 FONT_FAMILIES）。 */
  fontFamily: string;
  fontSize: number;
  color: string;
  letterSpacing: number;
  /** 行高倍数。 */
  lineHeight: number;
  align: TextAlign;
  backgroundEnabled: boolean;
  backgroundColor: string;
  /** 背景 alpha 0..1。 */
  backgroundOpacity: number;
  glowEnabled: boolean;
  glowColor: string;
  glowBlur: number;
  glowOpacity: number;
}

/** 描边（文字用 -webkit-text-stroke，图片 / 视频用外圈阴影近似）。 */
export interface ClipStroke {
  enabled: boolean;
  color: string;
  /** 工程像素。 */
  width: number;
}

/** 阴影（文字用 text-shadow，图片 / 视频用 box-shadow）。 */
export interface ClipShadow {
  enabled: boolean;
  color: string;
  /** alpha 0..1。 */
  opacity: number;
  /** 工程像素。 */
  blur: number;
  /** 工程像素。 */
  offsetX: number;
  /** 工程像素。 */
  offsetY: number;
}

/** 片段：对某素材某区间的引用，放在某轨道的某时刻。 */
export interface Clip {
  id: string;
  /** 文字片段为空串。 */
  assetId: string;
  trackId: string;
  /** 时间线起点（秒）。 */
  start: number;
  /** 时长（秒），出点 = in + duration。 */
  duration: number;
  /** 素材入点（秒）。 */
  in: number;
  /** 文字片段的文案。 */
  text?: string;
  /** 文字样式；缺省时使用默认样式。 */
  textStyle?: ClipTextStyle;
  /** 音量增益 dB，默认 0。 */
  gain?: number;
  /** 淡入时长（秒），默认 0。 */
  fadeIn?: number;
  /** 淡出时长（秒），默认 0。 */
  fadeOut?: number;
  /** 变调（半音），默认 0。范围 -12..12。 */
  pitch?: number;
  /** 立体声平衡 -1（全左）..1（全右），默认 0。 */
  pan?: number;
  /** 静音该片段的音频；画面仍然保留（视频片段处理后用它关掉原声）。 */
  muted?: boolean;
  /**
   * 从视频里分离出来的纯音频片段：仍引用原视频素材，但预览 / 导出都不再渲染画面。
   */
  audioOnly?: boolean;
  /** 不透明度 0..1，默认 1。 */
  opacity?: number;
  /** 画面变换；缺省时按默认位置/大小显示。 */
  transform?: ClipTransform;
  /** 图层混合模式，默认 normal。 */
  blendMode?: BlendMode;
  /** 描边；缺省时不描边（文字默认值见 core/clipStyle）。 */
  stroke?: ClipStroke;
  /** 阴影；缺省时不加阴影（文字默认带一层轻阴影）。 */
  shadow?: ClipShadow;
  /** 图片 / 视频圆角（工程像素）。 */
  cornerRadius?: number;
}

/** 轨道：所有轨道等价，可容纳任意类型的片段；轨内片段按 start 升序且互不重叠。 */
export interface Track {
  id: string;
  name: string;
  /** 仅影响声音。 */
  muted: boolean;
  /** 是否参与画面合成（视频/图片/文字）。 */
  visible: boolean;
  locked: boolean;
  clips: Clip[];
}

/** 工程文档，可直接序列化为 .json。 */
export interface Project {
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  fps: number;
  width: number;
  height: number;
  assets: MediaAsset[];
  tracks: Track[];
}

/** 当前工程文档版本。 */
export const PROJECT_VERSION = 1;

/** 历史工程卡片：当前工程被替换前留下的一份快照。 */
export interface ProjectHistoryEntry {
  id: string;
  name: string;
  /** 记录时间（Unix 毫秒）。 */
  saved_at: number;
  /** 当时的工程文件路径；未保存过为 null。 */
  path: string | null;
  /** 当时是否有未保存改动。 */
  dirty: boolean;
  /** 时间线长度（秒）。 */
  duration: number;
  /** 视频 / 图片素材的缩略图缓存路径。 */
  thumbnail: string | null;
  track_count: number;
  clip_count: number;
}
