/** stable-diffusion.cpp 视频引擎：清单、下载、删除、后端选择。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  onSdcppProgress,
  sdcppBusy,
  sdcppCancel,
  sdcppCatalog,
  sdcppInfo,
  sdcppInstall,
  sdcppRemove,
  sdcppReveal,
  sdcppSelect,
  sdcppSetBackend,
} from "@/core/sdcppApi";
import type { SdcppInfo, SdcppProgress, SdcppStatus } from "@/types/sdcpp";

export const useSdcppStore = defineStore("sdcpp", () => {
  const items = ref<SdcppStatus[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 正在下载的引擎 id（同一时刻最多一个）。 */
  const busyId = ref<string | null>(null);
  const progress = ref<SdcppProgress | null>(null);
  const info = ref<SdcppInfo | null>(null);
  const infoLoading = ref(false);
  /** 从设置页跳过来时高亮哪个引擎（几秒后自动消失）。 */
  const focus = ref<string | null>(null);
  let focusTimer: ReturnType<typeof setTimeout> | null = null;

  function requestFocus(id = "sdcpp-cuda12"): void {
    focus.value = id;
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (focus.value === id) focus.value = null;
      focusTimer = null;
    }, 2600);
  }

  const progressPct = computed<number | null>(() => {
    const current = progress.value;
    if (!current || current.state !== "downloading" || current.total <= 0) return null;
    return Math.min(100, Math.round((current.received / current.total) * 100));
  });

  const installed = computed(() => items.value.filter((item) => item.installed));
  const ready = computed(() => installed.value.length > 0);
  const current = computed(() => items.value.find((item) => item.selected) ?? null);

  function installing(id: string): boolean {
    return busyId.value === id;
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      items.value = await sdcppCatalog();
      let busy = true;
      try {
        busy = await sdcppBusy();
      } catch {
        busy = true;
      }
      if (!busy) {
        busyId.value = null;
        progress.value = null;
      }
      error.value = null;
    } catch (err) {
      error.value = String(err);
    } finally {
      loading.value = false;
    }
  }

  async function loadInfo(): Promise<void> {
    infoLoading.value = true;
    try {
      info.value = await sdcppInfo();
    } catch {
      info.value = null;
    } finally {
      infoLoading.value = false;
    }
  }

  function cancelled(err: unknown): boolean {
    return String(err).includes("已取消");
  }

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  function watchProgress(): void {
    if (stopProgress || subscribing) return;
    subscribing = onSdcppProgress((payload) => {
      if (payload.state === "done") {
        busyId.value = null;
        progress.value = null;
        void load();
        void loadInfo();
      } else if (payload.state === "error") {
        busyId.value = null;
        progress.value = null;
        if (payload.message) error.value = payload.message;
      } else {
        busyId.value = payload.id;
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

  async function install(id: string, force = false): Promise<void> {
    if (busyId.value !== null && busyId.value !== id) {
      error.value = "已有引擎正在下载，请先等它结束或取消。";
      return;
    }
    busyId.value = id;
    progress.value = { id, state: "downloading", received: 0, total: 0, message: null };
    error.value = null;
    try {
      await sdcppInstall(id, force);
    } catch (err) {
      busyId.value = null;
      progress.value = null;
      if (!cancelled(err)) error.value = String(err);
      return;
    }
    busyId.value = null;
    progress.value = null;
    await load();
    await loadInfo();
  }

  async function cancel(): Promise<void> {
    try {
      await sdcppCancel();
    } catch {
      // 状态事件会纠正。
    } finally {
      busyId.value = null;
      progress.value = null;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await sdcppRemove(id);
    } catch (err) {
      error.value = String(err);
    }
    await load();
    await loadInfo();
  }

  async function reveal(id: string): Promise<void> {
    try {
      await sdcppReveal(id);
    } catch (err) {
      error.value = String(err);
    }
  }

  async function select(id: string | null): Promise<void> {
    try {
      await sdcppSelect(id);
    } catch (err) {
      error.value = String(err);
    }
    await load();
  }

  async function setBackend(backend: string): Promise<void> {
    try {
      info.value = await sdcppSetBackend(backend);
      error.value = null;
    } catch (err) {
      error.value = String(err);
      throw err;
    }
  }

  return {
    items,
    loading,
    error,
    busyId,
    progress,
    progressPct,
    info,
    infoLoading,
    focus,
    installed,
    ready,
    current,
    requestFocus,
    installing,
    load,
    loadInfo,
    watchProgress,
    install,
    cancel,
    remove,
    reveal,
    select,
    setBackend,
  };
});
