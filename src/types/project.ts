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
  /** 所属场次 id；由 film manifest 导入时写入，用于幂等重导入。 */
  sceneId?: string;
  trackId: string;
  /** 时间线起点（秒）。 */
  start: number;
  /** 时长（秒），出点 = in + duration。 */
  duration: number;
  /** 素材入点（秒）。 */
  in: number;
  /** 播放速度，默认 1；0.1–4。时间线时长 × 速度 = 素材消耗量。 */
  speed?: number;
  /** 调色参数。 */
  color?: ClipColor;
  /** OFX 效果链，按数组顺序执行。 */
  effects?: ClipEffect[];
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  keyframes?: ClipKeyframes;
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

export type KeyframeProperty = "opacity" | "x" | "y" | "scale" | "rotation";

/**
 * 关键帧：某一瞬间记录全部可动画参数。
 *
 * 时间相对片段起点（秒）；相邻关键帧之间按属性线性插值。
 */
export interface Keyframe {
  time: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** 片段的关键帧列表，按 time 升序。 */
export type ClipKeyframes = Keyframe[];

export type ClipTransitionType = "fade" | "slide" | "ofx";
export type ClipTransitionDirection = "left" | "right" | "up" | "down";

/**
 * 片段入/出转场；duration 以时间线秒为单位。
 *
 * `ofx` 转场以切点为中心，向前后两个片段各借用 duration/2 的 handle，
 * 由 `effect` 指定的 OpenFX transition 插件合成两路画面。
 */
export interface ClipTransition {
  type: ClipTransitionType;
  duration: number;
  direction?: ClipTransitionDirection;
  /** 仅 type === "ofx" 时存在。 */
  effect?: ClipEffect;
}

/** 应用到片段画面上的 OFX 效果。 */
export interface ClipEffect {
  /** 同一次「应用到选中片段」共用同一个 id，便于多选时匹配。 */
  id: string;
  /** OFX 插件标识（pluginIdentifier）。 */
  plugin: string;
  /** 插件显示名（缓存，便于离线展示）。 */
  name: string;
  /** 安装位置：.ofx.bundle 路径或 .ofx 文件路径。 */
  bundle: string;
  /** OFX context；缺省时由 host 选择。 */
  context?: string;
  /** 参数值，键是 OFX 脚本名。 */
  params: Record<string, number | boolean | string | number[]>;
  /** 关闭后保留参数但不参与预览 / 导出。 */
  enabled?: boolean;
}

/** 片段调色；缺省值分别是 0 / 1 / 1 / 0 / 0。 */
export interface ClipColor {
  /** -1..1，0 为原始亮度。 */
  brightness?: number;
  /** 0..2，1 为原始对比度。 */
  contrast?: number;
  /** 0..3，1 为原始饱和度。 */
  saturation?: number;
  /** -1..1，负值偏冷、正值偏暖。 */
  temperature?: number;
  /** -1..1，负值偏绿、正值偏洋红。 */
  tint?: number;
}

/** 标记类型：场次边界、穿越/切点、审片批注、普通章节。 */
export type MarkerKind = "scene" | "hit" | "review" | "chapter";

/** 审片意见的严重程度。 */
export type ReviewSeverity = "blocker" | "high" | "medium" | "low";

/** 归一化到画面 0..1 的批注框。 */
export interface ReviewBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 时间线标记：用于定位、章节与审片批注。 */
export interface Marker {
  id: string;
  /** 时间线时间（秒）。 */
  time: number;
  name: string;
  /** 可选颜色（#rrggbb）。 */
  color?: string;
  /** 标记类型；缺省时按是否有 note 推断（不写回文档）。 */
  kind?: MarkerKind;
  /** 所属场次 id（film manifest 的 scene.id）。 */
  sceneId?: string;
  /** 审片备注正文。 */
  note?: string;
  severity?: ReviewSeverity;
  resolved?: boolean;
  bbox?: ReviewBBox;
  /** 审片截图（绝对路径或相对 manifest 的路径）。 */
  screenshot?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

/** 剪口类别。`manual` 是用户在文稿里自己拖选剪掉的。 */
export type CutKind = "filler" | "pause" | "retake" | "manual";

/**
 * 一条剪口：素材内时间的一段。
 *
 * 剪口是「剪口播」的真相：时间线上的片段是它投影出来的结果，删掉这条记录就还原。
 * 源时间是素材自己的时钟，片段被移动、变速都不影响它。
 */
export interface CutRecord {
  id: string;
  /** 素材内起点（秒）。 */
  srcStart: number;
  /** 素材内终点（秒）。 */
  srcEnd: number;
  kind: CutKind;
  /** 被剪掉的原文，只用于审查面板展示；词表才是真相。 */
  text: string;
  createdAt: number;
}

/**
 * 一组剪口：一段连续的口播素材 + 它当前投影出的片段。
 *
 * `baseIn..baseOut` 是这组剪口负责的素材范围，`baseStart` 是它在时间线上的起点。
 * 每次增删剪口都按这三个值重新投影，所以还原、改范围都不依赖「删之前长什么样」。
 */
export interface CutScope {
  id: string;
  assetId: string;
  trackId: string;
  /** 素材内起点（秒）。 */
  baseIn: number;
  /** 素材内终点（秒）。 */
  baseOut: number;
  /** 时间线起点（秒）。 */
  baseStart: number;
  /** 重建片段时套用的属性模板（调色、特效、变速等）。 */
  template: Clip;
  /** 当前时间线上由这组剪口投影出的片段 id，按顺序。 */
  pieces: string[];
  cuts: CutRecord[];
  /**
   * 识别出的词表（素材内秒）。存进工程，重新打开后仍能逐字审查与还原；
   * 没有它就只剩时间轴上的剪口标记。
   */
  words?: { text: string; start: number; end: number }[];
  /** 词时间是否来自模型 token 时间戳；缺省按 `true` 处理。 */
  timed?: boolean;
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
  markers: Marker[];
  /** 剪口组。缺省表示这个工程没剪过口播。 */
  cutScopes?: CutScope[];
}

/** 当前工程文档版本。 */
export const PROJECT_VERSION = 1;

/** 历史工程卡片：当前工程被替换前留下的一份快照。 */
export interface ProjectHistoryEntry {
  id: string;
  name: string;
  /** 工程自身的创建时间（Unix 毫秒）；同一工程的多个版本共用。 */
  project_created_at?: number;
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
