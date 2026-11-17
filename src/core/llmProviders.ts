/**
 * 文本模型的供应商目录（设置 → 文本生成 / 文本生成节点共用）。
 *
 * 和 `crates/daemon/src/cloud_gen.rs` 里的图片 / 视频预置一样，这里只是一张**纯数据表**：
 * 不依赖 Vue、不发请求。界面按 `baseUrl` / `defaultModel` / `keyOptional` 填表，
 * 后端只有一条 OpenAI 兼容的请求路径（`/chat/completions` + `Authorization: Bearer`），
 * 所以每家都挑各自的兼容端点：Anthropic / Gemini 用的也是它们官方的 OpenAI 兼容层。
 *
 * 供应商清单与 ai-board 的 `packages/sdk/src/providers.ts`（语言模型部分）保持一致，
 * 少了两处历史包袱：Groq 与 xAI Grok 分开列，不再把 Grok 指向 Groq 的地址。
 */

export type LlmProviderGroup = "cloud" | "aggregator" | "local" | "custom";

export interface LlmProviderPreset {
  /** 稳定 id，存进 `ai.json` 的 `provider`。 */
  id: string;
  name: string;
  /** 中文名；没有就用 `name`。 */
  nameZh?: string;
  group: LlmProviderGroup;
  /** OpenAI 兼容端点根地址（不带 `/chat/completions`）。 */
  baseUrl: string;
  docsUrl?: string;
  /** 本地 / 自建端点允许留空 Key。 */
  keyOptional?: boolean;
  /** 选中供应商时预填的模型名。 */
  defaultModel?: string;
  /** 供应商不走 `/models`（例如 Perplexity），设置页的「获取模型」会被提示。 */
  noModelList?: boolean;
  note?: string;
  noteZh?: string;
}

/** 分组顺序：云端 → 聚合 → 本地 → 自定义。 */
export const LLM_PROVIDER_GROUPS: LlmProviderGroup[] = ["cloud", "aggregator", "local", "custom"];

/** 分组标题的 i18n key（`settings.text.group.<id>`）。 */
export function providerGroupKey(group: LlmProviderGroup): string {
  return `settings.text.group.${group}`;
}

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    group: "cloud",
    baseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    defaultModel: "gpt-4.1-mini",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    group: "cloud",
    baseUrl: "https://api.anthropic.com/v1",
    docsUrl: "https://docs.anthropic.com/en/api/openai-sdk",
    defaultModel: "claude-sonnet-4-5",
    note: "Uses Anthropic's OpenAI-compatible layer.",
    noteZh: "走 Anthropic 官方的 OpenAI 兼容层。",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    group: "cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    defaultModel: "gemini-2.5-flash",
    note: "Uses Gemini's OpenAI-compatible endpoint.",
    noteZh: "走 Gemini 官方的 OpenAI 兼容端点。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    group: "cloud",
    baseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://api-docs.deepseek.com/",
    defaultModel: "deepseek-chat",
  },
  {
    id: "dashscope",
    name: "Alibaba Bailian",
    nameZh: "阿里云百炼",
    group: "cloud",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    defaultModel: "qwen-plus",
  },
  {
    id: "zhipu",
    name: "Zhipu AI",
    nameZh: "智谱 AI",
    group: "cloud",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    docsUrl: "https://open.bigmodel.cn/dev/api",
    defaultModel: "glm-4.6",
  },
  {
    id: "ark",
    name: "Volcengine Ark",
    nameZh: "火山方舟",
    group: "cloud",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    docsUrl: "https://www.volcengine.com/docs/82379",
    defaultModel: "doubao-seed-1-6-250615",
  },
  {
    id: "moonshot",
    name: "Moonshot",
    nameZh: "月之暗面",
    group: "cloud",
    baseUrl: "https://api.moonshot.cn/v1",
    docsUrl: "https://platform.moonshot.cn/docs",
    defaultModel: "kimi-k2-0905-preview",
  },
  {
    id: "minimax",
    name: "MiniMax",
    group: "cloud",
    baseUrl: "https://api.minimaxi.com/v1",
    docsUrl: "https://platform.minimaxi.com/document",
    defaultModel: "MiniMax-M2",
  },
  {
    id: "stepfun",
    name: "StepFun",
    nameZh: "阶跃星辰",
    group: "cloud",
    baseUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-3",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    group: "cloud",
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://docs.mistral.ai/",
    defaultModel: "mistral-large-latest",
  },
  {
    id: "lingyi",
    name: "01.AI",
    nameZh: "零一万物",
    group: "cloud",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-lightning",
  },
  {
    id: "baichuan",
    name: "Baichuan",
    nameZh: "百川智能",
    group: "cloud",
    baseUrl: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
  },
  {
    id: "qianfan",
    name: "Baidu Qianfan",
    nameZh: "百度千帆",
    group: "cloud",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.5-turbo-128k",
  },
  {
    id: "hunyuan",
    name: "Tencent Hunyuan",
    nameZh: "腾讯混元",
    group: "cloud",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-turbos-latest",
  },
  {
    id: "groq",
    name: "Groq",
    group: "cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs",
    defaultModel: "llama-3.3-70b-versatile",
    note: "Fast OpenAI-compatible inference. Groq is not xAI Grok.",
    noteZh: "OpenAI 兼容的高速推理服务；这里是 Groq，不是 xAI 的 Grok。",
  },
  {
    id: "xai",
    name: "xAI Grok",
    group: "cloud",
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://docs.x.ai/",
    defaultModel: "grok-4",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    group: "cloud",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    docsUrl: "https://build.nvidia.com/",
  },
  {
    id: "github",
    name: "GitHub Models",
    group: "cloud",
    baseUrl: "https://models.github.ai/inference",
    docsUrl: "https://docs.github.com/en/github-models",
    defaultModel: "openai/gpt-4.1",
  },
  {
    id: "modelscope",
    name: "ModelScope",
    nameZh: "魔搭",
    group: "cloud",
    baseUrl: "https://api-inference.modelscope.cn/v1",
  },
  {
    id: "gitee",
    name: "Gitee AI",
    group: "cloud",
    baseUrl: "https://ai.gitee.com/v1",
  },
  {
    id: "jina",
    name: "Jina AI",
    group: "cloud",
    baseUrl: "https://api.jina.ai/v1",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    group: "cloud",
    baseUrl: "https://api.perplexity.ai",
    docsUrl: "https://docs.perplexity.ai/",
    defaultModel: "sonar-pro",
    noModelList: true,
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    nameZh: "硅基流动",
    group: "aggregator",
    baseUrl: "https://api.siliconflow.cn/v1",
    docsUrl: "https://docs.siliconflow.cn/",
    defaultModel: "Qwen/Qwen3-8B",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    group: "aggregator",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs",
    defaultModel: "deepseek/deepseek-chat",
  },
  {
    id: "together",
    name: "Together AI",
    group: "aggregator",
    baseUrl: "https://api.together.xyz/v1",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    group: "aggregator",
    baseUrl: "https://api.fireworks.ai/inference/v1",
  },
  {
    id: "aihubmix",
    name: "AiHubMix",
    group: "aggregator",
    baseUrl: "https://aihubmix.com/v1",
  },
  {
    id: "302ai",
    name: "302.AI",
    group: "aggregator",
    baseUrl: "https://api.302ai.cn/v1",
    docsUrl: "https://302.ai/",
  },
  {
    id: "ocoolai",
    name: "ocoolAI",
    group: "aggregator",
    baseUrl: "https://api.ocoolai.com/v1",
  },
  {
    id: "dmxapi",
    name: "DMXAPI",
    group: "aggregator",
    baseUrl: "https://www.dmxapi.cn/v1",
  },
  {
    id: "hyperbolic",
    name: "Hyperbolic",
    group: "aggregator",
    baseUrl: "https://api.hyperbolic.xyz/v1",
  },
  {
    id: "ppinfra",
    name: "PPInfra",
    group: "aggregator",
    baseUrl: "https://api.ppinfra.com/v3/openai/v1",
  },
  {
    id: "ollama",
    name: "Ollama",
    group: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    docsUrl: "https://ollama.com/",
    keyOptional: true,
    defaultModel: "qwen3:8b",
  },
  {
    id: "vllm",
    name: "vLLM",
    group: "local",
    baseUrl: "http://127.0.0.1:8000/v1",
    keyOptional: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    group: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    keyOptional: true,
  },
  {
    id: "sglang",
    name: "SGLang",
    group: "local",
    baseUrl: "http://127.0.0.1:3000/v1",
    keyOptional: true,
  },
  {
    id: "xinference",
    name: "Xinference",
    group: "local",
    baseUrl: "http://127.0.0.1:9997/v1",
    keyOptional: true,
  },
  {
    id: "localai",
    name: "LocalAI",
    group: "local",
    baseUrl: "http://127.0.0.1:8080/v1",
    keyOptional: true,
  },
  {
    id: "llamacpp",
    name: "llama.cpp",
    group: "local",
    baseUrl: "http://127.0.0.1:8080/v1",
    keyOptional: true,
  },
  {
    id: "dify",
    name: "Dify",
    group: "local",
    baseUrl: "http://127.0.0.1/v1",
    docsUrl: "https://docs.dify.ai/",
    keyOptional: true,
    defaultModel: "dify",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    nameZh: "自定义 OpenAI 兼容端点",
    group: "custom",
    baseUrl: "",
    note: "Any endpoint that speaks /chat/completions.",
    noteZh: "任何兼容 /chat/completions 的端点。",
  },
];

const BY_ID = new Map(LLM_PROVIDERS.map((preset) => [preset.id, preset]));

/** 按 id 取预置；未命中回退到自定义端点（用户可能手填了别家地址）。 */
export function findLlmProvider(id: string | null | undefined): LlmProviderPreset | undefined {
  if (!id) return undefined;
  return BY_ID.get(id) ?? BY_ID.get("custom");
}

/** 按分组取预置（设置页的分组下拉 / 分组标题）。 */
export function llmProvidersByGroup(): { group: LlmProviderGroup; items: LlmProviderPreset[] }[] {
  return LLM_PROVIDER_GROUPS.map((group) => ({
    group,
    items: LLM_PROVIDERS.filter((preset) => preset.group === group),
  })).filter((entry) => entry.items.length > 0);
}

/** 供应商显示名：中文界面优先 `nameZh`。 */
export function providerLabel(preset: LlmProviderPreset | undefined, locale = "en"): string {
  if (!preset) return "";
  return locale.toLowerCase().startsWith("zh") ? preset.nameZh ?? preset.name : preset.name;
}

/** 供应商说明：中文界面优先 `noteZh`。 */
export function providerNote(preset: LlmProviderPreset | undefined, locale = "en"): string {
  if (!preset) return "";
  return locale.toLowerCase().startsWith("zh") ? preset.noteZh ?? preset.note ?? "" : preset.note ?? "";
}

/**
 * 归一化端点地址：去掉末尾的 `/` 与误粘进来的接口路径。
 *
 * 用户经常把 `…/v1/chat/completions` 整段贴进来；后端自己会拼 `/chat/completions`，
 * 不归一化就会变成 `…/v1/chat/completions/chat/completions`。
 */
export function normalizeBaseUrl(raw: string): string {
  let base = String(raw ?? "").trim().replace(/\/+$/, "");
  for (const suffix of ["/chat/completions", "/completions", "/models", "/images/generations", "/images/edits"]) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length).replace(/\/+$/, "");
  }
  return base;
}

/**
 * 按端点地址猜供应商（老配置里没有 `provider` 字段时用）。
 *
 * 先比对完整地址，再比对去掉 `/v1` 的根地址，取匹配最长的那家。
 */
export function inferProviderId(baseUrl: string): string {
  const target = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!target) return "custom";
  const stripVersion = (value: string) => value.replace(/\/v\d+(beta)?$/, "");
  const targetRoot = stripVersion(target);
  let best: { id: string; length: number } | null = null;
  for (const preset of LLM_PROVIDERS) {
    const candidate = normalizeBaseUrl(preset.baseUrl).toLowerCase();
    if (!candidate) continue;
    const root = stripVersion(candidate);
    const match =
      target === candidate ||
      target.startsWith(`${candidate}/`) ||
      targetRoot === root ||
      targetRoot.startsWith(`${root}/`);
    if (match && (!best || root.length > best.length)) best = { id: preset.id, length: root.length };
  }
  return best?.id ?? "custom";
}

/** 这家供应商是否允许留空 Key（本地自建端点）。 */
export function providerAllowsEmptyKey(preset: LlmProviderPreset | undefined): boolean {
  return Boolean(preset?.keyOptional);
}
