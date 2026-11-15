/** 顶部三视图：预览 / 画布 / 剧集。只切换主窗口内容，外壳与右侧面板不动。 */
import { ref } from "vue";
import { defineStore } from "pinia";

export type AppView = "preview" | "board" | "series";

const KEY = "ai-cut-view";

/** 深链：`#/board` 这类 hash 优先于上次记住的视图。 */
const HASH_VIEWS: Record<string, AppView> = {
  "#/preview": "preview",
  "#/board": "board",
  "#/series": "series",
};

export const APP_VIEWS: AppView[] = ["preview", "board", "series"];

/** 是否合法视图值。 */
export function isAppView(value: unknown): value is AppView {
  return typeof value === "string" && (APP_VIEWS as string[]).includes(value);
}

/** 解析 hash 里的视图；不是视图深链时返回 null。 */
export function parseViewHash(hash: string): AppView | null {
  return HASH_VIEWS[hash] ?? null;
}

function hashView(): AppView | null {
  if (typeof window === "undefined") return null;
  return parseViewHash(window.location.hash);
}

function storedView(): AppView | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return isAppView(raw) ? raw : null;
  } catch {
    return null;
  }
}

export const useViewStore = defineStore("view", () => {
  /** 当前视图：hash 深链 > 上次记住的 > 预览。 */
  const view = ref<AppView>(hashView() ?? storedView() ?? "preview");

  function persist(): void {
    try {
      window.localStorage.setItem(KEY, view.value);
    } catch {
      // 无痕模式 / 存储被禁用：只影响"记住"，不影响本次使用。
    }
  }

  function setView(next: AppView): void {
    if (view.value === next) return;
    view.value = next;
    persist();
  }

  /** 浏览器前进/后退或外部改 hash 时跟随。 */
  function restoreFromHash(): void {
    const next = hashView();
    if (next && next !== view.value) {
      view.value = next;
      persist();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", restoreFromHash);
  }

  return { view, setView, restoreFromHash };
});
