/** 本地 AI 模型：清单、下载、取消、删除。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  modelCancel,
  modelCatalog,
  modelDownload,
  modelProbe,
  modelRemove,
  modelReveal,
  modelSetSourceConfig,
  modelSourceConfig,
  onModelProgress,
} from "@/core/modelApi";
import type {
  ModelProgress,
  ModelSourcePreference,
  ModelStatus,
  SourceProbe,
} from "@/types/models";

export const useModelsStore = defineStore("models", () => {
  const catalog = ref<ModelStatus[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 正在下载的模型 id（同一时刻最多一个）。 */
  const busyId = ref<string | null>(null);
  const progress = ref<ModelProgress | null>(null);
  /** 下载源区域偏好（自动 / 国内 / 国外）。 */
  const sourcePreference = ref<ModelSourcePreference>("auto");
  /** 用户配置的镜像前缀（留空 = 只用官方源）。 */
  const mirrors = ref<string[]>([]);
  /** GitHub 下载代理前缀（留空 = 直连）。 */
  const downloadPrefix = ref("");
  /** 「测试源」结果（按模型 id）。 */
  const probes = ref<Record<string, SourceProbe[]>>({});
  const probingId = ref<string | null>(null);

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed<number | null>(() => {
    const current = progress.value;
    if (!current || current.state !== "downloading" || current.total <= 0) return null;
    return Math.min(100, Math.round((current.received / current.total) * 100));
  });

  function installing(id: string): boolean {
    return busyId.value === id;
  }

  function ofFeature(feature: ModelStatus["feature"]): ModelStatus[] {
    return catalog.value.filter((model) => model.feature === feature);
  }

  function byId(id: string): ModelStatus | null {
    return catalog.value.find((model) => model.id === id) ?? null;
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      catalog.value = await modelCatalog();
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      loading.value = false;
    }
  }

  function cancelled(error: unknown): boolean {
    return String(error).includes("已取消");
  }

  /** 读取区域偏好、镜像与 GitHub 代理前缀。 */
  async function loadSourceConfig(): Promise<void> {
    try {
      const config = await modelSourceConfig();
      sourcePreference.value = config.preference;
      mirrors.value = config.mirrors;
      downloadPrefix.value = config.download_prefix;
    } catch (err) {
      error.value = String(err);
    }
  }

  async function saveSourceConfig(
    preference: ModelSourcePreference,
    nextMirrors: string[],
    nextDownloadPrefix: string,
  ): Promise<void> {
    const previous = {
      preference: sourcePreference.value,
      mirrors: mirrors.value,
      downloadPrefix: downloadPrefix.value,
    };
    sourcePreference.value = preference;
    mirrors.value = nextMirrors;
    downloadPrefix.value = nextDownloadPrefix;
    try {
      const config = await modelSetSourceConfig(
        preference,
        nextMirrors,
        nextDownloadPrefix,
      );
      sourcePreference.value = config.preference;
      mirrors.value = config.mirrors;
      downloadPrefix.value = config.download_prefix;
      error.value = null;
    } catch (err) {
      sourcePreference.value = previous.preference;
      mirrors.value = previous.mirrors;
      downloadPrefix.value = previous.downloadPrefix;
      error.value = String(err);
      throw err;
    }
  }

  /** 下载并等待完成；失败 / 取消时抛出，调用方可以据此中止后续动作。 */
  async function download(id: string): Promise<void> {
    if (busyId.value !== null) return;
    busyId.value = id;
    progress.value = {
      id,
      state: "downloading",
      received: 0,
      total: 0,
      message: null,
      source: null,
      source_kind: null,
      region: null,
    };
    try {
      await modelDownload(id);
      await load();
    } catch (err) {
      if (!cancelled(err)) error.value = String(err);
      throw err;
    } finally {
      if (busyId.value === id) busyId.value = null;
      progress.value = null;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await modelCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await modelRemove(id);
      error.value = null;
    } catch (err) {
      error.value = String(err);
    }
    await load();
  }

  async function reveal(id: string): Promise<void> {
    try {
      await modelReveal(id);
    } catch (err) {
      error.value = String(err);
    }
  }

  /** 探测一个模型的全部官方源（不下载文件）。 */
  async function probe(id: string): Promise<void> {
    if (probingId.value !== null) return;
    probingId.value = id;
    try {
      probes.value = { ...probes.value, [id]: await modelProbe(id) };
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      probingId.value = null;
    }
  }

  /** 订阅下载进度（幂等）。 */
  function watchProgress(): void {
    if (stopProgress || subscribing) return;
    subscribing = onModelProgress((payload) => {
      if (payload.state === "done") {
        busyId.value = null;
        progress.value = null;
        void load();
      } else if (payload.state === "error") {
        busyId.value = null;
        progress.value = null;
        if (payload.message && !payload.message.includes("已取消")) {
          error.value = payload.message;
        }
      } else {
        progress.value = payload;
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

  return {
    catalog,
    loading,
    error,
    busyId,
    progress,
    progressPct,
    sourcePreference,
    mirrors,
    downloadPrefix,
    probes,
    probingId,
    installing,
    ofFeature,
    byId,
    load,
    download,
    cancel,
    remove,
    reveal,
    probe,
    loadSourceConfig,
    saveSourceConfig,
    watchProgress,
  };
});
