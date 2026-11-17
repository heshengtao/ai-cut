/**
 * 画布节点执行器注册表。
 *
 * 内置节点仍由 `useBoardRun` 的旧分支执行；插件节点通过这里注册。
 * 分发顺序是「先查表，再走内置」——M0 期间这样能保证内置行为零变化，
 * M1 起可以把内置分支逐个迁进同一张表。
 */
import type { BoardNode } from "@/types/board";
import type { AssetKind } from "@/types/project";

export interface AdapterResult {
  /** 产物路径（会自动入库）；单端口节点的多次产物都放这里。 */
  paths?: string[];
  /** 多端口节点：`端口 id → 产物路径`（会自动入库）。 */
  pathByPort?: Record<string, string>;
  /** 多端口节点：`端口 id → 已有素材 id`（例如透传）。 */
  assetByPort?: Record<string, string>;
  /** 已有素材 id：只是把现有素材发布到输出，不重复入库。 */
  assetId?: string;
  /** 文本产物（不入库）。 */
  text?: string;
  /** 文本模型的思考过程。 */
  reasoning?: string;
  /** 产物素材类型。 */
  kind?: AssetKind;
}

/** 插件适配器能用到的输入/输出能力（由宿主构造，插件不碰 store）。 */
export interface AdapterIO {
  param<T>(id: string): T | undefined;
  text(portId: string): string | null;
  asset(portId: string): { path: string; assetId: string } | null;
  refs(kind: AssetKind): string[];
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
