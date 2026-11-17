/**
 * 插件宿主 store：把 daemon 的「名册」翻译成前端「已装载的注册」。
 *
 * 分工：daemon 只管名册与磁盘（谁装了、启用否、入口在哪、是不是兼容），
 * 这里只管把启用的客户端半装进内核、禁用时拆干净。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

import {
  pluginHostInstallLocal,
  pluginHostList,
  pluginHostRemove,
  pluginHostSetEnabled,
  pluginHostStart,
  pluginHostStop,
} from "@/core/pluginHostApi";
import { pluginMarketInstall, pluginMarketSearch } from "@/core/pluginMarketApi";
import type { MarketSearchHit } from "@/types/pluginMarket";
import {
  loadPluginModule,
  type LoadedPlugin,
  type PluginClientModule,
} from "@/core/plugins/loader";
import type { PluginStatus } from "@/types/pluginHost";

/** 模块导入器由调用方注入（桌面 / 浏览器 URL 解析不同，store 不关心）。 */
export type PluginImporter = (entry: {
  id: string;
  client: string;
  rev: string;
}) => Promise<PluginClientModule>;

export const usePluginHostStore = defineStore("pluginHost", () => {
  const plugins = ref<PluginStatus[]>([]);
  const failed = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = new Map<string, LoadedPlugin>();

  // ---- 商店 ----
  const marketHits = ref<MarketSearchHit[]>([]);
  const marketTotal = ref(0);
  /** `network` / `cache` / `stale-cache`。 */
  const marketSource = ref("");
  const marketLoading = ref(false);
  const marketError = ref<string | null>(null);

  function note(entry: PluginStatus, message: string): void {
    const line = `${entry.id}: ${message}`;
    if (!failed.value.includes(line)) failed.value = [...failed.value, line];
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      plugins.value = await pluginHostList();
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading.value = false;
    }
  }

  /** 装载一个插件；失败只记一条，不影响其它插件。 */
  async function loadOne(entry: PluginStatus, importer: PluginImporter): Promise<void> {
    if (loaded.has(entry.id)) return;
    if (!entry.client) return;
    if (!entry.compatible) {
      note(entry, entry.lastError ?? "与当前版本不兼容");
      return;
    }
    try {
      // 宿主半先起（失败只记录，不阻断客户端半——有的插件只有一半）。
      if (entry.hostFile) {
        try {
          await pluginHostStart(entry.id);
        } catch (reason) {
          note(entry, reason instanceof Error ? reason.message : String(reason));
        }
      }
      const module = await importer({ id: entry.id, client: entry.client, rev: entry.rev });
      loaded.set(entry.id, loadPluginModule({ id: entry.id, url: entry.client }, module));
    } catch (reason) {
      note(entry, reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function loadEnabled(importer: PluginImporter): Promise<void> {
    for (const entry of plugins.value) {
      if (!entry.enabled) continue;
      await loadOne(entry, importer);
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    plugins.value = await pluginHostSetEnabled(id, enabled);
    if (!enabled) {
      loaded.get(id)?.dispose();
      loaded.delete(id);
      await pluginHostStop(id);
      failed.value = failed.value.filter((line) => !line.startsWith(`${id}:`));
    }
  }

  async function remove(id: string): Promise<void> {
    loaded.get(id)?.dispose();
    loaded.delete(id);
    await pluginHostStop(id);
    plugins.value = await pluginHostRemove(id);
    failed.value = failed.value.filter((line) => !line.startsWith(`${id}:`));
  }

  async function installLocal(path: string, importer?: PluginImporter): Promise<void> {
    const status = await pluginHostInstallLocal(path);
    await refresh();
    if (importer && status.enabled) {
      const entry = plugins.value.find((item) => item.id === status.id) ?? status;
      await loadOne(entry, importer);
    }
  }

  async function searchMarket(text = "", force = false): Promise<void> {
    marketLoading.value = true;
    marketError.value = null;
    try {
      const result = await pluginMarketSearch({ text, limit: 50, force });
      marketHits.value = result.hits;
      marketTotal.value = result.total;
      marketSource.value = result.source;
    } catch (reason) {
      marketError.value = reason instanceof Error ? reason.message : String(reason);
    } finally {
      marketLoading.value = false;
    }
  }

  async function installFromMarket(name: string, version = ""): Promise<PluginStatus> {
    marketError.value = null;
    const plugin = await pluginMarketInstall(name, version);
    await refresh();
    await searchMarket("", true);
    return plugin;
  }

  /** 卸载全部（测试 / 切换数据目录用）。 */
  function disposeAll(): void {
    for (const plugin of loaded.values()) plugin.dispose();
    loaded.clear();
  }

  return {
    plugins,
    failed,
    loading,
    error,
    refresh,
    loadEnabled,
    setEnabled,
    remove,
    installLocal,
    disposeAll,
    marketHits,
    marketTotal,
    marketSource,
    marketLoading,
    marketError,
    searchMarket,
    installFromMarket,
  };
});
