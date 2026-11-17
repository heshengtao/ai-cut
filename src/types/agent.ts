/** 剪辑智能体的前后端协议（与 Rust 侧 agent 模块一一对应）。 */

/** 「文本生成」里配置的一家供应商。 */
export interface TextProvider {
  id: string;
  /** 预设 id（`openai` / `deepseek` / `ollama` / `custom` …），见 `core/llmProviders`。 */
  preset: string;
  /** 显示名（用户可改）。 */
  name: string;
  /** OpenAI 兼容端点，形如 `https://api.openai.com/v1`。 */
  base_url: string;
  api_key: string;
  /** 默认模型；节点没单独选模型时用它。 */
  model: string;
  /** 可选的模型列表（「获取模型列表」拉到的），空 = 只有默认模型。 */
  models: string[];
  enabled: boolean;
}

export interface AgentConfig {
  /** 供应商 id（`openai` / `deepseek` / `ollama` / `custom` …），见 `core/llmProviders`。 */
  provider: string;
  /** OpenAI 兼容端点，形如 `https://api.openai.com/v1`。 */
  base_url: string;
  api_key: string;
  model: string;
  /** 当前生效供应商的镜像之外，完整供应商列表（文本生成页面 / 节点用）。 */
  providers: TextProvider[];
}

/** 文本生成节点的一条对话消息。 */
/** 多模态 content part：文本 + （可选）图片 / 视频 URL（data URL 或 https）。 */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
}

/** 文本模型返回：内容 + 思考过程（推理模型才有）。 */
export interface LlmReply {
  text: string;
  reasoning: string;
}

/** 画布文本节点的流式片段。 */
export interface LlmStreamEvent {
  requestId: string;
  kind: "delta" | "reasoning";
  text: string;
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

/** MCP 服务器状态（与后端 `mcp::McpStatus` 对应）。 */
export interface McpStatus {
  enabled: boolean;
  /** 配置里写的端口（用户填的；下次启动还会先试它）。 */
  port: number;
  running: boolean;
  /** 实际接入地址；未监听时为 null。 */
  url: string | null;
  /** 实际监听的端口；配置端口被占用、退回临时端口时它会和 `port` 不同。 */
  boundPort?: number | null;
  /** 本次运行退回了系统临时端口。 */
  fallback?: boolean;
  /** 退回临时端口的原因。 */
  portConflict?: "busy" | "denied" | null;
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

/** 本地 AI 执行后端。CUDA 12 / CUDA 13 是两套独立运行时（对应 ai-daw 的两个选项）。 */
export type BackendPreference = "cpu" | "coreml" | "directml" | "cuda12" | "cuda13";

export interface BackendOption {
  kind: BackendPreference;
  label: string;
  note: string;
  /** 本机平台是否支持（不支持的不会出现在设置页的分段控件里）。 */
  available: boolean;
  /** 它需要哪一份运行时（`cpu` / `cuda` / `cuda13` / …）。 */
  runtime: string;
  /** 那份运行时装好了没有。 */
  runtime_installed: boolean;
  /** 需要下载多少字节（0 = 已装好）。 */
  download_bytes: number;
  /** 还缺哪些组件（运行时 id，例如 `cufft13`）。空 = 齐了。 */
  missing: string[];
}

/** 本机显卡画像（只用来推荐后端 / 写引导文案，不参与建会话）。 */
export interface DeviceProfile {
  /** `nvidia` / `amd` / `intel` / `apple` / `none`。 */
  vendor: "nvidia" | "amd" | "intel" | "apple" | "none" | string;
  /** 显卡名（读不到为空串）。 */
  name: string;
  /** 驱动版本（只有 NVIDIA 读得到）。 */
  driver: string | null;
}

export interface BackendInfo {
  preference: BackendPreference;
  current: BackendPreference;
  /** 本机推荐的后端（NVIDIA 新驱动为 `cuda13`，老驱动 `cuda12`；
   *  Windows 的 AMD / Intel 为随包的 `directml`；其余 `cpu`）。 */
  recommended: BackendPreference;
  platform: string;
  /** 本机显卡画像。 */
  device: DeviceProfile;
  /** 进程里已经加载的运行时（`cuda` / `cuda13` / `directml` / `cpu`）；未加载为 null。 */
  loaded_runtime: string | null;
  /** 切换过运行时 / 补装过组件，需要重启才生效。 */
  restart_required: boolean;
  /** 当前选中的 CUDA provider 是否真的注册进了 ONNX Runtime。 */
  ep_ready: boolean;
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