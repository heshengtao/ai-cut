import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { isAppView, parseViewHash, useViewStore } from "@/stores/view";

/** 造一个最小 window（node 测试环境没有 DOM）。 */
function stubWindow(hash = "", stored: string | null = null): Map<string, string> {
  const storage = new Map<string, string>();
  if (stored !== null) storage.set("ai-cut-view", stored);
  (globalThis as unknown as { window: unknown }).window = {
    location: { hash },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    addEventListener: vi.fn(),
  };
  return storage;
}

beforeEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  setActivePinia(createPinia());
});

describe("parseViewHash", () => {
  it("只认三个视图深链", () => {
    expect(parseViewHash("#/board")).toBe("board");
    expect(parseViewHash("#/series")).toBe("series");
    expect(parseViewHash("#/preview")).toBe("preview");
    expect(parseViewHash("#/settings")).toBeNull();
    expect(parseViewHash("")).toBeNull();
  });
});

describe("isAppView", () => {
  it("拒绝非视图值", () => {
    expect(isAppView("board")).toBe(true);
    expect(isAppView("settings")).toBe(false);
    expect(isAppView(null)).toBe(false);
    expect(isAppView(1)).toBe(false);
  });
});

describe("useViewStore", () => {
  it("没有 hash 也没有记录时是预览", () => {
    stubWindow();
    expect(useViewStore().view).toBe("preview");
  });

  it("没有 hash 时用上次记住的视图", () => {
    stubWindow("", "series");
    expect(useViewStore().view).toBe("series");
  });

  it("hash 优先于上次记住的视图", () => {
    stubWindow("#/board", "series");
    expect(useViewStore().view).toBe("board");
  });

  it("非法记录被忽略", () => {
    stubWindow("", "banana");
    expect(useViewStore().view).toBe("preview");
  });

  it("setView 会写回 localStorage，重复设置不重复写", () => {
    const storage = stubWindow();
    const store = useViewStore();
    store.setView("board");
    expect(store.view).toBe("board");
    expect(storage.get("ai-cut-view")).toBe("board");
    const spy = vi.spyOn(storage as never, "set" as never);
    store.setView("board");
    expect(spy).not.toHaveBeenCalled();
  });

  it("restoreFromHash 跟随 hash 变化", () => {
    stubWindow("#/board");
    const store = useViewStore();
    (window as unknown as { location: { hash: string } }).location.hash = "#/series";
    store.restoreFromHash();
    expect(store.view).toBe("series");
  });
});
