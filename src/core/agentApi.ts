/** 剪辑智能体 / MCP / CLI / 网络设置的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentConfig,
  AgentEvent,
  AgentProbe,
  AgentSession,
  AgentSessionSummary,
  BackendInfo,
  BackendPreference,
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

/** 浏览器预览 / 后端命令不可用时的兜底：保留完整选项，避免设置页看起来没有控件。 */
export function backendFallback(): BackendInfo {
  return {
    preference: "cpu",
    current: "cpu",
    recommended: "cpu",
    platform: "—",
    loaded_runtime: null,
    restart_required: false,
    ep_ready: false,
    options: [
      {
        kind: "cpu",
        label: "CPU",
        note: "纯 CPU（默认，全平台可用）",
        available: true,
        runtime: "cpu",
        runtime_installed: true,
        download_bytes: 0,
        missing: [],
      },
      {
        kind: "coreml",
        label: "Apple CoreML",
        note: "Apple 神经引擎 / GPU",
        available: false,
        runtime: "coreml",
        runtime_installed: false,
        download_bytes: 0,
        missing: [],
      },
      {
        kind: "directml",
        label: "DirectML",
        note: "DirectX 12 硬件加速（Windows）",
        available: false,
        runtime: "directml",
        runtime_installed: false,
        download_bytes: 0,
        missing: [],
      },
      {
        kind: "cuda12",
        label: "CUDA 12",
        note: "NVIDIA 显卡加速（CUDA 12；老卡 / 驱动 < 580，兼容性最好）",
        available: false,
        runtime: "cuda",
        runtime_installed: false,
        download_bytes: 0,
        missing: [],
      },
      {
        kind: "cuda13",
        label: "CUDA 13",
        note: "NVIDIA 新卡加速（CUDA 13；Turing 起且驱动 580+，更快）",
        available: false,
        runtime: "cuda13",
        runtime_installed: false,
        download_bytes: 0,
        missing: [],
      },
    ],
  };
}

export function aiBackendInfo(): Promise<BackendInfo> {
  return call("ai_backend_info", {}, backendFallback());
}

export function aiSetBackend(preference: BackendPreference): Promise<BackendInfo> {
  return call("ai_set_backend", { preference }, {
    ...backendFallback(),
    preference,
    current: preference,
  });
}