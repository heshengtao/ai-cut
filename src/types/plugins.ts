/** OFX 插件注册表与安装状态的前后端协议。 */

export type PluginInstallKind = "archive" | "external" | "none";
export type PluginRegistrySource = "network" | "cache" | "stale-cache" | "bundled";

export interface PluginFile {
  url: string;
  sha256: string | null;
  size: number | null;
  systems: string[];
  arch: string[];
  contains: string[];
  install: "archive" | "external";
}

export interface PluginStatus {
  slug: string;
  name: string;
  vendor: string | null;
  version: string;
  description: string | null;
  homepage: string | null;
  source: string | null;
  license: string;
  redistributable: boolean;
  plugin_types: string[];
  contexts: string[];
  tags: string[];
  files: PluginFile[];
  installed: boolean;
  installed_version: string | null;
  installed_path: string | null;
  managed: boolean;
  external: boolean;
  compatible: boolean;
  incompatible_reason: string | null;
  install_kind: PluginInstallKind;
  download_size: number | null;
  update_available: boolean;
}

export interface RegistryResponse {
  source: PluginRegistrySource;
  fetched_at: number | null;
  plugins: PluginStatus[];
}

export interface PluginProgress {
  slug: string;
  phase: "downloading" | "extracting" | "installing" | "done" | "error";
  received: number;
  total: number;
  message: string | null;
}

export interface PluginRegistryConfig {
  url: string;
  mirrors: string[];
}

export const EVENT_PLUGIN = "plugin-progress";

// ---------------------------------------------------------------------------
// OFX host（探测 / 预览 / 烘焙）
// ---------------------------------------------------------------------------

/** OFX 烘焙（预览播放用）进度。 */
export interface OfxBakeProgress {
  /** 预览渲染时是片段 id；导出烘焙为空。 */
  id: string | null;
  phase: "rendering" | "done";
  done: number;
  total: number;
}

export const EVENT_OFX_BAKE = "ofx-bake-progress";

/** `ofx_probe` 返回的参数类型。 */
export type OfxParamType =
  | "integer"
  | "double"
  | "boolean"
  | "choice"
  | "strchoice"
  | "rgb"
  | "rgba"
  | "string"
  | "custom"
  | "bytes"
  | "group"
  | "page"
  | "pushbutton"
  | "double2d"
  | "double3d"
  | "integer2d"
  | "integer3d"
  | "unknown";

export type OfxParamValue = number | boolean | string | number[];

export interface OfxParamInfo {
  name: string;
  label: string;
  type: OfxParamType;
  hint: string;
  parent: string;
  secret: boolean;
  enabled: boolean;
  dimension: number;
  /** 取决于 type：数字 / 布尔 / 字符串 / 数字数组。 */
  default: OfxParamValue;
  min: number[] | null;
  max: number[] | null;
  displayMin: number[] | null;
  displayMax: number[] | null;
  increment: number[] | null;
  digits: number;
  choices: string[];
}

export interface OfxPluginInfo {
  identifier: string;
  name: string;
  label: string;
  grouping: string;
  version: string;
  pluginApi: string;
  apiVersion: number;
  versionMajor: number;
  versionMinor: number;
  context: string;
  contexts: string[];
  pixelDepths: string[];
  clips: string[];
  params: OfxParamInfo[];
}

export interface OfxFrame {
  width: number;
  height: number;
  pngBase64: string;
  elapsedMs: number;
}

export interface OfxEditorTarget {
  /** effect：片段效果；transition：片段边缘的 OFX 转场；plugin：只读默认参数。 */
  kind: "effect" | "transition" | "plugin";
  bundle: string;
  plugin: string;
  name?: string;
  clipId?: string;
  effectId?: string;
  edge?: "in" | "out";
  selectedClipIds?: string[];
}

export interface OfxEffectSpec {
  bundle: string;
  plugin: string;
  context?: string | null;
  params?: Record<string, OfxParamValue>;
}

/** 转场一侧的源：片段入点、时间线起点和完整素材时长（用于 handle 钳制）。 */
export interface OfxTransitionSource {
  source: string;
  sourceIn: number;
  start: number;
  /** 片段播放速度；源时间 = in + (t - start) * speed。 */
  speed: number;
  assetDuration: number;
  isImage: boolean;
}

export interface OfxBakeTransitionRequest {
  id?: string | null;
  preview?: boolean;
  bundle: string;
  plugin: string;
  context?: string | null;
  params?: Record<string, OfxParamValue> | null;
  from: OfxTransitionSource | null;
  to: OfxTransitionSource | null;
  start: number;
  duration: number;
  fps: number;
  width: number;
  height: number;
  fit?: "contain" | "cover" | "stretch" | null;
  output: string;
}

export interface OfxBakeImageRequest {
  id?: string | null;
  source: string;
  /** 图片没有时间轴；传 0 即可。 */
  time?: number;
  duration?: number;
  fps?: number;
  width: number;
  height: number;
  fit?: "contain" | "cover" | "stretch" | null;
  effects: OfxEffectSpec[];
  output: string;
}

export interface OfxBakeRequest {
  /** 任务 id：预览按片段 id 上报进度 / 取消；导出留空。 */
  id?: string | null;
  /** true：编码 H.264 供预览播放；false：ProRes 4444 供导出。 */
  preview?: boolean;
  source: string;
  sourceIn: number;
  duration: number;
  speed?: number;
  fps: number;
  width: number;
  height: number;
  isImage?: boolean;
  /** 完整素材时长；retimer 在素材末尾之后请求帧时用它钳制。 */
  sourceDuration?: number;
  fit?: "contain" | "cover" | "stretch" | null;
  fitAnchor?:
    | "top-left"
    | "top"
    | "top-right"
    | "left"
    | "center"
    | "right"
    | "bottom-left"
    | "bottom"
    | "bottom-right"
    | null;
  timeOffset?: number;
  effects: OfxEffectSpec[];
  output: string;
}
