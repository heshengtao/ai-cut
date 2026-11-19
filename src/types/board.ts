/**
 * 无限画布的数据结构（纯类型）。
 *
 * 画布文档存进工程 JSON 的 `project.board`（工程级共享，所有分P 共用）。
 * 放在 `types/` 里是为了让 `types/project.ts` 能引用它而不产生循环依赖。
 */
import type { AssetKind } from "@/types/project";
import type { BoardWorkflowSource } from "@/types/workflow";

export type { BoardWorkflowSource };

/**
 * 工具栏运行模式。
 *
 * - `manual`：点「运行」跑整个工作流（按依赖顺序跑一遍）；
 * - `always`：自动重跑——某个节点的输出更新后，自动运行它的下游节点；
 * - `repeat`：重复 N 次（模型节点重新生成）。
 */
export type BoardRunMode = "manual" | "always" | "repeat";

/**
 * 端口（连线）的语义类型。
 *
 * 内核只固定**传输通道**，语义类型由 `core/board/dataTypes.ts` 的注册表维护：
 * 内置类型见 `CoreDataType`，插件可以注册自己的类型（`DataTypeSpec.pluginId`），
 * 所以这里保持开放联合而不是枚举。
 */
export type CoreDataType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "number"
  | "boolean"
  | "json"
  | "any";

export type BoardPortType = CoreDataType | (string & {});

/**
 * 值的物理形态。
 *
 * - `inline`：小的 JSON 值（字符串 / 数字 / 布尔 / JSON 对象）；
 * - `blob`：大二进制，画布上只传引用（素材 id / URL）；
 * - `stream`：执行中分块产出（模型文本流）。
 */
export type ChannelKind = "inline" | "blob" | "stream";

/** 一个语义类型在注册表里的声明。 */
export interface DataTypeSpec {
  id: BoardPortType;
  /** 兜底标签；UI 优先用 i18n key `board.type.<id>`。 */
  label: string;
  /** 首选通道在前，后面的都是可接受通道。 */
  channels: ChannelKind[];
  mime?: string;
  /** 值输入节点用哪种编辑器（只有 inline 类型需要）。 */
  inline?: "text" | "number" | "boolean" | "json" | "color" | "url" | "none";
  /** 端口 / 值卡的主题色。 */
  color?: string;
  /** 不用显式转换就可以连通的其它类型（双向判定）。 */
  accepts?: BoardPortType[];
  /** 由插件注册的类型：卸载插件时一并注销。 */
  pluginId?: string;
}

/** 节点状态：运行中 / 完成 / 失败 / 上游变了（过期）。 */
export type BoardNodeStatus =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "error"
  | "stale"
  /** 旁路 / 被禁用的上游挡住：这次运行跳过了它。 */
  | "skipped";

/** 节点分类：输入 / 显示 / 模型 / 分组。 */
export type BoardCategory = "input" | "display" | "model" | "group";

/** 组节点的色调（对齐 ai-board 的 group tone）。 */
export type BoardGroupTone = "lavender" | "blue" | "green" | "coral" | "amber";

export const BOARD_GROUP_TONES: BoardGroupTone[] = [
  "lavender",
  "blue",
  "green",
  "coral",
  "amber",
];

/** 一个端口。 */
export interface BoardPortSpec {
  id: string;
  type: BoardPortType;
  labelKey: string;
  /**
   * 这个输入端口最多能接几个上游（缺省 1）。
   *
   * 同类型的多路参考合并成一个端口（例如 H3 的 9 张参考图 = 一个 `image`
   * 端口、max 9），节点 UI 上仍然只有一个输入锚点，具体选哪些上游在
   * 节点检查器里多选。
   */
  max?: number;
  /** 这个端口想强制走的通道；缺省用类型声明的首选通道。 */
  channel?: ChannelKind;
}

/**
 * 参数类型。`binding` 表示这个参数可以被上游连线绑定。
 *
 * `size` 是模型节点的输出分辨率：卡片和检查器都渲染成「分辨率」下拉，
 * 具体选项按当前模型 / 云端服务来（见 `core/board/size.ts`），值写回
 * `params.size` + `params.width` / `params.height`。
 */
export type BoardParamKind =
  | "text"
  | "longtext"
  | "number"
  | "select"
  | "toggle"
  | "seed"
  | "size"
  /** 插件提供的控件（`BoardParamSpec.control` 指向注册 id）。 */
  | "component";

export interface BoardParamSpec {
  id: string;
  labelKey: string;
  kind: BoardParamKind;
  /** `kind === "component"` 时生效：控件注册 id（见 `core/plugins/controls.ts`）。 */
  control?: string;
  /** `select` 的选项（值 + i18n key）。 */
  options?: { value: string; labelKey: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  /** 有值时表示该参数的输入端口类型，可被上游绑定。 */
  bind?: BoardPortType;
  /**
   * 动态模型下拉：本地模型按 `feature` 列（`models.byFeature`），
   * 云端服务按 `capability` 列（`providersForCapability`）。值形如 `local:<id>` / `cloud:<id>`。
   *
   * `cloud` 用来接**另一类**云端服务（语音合成 / 语音识别各有自己的配置和预设），
   * 它们不在图像 / 视频的 `cloud_gen` 里。
   */
  model?: { feature: string; capability?: string; cloud?: "tts" | "asr" };
  /**
   * 文本模型下拉：选项来自「设置 → 文本生成」里的供应商（值是 `<供应商 id>::<模型>`）。
   * 留空表示用配置里的默认模型。
   */
  llm?: boolean;
  /** 输入框占位文案的 i18n key（长文本参数用）。 */
  placeholderKey?: string;
  /** 检查器里字段下方的说明文案（可选）。 */
  hintKey?: string;
  /**
   * 只在检查器里出现的参数（流式输出 / 思考强度 / topP 这类高级项）。
   * 节点卡片只保留最常用的字段，避免卡片越堆越长。
   */
  inspectorOnly?: boolean;
  /**
   * 只在另一个参数等于某个值时才显示（例如「画面增强」的模型输入随处理方式切换）。
   * 隐藏的参数不渲染，但仍然可以被读取（运行时按当前逻辑取用）。
   */
  visibleWhen?: { param: string; equals: unknown };
}

/** 一个节点的静态定义（注册表项）。 */
export interface BoardNodeDefinition {
  type: string;
  titleKey: string;
  category: BoardCategory;
  /** 排序权重：输入在上、显示在下。 */
  order: number;
  inputs: BoardPortSpec[];
  outputs: BoardPortSpec[];
  params: BoardParamSpec[];
  defaultSize: { width: number; height: number };
  /** 图片 / 视频节点锁定素材比例（对齐 ai-board 的 `lockAspectRatio`）。 */
  lockAspectRatio?: boolean;
  /** 输入 / 显示节点的素材类型；模型节点为空。 */
  assetKind?: AssetKind;
  /** 是否在节点卡片底部展开实时输出（模型节点）。 */
  liveOutput?: boolean;
  /**
   * 调度声明：插件节点必须声明泳道，否则不参与运行（`nodeCost` 返回 null）。
   * 内置节点不填，仍走 `scheduler.ts` 里的既有估算。
   */
  cost?: { lane: "instant" | "api" | "gpu" | "cpu"; vramMb?: number; ramMb?: number };
}

/** 参数绑定到上游端口。 */
export interface BoardBinding {
  nodeId: string;
  portId: string;
}

/** 节点上的数据（用户可改的部分）。 */
export interface BoardNodeData {
  title?: string;
  params: Record<string, unknown>;
  bindings: Record<string, BoardBinding>;
  /**
   * 端口快照：插件节点在工程里存一份自己的端口定义。
   * 插件被卸载后仍能据此恢复端口与连线（`portsOf` 在定义缺失时回退到它）。
   */
  ports?: { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] };
  /** 输入 / 显示节点引用的素材。 */
  assetId?: string;
  /** 图片输入可以放多张（牌堆）；`assetId` 始终等于当前展示那张。 */
  assetIds?: string[];
  /** 牌堆当前展示的下标。 */
  stackIndex?: number;
  /** 最近一次运行的产物（素材 id，产物运行完自动入库）。 */
  outputAssetId?: string;
  /**
   * 最近一次运行的全部产物：`outputAssetId` 是其中「当前选中 / 对外发布」的那一个。
   * 音频分离的多条音轨、重复运行累积的结果都在这里，卡片下方的输出附件卡
   * 用它做多输出切换。
   */
  outputAssetIds?: string[];
  /**
   * 按**端口**发布的产物：`端口 id → 素材 id`。
   *
   * 单输出节点仍然只靠 `outputAssetId`；有多个输出端口的节点（音频分离的
   * 人声 / 鼓 / 贝斯…、视频音频分离的视频与音频）各端口各发各的，下游连到
   * 哪个端口就拿哪个端口的产物。
   */
  outputs?: Record<string, string>;
  /** 输出附件卡是否展开；未设置按展开处理，用户收起后记住。 */
  outputOpen?: boolean;
  status?: BoardNodeStatus;
  error?: string;
  /** 实时输出文本（模型节点的日志 / 文本结果）。 */
  outputText?: string;
  /**
   * 文本模型拆出来的「思考过程」（推理模型返回的 reasoning_content）。
   * 与 `outputText` 分开存，输出附件卡用两个 tab 展示。
   */
  outputReasoning?: string;
  /**
   * 值端口（`number` / `boolean` / `json` / 插件自定义 inline 类型）的产物：
   * `端口 id → JSON 值`。
   *
   * 素材仍然走 `outputAssetId`、文本仍然走 `outputText`——`values` 只承载
   * 这两者表达不了的值，避免把所有输出都塞成一个万能字符串。
   */
  values?: Record<string, unknown>;
  /**
   * 迭代节点的行状态：`行序号 → { status, error }`。
   * 只存状态，不存整行产物（产物在 `values.results` 里）。
   */
  rows?: Record<string, { status?: string; error?: string }>;
  /** 本次运行开始的时间戳（毫秒）；用于运行计时。 */
  startedAt?: number;
  /** 上一次运行的耗时（毫秒）；完成后用于节点角标。 */
  durationMs?: number;
  /** 0..1 进度。 */
  progress?: number;
  /**
   * 禁用（旧叫法「静音」）：跳过**这个节点以及它之后的所有节点**。
   * 下游拿不到输入，整条链这次都不跑。
   */
  ignored?: boolean;
  /**
   * 旁路：只跳过这一个节点。下游要它的输出时，改用它自己同类型的输入
   * （把它从链路里「摘出去」）；它没有同类型输入时下游拿到空值。
   */
  bypassed?: boolean;
  /** 组节点的成员 id；组节点本身不参与运行。 */
  children?: string[];
  /** 组节点的色调（仅组节点使用）。 */
  tone?: BoardGroupTone;
}

/** 画布上的一个节点。 */
export interface BoardNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  data: BoardNodeData;
}

/** 一条连线。 */
export interface BoardEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 画布文档。 */
export interface BoardDoc {
  version: 1;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: BoardViewport;
  updatedAt: number;
  /**
   * 这块画布来自工作流库的哪个工作流。
   *
   * 保存时据此判断是「同一个工作流的新版本」还是「从默认工作流改出来的新工作流」。
   * 旧文档没有这个字段，按「没有来源」处理（保存时创建新工作流）。
   */
  source?: BoardWorkflowSource;
}

export const BOARD_VERSION = 1;

export const DEFAULT_VIEWPORT: BoardViewport = { x: 0, y: 0, zoom: 1 };

