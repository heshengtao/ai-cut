import { beforeEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  releaseNotesUrl,
  shouldNotice,
  takeUpdateNotice,
} from "@/core/updateNotice";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
});

describe("compareVersions", () => {
  it("按数字段比较大小", () => {
    expect(compareVersions("0.2.3", "0.2.2")).toBe(1);
    expect(compareVersions("0.2.2", "0.2.3")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("v0.2.2", "0.2.2")).toBe(0);
  });

  it("正式版高于预发布版", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });
});

describe("releaseNotesUrl", () => {
  it("跳到对应版本的 Release 页面", () => {
    expect(releaseNotesUrl("0.2.3")).toBe(
      "https://github.com/heshengtao/ai-cut/releases/tag/v0.2.3",
    );
    expect(releaseNotesUrl("v0.2.3")).toBe(
      "https://github.com/heshengtao/ai-cut/releases/tag/v0.2.3",
    );
  });

  it("版本号为空时退回发布列表", () => {
    expect(releaseNotesUrl("")).toBe("https://github.com/heshengtao/ai-cut/releases");
  });
});

describe("shouldNotice", () => {
  it("首次安装、同版本与降级都不提示", () => {
    expect(shouldNotice(null, "0.2.2")).toBe(false);
    expect(shouldNotice("0.2.2", "0.2.2")).toBe(false);
    expect(shouldNotice("0.2.3", "0.2.2")).toBe(false);
  });

  it("升级时提示", () => {
    expect(shouldNotice("0.2.2", "0.2.3")).toBe(true);
  });
});

describe("takeUpdateNotice", () => {
  it("首次启动只记录版本，不提示", () => {
    expect(takeUpdateNotice("0.2.2")).toBeNull();
  });

  it("升级后返回旧版本，并且只提示一次", () => {
    takeUpdateNotice("0.2.2");
    expect(takeUpdateNotice("0.2.3")).toBe("0.2.2");
    expect(takeUpdateNotice("0.2.3")).toBeNull();
  });

  it("降级不提示，但会记录当前版本", () => {
    takeUpdateNotice("0.2.3");
    expect(takeUpdateNotice("0.2.2")).toBeNull();
    expect(takeUpdateNotice("0.2.3")).toBe("0.2.2");
  });
});
