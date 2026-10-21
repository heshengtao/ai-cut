/** AI 协作事件与命令类型：跨 UI / MCP / 事件流共用的稳定协议。 */

import type { Clip, MediaAsset, Project, Track } from "@/types/project";

/** 操作者。 */
export type Actor = "human" | "agent";

/** 可序列化的命令类型。所有 AI 写操作都必须落在这里。 */
export type CommandKind =
  | "asset.add"
  | "asset.remove"
  | "asset.update"
  | "clip.add"
  | "clip.update"
  | "clip.remove"
  | "clip.split"
  | "clip.trim"
  | "clip.move"
  | "track.add"
  | "track.update"
  | "track.remove"
  | "track.move"
  | "project.rename"
  | "project.output"
  | "project.reset"
  | "ui.dispatch"
  | "history.undo"
  | "history.redo";

/** 一条待执行的命令。`baseRevision` 用于乐观并发校验。 */
export interface Command {
  id: string;
  baseRevision: number;
  actor: Actor;
  /** Agent 会话 id；人类操作为空。 */
  sessionId?: string;
  kind: CommandKind;
  payload: unknown;
  /** 人类可读描述，例如「在 00:12 插入 B-roll」。 */
  label: string;
  timestamp: number;
}

/** 命令影响到的文档对象，用于高亮、定位与活动流。 */
export interface Affected {
  clipIds: string[];
  trackIds: string[];
  assetIds: string[];
  /** 受影响的时间区间（秒）。 */
  range?: [number, number];
}

/** 一条已执行（或失败）的命令事件。 */
export interface OpEvent {
  revision: number;
  command: Command;
  affected: Affected;
  durationMs: number;
  error?: string;
}

/** 命令执行结果。 */
export interface CommandResult {
  ok: boolean;
  revision: number;
  affected: Affected;
  changed: boolean;
  error?: string;
}

/** AI 会话阶段。 */
export type AgentPhase =
  | "idle"
  | "reading"
  | "planning"
  | "generating"
  | "importing"
  | "applying"
  | "rendering"
  | "done"
  | "error";

/** Agent 当前关注的时间点 / 片段。 */
export interface AgentFocus {
  time: number;
  clipId?: string;
  trackId?: string;
}

/** 一次 AI 会话。 */
export interface AgentSession {
  id: string;
  title: string;
  phase: AgentPhase;
  detail?: string;
  focus?: AgentFocus;
  startedAt: number;
  updatedAt: number;
}

/** MCP 的 agent.setStatus 参数。 */
export interface AgentStatusPatch {
  sessionId?: string;
  title?: string;
  phase?: AgentPhase;
  detail?: string;
  focus?: AgentFocus;
}

/** Rust → webview 的桥接请求。 */
export interface AgentBridgeRequest {
  id: string;
  method: string;
  payload: unknown;
}

/** webview → Rust 的桥接响应。 */
export interface AgentBridgeReply {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 人类 UI 提交变更时可选的元数据。 */
export interface DispatchMeta {
  kind?: CommandKind;
  payload?: unknown;
  actor?: Actor;
  label?: string;
  sessionId?: string;
}

/** 命令参数里可能出现的领域对象（仅用于类型收窄）。 */
export interface CommandPayloads {
  "asset.add": { asset: MediaAsset };
  "asset.remove": { assetId: string };
  "asset.update": { assetId: string; patch: Partial<MediaAsset> };
  "clip.add": { trackId: string; clip: Clip };
  "clip.update": { clipId: string; patch: Partial<Clip> };
  "clip.remove": { clipIds: string[] };
  "clip.split": { clipIds: string[]; at: number };
  "clip.trim": { clipId: string; edge: "start" | "end"; time: number };
  "clip.move": { clipIds: string[]; delta: number; targetTrackId?: string };
  "track.add": { index?: number };
  "track.update": {
    trackId: string;
    patch: Partial<Pick<Track, "muted" | "visible" | "locked">>;
  };
  "track.remove": { trackId: string };
  "track.move": { trackId: string; toIndex: number };
  "project.rename": { name: string };
  "project.output": { width?: number; height?: number; fps?: number };
}

/** 工程快照（MCP project.get 的返回）。 */
export interface ProjectSnapshot {
  revision: number;
  project: Project;
}

/** 命令类型白名单。 */
export const COMMAND_KINDS: readonly CommandKind[] = [
  "asset.add",
  "asset.remove",
  "asset.update",
  "clip.add",
  "clip.update",
  "clip.remove",
  "clip.split",
  "clip.trim",
  "clip.move",
  "track.add",
  "track.update",
  "track.remove",
  "track.move",
  "project.rename",
  "project.output",
  "project.reset",
  "ui.dispatch",
  "history.undo",
  "history.redo",
];

/** 运行时校验：外部传入的 kind 是否可用。 */
export function isCommandKind(value: unknown): value is CommandKind {
  return typeof value === "string" && (COMMAND_KINDS as readonly string[]).includes(value);
}
