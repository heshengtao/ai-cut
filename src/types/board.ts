/**
 * 无限画布的数据结构（纯类型）。
 *
 * 画布文档存进工程 JSON 的 `project.board`（工程级共享，所有分P 共用）。
 * 放在 `types/` 里是为了让 `types/project.ts` 能引用它而不产生循环依赖。
 */
import type { AssetKind } from "@/types/project";

/** 工具栏运行模式（ComfyUI 式）。 */
export type BoardRunMode = "manual" | "always" | "repeat" | "none";

/** 端口（连线）的语义类型。 */
export type BoardPortType = "text" | "image" | "video" | "audio" | "any";

/** 节点状态：运行中 / 完成 / 失败 / 上游变了（过期）。 */
export type BoardNodeStatus = "idle" | "queued" | "running" | "done" | "error" | "stale";

/** 节点分类：输入 / 显示 / 模型。 */
export type BoardCategory = "input" | "display" | "model";

/** 一个端口。 */
export interface BoardPortSpec {
  id: string;
  type: BoardPortType;
  labelKey: string;
}

/** 参数类型。`binding` 表示这个参数可以被上游连线绑定。 */
export type BoardParamKind = "text" | "longtext" | "number" | "select" | "toggle" | "seed";

export interface BoardParamSpec {
  id: string;
  labelKey: string;
  kind: BoardParamKind;
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
   */
  model?: { feature: string; capability?: string };
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
  /** 输入 / 显示节点的素材类型；模型节点为空。 */
  assetKind?: AssetKind;
  /** 是否在节点卡片底部展开实时输出（模型节点）。 */
  liveOutput?: boolean;
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
  /** 输入 / 显示节点引用的素材。 */
  assetId?: string;
  /** 最近一次运行的产物（素材 id，产物运行完自动入库）。 */
  outputAssetId?: string;
  status?: BoardNodeStatus;
  error?: string;
  /** 实时输出文本（模型节点的日志 / 文本结果）。 */
  outputText?: string;
  /** 0..1 进度。 */
  progress?: number;
  /** 静音：跳过执行。 */
  ignored?: boolean;
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
}

export const BOARD_VERSION = 1;

export const DEFAULT_VIEWPORT: BoardViewport = { x: 0, y: 0, zoom: 1 };

