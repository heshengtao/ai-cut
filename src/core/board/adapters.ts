/**
 * 画布节点执行器注册表。
 *
 * 内置节点仍由 `useBoardRun` 的旧分支执行；插件节点通过这里注册。
 * 分发顺序是「先查表，再走内置」——M0 期间这样能保证内置行为零变化，
 * M1 起可以把内置分支逐个迁进同一张表。
 */
import type { BoardNode } from "@/types/board";
import type { AssetKind } from "@/types/project";

import { nodeDefinition, paramValue } from "./registry";

export interface AdapterResult {
  /** 产物路径（会自动入库）；单端口节点的多次产物都放这里。 */
  paths?: string[];
  /** 多端口节点：`端口 id → 产物路径`（会自动入库）。 */
  pathByPort?: Record<string, string>;
  /** 多端口节点：`端口 id → 已有素材 id`（例如透传）。 */
  assetByPort?: Record<string, string>;
  /** 已有素材 id：只是把现有素材发布到输出，不重复入库。 */
  assetId?: string;
  /**
   * 已有素材 id 的**整摞**（同样不入库）：图片显示节点用它接住上游一次出的多张图，
   * 卡片按「牌堆」叠放。`assetId` 仍然是当前对外发布的那一张，可以不在第一位。
   */
  assets?: string[];
  /** 文本产物（不入库）。 */
  text?: string;
  /** 文本模型的思考过程。 */
  reasoning?: string;
  /**
   * 值产物：`端口 id → JSON 值`（number / boolean / json / 插件自定义 inline 类型）。
   * 素材走 `assetId` / `paths`，文本走 `text`，只有这两者表达不了的值才走这里。
   */
  values?: Record<string, unknown>;
  /** 产物素材类型。 */
  kind?: AssetKind;
}

/** 插件适配器能用到的输入/输出能力（由宿主构造，插件不碰 store）。 */
export interface AdapterIO {
  param<T>(id: string): T | undefined;
  text(portId: string): string | null;
  asset(portId: string): { path: string; assetId: string } | null;
  refs(kind: AssetKind): string[];
  /** 上游值端口当前发布的值（number / boolean / json / 插件类型）。 */
  value(portId: string): unknown;
  progress(value: number, message?: string): void;
}

export type AdapterFn = (input: {
  node: BoardNode;
  nodeId: string;
  signal: AbortSignal;
  io: AdapterIO;
}) => Promise<AdapterResult>;

interface Entry {
  fn: AdapterFn;
  owner: string;
}

const ADAPTERS = new Map<string, Entry>();

/** 注册一个节点执行器；返回 disposer。重复注册抛错并指出占用者。 */
export function registerAdapter(type: string, fn: AdapterFn, owner = "core"): () => void {
  const existing = ADAPTERS.get(type);
  if (existing) {
    throw new Error(`节点执行器 ${type} 已被 ${existing.owner} 注册，不能重复注册`);
  }
  ADAPTERS.set(type, { fn, owner });
  return () => {
    if (ADAPTERS.get(type)?.fn === fn) ADAPTERS.delete(type);
  };
}

export function adapterFor(type: string): AdapterFn | null {
  return ADAPTERS.get(type)?.fn ?? null;
}

/** 插件节点类型统一以 `ext.` 前缀命名。 */
export function pluginNodeType(type: string): boolean {
  return type.startsWith("ext.");
}

/** 内置节点的类型白名单（M1 起逐项迁进注册表后收缩）。 */
const BUILTIN_TYPES = new Set([
  "input.image",
  "input.video",
  "input.audio",
  "input.text",
  "display.image",
  "display.video",
  "display.audio",
  "display.text",
  "model.image",
  "model.video",
  "model.tts",
  "model.asr",
  "model.text",
  "model.enhance",
  "model.separate",
  "model.demux",
  "input.value",
  "display.value",
  "batch",
  "var.item",
  "var.index",
  "var.carry",
  "var.result",
  "var.carryOut",
  "group",
]);

/** 一个节点类型该走哪条执行路径。 */
export function dispatchAdapter(type: string): "plugin" | "builtin" | "unknown" {
  if (adapterFor(type)) return "plugin";
  if (BUILTIN_TYPES.has(type)) return "builtin";
  return "unknown";
}

/**
 * 插件适配器的参数读取器（`io.param`）。
 *
 * `data.params` 只存用户改过的值，所以必须回落到定义里的 `default`：卡片上看到什么
 * 默认值，`run()` 里 `io.param()` 就该拿到什么。用户主动清空（存成 `""`）不算缺失。
 */
export function paramReader(
  node: BoardNode,
): <T = unknown>(id: string) => T | undefined {
  const definition = nodeDefinition(node.type);
  return <T,>(id: string) => paramValue(definition, node.data.params, id) as T | undefined;
}
