/**
 * 画布文档的归一化与端口兼容规则。
 *
 * 纯函数，不 import Vue / store —— domain 引擎也会打包它。
 */
import {
  BOARD_VERSION,
  DEFAULT_VIEWPORT,
  type BoardBinding,
  type BoardDoc,
  type BoardEdge,
  type BoardNode,
  type BoardNodeData,
  type BoardPortType,
  type BoardViewport,
} from "@/types/board";

/** 空画布文档。 */
export function emptyBoard(): BoardDoc {
  return {
    version: BOARD_VERSION,
    nodes: [],
    edges: [],
    viewport: { ...DEFAULT_VIEWPORT },
    updatedAt: Date.now(),
  };
}

const PORT_TYPES: BoardPortType[] = ["text", "image", "video", "audio", "any"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortType(value: unknown): value is BoardPortType {
  return typeof value === "string" && (PORT_TYPES as string[]).includes(value);
}

/** 归一化节点参数：只保留对象形态，缺省给空表。 */
function normalizeParams(raw: unknown): Record<string, unknown> {
  if (!isObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

/** 归一化绑定：丢掉形状不对的条目。 */
function normalizeBindings(raw: unknown): Record<string, BoardBinding> {
  if (!isObject(raw)) return {};
  const out: Record<string, BoardBinding> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    if (typeof value.nodeId !== "string" || typeof value.portId !== "string") continue;
    out[key] = { nodeId: value.nodeId, portId: value.portId };
  }
  return out;
}

function normalizeNode(raw: unknown): BoardNode | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string" || !raw.type) return null;
  const position = isObject(raw.position) ? raw.position : {};
  const x = typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0;
  const y = typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0;
  const rawData = isObject(raw.data) ? raw.data : {};
  const data: BoardNodeData = {
    params: normalizeParams(rawData.params),
    bindings: normalizeBindings(rawData.bindings),
  };
  if (typeof rawData.title === "string" && rawData.title) data.title = rawData.title;
  if (typeof rawData.assetId === "string" && rawData.assetId) data.assetId = rawData.assetId;
  if (typeof rawData.outputAssetId === "string" && rawData.outputAssetId) {
    data.outputAssetId = rawData.outputAssetId;
  }
  if (typeof rawData.outputText === "string" && rawData.outputText) data.outputText = rawData.outputText;
  if (typeof rawData.error === "string" && rawData.error) data.error = rawData.error;
  if (typeof rawData.progress === "number" && Number.isFinite(rawData.progress)) {
    data.progress = Math.max(0, Math.min(1, rawData.progress));
  }
  if (rawData.ignored === true) data.ignored = true;
  const status = rawData.status;
  if (
    status === "idle" ||
    status === "queued" ||
    status === "running" ||
    status === "done" ||
    status === "error" ||
    status === "stale"
  ) {
    data.status = status;
  }
  const node: BoardNode = { id: raw.id, type: raw.type, position: { x, y }, data };
  if (isObject(raw.size)) {
    const width = typeof raw.size.width === "number" ? raw.size.width : 0;
    const height = typeof raw.size.height === "number" ? raw.size.height : 0;
    if (width > 80 && height > 60) node.size = { width, height };
  }
  return node;
}

/**
 * 归一化画布文档。
 *
 * 坏条目直接丢掉；悬空连线（端点不存在 / 端口类型不对）也丢掉——坏画布不该把整份
 * 工程拖进不可打开的境地。
 */
export function normalizeBoard(raw: unknown, portTypeOf?: (nodeType: string, portId: string, side: "in" | "out") => BoardPortType | null): BoardDoc {
  if (!isObject(raw)) return emptyBoard();
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.map(normalizeNode).filter((node): node is BoardNode => node !== null)
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: BoardEdge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.edges)) {
    for (const item of raw.edges) {
      if (!isObject(item)) continue;
      const { id, source, sourcePort, target, targetPort } = item;
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      if (typeof source !== "string" || typeof target !== "string") continue;
      if (typeof sourcePort !== "string" || typeof targetPort !== "string") continue;
      if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
      if (source === target) continue;
      if (portTypeOf) {
        const from = portTypeOf(source, sourcePort, "out");
        const to = portTypeOf(target, targetPort, "in");
        if (!from || !to || !isPortType(from) || !isPortType(to)) continue;
      }
      seen.add(id);
      edges.push({ id, source, sourcePort, target, targetPort });
    }
  }
  const rawViewport = isObject(raw.viewport) ? raw.viewport : {};
  const zoom = typeof rawViewport.zoom === "number" && Number.isFinite(rawViewport.zoom)
    ? Math.min(2.2, Math.max(0.15, rawViewport.zoom))
    : 1;
  const viewport: BoardViewport = {
    x: typeof rawViewport.x === "number" && Number.isFinite(rawViewport.x) ? rawViewport.x : 0,
    y: typeof rawViewport.y === "number" && Number.isFinite(rawViewport.y) ? rawViewport.y : 0,
    zoom,
  };
  return {
    version: BOARD_VERSION,
    nodes,
    edges,
    viewport,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/** 端口类型兼容：`any` 对谁都能连。 */
export function portsCompatible(from: BoardPortType, to: BoardPortType): boolean {
  return from === "any" || to === "any" || from === to;
}
