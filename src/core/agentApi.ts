/** 剪辑智能体 / MCP / CLI / 网络设置的 Tauri 调用封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
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
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";

export const EVENT_AGENT = "agent-event";

const EMPTY_CONFIG: AgentConfig = { base_url: "", api_key: "", model: "" };

/**
 * 读类命令：浏览器里返回兜底值（设置页照常渲染），**不伪装成功**。
 * 写类命令走 [`act`]：先问能力表，不可用就抛一句人话。
 */
async function call<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isTauri()) return fallback;
  return invoke<T>(command, args);
}

/**
 * 写 / 动作类命令：浏览器里必须先过能力表。
 *
 * 以前这类命令也走 `call()`，于是 `agent_set_config` 在浏览器里"成功"返回一份空配置，
 * 设置页把用户刚填的 key 清空；`agent_send` 让 `running` 永远为 true，界面一直转圈。
 * 现在不可用就直接抛原因，宁可报错也不要假成功。
 */
async function act<T>(command: string, args: Record<string, unknown>, capability: string, label: string): Promise<T> {
  if (!isTauri()) await requireCapability(capability, label);
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
  return act("agent_set_config", { baseUrl, apiKey, model }, "agent", t("caps.feature.agent"));
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
  return act("agent_send", { sessionId, parentId, text }, "agent", t("caps.feature.agent"));
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
  return call("mcp_status", {}, {
    enabled: false,
    port: 50563,
    running: false,
    url: null,
    boundPort: null,
    fallback: false,
    portConflict: null,
  });
}

export function setMcpConfig(enabled: boolean, port: number): Promise<McpStatus> {
  return act("set_mcp_config", { enabled, port }, "mcp", t("caps.feature.mcp"));
}

const CLI_STATUS_FALLBACK: CliStatus = {
  state: "unsupported",
  command: "aicut",
  target: null,
  bundled: null,
  conflict: null,
  hint: null,
  manual_command: null,
  full_path: null,
};

export function cliStatus(): Promise<CliStatus> {
  return call("cli_status", {}, CLI_STATUS_FALLBACK);
}

export function installCli(): Promise<CliStatus> {
  return act("install_cli", {}, "cli", t("caps.feature.cli"));
}

export function uninstallCli(): Promise<CliStatus> {
  return act("uninstall_cli", {}, "cli", t("caps.feature.cli"));
}


export function networkConfig(): Promise<NetworkConfig> {
  return call("network_config", {}, { proxy_mode: "system", proxy_url: "" });
}

export function networkSetConfig(
  proxyMode: NetworkConfig["proxy_mode"],
  proxyUrl: string,
): Promise<NetworkConfig> {
  return act("network_set_config", { proxyMode, proxyUrl }, "network", t("caps.feature.network"));
}

export function networkStatus(): Promise<ProxyStatus> {
  return call("network_status", {}, { mode: "system", url: null, source: "系统代理" });
}

export async function networkProbe(
  proxyMode: NetworkConfig["proxy_mode"],
  proxyUrl: string,
): Promise<ProxyProbe> {
  if (!isTauri()) await requireCapability("network", t("caps.feature.network"));
  return invoke<ProxyProbe>("network_probe", { proxyMode, proxyUrl });
}

/** 浏览器预览 / 后端命令不可用时的兜底：保留完整选项，避免设置页看起来没有控件。 */
export function backendFallback(): BackendInfo {
  return {
    preference: "cpu",
    current: "cpu",
    recommended: "cpu",
    platform: "—",
    device: { vendor: "none", name: "", driver: null },
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
  // 写操作：浏览器里以前会返回"看起来切换成功"的假状态，现在直接给原因。
  return act("ai_set_backend", { preference }, "runtime", t("caps.feature.backend"));
}