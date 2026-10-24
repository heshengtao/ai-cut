/** OFX 插件：已安装清单（插件面板）与注册表/管理器（下载管理器）。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onPluginProgress,
  pickPluginBundle,
  pickPluginFile,
  pluginCancel,
  pluginImport,
  pluginInstall,
  pluginInstalled,
  pluginOpen,
  pluginRegistry,
  pluginRemove,
  pluginReveal,
} from "@/core/pluginApi";
import type {
  PluginProgress,
  PluginRegistrySource,
  PluginStatus,
} from "@/types/plugins";

export const usePluginsStore = defineStore("plugins", () => {
  /** 注册表 + 已安装/外部状态，供下载管理器使用。 */
  const registry = ref<PluginStatus[]>([]);
  /** 已安装插件（含托管与外部），供插件面板使用；不依赖注册表网络。 */
  const installedPlugins = ref<PluginStatus[]>([]);
  const source = ref<PluginRegistrySource>("bundled");
  const fetchedAt = ref<number | null>(null);
  const loading = ref(false);
  const installedLoading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const busySlug = ref<string | null>(null);
  const importing = ref(false);
  const progress = ref<PluginProgress | null>(null);
  const selectedSlug = ref<string | null>(null);
  /** 每次安装/删除/导入后递增，面板可据此刷新。 */
  const revision = ref(0);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed<number | null>(() => {
    const current = progress.value;
    if (!current || current.phase !== "downloading" || current.total <= 0) return null;
    return Math.min(100, Math.round((current.received / current.total) * 100));
  });

  const installedCount = computed(() => installedPlugins.value.length);

  const updatesCount = computed(
    () => registry.value.filter((plugin) => plugin.update_available).length,
  );

  /** 下载管理器：本管理器装过的（可删除/更新）。 */
  const managedInstalled = computed(() =>
    registry.value.filter((plugin) => plugin.installed && plugin.managed),
  );

  /** 下载管理器：用户自己装在标准 OFX 目录里的（只读）。 */
  const externalPlugins = computed(() =>
    registry.value.filter((plugin) => plugin.external),
  );

  /** 下载管理器：注册表条目（含已安装标记，用于更新/重装）。 */
  const availablePlugins = computed(() =>
    registry.value.filter((plugin) => !plugin.external),
  );

  /** 插件编辑器当前选中的插件。 */
  const selected = computed<PluginStatus | null>(() => {
    const slug = selectedSlug.value;
    if (!slug) return null;
    return (
      installedPlugins.value.find((plugin) => plugin.slug === slug) ??
      registry.value.find((plugin) => plugin.slug === slug) ??
      null
    );
  });

  function isBusy(slug: string): boolean {
    return busySlug.value === slug;
  }

  function select(slug: string): void {
    selectedSlug.value = slug;
  }

  function matches(plugin: PluginStatus, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (needle === "") return true;
    return [
      plugin.name,
      plugin.slug,
      plugin.vendor ?? "",
      plugin.description ?? "",
      plugin.license,
      ...plugin.tags,
      ...plugin.plugin_types,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  }

  async function load(force = false): Promise<void> {
    loading.value = true;
    try {
      const response = await pluginRegistry(force);
      registry.value = response.plugins;
      source.value = response.source;
      fetchedAt.value = response.fetched_at;
      loaded.value = true;
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      loading.value = false;
    }
  }

  /** 只拉已安装清单（插件面板用，不请求注册表）。 */
  async function loadInstalled(): Promise<void> {
    installedLoading.value = true;
    try {
      installedPlugins.value = await pluginInstalled();
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      installedLoading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await load(true);
    await loadInstalled();
  }

  function watchProgress(): void {
    if (stopProgress || subscribing) return;
    subscribing = onPluginProgress((payload) => {
      progress.value = payload;
      busySlug.value = payload.slug;
      if (payload.phase === "done") {
        busySlug.value = null;
        progress.value = null;
        revision.value += 1;
        void load();
        void loadInstalled();
      } else if (payload.phase === "error") {
        busySlug.value = null;
        progress.value = null;
        if (payload.message && !payload.message.includes("已取消")) {
          error.value = payload.message;
        }
      }
    })
      .then((off) => {
        stopProgress = off;
        subscribing = null;
      })
      .catch(() => {
        subscribing = null;
      });
  }

  async function install(slug: string): Promise<void> {
    if (busySlug.value !== null) return;
    busySlug.value = slug;
    progress.value = {
      slug,
      phase: "downloading",
      received: 0,
      total: 0,
      message: null,
    };
    try {
      await pluginInstall(slug);
      revision.value += 1;
      await load();
      await loadInstalled();
    } catch (err) {
      if (!String(err).includes("已取消")) error.value = String(err);
    } finally {
      if (busySlug.value === slug) busySlug.value = null;
      progress.value = null;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await pluginCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  async function remove(slug: string): Promise<void> {
    try {
      await pluginRemove(slug);
      revision.value += 1;
      await load();
      await loadInstalled();
      if (selectedSlug.value === slug) selectedSlug.value = null;
    } catch (err) {
      error.value = String(err);
    }
  }

  async function open(slug: string): Promise<void> {
    try {
      await pluginOpen(slug);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function reveal(slug: string): Promise<void> {
    try {
      await pluginReveal(slug);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function importBundle(): Promise<boolean> {
    const path = await pickPluginBundle();
    if (!path) return false;
    return importPath(path);
  }

  async function importFile(): Promise<boolean> {
    const path = await pickPluginFile();
    if (!path) return false;
    return importPath(path);
  }

  async function importPath(path: string): Promise<boolean> {
    if (importing.value) return false;
    importing.value = true;
    try {
      await pluginImport(path);
      revision.value += 1;
      await load();
      await loadInstalled();
      return true;
    } catch (err) {
      error.value = String(err);
      return false;
    } finally {
      importing.value = false;
    }
  }

  return {
    registry,
    installedPlugins,
    source,
    fetchedAt,
    loading,
    installedLoading,
    loaded,
    error,
    busySlug,
    importing,
    progress,
    progressPct,
    selectedSlug,
    revision,
    installedCount,
    updatesCount,
    managedInstalled,
    externalPlugins,
    availablePlugins,
    selected,
    isBusy,
    select,
    matches,
    load,
    loadInstalled,
    refresh,
    watchProgress,
    install,
    cancel,
    remove,
    open,
    reveal,
    importBundle,
    importFile,
    importPath,
  };
});
