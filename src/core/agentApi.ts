/** 剪辑智能体 / MCP / CLI / 网络设置的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentConfig,
  AgentEvent,
  AgentProbe,
  AgentSession,
  AgentSessionSummary,
  CliStatus,
  McpStatus,
  NetworkConfig,
  ProxyProbe,
  ProxyStatus,
} from "@/types/agent";
import { isTauri } from "@/utils/platform";

export const EVENT_AGENT = "agent-event";

const EMPTY_CONFIG: AgentConfig = { base_url: "", api_key: "", model: "" };

async function call<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isTauri()) return fallback;
  return invoke<T>(command, args);
}

export function agentConfig(): Promise<AgentConfig> {
  return call("agent_config", {}, EMPTY_CONFIG);
}

export function agentSetConfig(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<AgentConfig> {
  return call("agent_set_config", { baseUrl, apiKey, model }, EMPTY_CONFIG);
}

export function agentModels(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<string[]> {
  return call("agent_models", { baseUrl, apiKey, model }, []);
}

export function agentTest(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<AgentProbe> {
  return call("agent_test", { baseUrl, apiKey, model }, {
    ok: false,
    detail: "Tauri 不可用",
    ms: 0,
  });
}

export function agentSessions(): Promise<AgentSessionSummary[]> {
  return call("agent_sessions", {}, []);
}

export function agentSession(id: string): Promise<AgentSession> {
  return call("agent_session", { id }, {
    id,
    title: "",
    created_at: Date.now(),
    updated_at: Date.now(),
    nodes: [],
    head: null,
  });
}

export function agentDeleteSession(id: string): Promise<void> {
  return call("agent_delete_session", { id }, undefined);
}

export function agentSetHead(id: string, nodeId: string): Promise<AgentSession> {
  return call("agent_set_head", { id, nodeId }, {
    id,
    title: "",
    created_at: Date.now(),
    updated_at: Date.now(),
    nodes: [],
    head: null,
  });
}

export function agentSend(
  sessionId: string | null,
  parentId: string | null,
  text: string,
): Promise<string> {
  return call("agent_send", { sessionId, parentId, text }, sessionId ?? "");
}

export function agentCancel(): Promise<boolean> {
  return call("agent_cancel", {}, false);
}

export function agentRunning(): Promise<boolean> {
  return call("agent_running", {}, false);
}

export function onAgentEvent(handler: (event: AgentEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<AgentEvent>(EVENT_AGENT, (event) => handler(event.payload));
}

export function mcpStatus(): Promise<McpStatus> {
  return call("mcp_status", {}, { enabled: false, port: 50563, running: false, url: null });
}

export function setMcpConfig(enabled: boolean, port: number): Promise<McpStatus> {
  return call("set_mcp_config", { enabled, port }, {
    enabled,
    port,
    running: false,
    url: null,
  });
}

export function cliStatus(): Promise<CliStatus> {
  return call("cli_status", {}, {
    state: "unsupported",
    command: "aicut",
    target: null,
    bundled: null,
    conflict: null,
    hint: null,
    manual_command: null,
    full_path: null,
  });
}

export function installCli(): Promise<CliStatus> {
  return call("install_cli", {}, cliStatusFallback());
}

export function uninstallCli(): Promise<CliStatus> {
  return call("uninstall_cli", {}, cliStatusFallback());
}

function cliStatusFallback(): CliStatus {
  return {
    state: "unsupported",
    command: "aicut",
    target: null,
    bundled: null,
    conflict: null,
    hint: null,
    manual_command: null,
    full_path: null,
  };
}

export function networkConfig(): Promise<NetworkConfig> {
  return call("network_config", {}, { proxy_mode: "system", proxy_url: "" });
}

export function networkSetConfig(
  proxyMode: NetworkConfig["proxy_mode"],
  proxyUrl: string,
): Promise<NetworkConfig> {
  return call("network_set_config", { proxyMode, proxyUrl }, {
    proxy_mode: proxyMode,
    proxy_url: proxyUrl,
  });
}

export function networkStatus(): Promise<ProxyStatus> {
  return call("network_status", {}, { mode: "system", url: null, source: "系统代理" });
}

export function networkProbe(
  proxyMode: NetworkConfig["proxy_mode"],
  proxyUrl: string,
): Promise<ProxyProbe> {
  return call("network_probe", { proxyMode, proxyUrl }, {
    ok: false,
    detail: "Tauri 不可用",
    ms: 0,
  });
}