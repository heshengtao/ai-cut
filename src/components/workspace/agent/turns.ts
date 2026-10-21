/**
 * 把后端「一轮多个助手节点」的节点树投影成聊天 Turn 视图。
 *
 * 规则：思考、中间回复、工具调用收进可折叠的「过程」；最终回答留在折叠之外。
 */
import type { AgentNode, AgentToolCallRef } from "@/types/agent";
import type { ToolRun } from "@/stores/agent";
import type { ToolCard } from "./types";

export type ProcessEntry =
  | { kind: "reasoning"; key: string; text: string; running: boolean }
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; nodeId: string; tools: ToolCard[]; running: boolean };

export type TurnStatus = "running" | "done" | "stopped" | "error";

export interface TurnView {
  key: string;
  user: AgentNode | null;
  branches: AgentNode[];
  entries: ProcessEntry[];
  answer: string;
  answerStreaming: boolean;
  running: boolean;
  status: TurnStatus;
  error: string | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface TurnSource {
  path: AgentNode[];
  running: boolean;
  stopped: boolean;
  streamingNodeId: string | null;
  streamingContent: string;
  streamingReasoning: string;
  toolRuns: Record<string, ToolRun[]>;
  branchesOf: (nodeId: string) => AgentNode[];
}

export function safeParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const previous = new Map<string, TurnView>();

function sameTools(a: ToolCard[], b: ToolCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.name !== y.name || x.ok !== y.ok || x.output !== y.output) return false;
  }
  return true;
}

function sameEntry(a: ProcessEntry, b: ProcessEntry): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === "reasoning" && b.kind === "reasoning") {
    return a.text === b.text && a.running === b.running;
  }
  if (a.kind === "text" && b.kind === "text") return a.text === b.text;
  if (a.kind === "tools" && b.kind === "tools") {
    return a.running === b.running && sameTools(a.tools, b.tools);
  }
  return false;
}

function sameBranches(a: AgentNode[], b: AgentNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i].id !== b[i].id) return false;
  return true;
}

function sameTurn(a: TurnView, b: TurnView): boolean {
  if (
    a.user !== b.user ||
    a.answer !== b.answer ||
    a.answerStreaming !== b.answerStreaming ||
    a.running !== b.running ||
    a.status !== b.status ||
    a.error !== b.error ||
    a.startedAt !== b.startedAt ||
    a.endedAt !== b.endedAt ||
    a.entries.length !== b.entries.length ||
    !sameBranches(a.branches, b.branches)
  ) {
    return false;
  }
  for (let i = 0; i < a.entries.length; i += 1) {
    if (!sameEntry(a.entries[i], b.entries[i])) return false;
  }
  return true;
}

function toolCard(
  call: AgentToolCallRef,
  result: AgentNode | undefined,
  runs: ToolRun[] | undefined,
): ToolCard {
  const run = runs?.find((r) => r.callId === call.id);
  const ok = result ? result.error == null : run ? run.ok : null;
  const output = result?.content ?? run?.output ?? "";
  return {
    id: call.id || call.name,
    name: call.name,
    args: safeParse(call.arguments),
    ok,
    output,
  };
}

function groupTurns(path: AgentNode[]): { user: AgentNode | null; nodes: AgentNode[] }[] {
  const turns: { user: AgentNode | null; nodes: AgentNode[] }[] = [];
  for (const node of path) {
    if (node.role === "user") {
      turns.push({ user: node, nodes: [] });
      continue;
    }
    if (turns.length === 0) turns.push({ user: null, nodes: [] });
    turns[turns.length - 1].nodes.push(node);
  }
  return turns;
}

export function buildTurns(source: TurnSource): TurnView[] {
  const raw = groupTurns(source.path);
  const liveId = source.streamingNodeId;
  const liveVisible = source.running && !!liveId && !source.path.some((n) => n.id === liveId);
  if ((liveVisible || source.running) && raw.length === 0) {
    raw.push({ user: null, nodes: [] });
  }

  const views = raw.map((group, index) => {
    const isLast = index === raw.length - 1;
    const running = isLast && source.running;
    const streamLive = isLast && liveVisible;

    const assistantNodes = group.nodes.filter((n) => n.role === "assistant");
    const results = new Map<string, AgentNode>();
    for (const node of group.nodes) {
      if (node.role === "tool" && node.tool_call_id) results.set(node.tool_call_id, node);
    }

    let answerNode: AgentNode | undefined;
    for (const node of assistantNodes) {
      if (node.tool_calls.length === 0 && node.content.trim() !== "") answerNode = node;
    }

    const entries: ProcessEntry[] = [];
    for (const node of assistantNodes) {
      if (node.reasoning && node.reasoning.trim() !== "") {
        entries.push({
          kind: "reasoning",
          key: `${node.id}:r`,
          text: node.reasoning,
          running: false,
        });
      }
      if (node !== answerNode && node.content.trim() !== "") {
        entries.push({ kind: "text", key: `${node.id}:t`, text: node.content });
      }
      if (node.tool_calls.length > 0) {
        const tools = node.tool_calls.map((call) =>
          toolCard(call, results.get(call.id), source.toolRuns[node.id]),
        );
        entries.push({
          kind: "tools",
          key: `${node.id}:tools`,
          nodeId: node.id,
          tools,
          running: running && tools.some((t) => t.ok === null),
        });
      }
    }

    if (streamLive && source.streamingReasoning.trim() !== "") {
      entries.push({
        kind: "reasoning",
        key: `${liveId}:r`,
        text: source.streamingReasoning,
        running: true,
      });
    }

    const answer = streamLive ? source.streamingContent : answerNode?.content ?? "";
    const errored = assistantNodes.some((n) => n.error != null);
    const unanswered = assistantNodes.some((n) =>
      n.tool_calls.some((c) => !results.has(c.id)),
    );
    const status: TurnStatus = running
      ? "running"
      : errored
        ? "error"
        : (isLast && source.stopped) || unanswered
          ? "stopped"
          : "done";
    const errorNode = [...assistantNodes].reverse().find((n) => n.error != null);

    const startedAt = group.user?.created_at ?? group.nodes[0]?.created_at ?? Date.now();
    const lastAt = group.nodes.reduce((max, n) => Math.max(max, n.created_at), startedAt);
    const endedAt = lastAt;

    const next: TurnView = {
      key: group.user?.id ?? group.nodes[0]?.id ?? `turn-${index}`,
      user: group.user,
      branches: group.user ? source.branchesOf(group.user.id) : [],
      entries,
      answer,
      answerStreaming: streamLive && source.streamingContent !== "",
      running,
      status,
      error: status === "error" ? errorNode?.error ?? null : null,
      startedAt,
      endedAt,
      durationMs: Math.max(1000, endedAt - startedAt),
    };

    const last = previous.get(next.key);
    if (last && sameTurn(last, next)) return last;
    previous.set(next.key, next);
    return next;
  });

  for (const key of previous.keys()) {
    if (!views.some((v) => v.key === key)) previous.delete(key);
  }
  return views;
}