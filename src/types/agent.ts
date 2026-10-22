/** 剪辑智能体的前后端协议（与 Rust 侧 agent 模块一一对应）。 */

export interface AgentConfig {
  /** OpenAI 兼容端点，形如 `https://api.openai.com/v1`。 */
  base_url: string;
  api_key: string;
  model: string;
}

export interface AgentProbe {
  ok: boolean;
  detail: string;
  ms: number;
}

export interface AgentToolCallRef {
  id: string;
  name: string;
  /** 原始 arguments JSON 文本。 */
  arguments: string;
}

export interface AgentNode {
  id: string;
  parent: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning: string | null;
  tool_calls: AgentToolCallRef[];
  tool_call_id: string | null;
  name: string | null;
  created_at: number;
  error: string | null;
}

export interface AgentSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  nodes: AgentNode[];
  head: string | null;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  updated_at: number;
  count: number;
}

export type AgentEvent =
  | { type: "turn_started"; session_id: string; user_node: AgentNode }
  | { type: "delta"; node_id: string; text: string }
  | { type: "reasoning"; node_id: string; text: string }
  | { type: "tool_call"; node_id: string; call_id: string; name: string; args: unknown }
  | { type: "tool_result"; node_id: string; call_id: string; ok: boolean; output: string }
  | { type: "node_added"; node: AgentNode }
  | { type: "turn_finished"; session_id: string; head: string; title: string; stopped: boolean }
  | { type: "error"; message: string };

/** MCP 服务器状态。 */
export interface McpStatus {
  enabled: boolean;
  port: number;
  running: boolean;
  url: string | null;
}

/** 命令行挂载状态。 */
export interface CliStatus {
  state: "installed" | "missing" | "conflict" | "system" | "unsupported";
  command: string;
  target: string | null;
  bundled: string | null;
  conflict: string | null;
  hint: "dev_build" | "appimage" | "needs_manual" | null;
  manual_command: string | null;
  full_path: string | null;
}

export type ProxyMode = "direct" | "system" | "manual";

/** 本地 AI 执行后端。 */
export type BackendPreference = "cpu" | "coreml" | "directml";

export interface BackendOption {
  kind: BackendPreference;
  label: string;
  note: string;
  available: boolean;
}

export interface BackendInfo {
  preference: BackendPreference;
  current: BackendPreference;
  platform: string;
  options: BackendOption[];
}

export interface NetworkConfig {
  proxy_mode: ProxyMode;
  proxy_url: string;
}

export interface ProxyStatus {
  mode: ProxyMode;
  url: string | null;
  /** 人类可读的“实际走哪条路”。 */
  source: string;
}

export interface ProxyProbe {
  ok: boolean;
  detail: string;
  ms: number;
}