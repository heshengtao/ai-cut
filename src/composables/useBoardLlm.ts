/**
 * 「设置 → 文本生成」里的供应商列表，以及文本生成节点的「模型 · 供应商」下拉。
 *
 * 一家供应商可以带多个模型；节点里选中的值形如 `<providerId>::<model>`，
 * 运行时就按这个供应商的端点发请求。模块级缓存：一张画布上开十个文本节点
 * 也只拉一次配置。
 */
import { computed, ref } from "vue";

import { agentConfig, textProviders } from "@/core/agentApi";
import { findLlmProvider, providerLabel } from "@/core/llmProviders";
import { useI18n } from "@/i18n";
import type { TextProvider } from "@/types/agent";

const TTL = 60_000;
/** 节点参数里供应商与模型的分隔符（模型名里不会出现）。 */
export const LLM_VALUE_SEP = "::";

const i18n = useI18n();
const providers = ref<TextProvider[]>([]);
const loading = ref(false);
/** 至少成功拉过一次配置：界面据此区分「还没有模型」和「还没拉到」。 */
const loaded = ref(false);
let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** 一家供应商可选的模型：拉到的列表 + 默认模型。 */
function modelsOf(provider: TextProvider): string[] {
  const list = provider.models.length ? [...provider.models] : [];
  if (provider.model && !list.includes(provider.model)) list.unshift(provider.model);
  return list;
}

/**
 * 节点下拉的候选：按**供应商分组**（供应商名做分组标题），下面是该家的模型。
 * 这样长列表也能一眼看出模型来自哪家，搜索框则在菜单最上面。
 */
const options = computed<{ id: string; label: string; group: string }[]>(() => {
  const out: { id: string; label: string; group: string }[] = [];
  for (const provider of providers.value) {
    if (!provider.enabled) continue;
    const name = provider.name.trim() || providerLabel(findLlmProvider(provider.preset), i18n.locale.value);
    for (const model of modelsOf(provider)) {
      out.push({ id: `${provider.id}${LLM_VALUE_SEP}${model}`, label: model, group: name || presetFallback() });
    }
  }
  return out;
});

function presetFallback(): string {
  return findLlmProvider("custom")?.nameZh ?? "Custom";
}

/** 没选模型时用的兜底（第一家启用的供应商 + 它的默认模型）。 */
const fallback = computed<{ id: string; label: string; group: string } | null>(() => {
  const provider =
    providers.value.find((item) => item.enabled) ?? providers.value[0] ?? null;
  if (!provider || !provider.model) return null;
  const name =
    provider.name.trim() || providerLabel(findLlmProvider(provider.preset), i18n.locale.value);
  return { id: `${provider.id}${LLM_VALUE_SEP}${provider.model}`, label: provider.model, group: name };
});

/** 拉一次供应商配置；`force` 忽略缓存（设置页保存 / 节点里手动刷新）。 */
export async function ensureBoardLlm(force = false): Promise<void> {
  if (!force && loadedAt && Date.now() - loadedAt < TTL) return;
  if (inflight) return inflight;
  inflight = (async () => {
    loading.value = true;
    try {
      let list = await textProviders().catch(() => []);
      if (list.length === 0) {
        // 老配置（只有单条 agent 配置）也让它出现在下拉里，升级后不用重新填。
        const config = await agentConfig().catch(() => null);
        if (config?.base_url?.trim() && config.model?.trim()) {
          list = [
            {
              id: "default",
              preset: config.provider || "custom",
              name: config.provider || "default",
              base_url: config.base_url,
              api_key: config.api_key,
              model: config.model,
              models: [config.model],
              enabled: true,
            },
          ];
        }
      }
      providers.value = list;
      loadedAt = Date.now();
      loaded.value = true;
    } finally {
      loading.value = false;
      inflight = null;
    }
  })();
  return inflight;
}

/** 把 `<providerId>::<model>` 拆开；非法值返回 null。 */
export function splitLlmValue(value: string): { provider: string; model: string } | null {
  const at = value.indexOf(LLM_VALUE_SEP);
  if (at <= 0) return null;
  const provider = value.slice(0, at);
  const model = value.slice(at + LLM_VALUE_SEP.length);
  if (!provider || !model) return null;
  return { provider, model };
}

export function useBoardLlm() {
  return {
    providers,
    options,
    fallback,
    loading,
    loaded,
    ensure: ensureBoardLlm,
    refresh: () => ensureBoardLlm(true),
    split: splitLlmValue,
  };
}
