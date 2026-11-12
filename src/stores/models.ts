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
  modelSaveHfToken,
  modelSetSourceConfig,
  modelSourceConfig,
  onModelProgress,
} from "@/core/modelApi";
import type {
  ModelAuth,
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
  /** 等待用户授权的请求（非空时界面弹授权窗）。 */
  const pendingAuth = ref<{ id: string; auth: ModelAuth } | null>(null);
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

  /**
   * 下载并等待完成；失败 / 取消时抛出，调用方可以据此中止后续动作。
   *
   * **已有下载时抛异常而不是静默返回**：以前这里直接 `return`，链式下载被无声吞掉，
   * 界面看起来就是「点了确认但什么都没发生」。现在由 `useDownloadsStore` 排队，
   * 真撞上了也要能说出原因。
   */
  async function download(id: string): Promise<void> {
    if (busyId.value !== null) {
      throw new Error(`已有模型正在下载：${busyId.value}`);
    }
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
      const auth = await modelDownload(id);
      if (auth) {
        // gated 仓库：不是失败，是「要先去网页同意 + 给个 token」。
        pendingAuth.value = { id, auth };
        return;
      }
      await load();
    } catch (err) {
      if (!cancelled(err)) error.value = String(err);
      throw err;
    } finally {
      if (busyId.value === id) busyId.value = null;
      progress.value = null;
    }
  }

  /** 关掉授权弹窗（用户不理它）。 */
  function dismissAuth(): void {
    pendingAuth.value = null;
  }

  /**
   * 保存 HF token 并**重试**刚才被挡下的那次下载。
   *
   * 授权弹窗拿到 token 后走这条路：写设置 → 清掉待办 → 重新调 `download()`。
   */
  async function authorizeAndRetry(token: string): Promise<void> {
    await modelSaveHfToken(token);
    const target = pendingAuth.value;
    pendingAuth.value = null;
    if (!target) return;
    await download(target.id);
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
    pendingAuth,
    dismissAuth,
    authorizeAndRetry,
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
