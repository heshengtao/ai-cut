/**
 * 剪辑智能体：会话视图 + 一轮对话的流式状态。
 *
 * 后端是「会话的唯一真相源」（落盘为节点树）；这里保存当前会话的节点、活跃分支，
 * 以及正在流式生成的那条助手消息的正文 / 思考 / 工具卡片。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  AgentConfig,
  AgentEvent,
  AgentNode,
  AgentProbe,
  AgentSession,
  AgentSessionSummary,
} from "@/types/agent";
import {
  agentCancel,
  agentConfig,
  agentDeleteSession,
  agentModels,
  agentSend,
  agentSession,
  agentSessions,
  agentSetConfig,
  agentSetHead,
  agentTest,
  onAgentEvent,
} from "@/core/agentApi";
import { toast } from "@/composables/useToast";

/** 流式期间一张工具卡片的运行状态。 */
export interface ToolRun {
  callId: string;
  name: string;
  args: unknown;
  /** `null` = 还在跑。 */
  ok: boolean | null;
  output: string;
}

export const useAgentStore = defineStore("agent", () => {
  const config = ref<AgentConfig | null>(null);
  const sessions = ref<AgentSessionSummary[]>([]);
  const session = ref<AgentSession | null>(null);
  const running = ref(false);
  const stopped = ref(false);

  const streamingNodeId = ref<string | null>(null);
  const streamingContent = ref("");
  const streamingReasoning = ref("");
  const toolRuns = ref<Record<string, ToolRun[]>>({});
  const toolTick = ref(0);

  let unlisten: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;
  let wanted = false;

  const FLUSH_MS = 80;
  let pendingContent = "";
  let pendingReasoning = "";
  let pendingNodeId: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushStreaming(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingNodeId !== null) streamingNodeId.value = pendingNodeId;
    if (pendingContent) {
      streamingContent.value += pendingContent;
      pendingContent = "";
    }
    if (pendingReasoning) {
      streamingReasoning.value += pendingReasoning;
      pendingReasoning = "";
    }
  }

  function dropPending(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingContent = "";
    pendingReasoning = "";
    pendingNodeId = null;
  }

  function queueDelta(nodeId: string, text: string, kind: "content" | "reasoning"): void {
    if (pendingNodeId !== nodeId) {
      flushStreaming();
      pendingNodeId = nodeId;
    }
    if (kind === "content") pendingContent += text;
    else pendingReasoning += text;
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushStreaming();
      }, FLUSH_MS);
    }
  }

  const configured = computed(() => {
    const c = config.value;
    return !!c && !!c.base_url.trim() && !!c.api_key.trim() && !!c.model.trim();
  });

  const activePath = computed<AgentNode[]>(() => {
    const s = session.value;
    if (!s) return [];
    const path: AgentNode[] = [];
    let cursor = s.head;
    while (cursor) {
      const node = s.nodes.find((n) => n.id === cursor);
      if (!node) break;
      path.push(node);
      cursor = node.parent;
    }
    return path.reverse();
  });

  function branchesOf(nodeId: string): AgentNode[] {
    const s = session.value;
    if (!s) return [];
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node) return [];
    return s.nodes
      .filter((n) => n.parent === node.parent)
      .sort((a, b) => a.created_at - b.created_at);
  }

  async function loadConfig(): Promise<void> {
    config.value = await agentConfig().catch(() => null);
  }

  async function saveConfig(
    baseUrl: string,
    apiKey: string,
    model: string,
  ): Promise<void> {
    config.value = await agentSetConfig(baseUrl, apiKey, model);
  }

  async function fetchModels(
    baseUrl: string,
    apiKey: string,
    model: string,
  ): Promise<string[]> {
    return agentModels(baseUrl, apiKey, model);
  }

  async function test(
    baseUrl: string,
    apiKey: string,
    model: string,
  ): Promise<AgentProbe> {
    return agentTest(baseUrl, apiKey, model);
  }

  async function loadSessions(): Promise<void> {
    sessions.value = await agentSessions().catch(() => []);
  }

  async function openSession(id: string): Promise<void> {
    if (running.value) return;
    session.value = await agentSession(id);
    stopped.value = false;
    resetStream();
  }

  function newSession(): void {
    if (running.value) return;
    session.value = null;
    stopped.value = false;
    resetStream();
  }

  async function removeSession(id: string): Promise<void> {
    if (running.value) return;
    await agentDeleteSession(id);
    if (session.value?.id === id) session.value = null;
    await loadSessions();
  }

  async function setHead(nodeId: string): Promise<void> {
    if (!session.value || running.value) return;
    session.value = await agentSetHead(session.value.id, nodeId);
  }

  function resetStreaming(): void {
    dropPending();
    streamingNodeId.value = null;
    streamingContent.value = "";
    streamingReasoning.value = "";
  }

  function resetStream(): void {
    resetStreaming();
    toolRuns.value = {};
    toolTick.value = 0;
  }

  async function sendFrom(parentId: string | null, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || running.value) return;
    running.value = true;
    stopped.value = false;
    resetStream();
    try {
      await agentSend(session.value?.id ?? null, parentId, trimmed);
    } catch (error) {
      running.value = false;
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function send(text: string): Promise<void> {
    return sendFrom(session.value?.head ?? null, text);
  }

  function editAndResend(nodeId: string, text: string): Promise<void> {
    const node = session.value?.nodes.find((n) => n.id === nodeId);
    return sendFrom(node?.parent ?? null, text);
  }

  async function stop(): Promise<void> {
    await agentCancel().catch(() => undefined);
  }

  function handleEvent(event: AgentEvent): void {
    if (event.type !== "delta" && event.type !== "reasoning") flushStreaming();
    switch (event.type) {
      case "turn_started": {
        if (session.value?.id !== event.session_id) {
          session.value = {
            id: event.session_id,
            title: "",
            created_at: Date.now(),
            updated_at: Date.now(),
            nodes: [],
            head: null,
          };
        }
        const s = session.value;
        if (s && !s.nodes.some((n) => n.id === event.user_node.id)) s.nodes.push(event.user_node);
        if (s) s.head = event.user_node.id;
        running.value = true;
        stopped.value = false;
        resetStream();
        break;
      }
      case "delta":
        queueDelta(event.node_id, event.text, "content");
        break;
      case "reasoning":
        queueDelta(event.node_id, event.text, "reasoning");
        break;
      case "tool_call": {
        const runs = (toolRuns.value[event.node_id] ??= []);
        runs.push({
          callId: event.call_id,
          name: event.name,
          args: event.args,
          ok: null,
          output: "",
        });
        toolTick.value += 1;
        break;
      }
      case "tool_result": {
        const run = toolRuns.value[event.node_id]?.find((t) => t.callId === event.call_id);
        if (run) {
          run.ok = event.ok;
          run.output = event.output;
        }
        toolTick.value += 1;
        break;
      }
      case "node_added": {
        const s = session.value;
        if (s && !s.nodes.some((n) => n.id === event.node.id)) s.nodes.push(event.node);
        if (s) s.head = event.node.id;
        if (event.node.role === "assistant") resetStreaming();
        break;
      }
      case "turn_finished": {
        const s = session.value;
        if (s) {
          s.head = event.head;
          s.title = event.title;
          s.updated_at = Date.now();
        }
        running.value = false;
        stopped.value = event.stopped;
        resetStream();
        void loadSessions();
        break;
      }
      case "error":
        running.value = false;
        toast(event.message, "error");
        break;
    }
  }

  async function start(): Promise<void> {
    wanted = true;
    if (unlisten) return;
    if (subscribing) return subscribing;
    subscribing = onAgentEvent(handleEvent)
      .then((off) => {
        subscribing = null;
        if (wanted) unlisten = off;
        else off();
      })
      .catch((error: unknown) => {
        subscribing = null;
        throw error;
      });
    return subscribing;
  }

  function dispose(): void {
    wanted = false;
    dropPending();
    unlisten?.();
    unlisten = null;
  }

  return {
    config,
    sessions,
    session,
    running,
    stopped,
    streamingNodeId,
    streamingContent,
    streamingReasoning,
    toolRuns,
    toolTick,
    configured,
    activePath,
    branchesOf,
    loadConfig,
    saveConfig,
    fetchModels,
    test,
    loadSessions,
    openSession,
    newSession,
    removeSession,
    setHead,
    send,
    editAndResend,
    stop,
    start,
    dispose,
  };
});