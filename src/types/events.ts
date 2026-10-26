/** AI 协作事件与命令类型：跨 UI / MCP / 事件流共用的稳定协议。 */

import type {
  Clip,
  ClipEffect,
  MarkerKind,
  MediaAsset,
  Project,
  ReviewBBox,
  ReviewSeverity,
  Track,
} from "@/types/project";

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
  | "clip.append"
  | "clip.speed"
  | "clip.color"
  | "clip.transition"
  | "clip.keyframes"
  | "clip.duplicate"
  | "clip.ripple_delete"
  | "track.add"
  | "track.update"
  | "track.remove"
  | "track.move"
  | "subtitle.import"
  | "marker.add"
  | "marker.update"
  | "marker.remove"
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

/**
 * 撤销栈里的一步：命令元数据 + 提交前 / 后的文档快照。
 *
 * 前端的撤销历史是唯一真相源；操作记录面板直接由它派生，因此人类、内置助手
 * 与外部 AI 的每一步改动都天然可见、可回撤、可重做。
 */
export interface HistoryStep {
  id: string;
  kind: CommandKind;
  actor: Actor;
  sessionId?: string;
  label: string;
  timestamp: number;
  affected: Affected;
  durationMs: number;
  before: Project;
  after: Project;
}

/** 操作记录面板的一行（`HistoryStep` 去掉文档快照）。 */
export interface HistoryEntry {
  id: string;
  kind: CommandKind;
  actor: Actor;
  sessionId?: string;
  label: string;
  timestamp: number;
  affected: Affected;
  durationMs: number;
  /** 是否仍在文档中生效（撤销栈 vs 重做栈）。 */
  applied: boolean;
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
  "clip.add": { trackId: string | number; clip: Clip };
  "clip.update": { clipId: string; patch: Partial<Clip> };
  "clip.remove": { clipIds: string[] };
  "clip.split": { clipIds: string[]; at: number };
  "clip.trim": { clipId: string; edge: "start" | "end"; time: number };
  "clip.move": {
    clipIds: string[];
    delta: number;
    targetTrackId?: string | number;
  };
  "clip.append": {
    assetId: string;
    trackId?: string | number;
    trackName?: string;
    start?: number;
    duration?: number;
    in?: number;
  };
  "clip.speed": { clipId: string; speed: number };
  "clip.color": {
    clipId: string;
    patch: {
      brightness?: number;
      contrast?: number;
      saturation?: number;
      temperature?: number;
      tint?: number;
    };
  };
  "clip.transition": {
    clipId: string;
    edge: "in" | "out";
    transition: {
      type?: "fade" | "slide" | "ofx";
      duration?: number;
      direction?: "left" | "right" | "up" | "down";
      effect?: ClipEffect;
    } | null;
  };
  "clip.keyframes": {
    clipId: string;
    keyframes: {
      time: number;
      opacity?: number;
      x?: number;
      y?: number;
      scale?: number;
      rotation?: number;
    }[] | null;
  };
  "clip.duplicate": {
    clipIds: string[];
    offset?: number;
    targetTrackId?: string | number;
  };
  "clip.ripple_delete": { clipIds: string[] };
  "track.add": { index?: number; name?: string };
  "track.update": {
    trackId: string | number;
    patch: Partial<Pick<Track, "name" | "muted" | "visible" | "locked">>;
  };
  "track.remove": { trackId: string | number };
  "track.move": { trackId: string | number; toIndex: number };
  "subtitle.import": {
    entries: { start: number; end: number; text: string }[];
    trackName?: string;
    offset?: number;
  };
  "marker.add": {
    id?: string;
    time: number;
    name?: string;
    color?: string;
    kind?: MarkerKind;
    sceneId?: string;
    note?: string;
    severity?: ReviewSeverity;
    resolved?: boolean;
    bbox?: ReviewBBox;
    screenshot?: string;
    tags?: string[];
  };
  "marker.update": {
    markerId: string;
    patch: {
      time?: number;
      name?: string;
      color?: string;
      kind?: MarkerKind;
      sceneId?: string;
      note?: string;
      severity?: ReviewSeverity;
      resolved?: boolean;
      bbox?: ReviewBBox | null;
      screenshot?: string;
      tags?: string[];
    };
  };
  "marker.remove": { markerId: string };
  "project.rename": { name: string };
  "project.output": { width?: number; height?: number; fps?: number };
}

/** 工程快照（内部完整读取；MCP 默认只取概览）。 */
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
  "clip.append",
  "clip.speed",
  "clip.color",
  "clip.transition",
  "clip.keyframes",
  "clip.duplicate",
  "clip.ripple_delete",
  "track.add",
  "track.update",
  "track.remove",
  "track.move",
  "subtitle.import",
  "marker.add",
  "marker.update",
  "marker.remove",
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
