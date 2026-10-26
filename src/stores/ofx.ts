/** OFX 插件探测缓存：同一 bundle 只探测一次，供检查器与预览共享。 */
import { ref } from "vue";
import { defineStore } from "pinia";
import type { OfxEditorTarget, OfxPluginInfo } from "@/types/plugins";
import { ofxProbe } from "@/core/ofxApi";

export const useOfxStore = defineStore("ofx", () => {
  const cache = new Map<string, OfxPluginInfo[]>();
  const pending = new Map<string, Promise<OfxPluginInfo[]>>();
  const loadingBundle = ref<string | null>(null);
  const error = ref<string | null>(null);
  const editorTarget = ref<OfxEditorTarget | null>(null);

  function cacheKey(bundle: string, context?: string | null): string {
    return `${bundle}\u0000${context ?? ""}`;
  }

  function cached(bundle: string, context?: string | null): OfxPluginInfo[] | null {
    return cache.get(cacheKey(bundle, context)) ?? null;
  }

  function find(bundle: string, plugin: string): OfxPluginInfo | null {
    return cache.get(cacheKey(bundle))?.find((item) => item.identifier === plugin) ?? null;
  }

  async function probe(
    bundle: string,
    force = false,
    context?: string | null,
  ): Promise<OfxPluginInfo[]> {
    const key = cacheKey(bundle, context);
    if (!force) {
      const hit = cache.get(key);
      if (hit) return hit;
      const running = pending.get(key);
      if (running) return running;
    }
    loadingBundle.value = bundle;
    const task = ofxProbe(bundle, null, context ?? null)
      .then((plugins) => {
        cache.set(key, plugins);
        error.value = null;
        return plugins;
      })
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        error.value = message;
        throw reason;
      })
      .finally(() => {
        pending.delete(key);
        if (loadingBundle.value === bundle) loadingBundle.value = null;
      });
    pending.set(key, task);
    return task;
  }

  async function ensure(
    bundle: string,
    context?: string | null,
  ): Promise<OfxPluginInfo[]> {
    return cache.get(cacheKey(bundle, context)) ?? probe(bundle, false, context);
  }

  /** 从特效卡片打开：可编辑该片段（以及多选片段）上的效果实例。 */
  function openEffectTarget(target: {
    bundle: string;
    plugin: string;
    name?: string;
    clipId: string;
    effectId: string;
    selectedClipIds?: string[];
  }): void {
    editorTarget.value = { kind: "effect", ...target };
  }

  /** 从检查器转场块打开：编辑片段边缘的 OFX 转场实例。 */
  function openTransitionTarget(target: {
    bundle: string;
    plugin: string;
    name?: string;
    clipId: string;
    edge: "in" | "out";
  }): void {
    editorTarget.value = { kind: "transition", ...target };
  }

  /** 从插件列表打开：只读查看插件默认参数。 */
  function openPluginTarget(target: {
    bundle: string;
    plugin: string;
    name?: string;
  }): void {
    editorTarget.value = { kind: "plugin", ...target };
  }

  function closeEditorTarget(): void {
    editorTarget.value = null;
  }

  function clear(): void {
    cache.clear();
    pending.clear();
    error.value = null;
    loadingBundle.value = null;
    editorTarget.value = null;
  }

  return {
    loadingBundle,
    error,
    editorTarget,
    cached,
    find,
    probe,
    ensure,
    openEffectTarget,
    openTransitionTarget,
    openPluginTarget,
    closeEditorTarget,
    clear,
  };
});
