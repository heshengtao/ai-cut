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
  type BoardPortSpec,
  type BoardPortType,
  type BoardViewport,
  type BoardWorkflowSource,
} from "@/types/board";
import { isDataTypeId, portsConnectable } from "./dataTypes";

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 端口类型现在来自注册表（内置 + 插件），所以只校验「id 写对了没有」。 */
function isPortType(value: unknown): value is BoardPortType {
  return isDataTypeId(value);
}

/**
 * 值产物的上限：值端口传的是小 JSON，超过这个大小的值视为坏数据丢掉。
 * 大数组 / 大文档该走 `blob`（引用）而不是往节点里塞。
 */
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_VALUE_DEPTH = 4;

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_VALUE_DEPTH) return false;
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

/** 值产物归一化：键必须是类型 id，值是 JSON，整块不超过上限。 */
function normalizeValues(raw: unknown): Record<string, unknown> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isDataTypeId(key)) continue;
    if (value === undefined) continue;
    if (!isJsonValue(value, 0)) continue;
    out[key] = value;
  }
  const keys = Object.keys(out);
  if (keys.length === 0) return undefined;
  let encoded = "";
  try {
    encoded = JSON.stringify(out);
  } catch {
    return undefined;
  }
  return encoded.length > MAX_VALUE_BYTES ? undefined : out;
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

/** 端口快照归一化：形状不对就整块丢掉，不猜。 */
function normalizePorts(
  raw: unknown,
): { inputs: BoardPortSpec[]; outputs: BoardPortSpec[] } | undefined {
  if (!isObject(raw)) return undefined;
  const inputs = normalizePortList(raw.inputs);
  const outputs = normalizePortList(raw.outputs);
  if (inputs === null || outputs === null) return undefined;
  return { inputs, outputs };
}

function normalizePortList(raw: unknown): BoardPortSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const list: BoardPortSpec[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    if (typeof item.id !== "string" || !item.id) return null;
    if (!isPortType(item.type)) return null;
    if (typeof item.labelKey !== "string") return null;
    list.push({
      id: item.id,
      type: item.type,
      labelKey: item.labelKey,
      ...(typeof item.max === "number" ? { max: item.max } : {}),
      ...(item.channel === "inline" || item.channel === "blob" || item.channel === "stream"
        ? { channel: item.channel }
        : {}),
    });
  }
  return list;
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
  const ports = normalizePorts(rawData.ports);
  if (ports) data.ports = ports;
  if (typeof rawData.title === "string" && rawData.title) data.title = rawData.title;
  if (typeof rawData.assetId === "string" && rawData.assetId) data.assetId = rawData.assetId;
  if (Array.isArray(rawData.items)) {
    const items = rawData.items
      .filter((item) => isJsonValue(item, 0))
      .slice(0, 200);
    if (items.length > 0) data.items = items;
  }
  if (Array.isArray(rawData.assetIds)) {
    const ids = rawData.assetIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (ids.length > 0) {
      data.assetIds = ids;
      if (!data.assetId) data.assetId = ids[0];
    }
  }
  if (typeof rawData.stackIndex === "number" && Number.isFinite(rawData.stackIndex)) {
    data.stackIndex = Math.max(0, Math.floor(rawData.stackIndex));
  }
  if (typeof rawData.outputAssetId === "string" && rawData.outputAssetId) {
    data.outputAssetId = rawData.outputAssetId;
  }
  const values = normalizeValues(rawData.values);
  if (values) data.values = values;
  if (Array.isArray(rawData.outputAssetIds)) {
    const ids = rawData.outputAssetIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (ids.length > 0) {
      data.outputAssetIds = [...new Set(ids)];
      // 当前发布的那一张必须还在列表里；旧文档没有这个字段时用第一张兜底。
      if (!data.outputAssetId || !data.outputAssetIds.includes(data.outputAssetId)) {
        data.outputAssetId = data.outputAssetIds[0];
      }
    }
  }
  if (isObject(rawData.outputs)) {
    const outputs: Record<string, string> = {};
    for (const [portId, assetId] of Object.entries(rawData.outputs)) {
      if (typeof assetId === "string" && assetId) outputs[portId] = assetId;
    }
    if (Object.keys(outputs).length > 0) data.outputs = outputs;
  }
  if (rawData.outputOpen === false) data.outputOpen = false;
  if (typeof rawData.outputText === "string" && rawData.outputText) data.outputText = rawData.outputText;
  if (typeof rawData.outputReasoning === "string" && rawData.outputReasoning) {
    data.outputReasoning = rawData.outputReasoning;
  }
  if (typeof rawData.startedAt === "number" && Number.isFinite(rawData.startedAt)) {
    data.startedAt = rawData.startedAt;
  }
  if (typeof rawData.durationMs === "number" && Number.isFinite(rawData.durationMs)) {
    data.durationMs = Math.max(0, rawData.durationMs);
  }
  if (typeof rawData.error === "string" && rawData.error) data.error = rawData.error;
  if (typeof rawData.progress === "number" && Number.isFinite(rawData.progress)) {
    data.progress = Math.max(0, Math.min(1, rawData.progress));
  }
  if (rawData.ignored === true) data.ignored = true;
  if (rawData.bypassed === true) data.bypassed = true;
  const tone = rawData.tone;
  if (
    tone === "lavender" ||
    tone === "blue" ||
    tone === "green" ||
    tone === "coral" ||
    tone === "amber"
  ) {
    data.tone = tone;
  }
  if (Array.isArray(rawData.children)) {
    const children = rawData.children.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (children.length > 0) data.children = [...new Set(children)];
  }
  const status = rawData.status;
  if (
    status === "idle" ||
    status === "queued" ||
    status === "running" ||
    status === "done" ||
    status === "error" ||
    status === "stale" ||
    status === "skipped"
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

/** 归一化工作流来源：只保留字符串 / 有限数字。 */
export function normalizeBoardSource(raw: unknown): BoardWorkflowSource | undefined {
  if (!isObject(raw)) return undefined;
  const source: BoardWorkflowSource = {};
  if (typeof raw.rootId === "string" && raw.rootId) source.rootId = raw.rootId;
  if (typeof raw.builtinId === "string" && raw.builtinId) source.builtinId = raw.builtinId;
  if (typeof raw.name === "string" && raw.name) source.name = raw.name;
  if (typeof raw.version === "number" && Number.isFinite(raw.version)) {
    source.version = Math.max(1, Math.floor(raw.version));
  }
  return Object.keys(source).length > 0 ? source : undefined;
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
      const kind = item.kind === "pair" ? ("pair" as const) : undefined;
      if (source === target) continue;
      if (portTypeOf) {
        const from = portTypeOf(source, sourcePort, "out");
        const to = portTypeOf(target, targetPort, "in");
        if (!from || !to || !isPortType(from) || !isPortType(to)) continue;
      }
      seen.add(id);
      edges.push({ id, source, sourcePort, target, targetPort, ...(kind ? { kind } : {}) });
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
  const source = normalizeBoardSource(raw.source);
  return {
    version: BOARD_VERSION,
    nodes,
    edges,
    viewport,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    ...(source ? { source } : {}),
  };
}

/** 端口兼容：语义类型 + 传输通道都由注册表判定（`any` 通配）。 */
export function portsCompatible(from: BoardPortType, to: BoardPortType): boolean {
  return portsConnectable(from, to);
}
