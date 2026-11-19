/**
 * 插件商店的调用封装：搜索、安装、索引源。
 *
 * 索引的抓取与校验都在 daemon 里做，这里只拿「一页结果」。
 */
import { invoke } from "@/platform/tauri";
import type { MarketSearchResult } from "@/types/pluginMarket";
import type { PluginStatus } from "@/types/pluginHost";

export async function pluginMarketSource(): Promise<string> {
  const result = await invoke<{ url: string }>("plugin_market_sources");
  return result.url;
}

export async function pluginMarketSetSource(url: string): Promise<string> {
  const result = await invoke<{ url: string }>("plugin_market_set_source", { url });
  return result.url;
}

export async function pluginMarketSearch(options: {
  text?: string;
  offset?: number;
  limit?: number;
  force?: boolean;
} = {}): Promise<MarketSearchResult> {
  return invoke<MarketSearchResult>("plugin_market_search", {
    text: options.text ?? "",
    offset: options.offset ?? 0,
    limit: options.limit ?? 20,
    force: options.force ?? false,
  });
}

export async function pluginMarketInstall(name: string, version = ""): Promise<PluginStatus> {
  const result = await invoke<{ plugin: PluginStatus }>("plugin_market_install", {
    name,
    version,
  });
  return result.plugin;
}
