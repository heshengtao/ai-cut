/**
 * 工作流库：画布工作流的持久化条目与版本。
 *
 * 与 `crates/daemon/src/workflow.rs` 的 serde 结构一一对应（camelCase）。
 * 默认工作流不落盘，由前端内置；用户工作流每条根记录带多个版本。
 */
import type { BoardEdge, BoardNode } from "@/types/board";

/** 一个工作流版本（一个根工作流可以有多个版本）。 */
export interface WorkflowVersion {
  /** `<rootId>-v<version>`；内置工作流用 `builtin:<key>`。 */
  id: string;
  rootId: string;
  version: number;
  name: string;
  description: string;
  /** 从哪个默认工作流改出来的（默认工作流的 id）。 */
  origin?: string | null;
  /** 工程历史分组键（`path:...` / `created:...`），同一历史下的保存按版本管理。 */
  historyKey?: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
  thumbnail?: string | null;
  fingerprint?: string;
}

/** 一个工作流的完整内容（`workflow_get` 的返回）。 */
export interface WorkflowSnapshot {
  version: WorkflowVersion;
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/** 保存请求（`workflow_save` 的参数）。 */
export interface SaveWorkflowInput {
  /** 已知的根工作流：给了就往它后面加版本。 */
  rootId?: string | null;
  name: string;
  description?: string;
  /** 从默认工作流改出来时记下它的 id（会创建新的用户工作流）。 */
  origin?: string | null;
  historyKey?: string | null;
  tags?: string[];
  nodes: string;
  edges: string;
  thumbnail?: string | null;
}

/** 工作流库里的一个根工作流（内置或用户创建）。 */
export interface WorkflowGroup {
  rootId: string;
  /** 内置默认工作流：只读，不能改名 / 删除。 */
  builtin: boolean;
  name: string;
  description: string;
  latest: WorkflowVersion;
  /** 新版本在前。 */
  versions: WorkflowVersion[];
  origin?: string | null;
  historyKey?: string | null;
}

/** 画布当前对应的工作流来源（存进 `BoardDoc.source`，跟着工程保存）。 */
export interface BoardWorkflowSource {
  rootId?: string;
  /** 默认工作流 id（用户还没另存时）。 */
  builtinId?: string;
  name?: string;
  version?: number;
}
