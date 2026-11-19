/**
 * 画布的数据类型注册表。
 *
 * 设计取自 ai-board：内核只固定**传输通道**（inline / blob / stream），语义类型
 * 由注册表维护——内置类型是 `CORE_DATA_TYPES`，插件可以在运行时注册自己的类型
 * （`pluginId` 标记归属，禁用插件时一并注销）。连线判定同时检查语义与通道：
 * 语义类型决定「能不能接」，通道决定「怎么搬」。
 *
 * 纯函数模块（不 import Vue / store）：画布运行器、序列化和单测共用这一份。
 */
import type { BoardPortType, ChannelKind, DataTypeSpec } from "@/types/board";

const COLORS = {
  text: "#8b93f8",
  image: "#c084fc",
  video: "#fb7185",
  audio: "#f59e0b",
  integer: "#60a5fa",
  number: "#38bdf8",
  boolean: "#34d399",
  json: "#a3e635",
  any: "#94a3b8",
} as const;

function spec(
  id: BoardPortType,
  label: string,
  channels: ChannelKind[],
  extra: Partial<DataTypeSpec> = {},
): DataTypeSpec {
  return { id, label, channels, ...extra };
}

/** 内核自带类型。 */
export const CORE_DATA_TYPES: DataTypeSpec[] = [
  spec("text", "Text", ["inline", "blob"], {
    mime: "text/*",
    inline: "text",
    color: COLORS.text,
  }),
  spec("image", "Image", ["blob", "stream"], { mime: "image/*", color: COLORS.image }),
  spec("video", "Video", ["blob", "stream"], { mime: "video/*", color: COLORS.video }),
  spec("audio", "Audio", ["blob", "stream"], { mime: "audio/*", color: COLORS.audio }),
  // 整数与浮点分开：编辑器精度、运行时解析都不同；连线上互相兼容，避免用错类型接不上。
  spec("integer", "Integer", ["inline"], {
    inline: "number",
    color: COLORS.integer,
    accepts: ["number"],
  }),
  spec("number", "Float", ["inline"], {
    inline: "number",
    color: COLORS.number,
    accepts: ["integer"],
  }),
  spec("boolean", "Boolean", ["inline"], { inline: "boolean", color: COLORS.boolean }),
  spec("json", "JSON", ["inline", "blob"], {
    mime: "application/json",
    inline: "json",
    color: COLORS.json,
  }),
  spec("any", "Any", ["inline", "blob", "stream"], { color: COLORS.any }),
];

interface Entry {
  spec: DataTypeSpec;
  owner: string;
}

const REGISTRY = new Map<string, Entry>();
for (const item of CORE_DATA_TYPES) {
  REGISTRY.set(item.id, { spec: item, owner: "core" });
}

let revision = 0;

/** 注册表版本号：UI 在 `computed` 里读它就能跟着插件注册刷新。 */
export function dataTypesRevision(): number {
  return revision;
}

/** 类型 id 的合法写法：字母开头，字母 / 数字 / `.` `_` `-`，最长 48。 */
const ID_PATTERN = /^[a-z][a-z0-9_.-]{0,47}$/i;

export function isDataTypeId(value: unknown): value is BoardPortType {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** 注册一个类型；返回 disposer。重复注册抛错并指出占用者。 */
export function registerDataType(owner: string, definition: DataTypeSpec): () => void {
  if (!isDataTypeId(definition.id)) {
    throw new Error(`数据类型 id 不合法：${String(definition.id)}`);
  }
  const channels = [...new Set(definition.channels)].filter((channel): channel is ChannelKind =>
    ["inline", "blob", "stream"].includes(channel),
  );
  if (channels.length === 0) {
    throw new Error(`数据类型 ${definition.id} 至少要声明一个通道`);
  }
  const id = String(definition.id);
  const existing = REGISTRY.get(id);
  if (existing) {
    throw new Error(
      `数据类型 ${id} 已被 ${existing.owner === "core" ? "内置类型" : existing.owner} 注册，不能重复注册`,
    );
  }
  const stored: DataTypeSpec = {
    ...definition,
    id,
    channels,
    ...(owner === "core" ? {} : { pluginId: definition.pluginId ?? owner }),
  };
  REGISTRY.set(id, { spec: stored, owner });
  revision += 1;
  return () => {
    if (REGISTRY.get(id)?.spec !== stored) return;
    REGISTRY.delete(id);
    revision += 1;
  };
}

/** 未知类型（插件未装载 / 旧文档）的兜底：按「能接能搬」处理，别把工程拖成打不开。 */
function fallbackSpec(id: BoardPortType): DataTypeSpec {
  return {
    id,
    label: String(id),
    channels: ["inline", "blob"],
    color: COLORS.any,
  };
}

/** 取类型声明；未注册的类型返回兜底声明。 */
export function dataTypeSpec(id: BoardPortType): DataTypeSpec {
  return REGISTRY.get(String(id))?.spec ?? fallbackSpec(id);
}

/** 全部已注册类型（含插件类型）。 */
export function listDataTypes(): DataTypeSpec[] {
  return [...REGISTRY.values()].map((entry) => entry.spec);
}

/** 有 inline 编辑器的类型（值输入节点的下拉）。`any` 不算。 */
export function inlineDataTypeSpecs(): DataTypeSpec[] {
  return listDataTypes().filter(
    (item) => item.id !== "any" && item.channels.includes("inline") && item.inline !== "none",
  );
}

/** 类型标签：UI 优先用 `board.type.<id>`，没有就用声明里的 label。 */
export function dataTypeLabel(id: BoardPortType): string {
  return dataTypeSpec(id).label;
}

export function dataTypeColor(id: BoardPortType): string {
  return dataTypeSpec(id).color ?? COLORS.any;
}

/** 语义兼容：`any` 通配，精确匹配，或任一方声明 `accepts`。 */
export function typesCompatible(from: BoardPortType, to: BoardPortType): boolean {
  if (from === "any" || to === "any" || from === to) return true;
  const target = dataTypeSpec(to);
  if (target.accepts?.includes(from)) return true;
  const source = dataTypeSpec(from);
  return Boolean(source.accepts?.includes(to));
}

/** 通道兼容：生产者至少有一个通道是消费者接受的。 */
export function channelsCompatible(from: BoardPortType, to: BoardPortType): boolean {
  if (from === "any" || to === "any") return true;
  const producer = dataTypeSpec(from);
  const consumer = dataTypeSpec(to);
  return producer.channels.some((channel) => consumer.channels.includes(channel));
}

/** 连线判定：语义 + 通道都通过才能连。 */
export function portsConnectable(from: BoardPortType, to: BoardPortType): boolean {
  return typesCompatible(from, to) && channelsCompatible(from, to);
}

/** 只给测试用：把注册表恢复成仅内置类型。 */
export function resetDataTypes(): void {
  REGISTRY.clear();
  for (const item of CORE_DATA_TYPES) {
    REGISTRY.set(item.id, { spec: item, owner: "core" });
  }
  revision += 1;
}
